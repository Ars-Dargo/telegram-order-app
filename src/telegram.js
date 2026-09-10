const https = require('https');

// Отправка сообщения ботом. Вынесено из server.js, потому что этим же
// занимается еженедельная сводка в digest.js.
function sendTelegramMessage(chatId, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${process.env.BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const json = JSON.parse(data);
        if (json.ok) resolve(json); else reject(new Error(json.description));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { sendTelegramMessage, escHtml };
