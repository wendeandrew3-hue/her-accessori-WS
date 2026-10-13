// SimuSoko server - Kenyan phone store, orders + card checkout
// Deps: express only. No card data is ever stored - last4 + brand only.
// Live card processing: set PESAPAL_KEY + PESAPAL_SECRET env vars to switch
// checkout from demo mode to a real gateway integration point.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const ADMIN_PASS = process.env.ADMIN_PASS || fs.readFileSync(path.join(__dirname, 'admin_pass.txt'), 'utf8').trim();
const LIVE_GATEWAY = Boolean(process.env.PESAPAL_KEY && process.env.PESAPAL_SECRET);

app.use(express.json({ limit: '50kb' }));
app.use(express.static(__dirname));

// ---------- catalog ----------
const PRODUCTS = [
  { id: 'sp20',  brand: 'Tecno',    model: 'Spark 20',          ram: 8,  storage: 256, price: 14999, tag: 'Budget king' },
  { id: 'hw40i', brand: 'Infinix',  model: 'Hot 40i',           ram: 8,  storage: 256, price: 12999, tag: 'Big battery' },
  { id: 'r13c',  brand: 'Redmi',    model: 'Redmi 13C',          ram: 6,  storage: 128, price: 13500, tag: 'Value pick' },
  { id: 'a16',   brand: 'Samsung',  model: 'Galaxy A16 5G',     ram: 6,  storage: 128, price: 18999, tag: 'Samsung entry' },
  { id: 'a38',   brand: 'OPPO',     model: 'A38',               ram: 4,  storage: 128, price: 16499, tag: 'Slim daily' },
  { id: 'rn13',  brand: 'Redmi',    model: 'Note 13 Pro',       ram: 8,  storage: 256, price: 28499, tag: 'Camera value' },
  { id: 'c30',   brand: 'Tecno',    model: 'Camon 30',          ram: 8,  storage: 256, price: 23999, tag: 'Portrait pro' },
  { id: 'n40',   brand: 'Infinix',  model: 'Note 40 Pro',       ram: 8,  storage: 256, price: 27999, tag: 'Fast charge' },
  { id: 'a36',   brand: 'Samsung',  model: 'Galaxy A36',        ram: 8,  storage: 256, price: 32999, tag: 'Midrange star' },
  { id: 'reno11',brand: 'OPPO',     model: 'Reno 11 F',          ram: 8,  storage: 256, price: 42999, tag: 'Design pick' },
  { id: 'ip13',  brand: 'Apple',    model: 'iPhone 13 128GB',   ram: 4,  storage: 128, price: 74999, tag: 'iOS entry' },
  { id: 'ip15',  brand: 'Apple',    model: 'iPhone 15 128GB',   ram: 6,  storage: 128, price: 112999, tag: 'Flagship' },
  { id: 's24fe', brand: 'Samsung',  model: 'Galaxy S24 FE',     ram: 8,  storage: 256, price: 78999, tag: 'Premium Android' },
  { id: 'n105',  brand: 'Nokia',    model: '105 (2023)',        ram: 0,  storage: 0,   price: 2499,  tag: 'Backup phone' }
];

const DELIVERY_FEE = 250; // Nairobi metro
const FREE_OVER = 50000;

app.get('/api/products', (_req, res) => res.json({ products: PRODUCTS, liveGateway: LIVE_GATEWAY }));

// ---------- orders db ----------
function loadOrders() {
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); }
  catch { return []; }
}
function saveOrders(orders) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

// ---------- card helpers ----------
function luhnOk(num) {
  const s = num.replace(/\D/g, '');
  if (s.length < 13 || s.length > 19) return false;
  let sum = 0, dbl = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = +s[i];
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
}
function cardBrand(num) {
  const s = num.replace(/\D/g, '');
  if (/^4/.test(s)) return 'Visa';
  if (/^5[1-5]/.test(s) || /^2[2-7]/.test(s)) return 'Mastercard';
  return 'Card';
}
function expiryOk(mm, yy) {
  const m = +mm, y = +yy;
  if (!m || m < 1 || m > 12 || !y) return false;
  const exp = new Date(2000 + y, m, 1);
  return exp > new Date();
}

