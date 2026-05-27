const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

let catalog = { suppliers: [], products: [], locations: [] };
let cart = {};
let activeCategory = 'Все';
let infoActiveCategory = 'Все';
let sentOrders = new Set();
let selectedLocation = null;
let currentSupplierOrders = [];
let historyOrders = {};
let checklistLocation = null;
let checklistChecked = new Set();

const CHECKLIST_ITEMS = [
  'Включить кофемашину и прогреть',
  'Проверить холодильники с десертами',
  'Выставить витрину и проверить выкладку',
  'Проверить дату и состояние позиций',
  'Пополнить расходники (стаканы, крышки, салфетки)',
  'Проверить наличие молока, сливок, сиропов',
  'Протереть стойку и кофемашину',
  'Проверить чистоту зала и санузла',
  'Проверить кассу и терминал оплаты',
  'Сфотографировать витрину на открытие',
];

// ─── Load ──────────────────────────────────────────────────────────────────

async function loadCatalog() {
  show('loading'); hide('error-screen'); hide('home-screen');

  try {
    const res = await fetch('/api/catalog');
    if (!res.ok) throw new Error('Network error');
    catalog = await res.json();
    renderCatalog();
    hide('loading');
    show('home-screen');
  } catch (e) {
    hide('loading');
    show('error-screen');
  }
}

// ─── Home screen ───────────────────────────────────────────────────────────

function showOrderFlow() {
  hide('home-screen');
  renderLocationScreen();
  show('location-screen');
}

function showInfoScreen() {
  hide('home-screen');
  infoActiveCategory = 'Все';
  renderInfoCategoryTabs();
  renderInfoProducts();
  show('info-screen');
}

async function showHistoryScreen() {
  hide('home-screen');
  show('history-screen');
  show('history-loading');
  document.getElementById('history-list').innerHTML = '';

  try {
    const res = await fetch('/api/orders');
    if (!res.ok) throw new Error();
    const { orders } = await res.json();
    hide('history-loading');
    renderHistoryScreen(orders);
  } catch (e) {
    hide('history-loading');
    document.getElementById('history-list').innerHTML =
      '<div class="empty-state">Не удалось загрузить историю</div>';
  }
}

function renderHistoryScreen(orders) {
  const container = document.getElementById('history-list');

  if (!orders || orders.length === 0) {
    container.innerHTML = '<div class="empty-state">Заказов пока нет</div>';
    return;
  }

  historyOrders = {};
  const orderedIds = [];
  orders.forEach(row => {
    if (!row.order_id) return;
    if (!historyOrders[row.order_id]) {
      historyOrders[row.order_id] = {
        date: row.date,
        location: row.location,
        user_name: row.user_name,
        suppliers: [],
      };
      orderedIds.push(row.order_id);
    }
    historyOrders[row.order_id].suppliers.push({
      name: row.supplier_name,
      items: row.items,
    });
  });

  container.innerHTML = orderedIds.map(id => {
    const o = historyOrders[id];
    return `
      <div class="history-card">
        <div class="history-meta">
          <span class="history-date">${escHtml(o.date)}</span>
          ${o.user_name ? `<span class="history-user">${escHtml(o.user_name)}</span>` : ''}
        </div>
        ${o.location ? `<div class="history-location">📍 ${escHtml(o.location)}</div>` : ''}
        ${o.suppliers.map(s => `
          <div class="history-supplier">
            <div class="history-supplier-name">${escHtml(s.name)}</div>
            <div class="history-items">${escHtml(s.items)}</div>
          </div>
        `).join('')}
        <button class="history-reorder-btn" onclick="reorderFromHistory('${escHtml(id)}')">
          🔄 Повторить заказ
        </button>
      </div>
    `;
  }).join('');
}

