const { messagingApi } = require("@line/bot-sdk");
const sharp = require("sharp");
require("dotenv").config();

const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: TOKEN,
});
const blobClient = new messagingApi.MessagingApiBlobClient({
  channelAccessToken: TOKEN,
});

const WIDTH = 2500;
const HEIGHT = 843;
const COL = Math.floor(WIDTH / 3);

const richMenu = {
  size: { width: WIDTH, height: HEIGHT },
  selected: true,
  name: "MGR Rich Menu",
  chatBarText: "เมนู MGR",
  areas: [
    {
      bounds: { x: 0, y: 0, width: COL, height: HEIGHT },
      action: { type: "message", text: "อาหาร" },
    },
    {
      bounds: { x: COL, y: 0, width: COL, height: HEIGHT },
      action: { type: "message", text: "เครื่องดื่มและกาแฟ" },
    },
    {
      bounds: { x: COL * 2, y: 0, width: COL + 1, height: HEIGHT },
      action: { type: "message", text: "ติดต่อเจ้าหน้าที่" },
    },
  ],
};

async function generateImage() {
  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0"        y="0" width="${COL}" height="${HEIGHT}" fill="#E85D3A"/>
    <rect x="${COL}"    y="0" width="${COL}" height="${HEIGHT}" fill="#6F4E37"/>
    <rect x="${COL * 2}" y="0" width="${COL + 1}" height="${HEIGHT}" fill="#2196F3"/>

    <line x1="${COL}" y1="0" x2="${COL}" y2="${HEIGHT}" stroke="#fff" stroke-width="4"/>
    <line x1="${COL * 2}" y1="0" x2="${COL * 2}" y2="${HEIGHT}" stroke="#fff" stroke-width="4"/>

    <text x="${COL / 2}" y="340" text-anchor="middle" font-size="140" fill="#fff">🍱</text>
    <text x="${COL / 2}" y="520" text-anchor="middle" font-family="Arial,sans-serif" font-size="80" font-weight="bold" fill="#fff">Food</text>

    <text x="${COL + COL / 2}" y="340" text-anchor="middle" font-size="140" fill="#fff">☕</text>
    <text x="${COL + COL / 2}" y="500" text-anchor="middle" font-family="Arial,sans-serif" font-size="65" font-weight="bold" fill="#fff">Drinks</text>
    <text x="${COL + COL / 2}" y="590" text-anchor="middle" font-family="Arial,sans-serif" font-size="55" fill="#ffffffcc">&amp; Coffee</text>

    <text x="${COL * 2 + COL / 2}" y="340" text-anchor="middle" font-size="140" fill="#fff">📞</text>
    <text x="${COL * 2 + COL / 2}" y="520" text-anchor="middle" font-family="Arial,sans-serif" font-size="70" font-weight="bold" fill="#fff">Contact</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  try {
    // 1) ลบ Rich Menu เก่า (ถ้ามี)
    console.log("1. Checking existing Rich Menus...");
    const { richmenus } = await client.getRichMenuList();
    if (richmenus.length) {
      for (const rm of richmenus) {
        await client.deleteRichMenu(rm.richMenuId);
        console.log(`   Deleted: ${rm.richMenuId}`);
      }
    } else {
      console.log("   No existing Rich Menus.");
    }

    // 2) สร้าง Rich Menu ใหม่
    console.log("2. Creating Rich Menu...");
    const res = await client.createRichMenu(richMenu);
    const richMenuId = res.richMenuId || res;
    console.log(`   Created: ${richMenuId}`);

    // 3) สร้างรูปและอัปโหลด
    console.log("3. Generating & uploading image...");
    const imgBuffer = await generateImage();
    const uploadRes = await fetch(
      `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "image/png",
        },
        body: imgBuffer,
      }
    );
    if (!uploadRes.ok) throw new Error(await uploadRes.text());
    console.log("   Image uploaded!");

    // 4) ตั้งเป็น default
    console.log("4. Setting as default...");
    await client.setDefaultRichMenu(richMenuId);
    console.log("   Default Rich Menu set!");

    console.log("\nDone! Rich Menu ID:", richMenuId);
    console.log("เปิด LINE OA @616molde เพื่อดูผลลัพธ์ได้เลย");
  } catch (err) {
    console.error("Error:", err.body || err.message || err);
  }
}

main();