// ---------- checkout ----------
app.post('/api/checkout', (req, res) => {
  const { customer, items, payment, card } = req.body || {};
  const name = String(customer?.name || '').trim();
  const phone = String(customer?.phone || '').trim();
  const address = String(customer?.address || '').trim();
  const city = String(customer?.city || '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'Enter your full name.' });
  if (!/^(?:\+?254|0)7\d{8}$/.test(phone.replace(/\s/g, '')) && !/^(?:\+?254|0)1\d{8}$/.test(phone.replace(/\s/g, '')))
    return res.status(400).json({ error: 'Enter a valid Kenyan phone number.' });
  if (address.length < 5) return res.status(400).json({ error: 'Enter a delivery address.' });

  const cart = Array.isArray(items) ? items.filter(i => i && i.id && i.qty > 0) : [];
  if (!cart.length) return res.status(400).json({ error: 'Your cart is empty.' });

  let subtotal = 0;
  const lineItems = cart.map(i => {
    const p = PRODUCTS.find(p => p.id === i.id);
    if (!p) return null;
    const qty = Math.min(5, Math.floor(+i.qty) || 1);
    subtotal += p.price * qty;
    return { id: p.id, name: `${p.brand} ${p.model}`, price: p.price, qty };
  }).filter(Boolean);
  if (!lineItems.length) return res.status(400).json({ error: 'Your cart is empty.' });

  const delivery = subtotal >= FREE_OVER ? 0 : DELIVERY_FEE;
  const total = subtotal + delivery;

  let paymentStatus = 'pending', cardMeta = null;
  if (payment === 'card') {
    const num = String(card?.number || '');
    if (!luhnOk(num)) return res.status(400).json({ error: 'That card number is not valid.' });
    if (!expiryOk(card?.expiry?.slice(0, 2), card?.expiry?.slice(-2)))
      return res.status(400).json({ error: 'Card expiry is invalid or past.' });
    if (!/^\d{3,4}$/.test(String(card?.cvv || ''))) return res.status(400).json({ error: 'CVV must be 3 or 4 digits.' });
    if (String(card?.name || '').trim().length < 2) return res.status(400).json({ error: 'Enter the name on the card.' });
    // Only last4 + brand kept. Live mode would hand off to the gateway here.
    cardMeta = { last4: num.replace(/\D/g, '').slice(-4), brand: cardBrand(num) };
    paymentStatus = LIVE_GATEWAY ? 'gateway' : 'paid-demo';
  } else if (payment !== 'mpesa') {
    return res.status(400).json({ error: 'Choose a payment method.' });
  }

  const order = {
    id: 'SIMU-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
    customer: { name, phone, address, city },
    items: lineItems,
    subtotal, delivery, total,
    payment: payment === 'card' ? 'Card' : 'M-Pesa on delivery',
    card: cardMeta,
    status: paymentStatus === 'paid-demo' ? 'Paid (demo)' : (paymentStatus === 'gateway' ? 'Paid' : 'Pending M-Pesa'),
    paid: paymentStatus !== 'pending',
    created: new Date().toISOString()
  };
  const orders = loadOrders();
  orders.unshift(order);
  saveOrders(orders);
  res.json({ ok: true, reference: order.id, total, demo: !LIVE_GATEWAY });
});

// ---------- admin ----------
function isAdmin(req) {
  return req.get('x-admin-pass') === ADMIN_PASS;
}
app.get('/api/orders', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Wrong password.' });
  res.json({ orders: loadOrders() });
});
app.patch('/api/orders/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Wrong password.' });
  const { status } = req.body || {};
  if (!['Pending M-Pesa', 'Paid', 'Paid (demo)', 'Delivered', 'Cancelled'].includes(status))
    return res.status(400).json({ error: 'Bad status.' });
  const orders = loadOrders();
  const o = orders.find(o => o.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  o.status = status;
  saveOrders(orders);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log('SimuSoko on', PORT));
