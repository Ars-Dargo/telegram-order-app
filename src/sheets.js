const { google } = require('googleapis');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: parseInt(process.env.CACHE_TTL) || 300 });
const ORDERS_CACHE_KEY = 'orders_history';

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
  const [products, suppliers] = await Promise.all([getSheetData('Products'), getSheetData('Suppliers')]);
  const dessertIds = new Set(suppliers.filter(s => s.type !== 'food').map(s => s.id));
  return products.filter(r => r.id && r.name && r.available?.toUpperCase() !== 'FALSE' && dessertIds.has(r.supplier_id));
}

async function getLocations() {
  const rows = await getSheetData('Locations');
  return rows.filter(r => r.id && r.name);
}

async function getFoodProducts() {
  const [products, suppliers] = await Promise.all([getSheetData('Products'), getSheetData('Suppliers')]);
  const foodIds = new Set(suppliers.filter(s => s.type === 'food').map(s => s.id));
  return products.filter(r => r.id && r.name && r.available?.toUpperCase() !== 'FALSE' && foodIds.has(r.supplier_id));
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
      range: 'Orders!A:J',
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
          supplierOrder.comment || '',
          order.comment || '',
        ]],
      },
    });
  }

  cache.del(ORDERS_CACHE_KEY);
}

async function getOrders() {
  const cached = cache.get(ORDERS_CACHE_KEY);
  if (cached) return cached;

  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  // Полные колонки, а не A1:H500 — иначе с ростом листа история застревает на старых заявках
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'Orders!A:J',
  });

  const rows = response.data.values;
  if (!rows || rows.length < 2) return [];

  const headers = rows[0].map(h => h.trim());
  const result = rows.slice(1)
    .reverse()
    .slice(0, 150)
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });

  cache.set(ORDERS_CACHE_KEY, result, 60);
  return result;
}

function clearCache() {
  cache.flushAll();
}

module.exports = { getAuth, getSuppliers, getProducts, getFoodProducts, getLocations, getOrders, saveOrder, clearCache };
