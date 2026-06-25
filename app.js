const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const store = require("./db");
const slipok = require("./slipok");
const { middleware, messagingApi } = require("@line/bot-sdk");
const NODE_ENV = (process.env.NODE_ENV || "production").trim();
const envFile = NODE_ENV === "development" ? ".env.development" : ".env";
require("dotenv").config({ path: envFile });
console.log(`[ENV] Running in ${NODE_ENV} mode (loaded ${envFile})`);

const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
const ADMIN_ID = process.env.ADMIN_USER_ID;
// ปลายทางแจ้งเตือน: กลุ่ม LINE ถ้าตั้งไว้ ไม่งั้นส่งหาเจ้าของคนเดียว (ADMIN_ID ยังใช้เช็คสิทธิ์ปุ่ม postback)
const ALERT_TARGET = process.env.ALERT_GROUP_ID || process.env.ADMIN_USER_ID;
function getBaseUrl() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, envFile), "utf8");
    const m = raw.match(/^BASE_URL=(.+)$/m);
    return m ? m[1].trim() : process.env.BASE_URL;
  } catch { return process.env.BASE_URL; }
}

// จุดจัดส่งในร้าน (ตรงกับ LOCATIONS ใน public/order.html)
const DELIVERY_LOCATIONS = [
  "ห้องซ้อมเล็ก",
  "ห้องซ้อมใหญ่",
  "ห้องสตูดิโอ",
  "ลานนั่งหน้ามินิบาร์",
];

// เวลาเปิด-ปิดแต่ละหมวด (ชั่วโมง, 24h)
// TODO: เปลี่ยนกลับหลังทดสอบ → food: 16-24, drinks: 10-24
const BUSINESS_HOURS = {
  food:   { open: 0, close: 24, label: "00:00 - 23:59" },
  drinks: { open: 0, close: 24, label: "00:00 - 23:59" },
};

// แอดมินกดปิด/เปิดครัว-กาแฟ manual (null = ใช้เวลาปกติ, false = บังคับปิด)
const manualOverride = { food: null, drinks: null };

function isSectionOpen(section) {
  if (manualOverride[section] === false) return false;
  const hour = new Date().getHours();
  const h = BUSINESS_HOURS[section];
  return h && hour >= h.open && hour < h.close;
}

function itemSection(itemId) {
  return Number(itemId) <= 19 ? "food" : "drinks";
}

// บรรทัดข้อมูลจัดส่ง/ลูกค้า สำหรับแสดงให้แอดมิน
function deliveryText(order) {
  const d = order && order.delivery;
  if (!d) return "";
  return `📍 ${d.location}\n👤 ${d.name}  📞 ${d.phone}`;
}

const SLIP_DIR = path.join(__dirname, "images", "slips");

// ย่อ+บีบอัดรูปสลิป แล้วเขียนแบบ async (sharp ทำงานบน threadpool — ไม่บล็อก event loop)
// คืนค่าชื่อไฟล์ที่บันทึก
async function saveSlipImage(buffer, orderId, slipToken) {
  await fs.promises.mkdir(SLIP_DIR, { recursive: true });
  const slipFile = `${orderId}-${slipToken.slice(0, 10)}.jpg`;
  await sharp(buffer)
    .rotate() // หมุนตาม EXIF ให้ตั้งตรง
    .resize({ width: 1500, height: 1500, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(path.join(SLIP_DIR, slipFile));
  return slipFile;
}

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});
const blobClient = new messagingApi.MessagingApiBlobClient({
  channelAccessToken: config.channelAccessToken,
});

// ==================== Data ====================

const ADDONS = [
  { id: "spoon", label: "ช้อนส้อม" },
  { id: "chili", label: "พริกน้ำปลา" },
  { id: "sauce", label: "ซอส" },
];

// add-on เฉพาะเมนูกาแฟ (ต้องตรงกับ COFFEE_ADDONS ใน public/order.html)
const COFFEE_ADDON_PRICES = { "น้ำผึ้ง": 10, "คาราเมลไซรัป": 10, "นมโอ๊ต": 20, "เพิ่มช็อต": 20 };
// add-on เฉพาะเมนูนม (ต้องตรงกับ MILK_ADDONS ใน public/order.html)
const MILK_ADDON_PRICES = { "น้ำผึ้ง": 10, "คาราเมลไซรัป": 10 };

// ⚠️ ราคาเมนู — ต้องตรงกับ MENU/ADDONS ใน public/order.html เสมอ
// ใช้คิดยอดรวมฝั่ง server ไม่เชื่อราคาที่เว็บส่งมา (กันลูกค้าแก้ราคา)
const MENU_PRICES = {
  1:  { price: { default: 50 }, addons: { หมูสับ: 10, พิเศษ: 20 } },
  3:  { price: { หมู: 70, เนื้อ: 80 } },
  4:  { price: { หมู: 70, เนื้อ: 80 } },
  5:  { price: { หมู: 70, เนื้อ: 80 } },
  6:  { price: { หมู: 70, เนื้อ: 80 } },
  7:  { price: { หมู: 70, เนื้อ: 80 } },
  8:  { price: { หมู: 70, เนื้อ: 80 } },
  9:  { price: { หมู: 80, เนื้อ: 90 } },
  10: { price: { หมู: 80, เนื้อ: 90 } },
  11: { price: { หมู: 80, เนื้อ: 90 } },
  12: { price: { หมู: 90, เนื้อ: 100 } },
  13: { price: { หมู: 90, เนื้อ: 100 } },
  14: { price: { default: 90 } },
  15: { price: { หมู: 90, เนื้อ: 100 } },
  // ☕ กาแฟ — variant = เมล็ด (คั่วอ่อน/คั่วเข้ม) ราคาเท่ากัน + add-on เฉพาะกาแฟ
  20: { price: { "คั่วอ่อน": 70, "คั่วเข้ม": 70 }, addons: COFFEE_ADDON_PRICES },
  21: { price: { "คั่วอ่อน": 70, "คั่วเข้ม": 70 }, addons: COFFEE_ADDON_PRICES },
  22: { price: { "คั่วอ่อน": 70, "คั่วเข้ม": 70 }, addons: COFFEE_ADDON_PRICES },
  23: { price: { "คั่วอ่อน": 70, "คั่วเข้ม": 70 }, addons: COFFEE_ADDON_PRICES },
  24: { price: { "คั่วอ่อน": 80, "คั่วเข้ม": 80 }, addons: COFFEE_ADDON_PRICES },
  // 🥛 นม — add-on น้ำผึ้ง/คาราเมลไซรัป (ความหวาน/โน้ตไม่กระทบราคา)
  30: { price: { default: 70 }, addons: MILK_ADDON_PRICES },
  31: { price: { default: 70 }, addons: MILK_ADDON_PRICES },
  32: { price: { default: 70 }, addons: MILK_ADDON_PRICES },
  33: { price: { default: 70 }, addons: MILK_ADDON_PRICES },
  34: { price: { default: 70 }, addons: MILK_ADDON_PRICES },
  35: { price: { default: 70 }, addons: MILK_ADDON_PRICES },
  // 🥤 Italian Soda — ราคาเดียว ไม่มี add-on (addons: {} → ปฏิเสธ add-on ทุกชนิด)
  40: { price: { default: 70 }, addons: {} },
  41: { price: { default: 70 }, addons: {} },
  42: { price: { default: 70 }, addons: {} },
  43: { price: { default: 70 }, addons: {} },
  44: { price: { default: 70 }, addons: {} },
  45: { price: { default: 70 }, addons: {} },
  46: { price: { default: 70 }, addons: {} },
  47: { price: { default: 70 }, addons: {} },
  48: { price: { default: 70 }, addons: {} },
};
const DEFAULT_ADDON_PRICES = { ไข่ดาว: 15, ไข่เจียว: 20, พิเศษ: 20 };

