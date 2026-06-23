# MGR LINE Chatbot - Project DNA

## Overview
LINE Chatbot สำหรับร้าน Merry.Go"Round STUDIO — สั่งอาหาร/เครื่องดื่ม, ชำระเงินผ่าน PromptPay QR, ตรวจสลิปอัตโนมัติ (SlipOK), แอดมินยืนยัน/ปฏิเสธ
รันบน Node.js + Express เชื่อมต่อ LINE Messaging API ผ่าน Cloudflare Tunnel (Quick Tunnel)

## Tech Stack
- **Runtime**: Node.js
- **Framework**: Express
- **LINE SDK**: @line/bot-sdk v9 (MessagingApiClient, MessagingApiBlobClient)
- **Database**: SQLite (better-sqlite3) — orders + sessions persist across restarts
- **Image processing**: sharp (Rich Menu image generation + slip compression)
- **Slip verification**: SlipOK API (optional, auto-confirm if configured)
- **Dev**: nodemon, puppeteer (Rich Menu image generation)
- **Tunnel**: Cloudflare Tunnel (cloudflared) — Quick Tunnel (random URL, auto-extracted)

## Project Structure
```
mgr-line-chatbot/
├── app.js                     # Main server — Express + LINE webhook + order API + rate limiter
├── db.js                      # SQLite persistence layer (orders + sessions)
├── slipok.js                  # SlipOK slip verification (optional, auto-confirm)
├── watchdog.js                # MGR Main watchdog — server+tunnel lifecycle, health check, LINE alerts
├── package.json
├── .env                       # MGR Main credentials (gitignored)
├── .env.development           # Dev credentials (gitignored)
├── public/
│   ├── order.html             # Ordering web UI — bilingual (Thai/English), GrabFood-style
│   └── admin.html             # Admin dashboard — orders, status tracking, menu management
├── images/
│   ├── mgr logo.jpg           # Store logo (space in filename → URL-encode)
│   ├── qr-payment.jpg         # QR Code PromptPay
│   └── slips/                 # Customer payment slips (gitignored)
├── data/
│   ├── mgr.{env}.db           # SQLite database (gitignored — runtime state)
│   ├── counter.{env}.json     # Order counter persistence
│   └── watchdog.log           # Watchdog event log (auto-rotated at 5MB)
├── setup-rich-menu.js         # Creates 3-button Rich Menu (Food/Drinks/Contact)
├── create-rich-menu.js        # Alternative rich menu setup
├── generate-rich-menu-image.js # Generates rich menu button image via sharp
├── update-webhook.js          # Sets LINE webhook URL
├── start-all.bat              # MGR Main: runs watchdog.js (auto-restart loop)
├── start-dev.bat              # Dev: server + tunnel + webhook (no watchdog)
├── setup-autostart.bat        # Creates Windows Task Scheduler task for auto-start on boot
├── setup-named-tunnel.bat     # Interactive: Cloudflare Named Tunnel setup (fixed URL, requires domain)
├── railway.json               # Railway deployment config (not actively used)
└── Procfile                   # Railway start command (not actively used)
```

## Environment Variables
```
PORT=3000
CHANNEL_SECRET=xxx             # LINE Channel Secret
CHANNEL_ACCESS_TOKEN=xxx       # LINE Channel Access Token (long-lived)
ADMIN_USER_ID=xxx              # LINE User ID ของแอดมิน (รับแจ้งออเดอร์)
BASE_URL=https://xxx           # Public URL (tunnel URL)

# Optional — SlipOK auto-verification
SLIPOK_BRANCH_ID=xxx           # SlipOK branch ID
SLIPOK_API_KEY=xxx             # SlipOK API key

# Optional — Named Tunnel (fixed URL)
TUNNEL_NAME=xxx                # Cloudflare tunnel name
TUNNEL_HOSTNAME=xxx            # e.g. mgr.example.com
```

## Environment Separation
- `NODE_ENV=production` (default) → loads `.env`, uses `data/mgr.production.db`
- `NODE_ENV=development` → loads `.env.development`, uses `data/mgr.development.db`
- DEV uses a separate LINE Channel from MGR Main to avoid affecting customers
- app.js auto-selects env file on startup

## How It Works (Order Flow)

### 1. ลูกค้ากดสั่งอาหาร
- ลูกค้ากดปุ่ม "Food" หรือ "Drinks" ที่ Rich Menu → bot สร้าง token (crypto.randomBytes, TTL 30 นาที)
- ส่ง Flex Message มีปุ่ม URI → เปิด `order.html?t={token}`

