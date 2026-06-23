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

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    orderId   TEXT PRIMARY KEY,
    userId    TEXT NOT NULL,
    items     TEXT NOT NULL,
    summary   TEXT,
    total     INTEGER,
    delivery  TEXT,
    state     TEXT,
    slipToken TEXT,
    slipUrl   TEXT,
    createdAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS sessions (
    userId    TEXT PRIMARY KEY,
    state     TEXT,
    orderId   TEXT,
    updatedAt INTEGER
  );
`);

// สถานะที่ยัง "ค้าง" — โหลดกลับเข้าหน่วยความจำตอน boot
// (confirmed/อื่นๆ เก็บไว้ใน DB เป็นประวัติ แต่ไม่ต้องโหลดกลับเข้า pendingOrders)
const ACTIVE_STATES = ["await_slip", "slip_sent", "await_confirm"];

const stmtUpsertOrder = db.prepare(`
  INSERT INTO orders (orderId, userId, items, summary, total, delivery, state, slipToken, slipUrl, createdAt)
  VALUES (@orderId, @userId, @items, @summary, @total, @delivery, @state, @slipToken, @slipUrl, @createdAt)
  ON CONFLICT(orderId) DO UPDATE SET
    userId=@userId, items=@items, summary=@summary, total=@total, delivery=@delivery,
    state=@state, slipToken=@slipToken, slipUrl=@slipUrl
`);
const stmtDeleteOrder = db.prepare(`DELETE FROM orders WHERE orderId = ?`);
const stmtLoadActiveOrders = db.prepare(
  `SELECT * FROM orders WHERE state IN (${ACTIVE_STATES.map(() => "?").join(",")})`
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
  });
}

function deleteOrder(orderId) {
  stmtDeleteOrder.run(orderId);
}

// คืน array ของ [orderId, orderObj] เฉพาะออเดอร์ที่ยังค้าง
function loadActiveOrders() {
  return stmtLoadActiveOrders.all(...ACTIVE_STATES).map((r) => [
    r.orderId,
    {
      userId: r.userId,
      items: JSON.parse(r.items),
      summary: r.summary,
      total: r.total,
      delivery: r.delivery ? JSON.parse(r.delivery) : null,
      state: r.state,
      slipToken: r.slipToken,
      slipUrl: r.slipUrl,
      createdAt: r.createdAt,
    },
  ]);
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

module.exports = {
  saveOrder,
  deleteOrder,
  loadActiveOrders,
  saveSession,
  loadSessions,
};