// key รูปแบบ "3-หมู:พิเศษ,ไข่ดาว" → { id:3, meat:"หมู", addons:["พิเศษ","ไข่ดาว"] }
function parseCartKey(key) {
  let addons = [], rest = String(key);
  const ci = rest.indexOf(":");
  if (ci !== -1) { addons = rest.slice(ci + 1).split(","); rest = rest.slice(0, ci); }
  let id, meat = null;
  const di = rest.indexOf("-");
  if (di !== -1) { id = +rest.slice(0, di); meat = rest.slice(di + 1); }
  else { id = +rest; }
  return { id, meat, addons };
}

function calcUnitPrice(key) {
  const { id, meat, addons } = parseCartKey(key);
  const m = MENU_PRICES[id];
  if (!m) return null;
  let p = meat ? m.price[meat] : m.price.default;
  if (p == null) return null;
  const addonPrices = m.addons || DEFAULT_ADDON_PRICES;
  for (const a of addons) {
    if (addonPrices[a] == null) return null;
    p += addonPrices[a];
  }
  return p;
}

// คิดยอดรวมจาก key+qty ของแต่ละรายการ; คืน null ถ้าข้อมูลผิด
function computeOrderTotal(items) {
  let total = 0;
  for (const it of items) {
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty < 1) return null;
    const up = calcUnitPrice(it.key);
    if (up == null) return null;
    total += up * qty;
  }
  return total;
}

// ==================== Session, Orders, Tokens ====================

const sessions = new Map();
const pendingOrders = new Map();
const orderTokens = new Map();

// โหลดออเดอร์ที่ยังค้าง + session กลับเข้าหน่วยความจำตอน boot (กันข้อมูลหายเมื่อ restart)
for (const [orderId, order] of store.loadActiveOrders()) pendingOrders.set(orderId, order);
for (const [userId, session] of store.loadSessions()) sessions.set(userId, session);
console.log(`[DB] loaded ${pendingOrders.size} active order(s), ${sessions.size} session(s)`);

// คงค่า orderCounter ข้ามการ restart (กัน orderId ซ้ำ → สลิป/ยอดเงินไม่สลับกัน)
// แยกไฟล์ตาม NODE_ENV เพื่อไม่ให้ dev/prod ใช้เลขเดียวกัน
const COUNTER_FILE = path.join(__dirname, "data", `counter.${NODE_ENV}.json`);
function loadCounter() {
  try {
    const n = JSON.parse(fs.readFileSync(COUNTER_FILE, "utf8")).orderCounter;
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}
function saveCounter() {
  try {
    const dir = path.dirname(COUNTER_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COUNTER_FILE, JSON.stringify({ orderCounter }));
  } catch (e) {
    console.error("saveCounter error:", e.message);
  }
}
let orderCounter = loadCounter();
console.log(`[ORDER] starting orderCounter at ${orderCounter}`);

const TOKEN_TTL = 30 * 60 * 1000;

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { state: "idle", orderId: null });
  }
  return sessions.get(userId);
}

function createToken(userId) {
  const token = crypto.randomBytes(16).toString("hex");
  orderTokens.set(token, { userId, createdAt: Date.now() });
  return token;
}

setInterval(() => {
  const now = Date.now();
  for (const [token, data] of orderTokens) {
    if (now - data.createdAt > TOKEN_TTL) orderTokens.delete(token);
  }
}, 5 * 60 * 1000);

// ==================== Order Status ====================

const ORDER_STATUSES = ["received", "preparing", "delivering", "delivered"];
const ORDER_STATUS_LABELS = {
  none:       { th: "รอชำระเงิน", en: "Awaiting payment" },
  received:   { th: "รับออเดอร์แล้ว", en: "Order received" },
  preparing:  { th: "กำลังเตรียม", en: "Preparing" },
  delivering: { th: "กำลังจัดส่ง", en: "Delivering" },
  delivered:  { th: "จัดส่งแล้ว", en: "Delivered" },
};
const ORDER_STATUS_EMOJI = { received: "📋", preparing: "👨‍🍳", delivering: "🛵", delivered: "✅" };

// ==================== Admin Token ====================
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(16).toString("hex");
if (!process.env.ADMIN_TOKEN) console.log(`[ADMIN] generated token: ${ADMIN_TOKEN}`);

// PIN คงที่จาก env ให้พนักงาน login (เว้นว่าง = ปิด PIN, ใช้ token อย่างเดียว)
const ADMIN_PIN = (process.env.ADMIN_PIN || "").trim();
if (ADMIN_PIN) console.log(`[ADMIN] PIN login enabled`);

// ==================== Rate Limiter ====================

function createLimiter(windowMs, max) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || now > h.reset) {
      h = { count: 0, reset: now + windowMs };
      hits.set(key, h);
    }
    if (++h.count > max) {
      return res.status(429).json({ error: "คำขอมากเกินไป กรุณารอสักครู่" });
    }
    next();
  };
}

const apiLimiter = createLimiter(60_000, 60);
const slipLimiter = createLimiter(60_000, 10);

// ==================== Express ====================

const app = express();

app.use("/images", express.static(path.join(__dirname, "images")));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/", apiLimiter);

app.get("/", (_req, res) => res.send("MGR LINE Chatbot is running!"));
app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

if (NODE_ENV === "development") {
  app.get("/api/test-token", (req, res) => {
    const uid = req.query.uid || "TEST_USER";
    const token = createToken(uid);
    res.json({ token, url: `/order.html?t=${token}` });
  });
  app.get("/api/test-orders", (_req, res) => {
    const orders = [];
    for (const [orderId, o] of pendingOrders) {
      orders.push({ orderId, userId: o.userId, total: o.total, state: o.state });
    }
    res.json({ count: orders.length, orderCounter, orders });
  });
}

// ==================== Admin API ====================

function requireAdmin(req, res, next) {
  const t = req.query.token || req.headers["x-admin-token"];
  if (t !== ADMIN_TOKEN && !(ADMIN_PIN && t === ADMIN_PIN)) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ดึงออเดอร์ทั้งหมด (admin dashboard)
app.get("/api/admin/orders", requireAdmin, (_req, res) => {
  const all = store.loadAllOrders(200);
  const orders = all.map(([orderId, o]) => ({
    orderId,
    total: o.total,
    state: o.state,
    orderStatus: o.orderStatus || "none",
    statusEta: o.statusEta || 0,
    statusAt: o.statusAt || 0,
    summary: o.summary,
    delivery: o.delivery,
    createdAt: o.createdAt,
    slipUrl: o.slipUrl,
  }));
  res.json({ orders, adminToken: ADMIN_TOKEN });
});

// อัปเดตสถานะออเดอร์ (admin)
app.post("/api/admin/status", requireAdmin, express.json(), async (req, res) => {
  const { orderId, status, eta } = req.body;
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });

  const order = pendingOrders.get(orderId);
  if (!order) return res.status(404).json({ error: "Order not found" });

  order.orderStatus = status;
  order.statusEta = eta || 0;
  order.statusAt = Date.now();
  store.saveOrder(orderId, order);

  if (status === "delivered") {
    pendingOrders.delete(orderId);
    const cs = getSession(order.userId);
    cs.state = "idle";
    cs.orderId = null;
    store.saveSession(order.userId, cs);
  }

  res.json({ success: true });

  if (order.userId.startsWith("TEST")) return;

  const emoji = ORDER_STATUS_EMOJI[status] || "📋";
  const label = ORDER_STATUS_LABELS[status]?.th || status;
  let text = `${emoji} ออเดอร์ #${orderId}\nสถานะ: ${label}`;
  if (eta && status !== "delivered") text += `\n⏱ ประมาณ ${eta} นาที`;
  if (status === "delivered") text += "\n\nขอบคุณที่ใช้บริการครับ 🙏";

  client.pushMessage({ to: order.userId, messages: [{ type: "text", text }] }).catch(e => console.error("Status push error:", e.message));
});

