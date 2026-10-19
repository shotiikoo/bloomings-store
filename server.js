'use strict';
// Bloomings Store server (no dependencies, Node 18+). Data lives in data/db.json (+ data/uploads for photos).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UP_DIR = path.join(DATA_DIR, 'uploads');
const TZ = process.env.SHOP_TZ || 'Asia/Tbilisi';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (ADMIN_PASSWORD.length < 8) {
  console.error('ERROR: set the ADMIN_PASSWORD environment variable (at least 8 characters).');
  process.exit(1);
}
const SECRET = process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update('bloomings:' + ADMIN_PASSWORD).digest('hex');
fs.mkdirSync(UP_DIR, { recursive: true });
// Secret admin address: set ADMIN_PATH (e.g. "x7k2-your-long-random-text"), otherwise one is generated and printed in the log.
const SLUG_RE = /^[A-Za-z0-9_-]{16,64}$/;
let SLUG = String(process.env.ADMIN_PATH || '').replace(/^\/+|\/+$/g, '');
if (SLUG && !SLUG_RE.test(SLUG)) {
  console.error('ERROR: ADMIN_PATH must be 16-64 characters: letters, digits, - or _ only.');
  process.exit(1);
}

const WRAP_NAMES = ['Pink', 'Yellow', 'Coral', 'Cream', 'Kraft', 'Sage'];
const RIB_NAMES = ['Coral', 'Yellow', 'Brown', 'White'];
const STATUSES = ['new', 'confirmed', 'ready', 'done', 'cancelled'];

/* ---------- helpers ---------- */
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const money = (v, max) => { v = Number(v); if (!isFinite(v) || v < 0) v = 0; return Math.min(Math.round(v * 100) / 100, max || 100000); };
const intIn = (v, lo, hi, d) => { v = Math.floor(Number(v)); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const hexc = v => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : '#FF99A4');
const rid = p => p + '-' + crypto.randomBytes(4).toString('hex');
const okId = v => typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v);
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
const arr = a => (Array.isArray(a) ? a.filter(isObj) : []);

function uniq(list, prefix) {
  const seen = new Set();
  return list.map(x => {
    let id = okId(x.id) ? x.id : rid(prefix);
    while (seen.has(id)) id = rid(prefix);
    seen.add(id); x.id = id; return x;
  });
}

