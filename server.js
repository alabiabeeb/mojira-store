// MOJIRA store — Express backend.
// Storage: Upstash Redis + Vercel Blob when configured (Vercel), otherwise local JSON files + uploads folder.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5050;
const ON_VERCEL = !!process.env.VERCEL;
// On a host with a persistent disk (e.g. Render), point these at the disk
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'mojira2026';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies at 4.5MB

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_REDIS = !!(REDIS_URL && REDIS_TOKEN);
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;

const CATEGORIES = {
  'women-shoes': "Women's Shoes",
  'women-bags': "Women's Bags",
  'women-watches': "Women's Watches",
  'men-watches': "Men's Watches",
};
const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// ---------- data storage ----------
async function redis(command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: JSON.stringify(command),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.error) throw new Error('Database error: ' + (out.error || res.status));
  return out.result;
}

function dataFile(name) { return path.join(DATA_DIR, `${name}.json`); }

async function load(name, fallback) {
  if (USE_REDIS) {
    const raw = await redis(['GET', `mojira:${name}`]);
    return raw == null ? fallback : JSON.parse(raw);
  }
  try { return JSON.parse(fs.readFileSync(dataFile(name), 'utf8')); }
  catch { return fallback; }
}

async function save(name, data) {
  if (USE_REDIS) return redis(['SET', `mojira:${name}`, JSON.stringify(data)]);
  const tmp = dataFile(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, dataFile(name));
}

async function exists(name) {
  if (USE_REDIS) return (await redis(['EXISTS', `mojira:${name}`])) === 1;
  return fs.existsSync(dataFile(name));
}

// ---------- image storage ----------
async function saveImage(file) {
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[file.mimetype];
  const name = newId('img') + ext;
  if (USE_BLOB) {
    const { put } = require('@vercel/blob');
    const blob = await put(`products/${name}`, file.buffer, { access: 'public', contentType: file.mimetype });
    return blob.url;
  }
  if (ON_VERCEL) throw httpError(503, 'Photo storage is not connected yet. In Vercel, open Storage and connect a Blob store.');
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer);
  return '/uploads/' + name;
}

function deleteImage(image) {
  if (!image) return;
  if (image.startsWith('/uploads/')) {
    fs.rm(path.join(UPLOAD_DIR, path.basename(image)), { force: true }, () => {});
  } else if (USE_BLOB && image.startsWith('https://')) {
    require('@vercel/blob').del(image).catch(() => {});
  }
}

