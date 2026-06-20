const express = require("express");
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

// ==================== ข้อมูลเมนู ====================

const MENU = [
  { id: 1, name: "ไข่เจียวหมูสับ", pork: 60, beef: null },
  { id: 2, name: "ผัดกะเพรา", pork: 70, beef: 80 },
  { id: 3, name: "น้ำมันหอย", pork: 70, beef: 80 },
  { id: 4, name: "เต้าเจี้ยวผัดโหระพา", pork: 70, beef: 80 },
  { id: 5, name: "ผัดพริกเผา", pork: 70, beef: 80 },
  { id: 6, name: "ผัดพริกแกง", pork: 70, beef: 80 },
  { id: 7, name: "กระเทียมพริกไทย", pork: 70, beef: 80 },
  { id: 8, name: "พะแนง", pork: 80, beef: 90 },
  { id: 9, name: "ผัดพริกแกงใต้", pork: 80, beef: 90 },
  { id: 10, name: "ผัดพริกเกลือ", pork: 80, beef: 90 },
  { id: 11, name: "ผัดไข่เค็ม", pork: 90, beef: 100 },
  { id: 12, name: "เขียวหวานผัดแห้ง", pork: 90, beef: 100 },
  { id: 13, name: "ไข่ระเบิด", pork: 90, beef: null },
  { id: 14, name: "ผัดผงกะหรี่", pork: 90, beef: 100 },
];

const EXTRAS = [
  { id: "egg_sunny", label: "ไข่ดาว", price: 15 },
  { id: "egg_open", label: "ไข่เปิดดาว", price: 20 },
  { id: "egg_omelet", label: "ไข่เจียว", price: 20 },
  { id: "side_dish", label: "ทำเป็นกับข้าว", price: 50 },
  { id: "none", label: "ไม่เพิ่มอะไร", price: 0 },
];

const ADDONS = [
  { id: "spoon", label: "ช้อนส้อม" },
  { id: "chili", label: "พริกน้ำปลา" },
  { id: "sauce", label: "ซอส" },
];

// ==================== Session & Orders ====================

const sessions = new Map();
const pendingOrders = new Map();
let orderCounter = 0;

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      state: "idle",
      currentItem: null,
      cart: [],
      addons: [],
      orderId: null,
    });
  }
  return sessions.get(userId);
}

function buildSummaryText(cart, addons) {
  let total = 0;
  const lines = cart.map((item, i) => {
    total += item.totalPrice;
    let line = `${i + 1}. ${item.name}`;
    if (item.extra) line += ` + ${item.extra}`;
    line += ` = ${item.totalPrice}.-`;
    return line;
  });
  if (addons && addons.length > 0) {
    const addonLabels = addons
      .map((id) => ADDONS.find((a) => a.id === id))
      .filter(Boolean)
      .map((a) => a.label);
    lines.push(`\n🛒 เพิ่มเติม: ${addonLabels.join(", ")}`);
  }
  return { text: lines.join("\n"), total };
}

// ==================== Express ====================

const app = express();

app.use("/images", express.static(path.join(__dirname, "images")));

app.get("/", (_req, res) => res.send("MGR LINE Chatbot is running!"));

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

// ==================== Event Handler ====================

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
    if (event.message.type === "image") {
      return handleImage(event.replyToken, userId, event.message.id);
    }
    if (event.message.type === "text") {
      return handleText(event.replyToken, userId, event.message.text.trim());
    }
  }

  return null;
}

// ==================== Text Handler ====================