function reorderFromHistory(orderId) {
  const order = historyOrders[orderId];
  if (!order) return;

  cart = {};
  catalog.products.forEach(p => {
    const el = document.getElementById(`qty-${p.id}`);
    if (el) el.textContent = '0';
  });

  const nameMap = {};
  catalog.products.forEach(p => { nameMap[p.name.toLowerCase()] = p; });

  let restored = 0;
  order.suppliers.forEach(s => {
    (s.items || '').split('; ').forEach(itemStr => {
      const match = itemStr.match(/^(.+) x(\d+)/);
      if (!match) return;
      const product = nameMap[match[1].trim().toLowerCase()];
      const qty = parseInt(match[2]);
      if (product && qty > 0) {
        cart[product.id] = qty;
        restored++;
      }
    });
  });

  if (restored === 0) {
    showToast('Товары из этого заказа недоступны');
    return;
  }

  if (order.location) {
    const loc = catalog.locations.find(l => order.location.startsWith(l.name));
    if (loc) selectedLocation = loc;
  }

  hide('history-screen');
  updateLocationStrip();
  updateCartUI();
  show('main');
  if (Object.keys(cart).length > 0) show('fab');
  showToast(`Восстановлено ${restored} позиций`);
}

// ─── Location screen ───────────────────────────────────────────────────────

function renderLocationScreen() {
  const container = document.getElementById('location-list');
  const confirmBtn = document.getElementById('loc-confirm-btn');

  if (!catalog.locations || catalog.locations.length === 0) {
    container.innerHTML = '<div class="empty-state">Точки не добавлены.<br>Заполните лист <b>Locations</b> в Google Sheets.</div>';
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Продолжить →';
    return;
  }

  confirmBtn.textContent = 'Далее →';
  confirmBtn.disabled = !selectedLocation;

  container.innerHTML = catalog.locations.map(loc => `
    <div class="location-card ${selectedLocation?.id === loc.id ? 'selected' : ''}"
         onclick="selectLocation('${escHtml(loc.id)}')">
      <div class="location-info">
        <div class="location-name">${escHtml(loc.name)}</div>
        ${loc.address ? `<div class="location-address">${escHtml(loc.address)}</div>` : ''}
      </div>
      <div class="location-check">✓</div>
    </div>
  `).join('');
}

function selectLocation(locId) {
  selectedLocation = catalog.locations.find(l => l.id === locId) || null;
  renderLocationScreen();
}

function confirmLocation() {
  hide('location-screen');
  updateLocationStrip();
  show('main');
  if (Object.keys(cart).length > 0) show('fab');
}

function updateLocationStrip() {
  const strip = document.getElementById('location-strip');
  if (selectedLocation) {
    let text = `📍 ${selectedLocation.name}`;
    if (selectedLocation.address) text += ` — ${selectedLocation.address}`;
    strip.textContent = text;
    strip.classList.remove('hidden');
  } else {
    strip.classList.add('hidden');
  }
}

// ─── Catalog ───────────────────────────────────────────────────────────────

function renderCatalog() {
  renderCategoryTabs();
  renderProducts();
}

function renderCategoryTabs() {
  const categories = ['Все', ...new Set(catalog.products.map(p => p.category).filter(Boolean))];
  const container = document.getElementById('category-tabs');
  container.innerHTML = categories.map(cat => `
    <button class="cat-tab ${cat === activeCategory ? 'active' : ''}"
            onclick="setCategory('${escHtml(cat)}')">${escHtml(cat)}</button>
  `).join('');
}

function setCategory(cat) {
  activeCategory = cat;
  renderCategoryTabs();
  renderProducts();
}

function renderProducts() {
  const search = document.getElementById('search-input')?.value.toLowerCase() || '';
  const container = document.getElementById('catalog');
  const supplierMap = {};
  catalog.suppliers.forEach(s => { supplierMap[s.id] = s; });

  const filtered = catalog.products.filter(p => {
    const matchCat = activeCategory === 'Все' || p.category === activeCategory;
    const matchSearch = !search || p.name.toLowerCase().includes(search);
    return matchCat && matchSearch;
  });

  const grouped = {};
  filtered.forEach(p => {
    const sid = p.supplier_id || 'other';
    if (!grouped[sid]) grouped[sid] = [];
    grouped[sid].push(p);
  });

  if (Object.keys(grouped).length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:40px 0">Ничего не найдено</div>';
    return;
  }

  container.innerHTML = Object.entries(grouped).map(([sid, products]) => {
    const supplier = supplierMap[sid];
    return `
      <div class="supplier-section">
        ${supplier ? `<div class="supplier-title">${escHtml(supplier.name)}</div>` : ''}
        ${products.map(p => renderProductCard(p)).join('')}
      </div>
    `;
  }).join('');
}

