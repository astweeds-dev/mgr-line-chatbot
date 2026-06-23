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
data/mgr.{env}.db          # SQLite database (gitignored — runtime state)
data/counter.{env}.json    # Order counter persistence (survives restart)
setup-rich-menu.js         # Creates 3-button Rich Menu (Food/Drinks/Contact)
update-webhook.js          # Sets LINE webhook URL
start-all.bat              # Production: server + tunnel + webhook
start-dev.bat              # Dev: same flow but uses .env.development
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

## Remaining work / known issues
- **Production deployment**: Railway config exists (`railway.json`, `Procfile`) but not yet deployed — still running production from local machine via Cloudflare Tunnel. ⚠️ If moving to Railway, SQLite needs a persistent volume or the `.db` is wiped on each redeploy
- **Cancel/reject flow**: not yet tested end-to-end (admin reject, cancel-after-confirm, re-upload slip)
- **PROJECT-DNA.md**: full project context file exists for use in Claude Chat conversations

## Commands
```bash
npm run dev          # Dev server with nodemon (no tunnel)
npm run dev:tunnel   # start-dev.bat (server + tunnel + webhook)
npm start            # Production server
```