async function handleText(replyToken, userId, text) {
  const session = getSession(userId);

  if (session.state === "await_slip") {
    return reply(replyToken, [
      {
        type: "text",
        text: "📸 กรุณาส่งรูปสลิปการโอนเงินมาเลยครับ\nหรือกด \"ยกเลิกออเดอร์\" เพื่อยกเลิก",
        quickReply: {
          items: [
            {
              type: "action",
              action: {
                type: "postback",
                label: "❌ ยกเลิกออเดอร์",
                data: "a=cancel",
                displayText: "ยกเลิกออเดอร์",
              },
            },
          ],
        },
      },
    ]);
  }

  if (text === "อาหาร" || text === "เมนูอาหาร") {
    session.state = "idle";
    session.currentItem = null;
    return showFoodMenu(replyToken);
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
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
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
      const adminBubble = {
        type: "bubble",
        header: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: `💳 สลิปออเดอร์ #${orderId}`,
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
            {
              type: "text",
              text: order.summary,
              size: "sm",
              wrap: true,
            },
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
          contents: [
            {
              type: "button",
              style: "primary",
              color: "#27AE60",
              action: {
                type: "postback",
                label: "✅ ยืนยันการชำระเงิน",
                data: `a=admin_confirm&oid=${orderId}`,
                displayText: `ยืนยันการชำระเงิน ออเดอร์ #${orderId}`,
              },
            },
            {
              type: "button",
              style: "secondary",
              margin: "sm",
              action: {
                type: "postback",
                label: "❌ ปฏิเสธ",
                data: `a=admin_reject&oid=${orderId}`,
                displayText: `ปฏิเสธ ออเดอร์ #${orderId}`,
              },
            },
          ],
          paddingAll: "15px",
        },
      };

      await client.pushMessage({
        to: ADMIN_ID,
        messages: [
          {
            type: "flex",
            altText: `💳 สลิปออเดอร์ #${orderId} - รวม ${order.total}.-`,
            contents: adminBubble,
          },
        ],
      });
    }
  } catch (err) {
    console.error("Slip handling error:", err.message);
    return reply(replyToken, [
      { type: "text", text: "❌ เกิดข้อผิดพลาด กรุณาส่งสลิปอีกครั้งครับ" },
    ]);
  }
}

// ==================== Postback Handler ====================

async function handlePostback(replyToken, userId, data) {
  const params = new URLSearchParams(data);
  const action = params.get("a");
  const session = getSession(userId);

  // --- ขั้นตอน 1: เลือกเมนู ---
  if (action === "menu") {
    const item = MENU.find((m) => m.id === +params.get("id"));
    if (!item) return;

    if (item.beef !== null) {
      session.state = "select_meat";
      session.currentItem = { id: item.id, name: item.name };
      return showMeatSelection(replyToken, item);
    }

    session.state = "select_extra";
    session.currentItem = {
      id: item.id,
      name: item.name,
      meat: null,
      price: item.pork,
    };
    return showExtras(replyToken, `ข้าวราด ${item.name}`, item.pork);
  }

  // --- ขั้นตอน 2: เลือกเนื้อสัตว์ ---
  if (action === "meat") {
    const meat = params.get("t");
    const item = MENU.find((m) => m.id === session.currentItem.id);
    const price = meat === "beef" ? item.beef : item.pork;
    const meatLabel = meat === "beef" ? "เนื้อ" : "หมู";

    session.state = "select_extra";
    session.currentItem.meat = meatLabel;
    session.currentItem.price = price;

    return showExtras(replyToken, `ข้าวราด ${item.name} ${meatLabel}`, price);
  }

  // --- ขั้นตอน 3: เลือกเพิ่มเติม ---
  if (action === "extra") {
    const extra = EXTRAS.find((e) => e.id === params.get("id"));
    const cur = session.currentItem;

    const itemName = cur.meat
      ? `ข้าวราด ${cur.name} ${cur.meat}`
      : `ข้าวราด ${cur.name}`;

    session.cart.push({
      name: itemName,
      extra: extra.id !== "none" ? extra.label : null,
      extraPrice: extra.price,
      basePrice: cur.price,
      totalPrice: cur.price + extra.price,
    });

    session.state = "idle";
    session.currentItem = null;

    return showOrderSummary(replyToken, session);
  }

  // --- สั่งเพิ่ม ---
  if (action === "more") {
    session.state = "idle";
    session.currentItem = null;
    return showFoodMenu(replyToken);
  }

  // --- ขั้นตอน 4→4.5: ยืนยัน → เลือกสิ่งที่ต้องการเพิ่ม ---
  if (action === "confirm") {
    session.addons = [];
    return showAddonsSelection(replyToken, session);
  }

  // --- toggle addon ---
  if (action === "addon") {
    const addonId = params.get("id");
    const idx = session.addons.indexOf(addonId);
    if (idx === -1) {
      session.addons.push(addonId);
    } else {
      session.addons.splice(idx, 1);
    }
    return showAddonsSelection(replyToken, session);
  }

  // --- ยืนยัน addons → ไปชำระเงิน ---
  if (action === "addon_done") {
    return confirmAndShowPayment(replyToken, userId, session);
  }

  // --- ยกเลิก ---
  if (action === "cancel") {
    if (session.orderId) {
      pendingOrders.delete(session.orderId);
    }
    session.cart = [];
    session.addons = [];
    session.state = "idle";
    session.currentItem = null;
    session.orderId = null;
    return reply(replyToken, [
      { type: "text", text: "❌ ยกเลิกออเดอร์แล้วครับ" },
    ]);
  }

  // --- ขั้นตอน 7: แอดมินยืนยันการชำระเงิน ---
  if (action === "admin_confirm") {
    return adminConfirmPayment(replyToken, params.get("oid"));
  }

  // --- แอดมินปฏิเสธ ---
  if (action === "admin_reject") {
    return adminRejectPayment(replyToken, params.get("oid"));
  }
}