function renderProductCard(p) {
  const qty = cart[p.id] || 0;
  const priceStr = p.price ? `${p.price} ₽` : '';
  return `
    <div class="product-card" id="card-${p.id}">
      <div class="product-info">
        <div class="product-name">${escHtml(p.name)}</div>
        ${p.category ? `<div class="product-meta">${escHtml(p.category)}</div>` : ''}
        ${priceStr ? `<div class="product-price">${escHtml(priceStr)}</div>` : ''}
      </div>
      <div class="qty-control">
        <button class="qty-btn" onclick="changeQty('${p.id}', -1)">−</button>
        <span class="qty-value" id="qty-${p.id}">${qty}</span>
        <button class="qty-btn" onclick="changeQty('${p.id}', 1)">+</button>
      </div>
    </div>
  `;
}

// ─── Info screen ───────────────────────────────────────────────────────────

function renderInfoCategoryTabs() {
  const categories = ['Все', ...new Set(catalog.products.map(p => p.category).filter(Boolean))];
  const container = document.getElementById('info-category-tabs');
  container.innerHTML = categories.map(cat => `
    <button class="cat-tab ${cat === infoActiveCategory ? 'active' : ''}"
            onclick="setInfoCategory('${escHtml(cat)}')">${escHtml(cat)}</button>
  `).join('');
}

function setInfoCategory(cat) {
  infoActiveCategory = cat;
  renderInfoCategoryTabs();
  renderInfoProducts();
}