// ยืนยันการชำระเงินจากแดชบอร์ด (พนักงานกดเอง) — mirror ของปุ่ม admin_confirm ใน LINE
app.post("/api/admin/confirm", requireAdmin, express.json(), (req, res) => {
  const { orderId } = req.body;
  const order = pendingOrders.get(orderId);
  if (!order) return res.status(404).json({ error: "ไม่พบออเดอร์" });
  if (order.state === "confirmed") return res.status(409).json({ error: "ยืนยันไปแล้ว" });
  if (order.state !== "slip_sent") return res.status(400).json({ error: "ยังไม่มีสลิป — รอลูกค้าส่งก่อน" });
  setConfirmed(orderId, order);
  res.json({ success: true });
  if (!order.userId.startsWith("TEST")) notifyCustomerConfirmed(orderId, order);
});

// admin token (dev only — ให้เปิดหน้า admin ได้)
app.get("/api/admin/token", (_req, res) => {
  if (NODE_ENV !== "development") return res.status(403).json({ error: "Dev only" });
  res.json({ token: ADMIN_TOKEN });
});

// ==================== Admin Menu API ====================

app.get("/api/admin/menu", requireAdmin, (_req, res) => {
  res.json({ items: store.loadMenuItems() });
});

app.post("/api/admin/menu", requireAdmin, express.json(), (req, res) => {
  const item = req.body;
  if (!item.id || !item.cat || !item.nameTh) return res.status(400).json({ error: "Missing fields" });
  store.saveMenuItem(item);
  reloadMenuFromDb();
  res.json({ success: true });
});

app.delete("/api/admin/menu/:id", requireAdmin, (req, res) => {
  store.deleteMenuItem(+req.params.id);
  reloadMenuFromDb();
  res.json({ success: true });
});

// ==================== Admin Shop Status (ปิด/เปิดครัว-กาแฟ) ====================

app.get("/api/admin/shop-status", requireAdmin, (_req, res) => {
  res.json({
    food:   { open: isSectionOpen("food"),   manualClosed: manualOverride.food === false },
    drinks: { open: isSectionOpen("drinks"), manualClosed: manualOverride.drinks === false },
  });
});

app.post("/api/admin/shop-status", requireAdmin, express.json(), (req, res) => {
  const { section, closed } = req.body;
  if (section !== "food" && section !== "drinks") return res.status(400).json({ error: "Invalid section" });
  manualOverride[section] = closed ? false : null;
  const label = section === "food" ? "ครัว" : "เครื่องดื่ม/กาแฟ";
  console.log(`[ADMIN] ${label} ${closed ? "ปิด" : "เปิด"} (manual override)`);
  res.json({ success: true, section, closed: !!closed });
});

app.get("/api/env", (_req, res) => {
  res.json({ dev: process.env.NODE_ENV === "development" });
});

// DEV-only: สร้าง test order โดยไม่ต้องผ่าน LINE
if (process.env.NODE_ENV === "development") {
  app.post("/api/dev/test-order", express.json(), (req, res) => {
    orderCounter++;
    saveCounter();
    const orderId = `MGR${String(orderCounter).padStart(4, "0")}`;
    const slipToken = crypto.randomBytes(16).toString("hex");
    const newOrder = {
      userId: "TEST-DEV",
      items: [{ name: "Test Item", qty: 1, price: 50 }],
      summary: "1. Test Item = 50.-",
      total: 50,
      delivery: { location: DELIVERY_LOCATIONS[0], name: "Tester", phone: "0999999999" },
      state: "await_slip",
      slipToken,
      createdAt: Date.now(),
      orderStatus: "none",
      statusEta: 0,
      statusAt: 0,
    };
    pendingOrders.set(orderId, newOrder);
    store.saveOrder(orderId, newOrder);
    res.json({ orderId, slipToken, url: `/order.html?oid=${orderId}&s=${slipToken}` });
  });
}

// Public menu API (order.html ใช้)
app.get("/api/menu", (_req, res) => {
  const items = store.loadMenuItems();
  const closed = {
    food: !isSectionOpen("food"),
    drinks: !isSectionOpen("drinks"),
  };
  if (items.length === 0) {
    res.json({ items: [], source: "hardcoded", closed });
  } else {
    res.json({ items, source: "db", closed });
  }
});

// ==================== Menu from DB ====================

function reloadMenuFromDb() {
  const items = store.loadMenuItems();
  if (items.length === 0) return;
  // rebuild MENU_PRICES from DB
  for (const key of Object.keys(MENU_PRICES)) delete MENU_PRICES[key];
  for (const item of items) {
    if (!item.enabled) continue;
    const addonMap = {};
    for (const a of item.addons) addonMap[a.id || a.name] = a.price;
    MENU_PRICES[item.id] = { price: item.price, addons: addonMap };
  }
}
reloadMenuFromDb();

// ==================== API: Order Status (public — customer) ====================

app.get("/api/order-tracking", (req, res) => {
  const { oid, s } = req.query;
  const order = pendingOrders.get(oid);
  // also check completed orders in DB
  if (!order) {
    const all = store.loadAllOrders(500);
    const found = all.find(([id]) => id === oid);
    if (found && found[1].slipToken === s) {
      const o = found[1];
      return res.json({ orderId: oid, orderStatus: o.orderStatus || "none", statusEta: o.statusEta || 0, statusAt: o.statusAt || 0, state: o.state });
    }
    return res.status(404).json({ error: "Not found" });
  }
  if (!s || order.slipToken !== s) return res.status(401).json({ error: "Invalid token" });
  res.json({ orderId: oid, orderStatus: order.orderStatus || "none", statusEta: order.statusEta || 0, statusAt: order.statusAt || 0, state: order.state });
});

// ==================== API: ดึงข้อมูลลูกค้าเดิม (remember customer) ====================

app.get("/api/customer", (req, res) => {
  const token = req.query.t;
  if (!token) return res.json({ found: false });
  const tokenData = orderTokens.get(token);
  if (!tokenData) return res.json({ found: false });
  const c = store.getCustomer(tokenData.userId);
  if (!c) return res.json({ found: false });
  res.json({ found: true, name: c.name, phone: c.phone });
});

// ==================== API: รับออเดอร์จากเว็บ ====================