### 2. ลูกค้าเลือกเมนูในเว็บ
- order.html — GrabFood/LINE MAN style UI, bilingual (Thai/English)
- 5 screens in single page: Start → Menu → Cart → Payment → Success
- เลือกจุดจัดส่ง (ห้องซ้อมเล็ก/ใหญ่/สตูดิโอ/ลานหน้ามินิบาร์) + ชื่อ/เบอร์
- เลือกเมนู 4 หมวด: อาหาร/กาแฟ/นม&ชา/โซดาอิตาเลียน + ของเพิ่ม
- กด "ยืนยันออเดอร์" → POST /api/order พร้อม token

### 3. Server รับออเดอร์
- ตรวจ token validity + server-side price validation (never trusts client total)
- สร้าง orderId (MGR0001, MGR0002, ...) — counter persisted to file
- บันทึกใน SQLite + in-memory cache
- push Flex Message ให้ลูกค้า → QR PromptPay + สรุปออเดอร์
- push แจ้ง Admin → ออเดอร์ใหม่
- Session state → "await_slip"

### 4. ลูกค้าส่งสลิป (2 ช่องทาง)
- **ผ่าน LINE chat**: handleImage() รับรูปสลิปผ่าน LINE Blob API
- **ผ่านหน้าเว็บ**: POST /api/slip (base64 image upload)
- สลิปถูกบีบอัด (sharp: max 1500px, JPEG 80%) → บันทึกที่ images/slips/
- **ถ้ามี SlipOK**: ตรวจสลิปอัตโนมัติ → ผ่านก็ auto-confirm, ไม่ผ่านก็แจ้งลูกค้าส่งใหม่
- **ถ้าไม่มี SlipOK**: push Flex Message ให้ Admin → แสดงสลิป + ปุ่ม "ยืนยัน" / "ปฏิเสธ"
- Session state → "await_confirm"

### 5. Admin ยืนยัน/ปฏิเสธ
- admin_confirm → แจ้งลูกค้า "ชำระเรียบร้อย กำลังเตรียมอาหาร" + orderStatus = "received"
- admin_reject → แจ้งลูกค้า "สลิปไม่ผ่าน กรุณาส่งใหม่" (state กลับไป await_slip)
- admin_cancel → ยกเลิกออเดอร์ + แจ้งลูกค้า

### 6. แจ้งสถานะออเดอร์ (Order Tracking)
- Admin กดอัปเดตสถานะผ่าน LINE postback buttons หรือ Admin Dashboard
- สถานะ: received → preparing → delivering → delivered
- แต่ละขั้น push แจ้งลูกค้าทาง LINE + แสดง ETA (ถ้ากำหนด)
- delivered → ออเดอร์เสร็จสมบูรณ์ ลบออกจาก pendingOrders

### 7. Admin Dashboard (public/admin.html)
- หน้าเว็บ admin สำหรับจัดการออเดอร์ + เมนู
- Login ด้วย ADMIN_TOKEN (auto-generated หรือตั้งใน .env)
- แท็บ: ออเดอร์ (active) / ประวัติ / เมนู
- อัปเดตสถานะออเดอร์ + ตั้ง ETA + ดูสลิป
- จัดการเมนู: เพิ่ม/แก้ไข/ลบ/เปิด-ปิด

## Session States
```
idle → (สั่งอาหาร) → await_slip → (ส่งสลิป) → await_confirm → (admin ยืนยัน) → idle
                        ↑                                          |
                        └──────── (admin ปฏิเสธ) ─────────────────┘
```

## Data Storage
- **SQLite** (`data/mgr.{env}.db`) — orders + sessions persisted, survive restarts
- **In-memory Maps** — loaded from SQLite on boot, act as cache
  - `sessions`: Map<userId, {state, orderId}>
  - `pendingOrders`: Map<orderId, {userId, summary, total, state, slipUrl, delivery, ...}>
  - `orderTokens`: Map<token, {userId, createdAt}> — TTL 30 min, cleanup ทุก 5 min
  - `orderCounter`: persisted to `data/counter.{env}.json`

## Menu Data (hardcoded in order.html + MENU_PRICES in app.js, or managed via Admin Dashboard → SQLite)

