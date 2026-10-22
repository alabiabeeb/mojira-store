// Owner dashboard: products, stock, orders, settings.
const $ = id => document.getElementById(id);
const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

const state = {
  token: (() => { try { return sessionStorage.getItem('mojira-token') || ''; } catch { return ''; } })(),
  categories: {},
  products: [],
  orders: [],
  tab: 'overview',
  orderFilter: '',
  editing: null,
};

function authed(url, opts = {}) {
  return api(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + state.token } })
    .catch(err => {
      if (err.status === 401) logout(false);
      throw err;
    });
}
const jsonOpts = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ---------- auth ----------
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('loginError').textContent = '';
  try {
    const { token } = await api('/api/admin/login', jsonOpts('POST', { password: $('password').value }));
    state.token = token;
    try { sessionStorage.setItem('mojira-token', token); } catch {}
    $('password').value = '';
    start();
  } catch (err) {
    $('loginError').textContent = err.message;
  }
});

function logout(callServer = true) {
  if (callServer) authed('/api/admin/logout', { method: 'POST' }).catch(() => {});
  state.token = '';
  try { sessionStorage.removeItem('mojira-token'); } catch {}
  $('adminView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
}
$('logoutBtn').addEventListener('click', () => logout());

async function start() {
  try {
    const settings = await api('/api/settings');
    state.categories = settings.categories;
    await refresh();
    $('loginView').classList.add('hidden');
    $('adminView').classList.remove('hidden');
    fillCategorySelects();
    fillSettings(settings);
    showTab(state.tab);
  } catch (err) {
    if (err.status !== 401) toast(err.message, true);
  }
}

async function refresh() {
  const [products, orders, stats] = await Promise.all([
    api('/api/products'),
    authed('/api/admin/orders'),
    authed('/api/admin/stats'),
  ]);
  state.products = products;
  state.orders = orders;
  state.stats = stats;
  renderAll();
}

function renderAll() {
  renderOverview();
  renderProducts();
  renderOrders();
  const pending = state.orders.filter(o => o.status === 'pending').length;
  $('pendingPill').textContent = pending;
  $('pendingPill').classList.toggle('hidden', !pending);
}

if (state.token) start();

// ---------- navigation ----------
const TITLES = { overview: 'Overview', products: 'Products', orders: 'Orders', settings: 'Settings' };
function showTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('hidden', t.id !== 'tab-' + tab));
  document.querySelectorAll('.side-nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('pageTitle').textContent = TITLES[tab];
  $('side').classList.remove('open');
  $('overlay').classList.remove('open');
}
document.querySelectorAll('.side-nav button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('sideToggle').addEventListener('click', () => { $('side').classList.add('open'); $('overlay').classList.add('open'); });

// ---------- overview ----------
function renderOverview() {
  const s = state.stats;
  $('stats').innerHTML = [
    ['Products', s.products, `${s.unitsInStock} units in stock`],
    ['Stock value', money(s.stockValue), 'at selling price'],
    ['Orders', s.orders, `${s.pendingOrders} pending`],
    ['Sales', money(s.revenue), 'confirmed & delivered'],
  ].map(([k, v, sub]) => `<div class="stat"><small>${k}</small><b>${v}</b><span>${sub}</span></div>`).join('');

  const rows = [];
  state.orders.filter(o => o.status === 'pending').forEach(o =>
    rows.push(`<div class="att-row"><span class="status pending">New order</span><span class="grow">${esc(o.ref)} · ${esc(o.customer.name)} · ${money(o.total)}</span><button class="btn btn-ghost btn-sm" data-goto-order="${o.id}">View</button></div>`));
  state.products.filter(p => p.quantity <= 3).sort((a, b) => a.quantity - b.quantity).forEach(p =>
    rows.push(`<div class="att-row"><span class="status ${p.quantity === 0 ? 'cancelled' : 'pending'}">${p.quantity === 0 ? 'Sold out' : 'Low stock: ' + p.quantity}</span><span class="grow">${esc(p.name)}</span><button class="btn btn-ghost btn-sm" data-edit="${p.id}">Restock</button></div>`));
  $('attention').innerHTML = rows.join('') || '<p style="color:var(--muted)">All good — no pending orders and stock levels are healthy. 🎉</p>';
}

$('attention').addEventListener('click', e => {
  const o = e.target.closest('[data-goto-order]');
  if (o) {
    showTab('orders');
    const el = document.querySelector(`[data-order="${o.dataset.gotoOrder}"]`);
    if (el) { el.classList.add('open'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }
  const p = e.target.closest('[data-edit]');
  if (p) openProductForm(p.dataset.edit);
});

// ---------- products ----------
function fillCategorySelects() {
  const opts = Object.entries(state.categories).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('pfCategory').innerHTML = opts;
  $('pFilter').innerHTML = '<option value="">All categories</option>' + opts;
}

function renderProducts() {
  const q = $('pSearch').value.trim().toLowerCase();
  const cat = $('pFilter').value;
  const list = state.products.filter(p => (!cat || p.category === cat) && (!q || p.name.toLowerCase().includes(q)));
  $('plist').innerHTML = list.length ? list.map(p => {
    const lvl = p.quantity === 0 ? 'out' : p.quantity <= 3 ? 'low' : '';
    return `<div class="prow">
      <div class="thumb">${productImage(p)}</div>
      <div><h4>${esc(p.name)}</h4><small>${esc(state.categories[p.category] || '')}</small></div>
      <div class="price">${money(p.price)}</div>
      <div class="stock-wrap">
        <div class="stock-ctl ${lvl}">
          <button data-step="-1" data-id="${p.id}" aria-label="Decrease stock">−</button>
          <input type="number" min="0" value="${p.quantity}" data-stock="${p.id}" aria-label="Quantity">
          <button data-step="1" data-id="${p.id}" aria-label="Increase stock">+</button>
        </div>
        <div class="stock-label">${lvl === 'out' ? 'sold out' : 'in stock'}</div>
      </div>
      <div class="actions">
        <button class="btn btn-outline btn-sm" data-edit="${p.id}">Edit</button>
        <button class="btn btn-danger btn-sm" data-del="${p.id}">Delete</button>
      </div>
    </div>`;
  }).join('') : `<div class="empty"><h3>No products yet</h3><p>Click “+ Add product” to put your first item in the store.</p></div>`;
}
$('pSearch').addEventListener('input', renderProducts);
$('pFilter').addEventListener('change', renderProducts);

async function setStock(id, quantity) {
  try {
    const p = await authed(`/api/admin/products/${id}/stock`, jsonOpts('PATCH', { quantity }));
    Object.assign(state.products.find(x => x.id === id), p);
    state.stats = await authed('/api/admin/stats');
    renderAll();
    toast(`Stock updated: ${p.name} → ${p.quantity}`);
  } catch (err) { toast(err.message, true); renderProducts(); }
}

$('plist').addEventListener('click', async e => {
  const step = e.target.closest('[data-step]');
  if (step) {
    const p = state.products.find(x => x.id === step.dataset.id);
    const q = Math.max(0, p.quantity + Number(step.dataset.step));
    if (q !== p.quantity) setStock(p.id, q);
    return;
  }
  const edit = e.target.closest('[data-edit]');
  if (edit) return openProductForm(edit.dataset.edit);
  const del = e.target.closest('[data-del]');
  if (del) {
    const p = state.products.find(x => x.id === del.dataset.del);
    if (!confirm(`Delete "${p.name}" from your store? This cannot be undone.`)) return;
    try {
      await authed('/api/admin/products/' + p.id, { method: 'DELETE' });
      toast('Product deleted');
      await refresh();
    } catch (err) { toast(err.message, true); }
  }
});

$('plist').addEventListener('change', e => {
  const input = e.target.closest('[data-stock]');
  if (!input) return;
  const q = Number(input.value);
  if (!Number.isInteger(q) || q < 0) { toast('Enter a whole number, 0 or more', true); return renderProducts(); }
  setStock(input.dataset.stock, q);
});

// ---------- product form ----------
let removeImage = false;
function setPreview(src) {
  $('pfPreview').innerHTML = src
    ? `<img src="${esc(src)}" alt="">`
    : '<span>Tap to upload a photo<br><small>JPG, PNG or WEBP · max 5MB</small></span>';
  $('pfRemoveImg').classList.toggle('hidden', !src);
}

function openProductForm(id = null) {
  const p = id ? state.products.find(x => x.id === id) : null;
  state.editing = p;
  removeImage = false;
  pendingImage = null;
  const f = $('productForm');
  f.reset();
  $('pfError').textContent = '';
  $('pfTitle').textContent = p ? 'Edit product' : 'Add product';
  if (p) {
    $('pfName').value = p.name;
    $('pfCategory').value = p.category;
    $('pfPrice').value = p.price;
    $('pfOld').value = p.oldPrice ?? '';
    $('pfQty').value = p.quantity;
    $('pfDesc').value = p.description || '';
  } else if ($('pFilter').value) {
    $('pfCategory').value = $('pFilter').value;
  }
  setPreview(p?.image || '');
  $('productModal').classList.add('open');
  $('overlay').classList.add('open');
  setTimeout(() => $('pfName').focus(), 100);
}

$('addProductTop').addEventListener('click', () => openProductForm());

// Phone photos are often 5–10MB; resize to a web-friendly JPEG before uploading
async function shrinkImage(file, maxSide = 1600) {
  if (file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // transparent PNGs get a white background, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

let pendingImage = null;
$('pfImage').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const small = await shrinkImage(file);
  if (small.size > 4 * 1024 * 1024) { toast('That photo is too large — please pick a smaller one', true); e.target.value = ''; return; }
  pendingImage = small;
  removeImage = false;
  setPreview(URL.createObjectURL(small));
});

$('pfRemoveImg').addEventListener('click', () => {
  $('pfImage').value = '';
  pendingImage = null;
  removeImage = true;
  setPreview('');
});

$('productForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('pfSave');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  $('pfError').textContent = '';
  const data = new FormData(e.target);
  data.delete('image');
  if (pendingImage) data.set('image', pendingImage);
  if (removeImage) data.set('removeImage', 'true');
  try {
    const p = state.editing;
    await authed(p ? '/api/admin/products/' + p.id : '/api/admin/products', { method: p ? 'PUT' : 'POST', body: data });
    closeModal();
    toast(p ? 'Product updated' : 'Product added to your store 🎉');
    await refresh();
  } catch (err) {
    $('pfError').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save product';
  }
});

function closeModal() {
  $('productModal').classList.remove('open');
  $('overlay').classList.remove('open');
  $('side').classList.remove('open');
}
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModal));
$('overlay').addEventListener('click', closeModal);
$('productModal').addEventListener('click', e => { if (e.target === $('productModal')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ---------- orders ----------
function renderOrders() {
  const counts = Object.fromEntries(STATUSES.map(s => [s, state.orders.filter(o => o.status === s).length]));
  $('oChips').innerHTML = [['', `All (${state.orders.length})`], ...STATUSES.map(s => [s, `${s[0].toUpperCase() + s.slice(1)} (${counts[s]})`])]
    .map(([k, label]) => `<button class="chip ${k === state.orderFilter ? 'active' : ''}" data-ofilter="${k}">${label}</button>`).join('');

  const list = state.orders.filter(o => !state.orderFilter || o.status === state.orderFilter);
  $('olist').innerHTML = list.length ? list.map(o => {
    const date = new Date(o.createdAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
    const phone = o.customer.phone.replace(/\D/g, '').replace(/^0/, '234');
    return `<div class="order" data-order="${o.id}">
      <div class="order-head" data-toggle>
        <div><h4>${esc(o.ref)} · ${esc(o.customer.name)}</h4><small>${date} · ${o.items.reduce((s, i) => s + i.qty, 0)} item(s)</small></div>
        <div class="price">${money(o.total)}</div>
        <span class="status ${o.status}">${o.status}</span>
      </div>
      <div class="order-body">
        <div class="order-grid">
          <div>
            <h5>Items</h5>
            ${o.items.map(i => `<div class="oline"><span>${i.qty} × ${esc(i.name)}</span><span>${money(i.price * i.qty)}</span></div>`).join('')}
            <div class="oline"><span>Delivery</span><span>${money(o.deliveryFee)}</span></div>
            <div class="oline" style="font-weight:600;border:none"><span>Total</span><span>${money(o.total)}</span></div>
          </div>
          <div>
            <h5>Customer</h5>
            <p><b>${esc(o.customer.name)}</b><br>
            <a href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a>${o.customer.email ? '<br>' + esc(o.customer.email) : ''}<br>
            ${esc(o.customer.address)}</p>
            ${o.customer.note ? `<p style="margin-top:8px"><i>Note: ${esc(o.customer.note)}</i></p>` : ''}
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center">
              <select class="input status-select" data-status="${o.id}">
                ${STATUSES.map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
              </select>
              <a class="btn btn-gold btn-sm" target="_blank" rel="noopener" href="https://wa.me/${phone}?text=${encodeURIComponent(`Hello ${o.customer.name}, thank you for your order ${o.ref} from MOJIRA.`)}">WhatsApp customer</a>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('') : '<div class="empty"><h3>No orders here</h3><p>New orders from customers will appear here.</p></div>';
}

$('oChips').addEventListener('click', e => {
  const c = e.target.closest('[data-ofilter]');
  if (c) { state.orderFilter = c.dataset.ofilter; renderOrders(); }
});

$('olist').addEventListener('click', e => {
  const t = e.target.closest('[data-toggle]');
  if (t) t.parentElement.classList.toggle('open');
});

$('olist').addEventListener('change', async e => {
  const sel = e.target.closest('[data-status]');
  if (!sel) return;
  if (sel.value === 'cancelled' && !confirm('Cancel this order? The items will be returned to stock.')) {
    return renderOrders();
  }
  try {
    await authed('/api/admin/orders/' + sel.dataset.status, jsonOpts('PATCH', { status: sel.value }));
    toast('Order marked as ' + sel.value);
    const openId = sel.dataset.status;
    await refresh();
    document.querySelector(`[data-order="${openId}"]`)?.classList.add('open');
  } catch (err) { toast(err.message, true); renderOrders(); }
});

// ---------- settings ----------
function fillSettings(s) {
  const f = $('settingsForm');
  for (const el of f.elements) if (el.name && s[el.name] !== undefined) el.value = s[el.name];
}

$('settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const s = await authed('/api/admin/settings', jsonOpts('PUT', Object.fromEntries(new FormData(e.target))));
    fillSettings(s);
    toast('Settings saved');
  } catch (err) { toast(err.message, true); }
});

$('passwordForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    // Changing the password signs out other devices; keep this one signed in with the new token
    const { token } = await authed('/api/admin/password', jsonOpts('PUT', Object.fromEntries(new FormData(e.target))));
    state.token = token;
    try { sessionStorage.setItem('mojira-token', token); } catch {}
    e.target.reset();
    toast('Password updated');
  } catch (err) { toast(err.message, true); }
});
