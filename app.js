/* Her Accessori - shared client logic: API, cart, currency, theme, auth */
const API = 'https://superagent-10f85c7a.base44.app/functions';

/* ---------- theme (lavender/white <-> black) ---------- */
function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); localStorage.setItem('hw_theme', t); }
function toggleTheme() {
  const cur = localStorage.getItem('hw_theme') || 'light';
  applyTheme(cur === 'light' ? 'dark' : 'light');
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = (localStorage.getItem('hw_theme') === 'dark') ? '☀️' : '🌙';
}
function initTheme() {
  applyTheme(localStorage.getItem('hw_theme') || 'light');
  const btn = document.getElementById('themeToggle');
  if (btn) { btn.textContent = (localStorage.getItem('hw_theme') === 'dark') ? '☀️' : '🌙'; btn.onclick = toggleTheme; }
}

/* ---------- currency: live rates, cached 1 hour ---------- */
const CURRENCIES = ['USD','KES','EUR','GBP','TZS','UGX','NGN','ZAR','AED','CAD','AUD','INR','JPY','CNY'];
const SYMBOLS = { USD:'$', KES:'KSh ', EUR:'€', GBP:'£', TZS:'TSh ', UGX:'USh ', NGN:'₦', ZAR:'R ', AED:'AED ', CAD:'CA$', AUD:'A$', INR:'₹', JPY:'¥', CNY:'CN¥' };
let RATES = { USD: 1 };
async function loadRates() {
  const cached = JSON.parse(localStorage.getItem('hw_rates') || 'null');
  const fresh = cached && (Date.now() - cached.t < 3600000);
  if (fresh) { RATES = cached.rates; return; }
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const j = await r.json();
    if (j && j.rates) { RATES = j.rates; localStorage.setItem('hw_rates', JSON.stringify({ t: Date.now(), rates: j.rates })); }
  } catch (e) { /* offline: USD only */ }
}
function curCode() { return localStorage.getItem('hw_cur') || 'USD'; }
function fmt(usd) {
  const c = curCode();
  const v = (Number(usd) * (RATES[c] || 1));
  const dec = (c === 'KES' || c === 'TZS' || c === 'UGX' || c === 'JPY') ? 0 : 2;
  return (SYMBOLS[c] || c + ' ') + v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function refreshPrices() {
  document.querySelectorAll('[data-usd]').forEach(el => { el.textContent = fmt(el.dataset.usd); });
}
function initCurrency() {
  const sel = document.getElementById('curSel');
  if (sel) {
    CURRENCIES.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });
    sel.value = curCode();
    sel.onchange = () => { localStorage.setItem('hw_cur', sel.value); refreshPrices(); };
  }
  loadRates().then(refreshPrices);
}

/* ---------- auth ---------- */
function me() { try { return JSON.parse(localStorage.getItem('hw_user')); } catch (e) { return null; } }
function requireLogin() { if (!me()) { location.href = 'login.html'; return false; } return true; }
function logout() { localStorage.removeItem('hw_user'); location.href = 'index.html'; }
function initHeader() {
  const pb = document.getElementById('profileBtn');
  if (pb) pb.onclick = () => { location.href = me() ? 'account.html' : 'login.html'; };
  const cb = document.getElementById('cartBtn');
  if (cb) {
    cb.onclick = () => { location.href = me() ? 'account.html#cart' : 'login.html'; };
    const n = cart().reduce((s, i) => s + i.qty, 0);
    const span = cb.querySelector('.cart-count');
    if (span) span.textContent = n;
  }
}

/* ---------- cart (localStorage) ---------- */
function cart() { try { return JSON.parse(localStorage.getItem('hw_cart')) || []; } catch (e) { return []; } }
function saveCart(c) { localStorage.setItem('hw_cart', JSON.stringify(c)); updateCartBadge(); }
function addToCart(p) {
  const c = cart();
  const found = c.find(i => i.id === p.id);
  if (found) found.qty += 1; else c.push({ id: p.id, name: p.name, priceUSD: p.priceUSD, image: p.image, qty: 1 });
  saveCart(c);
  toast('Added to cart ✓');
}
function updateCartBadge() {
  const cb = document.getElementById('cartBtn');
  if (!cb) return;
  const n = cart().reduce((s, i) => s + i.qty, 0);
  let span = cb.querySelector('.cart-count');
  if (!span) { span = document.createElement('span'); span.className = 'cart-count'; cb.appendChild(span); }
  span.textContent = n;
}

/* ---------- toast ---------- */
function toast(msg) {
  let t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:26px;left:50%;transform:translateX(-50%);background:#8e44ad;color:#fff;padding:11px 22px;border-radius:999px;font-size:14px;z-index:99;box-shadow:0 8px 24px rgba(0,0,0,.25)';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

/* ---------- mobile dropdown menu ---------- */
function initMobileMenu() {
  const btn = document.getElementById('menuBtn');
  const panel = document.getElementById('menuPanel');
  if (!btn || !panel) return;
  const hbtns = document.querySelector('.hbtns');
  const dest = panel.querySelector('.menu-controls');
  btn.onclick = () => {
    const open = panel.classList.toggle('open');
    btn.textContent = open ? '✕' : '☰';
  };
  document.addEventListener('click', e => {
    if (panel.classList.contains('open') && !headerHas(e.target)) { panel.classList.remove('open'); btn.textContent = '☰'; }
  });
  function headerHas(el) { return el && (el.closest && (el.closest('header'))); }
  const mq = window.matchMedia('(max-width: 760px)');
  function place() {
    ['curSel', 'themeToggle'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      (mq.matches && dest ? dest : hbtns).appendChild(el);
    });
    panel.classList.remove('open'); btn.textContent = '☰';
  }
  mq.addEventListener ? mq.addEventListener('change', place) : mq.addListener(place);
  place();
}

/* ---------- boot ---------- */
document.addEventListener('DOMContentLoaded', () => { initTheme(); initCurrency(); initHeader(); initMobileMenu(); });