app.post("/api/order", express.json(), async (req, res) => {
  try {
    const { token, items, addons, delivery } = req.body;
    const clientTotal = req.body.total;

    // ตรวจจุดจัดส่ง + ชื่อ/เบอร์ (ไม่เชื่อค่าจากเว็บล้วนๆ — validate ฝั่ง server)
    const d = delivery || {};
    const dLoc = (d.location || "").toString().trim();
    const dName = (d.name || "").toString().trim().slice(0, 40);
    const dPhone = (d.phone || "").toString().trim().slice(0, 20);
    if (
      !DELIVERY_LOCATIONS.includes(dLoc) ||
      !dName ||
      dPhone.replace(/\D/g, "").length < 9
    ) {
      return res
        .status(400)
        .json({ error: "กรุณาเลือกจุดจัดส่ง และกรอกชื่อ/เบอร์โทรให้ครบ" });
    }

    const tokenData = orderTokens.get(token);
    if (!tokenData) {
      return res.status(401).json({ error: "ลิงก์หมดอายุ กรุณากดปุ่ม Food อีกครั้ง" });
    }
    if (Date.now() - tokenData.createdAt > TOKEN_TTL) {
      orderTokens.delete(token);
      return res.status(401).json({ error: "ลิงก์หมดอายุ กรุณากดปุ่ม Food อีกครั้ง" });
    }
    const userId = tokenData.userId;
    // ไม่ลบ token ที่นี่ — ปล่อยให้ใช้ซ้ำได้จนหมดอายุ (30 นาที)
    // เพื่อให้ปุ่ม "แก้ไขออเดอร์" / "สั่งเพิ่มเติม" กดยืนยันใหม่ได้

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "กรุณาเลือกอย่างน้อย 1 เมนู" });
    }

    // ตรวจเวลาเปิด-ปิดแต่ละหมวด
    for (const it of items) {
      const sec = itemSection(parseCartKey(it.key).id);
      if (!isSectionOpen(sec)) {
        const label = sec === "food" ? "ครัว" : "ร้านเครื่องดื่ม";
        const reason = manualOverride[sec] === false
          ? `${label}ปิดชั่วคราวครับ`
          : `${label}ปิดแล้วครับ เปิด ${BUSINESS_HOURS[sec].label} น.`;
        return res.status(400).json({ error: reason });
      }
    }

    // คิดยอดรวมเองฝั่ง server — ไม่เชื่อค่าจากเว็บ
    const total = computeOrderTotal(items);
    if (total == null) {
      return res.status(400).json({ error: "ข้อมูลออเดอร์ไม่ถูกต้อง กรุณาลองใหม่" });
    }
    if (typeof clientTotal === "number" && clientTotal !== total) {
      console.warn(`[TOTAL MISMATCH] user=${userId} client=${clientTotal} server=${total}`);
    }

    orderCounter++;
    saveCounter();
    const orderId = `MGR${String(orderCounter).padStart(4, "0")}`;

    const summaryLines = items.map(
      (item, i) =>
        `${i + 1}. ${item.name}${item.qty > 1 ? ` x${item.qty}` : ""} = ${item.totalPrice}.-`
    );
    if (addons && addons.length > 0) {
      const labels = addons
        .map((id) => ADDONS.find((a) => a.id === id))
        .filter(Boolean)
        .map((a) => a.label);
      summaryLines.push(`\n🛒 เพิ่มเติม: ${labels.join(", ")}`);
    }
    const summary = summaryLines.join("\n");

    const session = getSession(userId);
    if (session.orderId && pendingOrders.has(session.orderId)) {
      const oldOrder = pendingOrders.get(session.orderId);
      if (oldOrder.state === "await_slip") {
        pendingOrders.delete(session.orderId);
        store.deleteOrder(session.orderId);
      }
    }

    const slipToken = crypto.randomBytes(16).toString("hex");
    const newOrder = {
      userId,
      items: items.map((it) => ({ name: it.name, qty: it.qty, price: it.price })),
      summary,
      total,
      delivery: { location: dLoc, name: dName, phone: dPhone },
      state: "await_slip",
      slipToken,
      createdAt: Date.now(),
      orderStatus: "none",
      statusEta: 0,
      statusAt: 0,
    };
    pendingOrders.set(orderId, newOrder);
    store.saveOrder(orderId, newOrder);

    session.state = "await_slip";
    session.orderId = orderId;
    store.saveSession(userId, session);
    store.saveCustomer(userId, dName, dPhone);

    res.json({ success: true, orderId, slipToken });

    // dev: test order (uid ขึ้นต้น "TEST") — ข้ามการ push LINE ทั้งหมด กัน quota/สแปมแอดมินจริง
    if (userId.startsWith("TEST")) return;

    const qrUrl = `${getBaseUrl()}/images/qr-payment.jpg`;
    client.pushMessage({
      to: userId,
      messages: [
        {
          type: "flex",
          altText: `💳 กรุณาโอนเงิน ${total} บาท - #${orderId}`,
          contents: {
            type: "bubble",
            header: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "text",
                  text: `💳 ชำระเงิน #${orderId}`,
                  weight: "bold",
                  size: "lg",
                  color: "#27AE60",
                },
              ],
              backgroundColor: "#F0FFF0",
              paddingAll: "15px",
            },
            hero: {
              type: "image",
              url: qrUrl,
              size: "full",
              aspectRatio: "1:1",
              aspectMode: "fit",
            },
            body: {
              type: "box",
              layout: "vertical",
              spacing: "md",
              contents: [
                {
                  type: "text",
                  text: `กรุณาโอนเงิน ${total} บาท\nมายัง PromptPay ของร้าน`,
                  size: "md",
                  weight: "bold",
                  wrap: true,
                  align: "center",
                },
                { type: "separator" },
                {
                  type: "text",
                  text: `📍 ${dLoc}\n👤 ${dName}  📞 ${dPhone}`,
                  size: "sm",
                  weight: "bold",
                  color: "#5A4F00",
                  wrap: true,
                },
                { type: "separator" },
                { type: "text", text: summary, size: "sm", color: "#666666", wrap: true },
                {
                  type: "text",
                  text: `💰 รวม: ${total}.-`,
                  weight: "bold",
                  color: "#E85D3A",
                  margin: "sm",
                },
              ],
              paddingAll: "15px",
            },
            footer: {
              type: "box",
              layout: "vertical",
              spacing: "sm",
              contents: [
                {
                  type: "text",
                  text: "📸 โอนเสร็จแล้ว แนบสลิปในหน้าออเดอร์ หรือส่งรูปมาในแชทได้เลยครับ",
                  size: "sm",
                  color: "#27AE60",
                  align: "center",
                  weight: "bold",
                  wrap: true,
                },
                {
                  type: "button",
                  style: "primary",
                  color: "#27AE60",
                  margin: "md",
                  height: "sm",
                  action: {
                    type: "uri",
                    label: "📋 เปิดหน้าออเดอร์/แนบสลิป",
                    uri: `${getBaseUrl()}/order.html?oid=${orderId}&s=${slipToken}`,
                  },
                },
                {
                  type: "button",
                  style: "secondary",
                  height: "sm",
                  action: {
                    type: "postback",
                    label: "❌ ยกเลิกออเดอร์",
                    data: `a=cancel&oid=${orderId}`,
                    displayText: "ยกเลิกออเดอร์",
                  },
                },
              ],
              paddingAll: "15px",
            },
          },
        },
      ],
    }).catch(err => console.error("Payment msg error:", err.message));

    // หมายเหตุ: ไม่แจ้งแอดมินตอนนี้ (ประหยัด push) — แจ้งตอนสลิปมาพร้อมปุ่มยืนยันแทน
  } catch (err) {
    console.error("Order error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ==================== API: แนบสลิปจากหน้าเว็บ ====================

app.post("/api/slip", slipLimiter, express.json({ limit: "15mb" }), async (req, res) => {
  let lockedOrder = null;
  try {
    const { orderId, slipToken, image } = req.body;

    const order = pendingOrders.get(orderId);
    if (!order || !slipToken || order.slipToken !== slipToken) {
      return res.status(401).json({ error: "ออเดอร์ไม่ถูกต้องหรือหมดอายุ" });
    }
    if (order.state !== "await_slip") {
      return res.status(409).json({ error: "ออเดอร์นี้ส่งสลิปไปแล้วครับ" });
    }
    const isDev = process.env.NODE_ENV === "development";
    let buffer;
    if (isDev && (!image || image === "dev-skip")) {
      buffer = Buffer.alloc(1);
    } else {
      if (!image || typeof image !== "string") {
        return res.status(400).json({ error: "ไม่พบไฟล์สลิป" });
      }
      const m = image.match(/^data:image\/(png|jpe?g);base64,(.+)$/);
      if (!m) {
        return res.status(400).json({ error: "ไฟล์ต้องเป็นรูปภาพ (JPG/PNG)" });
      }
      buffer = Buffer.from(m[2], "base64");
      if (buffer.length > 12 * 1024 * 1024) {
        return res.status(413).json({ error: "ไฟล์ใหญ่เกินไป" });
      }
    }

    // จองสถานะก่อน (sync) กันส่งสลิปซ้ำซ้อนตอนคนเยอะ — คืนสถานะถ้าตรวจไม่ผ่าน/ล้มเหลว
    order.state = "slip_sent";
    lockedOrder = order;
    store.saveOrder(orderId, order);

    // ตรวจสลิปกับ SlipOK (ถ้าเปิดใช้) ก่อนรับเข้าระบบ
    const verify = await slipok.verifySlip(buffer, order.total);
    if (slipok.isReject(verify.status)) {
      order.state = "await_slip"; // คืนสถานะให้ลองส่งใหม่
      store.saveOrder(orderId, order);
      lockedOrder = null;
      return res.status(400).json({ error: verify.customerMessage });
    }

    if (isDev && buffer.length <= 1) {
      order.slipUrl = null;
    } else {
      const slipFile = await saveSlipImage(buffer, orderId, order.slipToken);
      order.slipUrl = `${getBaseUrl()}/images/slips/${slipFile}`;
    }
    store.saveOrder(orderId, order);

    // ✅ SlipOK ตรวจผ่าน + ยอดตรง → ยืนยันอัตโนมัติ (ไม่ต้องรอแอดมิน)
    if (verify.status === "verified") {
      setConfirmed(orderId, order);
      lockedOrder = null;
      res.json({ success: true, autoConfirmed: true });
      if (order.userId.startsWith("TEST")) return;
      notifyCustomerConfirmed(orderId, order);
      notifyAdminAutoConfirmed(orderId, order);
      return;
    }

    // SlipOK ล่ม (error) หรือยังไม่ได้ตั้งค่า (disabled) → ส่งให้แอดมินยืนยันเอง
    const cs = getSession(order.userId);
    cs.state = "await_confirm";
    store.saveSession(order.userId, cs);
    res.json({ success: true });
    lockedOrder = null;

    // dev: test order (uid ขึ้นต้น "TEST") — ข้ามการ push LINE ทั้งหมด กันสแปมแอดมินจริง
    if (order.userId.startsWith("TEST")) return;

    notifyAdminSlip(orderId, order).catch((err) =>
      console.error("Admin slip (web) error:", err.message)
    );
    client.pushMessage({
      to: order.userId,
      messages: [
        {
          type: "text",
          text: `✅ ได้รับสลิปออเดอร์ #${orderId} แล้วครับ\nรอร้านค้ายืนยันสักครู่นะครับ 🙏`,
        },
      ],
    }).catch(() => {});
  } catch (err) {
    console.error("Web slip error:", err);
    if (lockedOrder) {
      lockedOrder.state = "await_slip"; // คืนสถานะให้ลองส่งใหม่ได้
      store.saveOrder(req.body.orderId, lockedOrder);
    }
    if (!res.headersSent) res.status(500).json({ error: "เกิดข้อผิดพลาด กรุณาลองใหม่" });
  }
});

// ==================== API: เปิดหน้าออเดอร์เดิม (resume) ====================

app.get("/api/order-status", (req, res) => {
  const { oid, s } = req.query;
  const order = pendingOrders.get(oid);
  if (!order || !s || order.slipToken !== s) {
    return res.status(404).json({ error: "ไม่พบออเดอร์ หรือออเดอร์หมดอายุแล้ว" });
  }
  res.json({ orderId: oid, items: order.items || [], total: order.total, state: order.state, orderStatus: order.orderStatus || "none", statusEta: order.statusEta || 0, statusAt: order.statusAt || 0 });
});

// ==================== LINE Webhook ====================

app.post(
  "/webhook",
  middleware({ channelSecret: config.channelSecret }),
  (req, res) => {
    // ตอบ LINE ทันที (กัน webhook timeout → LINE retry → ประมวลผลซ้ำตอนคนเยอะ)
    res.json({ success: true });
    // แล้วค่อยประมวลผล event เบื้องหลัง (reply ใช้ replyToken ได้อยู่)
    Promise.all(req.body.events.map(handleEvent)).catch((err) =>
      console.error("handleEvent error:", err)
    );
  }
);

async function handleEvent(event) {
  const userId = event.source.userId;
  const srcType = event.source.type; // "user" (แชทเดี่ยว) | "group" | "room"

  // ในกลุ่ม/ห้องแชท: บอทเป็น "ตัวแจ้งเตือนอย่างเดียว" — ไม่ตอบโต้ข้อความที่คนคุยกันเลย
  // ยกเว้นคำสั่ง myidmgr (ไว้ดึง Group ID ตอนตั้งค่ากลุ่มแจ้งเตือนใหม่)
  if (srcType === "group" || srcType === "room") {
    if (
      event.type === "message" &&
      event.message.type === "text" &&
      event.message.text.trim().toLowerCase() === "myidmgr"
    ) {
      const id = srcType === "group" ? event.source.groupId : event.source.roomId;
      return reply(event.replyToken, [
        { type: "text", text: `🆔 ${srcType === "group" ? "Group" : "Room"} ID:\n${id}` },
      ]);
    }
    return null; // เงียบสนิท ไม่ตอบอะไรในกลุ่ม
  }

  if (event.type === "follow") {
    return reply(event.replyToken, [
      {
        type: "text",
        text: "สวัสดีครับ ยินดีต้อนรับ MGR สั่งอาหาร/กาแฟ 🙏\nกดเมนูด้านล่างเพื่อสั่งได้เลยครับ",
      },
    ]);
  }

  if (event.type === "postback") {
    return handlePostback(event.replyToken, userId, event.postback.data);
  }

  if (event.type === "message") {
    if (event.message.type === "image")
      return handleImage(event.replyToken, userId, event.message.id);
    if (event.message.type === "text") {
      const text = event.message.text.trim();
      // คำสั่งดู ID (รองรับทั้งแชทเดี่ยว = User ID และในกลุ่ม = Group ID)
      if (text.toLowerCase() === "myidmgr") {
        const src = event.source;
        const idLine =
          src.type === "group" ? `👥 Group ID:\n${src.groupId}` :
          src.type === "room"  ? `👥 Room ID:\n${src.roomId}` :
          `🙋 User ID:\n${userId}`;
        return reply(event.replyToken, [
          { type: "text", text: `🆔 ไอดีนี้คือ:\n${idLine}\n\nส่งไอดีนี้ให้ผู้ดูแลระบบ เพื่อตั้งรับการแจ้งเตือนครับ` },
        ]);
      }
      return handleText(event.replyToken, userId, text);
    }
  }

  return null;
}

// ==================== Text Handler ====================

async function handleText(replyToken, userId, text) {
  const session = getSession(userId);

  if (session.state === "await_slip") {
    return reply(replyToken, [
      { type: "text", text: "📸 กรุณาส่งรูปสลิปการโอนเงินมาเลยครับ" },
    ]);
  }

  if (session.state === "await_confirm") {
    return reply(replyToken, [
      { type: "text", text: "⏳ รอร้านค้ายืนยันการชำระเงินอยู่นะครับ กรุณารอสักครู่" },
    ]);
  }

  if (userId === ADMIN_ID && (text === "ออเดอร์" || text === "pending")) {
    const pending = [];
    for (const [oid, order] of pendingOrders) {
      const stateLabel =
        order.state === "await_slip" ? "⏳ รอสลิป" :
        order.state === "slip_sent" ? "📸 รอยืนยัน" :
        order.state === "confirmed" ? "✅ ยืนยันแล้ว" : order.state;
      const dLine = deliveryText(order);
      pending.push(
        `#${oid} ${stateLabel}\n${dLine ? dLine + "\n" : ""}${order.summary}\n💰 ${order.total}.-`
      );
    }
    if (pending.length === 0) {
      return reply(replyToken, [{ type: "text", text: "📋 ไม่มีออเดอร์ค้างครับ" }]);
    }
    return reply(replyToken, [
      { type: "text", text: `📋 ออเดอร์ทั้งหมด (${pending.length} รายการ)\n\n${pending.join("\n\n──────────\n\n")}` },
    ]);
  }

  const isFood  = text === "อาหาร" || text === "เมนูอาหาร" || text === "สั่งอาหาร";
  const isDrink = text === "เครื่องดื่มและกาแฟ" || text === "เมนูกาแฟ" || text === "กาแฟ" || text === "เครื่องดื่ม";
  const isBoth  = text === "Food / Drinks" || text === "อาหาร/เครื่องดื่ม";

  if (isFood || isDrink || isBoth) {
    const foodOpen  = isSectionOpen("food");
    const drinkOpen = isSectionOpen("drinks");

    // บล็อกถ้าหมวดที่กดปิดอยู่
    if (isFood && !foodOpen) {
      let msg = manualOverride.food === false
        ? "🔴 ครัวปิดชั่วคราวครับ"
        : `🕐 ครัวเปิดให้บริการ ${BUSINESS_HOURS.food.label} น. ครับ`;
      if (drinkOpen) msg += `\n\n☕ สั่งเครื่องดื่มได้เลย กดปุ่ม "Drinks & Coffee" ด้านล่าง`;
      return reply(replyToken, [{ type: "text", text: msg }]);
    }
    if (isDrink && !drinkOpen) {
      let msg = manualOverride.drinks === false
        ? "🔴 ร้านเครื่องดื่มปิดชั่วคราวครับ"
        : `🕐 ร้านเครื่องดื่มเปิดให้บริการ ${BUSINESS_HOURS.drinks.label} น. ครับ`;
      if (foodOpen) msg += `\n\n🍱 สั่งอาหารได้เลย กดปุ่ม "Food" ด้านล่าง`;
      return reply(replyToken, [{ type: "text", text: msg }]);
    }
    if (isBoth && !foodOpen && !drinkOpen) {
      const reason = (manualOverride.food === false || manualOverride.drinks === false)
        ? "🔴 ร้านปิดชั่วคราวครับ"
        : `🕐 ร้านปิดแล้วครับ\n\n🍱 ครัว: ${BUSINESS_HOURS.food.label} น.\n☕ เครื่องดื่ม: ${BUSINESS_HOURS.drinks.label} น.`;
      return reply(replyToken, [{ type: "text", text: reason }]);
    }

    const token = createToken(userId);
    const orderUrl = `${getBaseUrl()}/order.html?t=${token}`;

    const subtitle = foodOpen && drinkOpen
      ? "อาหารตามสั่ง · กาแฟ · นม · โซดา"
      : foodOpen ? "อาหารตามสั่ง (เครื่องดื่มยังไม่เปิด)"
      : "กาแฟ · นม · โซดา (ครัวยังไม่เปิด)";

    return reply(replyToken, [
      {
        type: "flex",
        altText: "🍱 กดเพื่อเปิดเมนูสั่งอาหาร",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "🍱☕ MGR สั่งอาหาร & เครื่องดื่ม",
                weight: "bold",
                size: "lg",
                align: "center",
                wrap: true,
              },
              {
                type: "text",
                text: subtitle + "\nเลือกเมนู กดจำนวน ยืนยัน จบในหน้าเดียว!",
                size: "sm",
                color: "#888888",
                align: "center",
                margin: "md",
                wrap: true,
              },
            ],
            paddingAll: "20px",
          },
          footer: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "button",
                style: "primary",
                color: "#5A4F00",
                height: "md",
                action: {
                  type: "uri",
                  label: "🍱 เปิดเมนูสั่งอาหาร",
                  uri: orderUrl,
                },
              },
            ],
            paddingAll: "15px",
          },
        },
      },
    ]);
  }

  if (text === "ติดต่อเจ้าหน้าที่" || text === "ติดต่อแอดมิน" || text === "ติดต่อร้าน") {
    return reply(replyToken, [
      {
        type: "text",
        text:
          "🏠 Hipsder Bar - Coffee & Beer\n" +
          "📞 063-881-0439\n" +
          "📍 แผนที่ร้าน: https://maps.app.goo.gl/wsXrsjzZJbjNwxTj9",
      },
    ]);
  }

  return reply(replyToken, [
    {
      type: "text",
      text: "สวัสดีครับ ยินดีต้อนรับ MGR สั่งอาหาร/กาแฟ 🙏\nกดเมนูด้านล่างเพื่อสั่งได้เลยครับ",
    },
  ]);
}

