require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getSuppliers, getProducts, getLocations, getOrders, saveOrder, clearCache } = require('./sheets');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Отдаём все продукты и поставщиков за один запрос
app.get('/api/catalog', async (req, res) => {
  try {
    const [suppliers, products, locations] = await Promise.all([getSuppliers(), getProducts(), getLocations()]);
    res.json({ suppliers, products, locations });
  } catch (err) {
    console.error('Catalog error:', err.message);
    res.status(500).json({ error: 'Не удалось загрузить каталог' });
  }
});

// Сохраняем заявку в лист Orders
app.post('/api/orders', async (req, res) => {
  try {
    const order = req.body;
    if (!order || !order.supplierOrders?.length) {
      return res.status(400).json({ error: 'Пустая заявка' });
    }
    order.orderId = `ORD-${Date.now()}`;
    await saveOrder(order);
    res.json({ ok: true, orderId: order.orderId });
  } catch (err) {
    console.error('Order save error:', err.message);
    res.status(500).json({ error: 'Не удалось сохранить заявку' });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