/* ---------- default data (first run) ---------- */
function defaults() {
  const b = (id, n, nk, d, dk, p, cat, catK, k) => ({ id, n, nk, d, dk, p, cat, catK, k, img: '', inStock: true, active: true });
  return {
    settings: { deliveryFee: 8, serviceFee: 6, openHour: 11, closeHour: 23, minStems: 3, maxStems: 100 },
    flowers: [
      { id: 'f-pink-rose', n: 'Pink rose', nk: 'ვარდისფერი ვარდი', p: 5, c: '#FF99A4', kind: 'default', img: '', inStock: true, active: true },
      { id: 'f-yellow-rose', n: 'Yellow rose', nk: 'ყვითელი ვარდი', p: 5, c: '#FFD581', kind: 'default', inStock: true, active: true },
      { id: 'f-coral-rose', n: 'Coral rose', nk: 'მარჯნისფერი ვარდი', p: 5, c: '#FE6F61', kind: 'default', inStock: true, active: true },
      { id: 'f-peony', n: 'Peony', nk: 'პიონი', p: 9, c: '#FFC0CB', kind: 'default', inStock: true, active: true },
      { id: 'f-tulip', n: 'Tulip', nk: 'ტიტა', p: 3.5, c: '#FF8A75', kind: 'default', inStock: true, active: true },
      { id: 'f-gerbera', n: 'Gerbera', nk: 'გერბერა', p: 4, c: '#FFB347', kind: 'gerbera', inStock: true, active: true },
      { id: 'f-daisy', n: 'Daisy', nk: 'გვირილა', p: 2, c: '#FFFFFF', kind: 'daisy', inStock: true, active: true },
      { id: 'f-eucalyptus', n: 'Eucalyptus', nk: 'ევკალიპტი', p: 2, c: '#8FB07A', kind: 'greenery', inStock: true, active: true }
    ],
    styles: [
      { id: 's-cone', n: 'Paper cone', nk: 'ქაღალდის კონუსი', x: 0, shape: 0, active: true },
      { id: 's-box', n: 'Round box', nk: 'მრგვალი ყუთი', x: 10, shape: 1, active: true },
      { id: 's-basket', n: 'Basket', nk: 'კალათა', x: 8, shape: 2, active: true },
      { id: 's-vase', n: 'Glass vase', nk: 'მინის ვაზა', x: 12, shape: 3, active: true }
    ],
    bouquets: [
      b('b1', 'Blush Garden', 'ვარდისფერი ბაღი', '15 pink roses with soft greenery.', '15 ვარდისფერი ვარდი რბილი სიმწვანით.', 85, 'Roses', 'ვარდები', ['#FF99A4', '#FFD581', '#FF99A4']),
      b('b2', 'Sunrise Dozen', 'მზის ამოსვლა', '12 yellow and coral roses, hand tied.', '12 ყვითელი და მარჯნისფერი ვარდი, ხელით შეკრული.', 70, 'Roses', 'ვარდები', ['#FFD581', '#FE6F61', '#FFD581']),
      b('b3', 'Single Rose', 'ერთი ვარდი', 'One long-stem rose in a paper wrap.', 'ერთი გრძელღეროიანი ვარდი ქაღალდის შეფუთვაში.', 12, 'Roses', 'ვარდები', ['#FE6F61']),
      b('b4', 'Peach Meadow', 'ატმისფერი მდელო', 'Mixed seasonal flowers in jasmine and pink.', 'სეზონური შერეული ყვავილები ყვითელ და ვარდისფერ ტონებში.', 60, 'Mixed', 'შერეული', ['#FFD581', '#FF99A4', '#FE6F61', '#FFD581']),
      b('b5', 'Wild Morning', 'ველური დილა', 'Loose field-style bunch, changes with the season.', 'ველის სტილის თავისუფალი თაიგული, სეზონის მიხედვით იცვლება.', 48, 'Mixed', 'შერეული', ['#FF99A4', '#FFD581', '#FE6F61']),
      b('b6', 'Coral Crush', 'მარჯნისფერი ვნება', 'Bold coral blooms with pink accents.', 'თამამი მარჯნისფერი ყვავილები ვარდისფერი აქცენტებით.', 75, 'Mixed', 'შერეული', ['#FE6F61', '#FF99A4', '#FE6F61', '#FFD581']),
      b('b7', 'Thank You Box', 'მადლობის ყუთი', 'Small rose box with a handwritten card.', 'პატარა ყუთი ვარდებით და ხელნაწერი ბარათით.', 55, 'Gifts', 'საჩუქრები', ['#FF99A4', '#FF99A4', '#FFD581']),
      b('b8', 'Birthday Basket', 'დაბადების დღის კალათა', 'Basket of mixed roses, ready to give.', 'შერეული ვარდების კალათა, საჩუქრად მზად.', 95, 'Gifts', 'საჩუქრები', ['#FFD581', '#FF99A4', '#FE6F61', '#FF99A4', '#FFD581'])
    ],
    orders: []
  };
}