// ==================== แจ้งสลิปให้แอดมิน (ใช้ร่วมกัน: LINE + เว็บ) ====================

function adminSlipFlex(orderId, order) {
  return {
    type: "flex",
    altText: `💳 สลิป #${orderId} - รวม ${order.total}.-`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: `💳 สลิป #${orderId}`, weight: "bold", size: "lg", color: "#E85D3A" },
        ],
        backgroundColor: "#FFF8E7",
        paddingAll: "15px",
      },
      hero: {
        type: "image",
        url: order.slipUrl,
        size: "full",
        aspectRatio: "1:1.4",
        aspectMode: "fit",
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          ...(deliveryText(order)
            ? [
                {
                  type: "text",
                  text: deliveryText(order),
                  size: "sm",
                  weight: "bold",
                  color: "#5A4F00",
                  wrap: true,
                },
                { type: "separator", margin: "md" },
              ]
            : []),
          { type: "text", text: order.summary, size: "sm", wrap: true },
          { type: "separator", margin: "md" },
          {
            type: "text",
            text: `💰 รวม: ${order.total}.-`,
            weight: "bold",
            size: "md",
            color: "#E85D3A",
            margin: "md",
          },
        ],
        paddingAll: "15px",
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#27AE60",
            action: {
              type: "postback",
              label: "✅ ยืนยันการชำระเงิน",
              data: `a=admin_confirm&oid=${orderId}`,
              displayText: `ยืนยัน #${orderId}`,
            },
          },
          {
            type: "button",
            style: "secondary",
            action: {
              type: "postback",
              label: "❌ ปฏิเสธ",
              data: `a=admin_reject&oid=${orderId}`,
              displayText: `ปฏิเสธ #${orderId}`,
            },
          },
        ],
        paddingAll: "15px",
      },
    },
  };
}

