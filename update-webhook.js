const { messagingApi } = require("@line/bot-sdk");
require("dotenv").config();

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
  } catch (err) {
    console.error("Error:", err.body || err.message);
  }
}

main();