/* ---------- catalog validation ---------- */
function normCatalog(c) {
  c = isObj(c) ? c : {};
  const s = isObj(c.settings) ? c.settings : {};
  const settings = {
    deliveryFee: money(s.deliveryFee, 1000),
    serviceFee: money(s.serviceFee, 1000),
    openHour: intIn(s.openHour, 0, 23, 11),
    closeHour: intIn(s.closeHour, 1, 24, 23),
    minStems: intIn(s.minStems, 1, 100, 3),
    maxStems: intIn(s.maxStems, 1, 500, 100)
  };
  if (settings.closeHour <= settings.openHour) settings.closeHour = Math.min(24, settings.openHour + 1);
  if (settings.maxStems < settings.minStems) settings.maxStems = settings.minStems;

  const flowers = uniq(arr(c.flowers).slice(0, 100).map(f => ({
    id: f.id, n: clean(f.n, 60) || 'Flower', nk: clean(f.nk, 60), p: money(f.p, 10000), c: hexc(f.c),
    kind: ['default', 'daisy', 'gerbera', 'greenery'].includes(f.kind) ? f.kind : 'default',
    img: typeof f.img === 'string' && /^\/uploads\/[a-z0-9-]+\.(jpg|png|webp)$/.test(f.img) ? f.img : '',
    inStock: f.inStock !== false, active: f.active !== false
  })), 'f');
  const styles = uniq(arr(c.styles).slice(0, 20).map(x => ({
    id: x.id, n: clean(x.n, 60) || 'Wrapping', nk: clean(x.nk, 60), x: money(x.x, 1000),
    shape: intIn(x.shape, 0, 3, 0), active: x.active !== false
  })), 's');
  const bouquets = uniq(arr(c.bouquets).slice(0, 300).map(q => ({
    id: q.id, n: clean(q.n, 80) || 'Bouquet', nk: clean(q.nk, 80),
    d: clean(q.d, 240), dk: clean(q.dk, 240), p: money(q.p, 100000),
    cat: clean(q.cat, 40) || 'Bouquets', catK: clean(q.catK, 40),
    k: (Array.isArray(q.k) ? q.k : []).slice(0, 6).map(hexc),
    img: typeof q.img === 'string' && /^\/uploads\/[a-z0-9-]+\.(jpg|png|webp)$/.test(q.img) ? q.img : '',
    inStock: q.inStock !== false, active: q.active !== false
  })).map(q => { if (!q.k.length) q.k = ['#FF99A4']; return q; }), 'b');
  return { settings, flowers, styles, bouquets };
}
const publicCatalog = db => ({
  settings: db.settings,
  flowers: db.flowers.filter(x => x.active),
  styles: db.styles.filter(x => x.active),
  bouquets: db.bouquets.filter(x => x.active)
});

/* ---------- storage ---------- */
let db;
function load() {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) { db = defaults(); save(); }
  const old = db, n = normCatalog(old);
  db = Object.assign(n, { orders: Array.isArray(old.orders) ? old.orders : [], adminSlug: SLUG_RE.test(old.adminSlug || '') ? old.adminSlug : '' });
}
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
}
function cleanUploads() {
  const used = new Set(db.bouquets.concat(db.flowers).map(b => b.img).filter(Boolean).map(u => path.basename(u)));
  for (const f of fs.readdirSync(UP_DIR)) {
    if (/^[a-z0-9-]+\.(jpg|png|webp)$/.test(f) && !used.has(f)) { try { fs.unlinkSync(path.join(UP_DIR, f)); } catch (e) {} }
  }
}
load();
if (!SLUG) {
  if (!db.adminSlug) { db.adminSlug = 'a' + crypto.randomBytes(12).toString('hex'); save(); }
  SLUG = db.adminSlug;
}
console.log('Admin page: /' + SLUG);

/* ---------- auth ---------- */
const sign = exp => crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex');
const cookieOf = req => {
  const o = {};
  String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) { try { o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) {} } });
  return o;
};
function authed(req) {
  const t = cookieOf(req).bl_admin; if (!t) return false;
  const [exp, sig] = t.split('.'); if (!exp || !sig || !(+exp > Date.now())) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sameStr = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

const hits = new Map();
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.r < n) hits.delete(k); }, 60000).unref();
function hit(key, max, windowMs) {
  const now = Date.now(); let e = hits.get(key);
  if (!e || e.r < now) { e = { n: 0, r: now + windowMs }; hits.set(key, e); }
  e.n++; return e.n <= max;
}

