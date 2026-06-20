const { messagingApi } = require("@line/bot-sdk");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
});

const blobClient = new messagingApi.MessagingApiBlobClient({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
});

const richMenuObject = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: "MGR Rich Menu",
  chatBarText: "เมนู MGR",
  areas: [
    {
      bounds: { x: 0, y: 0, width: 833, height: 843 },
      action: { type: "message", text: "🍱 เมนูอาหาร" },
    },
    {
      bounds: { x: 833, y: 0, width: 834, height: 843 },
      action: { type: "message", text: "☕ เมนูกาแฟ" },
    },
    {
      bounds: { x: 1667, y: 0, width: 833, height: 843 },
      action: { type: "message", text: "📞 ติดต่อ" },
    },
  ],
};

async function createRichMenu() {
  try {
    console.log("1. Creating Rich Menu...");
    const richMenuId = await client.createRichMenu(richMenuObject);
    console.log(`   Rich Menu created: ${richMenuId}`);

    const imagePath = path.join(__dirname, "rich-menu-image.png");
    if (fs.existsSync(imagePath)) {
      console.log("2. Uploading Rich Menu image...");
      const imageBuffer = fs.readFileSync(imagePath);
      await blobClient.setRichMenuImage(richMenuId, imageBuffer, "image/png");
      console.log("   Image uploaded!");
    } else {
      console.log("2. SKIP: rich-menu-image.png not found.");
      console.log(
        "   Create a 2500x843 PNG image with 3 sections and place it as rich-menu-image.png"
      );
      console.log("   Then run: npm run create-rich-menu");
    }

    console.log("3. Setting as default Rich Menu...");
    await client.setDefaultRichMenu(richMenuId);
    console.log("   Default Rich Menu set!");

    const adminUserId = process.env.ADMIN_USER_ID;
    if (adminUserId) {
      console.log("4. Linking Rich Menu to admin user...");
      await client.linkRichMenuIdToUser(adminUserId, richMenuId);
      console.log(`   Linked to user: ${adminUserId}`);
    }

    console.log("\nDone! Rich Menu ID:", richMenuId);
  } catch (err) {
    console.error("Error:", err.message || err);
  }
}

createRichMenu();