| Category | IDs | Variants | Add-ons | Price range |
|----------|-----|----------|---------|-------------|
| อาหารตามสั่ง (food) | 1, 3-15 | หมู/เนื้อ (some default-only) | ไข่ดาว 15 / ไข่เจียว 20 / พิเศษ 20 (item 1: หมูสับ 10 / พิเศษ 20) | 50-100 ฿ |
| กาแฟ (coffee) | 20-24 | คั่วอ่อน/คั่วเข้ม | น้ำผึ้ง 10 / คาราเมลไซรัป 10 / นมโอ๊ต 20 / เพิ่มช็อต 20 | 70-80 ฿ |
| นม & ชา (milk) | 30-35 | default only | น้ำผึ้ง 10 / คาราเมลไซรัป 10 | 70 ฿ |
| โซดาอิตาเลียน (soda) | 40-48 | default only | none | 70 ฿ |

Cart key format: `"3-หมู"`, `"21-คั่วอ่อน:น้ำผึ้ง,เพิ่มช็อต"`, plain `"40"` for no-option items.
Server uses `parseCartKey()` + `calcUnitPrice()` to recompute prices server-side.

## Rich Menu (3 ปุ่ม)
| ปุ่ม | สี | Action | ข้อความ |
|-----|-----|--------|--------|
| Food | #E85D3A (ส้ม) | message | "อาหาร" |
| Drinks & Coffee | #6F4E37 (น้ำตาล) | message | "เครื่องดื่มและกาแฟ" |
| Contact | #2196F3 (น้ำเงิน) | message | "ติดต่อเจ้าหน้าที่" |

## API Endpoints
| Method | Path | Rate limit | Description |
|--------|------|-----------|-------------|
| GET | / | — | Health text |
| GET | /health | — | Health JSON (`{ status, uptime }`) |
| POST | /webhook | — | LINE webhook (signature verification middleware) |
| POST | /api/order | 60/min/IP | Submit order (token + items + delivery info) |
| POST | /api/slip | 10/min/IP | Upload payment slip (base64 image) |
| GET | /api/order-status | 60/min/IP | Resume order page (oid + slipToken) |
| GET | /api/order-tracking | 60/min/IP | Customer order status tracking (oid + slipToken) |
| GET | /api/menu | 60/min/IP | Public menu items (from DB or hardcoded fallback) |
| GET | /api/admin/orders | admin token | All orders for admin dashboard |
| POST | /api/admin/status | admin token | Update order status + ETA |
| GET | /api/admin/menu | admin token | List menu items from DB |
| POST | /api/admin/menu | admin token | Add/update menu item |
| DELETE | /api/admin/menu/:id | admin token | Delete menu item |
| GET | /api/admin/token | dev only | Get auto-generated admin token |
| GET | /images/* | — | Static files (QR, logo, slips) |
| GET | /* (public/) | — | Static files (order.html, admin.html) |

## Security
- **Rate limiting**: API 60 req/min/IP, slip upload 10 req/min/IP
- LINE webhook signature verification (built-in via @line/bot-sdk middleware)
- Server-side price validation (never trusts client total)
- Token-based web page access (30-min TTL, no message spam)
- Slip image compression + size limit (15MB max upload)
- Secrets in `.env` (gitignored)
- Cloudflare Tunnel (no exposed ports)

## Production Watchdog (`watchdog.js`)
- Starts & manages server (`node app.js`) + Cloudflare Tunnel as child processes
- Auto-extracts tunnel URL → updates `.env` BASE_URL → restarts server → updates LINE webhook
- Health monitoring every 30 seconds via `/health` endpoint
- Auto-restart crashed server or tunnel immediately
- LINE alerts to admin: system up, server down, tunnel down, recovered, shutdown
- Log rotation: writes to `data/watchdog.log`, rotates at 5MB
- Graceful shutdown: Ctrl+C sends alert → kills children → exits
- `start-all.bat` wraps watchdog.js in a restart loop (if watchdog itself crashes)
- `setup-autostart.bat` creates Windows Task Scheduler task → system starts on boot

## Running
```bash
# MGR Main (ลูกค้าใช้)
start-all.bat              # watchdog.js (auto-restart + LINE alerts + tunnel)

# Development (ทดสอบ ไม่กระทบลูกค้า)
start-dev.bat              # server + tunnel + webhook (ใช้ .env.development)
npm run dev                # nodemon + .env.development (ไม่มี tunnel)
```

## Brand
- **Name**: Merry.Go"Round STUDIO
- **LINE OA**: @616molde
- **Colors**: cream bg #FFFEF5, yellow accent #F9E84A, text-on-yellow #5A4F00, success #27AE60
- **Font**: Google Fonts Sarabun
- **Logo**: `/images/mgr%20logo.jpg` (space in filename, URL-encoded)