// คืน true ถ้าแจ้งสำเร็จ
async function notifyAdminSlip(orderId, order) {
  // ส่งเฉพาะเจ้าของ (ADMIN_ID) ไม่เข้ากลุ่ม — เพราะพนักงานยืนยันรับเงินผ่านแดชบอร์ดอยู่แล้ว
  if (!ADMIN_ID) {
    console.error("WARNING: No ADMIN_USER_ID configured — slip notification skipped");
    return false;
  }
  try {
    const messages = [adminSlipFlex(orderId, order)];
    if (order.slipUrl) {
      messages.unshift({
        type: "image",
        originalContentUrl: order.slipUrl,
        previewImageUrl: order.slipUrl,
      });
    }
    await client.pushMessage({ to: ADMIN_ID, messages });
    return true;
  } catch (err) {
    console.error("Admin slip notify error:", err.message);
    return false;
  }
}

// ==================== ยืนยันออเดอร์ (ใช้ร่วม: แอดมินกดเอง + auto-confirm จาก SlipOK) ====================

// เปลี่ยนสถานะเป็น confirmed + เคลียร์ session + persist (ไม่ push — ให้ caller จัดการ)
function setConfirmed(orderId, order) {
  const cs = getSession(order.userId);
  cs.state = "idle";
  cs.orderId = null;
  order.state = "confirmed";
  order.orderStatus = "received";
  order.statusAt = Date.now();
  store.saveOrder(orderId, order);
  store.saveSession(order.userId, cs);
}