/* ---------- orders ---------- */
function nowParts() {
  const o = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
    .formatToParts(new Date()).forEach(x => { o[x.type] = x.value; });
  return { date: `${o.year}-${o.month}-${o.day}`, hour: (+o.hour) % 24 };
}
const fail = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };

function buildOrder(body) {
  if (!isObj(body)) throw fail('bad');
  const S = db.settings;
  const name = clean(body.name, 80), phone = clean(body.phone, 30);
  if (!name) throw fail('name');
  if (!/^[0-9+()\-\s]{7,30}$/.test(phone) || phone.replace(/\D/g, '').length < 7) throw fail('phone');
  const mode = body.mode === 'delivery' ? 'delivery' : 'pickup';
  const address = clean(body.address, 200);
  if (mode === 'delivery' && address.length < 5) throw fail('address');
  const date = clean(body.date, 10), time = clean(body.time, 5);
  const now = nowParts();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date + 'T00:00:00Z'))) throw fail('date');
  const days = (Date.parse(date + 'T00:00:00Z') - Date.parse(now.date + 'T00:00:00Z')) / 864e5;
  if (days < 0 || days > 60) throw fail('date');
  const m = /^(\d{1,2}):00$/.exec(time); const hour = m ? +m[1] : -1;
  if (hour < S.openHour || hour >= S.closeHour) throw fail('time');
  if (days === 0 && hour <= now.hour) throw fail('time');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 30) throw fail('items');

  const items = []; let sub = 0;
  for (const it of body.items) {
    if (!isObj(it)) throw fail('items');
    const qty = intIn(it.qty, 1, 50, 0); if (!qty) throw fail('items');
    if (it.type === 'b') {
      const b = db.bouquets.find(x => x.id === it.id && x.active);
      if (!b) throw fail('gone', it.id);
      if (!b.inStock) throw fail('soldout', b.n);
      items.push({ name: b.n, detail: '', qty, unit: b.p }); sub += b.p * qty;
    } else if (it.type === 'c') {
      const fl = isObj(it.flowers) ? it.flowers : {}; let stems = 0, cost = 0; const parts = [];
      for (const id of Object.keys(fl)) {
        const q = intIn(fl[id], 0, 500, 0); if (!q) continue;
        const f = db.flowers.find(x => x.id === id && x.active);
        if (!f) throw fail('gone', id);
        if (!f.inStock) throw fail('soldout', f.n);
        stems += q; cost += q * f.p; parts.push(`${f.n} ×${q}`);
      }
      if (stems < S.minStems || stems > S.maxStems) throw fail('stems');
      const st = db.styles.find(x => x.id === it.style && x.active);
      if (!st) throw fail('gone', it.style);
      const wi = intIn(it.wrap, 0, WRAP_NAMES.length - 1, 0), ri = intIn(it.rib, 0, RIB_NAMES.length - 1, 0);
      const note = clean(it.note, 60);
      const unit = Math.round((cost + S.serviceFee + st.x) * 100) / 100;
      items.push({
        name: `Custom bouquet (${stems} stems)`,
        detail: `${parts.join(', ')} | ${st.n}, ${WRAP_NAMES[wi]} | Ribbon: ${RIB_NAMES[ri]}` + (note ? ` | Card: "${note}"` : ''),
        qty, unit
      });
      sub += unit * qty;
    } else throw fail('items');
  }
  const fee = mode === 'delivery' ? S.deliveryFee : 0;
  const total = Math.round((sub + fee) * 100) / 100;
  let no; do { no = 'BL-' + (1000 + crypto.randomInt(9000)); } while (db.orders.some(o => o.no === no));
  return { no, createdAt: new Date().toISOString(), status: 'new', name, phone, mode, address: mode === 'delivery' ? address : '', date, time, items, deliveryFee: fee, total };
}

