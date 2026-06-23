# MGR LINE Chatbot - Project DNA

## Overview
LINE Chatbot สำหรับร้าน MGR สั่งอาหาร/กาแฟ รันบน Node.js + Express เชื่อมต่อ LINE Messaging API ผ่าน Cloudflare Tunnel (dev) หรือ Railway (production)

## Tech Stack
- **Runtime**: Node.js
- **Framework**: Express
- **LINE SDK**: @line/bot-sdk v9 (MessagingApiClient, MessagingApiBlobClient)
- **Image processing**: sharp (สร้าง Rich Menu image)
- **Dev**: nodemon
- **Tunnel**: Cloudflare Tunnel (cloudflared) สำหรับ dev ให้ LINE webhook เข้าถึง localhost ได้
- **Deployment target**: Railway (มี railway.json + Procfile อยู่แล้ว)

## Project Structure
```
mgr-line-chatbot/
├── app.js                    # Main server - Express + LINE webhook handler
├── package.json
├── .env                      # Production credentials (gitignored)
├── .env.development          # Dev credentials (gitignored)
├── public/
│   └── order.html            # หน้าเว็บสั่งอาหาร (LIFF-like, เปิดจาก LINE)
├── images/
│   ├── qr-payment.jpg        # QR Code PromptPay สำหรับชำระเงิน
│   └── slips/                # เก็บรูปสลิปที่ลูกค้าส่ง (gitignored)
├── setup-rich-menu.js        # สร้าง Rich Menu (3 ปุ่ม: Food, Drinks, Contact)
├── create-rich-menu.js       # อีกเวอร์ชันของ rich menu setup
├── generate-rich-menu-image.js
├── update-webhook.js         # อัพเดท LINE webhook URL อัตโนมัติ
├── start-all.bat             # รัน production (server + tunnel + webhook update)
├── start-dev.bat             # รัน dev mode (ใช้ .env.development)
├── monitor.bat               # Health check monitor
├── railway.json              # Railway deployment config
└── Procfile                  # Railway start command
```

## Environment Variables
```
PORT=3000
CHANNEL_SECRET=xxx          # LINE Channel Secret
CHANNEL_ACCESS_TOKEN=xxx    # LINE Channel Access Token (long-lived)
ADMIN_USER_ID=xxx           # LINE User ID ของแอดมิน (รับแจ้งออเดอร์)
BASE_URL=https://xxx        # Public URL (tunnel URL หรือ Railway URL)
```

## Environment Separation
- `NODE_ENV=production` (default) → โหลด `.env`
- `NODE_ENV=development` → โหลด `.env.development`
- Dev ใช้ LINE Channel แยกจาก Production เพื่อไม่กระทบลูกค้า
- app.js บรรทัดแรกเลือก env file อัตโนมัติ

## How It Works (Order Flow)

### 1. ลูกค้ากดสั่งอาหาร
- ลูกค้ากดปุ่ม "Food" ที่ Rich Menu → bot ส่งข้อความ "อาหาร"
- handleText() สร้าง token (crypto.randomBytes, TTL 30 นาที)
- ส่ง Flex Message มีปุ่ม URI → เปิด `order.html?t={token}`

### 2. ลูกค้าเลือกเมนูในเว็บ
- order.html แสดงเมนูอาหาร 15 รายการ (ข้าวราดต่างๆ)
- เลือกหมู/เนื้อ, จำนวน, ของเพิ่ม (ช้อนส้อม/พริกน้ำปลา/ซอส)
- กด "ยืนยันออเดอร์" → POST /api/order พร้อม token

### 3. Server รับออเดอร์
- ตรวจ token validity
- สร้าง orderId (MGR0001, MGR0002, ...)
- เก็บใน pendingOrders Map (in-memory)
- push Flex Message ให้ลูกค้า → แสดง QR PromptPay + สรุปออเดอร์
- push แจ้ง Admin → ออเดอร์ใหม่
- Session state → "await_slip"

