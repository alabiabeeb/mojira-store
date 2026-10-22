// MOJIRA store — Express backend with JSON-file storage.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5050;
// On a host, point these at a persistent disk so products and photos survive redeploys
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'mojira2026';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const CATEGORIES = {
  'women-shoes': "Women's Shoes",
  'women-bags': "Women's Bags",
  'women-watches': "Women's Watches",
  'men-watches': "Men's Watches",
};
const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- storage helpers ----------
function file(name) { return path.join(DATA_DIR, `${name}.json`); }

function load(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); }
  catch { return fallback; }
}

function save(name, data) {
  const tmp = file(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file(name));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function checkPassword(password, { salt, hash }) {
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

// ---------- first-run setup ----------
if (!fs.existsSync(file('settings'))) {
  save('settings', {
    storeName: 'MOJIRA',
    tagline: 'Luxe by Mojirade Ojasope',
    whatsapp: '2348000000000',
    phone: '+234 800 000 0000',
    email: 'hello@mojira.store',
    address: 'Lagos, Nigeria',
    bankName: 'Your Bank',
    accountName: 'Mojirade Rafiat Ojasope',
    accountNumber: '0000000000',
    deliveryFee: 3000,
    admin: hashPassword(DEFAULT_PASSWORD),
  });
}
if (!fs.existsSync(file('products'))) {
  const now = new Date().toISOString();
  const seed = [
    ['Aurelia Block Heels', 'women-shoes', 28500, 12, 'Elegant suede block heels, comfortable all-day wear.'],
    ['Sienna Pointed Pumps', 'women-shoes', 32000, 8, 'Classic pointed-toe pumps with a glossy finish.'],
    ['Amara Leather Tote', 'women-bags', 45000, 6, 'Spacious genuine-leather tote with gold hardware.'],
    ['Zuri Mini Crossbody', 'women-bags', 26000, 10, 'Compact crossbody with adjustable chain strap.'],
    ['Rosé Gold Mesh Watch', 'women-watches', 38000, 5, 'Slim rose-gold mesh strap, water resistant.'],
    ['Regent Chronograph', 'men-watches', 55000, 4, 'Stainless steel chronograph with sapphire-coated glass.'],
  ];
  save('products', seed.map(([name, category, price, quantity, description]) => ({
    id: newId('p'), name, category, price, quantity, description,
    image: '', featured: true, createdAt: now, updatedAt: now,
  })));
}
if (!fs.existsSync(file('orders'))) save('orders', []);

// ---------- auth ----------
const sessions = new Map(); // token -> expiry

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const exp = sessions.get(token);
  if (!exp || exp < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Please log in again.' });
  }
  next();
}

// ---------- uploads ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, f, cb) => cb(null, newId('img') + path.extname(f.originalname).toLowerCase()),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, f, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/.test(f.mimetype);
    cb(ok ? null : new Error('Only JPG, PNG, WEBP or GIF images are allowed.'), ok);
  },
});

function deleteImage(image) {
  if (image && image.startsWith('/uploads/')) {
    fs.rm(path.join(UPLOAD_DIR, path.basename(image)), { force: true }, () => {});
  }
}

function parseProduct(body, existing = {}) {
  const p = { ...existing };
  if (body.name !== undefined) p.name = String(body.name).trim().slice(0, 120);
  if (body.description !== undefined) p.description = String(body.description).trim().slice(0, 2000);
  if (body.category !== undefined) p.category = String(body.category);
  if (body.price !== undefined) p.price = Number(body.price);
  if (body.oldPrice !== undefined) p.oldPrice = body.oldPrice === '' ? null : Number(body.oldPrice);
  if (body.quantity !== undefined) p.quantity = Number(body.quantity);
  if (body.featured !== undefined) p.featured = body.featured === true || body.featured === 'true';

  if (!p.name) throw new Error('Product name is required.');
  if (!CATEGORIES[p.category]) throw new Error('Please choose a valid category.');
  if (!Number.isFinite(p.price) || p.price < 0) throw new Error('Price must be a positive number.');
  if (p.oldPrice != null && (!Number.isFinite(p.oldPrice) || p.oldPrice < 0)) throw new Error('Old price must be a positive number.');
  if (!Number.isInteger(p.quantity) || p.quantity < 0) throw new Error('Quantity must be a whole number (0 or more).');
  return p;
}