/* ---------- http ---------- */
const HOPS = Math.max(0, parseInt(process.env.TRUST_PROXY_HOPS || '1', 10));
function clientIp(req) {
  const xs = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
  return (HOPS && xs.length >= 1 ? xs[Math.max(0, xs.length - HOPS)] : '') || req.socket.remoteAddress || 'x';
}
const isHttps = req => !!req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((ok, bad) => {
    let n = 0, big = false; const ch = [];
    req.on('data', c => { n += c.length; if (n > limit) big = true; else ch.push(c); });
    req.on('end', () => (big ? bad(Object.assign(new Error('size'), { code: 'size' })) : ok(Buffer.concat(ch))));
    req.on('error', bad);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
function serveFile(req, res, baseDir, rel, cache) {
  const parts = rel.split('/').filter(Boolean);
  if (parts.some(p => p.startsWith('.') || p.includes('\0'))) return notFound(res);
  let f = path.resolve(baseDir, ...parts);
  if (f !== baseDir && !f.startsWith(baseDir + path.sep)) return notFound(res);
  fs.stat(f, (e, st) => {
    if (!e && st.isDirectory()) { f = path.join(f, 'index.html'); return fs.stat(f, (e2, st2) => (e2 ? notFound(res) : pipeFile(req, res, f, st2, cache))); }
    if (e || !st.isFile()) return notFound(res);
    pipeFile(req, res, f, st, cache);
  });
}
function pipeFile(req, res, f, st, cache) {
  const h = { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache || 'no-cache' };
  res.writeHead(200, h);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(f).on('error', () => res.destroy()).pipe(res);
}
function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found');
}

async function api(req, res, p) {
  const ip = clientIp(req), M = req.method;
  res.setHeader('Cache-Control', 'no-store');
  let body = {};
  if (M !== 'GET' && M !== 'HEAD') {
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'json' });
    const raw = await readBody(req, p === '/api/admin/upload' ? 3 * 1024 * 1024 : 200 * 1024);
    if (raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch (e) { return send(res, 400, { error: 'bad' }); } }
  }
  const admin = authed(req);
  if (p.startsWith('/api/admin/')) {
    // the admin API does not even exist for anyone who does not know the secret address
    const k = String(req.headers['x-admin-key'] || '');
    if (!sameStr(k, SLUG)) return send(res, 404, { error: 'none' });
  }

  if (M === 'GET' && p === '/api/catalog') return send(res, 200, publicCatalog(db));

  if (M === 'POST' && p === '/api/orders') {
    if (!hit('ord:' + ip, 10, 3600e3)) return send(res, 429, { error: 'rate' });
    if (db.orders.length >= 5000) return send(res, 503, { error: 'full' });
    try {
      const o = buildOrder(body); db.orders.unshift(o); save();
      return send(res, 200, { no: o.no, total: o.total });
    } catch (e) {
      if (!e.code) { console.error(e); return send(res, 500, { error: 'server' }); }
      return send(res, 400, { error: e.code, detail: e.code === 'soldout' ? e.message : undefined });
    }
  }

  if (M === 'POST' && p === '/api/admin/login') {
    const key = 'login:' + ip, e = hits.get(key);
    if (e && e.r > Date.now() && e.n >= 8) return send(res, 429, { error: 'rate' });
    if (isObj(body) && typeof body.password === 'string' && sameStr(body.password, ADMIN_PASSWORD)) {
      hits.delete(key);
      const exp = Date.now() + 12 * 3600e3;
      res.setHeader('Set-Cookie', `bl_admin=${exp}.${sign(exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}` + (isHttps(req) ? '; Secure' : ''));
      return send(res, 200, { ok: true });
    }
    hit(key, 8, 15 * 60e3);
    return send(res, 401, { error: 'password' });
  }
  if (M === 'POST' && p === '/api/admin/logout') {
    res.setHeader('Set-Cookie', 'bl_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return send(res, 200, { ok: true });
  }
  if (M === 'GET' && p === '/api/admin/me') return send(res, 200, { admin: admin });

  if (p.startsWith('/api/admin/')) {
    if (!admin) return send(res, 401, { error: 'auth' });
    if (M === 'GET' && p === '/api/admin/catalog') {
      const { settings, flowers, styles, bouquets } = db; return send(res, 200, { settings, flowers, styles, bouquets });
    }
    if (M === 'PUT' && p === '/api/admin/catalog') {
      const c = normCatalog(body);
      db.settings = c.settings; db.flowers = c.flowers; db.styles = c.styles; db.bouquets = c.bouquets;
      save(); cleanUploads(); return send(res, 200, c);
    }
    if (M === 'POST' && p === '/api/admin/upload') {
      const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(isObj(body) && typeof body.data === 'string' ? body.data : '');
      if (!m) return send(res, 400, { error: 'format' });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 1.5 * 1024 * 1024) return send(res, 413, { error: 'size' });
      const ok = (m[1] === 'jpeg' && buf[0] === 0xff && buf[1] === 0xd8) ||
        (m[1] === 'png' && buf.slice(1, 4).toString() === 'PNG') ||
        (m[1] === 'webp' && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP');
      if (!ok) return send(res, 400, { error: 'format' });
      const file = rid('img') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
      fs.writeFileSync(path.join(UP_DIR, file), buf);
      return send(res, 200, { url: '/uploads/' + file });
    }
    if (M === 'GET' && p === '/api/admin/orders') return send(res, 200, db.orders);
    const om = /^\/api\/admin\/orders\/(BL-\d{4,8})$/.exec(p);
    if (om && M === 'PATCH') {
      const o = db.orders.find(x => x.no === om[1]); if (!o) return send(res, 404, { error: 'none' });
      if (!isObj(body) || !STATUSES.includes(body.status)) return send(res, 400, { error: 'status' });
      o.status = body.status; save(); return send(res, 200, o);
    }
    if (om && M === 'DELETE') {
      const i = db.orders.findIndex(x => x.no === om[1]); if (i < 0) return send(res, 404, { error: 'none' });
      db.orders.splice(i, 1); save(); return send(res, 200, { ok: true });
    }
  }
  return send(res, 404, { error: 'none' });
}

