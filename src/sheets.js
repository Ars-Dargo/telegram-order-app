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

async function saveChecklist(data) {
  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const now = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  const spreadsheetId = process.env.CHECKLIST_SPREADSHEET_ID;

  const rows = data.items.map(item => [
    now,
    data.location,
    data.userName,
    item.name,
    item.done ? '✅' : '❌',
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Checklist!A:E',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
}

function clearCache() {
  cache.flushAll();
}

module.exports = { getSuppliers, getProducts, getLocations, getOrders, saveOrder, saveChecklist, clearCache };
