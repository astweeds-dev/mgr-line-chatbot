# MGR LINE Chatbot

LINE Chatbot for Merry.Go"Round STUDIO — food & drinks ordering, payment via PromptPay QR, admin confirmation flow.

## Tech Stack
- Node.js + Express + @line/bot-sdk v9 + sharp
- Vanilla HTML/CSS/JS frontend (single file: `public/order.html`)
- Cloudflare Tunnel for dev, Railway for production deployment
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
setup-rich-menu.js         # Creates 3-button Rich Menu (Food/Drinks/Contact)
update-webhook.js          # Sets LINE webhook URL
start-all.bat              # Production: runs watchdog.js (auto-restart loop)
start-dev.bat              # Dev: server + tunnel + webhook (no watchdog)
setup-autostart.bat        # Creates Windows Task Scheduler task for auto-start on boot
setup-named-tunnel.bat     # Interactive: creates Cloudflare Named Tunnel for fixed URL
```

## Environment Setup (done 2026-06-21)
Two environments are fully separated:

| | Production | Development |
|---|---|---|
| ENV file | `.env` | `.env.development` |
| LINE Channel | MGR production bot | MGR Dev (separate channel) |
| Run command | `start-all.bat` | `start-dev.bat` or `npm run dev` |
| Webhook | Auto-updated by start-all.bat | Auto-updated by start-dev.bat |

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
- **Tunnel modes**: Quick Tunnel (random URL, auto-extract) or Named Tunnel (fixed URL via `TUNNEL_NAME`/`TUNNEL_HOSTNAME` in .env)
- **Auto-extracts** tunnel URL → updates `.env` BASE_URL → restarts server → updates LINE webhook
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

## Remaining work / known issues
- **Named Tunnel**: `setup-named-tunnel.bat` prepared — requires a domain on Cloudflare (~350 baht/year). Gives fixed URL, no session breaks on tunnel restart
- **PROJECT-DNA.md**: full project context file exists for use in Claude Chat conversations

## Commands
```bash
npm run dev          # Dev server with nodemon (no tunnel)
npm run dev:tunnel   # start-dev.bat (server + tunnel + webhook)
npm start            # Production server (direct, no watchdog)
start-all.bat        # Production with watchdog (auto-restart + LINE alerts + tunnel)
setup-autostart.bat  # Set up auto-start on Windows boot (run as administrator)
setup-named-tunnel.bat  # Set up Cloudflare Named Tunnel for fixed URL (requires domain)
```