// แจ้งลูกค้าว่าชำระเงินเรียบร้อย
function notifyCustomerConfirmed(orderId, order) {
  const dInfo = deliveryText(order);
  const dPart = dInfo ? `\n${dInfo}` : "";
  return client.pushMessage({
    to: order.userId,
    messages: [
      {
        type: "text",
        text: `✅ ชำระเงินเรียบร้อยแล้ว!\n\n📋 ออเดอร์ #${orderId}${dPart}\n${order.summary}\n💰 รวม: ${order.total}.-\n\nกำลังเตรียมอาหารให้นะครับ 🍱\n\n📍 ติดตามสถานะออเดอร์: ${getBaseUrl()}/order.html?oid=${orderId}&s=${order.slipToken}`,
      },
    ],
  }).catch((err) => console.error("Notify customer (confirm) error:", err.message));
}

// แจ้งแอดมินว่าออเดอร์ผ่านการตรวจสลิปอัตโนมัติแล้ว (ไม่ต้องกดยืนยัน) — ไว้เริ่มทำอาหาร
function notifyAdminAutoConfirmed(orderId, order) {
  if (!ALERT_TARGET) return Promise.resolve();
  const dInfo = deliveryText(order);
  const dPart = dInfo ? `${dInfo}\n` : "";
  const messages = [];
  if (order.slipUrl) {
    messages.push({
      type: "image",
      originalContentUrl: order.slipUrl,
      previewImageUrl: order.slipUrl,
    });
  }
  messages.push({
    type: "text",
    text: `✅ ออเดอร์ใหม่ #${orderId} (สลิปผ่านการตรวจอัตโนมัติ)\n${dPart}${order.summary}\n💰 รวม: ${order.total}.-\n\nเริ่มทำได้เลยครับ 🍱`,
  });
  return client.pushMessage({
    to: ALERT_TARGET,
    messages,
  }).catch((err) => console.error("Notify admin (auto-confirm) error:", err.message));
}

// ==================== Image Handler (รับสลิป) ====================

async function handleImage(replyToken, userId, messageId) {
  const session = getSession(userId);

  if (session.state !== "await_slip" || !session.orderId) {
    return reply(replyToken, [
      { type: "text", text: "📸 หากต้องการส่งสลิป กรุณาสั่งอาหารก่อนนะครับ" },
    ]);
  }

  const order = pendingOrders.get(session.orderId);
  if (!order || order.state !== "await_slip") return; // กันประมวลผลซ้ำ
  const orderId = session.orderId;

  // จองสถานะก่อน (sync) กันรับสลิปซ้ำซ้อนตอนคนเยอะ
  order.state = "slip_sent";
  session.state = "await_confirm";
  store.saveOrder(orderId, order);
  store.saveSession(userId, session);

  try {
    const stream = await blobClient.getMessageContent(messageId);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    // ตรวจสลิปกับ SlipOK (ถ้าเปิดใช้)
    const verify = await slipok.verifySlip(buffer, order.total);
    if (slipok.isReject(verify.status)) {
      order.state = "await_slip"; // คืนสถานะให้ส่งสลิปใหม่ได้
      session.state = "await_slip";
      store.saveOrder(orderId, order);
      store.saveSession(userId, session);
      return reply(replyToken, [{ type: "text", text: "❌ " + verify.customerMessage }]);
    }

    // ย่อ+บีบอัด+เขียนแบบ async (ไม่บล็อก event loop)
    const slipFile = await saveSlipImage(buffer, orderId, order.slipToken);
    order.slipUrl = `${getBaseUrl()}/images/slips/${slipFile}`;
    store.saveOrder(orderId, order);

    // ✅ SlipOK ตรวจผ่าน + ยอดตรง → ยืนยันอัตโนมัติ
    if (verify.status === "verified") {
      setConfirmed(orderId, order);
      await reply(replyToken, [
        {
          type: "text",
          text: `✅ ชำระเงินเรียบร้อยแล้ว!\n\n📋 ออเดอร์ #${orderId}\n${order.summary}\n💰 รวม: ${order.total}.-\n\nกำลังเตรียมอาหารให้นะครับ 🍱\n\n📍 ติดตามสถานะออเดอร์: ${getBaseUrl()}/order.html?oid=${orderId}&s=${order.slipToken}`,
        },
      ]);
      notifyAdminAutoConfirmed(orderId, order);
      return;
    }

    // SlipOK ล่ม/ปิดใช้ → แอดมินยืนยันเอง
    await reply(replyToken, [
      {
        type: "text",
        text: "✅ ได้รับสลิปแล้วครับ\nรอการยืนยันจากร้านค้าสักครู่นะครับ 🙏",
      },
    ]);

    const ok = await notifyAdminSlip(orderId, order);
    if (!ok) {
      await client.pushMessage({
        to: userId,
        messages: [
          { type: "text", text: "⚠️ ระบบแจ้งร้านค้าไม่สำเร็จ กรุณาติดต่อร้านค้าโดยตรงครับ" },
        ],
      }).catch(() => {});
    }
  } catch (err) {
    console.error("Slip error:", err.message);
    // คืนสถานะให้ลูกค้าส่งสลิปใหม่ได้
    order.state = "await_slip";
    session.state = "await_slip";
    store.saveOrder(orderId, order);
    store.saveSession(userId, session);
    return reply(replyToken, [
      { type: "text", text: "❌ เกิดข้อผิดพลาด กรุณาส่งสลิปอีกครั้งครับ" },
    ]);
  }
}

// ==================== Postback Handler ====================

