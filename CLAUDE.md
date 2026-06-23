# MGR LINE Chatbot

LINE Chatbot for Merry.Go"Round STUDIO — food ordering (rice dishes), payment via PromptPay QR, admin confirmation flow.

## Tech Stack
- Node.js + Express + @line/bot-sdk v9 + sharp
- Vanilla HTML/CSS/JS frontend (single file: `public/order.html`)
- Cloudflare Tunnel for dev, Railway for production deployment
- No database — all state is in-memory (Maps)

## Project Structure
```
app.js                     # Main server — Express + LINE webhook + order API
public/order.html          # Food ordering web UI (opened from LINE)
images/mgr logo.jpg        # Store logo (note: filename has a space)
images/qr-payment.jpg      # PromptPay QR code for payment
images/slips/              # Customer payment slips (gitignored)
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

## order.html Redesign (in progress, 2026-06-21)
Redesigned from scratch with GrabFood/LINE MAN style UX:

### Design
- Brand: "Merry.Go"Round STUDIO"
- Colors: cream bg #FFFEF5, yellow accent #F9E84A, text-on-yellow #5A4F00, success #27AE60
- Font: Google Fonts Sarabun
- Logo: `/images/mgr%20logo.jpg` (space in filename, URL-encoded)

### Views (4 screens in single page)
1. **Menu** — Hero + category filter pills (ทั้งหมด/ผัด/แกง/ไข่/พิเศษ) + menu cards + floating cart bar
2. **Cart** — Item list with +/- qty + extras pills (ช้อนส้อม/พริกน้ำปลา/ซอส) + confirm button
3. **Payment** — 4-step progress bar + QR PromptPay + order summary + cancel button
4. **Success** — Logo + order ID + summary + ETA

### Cart key system (supports same dish, different meat)
Cart uses composite keys: `"3-หมู"`, `"3-เนื้อ"` for meat-option items, plain `"1"` for no-option items.
This allows ordering e.g. "กะเพรา หมู x2" AND "กะเพรา เนื้อ x1" as separate line items.

### Menu data structure
```js
{ id, name, cat: "ผัด"|"แกง"|"ไข่"|"พิเศษ", price: { default: N } | { หมู: N, เนื้อ: N } }
```
- Items with `price.default` have no meat choice
- Items with `price.หมู/เนื้อ` show meat toggle pills

### API contract (order.html → app.js)
```
POST /api/order
Body: { token, items: [{name, type, qty, unitPrice, totalPrice, price}], addons: [...], total }
```
Token comes from URL param `?t={token}` (30-min TTL, created by bot when user taps Food).

## Remaining work / known issues
- **Drinks menu**: placeholder only ("กำลังจะมาเร็วๆ นี้") — needs full implementation
- **No database**: orders, sessions, counter all in-memory — lost on restart
- **order.html UX**: user is reviewing and adjusting screen-by-screen (session ongoing)
- **Production deployment**: Railway config exists (`railway.json`, `Procfile`) but not yet deployed — still running production from local machine via Cloudflare Tunnel
- **PROJECT-DNA.md**: full project context file exists for use in Claude Chat conversations

## Commands
```bash
npm run dev          # Dev server with nodemon (no tunnel)
npm run dev:tunnel   # start-dev.bat (server + tunnel + webhook)
npm start            # Production server
```