// ==================== ขั้นตอน 1: แสดงเมนูอาหาร ====================

function showFoodMenu(replyToken) {
  const rows = [];

  MENU.forEach((item, i) => {
    if (i > 0) rows.push({ type: "separator", color: "#EEEEEE" });

    const priceText =
      item.beef !== null
        ? `หมู ${item.pork}.- / เนื้อ ${item.beef}.-`
        : `${item.pork}.-`;

    rows.push({
      type: "box",
      layout: "horizontal",
      spacing: "md",
      alignItems: "center",
      contents: [
        {
          type: "box",
          layout: "vertical",
          flex: 7,
          contents: [
            {
              type: "text",
              text: `ข้าวราด ${item.name}`,
              size: "sm",
              weight: "bold",
              wrap: true,
            },
            {
              type: "text",
              text: priceText,
              size: "xs",
              color: "#888888",
            },
          ],
        },
        {
          type: "button",
          style: "primary",
          color: "#E85D3A",
          height: "sm",
          flex: 3,
          action: {
            type: "postback",
            label: "สั่ง",
            data: `a=menu&id=${item.id}`,
            displayText: `สั่ง ข้าวราด ${item.name}`,
          },
        },
      ],
      paddingTop: "10px",
      paddingBottom: "10px",
      paddingStart: "15px",
      paddingEnd: "15px",
    });
  });

  const bubble = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "horizontal",
      contents: [
        {
          type: "text",
          text: "🍱 เมนูอาหาร",
          weight: "bold",
          size: "xl",
          color: "#E85D3A",
          flex: 7,
        },
        {
          type: "text",
          text: `${MENU.length} รายการ`,
          size: "xs",
          color: "#999999",
          align: "end",
          flex: 3,
          gravity: "center",
        },
      ],
      backgroundColor: "#FFF8E7",
      paddingAll: "15px",
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: rows,
      paddingAll: "0px",
    },
  };

  return reply(replyToken, [
    {
      type: "flex",
      altText: "🍱 เมนูอาหาร - กดเลือกเมนูที่ต้องการ",
      contents: bubble,
    },
  ]);
}

// ==================== ขั้นตอน 2: เลือกเนื้อสัตว์ ====================

function showMeatSelection(replyToken, item) {
  const bubble = {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: `ข้าวราด ${item.name}`,
          weight: "bold",
          size: "lg",
        },
        {
          type: "text",
          text: "เลือกประเภทเนื้อสัตว์",
          size: "sm",
          color: "#888888",
          margin: "sm",
        },
      ],
      backgroundColor: "#FFF8E7",
      paddingAll: "15px",
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#E85D3A",
          height: "md",
          action: {
            type: "postback",
            label: `🐷 หมู — ${item.pork}.-`,
            data: "a=meat&t=pork",
            displayText: "เลือก หมู",
          },
        },
        {
          type: "button",
          style: "primary",
          color: "#8B4513",
          height: "md",
          action: {
            type: "postback",
            label: `🐂 เนื้อ — ${item.beef}.-`,
            data: "a=meat&t=beef",
            displayText: "เลือก เนื้อ",
          },
        },
      ],
      paddingAll: "15px",
    },
  };

  return reply(replyToken, [
    {
      type: "flex",
      altText: `เลือกเนื้อสัตว์สำหรับ ${item.name}`,
      contents: bubble,
    },
  ]);
}

// ==================== ขั้นตอน 3: เลือกเพิ่มเติม (Quick Reply) ====================

function showExtras(replyToken, itemName, basePrice) {
  return reply(replyToken, [
    {
      type: "text",
      text: `✅ ${itemName} (${basePrice}.-)\n\nเพิ่มอะไรไหมครับ?`,
      quickReply: {
        items: EXTRAS.map((ex) => ({
          type: "action",
          action: {
            type: "postback",
            label: ex.price > 0 ? `${ex.label} +${ex.price}.-` : ex.label,
            data: `a=extra&id=${ex.id}`,
            displayText:
              ex.price > 0 ? `เพิ่ม ${ex.label} (+${ex.price}.-)` : ex.label,
          },
        })),
      },
    },
  ]);
}

// ==================== ขั้นตอน 4: สรุปออเดอร์ ====================