function renderInfoProducts() {
  const search = document.getElementById('info-search-input')?.value.toLowerCase() || '';
  const container = document.getElementById('info-catalog');
  const supplierMap = {};
  catalog.suppliers.forEach(s => { supplierMap[s.id] = s; });

  const filtered = catalog.products.filter(p => {
    const matchCat = infoActiveCategory === 'Все' || p.category === infoActiveCategory;
    const matchSearch = !search ||
      p.name.toLowerCase().includes(search) ||
      (p.description || '').toLowerCase().includes(search);
    return matchCat && matchSearch;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:40px 0">Ничего не найдено</div>';
    return;
  }

  const grouped = {};
  filtered.forEach(p => {
    const sid = p.supplier_id || 'other';
    if (!grouped[sid]) grouped[sid] = [];
    grouped[sid].push(p);
  });

  container.innerHTML = Object.entries(grouped).map(([sid, products]) => {
    const supplier = supplierMap[sid];
    return `
      <div class="supplier-section">
        ${supplier ? `<div class="supplier-title">${escHtml(supplier.name)}</div>` : ''}
        ${products.map(p => renderInfoCard(p)).join('')}
      </div>
    `;
  }).join('');
}

function renderInfoCard(p) {
  const priceStr = p.price ? `${p.price} ₽` : '';
  return `
    <div class="info-card">
      <div class="info-card-header">
        <div class="info-card-name">${escHtml(p.name)}</div>
        ${priceStr ? `<div class="info-card-price">${escHtml(priceStr)}</div>` : ''}
      </div>
      ${p.category ? `<div class="info-card-category">${escHtml(p.category)}</div>` : ''}
      ${p.description ? `<div class="info-card-desc">${escHtml(p.description)}</div>` : ''}
      ${p.storage ? `<div class="info-card-storage">🌡 ${escHtml(p.storage)}</div>` : ''}
    </div>
  `;
}

// ─── Cart logic ────────────────────────────────────────────────────────────

function changeQty(productId, delta) {
  const current = cart[productId] || 0;
  const next = Math.max(0, current + delta);
  if (next === 0) delete cart[productId];
  else cart[productId] = next;

  const qtyEl = document.getElementById(`qty-${productId}`);
  if (qtyEl) qtyEl.textContent = next;
  updateCartUI();
}

function updateCartUI() {
  const posCount = Object.keys(cart).length;
  const badge = document.getElementById('cart-badge');
  const fabEl = document.getElementById('fab');
  const fabCount = document.getElementById('fab-count');
  const cartCount = document.getElementById('cart-count');

  if (posCount > 0) {
    badge.classList.remove('hidden');
    cartCount.textContent = posCount;
    fabEl.classList.remove('hidden');
    fabCount.textContent = posCount;
  } else {
    badge.classList.add('hidden');
    fabEl.classList.add('hidden');
  }
}

function openCart() {
  renderCartPanel();
  hide('main'); hide('fab');
  show('cart-panel');
}

function renderCartPanel() {
  const supplierMap = {};
  catalog.suppliers.forEach(s => { supplierMap[s.id] = s; });
  const productMap = {};
  catalog.products.forEach(p => { productMap[p.id] = p; });

  const grouped = {};
  Object.entries(cart).forEach(([pid, qty]) => {
    const p = productMap[pid];
    if (!p) return;
    const sid = p.supplier_id || 'other';
    if (!grouped[sid]) grouped[sid] = [];
    grouped[sid].push({ ...p, quantity: qty });
  });

  const container = document.getElementById('cart-content');

  if (Object.keys(grouped).length === 0) {
    container.innerHTML = '<div class="empty-state">Корзина пуста</div>';
    return;
  }

  const locBadge = selectedLocation
    ? `<div class="cart-location-badge">📍 ${escHtml(selectedLocation.name)}${selectedLocation.address ? ' — ' + escHtml(selectedLocation.address) : ''}</div>`
    : '';

  container.innerHTML = locBadge + Object.entries(grouped).map(([sid, items]) => {
    const supplier = supplierMap[sid];
    return `
      <div class="cart-supplier-group">
        <div class="cart-supplier-title">${supplier ? escHtml(supplier.name) : 'Прочее'}</div>
        ${items.map(item => `
          <div class="cart-item">
            <span class="cart-item-name">${escHtml(item.name)}</span>
            <span class="cart-item-qty">${item.quantity} ${escHtml(item.unit || 'шт')}</span>
            <button class="cart-item-remove" onclick="removeFromCart('${item.id}')">✕</button>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
}

function removeFromCart(productId) {
  delete cart[productId];
  renderCartPanel();
  updateCartUI();
}

function clearCart() {
  cart = {};
  catalog.products.forEach(p => {
    const el = document.getElementById(`qty-${p.id}`);
    if (el) el.textContent = '0';
  });
  updateCartUI();
}

// ─── Order sending ─────────────────────────────────────────────────────────

async function sendOrders() {
  const supplierMap = {};
  catalog.suppliers.forEach(s => { supplierMap[s.id] = s; });
  const productMap = {};
  catalog.products.forEach(p => { productMap[p.id] = p; });

  const grouped = {};
  Object.entries(cart).forEach(([pid, qty]) => {
    const p = productMap[pid];
    if (!p) return;
    const sid = p.supplier_id || 'other';
    if (!grouped[sid]) grouped[sid] = [];
    grouped[sid].push({ ...p, quantity: qty });
  });

  currentSupplierOrders = Object.entries(grouped).map(([sid, items]) => {
    const supplier = supplierMap[sid];
    return {
      supplierId: sid,
      supplierName: supplier?.name || 'Поставщик',
      whatsapp: supplier?.whatsapp || '',
      items: items.map(i => ({ id: i.id, name: i.name, quantity: i.quantity, unit: i.unit || 'шт' })),
    };
  });

  const locationStr = selectedLocation
    ? `${selectedLocation.name}${selectedLocation.address ? ', ' + selectedLocation.address : ''}`
    : '';

  try {
    const userData = tg?.initDataUnsafe?.user;
    await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userData?.id || 'unknown',
        userName: userData ? `${userData.first_name} ${userData.last_name || ''}`.trim() : 'unknown',
        location: locationStr,
        supplierOrders: currentSupplierOrders,
      }),
    });
  } catch (e) {
    // Продолжаем даже если сохранение не удалось
  }

  sentOrders.clear();
  renderOrderPanel(currentSupplierOrders);
  hide('cart-panel');
  show('order-panel');
}