function publicSettings() {
  const { admin, ...rest } = load('settings', {});
  return rest;
}

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// Public API
app.get('/api/settings', (req, res) => res.json({ ...publicSettings(), categories: CATEGORIES }));

app.get('/api/products', (req, res) => {
  let list = load('products', []);
  const { category, q } = req.query;
  if (category) list = list.filter(p => p.category === category);
  if (q) {
    const s = String(q).toLowerCase();
    list = list.filter(p => (p.name + ' ' + p.description).toLowerCase().includes(s));
  }
  res.json(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

app.get('/api/products/:id', (req, res) => {
  const p = load('products', []).find(x => x.id === req.params.id);
  p ? res.json(p) : res.status(404).json({ error: 'Product not found.' });
});

app.post('/api/orders', (req, res) => {
  const { customer = {}, items = [] } = req.body || {};
  const name = String(customer.name || '').trim();
  const phone = String(customer.phone || '').trim();
  const address = String(customer.address || '').trim();
  if (!name || !phone || !address) return res.status(400).json({ error: 'Name, phone and delivery address are required.' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Your cart is empty.' });

  const products = load('products', []);
  const lines = [];
  for (const it of items) {
    const p = products.find(x => x.id === it.id);
    const qty = Number(it.qty);
    if (!p) return res.status(400).json({ error: 'An item in your cart is no longer available.' });
    if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ error: 'Invalid quantity.' });
    if (qty > p.quantity) return res.status(409).json({ error: `Only ${p.quantity} of "${p.name}" left in stock.` });
    lines.push({ id: p.id, name: p.name, price: p.price, qty, image: p.image });
  }
  // Reserve stock only after every line has been validated
  for (const l of lines) {
    const p = products.find(x => x.id === l.id);
    p.quantity -= l.qty;
    p.updatedAt = new Date().toISOString();
  }

  const settings = load('settings', {});
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const deliveryFee = Number(settings.deliveryFee) || 0;
  const orders = load('orders', []);
  const order = {
    id: newId('o'),
    ref: 'MJ' + String(orders.length + 1001),
    customer: { name, phone, email: String(customer.email || '').trim(), address, note: String(customer.note || '').trim() },
    items: lines, subtotal, deliveryFee, total: subtotal + deliveryFee,
    status: 'pending', createdAt: new Date().toISOString(),
  };
  orders.push(order);
  save('products', products);
  save('orders', orders);
  res.status(201).json(order);
});

// Admin API
app.post('/api/admin/login', (req, res) => {
  const settings = load('settings', {});
  if (!checkPassword(String(req.body?.password || ''), settings.admin)) {
    return res.status(401).json({ error: 'Wrong password.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + TOKEN_TTL_MS);
  res.json({ token });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  sessions.delete(req.headers.authorization.replace(/^Bearer /, ''));
  res.json({ ok: true });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const products = load('products', []);
  const orders = load('orders', []);
  const active = orders.filter(o => o.status !== 'cancelled');
  res.json({
    products: products.length,
    unitsInStock: products.reduce((s, p) => s + p.quantity, 0),
    lowStock: products.filter(p => p.quantity > 0 && p.quantity <= 3).length,
    outOfStock: products.filter(p => p.quantity === 0).length,
    orders: orders.length,
    pendingOrders: orders.filter(o => o.status === 'pending').length,
    revenue: active.filter(o => o.status !== 'pending').reduce((s, o) => s + o.total, 0),
    stockValue: products.reduce((s, p) => s + p.price * p.quantity, 0),
  });
});

app.post('/api/admin/products', requireAdmin, upload.single('image'), (req, res) => {
  try {
    const now = new Date().toISOString();
    const p = parseProduct(req.body, { id: newId('p'), featured: false, createdAt: now, image: '' });
    p.updatedAt = now;
    if (req.file) p.image = '/uploads/' + req.file.filename;
    const products = load('products', []);
    products.push(p);
    save('products', products);
    res.status(201).json(p);
  } catch (e) {
    if (req.file) deleteImage('/uploads/' + req.file.filename);
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/admin/products/:id', requireAdmin, upload.single('image'), (req, res) => {
  const products = load('products', []);
  const i = products.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Product not found.' });
  try {
    const p = parseProduct(req.body, products[i]);
    if (req.file) {
      deleteImage(products[i].image);
      p.image = '/uploads/' + req.file.filename;
    } else if (req.body.removeImage === 'true') {
      deleteImage(products[i].image);
      p.image = '';
    }
    p.updatedAt = new Date().toISOString();
    products[i] = p;
    save('products', products);
    res.json(p);
  } catch (e) {
    if (req.file) deleteImage('/uploads/' + req.file.filename);
    res.status(400).json({ error: e.message });
  }
});

app.patch('/api/admin/products/:id/stock', requireAdmin, (req, res) => {
  const products = load('products', []);
  const p = products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  const q = Number(req.body?.quantity);
  if (!Number.isInteger(q) || q < 0) return res.status(400).json({ error: 'Quantity must be a whole number (0 or more).' });
  p.quantity = q;
  p.updatedAt = new Date().toISOString();
  save('products', products);
  res.json(p);
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const products = load('products', []);
  const p = products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  deleteImage(p.image);
  save('products', products.filter(x => x.id !== p.id));
  res.json({ ok: true });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  res.json(load('orders', []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const status = req.body?.status;
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const orders = load('orders', []);
  const o = orders.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });

  // Return stock when an order is cancelled; take it again if un-cancelled
  if (status !== o.status && (status === 'cancelled' || o.status === 'cancelled')) {
    const sign = status === 'cancelled' ? 1 : -1;
    const products = load('products', []);
    for (const l of o.items) {
      const p = products.find(x => x.id === l.id);
      if (!p) continue;
      if (sign < 0 && p.quantity < l.qty) return res.status(409).json({ error: `Not enough "${p.name}" in stock to restore this order.` });
    }
    for (const l of o.items) {
      const p = products.find(x => x.id === l.id);
      if (p) p.quantity += sign * l.qty;
    }
    save('products', products);
  }
  o.status = status;
  o.updatedAt = new Date().toISOString();
  save('orders', orders);
  res.json(o);
});

app.get('/api/admin/settings', requireAdmin, (req, res) => res.json(publicSettings()));

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const settings = load('settings', {});
  const fields = ['storeName', 'tagline', 'whatsapp', 'phone', 'email', 'address', 'bankName', 'accountName', 'accountNumber'];
  for (const f of fields) if (req.body[f] !== undefined) settings[f] = String(req.body[f]).trim().slice(0, 200);
  if (req.body.deliveryFee !== undefined) {
    const fee = Number(req.body.deliveryFee);
    if (!Number.isFinite(fee) || fee < 0) return res.status(400).json({ error: 'Delivery fee must be 0 or more.' });
    settings.deliveryFee = fee;
  }
  settings.whatsapp = (settings.whatsapp || '').replace(/\D/g, '');
  save('settings', settings);
  res.json(publicSettings());
});

app.put('/api/admin/password', requireAdmin, (req, res) => {
  const { current, next } = req.body || {};
  const settings = load('settings', {});
  if (!checkPassword(String(current || ''), settings.admin)) return res.status(400).json({ error: 'Current password is wrong.' });
  if (!next || String(next).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  settings.admin = hashPassword(String(next));
  save('settings', settings);
  res.json({ ok: true });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be smaller than 5MB.' : err.message });
});

app.listen(PORT, () => {
  console.log(`\n  MOJIRA store running:  http://localhost:${PORT}`);
  console.log(`  Owner dashboard:       http://localhost:${PORT}/admin\n`);
});