function showOrderSummary(replyToken, session) {
  const cart = session.cart;
  let grandTotal = 0;

  const itemRows = [];
  cart.forEach((item, i) => {
    grandTotal += item.totalPrice;

    itemRows.push({
      type: "box",
      layout: "horizontal",
      contents: [
        {
          type: "text",
          text: `${i + 1}. ${item.name}`,
          size: "sm",
          flex: 7,
          wrap: true,
        },
        {
          type: "text",
          text: `${item.basePrice}.-`,
          size: "sm",
          align: "end",
          flex: 3,
        },
      ],
    });

    if (item.extra) {
      itemRows.push({
        type: "box",
        layout: "horizontal",
        contents: [
          {
            type: "text",
            text: `    + ${item.extra}`,
            size: "xs",
            color: "#888888",
            flex: 7,
          },
          {
            type: "text",
            text: `+${item.extraPrice}.-`,
            size: "xs",
            color: "#888888",
            align: "end",
            flex: 3,
          },
        ],
      });
    }
  });

  const bubble = {
    type: "bubble",
    header: {
      type: "box",
      layout: "horizontal",
      contents: [
        {
          type: "text",
          text: "🧾 สรุปออเดอร์",
          weight: "bold",
          size: "lg",
          color: "#E85D3A",
          flex: 7,
        },
        {
          type: "text",
          text: `${cart.length} รายการ`,
          size: "sm",
          color: "#999999",
          align: "end",
          flex: 3,
          gravity: "center",
        },
      ],
      backgroundColor: "#FFF8E7",
      paddingAll: "15px",
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        ...itemRows,
        { type: "separator", margin: "lg" },
        {
          type: "box",
          layout: "horizontal",
          margin: "md",
          contents: [
            {
              type: "text",
              text: "💰 รวมทั้งหมด",
              weight: "bold",
              size: "md",
              flex: 7,
            },
            {
              type: "text",
              text: `${grandTotal}.-`,
              weight: "bold",
              size: "lg",
              color: "#E85D3A",
              align: "end",
              flex: 3,
            },
          ],
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
            label: "✅ ยืนยันออเดอร์",
            data: "a=confirm",
            displayText: "ยืนยันออเดอร์",
          },
        },
        {
          type: "box",
          layout: "horizontal",
          spacing: "sm",
          contents: [
            {
              type: "button",
              style: "secondary",
              flex: 1,
              action: {
                type: "postback",
                label: "➕ สั่งเพิ่ม",
                data: "a=more",
                displayText: "สั่งเพิ่ม",
              },
            },
            {
              type: "button",
              style: "secondary",
              color: "#F5F5F5",
              flex: 1,
              action: {
                type: "postback",
                label: "❌ ยกเลิก",
                data: "a=cancel",
                displayText: "ยกเลิกออเดอร์",
              },
            },
          ],
        },
      ],
      paddingAll: "15px",
    },
  };

  return reply(replyToken, [
    {
      type: "flex",
      altText: `🧾 สรุปออเดอร์ ${cart.length} รายการ - รวม ${grandTotal}.-`,
      contents: bubble,
    },
  ]);
}

// ==================== ขั้นตอน 4.5: เลือกสิ่งที่ต้องการเพิ่ม ====================

function showAddonsSelection(replyToken, session) {
  const checkboxRows = ADDONS.map((addon) => {
    const selected = session.addons.includes(addon.id);
    return {
      type: "button",
      style: selected ? "primary" : "secondary",
      color: selected ? "#27AE60" : "#F0F0F0",
      height: "sm",
      margin: "sm",
      action: {
        type: "postback",
        label: `${selected ? "☑" : "☐"} ${addon.label}`,
        data: `a=addon&id=${addon.id}`,
        displayText: `${selected ? "ยกเลิก" : "เพิ่ม"} ${addon.label}`,
      },
    };
  });

  const selectedCount = session.addons.length;
  const subtitle =
    selectedCount > 0
      ? `เลือกแล้ว ${selectedCount} รายการ`
      : "แตะเพื่อเลือก (เลือกได้หลายอย่าง)";

  const bubble = {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "🛒 สิ่งที่ต้องการเพิ่ม",
          weight: "bold",
          size: "lg",
          color: "#E85D3A",
        },
        {
          type: "text",
          text: subtitle,
          size: "sm",
          color: "#888888",
          margin: "sm",
        },
      ],
      backgroundColor: "#FFF8E7",
      paddingAll: "15px",
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: checkboxRows,
      paddingAll: "15px",
    },
    footer: {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#27AE60",
          flex: 1,
          action: {
            type: "postback",
            label: "✅ ยืนยัน",
            data: "a=addon_done",
            displayText: "ยืนยัน",
          },
        },
        {
          type: "button",
          style: "secondary",
          flex: 1,
          action: {
            type: "postback",
            label: "ไม่ต้องการ",
            data: "a=addon_done",
            displayText: "ไม่ต้องการเพิ่มอะไร",
          },
        },
      ],
      paddingAll: "15px",
    },
  };

  return reply(replyToken, [
    {
      type: "flex",
      altText: "🛒 เลือกสิ่งที่ต้องการเพิ่ม",
      contents: bubble,
    },
  ]);
}

