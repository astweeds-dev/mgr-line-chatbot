const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { middleware, messagingApi } = require("@line/bot-sdk");
require("dotenv").config();

const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
const ADMIN_ID = process.env.ADMIN_USER_ID;
const BASE_URL = process.env.BASE_URL;

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

// ==================== Session, Orders, Tokens ====================

const sessions = new Map();
const pendingOrders = new Map();
const orderTokens = new Map();
let orderCounter = 0;

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

// ==================== Express ====================

const app = express();

app.use("/images", express.static(path.join(__dirname, "images")));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => res.send("MGR LINE Chatbot is running!"));
app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

// ==================== API: รับออเดอร์จากเว็บ ====================

app.post("/api/order", express.json(), async (req, res) => {
  try {
    const { token, items, addons, total } = req.body;

    const tokenData = orderTokens.get(token);
    if (!tokenData) {
      return res.status(401).json({ error: "ลิงก์หมดอายุ กรุณากดปุ่ม Food อีกครั้ง" });
    }
    const userId = tokenData.userId;
    orderTokens.delete(token);

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "กรุณาเลือกอย่างน้อย 1 เมนู" });
    }

    orderCounter++;
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

    pendingOrders.set(orderId, {
      userId,
      summary,
      total,
      state: "await_slip",
    });

    const session = getSession(userId);
    session.state = "await_slip";
    session.orderId = orderId;

    const qrUrl = `${BASE_URL}/images/qr-payment.jpg`;
    await client.pushMessage({
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
                  text: "📸 โอนเสร็จแล้ว ส่งรูปสลิปมาเลยครับ",
                  size: "sm",
                  color: "#27AE60",
                  align: "center",
                  weight: "bold",
                  wrap: true,
                },
                {
                  type: "button",
                  style: "secondary",
                  margin: "md",
                  height: "sm",
                  action: {
                    type: "postback",
                    label: "❌ ยกเลิกออเดอร์",
                    data: "a=cancel",
                    displayText: "ยกเลิกออเดอร์",
                  },
                },
              ],
              paddingAll: "15px",
            },
          },
        },
      ],
    });

    if (ADMIN_ID) {
      await client.pushMessage({
        to: ADMIN_ID,
        messages: [
          {
            type: "text",
            text: `📋 ออเดอร์ใหม่ #${orderId}\n\n${summary}\n\n💰 รวม: ${total}.-\n⏳ รอชำระเงิน`,
          },
        ],
      });
    }

    res.json({ success: true, orderId });
  } catch (err) {
    console.error("Order error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ==================== LINE Webhook ====================

app.post(
  "/webhook",
  middleware({ channelSecret: config.channelSecret }),
  (req, res) => {
    Promise.all(req.body.events.map(handleEvent))
      .then(() => res.json({ success: true }))
      .catch((err) => {
        console.error(err);
        res.status(500).end();
      });
  }
);

async function handleEvent(event) {
  const userId = event.source.userId;

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
    if (event.message.type === "text")
      return handleText(event.replyToken, userId, event.message.text.trim());
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

  if (text === "อาหาร" || text === "เมนูอาหาร" || text === "สั่งอาหาร") {
    const token = createToken(userId);
    const orderUrl = `${BASE_URL}/order.html?t=${token}`;

    return reply(replyToken, [
      {
        type: "flex",
        altText: "🍱 กดเพื่อเปิดเมนูอาหาร",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "🍱 MGR สั่งอาหาร",
                weight: "bold",
                size: "xl",
                align: "center",
              },
              {
                type: "text",
                text: "เลือกเมนู กดจำนวน ยืนยัน\nจบในหน้าเดียว!",
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
                color: "#E85D3A",
                height: "md",
                action: {
                  type: "uri",
                  label: "🍱 เปิดเมนูอาหาร",
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

  if (text === "เครื่องดื่มและกาแฟ" || text === "เมนูกาแฟ") {
    return reply(replyToken, [
      { type: "text", text: "☕ เมนูเครื่องดื่มกำลังจะมาเร็วๆ นี้ครับ" },
    ]);
  }

  if (text === "ติดต่อเจ้าหน้าที่" || text === "ติดต่อแอดมิน") {
    return reply(replyToken, [
      {
        type: "text",
        text: "📞 ติดต่อร้าน MGR\n📍 ที่อยู่: ร้าน MGR สั่งอาหาร/กาแฟ\n⏰ เวลาเปิด: 08:00 - 20:00 น.\n\nพิมพ์ข้อความไว้ได้เลย เจ้าหน้าที่จะติดต่อกลับครับ",
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

// ==================== Image Handler (รับสลิป) ====================

async function handleImage(replyToken, userId, messageId) {
  const session = getSession(userId);

  if (session.state !== "await_slip" || !session.orderId) {
    return reply(replyToken, [
      { type: "text", text: "📸 หากต้องการส่งสลิป กรุณาสั่งอาหารก่อนนะครับ" },
    ]);
  }

  const order = pendingOrders.get(session.orderId);
  if (!order) return;
  const orderId = session.orderId;

  try {
    const stream = await blobClient.getMessageContent(messageId);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const slipDir = path.join(__dirname, "images", "slips");
    if (!fs.existsSync(slipDir)) fs.mkdirSync(slipDir, { recursive: true });
    const slipFile = `${orderId}.jpg`;
    fs.writeFileSync(path.join(slipDir, slipFile), buffer);

    const slipUrl = `${BASE_URL}/images/slips/${slipFile}`;
    order.slipUrl = slipUrl;
    order.state = "slip_sent";
    session.state = "await_confirm";

    await reply(replyToken, [
      {
        type: "text",
        text: "✅ ได้รับสลิปแล้วครับ\nรอการยืนยันจากร้านค้าสักครู่นะครับ 🙏",
      },
    ]);

    if (ADMIN_ID) {
      await client.pushMessage({
        to: ADMIN_ID,
        messages: [
          {
            type: "flex",
            altText: `💳 สลิป #${orderId} - รวม ${order.total}.-`,
            contents: {
              type: "bubble",
              header: {
                type: "box",
                layout: "vertical",
                contents: [
                  {
                    type: "text",
                    text: `💳 สลิป #${orderId}`,
                    weight: "bold",
                    size: "lg",
                    color: "#E85D3A",
                  },
                ],
                backgroundColor: "#FFF8E7",
                paddingAll: "15px",
              },
              hero: {
                type: "image",
                url: slipUrl,
                size: "full",
                aspectRatio: "1:1.4",
                aspectMode: "fit",
              },
              body: {
                type: "box",
                layout: "vertical",
                spacing: "sm",
                contents: [
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
          },
        ],
      });
    }
  } catch (err) {
    console.error("Slip error:", err.message);
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
    const session = getSession(userId);
    if (session.orderId) pendingOrders.delete(session.orderId);
    session.state = "idle";
    session.orderId = null;
    return reply(replyToken, [
      { type: "text", text: "❌ ยกเลิกออเดอร์แล้วครับ" },
    ]);
  }

  if (action === "admin_confirm") {
    const orderId = params.get("oid");
    const order = pendingOrders.get(orderId);
    if (!order)
      return reply(replyToken, [{ type: "text", text: `❌ ไม่พบออเดอร์ #${orderId}` }]);
    if (order.state === "confirmed")
      return reply(replyToken, [{ type: "text", text: `⚠️ ออเดอร์ #${orderId} ยืนยันไปแล้ว` }]);

    const cs = getSession(order.userId);
    cs.state = "idle";
    cs.orderId = null;
    order.state = "confirmed";

    const now = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });

    await client.pushMessage({
      to: order.userId,
      messages: [
        {
          type: "text",
          text: `✅ ชำระเงินเรียบร้อยแล้ว!\n\n📋 ออเดอร์ #${orderId}\n${order.summary}\n💰 รวม: ${order.total}.-\n\nกำลังเตรียมอาหารให้นะครับ 🍱`,
        },
      ],
    });

    return reply(replyToken, [
      {
        type: "flex",
        altText: `✅ ยืนยัน #${orderId} แล้ว`,
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            spacing: "md",
            contents: [
              {
                type: "text",
                text: `✅ ยืนยันแล้ว - ${now}`,
                weight: "bold",
                color: "#27AE60",
                wrap: true,
              },
              {
                type: "text",
                text: `📋 #${orderId}\n${order.summary}\n💰 รวม: ${order.total}.-`,
                size: "sm",
                color: "#888888",
                wrap: true,
              },
            ],
            paddingAll: "15px",
          },
          footer: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "button",
                style: "secondary",
                action: {
                  type: "postback",
                  label: "❌ ยกเลิก/คืนเงิน",
                  data: `a=admin_reject&oid=${orderId}`,
                  displayText: `ยกเลิก #${orderId}`,
                },
              },
            ],
            paddingAll: "15px",
          },
        },
      },
    ]);
  }

  if (action === "admin_reject") {
    const orderId = params.get("oid");
    const order = pendingOrders.get(orderId);
    if (!order)
      return reply(replyToken, [{ type: "text", text: `❌ ไม่พบออเดอร์ #${orderId}` }]);

    const wasConfirmed = order.state === "confirmed";
    const cs = getSession(order.userId);
    pendingOrders.delete(orderId);

    if (wasConfirmed) {
      cs.state = "idle";
      cs.orderId = null;
      await client.pushMessage({
        to: order.userId,
        messages: [
          {
            type: "text",
            text: `❌ ออเดอร์ #${orderId} ถูกยกเลิกแล้ว\nกรุณาติดต่อเจ้าหน้าที่เรื่องการคืนเงินครับ`,
          },
        ],
      });
      return reply(replyToken, [
        { type: "text", text: `❌ ยกเลิก #${orderId} (หลังยืนยัน) — แจ้งลูกค้าแล้ว` },
      ]);
    }

    cs.state = "await_slip";

    await client.pushMessage({
      to: order.userId,
      messages: [
        {
          type: "text",
          text: `❌ สลิป #${orderId} ยังไม่ผ่าน\nกรุณาโอนเงิน ${order.total} บาท แล้วส่งสลิปใหม่ครับ`,
        },
      ],
    });

    return reply(replyToken, [
      { type: "text", text: `❌ ปฏิเสธ #${orderId} — แจ้งลูกค้าแล้ว` },
    ]);
  }
}

// ==================== Helper ====================

function reply(replyToken, messages) {
  return client.replyMessage({ replyToken, messages });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MGR LINE Chatbot running on port ${PORT}`));
