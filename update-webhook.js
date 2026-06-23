const fs = require("fs");
const path = require("path");

const NODE_ENV = (process.env.NODE_ENV || "production").trim();
const envFile = NODE_ENV === "development" ? ".env.development" : ".env";
const envPath = path.join(__dirname, envFile);

function readEnv() {
  const cfg = {};
  for (const l of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) cfg[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return cfg;
}

async function main() {
  const cfg = readEnv();
  const baseUrl = process.argv[2] || cfg.BASE_URL;
  const token = cfg.CHANNEL_ACCESS_TOKEN;
  const webhookUrl = baseUrl + "/webhook";

  try {
    const res = await fetch("https://api.line.me/v2/bot/channel/webhook/endpoint", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: webhookUrl }),
    });
    if (res.ok) {
      console.log("Webhook URL set:", webhookUrl);
    } else {
      const t = await res.text();
      console.log("Webhook update failed:", res.status, t);
    }

    const verify = await fetch("https://api.line.me/v2/bot/channel/webhook/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: webhookUrl }),
    });
    const vr = await verify.json();
    console.log("Webhook verify:", vr.success ? "OK" : "FAILED - " + (vr.reason || ""));
  } catch (err) {
    console.error("Error:", err.message);
  }
}

main();
