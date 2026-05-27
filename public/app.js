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
        ${products.map(p => renderInfoCard(p, supplierMap)).join('')}
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

  const supplierOrders = Object.entries(grouped).map(([sid, items]) => {
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
        supplierOrders,
      }),
    });
  } catch (e) {
    // Продолжаем даже если сохранение не удалось
  }

  sentOrders.clear();
  renderOrderPanel(supplierOrders);
  hide('cart-panel');
  show('order-panel');
}

function renderOrderPanel(supplierOrders) {
  const container = document.getElementById('order-list');

  const locBadge = selectedLocation
    ? `<div class="order-location-badge">📍 ${escHtml(selectedLocation.name)}${selectedLocation.address ? ' — ' + escHtml(selectedLocation.address) : ''}</div>`
    : '';

  container.innerHTML = locBadge + supplierOrders.map((so, idx) => {
    const msgText = buildWhatsAppMessage(so);
    const waUrl = so.whatsapp
      ? `https://wa.me/${cleanPhone(so.whatsapp)}?text=${encodeURIComponent(msgText)}`
      : `https://wa.me/?text=${encodeURIComponent(msgText)}`;

    return `
      <a href="${waUrl}" target="_blank" class="order-supplier-card" id="order-card-${idx}"
         onclick="markSent(${idx})">
        <div class="order-supplier-info">
          <div class="order-supplier-name">${escHtml(so.supplierName)}</div>
          <div class="order-supplier-summary">${so.items.length} позиций</div>
        </div>
        <div class="wa-icon">💬</div>
      </a>
    `;
  }).join('');
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

// ─── Navigation ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadCatalog();

  document.getElementById('order-flow-btn').onclick = showOrderFlow;
  document.getElementById('info-flow-btn').onclick = showInfoScreen;

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
