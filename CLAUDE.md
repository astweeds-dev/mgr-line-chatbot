# MGR LINE Chatbot

LINE Chatbot for Merry.Go"Round STUDIO — food & drinks ordering, payment via PromptPay QR, admin confirmation flow.

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
db.js                      # SQLite persistence layer (orders + sessions)
slipok.js                  # SlipOK slip verification (optional, auto-confirm)
watchdog.js                # Production watchdog — manages server+tunnel, auto-restart, LINE alerts, logging
data/mgr.{env}.db          # SQLite database (gitignored — runtime state)
data/counter.{env}.json    # Order counter persistence (survives restart)
data/watchdog.log          # Watchdog event log (auto-rotated at 5MB)
setup-rich-menu.js         # Creates 2-button Rich Menu (Food-Drinks/Contact)
update-webhook.js          # Sets LINE webhook URL
start-all.bat              # Production: runs watchdog.js (auto-restart loop)
start-dev.bat              # Dev: server + tunnel + webhook (no watchdog)
setup-autostart.bat        # Creates Windows Task Scheduler task for auto-start on boot
setup-named-tunnel.bat     # Interactive: creates Cloudflare Named Tunnel for fixed URL
```

## Environment Setup (done 2026-06-21)
Two environments are fully separated:

| | MGR Main (ร้านจริง) | DEV (ทดสอบ) |
|---|---|---|
| ENV file | `.env` | `.env.development` |
| LINE Channel | MGR Main bot | MGR Dev (separate channel) |
| Run command | `start-all.bat` | `start-dev.bat` or `npm run dev` |
| Webhook | Auto-updated by watchdog | Auto-updated by start-dev.bat |

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

## Status
Project is **feature-complete** — ordering, payment, slip verification, order tracking, admin dashboard, menu management, watchdog, and auto-start are all working.

**Optional future upgrades** (not blocking):
- Named Tunnel (fixed URL, requires Cloudflare domain ~350 baht/year) — `setup-named-tunnel.bat` ready
- Dynamic menu loading in `order.html` (currently menu in order.html is still hardcoded; DB menu only affects server-side price validation)

## Commands
```bash
npm run dev          # Dev server with nodemon (no tunnel)
npm run dev:tunnel   # start-dev.bat (server + tunnel + webhook)
npm start            # MGR Main server (direct, no watchdog)
start-all.bat        # MGR Main with watchdog (auto-restart + LINE alerts + tunnel)
setup-autostart.bat  # Set up auto-start on Windows boot (run as administrator)
setup-named-tunnel.bat  # Set up Cloudflare Named Tunnel for fixed URL (requires domain)
```
