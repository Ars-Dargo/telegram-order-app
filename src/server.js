require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const { getSuppliers, getProducts, getFoodProducts, getLocations, getOrders, saveOrder, clearCache } = require('./sheets');
const { getCards, saveCard, saveFeedback, DRINKS } = require('./coffee');
const { sendTelegramMessage } = require('./telegram');
const { sendWeeklyDigest } = require('./digest');

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
      if (so.comment) text += `\n💬 <b>Комментарий:</b> ${esc(so.comment)}\n`;
      if (order.comment) text += `\n📝 <b>Комментарий к заявке:</b> ${esc(order.comment)}\n`;
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

// Принудительный сброс кэша (для обновления каталога без перезапуска)
app.post('/api/refresh', (req, res) => {
  clearCache();
  res.json({ ok: true });
});

// ─── Карточка кофе для гостя (QR) ───────────────────────────────────────────

// Данные для гостевой страницы: паспорт зерна и рецепт по точке
app.get('/api/coffee/:locationId', async (req, res) => {
  try {
    const locations = await getLocations();
    const location = locations.find(l => l.id === req.params.locationId);
    if (!location) return res.status(404).json({ error: 'Точка не найдена' });

    const cards = await getCards(location.id);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({ location: { id: location.id, name: location.name }, cards });
  } catch (err) {
    console.error('Coffee card error:', err.message);
    res.status(500).json({ error: 'Не удалось загрузить карточку' });
  }
});

// Сохранение карточки бариста — append-лог, ничего не перезаписывается
app.post('/api/coffee/card', async (req, res) => {
  try {
    const card = req.body;
    if (!card?.locationId || !DRINKS.includes(card.drink)) {
      return res.status(400).json({ error: 'Не выбрана точка или напиток' });
    }
    await saveCard(card);
    res.json({ ok: true });
  } catch (err) {
    console.error('Coffee save error:', err.message);
    res.status(500).json({ error: 'Не удалось сохранить карточку' });
  }
});

// Отзыв гостя: обязательных полей нет, но пустой отзыв не пишем
app.post('/api/feedback', async (req, res) => {
  try {
    const fb = req.body;
    if (!fb?.locationId) return res.status(400).json({ error: 'Не указана точка' });

    const hasContent = fb.rating || fb.q1 || fb.q2 || fb.q3 || (fb.comment || '').trim();
    if (!hasContent) return res.status(400).json({ error: 'Пустой отзыв' });

    const rating = fb.rating ? parseInt(fb.rating, 10) : '';
    if (rating !== '' && (isNaN(rating) || rating < 1 || rating > 10)) {
      return res.status(400).json({ error: 'Оценка вне шкалы' });
    }

    await saveFeedback({ ...fb, rating });
    res.json({ ok: true });
  } catch (err) {
    console.error('Feedback error:', err.message);
    res.status(500).json({ error: 'Не удалось отправить отзыв' });
  }
});

// Гостевая страница по QR: feedfabrista.ru/L03 — обычный веб, не Mini App.
// Регистрируется последней, иначе перехватит статику; точка с несуществующим id → 404.
app.get('/:locationId([A-Za-z0-9_-]{1,12})', async (req, res, next) => {
  try {
    const locations = await getLocations();
    if (!locations.some(l => l.id === req.params.locationId)) return next();
    res.sendFile(path.join(__dirname, '../public/guest.html'));
  } catch (err) {
    console.error('Guest page error:', err.message);
    next();
  }
});

// Сводка по отзывам: пятница, 16:00 по Москве. Часовой пояс задаём явно —
// на Railway контейнер живёт в UTC, и без него сводка ушла бы в 19:00.
cron.schedule('0 16 * * 5', () => {
  sendWeeklyDigest().catch(err => console.error('Digest error:', err.message));
}, { timezone: 'Europe/Moscow' });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
