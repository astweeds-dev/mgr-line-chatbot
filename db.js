// ==================== SQLite persistence layer ====================
// เก็บออเดอร์ + session ลงไฟล์ เพื่อให้ไม่หายเมื่อ restart server
// แยกไฟล์ DB ตาม NODE_ENV (dev/prod ไม่ปนกัน — เหมือน counter)
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const NODE_ENV = (process.env.NODE_ENV || "production").trim();
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, `mgr.${NODE_ENV}.db`));
db.pragma("journal_mode = WAL"); // ทนทานต่อ crash + อ่าน/เขียนพร้อมกันได้ดีขึ้น
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    orderId     TEXT PRIMARY KEY,
    userId      TEXT NOT NULL,
    items       TEXT NOT NULL,
    summary     TEXT,
    total       INTEGER,
    delivery    TEXT,
    state       TEXT,
    slipToken   TEXT,
    slipUrl     TEXT,
    createdAt   INTEGER,
    orderStatus TEXT DEFAULT 'none',
    statusEta   INTEGER DEFAULT 0,
    statusAt    INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sessions (
    userId    TEXT PRIMARY KEY,
    state     TEXT,
    orderId   TEXT,
    updatedAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS customers (
    userId    TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    phone     TEXT NOT NULL,
    updatedAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS menu_items (
    id        INTEGER PRIMARY KEY,
    cat       TEXT NOT NULL,
    nameTh    TEXT NOT NULL,
    nameEn    TEXT NOT NULL,
    price     TEXT NOT NULL,
    addons    TEXT DEFAULT '[]',
    level     TEXT DEFAULT '[]',
    levelLabel TEXT DEFAULT '',
    variantLabel TEXT DEFAULT '',
    sortOrder INTEGER DEFAULT 0,
    enabled   INTEGER DEFAULT 1
  );
`);

// migrate: add new columns if missing (existing DB)
try { db.exec(`ALTER TABLE orders ADD COLUMN orderStatus TEXT DEFAULT 'none'`); } catch {}
try { db.exec(`ALTER TABLE orders ADD COLUMN statusEta INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE orders ADD COLUMN statusAt INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE menu_items ADD COLUMN imageUrl TEXT DEFAULT ''`); } catch {}


// สถานะที่ยัง "ค้าง" — โหลดกลับเข้าหน่วยความจำตอน boot
// (confirmed/อื่นๆ เก็บไว้ใน DB เป็นประวัติ แต่ไม่ต้องโหลดกลับเข้า pendingOrders)
const ACTIVE_STATES = ["await_slip", "slip_sent", "await_confirm"];

const stmtUpsertOrder = db.prepare(`
  INSERT INTO orders (orderId, userId, items, summary, total, delivery, state, slipToken, slipUrl, createdAt, orderStatus, statusEta, statusAt)
  VALUES (@orderId, @userId, @items, @summary, @total, @delivery, @state, @slipToken, @slipUrl, @createdAt, @orderStatus, @statusEta, @statusAt)
  ON CONFLICT(orderId) DO UPDATE SET
    userId=@userId, items=@items, summary=@summary, total=@total, delivery=@delivery,
    state=@state, slipToken=@slipToken, slipUrl=@slipUrl,
    orderStatus=@orderStatus, statusEta=@statusEta, statusAt=@statusAt
`);
const stmtDeleteOrder = db.prepare(`DELETE FROM orders WHERE orderId = ?`);
// โหลด confirmed ที่ยังไม่ delivered ด้วย — ให้อัปเดตสถานะหลัง restart ได้
const stmtLoadActiveOrders = db.prepare(
  `SELECT * FROM orders WHERE state IN (${ACTIVE_STATES.map(() => "?").join(",")})
     OR (state = 'confirmed' AND IFNULL(orderStatus,'') != 'delivered')`
);

const stmtUpsertSession = db.prepare(`
  INSERT INTO sessions (userId, state, orderId, updatedAt)
  VALUES (@userId, @state, @orderId, @updatedAt)
  ON CONFLICT(userId) DO UPDATE SET state=@state, orderId=@orderId, updatedAt=@updatedAt
`);
const stmtLoadSessions = db.prepare(`SELECT * FROM sessions`);

// ---- Orders ----
function saveOrder(orderId, o) {
  stmtUpsertOrder.run({
    orderId,
    userId: o.userId,
    items: JSON.stringify(o.items || []),
    summary: o.summary || "",
    total: o.total | 0,
    delivery: JSON.stringify(o.delivery || null),
    state: o.state,
    slipToken: o.slipToken || null,
    slipUrl: o.slipUrl || null,
    createdAt: o.createdAt || Date.now(),
    orderStatus: o.orderStatus || "none",
    statusEta: o.statusEta || 0,
    statusAt: o.statusAt || 0,
  });
}

function deleteOrder(orderId) {
  stmtDeleteOrder.run(orderId);
}

function rowToOrder(r) {
  return {
    userId: r.userId,
    items: JSON.parse(r.items),
    summary: r.summary,
    total: r.total,
    delivery: r.delivery ? JSON.parse(r.delivery) : null,
    state: r.state,
    slipToken: r.slipToken,
    slipUrl: r.slipUrl,
    createdAt: r.createdAt,
    orderStatus: r.orderStatus || "none",
    statusEta: r.statusEta || 0,
    statusAt: r.statusAt || 0,
  };
}

// คืน array ของ [orderId, orderObj] เฉพาะออเดอร์ที่ยังค้าง
function loadActiveOrders() {
  return stmtLoadActiveOrders.all(...ACTIVE_STATES).map((r) => [r.orderId, rowToOrder(r)]);
}

// admin: ออเดอร์ทั้งหมด (ล่าสุดก่อน)
const stmtAllOrders = db.prepare(`SELECT * FROM orders ORDER BY createdAt DESC LIMIT ?`);
function loadAllOrders(limit = 100) {
  return stmtAllOrders.all(limit).map((r) => [r.orderId, rowToOrder(r)]);
}

// ---- Sessions ----
function saveSession(userId, s) {
  stmtUpsertSession.run({
    userId,
    state: s.state,
    orderId: s.orderId || null,
    updatedAt: Date.now(),
  });
}

function loadSessions() {
  return stmtLoadSessions
    .all()
    .map((r) => [r.userId, { state: r.state, orderId: r.orderId }]);
}

// ---- Menu ----
const stmtUpsertMenu = db.prepare(`
  INSERT INTO menu_items (id, cat, nameTh, nameEn, price, addons, level, levelLabel, variantLabel, sortOrder, enabled, imageUrl)
  VALUES (@id, @cat, @nameTh, @nameEn, @price, @addons, @level, @levelLabel, @variantLabel, @sortOrder, @enabled, @imageUrl)
  ON CONFLICT(id) DO UPDATE SET
    cat=@cat, nameTh=@nameTh, nameEn=@nameEn, price=@price, addons=@addons,
    level=@level, levelLabel=@levelLabel, variantLabel=@variantLabel, sortOrder=@sortOrder, enabled=@enabled, imageUrl=@imageUrl
`);
const stmtDeleteMenu = db.prepare(`DELETE FROM menu_items WHERE id = ?`);
const stmtLoadMenu = db.prepare(`SELECT * FROM menu_items ORDER BY sortOrder, id`);

function saveMenuItem(item) {
  stmtUpsertMenu.run({
    id: item.id,
    cat: item.cat,
    nameTh: item.nameTh,
    nameEn: item.nameEn,
    price: JSON.stringify(item.price),
    addons: JSON.stringify(item.addons || []),
    level: JSON.stringify(item.level || []),
    levelLabel: item.levelLabel || "",
    variantLabel: item.variantLabel || "",
    sortOrder: item.sortOrder || 0,
    enabled: item.enabled !== undefined ? (item.enabled ? 1 : 0) : 1,
    imageUrl: item.imageUrl || "",
  });
}

function deleteMenuItem(id) { stmtDeleteMenu.run(id); }

function loadMenuItems() {
  return stmtLoadMenu.all().map((r) => ({
    id: r.id,
    cat: r.cat,
    nameTh: r.nameTh,
    nameEn: r.nameEn,
    price: JSON.parse(r.price),
    addons: JSON.parse(r.addons),
    level: JSON.parse(r.level),
    levelLabel: r.levelLabel,
    variantLabel: r.variantLabel,
    sortOrder: r.sortOrder,
    enabled: !!r.enabled,
    imageUrl: r.imageUrl || "",
  }));
}

function menuCount() {
  return db.prepare(`SELECT COUNT(*) as c FROM menu_items`).get().c;
}

// ---- Customers (remember name & phone) ----
const stmtUpsertCustomer = db.prepare(`
  INSERT INTO customers (userId, name, phone, updatedAt)
  VALUES (@userId, @name, @phone, @updatedAt)
  ON CONFLICT(userId) DO UPDATE SET name=@name, phone=@phone, updatedAt=@updatedAt
`);
const stmtGetCustomer = db.prepare(`SELECT name, phone FROM customers WHERE userId = ?`);

function saveCustomer(userId, name, phone) {
  stmtUpsertCustomer.run({ userId, name, phone, updatedAt: Date.now() });
}

function getCustomer(userId) {
  const row = stmtGetCustomer.get(userId);
  return row ? { name: row.name, phone: row.phone } : null;
}

module.exports = {
  saveOrder,
  deleteOrder,
  loadActiveOrders,
  loadAllOrders,
  saveSession,
  loadSessions,
  saveMenuItem,
  deleteMenuItem,
  loadMenuItems,
  menuCount,
  saveCustomer,
  getCustomer,
};
