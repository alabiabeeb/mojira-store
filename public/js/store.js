// Storefront: catalogue, product view, cart, checkout.
const state = {
  settings: { categories: {}, deliveryFee: 0 },
  products: [],
  category: '',
  q: '',
  sort: 'new',
  cart: loadCart(),
};

function loadCart() {
  try { return JSON.parse(localStorage.getItem('mojira-cart')) || []; } catch { return []; }
}
function saveCart() {
  try { localStorage.setItem('mojira-cart', JSON.stringify(state.cart)); } catch {}
  renderCart();
}

const $ = id => document.getElementById(id);

// ---------- init ----------
(async function init() {
  $('year').textContent = new Date().getFullYear();
  try {
    const [settings, products] = await Promise.all([api('/api/settings'), api('/api/products')]);
    state.settings = settings;
    state.products = products;
  } catch (e) {
    toast('Could not load the store. Please refresh.', true);
  }
  applySettings();
  renderCategories();
  renderGrid();
  renderCart();
})();

function applySettings() {
  const s = state.settings;
  document.querySelectorAll('[data-store-name]').forEach(el => el.textContent = s.storeName || 'MOJIRA');
  document.querySelectorAll('[data-tagline]').forEach(el => el.textContent = s.tagline || '');
  $('fPhone').textContent = s.phone || '';
  $('fEmail').textContent = s.email || '';
  $('fAddress').textContent = s.address || '';
  const wa = s.whatsapp ? `https://wa.me/${s.whatsapp}?text=${encodeURIComponent('Hello ' + (s.storeName || 'MOJIRA') + ', I have an enquiry.')}` : '';
  $('fWhatsapp').href = wa || '#';
  $('waFloat').href = wa || '#';
  $('waFloat').classList.toggle('hidden', !wa);
}

// ---------- categories & filters ----------
function renderCategories() {
  const cats = state.settings.categories;
  $('catGrid').innerHTML = Object.entries(cats).map(([key, label]) => {
    const count = state.products.filter(p => p.category === key).length;
    return `<button class="cat-card cat-${key}" data-cat="${key}">
      ${ICONS[key]}
      <div><h3>${esc(label)}</h3><span>${count} item${count === 1 ? '' : 's'} · Shop now →</span></div>
    </button>`;
  }).join('');

  $('chips').innerHTML = [['', 'All'], ...Object.entries(cats)]
    .map(([key, label]) => `<button class="chip ${key === state.category ? 'active' : ''}" data-cat="${key}">${esc(label)}</button>`).join('');

  $('footCats').innerHTML = Object.entries(cats)
    .map(([key, label]) => `<li><a href="#shop" data-cat="${key}">${esc(label)}</a></li>`).join('');
}

function setCategory(cat) {
  state.category = cat;
  $('shopTitle').textContent = cat ? state.settings.categories[cat] : 'All products';
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.cat === cat));
  renderGrid();
}

document.addEventListener('click', e => {
  const catEl = e.target.closest('[data-cat]');
  if (catEl) {
    setCategory(catEl.dataset.cat);
    $('nav').classList.remove('open');
    if (!catEl.classList.contains('chip')) {
      e.preventDefault();
      $('shop').scrollIntoView({ behavior: 'smooth' });
    }
  }
});

$('search').addEventListener('input', e => { state.q = e.target.value.trim().toLowerCase(); renderGrid(); });
$('sort').addEventListener('change', e => { state.sort = e.target.value; renderGrid(); });
$('searchJump').addEventListener('click', () => { $('shop').scrollIntoView({ behavior: 'smooth' }); setTimeout(() => $('search').focus(), 400); });
$('menuBtn').addEventListener('click', () => $('nav').classList.toggle('open'));

// ---------- product grid ----------
function stockTag(p) {
  if (p.quantity === 0) return '<span class="tag out">Sold out</span>';
  if (p.oldPrice > p.price) return `<span class="tag sale">-${Math.round((1 - p.price / p.oldPrice) * 100)}%</span>`;
  if (p.quantity <= 3) return '<span class="tag low">Only a few left</span>';
  return '';
}

function priceHtml(p) {
  return `<span class="price">${money(p.price)}${p.oldPrice > p.price ? `<s>${money(p.oldPrice)}</s>` : ''}</span>`;
}