async function handlePostback(replyToken, userId, data) {
  const params = new URLSearchParams(data);
  const action = params.get("a");

  if (action === "cancel") {
    const oid = params.get("oid");
    const session = getSession(userId);

    if (!oid || !pendingOrders.has(oid)) {
      return;
    }

    const order = pendingOrders.get(oid);
    if (order.state === "confirmed") {
      return reply(replyToken, [
        { type: "text", text: `⚠️ ออเดอร์ #${oid} ยืนยันแล้ว ไม่สามารถยกเลิกได้` },
      ]);
    }

    pendingOrders.delete(oid);
    store.deleteOrder(oid);
    if (session.orderId === oid) {
      session.state = "idle";
      session.orderId = null;
      store.saveSession(userId, session);
    }

    return reply(replyToken, [
      { type: "text", text: "❌ ยกเลิกออเดอร์แล้วครับ" },
    ]);
  }

  if (action === "admin_confirm") {
    if (userId !== ADMIN_ID) {
      return reply(replyToken, [{ type: "text", text: "⚠️ เฉพาะแอดมินเท่านั้น" }]);
    }

    const orderId = params.get("oid");
    const order = pendingOrders.get(orderId);
    if (!order)
      return reply(replyToken, [{ type: "text", text: `❌ ไม่พบออเดอร์ #${orderId}` }]);
    if (order.state === "confirmed")
      return reply(replyToken, [{ type: "text", text: `⚠️ ออเดอร์ #${orderId} ยืนยันไปแล้ว` }]);
    if (order.state !== "slip_sent")
      return reply(replyToken, [{ type: "text", text: `⏳ ออเดอร์ #${orderId} ยังไม่มีสลิป — รอลูกค้าส่งก่อนครับ` }]);

    setConfirmed(orderId, order);
    notifyCustomerConfirmed(orderId, order);

    return reply(replyToken, [adminStatusFlex(orderId, order)]);
  }

  if (action === "admin_status") {
    if (userId !== ADMIN_ID) return reply(replyToken, [{ type: "text", text: "⚠️ เฉพาะแอดมินเท่านั้น" }]);
    const orderId = params.get("oid");
    const status = params.get("st");
    if (!ORDER_STATUSES.includes(status)) return reply(replyToken, [{ type: "text", text: "❌ สถานะไม่ถูกต้อง" }]);

    const order = pendingOrders.get(orderId);
    if (!order) return reply(replyToken, [{ type: "text", text: `❌ ไม่พบออเดอร์ #${orderId}` }]);

    order.orderStatus = status;
    order.statusAt = Date.now();
    store.saveOrder(orderId, order);

    if (status === "delivered") {
      pendingOrders.delete(orderId);
      const cs = getSession(order.userId);
      cs.state = "idle";
      cs.orderId = null;
      store.saveSession(order.userId, cs);
    }

    // แจ้งลูกค้า
    if (!order.userId.startsWith("TEST")) {
      const emoji = ORDER_STATUS_EMOJI[status] || "📋";
      const label = ORDER_STATUS_LABELS[status]?.th || status;
      let text = `${emoji} ออเดอร์ #${orderId}\nสถานะ: ${label}`;
      if (status === "delivered") text += "\n\nขอบคุณที่ใช้บริการครับ 🙏";
      client.pushMessage({ to: order.userId, messages: [{ type: "text", text }] }).catch(() => {});
    }

    if (status === "delivered") {
      return reply(replyToken, [{ type: "text", text: `✅ ออเดอร์ #${orderId} จัดส่งเสร็จแล้ว` }]);
    }
    return reply(replyToken, [adminStatusFlex(orderId, order)]);
  }

  if (action === "admin_reject") {
    if (userId !== ADMIN_ID) {
      return reply(replyToken, [{ type: "text", text: "⚠️ เฉพาะแอดมินเท่านั้น" }]);
    }

    const orderId = params.get("oid");
    const order = pendingOrders.get(orderId);
    if (!order)
      return reply(replyToken, [{ type: "text", text: `❌ ออเดอร์ #${orderId} ถูกจัดการไปแล้ว` }]);

    const cs = getSession(order.userId);

    if (order.state === "confirmed") {
      pendingOrders.delete(orderId);
      store.deleteOrder(orderId);
      cs.state = "idle";
      cs.orderId = null;
      store.saveSession(order.userId, cs);
      client.pushMessage({
        to: order.userId,
        messages: [
          {
            type: "text",
            text: `❌ ออเดอร์ #${orderId} ถูกยกเลิกแล้ว\nกรุณาติดต่อเจ้าหน้าที่เรื่องการคืนเงินครับ`,
          },
        ],
      }).catch(err => console.error("Notify customer (cancel-after-confirm) error:", err.message));
      return reply(replyToken, [
        { type: "text", text: `❌ ยกเลิก #${orderId} (หลังยืนยัน) — แจ้งลูกค้าแล้ว` },
      ]);
    }

    if (order.state !== "slip_sent") {
      return reply(replyToken, [
        { type: "text", text: `⚠️ ออเดอร์ #${orderId} ปฏิเสธไปแล้ว หรือยังไม่มีสลิป` },
      ]);
    }

    order.state = "await_slip";
    cs.state = "await_slip";
    store.saveOrder(orderId, order);
    store.saveSession(order.userId, cs);

    client.pushMessage({
      to: order.userId,
      messages: [
        {
          type: "text",
          text: `❌ สลิป #${orderId} ยังไม่ผ่าน\nกรุณาโอนเงิน ${order.total} บาท แล้วส่งสลิปใหม่ครับ`,
        },
      ],
    }).catch(err => console.error("Notify customer (reject) error:", err.message));

    return reply(replyToken, [
      { type: "text", text: `❌ ปฏิเสธ #${orderId} — แจ้งลูกค้าแล้ว` },
    ]);
  }
}

// ==================== Admin Status Flex ====================

function adminStatusFlex(orderId, order) {
  const now = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
  const dInfo = deliveryText(order);
  const dPart = dInfo ? `\n${dInfo}` : "";
  const curStatus = order.orderStatus || "received";
  const curIdx = ORDER_STATUSES.indexOf(curStatus);
  const nextStatuses = ORDER_STATUSES.slice(curIdx + 1);
  const statusLabel = ORDER_STATUS_LABELS[curStatus]?.th || curStatus;

  const buttons = nextStatuses.map(s => ({
    type: "button",
    style: s === "delivered" ? "primary" : "secondary",
    color: s === "delivered" ? "#27AE60" : undefined,
    height: "sm",
    action: {
      type: "postback",
      label: `${ORDER_STATUS_EMOJI[s]} ${ORDER_STATUS_LABELS[s].th}`,
      data: `a=admin_status&oid=${orderId}&st=${s}`,
      displayText: `อัปเดต #${orderId} → ${ORDER_STATUS_LABELS[s].th}`,
    },
  }));
  buttons.push({
    type: "button",
    style: "secondary",
    height: "sm",
    action: {
      type: "postback",
      label: "❌ ยกเลิก/คืนเงิน",
      data: `a=admin_reject&oid=${orderId}`,
      displayText: `ยกเลิก #${orderId}`,
    },
  });

  return {
    type: "flex",
    altText: `📋 #${orderId} — ${statusLabel}`,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: `${ORDER_STATUS_EMOJI[curStatus] || "📋"} ${statusLabel} - ${now}`, weight: "bold", color: "#27AE60", wrap: true },
          { type: "text", text: `📋 #${orderId}${dPart}\n${order.summary}\n💰 รวม: ${order.total}.-`, size: "sm", color: "#888888", wrap: true },
        ],
        paddingAll: "15px",
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: buttons,
        paddingAll: "15px",
      },
    },
  };
}

// ==================== Helper ====================

function reply(replyToken, messages) {
  return client.replyMessage({ replyToken, messages });
}

// ==================== Auto-cancel ออเดอร์ค้าง ====================
const AUTO_CANCEL_MS = 2 * 60 * 60 * 1000; // 2 ชั่วโมง
setInterval(() => {
  const now = Date.now();
  for (const [orderId, order] of pendingOrders) {
    if (order.state !== "await_slip") continue;
    if (now - (order.createdAt || 0) < AUTO_CANCEL_MS) continue;

    order.state = "cancelled";
    store.saveOrder(orderId, order);
    pendingOrders.delete(orderId);

    const cs = getSession(order.userId);
    if (cs.orderId === orderId) {
      cs.state = "idle";
      cs.orderId = null;
      store.saveSession(order.userId, cs);
    }

    console.log(`[AUTO-CANCEL] ${orderId} (no slip after 2h)`);

    if (!order.userId.startsWith("TEST")) {
      client.pushMessage({
        to: order.userId,
        messages: [{
          type: "text",
          text: `⏰ ออเดอร์ #${orderId} ถูกยกเลิกอัตโนมัติเนื่องจากไม่มีการส่งสลิปภายในเวลาที่กำหนด\n\nหากต้องการสั่งใหม่ กรุณากดสั่งอีกครั้งครับ 🙏`,
        }],
      }).catch(e => console.error("Auto-cancel push error:", e.message));
    }
  }
}, 15 * 60 * 1000); // ทุก 15 นาที

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MGR LINE Chatbot running on port ${PORT}`));
