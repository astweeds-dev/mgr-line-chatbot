const { messagingApi } = require("@line/bot-sdk");
const NODE_ENV = (process.env.NODE_ENV || "production").trim();
const envFile = NODE_ENV === "development" ? ".env.development" : ".env";
require("dotenv").config({ path: envFile });

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
});

const webhookUrl = process.env.BASE_URL + "/webhook";

async function main() {
  try {
    await client.setWebhookEndpoint({ endpoint: webhookUrl });
    console.log("Webhook URL set:", webhookUrl);

    const result = await client.testWebhookEndpoint({ endpoint: webhookUrl });
    if (result.success) {
      console.log("Webhook verify: OK");
    } else {
      console.log("Webhook verify: FAILED -", result.reason);
    }

    // อัปเดต LIFF Endpoint URL ให้ตรงกับ tunnel URL ปัจจุบัน
    const liffId = process.env.LIFF_ID;
    if (liffId) {
      const liffUrl = process.env.BASE_URL + "/order.html";
      const res = await fetch(`https://api.line.me/liff/v1/apps/${liffId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ view: { type: "full", url: liffUrl } }),
      });
      if (res.ok) {
        console.log("LIFF endpoint updated:", liffUrl);
      } else {
        console.log("LIFF update failed:", await res.text());
      }
    }
  } catch (err) {
    console.error("Error:", err.body || err.message);
  }
}

main();