function renderGrid() {
  let list = state.products.filter(p =>
    (!state.category || p.category === state.category) &&
    (!state.q || (p.name + ' ' + p.description).toLowerCase().includes(state.q)));
  const sorters = {
    new: (a, b) => b.createdAt.localeCompare(a.createdAt),
    low: (a, b) => a.price - b.price,
    high: (a, b) => b.price - a.price,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  list.sort(sorters[state.sort]);
  // Keep sold-out items at the end
  list.sort((a, b) => (a.quantity === 0) - (b.quantity === 0));

  $('grid').innerHTML = list.length ? list.map(p => `
    <article class="card">
      <div class="card-img" data-view="${p.id}">${productImage(p)}${stockTag(p)}</div>
      <div class="card-body">
        <div class="card-cat">${esc(state.settings.categories[p.category] || '')}</div>
        <h3 class="card-title" data-view="${p.id}">${esc(p.name)}</h3>
        <div class="card-foot">
          ${priceHtml(p)}
          <button class="add-btn" data-add="${p.id}" ${p.quantity === 0 ? 'disabled' : ''} aria-label="Add ${esc(p.name)} to bag">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </div>
    </article>`).join('')
    : `<div class="empty"><h3>Nothing here yet</h3><p>Try another category or search — new pieces arrive often.</p></div>`;
}

$('grid').addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add) return addToCart(add.dataset.add);
  const view = e.target.closest('[data-view]');
  if (view) openProduct(view.dataset.view);
});

// ---------- product modal ----------
function openProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  const stock = p.quantity === 0
    ? '<span class="dot out"></span>Sold out'
    : p.quantity <= 3 ? `<span class="dot low"></span>Only ${p.quantity} left — order soon`
    : '<span class="dot"></span>In stock';
  $('productDetail').innerHTML = `
    <div class="pd">
      <div class="pd-img">${productImage(p)}</div>
      <div class="pd-info">
        <div class="card-cat">${esc(state.settings.categories[p.category] || '')}</div>
        <h2>${esc(p.name)}</h2>
        ${priceHtml(p)}
        <p>${esc(p.description || '')}</p>
        <div class="stock">${stock}</div>
        <div class="pd-actions">
          <button class="btn btn-dark" data-add-modal="${p.id}" ${p.quantity === 0 ? 'disabled' : ''}>Add to bag</button>
          ${state.settings.whatsapp ? `<a class="btn btn-outline" target="_blank" rel="noopener" href="https://wa.me/${state.settings.whatsapp}?text=${encodeURIComponent(`Hello, I'm interested in "${p.name}" (${money(p.price)}).`)}">Ask on WhatsApp</a>` : ''}
        </div>
      </div>
    </div>`;
  openModal('productModal');
}

$('productDetail').addEventListener('click', e => {
  const b = e.target.closest('[data-add-modal]');
  if (b) { addToCart(b.dataset.addModal); closeAll(); openDrawer(); }
});

// ---------- cart ----------
function cartLines() {
  return state.cart
    .map(l => ({ ...l, product: state.products.find(p => p.id === l.id) }))
    .filter(l => l.product);
}

function addToCart(id) {
  const p = state.products.find(x => x.id === id);
  if (!p || p.quantity === 0) return;
  const line = state.cart.find(l => l.id === id);
  if (line) {
    if (line.qty >= p.quantity) return toast(`Only ${p.quantity} available`, true);
    line.qty++;
  } else state.cart.push({ id, qty: 1 });
  saveCart();
  toast(`${p.name} added to your bag`);
}

function cartTotals() {
  const lines = cartLines();
  const subtotal = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
  const delivery = lines.length ? Number(state.settings.deliveryFee) || 0 : 0;
  return { lines, subtotal, delivery, total: subtotal + delivery };
}

function renderCart() {
  // Drop items that were removed from the store and clamp to current stock
  state.cart = state.cart.filter(l => {
    const p = state.products.find(x => x.id === l.id);
    if (!state.products.length) return true;
    if (!p || p.quantity === 0) return false;
    l.qty = Math.min(l.qty, p.quantity);
    return true;
  });
  const { lines, subtotal, delivery, total } = cartTotals();
  const count = lines.reduce((s, l) => s + l.qty, 0);
  $('cartCount').textContent = count;
  $('cartCount').classList.toggle('hidden', !count);
  $('cartItems').innerHTML = lines.length ? lines.map(l => `
    <div class="cart-item">
      <div class="cart-thumb">${productImage(l.product)}</div>
      <div>
        <h4>${esc(l.product.name)}</h4>
        <div style="font-size:.9rem;color:var(--ink-soft)">${money(l.product.price)}</div>
        <div class="qty">
          <button data-dec="${l.id}" aria-label="Decrease">−</button><span>${l.qty}</span><button data-inc="${l.id}" aria-label="Increase">+</button>
        </div>
      </div>
      <div style="text-align:right">
        <div class="price">${money(l.product.price * l.qty)}</div>
        <button class="remove" data-rm="${l.id}">Remove</button>
      </div>
    </div>`).join('')
    : `<div class="empty"><h3>Your bag is empty</h3><p>Discover something beautiful.</p></div>`;
  $('cartFoot').classList.toggle('hidden', !lines.length);
  $('cartSubtotal').textContent = money(subtotal);
  $('cartDelivery').textContent = delivery ? money(delivery) : 'Free';
  $('cartTotal').textContent = money(total);
  $('coTotal').textContent = money(total);
}

