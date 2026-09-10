const { getFeedbackSince, DRINKS } = require('./coffee');
const { getLocations } = require('./sheets');
const { sendTelegramMessage, escHtml } = require('./telegram');

// Порог низкой оценки. На шкале 1-10 гости кучкуются в 7-9, поэтому среднее
// почти не двигается, а доля оценок 6 и ниже — единственный живой сигнал.
const LOW = 6;

const DRINK_LABEL = { espresso: 'Эспрессо', filter: 'Фильтр' };

function fmtDay(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}`;
}

// «1 отзыв, 2 отзыва, 5 отзывов»: сводку читают люди, а не парсер
function plural(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

function reviews(n) { return plural(n, 'отзыв', 'отзыва', 'отзывов'); }

function stats(rows) {
  const rated = rows.map(r => parseInt(r.rating, 10)).filter(n => !isNaN(n));
  if (!rated.length) return { count: rows.length, avg: null, lowShare: null };
  const sum = rated.reduce((a, b) => a + b, 0);
  const low = rated.filter(n => n <= LOW).length;
  return {
    count: rows.length,
    avg: (sum / rated.length).toFixed(1),
    lowShare: Math.round((low / rated.length) * 100),
    rated: rated.length,
  };
}

function line(label, s) {
  if (!s.count) return null;
  if (s.avg === null) return `${label}: ${reviews(s.count)} без оценки`;
  return `${label}: ${reviews(s.count)}, средняя ${s.avg}, низких ${s.lowShare}%`;
}

function buildDigest(rows, locations, from, to) {
  const total = stats(rows);

  let text = `📊 <b>Отзывы гостей за неделю</b>\n${fmtDay(from)} - ${fmtDay(to)}\n\n`;

  if (!total.count) {
    text += 'За неделю не пришло ни одного отзыва.\n\n';
    text += 'Стоит проверить, стоят ли QR-коды на подставках и выдают ли их гостям.';
    return text;
  }

  text += `Всего ${reviews(total.count)}`;
  if (total.avg !== null) text += `, средняя ${total.avg}, низких оценок ${total.lowShare}%`;
  text += '\n';

  for (const loc of locations) {
    const mine = rows.filter(r => r.location_id === loc.id);
    text += `\n📍 <b>${escHtml(loc.name)}</b>\n`;

    // Точку без отзывов всё равно показываем: молчание — тоже сигнал,
    // а пропуск строки читается как «забыли», а не как «пусто»
    if (!mine.length) {
      text += 'Отзывов нет\n';
      continue;
    }

    for (const drink of DRINKS) {
      const l = line(DRINK_LABEL[drink], stats(mine.filter(r => r.drink === drink)));
      if (l) text += l + '\n';
    }

    const noDrink = line('Без напитка', stats(mine.filter(r => !DRINKS.includes(r.drink))));
    if (noDrink) text += noDrink + '\n';

    for (const r of mine.filter(x => x.comment)) {
      const mark = r.rating ? ` (${escHtml(r.rating)})` : '';
      text += `💬${mark} «${escHtml(r.comment)}»\n`;
    }
  }

  return text;
}

async function sendWeeklyDigest() {
  const chatId = process.env.DIGEST_CHAT_ID;
  if (!chatId) {
    console.warn('Digest: DIGEST_CHAT_ID не задан, сводка не отправлена');
    return;
  }

  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86400000);

  const [rows, locations] = await Promise.all([getFeedbackSince(from), getLocations()]);
  const text = buildDigest(rows, locations, from, to);

  // Telegram режет сообщения длиннее 4096 символов: при большом числе
  // комментариев отправляем частями по границам строк
  for (const part of split(text, 3900)) {
    await sendTelegramMessage(chatId, part);
  }

  console.log(`Digest: отправлена сводка, отзывов ${rows.length}`);
}

function split(text, limit) {
  if (text.length <= limit) return [text];
  const parts = [];
  let cur = '';
  for (const l of text.split('\n')) {
    if ((cur + l + '\n').length > limit) {
      parts.push(cur);
      cur = '';
    }
    cur += l + '\n';
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

module.exports = { buildDigest, sendWeeklyDigest, split };
