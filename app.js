const express = require("express");
const { middleware, messagingApi } = require("@line/bot-sdk");
require("dotenv").config();

const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};

const client = new messagingApi.MessagingApiClient({
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

// ==================== Session ====================

const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { state: "idle", currentItem: null, cart: [] });
  }
  return sessions.get(userId);
}

// ==================== Express ====================

const app = express();

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

  if (event.type === "message" && event.message.type === "text") {
    return handleText(event.replyToken, userId, event.message.text.trim());
  }

  return null;
}

// ==================== Text Handler ====================

async function handleText(replyToken, userId, text) {
  const session = getSession(userId);

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

// ==================== Postback Handler ====================

async function handlePostback(replyToken, userId, data) {
  const params = new URLSearchParams(data);
  const action = params.get("a");
  const session = getSession(userId);

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

  if (action === "more") {
    session.state = "idle";
    session.currentItem = null;
    return showFoodMenu(replyToken);
  }

  if (action === "confirm") {
    return confirmOrder(replyToken, userId, session);
  }

  if (action === "cancel") {
    session.cart = [];
    session.state = "idle";
    session.currentItem = null;
    return reply(replyToken, [
      { type: "text", text: "❌ ยกเลิกออเดอร์แล้วครับ" },
    ]);
  }
}

// ==================== ขั้นตอน 1: แสดงเมนูอาหาร ====================

function showFoodMenu(replyToken) {
  const perPage = 7;
  const bubbles = [];

  for (let i = 0; i < MENU.length; i += perPage) {
    const chunk = MENU.slice(i, i + perPage);
    const page = Math.floor(i / perPage) + 1;
    const totalPages = Math.ceil(MENU.length / perPage);

    bubbles.push({
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
            size: "lg",
            color: "#E85D3A",
            flex: 7,
          },
          {
            type: "text",
            text: `${page}/${totalPages}`,
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
        contents: chunk.map((item) => {
          const priceText =
            item.beef !== null
              ? `หมู ${item.pork}.- | เนื้อ ${item.beef}.-`
              : `${item.pork}.-`;

          return {
            type: "box",
            layout: "horizontal",
            spacing: "md",
            contents: [
              {
                type: "box",
                layout: "vertical",
                flex: 7,
                justifyContent: "center",
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
            paddingAll: "8px",
            backgroundColor: "#FFFFFF",
            borderWidth: "1px",
            borderColor: "#F0F0F0",
            cornerRadius: "8px",
          };
        }),
        paddingAll: "12px",
      },
    });
  }

  return reply(replyToken, [
    {
      type: "flex",
      altText: "🍱 เมนูอาหาร - กดเลือกเมนูที่ต้องการ",
      contents: { type: "carousel", contents: bubbles },
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
            label:
              ex.price > 0 ? `${ex.label} +${ex.price}.-` : ex.label,
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

// ==================== ยืนยันออเดอร์ → แจ้งแอดมิน ====================

async function confirmOrder(replyToken, userId, session) {
  const cart = session.cart;
  let grandTotal = 0;

  let lines = [];
  cart.forEach((item, i) => {
    grandTotal += item.totalPrice;
    let line = `${i + 1}. ${item.name}`;
    if (item.extra) line += ` + ${item.extra}`;
    line += ` = ${item.totalPrice}.-`;
    lines.push(line);
  });

  const summary = lines.join("\n");

  const adminId = process.env.ADMIN_USER_ID;
  if (adminId) {
    try {
      await client.pushMessage({
        to: adminId,
        messages: [
          {
            type: "text",
            text: `📋 ออเดอร์ใหม่!\n\n${summary}\n\n💰 รวม: ${grandTotal}.-\n👤 User: ${userId}`,
          },
        ],
      });
    } catch (err) {
      console.error("Failed to notify admin:", err.message);
    }
  }

  session.cart = [];
  session.state = "idle";
  session.currentItem = null;

  return reply(replyToken, [
    {
      type: "text",
      text: `✅ ยืนยันออเดอร์เรียบร้อยครับ!\n\n${summary}\n\n💰 รวม: ${grandTotal}.-\n\nกรุณารอสักครู่นะครับ 🙏`,
    },
  ]);
}

// ==================== Helper ====================

function reply(replyToken, messages) {
  return client.replyMessage({ replyToken, messages });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MGR LINE Chatbot running on port ${PORT}`));
