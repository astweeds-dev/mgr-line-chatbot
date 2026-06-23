const { messagingApi } = require("@line/bot-sdk");
const sharp = require("sharp");
require("dotenv").config();

const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: TOKEN,
});

const WIDTH = 2500;
const HEIGHT = 843;
const COL = Math.floor(WIDTH / 2); // 2 ปุ่ม: สั่งอาหาร | ติดต่อร้าน

// ฟอนต์ที่รองรับภาษาไทย (มีบน Windows) + fallback
const FONT = "'Leelawadee UI','Tahoma','Sarabun',sans-serif";

const richMenu = {
  size: { width: WIDTH, height: HEIGHT },
  selected: true,
  name: "MGR Rich Menu",
  chatBarText: "เมนู MGR",
  areas: [
    {
      bounds: { x: 0, y: 0, width: COL, height: HEIGHT },
      action: { type: "message", text: "Food / Drinks" },
    },
    {
      bounds: { x: COL, y: 0, width: WIDTH - COL, height: HEIGHT },
      action: { type: "message", text: "ติดต่อเจ้าหน้าที่" },
    },
  ],
};

async function generateImage() {
  const cx1 = COL / 2;
  const cx2 = COL + (WIDTH - COL) / 2;
  // ธีมสีเหลืองครีมเหมือน hero ในหน้าสั่งออเดอร์: พื้น #FFF9C4, ตัวอักษร #5A4F00
  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0"     y="0" width="${COL}"          height="${HEIGHT}" fill="#FFF9C4"/>
    <rect x="${COL}" y="0" width="${WIDTH - COL}" height="${HEIGHT}" fill="#FFF9C4"/>

    <line x1="${COL}" y1="70" x2="${COL}" y2="${HEIGHT - 70}" stroke="#EAD98A" stroke-width="5"/>

    <text x="${cx1}" y="350" text-anchor="middle" font-size="150">🍱☕</text>
    <text x="${cx1}" y="565" text-anchor="middle" font-family="${FONT}" font-size="96" font-weight="bold" fill="#5A4F00">Food / Drinks</text>

    <text x="${cx2}" y="320" text-anchor="middle" font-size="140">📞</text>
    <text x="${cx2}" y="510" text-anchor="middle" font-family="${FONT}" font-size="80" font-weight="bold" fill="#5A4F00">ติดต่อเจ้าหน้าที่</text>
    <text x="${cx2}" y="620" text-anchor="middle" font-family="${FONT}" font-size="62" font-weight="bold" fill="#5A4F00">063-881-0439</text>
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