$('cartItems').addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  const id = t.dataset.inc || t.dataset.dec || t.dataset.rm;
  const line = state.cart.find(l => l.id === id);
  if (!line) return;
  if (t.dataset.inc) {
    const p = state.products.find(x => x.id === id);
    if (line.qty >= p.quantity) return toast(`Only ${p.quantity} available`, true);
    line.qty++;
  } else if (t.dataset.dec) {
    line.qty--;
    if (line.qty < 1) state.cart = state.cart.filter(l => l.id !== id);
  } else state.cart = state.cart.filter(l => l.id !== id);
  saveCart();
});

// ---------- overlays ----------
function openDrawer() { $('drawer').classList.add('open'); $('overlay').classList.add('open'); }
function openModal(id) { $(id).classList.add('open'); $('overlay').classList.add('open'); }
function closeAll() {
  document.querySelectorAll('.drawer.open, .modal.open').forEach(el => el.classList.remove('open'));
  $('overlay').classList.remove('open');
  $('nav').classList.remove('open');
}
$('cartBtn').addEventListener('click', openDrawer);
$('overlay').addEventListener('click', closeAll);
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeAll));
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeAll(); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

// ---------- checkout ----------
$('checkoutBtn').addEventListener('click', () => {
  closeAll();
  $('checkoutView').classList.remove('hidden');
  $('successView').classList.add('hidden');
  $('coError').textContent = '';
  openModal('checkoutModal');
});

$('checkoutForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('placeOrder');
  btn.disabled = true;
  btn.textContent = 'Placing order…';
  $('coError').textContent = '';
  try {
    const customer = Object.fromEntries(new FormData(e.target));
    const order = await api('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer, items: state.cart }),
    });
    state.cart = [];
    saveCart();
    e.target.reset();
    state.products = await api('/api/products').catch(() => state.products);
    renderGrid();
    renderCategories();
    showSuccess(order);
  } catch (err) {
    $('coError').textContent = err.message;
    // Stock may have changed — refresh so the cart reflects reality
    state.products = await api('/api/products').catch(() => state.products);
    renderGrid();
    renderCart();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Place order';
  }
});

function showSuccess(order) {
  const s = state.settings;
  const summary = order.items.map(i => `${i.qty} x ${i.name}`).join(', ');
  const waText = `Hello ${s.storeName}, I just placed order ${order.ref} (${summary}) — total ${money(order.total)}. Here is my payment receipt.`;
  $('checkoutView').classList.add('hidden');
  $('successView').classList.remove('hidden');
  $('successView').innerHTML = `
    <div class="success-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m5 12 5 5 9-10"/></svg></div>
    <h2 class="modal-title">Thank you, ${esc(order.customer.name.split(' ')[0])}!</h2>
    <p class="modal-sub">Your order <b>${esc(order.ref)}</b> has been received. Please transfer <b>${money(order.total)}</b> to the account below, then send your receipt on WhatsApp.</p>
    <div class="bank-box">
      <div><span>Bank</span><b>${esc(s.bankName)}</b></div>
      <div><span>Account name</span><b>${esc(s.accountName)}</b></div>
      <div><span>Account number</span><b>${esc(s.accountNumber)}</b></div>
      <div><span>Amount</span><b>${money(order.total)}</b></div>
      <div><span>Reference</span><b>${esc(order.ref)}</b></div>
    </div>
    ${s.whatsapp ? `<a class="btn btn-gold btn-block" target="_blank" rel="noopener" href="https://wa.me/${s.whatsapp}?text=${encodeURIComponent(waText)}">Send receipt on WhatsApp</a>` : ''}
    <button class="btn btn-ghost btn-block" style="margin-top:8px" data-close-success>Continue shopping</button>`;
  $('successView').querySelector('[data-close-success]').addEventListener('click', closeAll);
}
