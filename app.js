const express = require("express");
const { middleware, messagingApi, HTTPFetchError } = require("@line/bot-sdk");
require("dotenv").config();

const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

const app = express();

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

app.get("/", (req, res) => {
  res.send("MGR LINE Chatbot is running!");
});

async function handleEvent(event) {
  if (event.type === "follow") {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: "text",
          text: "สวัสดีครับ ยินดีต้อนรับ MGR สั่งอาหาร / กาแฟ 🙏\nกดเมนูด้านล่างเพื่อสั่งอาหารหรือกาแฟได้เลยครับ",
        },
      ],
    });
  }

  if (event.type === "message" && event.message.type === "text") {
    const text = event.message.text.trim();
    return handleTextMessage(event.replyToken, text);
  }

  return null;
}

async function handleTextMessage(replyToken, text) {
  if (text === "สวัสดี" || text === "hello" || text === "hi") {
    return client.replyMessage({
      replyToken,
      messages: [
        {
          type: "text",
          text: "สวัสดีครับ ยินดีต้อนรับ MGR สั่งอาหาร / กาแฟ 🙏\nกดเมนูด้านล่างเพื่อสั่งอาหารหรือกาแฟได้เลยครับ",
        },
      ],
    });
  }

  if (text === "🍱 เมนูอาหาร" || text === "เมนูอาหาร") {
    return client.replyMessage({
      replyToken,
      messages: [
        {
          type: "flex",
          altText: "เมนูอาหาร",
          contents: buildFoodMenu(),
        },
      ],
    });
  }

  if (text === "☕ เมนูกาแฟ" || text === "เมนูกาแฟ") {
    return client.replyMessage({
      replyToken,
      messages: [
        {
          type: "flex",
          altText: "เมนูกาแฟ / เครื่องดื่ม",
          contents: buildCoffeeMenu(),
        },
      ],
    });
  }

  if (text === "📞 ติดต่อ" || text === "ติดต่อ") {
    return client.replyMessage({
      replyToken,
      messages: [
        {
          type: "text",
          text: "📞 ติดต่อร้าน MGR\n📍 ที่อยู่: ร้าน MGR สั่งอาหาร / กาแฟ\n📱 โทร: -\n⏰ เวลาเปิด: 08:00 - 20:00 น.",
        },
      ],
    });
  }

  return client.replyMessage({
    replyToken,
    messages: [
      {
        type: "text",
        text: "สวัสดีครับ ยินดีต้อนรับ MGR สั่งอาหาร / กาแฟ 🙏\nกดเมนูด้านล่างเพื่อสั่งอาหารหรือกาแฟได้เลยครับ",
      },
    ],
  });
}

function buildFoodMenu() {
  return {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "🍱 เมนูอาหาร",
          weight: "bold",
          size: "xl",
          color: "#E85D3A",
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
        menuItem("🍛 ข้าวผัด", "ข้าวผัดรสเด็ด"),
        separator(),
        menuItem("🌶️ ข้าวกะเพรา", "ข้าวกะเพราหมูสับ ไข่ดาว"),
        separator(),
        menuItem("🍗 ข้าวมันไก่", "ข้าวมันไก่ต้ม/ทอด"),
      ],
      paddingAll: "15px",
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "พิมพ์ชื่อเมนูเพื่อสั่งได้เลยครับ",
          size: "sm",
          color: "#999999",
          align: "center",
        },
      ],
      paddingAll: "10px",
    },
    styles: {
      body: { separator: false },
    },
  };
}

function buildCoffeeMenu() {
  return {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "☕ เมนูกาแฟ / เครื่องดื่ม",
          weight: "bold",
          size: "xl",
          color: "#6F4E37",
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
        menuItem("☕ กาแฟร้อน", "กาแฟสดคั่วบด"),
        separator(),
        menuItem("🧊 กาแฟเย็น", "กาแฟเย็นเข้มข้น"),
        separator(),
        menuItem("🍫 โกโก้", "โกโก้เข้มข้น"),
        separator(),
        menuItem("💧 น้ำเปล่า", "น้ำเปล่าสะอาด"),
      ],
      paddingAll: "15px",
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "พิมพ์ชื่อเมนูเพื่อสั่งได้เลยครับ",
          size: "sm",
          color: "#999999",
          align: "center",
        },
      ],
      paddingAll: "10px",
    },
    styles: {
      body: { separator: false },
    },
  };
}

function menuItem(name, desc) {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      {
        type: "text",
        text: name,
        weight: "bold",
        size: "md",
        flex: 4,
      },
      {
        type: "text",
        text: desc,
        size: "sm",
        color: "#888888",
        flex: 6,
        align: "end",
      },
    ],
    paddingAll: "8px",
  };
}

function separator() {
  return { type: "separator", color: "#EEEEEE" };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MGR LINE Chatbot is running on port ${PORT}`);
});
