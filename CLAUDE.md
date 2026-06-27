# MGR LINE Chatbot

LINE Chatbot for Merry.Go"Round STUDIO — food & drinks ordering, payment via PromptPay QR or cash, admin confirmation flow, dynamic menu & settings from SQLite Dashboard.

## Tech Stack
- Node.js + Express + @line/bot-sdk v9 + sharp
- Vanilla HTML/CSS/JS frontend (single file: `public/order.html`)
- Cloudflare Tunnel (Quick Tunnel) for both MGR Main and DEV
- SQLite (better-sqlite3) for persistence — orders + sessions in `data/mgr.{env}.db`; Maps act as in-memory cache, loaded on boot. orderCounter persisted to `data/counter.{env}.json`

## Project Structure
```
app.js                     # Main server — Express + LINE webhook + order API
public/order.html          # Food ordering web UI (opened from LINE)
images/mgr logo.jpg        # Store logo (note: filename has a space)
images/qr-payment.jpg      # PromptPay QR code for payment
images/slips/              # Customer payment slips (gitignored)
images/settings/           # Uploaded logo/QR via Dashboard (gitignored)
db.js                      # SQLite persistence layer (orders + sessions + settings + menu)
seed-menu.js               # Canonical menu seed data (34 items, auto-seed on boot)
slipok.js                  # SlipOK slip verification (optional, auto-confirm)
google-apps-script.js      # Reference: Google Apps Script code for Sheet (deploy in Google)
watchdog.js                # Production watchdog — manages server+tunnel, auto-restart, LINE alerts, logging
data/mgr.{env}.db          # SQLite database (gitignored — runtime state)
data/counter.{env}.json    # Order counter persistence (survives restart)
data/watchdog.log          # Watchdog event log (auto-rotated at 5MB)
setup-rich-menu.js         # Creates 2-button Rich Menu (Food-Drinks/Contact)
update-webhook.js          # Sets LINE webhook URL
start-all.bat              # Production: runs watchdog.js (auto-restart loop)
start-dev.bat              # Dev: server + tunnel + webhook (no watchdog, port 4001, safe — won't kill production)
setup-autostart.bat        # Creates Windows Task Scheduler task for auto-start on boot
setup-named-tunnel.bat     # Interactive: creates Cloudflare Named Tunnel for fixed URL
```

## Environment Setup (done 2026-06-21)
Two environments are fully separated:

| | MGR Main (ร้านจริง) | DEV (ทดสอบ) |
|---|---|---|
| ENV file | `.env` | `.env.development` |
| LINE Channel | MGR Main bot | MGR Dev (separate channel) |
| Port | 3000 | 4001 |
| Run command | `start-all.bat` | `start-dev.bat` |
| Webhook | Auto-updated by watchdog | Auto-updated by start-dev.bat |
| Database | `data/mgr.production.db` | `data/mgr.development.db` |
| Log files | `server.log` / `tunnel.log` | `server-dev.log` / `tunnel-dev.log` |

`app.js` auto-selects env file based on `NODE_ENV`:
```js
const NODE_ENV = process.env.NODE_ENV || "production";
const envFile = NODE_ENV === "development" ? ".env.development" : ".env";
```

**Important**: Rich Menu must be set up separately per channel. To set up Rich Menu for dev:
```bash
node -e "require('dotenv').config({path:'.env.development'}); require('./setup-rich-menu.js')"
```

**Important**: In LINE Official Account Manager, for each channel:
- "Use webhook" must be **enabled**
- "Auto-reply messages" must be **disabled**