async function handle(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { return notFound(res); }
  if (p === '/api' || p.startsWith('/api/')) return api(req, res, p);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  if (p === '/' + SLUG || p === '/' + SLUG + '/') {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return serveFile(req, res, path.join(__dirname, 'views'), 'admin.html', 'no-store');
  }
  const origin = () => {
    if (process.env.SITE_URL && /^https?:\/\/[a-z0-9.:-]+$/i.test(process.env.SITE_URL)) return process.env.SITE_URL;
    const host = String(req.headers.host || '').toLowerCase();
    const proto = HOPS > 0 && /^https$/i.test(String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()) ? 'https' : 'http';
    return /^[a-z0-9.-]+(:\d+)?$/.test(host) ? proto + '://' + host : '';
  };
  if (p === '/robots.txt') { const o = origin(); res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }); return res.end('User-agent: *\nAllow: /\nDisallow: /api/\n' + (o ? 'Sitemap: ' + o + '/sitemap.xml\n' : '')); }
  if (p === '/sitemap.xml') { const o = origin(); res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }); return res.end('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' + o + '/</loc></url></urlset>'); }
  if (p === '/' || p === '/index.html') {
    return fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8', (e, t) => {
      if (e) return notFound(res);
      const body = Buffer.from(t.split('__ORIGIN__').join(origin()));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  }
  if (p.startsWith('/uploads/')) return serveFile(req, res, UP_DIR, p.slice(9), 'public, max-age=604800, immutable');
  return serveFile(req, res, path.join(__dirname, 'public'), p, 'no-cache');
}

http.createServer((req, res) => {
  handle(req, res).catch(e => {
    if (res.headersSent) return res.destroy();
    if (e && e.code === 'size') return send(res, 413, { error: 'size' });
    console.error(e); send(res, 500, { error: 'server' });
  });
}).listen(PORT, () => console.log('Bloomings Store running on port ' + PORT));