### 4. ลูกค้าส่งสลิป
- handleImage() รับรูปสลิปผ่าน LINE Blob API
- บันทึกไฟล์ที่ images/slips/{orderId}.jpg
- push Flex Message ให้ Admin → แสดงสลิป + ปุ่ม "ยืนยัน" / "ปฏิเสธ"
- Session state → "await_confirm"

### 5. Admin ยืนยัน/ปฏิเสธ
- admin_confirm → แจ้งลูกค้า "ชำระเรียบร้อย กำลังเตรียมอาหาร"
- admin_reject → แจ้งลูกค้า "สลิปไม่ผ่าน กรุณาส่งใหม่"

## Session States
```
idle → (สั่งอาหาร) → await_slip → (ส่งสลิป) → await_confirm → (admin ยืนยัน) → idle
                        ↑                                          |
                        └──────── (admin ปฏิเสธ) ─────────────────┘
```

## Data Storage
- **In-memory** ทั้งหมด (Map objects) — ไม่มี database
  - `sessions`: Map<userId, {state, orderId}>
  - `pendingOrders`: Map<orderId, {userId, summary, total, state, slipUrl}>
  - `orderTokens`: Map<token, {userId, createdAt}> — TTL 30 min, cleanup ทุก 5 min
  - `orderCounter`: running number (reset เมื่อ restart server)

## Menu Data (hardcoded in order.html)
```
ไข่เจียว 50, ไข่เจียวหมูสับ 60
ผัดกะเพรา/น้ำมันหอย/เต้าเจี้ยว/พริกเผา/พริกแกง/กระเทียม: หมู 70 เนื้อ 80
พะแนง/พริกแกงใต้/พริกเกลือ: หมู 80 เนื้อ 90
ผัดไข่เค็ม/เขียวหวาน/หมูสับไข่ระเบิด/ผัดผงกะหรี่: หมู 90 เนื้อ 100
```

## Rich Menu (3 ปุ่ม)
| ปุ่ม | สี | Action | ข้อความ |
|-----|-----|--------|--------|
| Food | #E85D3A (ส้ม) | message | "อาหาร" |
| Drinks & Coffee | #6F4E37 (น้ำตาล) | message | "เครื่องดื่มและกาแฟ" |
| Contact | #2196F3 (น้ำเงิน) | message | "ติดต่อเจ้าหน้าที่" |

## LINE Flex Messages ที่ใช้
1. **เปิดเมนูอาหาร** - Bubble มีปุ่ม URI ไปหน้า order.html
2. **ชำระเงิน** - Bubble มี QR Code + สรุปออเดอร์ + ปุ่มยกเลิก
3. **สลิปแจ้ง Admin** - Bubble มีรูปสลิป + สรุป + ปุ่มยืนยัน/ปฏิเสธ
4. **ยืนยันแล้ว (Admin view)** - Bubble สรุป + ปุ่มยกเลิก/คืนเงิน

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | / | Health text |
| GET | /health | Health JSON |
| POST | /webhook | LINE webhook (มี signature verification middleware) |
| POST | /api/order | รับออเดอร์จากเว็บ (ต้องมี token) |
| GET | /images/* | Static files (QR, slips) |
| GET | /order.html | หน้าสั่งอาหาร |

## Running
```bash
# Production (ลูกค้าใช้)
start-all.bat           # เปิด server + tunnel + อัพเดท webhook

# Development (ทดสอบ ไม่กระทบลูกค้า)
start-dev.bat           # เหมือน start-all แต่ใช้ .env.development
npm run dev             # nodemon + .env.development (ไม่มี tunnel)
```

## Pending / Future Features
- เมนูเครื่องดื่ม/กาแฟ (ยังเป็น placeholder: "กำลังจะมาเร็วๆ นี้")
- ยังไม่มี database (ข้อมูลหายเมื่อ restart)
- ยังไม่มี order history / dashboard

## Brand Colors
- Primary: #E85D3A (ส้มแดง)
- Success: #27AE60 (เขียว)
- Coffee: #6F4E37 (น้ำตาล)
- Info: #2196F3 (น้ำเงิน)

## LINE OA
- LINE OA ID: @616molde