// ---------- helpers ----------
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
async function setup() {
  if (!USE_REDIS) {
    if (ON_VERCEL) throw httpError(503, 'The store database is not connected yet. In Vercel, open Storage and connect Upstash Redis.');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  if (!(await exists('settings'))) {
    await save('settings', {
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
  if (!(await exists('products'))) {
    const now = new Date().toISOString();
    const seed = [
      ['Aurelia Block Heels', 'women-shoes', 28500, 12, 'Elegant suede block heels, comfortable all-day wear.'],
      ['Sienna Pointed Pumps', 'women-shoes', 32000, 8, 'Classic pointed-toe pumps with a glossy finish.'],
      ['Amara Leather Tote', 'women-bags', 45000, 6, 'Spacious genuine-leather tote with gold hardware.'],
      ['Zuri Mini Crossbody', 'women-bags', 26000, 10, 'Compact crossbody with adjustable chain strap.'],
      ['Rosé Gold Mesh Watch', 'women-watches', 38000, 5, 'Slim rose-gold mesh strap, water resistant.'],
      ['Regent Chronograph', 'men-watches', 55000, 4, 'Stainless steel chronograph with sapphire-coated glass.'],
    ];
    await save('products', seed.map(([name, category, price, quantity, description]) => ({
      id: newId('p'), name, category, price, quantity, description,
      image: '', featured: true, createdAt: now, updatedAt: now,
    })));
  }
  if (!(await exists('orders'))) await save('orders', []);
}

let ready = null;
function ensureReady() {
  if (!ready) ready = setup().catch(e => { ready = null; throw e; });
  return ready;
}

// ---------- auth (signed tokens, so logins survive server restarts) ----------
// Tokens are signed with the password hash, so changing the password logs out every other device.
function sign(exp, settings) {
  return crypto.createHmac('sha256', settings.admin.hash + (process.env.SESSION_SECRET || '')).update(String(exp)).digest('hex');
}

function makeToken(settings) {
  const exp = Date.now() + TOKEN_TTL_MS;
  return `${exp}.${sign(exp, settings)}`;
}

async function requireAdmin(req, res, next) {
  try {
    const [exp, sig] = (req.headers.authorization || '').replace(/^Bearer /, '').split('.');
    const settings = await load('settings', {});
    const expected = exp ? sign(exp, settings) : '';
    const valid = sig && sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) && Number(exp) > Date.now();
    if (!valid) return res.status(401).json({ error: 'Please log in again.' });
    next();
  } catch (e) { next(e); }
}

// Express 4 does not catch errors from async handlers on its own
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- uploads ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (req, f, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/.test(f.mimetype);
    cb(ok ? null : httpError(400, 'Only JPG, PNG, WEBP or GIF images are allowed.'), ok);
  },
});

function parseProduct(body, existing = {}) {
  const p = { ...existing };
  if (body.name !== undefined) p.name = String(body.name).trim().slice(0, 120);
  if (body.description !== undefined) p.description = String(body.description).trim().slice(0, 2000);
  if (body.category !== undefined) p.category = String(body.category);
  if (body.price !== undefined) p.price = Number(body.price);
  if (body.oldPrice !== undefined) p.oldPrice = body.oldPrice === '' ? null : Number(body.oldPrice);
  if (body.quantity !== undefined) p.quantity = Number(body.quantity);
  if (body.featured !== undefined) p.featured = body.featured === true || body.featured === 'true';

  if (!p.name) throw httpError(400, 'Product name is required.');
  if (!CATEGORIES[p.category]) throw httpError(400, 'Please choose a valid category.');
  if (!Number.isFinite(p.price) || p.price < 0) throw httpError(400, 'Price must be a positive number.');
  if (p.oldPrice != null && (!Number.isFinite(p.oldPrice) || p.oldPrice < 0)) throw httpError(400, 'Old price must be a positive number.');
  if (!Number.isInteger(p.quantity) || p.quantity < 0) throw httpError(400, 'Quantity must be a whole number (0 or more).');
  return p;
}

async function publicSettings() {
  const { admin, ...rest } = await load('settings', {});
  return rest;
}

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'))); // on Vercel, public/ is served by the CDN instead
app.use('/uploads', express.static(UPLOAD_DIR));
app.get('/admin', (req, res) => res.redirect('/admin.html'));
app.use('/api', (req, res, next) => ensureReady().then(() => next(), next));

// Public API
app.get('/api/settings', h(async (req, res) => res.json({ ...(await publicSettings()), categories: CATEGORIES })));

app.get('/api/products', h(async (req, res) => {
  let list = await load('products', []);
  const { category, q } = req.query;
  if (category) list = list.filter(p => p.category === category);
  if (q) {
    const s = String(q).toLowerCase();
    list = list.filter(p => (p.name + ' ' + p.description).toLowerCase().includes(s));
  }
  res.json(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}));

app.get('/api/products/:id', h(async (req, res) => {
  const p = (await load('products', [])).find(x => x.id === req.params.id);
  p ? res.json(p) : res.status(404).json({ error: 'Product not found.' });
}));

app.post('/api/orders', h(async (req, res) => {
  const { customer = {}, items = [] } = req.body || {};
  const name = String(customer.name || '').trim();
  const phone = String(customer.phone || '').trim();
  const address = String(customer.address || '').trim();
  if (!name || !phone || !address) return res.status(400).json({ error: 'Name, phone and delivery address are required.' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Your cart is empty.' });

  const products = await load('products', []);
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

  const settings = await load('settings', {});
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const deliveryFee = Number(settings.deliveryFee) || 0;
  const orders = await load('orders', []);
  const order = {
    id: newId('o'),
    ref: 'MJ' + String(orders.length + 1001),
    customer: { name, phone, email: String(customer.email || '').trim(), address, note: String(customer.note || '').trim() },
    items: lines, subtotal, deliveryFee, total: subtotal + deliveryFee,
    status: 'pending', createdAt: new Date().toISOString(),
  };
  orders.push(order);
  await save('products', products);
  await save('orders', orders);
  res.status(201).json(order);
}));

// Admin API
app.post('/api/admin/login', h(async (req, res) => {
  const settings = await load('settings', {});
  if (!checkPassword(String(req.body?.password || ''), settings.admin)) {
    return res.status(401).json({ error: 'Wrong password.' });
  }
  res.json({ token: makeToken(settings) });
}));

app.post('/api/admin/logout', (req, res) => res.json({ ok: true }));

app.get('/api/admin/stats', requireAdmin, h(async (req, res) => {
  const [products, orders] = await Promise.all([load('products', []), load('orders', [])]);
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
}));

app.post('/api/admin/products', requireAdmin, upload.single('image'), h(async (req, res) => {
  const now = new Date().toISOString();
  const p = parseProduct(req.body, { id: newId('p'), featured: false, createdAt: now, image: '' });
  p.updatedAt = now;
  if (req.file) p.image = await saveImage(req.file);
  const products = await load('products', []);
  products.push(p);
  await save('products', products);
  res.status(201).json(p);
}));

app.put('/api/admin/products/:id', requireAdmin, upload.single('image'), h(async (req, res) => {
  const products = await load('products', []);
  const i = products.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Product not found.' });
  const p = parseProduct(req.body, products[i]);
  if (req.file) {
    p.image = await saveImage(req.file);
    deleteImage(products[i].image);
  } else if (req.body.removeImage === 'true') {
    deleteImage(products[i].image);
    p.image = '';
  }
  p.updatedAt = new Date().toISOString();
  products[i] = p;
  await save('products', products);
  res.json(p);
}));

app.patch('/api/admin/products/:id/stock', requireAdmin, h(async (req, res) => {
  const products = await load('products', []);
  const p = products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  const q = Number(req.body?.quantity);
  if (!Number.isInteger(q) || q < 0) return res.status(400).json({ error: 'Quantity must be a whole number (0 or more).' });
  p.quantity = q;
  p.updatedAt = new Date().toISOString();
  await save('products', products);
  res.json(p);
}));

app.delete('/api/admin/products/:id', requireAdmin, h(async (req, res) => {
  const products = await load('products', []);
  const p = products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  await save('products', products.filter(x => x.id !== p.id));
  deleteImage(p.image);
  res.json({ ok: true });
}));

app.get('/api/admin/orders', requireAdmin, h(async (req, res) => {
  res.json((await load('orders', [])).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}));

app.patch('/api/admin/orders/:id', requireAdmin, h(async (req, res) => {
  const status = req.body?.status;
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const orders = await load('orders', []);
  const o = orders.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });

  // Return stock when an order is cancelled; take it again if un-cancelled
  if (status !== o.status && (status === 'cancelled' || o.status === 'cancelled')) {
    const dir = status === 'cancelled' ? 1 : -1;
    const products = await load('products', []);
    for (const l of o.items) {
      const p = products.find(x => x.id === l.id);
      if (!p) continue;
      if (dir < 0 && p.quantity < l.qty) return res.status(409).json({ error: `Not enough "${p.name}" in stock to restore this order.` });
    }
    for (const l of o.items) {
      const p = products.find(x => x.id === l.id);
      if (p) p.quantity += dir * l.qty;
    }
    await save('products', products);
  }
  o.status = status;
  o.updatedAt = new Date().toISOString();
  await save('orders', orders);
  res.json(o);
}));

app.get('/api/admin/settings', requireAdmin, h(async (req, res) => res.json(await publicSettings())));

app.put('/api/admin/settings', requireAdmin, h(async (req, res) => {
  const settings = await load('settings', {});
  const fields = ['storeName', 'tagline', 'whatsapp', 'phone', 'email', 'address', 'bankName', 'accountName', 'accountNumber'];
  for (const f of fields) if (req.body[f] !== undefined) settings[f] = String(req.body[f]).trim().slice(0, 200);
  if (req.body.deliveryFee !== undefined) {
    const fee = Number(req.body.deliveryFee);
    if (!Number.isFinite(fee) || fee < 0) return res.status(400).json({ error: 'Delivery fee must be 0 or more.' });
    settings.deliveryFee = fee;
  }
  settings.whatsapp = (settings.whatsapp || '').replace(/\D/g, '');
  await save('settings', settings);
  res.json(await publicSettings());
}));

app.put('/api/admin/password', requireAdmin, h(async (req, res) => {
  const { current, next } = req.body || {};
  const settings = await load('settings', {});
  if (!checkPassword(String(current || ''), settings.admin)) return res.status(400).json({ error: 'Current password is wrong.' });
  if (!next || String(next).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  settings.admin = hashPassword(String(next));
  await save('settings', settings);
  res.json({ ok: true, token: makeToken(settings) });
}));

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Image must be smaller than 4MB.' });
  const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? 'Server error — please try again.' : err.message });
});

module.exports = app;

if (!ON_VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n  MOJIRA store running:  http://localhost:${PORT}`);
    console.log(`  Owner dashboard:       http://localhost:${PORT}/admin`);
    console.log(`  Storage: ${USE_REDIS ? 'Upstash Redis' : 'local files'}, photos: ${USE_BLOB ? 'Vercel Blob' : 'local uploads folder'}\n`);
  });
}