function renderOrderPanel(supplierOrders) {
  const container = document.getElementById('order-list');

  const locBadge = selectedLocation
    ? `<div class="order-location-badge">📍 ${escHtml(selectedLocation.name)}${selectedLocation.address ? ' — ' + escHtml(selectedLocation.address) : ''}</div>`
    : '';

  container.innerHTML = locBadge + supplierOrders.map((so, idx) => {
    const isGroup = so.whatsapp && so.whatsapp.startsWith('https://chat.whatsapp.com/');
    const msgText = buildWhatsAppMessage(so);

    let href;
    if (isGroup) {
      href = so.whatsapp;
    } else if (so.whatsapp) {
      href = `https://wa.me/${cleanPhone(so.whatsapp)}?text=${encodeURIComponent(msgText)}`;
    } else {
      href = `https://wa.me/?text=${encodeURIComponent(msgText)}`;
    }

    return `
      <a href="${escHtml(href)}" target="_blank" class="order-supplier-card" id="order-card-${idx}"
         onclick="handleOrderClick(event, ${idx}, ${isGroup})">
        <div class="order-supplier-info">
          <div class="order-supplier-name">${escHtml(so.supplierName)}</div>
          <div class="order-supplier-summary">${so.items.length} позиций${isGroup ? ' · группа' : ''}</div>
        </div>
        <div class="wa-icon">💬</div>
      </a>
    `;
  }).join('');
}

async function handleOrderClick(event, idx, isGroup) {
  if (isGroup) {
    event.preventDefault();
    const so = currentSupplierOrders[idx];
    const msgText = buildWhatsAppMessage(so);
    try {
      await navigator.clipboard.writeText(msgText);
      showToast('Сообщение скопировано — вставьте в группу');
    } catch (e) {
      showToast('Откройте группу и вставьте заявку вручную');
    }
    setTimeout(() => window.open(so.whatsapp, '_blank'), 400);
  }
  markSent(idx);
}

function buildWhatsAppMessage(supplierOrder) {
  const date = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  let msg = `Заявка от ${date}\n`;
  if (selectedLocation) {
    msg += `Точка: ${selectedLocation.name}`;
    if (selectedLocation.address) msg += `, ${selectedLocation.address}`;
    msg += '\n';
  }
  msg += '\n';
  supplierOrder.items.forEach(item => {
    msg += `• ${item.name} — ${item.quantity} ${item.unit}\n`;
  });
  return msg;
}

function markSent(idx) {
  sentOrders.add(idx);
  setTimeout(() => {
    const card = document.getElementById(`order-card-${idx}`);
    if (card) card.classList.add('sent');
  }, 300);
}

function cleanPhone(phone) {
  return phone.replace(/\D/g, '');
}

// ─── Checklist ─────────────────────────────────────────────────────────────

function showChecklistScreen() {
  hide('home-screen');
  checklistLocation = null;
  checklistChecked = new Set();
  renderChecklistLocationList();
  renderChecklistItems();
  show('checklist-screen');
}

function renderChecklistLocationList() {
  const container = document.getElementById('checklist-location-list');
  if (!catalog.locations || catalog.locations.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:20px 0">Точки не добавлены</div>';
    return;
  }
  container.innerHTML = catalog.locations.map(loc => `
    <div class="location-card ${checklistLocation?.id === loc.id ? 'selected' : ''}"
         onclick="selectChecklistLocation('${escHtml(loc.id)}')">
      <div class="location-info">
        <div class="location-name">${escHtml(loc.name)}</div>
        ${loc.address ? `<div class="location-address">${escHtml(loc.address)}</div>` : ''}
      </div>
      <div class="location-check">✓</div>
    </div>
  `).join('');
}

function selectChecklistLocation(locId) {
  checklistLocation = catalog.locations.find(l => l.id === locId) || null;
  renderChecklistLocationList();
  updateChecklistSubmitBtn();
}

