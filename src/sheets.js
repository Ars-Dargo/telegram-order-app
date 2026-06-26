const { google } = require('googleapis');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: parseInt(process.env.CACHE_TTL) || 300 });

async function getAuth() {
  // Supports both a JSON file (local dev) and inline JSON string (cloud env var)
  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
  const authOptions = { scopes: ['https://www.googleapis.com/auth/spreadsheets'] };

  if (credentialsJson) {
    authOptions.credentials = JSON.parse(credentialsJson);
  } else {
    authOptions.keyFile = process.env.GOOGLE_KEY_FILE;
  }

  return new google.auth.GoogleAuth(authOptions);
}

async function getSheetData(sheetName) {
  const cacheKey = `sheet_${sheetName}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${sheetName}!A1:Z1000`,
  });

  const rows = response.data.values;
  if (!rows || rows.length < 2) return [];

  const headers = rows[0].map(h => h.trim());
  const data = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] !== undefined ? row[i].trim() : '';
    });
    return obj;
  });

  cache.set(cacheKey, data);
  return data;
}

async function getSuppliers() {
  const rows = await getSheetData('Suppliers');
  return rows.filter(r => r.id && r.name);
}

async function getProducts() {
  const rows = await getSheetData('Products');
  return rows.filter(r => r.id && r.name && r.available?.toUpperCase() !== 'FALSE');
}

async function getLocations() {
  const rows = await getSheetData('Locations');
  return rows.filter(r => r.id && r.name);
}

async function getFoodProducts() {
  const rows = await getSheetData('Еда');
  return rows.filter(r => r.id && r.name && r.available?.toUpperCase() !== 'FALSE');
}

async function saveOrder(order) {
  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const now = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

  for (const supplierOrder of order.supplierOrders) {
    const itemsText = supplierOrder.items
      .map(i => `${i.name} x${i.quantity} ${i.unit}`)
      .join('; ');

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'Orders!A:H',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          now,
          order.orderId,
          order.userId,
          order.userName,
          supplierOrder.supplierName,
          itemsText,
          supplierOrder.items.length,
          order.location || '',
        ]],
      },
    });
  }
}

async function getOrders() {
  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'Orders!A1:H500',
  });

  const rows = response.data.values;
  if (!rows || rows.length < 2) return [];

  const headers = rows[0].map(h => h.trim());
  return rows.slice(1)
    .reverse()
    .slice(0, 150)
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });
}

function colLetter(n) {
  let result = '';
  let num = n + 1;
  while (num > 0) {
    num--;
    result = String.fromCharCode(65 + (num % 26)) + result;
    num = Math.floor(num / 26);
  }
  return result;
}

async function saveChecklist(data) {
  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.CHECKLIST_SPREADSHEET_ID;
  const today = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' });

  // Sheet name = location name (before comma), sanitized
  const sheetTitle = data.location.split(',')[0].trim().substring(0, 100).replace(/[/\\?*[\]:]/g, '-') || 'Общее';

  // Get existing sheets
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheet = meta.data.sheets.find(s => s.properties.title === sheetTitle);
  let sheetId;

  if (!existingSheet) {
    // Create sheet for this location
    const addResp = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetTitle } } }] },
    });
    sheetId = addResp.data.replies[0].addSheet.properties.sheetId;

    // Write item names in column A (A1 = header, A2+ = items)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetTitle}!A1:A${data.items.length + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['Пункт чек-листа'], ...data.items.map(i => [i.name])] },
    });

    // Format new sheet
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          // Bold green A1 header cell
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                  backgroundColor: { red: 0.18, green: 0.49, blue: 0.27 },
                  horizontalAlignment: 'LEFT',
                  verticalAlignment: 'MIDDLE',
                },
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment)',
            },
          },
          // Freeze row 1 and column A
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } },
              fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
            },
          },
          // Column A width = 310px
          {
            updateDimensionProperties: {
              range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
              properties: { pixelSize: 310 },
              fields: 'pixelSize',
            },
          },
          // Row 1 height = 36px
          {
            updateDimensionProperties: {
              range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
              properties: { pixelSize: 36 },
              fields: 'pixelSize',
            },
          },
          // Conditional: ✅ → green bg
          {
            addConditionalFormatRule: {
              rule: {
                ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 1 }],
                booleanRule: {
                  condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '✅' }] },
                  format: { backgroundColor: { red: 0.85, green: 0.96, blue: 0.87 } },
                },
              },
              index: 0,
            },
          },
          // Conditional: ❌ → red bg
          {
            addConditionalFormatRule: {
              rule: {
                ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 1 }],
                booleanRule: {
                  condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '❌' }] },
                  format: { backgroundColor: { red: 0.99, green: 0.87, blue: 0.87 } },
                },
              },
              index: 1,
            },
          },
        ],
      },
    });
  } else {
    sheetId = existingSheet.properties.sheetId;
  }

  // Get row 1 to find or create today's column
  const row1 = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetTitle}!1:1` });
  const headerRow = row1.data.values?.[0] || [];
  let colIdx = headerRow.indexOf(today);

  if (colIdx === -1) {
    colIdx = headerRow.length;
    // Write date header and format it
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetTitle}!${colLetter(colIdx)}1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[today]] },
    });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          // Date column header style
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                  backgroundColor: { red: 0.18, green: 0.49, blue: 0.27 },
                  horizontalAlignment: 'CENTER',
                  verticalAlignment: 'MIDDLE',
                },
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment)',
            },
          },
          // Date column width = 75px
          {
            updateDimensionProperties: {
              range: { sheetId, dimension: 'COLUMNS', startIndex: colIdx, endIndex: colIdx + 1 },
              properties: { pixelSize: 75 },
              fields: 'pixelSize',
            },
          },
        ],
      },
    });
  }

  // Write ✅/❌ for each item in today's column
  const col = colLetter(colIdx);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetTitle}!${col}2:${col}${data.items.length + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: data.items.map(i => [i.done ? '✅' : '❌']) },
  });
}

function clearCache() {
  cache.flushAll();
}

module.exports = { getSuppliers, getProducts, getFoodProducts, getLocations, getOrders, saveOrder, saveChecklist, clearCache };