### SlipOK slip verification (optional)
`slipok.js` verifies payment slips against the bank via [SlipOK](https://slipok.com) (free tier: 100 slips/mo).
Set in `.env` / `.env.development`:
```
SLIPOK_BRANCH_ID=<branch id>
SLIPOK_API_KEY=<api key>
```
- **If unset** → falls back to manual admin confirm (current behavior, no change).
- **If set** → on slip upload (web `/api/slip` and LINE chat), slip is checked: real transfer + amount matches order total + not a duplicate (code 1012) + paid to shop's account (`log:true`).
  - ✅ pass → order **auto-confirmed**, customer + admin notified (admin doesn't need to tap).
  - ❌ duplicate / wrong amount / unreadable → rejected, customer told to re-send (state stays `await_slip`).
  - ⚠️ SlipOK API down → falls back to manual admin confirm.
- Verification logic is shared via `setConfirmed()` / `notifyCustomerConfirmed()` (also used by admin confirm).

## order.html (complete, 2026-06-22)
GrabFood/LINE MAN style ordering UI — bilingual (Thai/English).

### Design
- Brand: "Merry.Go"Round STUDIO"
- Colors: cream bg #FFFEF5, yellow accent #F9E84A, text-on-yellow #5A4F00, success #27AE60
- Font: Google Fonts Sarabun
- Logo: `/images/mgr%20logo.jpg` (space in filename, URL-encoded)

### Views (5 screens in single page)
1. **Start** — Delivery location picker + customer name & phone
2. **Menu** — Category filter pills (อาหาร/กาแฟ/นม&ชา/โซดา) + menu cards + floating cart bar
3. **Cart** — Item list with +/- qty + extras pills (ช้อนส้อม/พริกน้ำปลา/ซอส) + confirm button
4. **Payment** — 4-step progress bar + QR PromptPay + order summary + slip upload + cancel button
5. **Success** — Logo + order ID + summary + ETA

### Menu categories & items
| Category | IDs | Variants | Add-ons |
|----------|-----|----------|---------|
| อาหารตามสั่ง (food) | 1, 3-15 | หมู/เนื้อ (some default-only) | ไข่ดาว/ไข่เจียว/พิเศษ (item 1: หมูสับ/พิเศษ) |
| กาแฟ (coffee) | 20-24 | คั่วอ่อน/คั่วเข้ม | น้ำผึ้ง/คาราเมลไซรัป/นมโอ๊ต/เพิ่มช็อต |
| นม & ชา (milk) | 30-35 | default only | น้ำผึ้ง/คาราเมลไซรัป |
| โซดาอิตาเลียน (soda) | 40-48 | default only | none |

### Cart key system
Composite keys: `"3-หมู"`, `"21-คั่วอ่อน:น้ำผึ้ง,เพิ่มช็อต"`, plain `"40"` for no-option items.
Server uses `parseCartKey()` + `calcUnitPrice()` to recompute prices (never trusts client total).

### API contract (order.html → app.js)
```
POST /api/order     — submit order (token, items with keys, delivery info)
POST /api/slip      — upload payment slip (base64 image, orderId, slipToken)
GET  /api/order-status — resume order page (oid, slipToken)
```
Token comes from URL param `?t={token}` (30-min TTL, created by bot when user taps Food).

## Production Watchdog (`watchdog.js`)
Node.js process that manages the entire production stack:
- **Starts & manages** server (`node app.js`) + Cloudflare Tunnel as child processes
- **Auto-finds cloudflared** — searches PATH + default install paths
- **Tunnel modes**: Quick Tunnel (random URL, auto-extract) or Named Tunnel (fixed URL via `TUNNEL_NAME`/`TUNNEL_HOSTNAME` in .env)
- **Auto-extracts** tunnel URL → updates `.env` BASE_URL → updates LINE webhook (no server restart needed — app.js reads BASE_URL dynamically)
- **Health monitoring** every 30 seconds via `/health` endpoint
- **Auto-restart** crashed server or tunnel immediately
- **LINE alerts** to admin: system up 🟢, server down 🔴, tunnel down ⚠️, recovered ✅, shutdown 🔴
- **Log rotation**: writes to `data/watchdog.log`, rotates at 5MB
- **Graceful shutdown**: Ctrl+C sends shutdown alert → kills children → exits
- `start-all.bat` wraps watchdog.js in a restart loop (if watchdog itself crashes, it restarts)
- `setup-autostart.bat` creates Windows Task Scheduler task → system starts on boot (run as admin)

## Google Sheets Integration (added 2026-06-26)
Auto-logs delivered orders to Google Sheet "MGR รายรับ" via Apps Script Web App.
- **Trigger**: when order status changes to `delivered` (both admin dashboard and LINE postback)
- **Data logged**: date, Order ID, customer name, phone, delivery location, items, total, status
- **Status values**: `delivered` (normal) / `FREE` (VIP orders)
- **Config**: `GOOGLE_SHEET_URL` in `.env` / `.env.development`
- **Apps Script code**: `google-apps-script.js` (reference — deployed in Google Sheet > Extensions > Apps Script)
- **Sheet**: "MGR รายรับ" → tab "Orders" (auto-created with header row)

## VIP Free Ordering (added 2026-06-26)
Designated LINE User IDs can order without payment or required delivery fields.
- **Config**: `VIP_USER_IDS` in `.env` (comma-separated LINE User IDs)
- **VIP names**: hardcoded in `VIP_NAMES` object in `app.js`
- **Current VIPs**:
  - `U74a59d110f840bbeb9091c135de5660c` → G Owner
  - `U34c40f2479ce1604c7106c5dddfc7716` → DEV
- **VIP flow**: select menu → confirm → order auto-confirmed (skip payment) → notify via LINE → log to Sheet with status "FREE"
- **No impact on normal customers** — all VIP checks are behind `isVip` flag

## Settings System (added 2026-06-27)
All business data editable from Admin Dashboard → Settings tab, persisted to SQLite `settings` table.
- **Shop info**: name, phone, map URL
- **Media**: upload logo & QR PromptPay (sharp resize, stored in `images/settings/`)
- **Business hours**: food/drinks open-close hours + manual override toggle (persists across restart)
- **Delivery locations**: add/remove/edit from Dashboard
- **Payment methods**: toggle PromptPay QR / cash
- **API**: `GET /api/settings` (public), `GET/POST /api/admin/settings` (admin), `POST /api/admin/media/:type`

## Dynamic Menu (added 2026-06-27)
Menu items loaded from SQLite `menu_items` table — admin changes visible to customers immediately.
- **Seed**: `seed-menu.js` exports 34 items; `seedMenuIfEmpty()` auto-seeds on first boot
- **Versioned repair**: `menu_seed_version` setting tracks seed version; upgrades repair stale data while preserving admin's enabled/disabled state
- **order.html**: `loadMenu()` fetches `/api/menu` (source:"db"), hardcoded MENU kept as offline fallback only
- **Server price validation**: `MENU_PRICES` rebuilt from DB on boot + after every admin menu change via `reloadMenuFromDb()`

## Cash Payment (added 2026-06-27)
- Toggle `payment_cash_enabled` in Dashboard Settings → customers see payment method picker in cart
- Cash order: auto-confirmed (skip QR/slip), LINE notification to customer + admin ("เก็บเงินสดตอนส่ง")
- `paymentMethod: "cash"|"qr"` stored in order data

## Security
- **Rate limiting**: API endpoints limited to 60 req/min/IP; slip upload limited to 10 req/min/IP
- LINE webhook signature verification (built-in via @line/bot-sdk middleware)
- Server-side price validation (never trusts client total)
- Secrets in `.env` (gitignored)
- Cloudflare Tunnel (no exposed ports)

## Order Status Tracking (added 2026-06-24)
Admin can update order status via LINE postback buttons or Admin Dashboard:
- `received` → `preparing` → `delivering` → `delivered`
- Each status change pushes a notification to the customer via LINE
- Admin can set ETA (minutes) when updating status
- Status stored in `orderStatus` field in orders table

## Admin Dashboard (`public/admin.html`, added 2026-06-24)
Web-based admin panel for managing orders and menu:
- **Login**: requires `ADMIN_TOKEN` (auto-generated on startup, or set in `.env`). Staff can also log in with a fixed `ADMIN_PIN` (set in `.env`) — PIN survives restarts, no need to copy the token.
- **Orders tab**: view active orders, update status with ETA, view slips
- **History tab**: view completed/delivered orders
- **Menu tab**: add/edit/delete menu items stored in SQLite `menu_items` table
- Access at: `{BASE_URL}/admin.html?token={ADMIN_TOKEN}`
- Auto-refreshes active orders every 30 seconds

### Menu Management
- Menu items can be managed via Admin Dashboard → Menu tab
- Items stored in SQLite `menu_items` table (id, cat, nameTh, nameEn, price, addons, level, etc.)
- If no items in DB → falls back to hardcoded menu in `order.html` and `MENU_PRICES` in `app.js`
- When items are saved in DB → `MENU_PRICES` is rebuilt from DB (server-side price validation)

### Admin API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/admin/orders | token | List all orders |
| POST | /api/admin/status | token | Update order status |
| GET | /api/admin/menu | token | List menu items from DB |
| POST | /api/admin/menu | token | Add/update menu item |
| DELETE | /api/admin/menu/:id | token | Delete menu item |
| GET | /api/admin/token | none (dev only) | Get admin token |
| GET | /api/menu | none | Public menu API |
| GET | /api/order-tracking | slipToken | Customer order status |
| GET | /api/env | none | Returns { dev: true/false } |
| GET | /api/customer | token | Get saved customer info + VIP flag |

## Named Tunnel Setup
For a fixed URL (no random URL on each restart):
1. Buy a domain (~350 baht/year) and add to Cloudflare
2. Run `setup-named-tunnel.bat` to create a Named Tunnel
3. Set in `.env`:
   ```
   TUNNEL_NAME=mgr-tunnel
   TUNNEL_HOSTNAME=order.yourdomain.com
   ```
4. Watchdog will auto-detect Named Tunnel config and use fixed URL

## DEV Safety (updated 2026-06-26)
`start-dev.bat` is designed to **never affect production**:
- Uses **port 4001** (production uses 3000) — can run simultaneously
- Kills only processes on DEV port, **never `taskkill /im node.exe`**
- Separate log files (`server-dev.log`, `tunnel-dev.log`)
- **Does NOT use watchdog.js** (which hardcodes `.env` production)
- Shows order page + admin dashboard links on startup

**CRITICAL**: Never run `node app.js` or `node watchdog.js` directly for DEV — always use `start-dev.bat` which sets `NODE_ENV=development`

## Status
Project is **feature-complete** — ordering, payment (QR + cash), slip verification, order tracking, admin dashboard, dynamic menu, settings system, media upload, Google Sheets logging, VIP ordering, watchdog, and auto-start are all working.

All business data (menu, settings, shop hours, payment methods, delivery locations) managed from Dashboard — no code changes needed for business operations.

**Optional future upgrades** (not blocking):
- Named Tunnel (fixed URL, requires Cloudflare domain ~350 baht/year) — `setup-named-tunnel.bat` ready

## Commands
```bash
npm run dev          # Dev server with nodemon (no tunnel)
npm run dev:tunnel   # start-dev.bat (server + tunnel + webhook)
npm start            # MGR Main server (direct, no watchdog)
start-all.bat        # MGR Main with watchdog (auto-restart + LINE alerts + tunnel)
setup-autostart.bat  # Set up auto-start on Windows boot (run as administrator)
setup-named-tunnel.bat  # Set up Cloudflare Named Tunnel for fixed URL (requires domain)
```
