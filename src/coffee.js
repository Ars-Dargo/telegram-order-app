const { google } = require('googleapis');
const NodeCache = require('node-cache');
const { getAuth, getLocations } = require('./sheets');

// Отдельная таблица под фичу — заявки не трогаем, отзывов копится слишком много
const SPREADSHEET_ID = () => process.env.COFFEE_SPREADSHEET_ID;

const cache = new NodeCache({ stdTTL: parseInt(process.env.CACHE_TTL) || 300 });
const BEANS_CACHE_KEY = 'coffee_beans';

const STALE_DAYS = 7;
const DRINKS = ['espresso', 'filter'];

const BEANS_RANGE = 'Beans!A:N';
const FEEDBACK_RANGE = 'Feedback!A:S';

// ts пишем в московском времени как "2026-09-10 14:30": и человеку читаемо в таблице,
// и парсится обратно однозначно (Москва круглый год UTC+3, перевода часов нет)
function nowMsk() {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Moscow',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
  return parts.replace('T', ' ');
}

function parseMsk(ts) {
  if (!ts) return null;
  const d = new Date(`${String(ts).trim().replace(' ', 'T')}:00+03:00`);
  return isNaN(d) ? null : d;
}

async function sheetsApi() {
  const auth = await getAuth();
  return google.sheets({ version: 'v4', auth });
}

async function getRows(range, cacheKey) {
  if (cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const sheets = await sheetsApi();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID(),
    range,
  });

  const rows = response.data.values;
  if (!rows || rows.length < 2) return [];

  const headers = rows[0].map(h => h.trim());
  const data = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] !== undefined ? String(row[i]).trim() : '';
    });
    return obj;
  });

  if (cacheKey) cache.set(cacheKey, data);
  return data;
}

// Последняя карточка по каждому напитку: лист — append-лог, ничего не перезаписывается
async function getCards(locationId) {
  const rows = await getRows(BEANS_RANGE, BEANS_CACHE_KEY);
  const mine = rows.filter(r => r.location_id === locationId);

  const result = {};
  for (const drink of DRINKS) {
    const last = mine.filter(r => r.drink === drink).pop() || null;
    if (!last) {
      result[drink] = null;
      continue;
    }
    const saved = parseMsk(last.ts);
    const ageDays = saved ? (Date.now() - saved.getTime()) / 86400000 : Infinity;
    result[drink] = {
      roaster: last.roaster,
      country: last.country,
      region: last.region,
      process: last.process,
      descriptors: last.descriptors,
      dose_g: last.dose_g,
      time_s: last.time_s,
      yield_g: last.yield_g,
      author_name: last.author_name,
      ts: last.ts,
      // Дату гостю не показываем, но карточка гаснет через 7 дней без обновления
      stale: ageDays > STALE_DAYS,
    };
  }
  return result;
}

async function saveCard(card) {
  const locations = await getLocations();
  const location = locations.find(l => l.id === card.locationId);
  if (!location) throw new Error(`Неизвестная точка: ${card.locationId}`);
  if (!DRINKS.includes(card.drink)) throw new Error(`Неизвестный напиток: ${card.drink}`);

  const sheets = await sheetsApi();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID(),
    range: BEANS_RANGE,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        nowMsk(),
        location.id,
        location.name,
        card.drink,
        card.authorId || '',
        card.authorName || '',
        card.roaster || '',
        card.country || '',
        card.region || '',
        // У фильтра только батч брю: обработки и рецепта нет
        card.drink === 'espresso' ? (card.process || '') : '',
        card.descriptors || '',
        card.drink === 'espresso' ? (card.dose_g || '') : '',
        card.drink === 'espresso' ? (card.time_s || '') : '',
        card.drink === 'espresso' ? (card.yield_g || '') : '',
      ]],
    },
  });

  // Иначе NodeCache задержит обновление на 5 минут, и гость увидит старое зерно
  cache.del(BEANS_CACHE_KEY);
}

async function saveFeedback(fb) {
  const locations = await getLocations();
  const location = locations.find(l => l.id === fb.locationId);
  if (!location) throw new Error(`Неизвестная точка: ${fb.locationId}`);

  // Снимок зерна берём на сервере из текущей карточки, а не из того, что прислал браузер
  const cards = await getCards(location.id);
  const card = DRINKS.includes(fb.drink) ? cards[fb.drink] : null;

  const sheets = await sheetsApi();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID(),
    range: FEEDBACK_RANGE,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        nowMsk(),
        location.id,
        location.name,
        fb.drink || '',
        fb.rating || '',
        fb.q1 || '',
        fb.q2 || '',
        fb.q3 || '',
        (fb.comment || '').slice(0, 500),
        card?.roaster || '',
        card?.country || '',
        card?.region || '',
        card?.process || '',
        card?.descriptors || '',
        card?.dose_g || '',
        card?.time_s || '',
        card?.yield_g || '',
        card?.ts || '',
        // Отзыв к погашенной или отсутствующей карточке помечаем, чтобы исключать из разреза по зерну
        card && !card.stale ? 'FALSE' : 'TRUE',
      ]],
    },
  });
}

async function getFeedbackSince(fromDate) {
  const rows = await getRows(FEEDBACK_RANGE, null);
  return rows.filter(r => {
    const d = parseMsk(r.ts);
    return d && d >= fromDate;
  });
}

function clearCoffeeCache() {
  cache.flushAll();
}

module.exports = {
  getCards, saveCard, saveFeedback, getFeedbackSince,
  clearCoffeeCache, nowMsk, parseMsk, DRINKS, STALE_DAYS,
};