function renderChecklistItems() {
  const container = document.getElementById('checklist-items');
  container.innerHTML = CHECKLIST_ITEMS.map((item, idx) => `
    <div class="checklist-item ${checklistChecked.has(idx) ? 'done' : ''}"
         onclick="toggleChecklistItem(${idx})">
      <div class="checklist-checkbox">${checklistChecked.has(idx) ? '✓' : ''}</div>
      <div class="checklist-label">${escHtml(item)}</div>
    </div>
  `).join('');
  updateChecklistScore();
}

function toggleChecklistItem(idx) {
  if (checklistChecked.has(idx)) checklistChecked.delete(idx);
  else checklistChecked.add(idx);
  renderChecklistItems();
}

function updateChecklistScore() {
  const done = checklistChecked.size;
  const total = CHECKLIST_ITEMS.length;
  const label = document.getElementById('checklist-score-label');
  if (label) label.textContent = `Выполнено: ${done} / ${total}`;
}

function updateChecklistSubmitBtn() {
  const btn = document.getElementById('checklist-submit-btn');
  if (btn) btn.disabled = !checklistLocation;
}

async function submitChecklist() {
  const btn = document.getElementById('checklist-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Отправка...';

  const items = CHECKLIST_ITEMS.map((name, idx) => ({ name, done: checklistChecked.has(idx) }));
  const userData = tg?.initDataUnsafe?.user;
  const locationStr = checklistLocation
    ? `${checklistLocation.name}${checklistLocation.address ? ', ' + checklistLocation.address : ''}`
    : '';

  try {
    const res = await fetch('/api/checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userData?.id || 'unknown',
        userName: userData ? `${userData.first_name} ${userData.last_name || ''}`.trim() : 'unknown',
        location: locationStr,
        items,
      }),
    });
    if (!res.ok) throw new Error();
    hide('checklist-screen');
    show('home-screen');
    showToast('Отчёт по открытию отправлен ✓');
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Отправить отчёт';
    showToast('Ошибка — попробуйте ещё раз');
  }
}

// ─── Toast ─────────────────────────────────────────────────────────────────

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2800);
}

// ─── Navigation ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadCatalog();

  document.getElementById('order-flow-btn').onclick = showOrderFlow;
  document.getElementById('info-flow-btn').onclick = showInfoScreen;
  document.getElementById('history-flow-btn').onclick = showHistoryScreen;
  document.getElementById('checklist-flow-btn').onclick = showChecklistScreen;

  document.getElementById('loc-back-btn').onclick = () => {
    hide('location-screen');
    show('home-screen');
  };
  document.getElementById('loc-confirm-btn').onclick = confirmLocation;

  document.getElementById('catalog-home-btn').onclick = () => {
    hide('main'); hide('fab');
    show('home-screen');
  };

  document.getElementById('cart-badge').onclick = openCart;

  document.getElementById('back-btn').onclick = () => {
    hide('cart-panel');
    show('main');
    if (Object.keys(cart).length > 0) show('fab');
  };

  document.getElementById('send-orders-btn').onclick = sendOrders;

  document.getElementById('clear-cart-btn').onclick = () => {
    clearCart();
    hide('cart-panel');
    show('main');
  };

  document.getElementById('order-back-btn').onclick = () => {
    hide('order-panel');
    show('cart-panel');
    renderCartPanel();
  };

  document.getElementById('done-btn').onclick = () => {
    clearCart();
    hide('order-panel');
    show('home-screen');
  };

  document.getElementById('info-back-btn').onclick = () => {
    hide('info-screen');
    show('home-screen');
  };

  document.getElementById('history-back-btn').onclick = () => {
    hide('history-screen');
    show('home-screen');
  };

  document.getElementById('checklist-back-btn').onclick = () => {
    hide('checklist-screen');
    show('home-screen');
  };
  document.getElementById('checklist-submit-btn').onclick = submitChecklist;

  document.getElementById('search-input').addEventListener('input', renderProducts);
  document.getElementById('info-search-input').addEventListener('input', renderInfoProducts);
});

// ─── Utils ─────────────────────────────────────────────────────────────────

function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
