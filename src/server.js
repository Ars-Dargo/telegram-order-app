require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const { getSuppliers, getProducts, getFoodProducts, getLocations, getOrders, saveOrder, saveChecklist, clearCache } = require('./sheets');

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

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Отдаём все продукты и поставщиков за один запрос
app.get('/api/catalog', async (req, res) => {
  try {
    const [suppliers, products, foodProducts, locations] = await Promise.all([getSuppliers(), getProducts(), getFoodProducts(), getLocations()]);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({ suppliers, products, foodProducts, locations });
  } catch (err) {
    console.error('Catalog error:', err.message);
    res.status(500).json({ error: 'Не удалось загрузить каталог' });
  }
});

// Сохраняем заявку в лист Orders и отправляем в Telegram
app.post('/api/orders', async (req, res) => {
  try {
    const order = req.body;
    if (!order || !order.supplierOrders?.length) {
      return res.status(400).json({ error: 'Пустая заявка' });
    }
    order.orderId = `ORD-${Date.now()}`;
    await saveOrder(order);

    const now = new Date().toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit',
      year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const orderTypeLabel = order.orderType === 'today' ? '➕ Доп. заявка на сегодня' : '📅 Заявка на завтра';
    for (const so of order.supplierOrders) {
      if (!so.telegramChatId) continue;
      let text = `📦 <b>Новая заявка</b> | ${now}\n`;
      text += `${orderTypeLabel}\n`;
      if (order.location) text += `📍 ${esc(order.location)}\n`;
      if (order.userName && order.userName !== 'unknown') text += `👤 ${esc(order.userName)}\n`;
      text += '\n';
      for (const item of so.items) {
        text += `• ${esc(item.name)} — ${item.quantity} ${esc(item.unit)}\n`;
      }
      try {
        await sendTelegramMessage(so.telegramChatId, text);
      } catch (e) {
        console.error(`Order notify error [${so.supplierName}]:`, e.message);
      }
    }

    res.json({ ok: true, orderId: order.orderId });
  } catch (err) {
    console.error('Order error:', err.message);
    res.status(500).json({ error: 'Не удалось отправить заявку' });
  }
});

// История заказов из Google Sheets
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await getOrders();
    res.json({ orders });
  } catch (err) {
    console.error('Orders fetch error:', err.message);
    res.status(500).json({ error: 'Не удалось загрузить историю' });
  }
});

// Отчёт по открытию смены
app.post('/api/checklist', async (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.location) {
      return res.status(400).json({ error: 'Не выбрана точка' });
    }
    await saveChecklist(data);
    res.json({ ok: true });
  } catch (err) {
    console.error('Checklist save error:', err.message);
    res.status(500).json({ error: 'Не удалось сохранить отчёт' });
  }
});

// Принудительный сброс кэша (для обновления каталога без перезапуска)
app.post('/api/refresh', (req, res) => {
  clearCache();
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