// ==================== ขั้นตอน 5: ยืนยัน → แสดง QR Code ====================

async function confirmAndShowPayment(replyToken, userId, session) {
  const { text: summary, total } = buildSummaryText(session.cart, session.addons);

  orderCounter++;
  const orderId = `MGR${String(orderCounter).padStart(4, "0")}`;

  pendingOrders.set(orderId, {
    userId,
    cart: [...session.cart],
    addons: [...session.addons],
    summary,
    total,
    state: "await_slip",
  });

  session.state = "await_slip";
  session.orderId = orderId;

  const qrUrl = `${BASE_URL}/images/qr-payment.jpg`;

  const paymentBubble = {
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
        {
          type: "text",
          text: summary,
          size: "sm",
          color: "#666666",
          wrap: true,
        },
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
      ],
      paddingAll: "15px",
    },
  };

  if (ADMIN_ID) {
    try {
      await client.pushMessage({
        to: ADMIN_ID,
        messages: [
          {
            type: "text",
            text: `📋 ออเดอร์ใหม่ #${orderId}\n\n${summary}\n\n💰 รวม: ${total}.-\n⏳ รอชำระเงิน`,
          },
        ],
      });
    } catch (err) {
      console.error("Failed to notify admin:", err.message);
    }
  }

  return reply(replyToken, [
    {
      type: "flex",
      altText: `💳 กรุณาโอนเงิน ${total} บาท - ออเดอร์ #${orderId}`,
      contents: paymentBubble,
    },
  ]);
}

// ==================== ขั้นตอน 7: แอดมินยืนยัน/ปฏิเสธ ====================

async function adminConfirmPayment(replyToken, orderId) {
  const order = pendingOrders.get(orderId);
  if (!order) {
    return reply(replyToken, [
      { type: "text", text: `❌ ไม่พบออเดอร์ #${orderId}` },
    ]);
  }

  const customerSession = getSession(order.userId);
  customerSession.cart = [];
  customerSession.addons = [];
  customerSession.state = "idle";
  customerSession.currentItem = null;
  customerSession.orderId = null;

  pendingOrders.delete(orderId);

  try {
    await client.pushMessage({
      to: order.userId,
      messages: [
        {
          type: "text",
          text: `✅ ชำระเงินเรียบร้อยแล้ว!\n\n📋 ออเดอร์ #${orderId}\n${order.summary}\n💰 รวม: ${order.total}.-\n\nกำลังเตรียมอาหารให้นะครับ 🍱`,
        },
      ],
    });
  } catch (err) {
    console.error("Failed to notify customer:", err.message);
  }

  return reply(replyToken, [
    {
      type: "text",
      text: `✅ ยืนยันชำระเงินออเดอร์ #${orderId} แล้ว\nแจ้งลูกค้าเรียบร้อย`,
    },
  ]);
}

async function adminRejectPayment(replyToken, orderId) {
  const order = pendingOrders.get(orderId);
  if (!order) {
    return reply(replyToken, [
      { type: "text", text: `❌ ไม่พบออเดอร์ #${orderId}` },
    ]);
  }

  const customerSession = getSession(order.userId);
  customerSession.state = "await_slip";

  try {
    await client.pushMessage({
      to: order.userId,
      messages: [
        {
          type: "text",
          text: `❌ สลิปออเดอร์ #${orderId} ยังไม่ผ่านการตรวจสอบ\n\nกรุณาโอนเงิน ${order.total} บาท แล้วส่งสลิปใหม่อีกครั้งครับ`,
        },
      ],
    });
  } catch (err) {
    console.error("Failed to notify customer:", err.message);
  }

  return reply(replyToken, [
    {
      type: "text",
      text: `❌ ปฏิเสธสลิปออเดอร์ #${orderId}\nแจ้งลูกค้าให้ส่งสลิปใหม่แล้ว`,
    },
  ]);
}

// ==================== Helper ====================

function reply(replyToken, messages) {
  return client.replyMessage({ replyToken, messages });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MGR LINE Chatbot running on port ${PORT}`));
