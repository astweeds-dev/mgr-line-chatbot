const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const http = require("http");

const DIR = __dirname;
const DATA_DIR = path.join(DIR, "data");
const LOG_FILE = path.join(DATA_DIR, "watchdog.log");
const ENV_FILE = path.join(DIR, ".env");
const CHECK_INTERVAL = 30_000;
const OK_LOG_INTERVAL = 10 * 60_000;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

// หา cloudflared — ลอง PATH ก่อน, ถ้าไม่เจอก็ลอง default install paths
function findCloudflared() {
  try { execSync("cloudflared --version", { stdio: "pipe" }); return "cloudflared"; } catch {}
  const candidates = [
    path.join(process.env.ProgramFiles || "", "cloudflared", "cloudflared.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "cloudflared", "cloudflared.exe"),
    "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
    "C:\\Program Files\\cloudflared\\cloudflared.exe",
  ];
  for (const p of candidates) { if (fs.existsSync(p)) return p; }
  return "cloudflared";
}
const CLOUDFLARED = findCloudflared();

let serverProc = null;
let tunnelProc = null;
let tunnelUrl = "";
let isRestarting = false;
let lastOkLog = 0;
let config = {};
let stats = { serverRestarts: 0, tunnelRestarts: 0, startTime: new Date() };

// ==================== Logging ====================

function log(msg) {
  const ts = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try {
      if (fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
        const old = LOG_FILE + ".old";
        try { fs.unlinkSync(old); } catch {}
        fs.renameSync(LOG_FILE, old);
      }
    } catch {}
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

// ==================== .env ====================

function loadEnv() {
  const lines = fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
  config = {};
  for (const l of lines) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) config[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

function updateBaseUrl(url) {
  let content = fs.readFileSync(ENV_FILE, "utf8");
  content = content.replace(/BASE_URL=.*/, `BASE_URL=${url}`);
  fs.writeFileSync(ENV_FILE, content);
  config.BASE_URL = url;
}

// ==================== LINE Alert ====================

function sendAlert(text) {
  return new Promise((resolve) => {
    const alertTarget = config.ALERT_GROUP_ID || config.ADMIN_USER_ID;
    if (!config.CHANNEL_ACCESS_TOKEN || !alertTarget) {
      log("LINE alert skipped (no credentials)");
      return resolve();
    }
    const body = JSON.stringify({
      to: alertTarget,
      messages: [{ type: "text", text }],
    });
    const req = https.request(
      {
        hostname: "api.line.me",
        path: "/v2/bot/message/push",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.CHANNEL_ACCESS_TOKEN}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        resolve();
      }
    );
    req.on("error", (e) => {
      log(`LINE alert error: ${e.message}`);
      resolve();
    });
    req.write(body);
    req.end();
  });
}

// ==================== Health Check ====================

function checkHealth() {
  return new Promise((resolve) => {
    const port = config.PORT || 3000;
    const req = http.get(`http://localhost:${port}/health`, { timeout: 5000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ==================== Process Management ====================

function killProc(proc) {
  if (!proc) return;
  try {
    proc.kill();
  } catch {}
}

function startServer() {
  killProc(serverProc);
  serverProc = spawn("node", ["app.js"], {
    cwd: DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production" },
  });
  serverProc.stdout.on("data", (d) => process.stdout.write(d));
  serverProc.stderr.on("data", (d) => {
    process.stderr.write(d);
    const msg = d.toString().trim();
    if (msg) log(`[server:err] ${msg.slice(0, 500)}`);
  });
  serverProc.on("exit", (code) => {
    log(`Server exited (code ${code})`);
    serverProc = null;
  });
}

function startTunnel() {
  killProc(tunnelProc);
  const port = config.PORT || 3000;
  const prevUrl = tunnelUrl;
  const isNamed = Boolean(config.TUNNEL_NAME);

  if (isNamed) {
    tunnelUrl = `https://${config.TUNNEL_HOSTNAME}`;
    log(`Named Tunnel: ${config.TUNNEL_NAME} → ${tunnelUrl}`);
    tunnelProc = spawn(CLOUDFLARED, ["tunnel", "run", config.TUNNEL_NAME], {
      cwd: DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    tunnelProc.stderr.on("data", (d) => {
      const msg = d.toString().trim();
      if (/error|ERR/i.test(msg)) log(`[tunnel] ${msg.slice(0, 200)}`);
    });
  } else {
    tunnelUrl = "";
    log("Starting Quick Tunnel...");
    tunnelProc = spawn(CLOUDFLARED, ["tunnel", "--url", `http://localhost:${port}`], {
      cwd: DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let urlHandled = false;
    const onData = (d) => {
      const text = d.toString();
      const match = text.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/);
      if (match && !urlHandled) {
        urlHandled = true;
        tunnelUrl = match[1];
        log(`Quick Tunnel URL: ${tunnelUrl}`);
        handleNewTunnelUrl(tunnelUrl);
      }
    };
    tunnelProc.stdout.on("data", onData);
    tunnelProc.stderr.on("data", onData);
  }

  tunnelProc.stdout.on("data", () => {});
  tunnelProc.on("error", (e) => {
    log(`Tunnel spawn error: ${e.message}`);
    tunnelProc = null;
  });
  tunnelProc.on("exit", (code) => {
    log(`Tunnel exited (code ${code})`);
    tunnelProc = null;
  });

  if (isNamed && tunnelUrl !== prevUrl) {
    handleNewTunnelUrl(tunnelUrl);
  }
}

async function handleNewTunnelUrl(url) {
  isRestarting = true;
  try {
    const cleanUrl = url.replace(/[\r\n\s]+/g, "");
    updateBaseUrl(cleanUrl);
    const webhookUrl = cleanUrl + "/webhook";
    log(`Waiting for tunnel to stabilize...`);
    await sleep(5000);
    log(`Updating LINE webhook → ${webhookUrl}`);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch("https://api.line.me/v2/bot/channel/webhook/endpoint", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + config.CHANNEL_ACCESS_TOKEN },
          body: JSON.stringify({ endpoint: webhookUrl }),
        });
        if (r.ok) { log("Webhook set OK"); break; }
        const t = await r.text();
        log(`Webhook attempt ${attempt}/3 HTTP ${r.status}: ${t}`);
        if (attempt < 3) await sleep(3000);
      } catch (e) {
        log(`Webhook attempt ${attempt}/3 error: ${e.message}`);
        if (attempt < 3) await sleep(3000);
      }
    }
  } finally {
    isRestarting = false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ==================== Monitor Loop ====================

async function monitor() {
  if (isRestarting) return;

  // Check tunnel process
  if (!tunnelProc) {
    isRestarting = true;
    stats.tunnelRestarts++;
    log(`Tunnel DOWN — restart #${stats.tunnelRestarts}`);
    await sendAlert(
      `⚠️ Tunnel ล่ม — กำลัง restart (ครั้งที่ ${stats.tunnelRestarts})`
    );
    startTunnel();
    for (let i = 0; i < 15 && !tunnelUrl; i++) await sleep(2000);
    if (tunnelUrl) {
      await sendAlert(`✅ Tunnel กลับมาแล้ว\n🔗 ${tunnelUrl}`);
    } else {
      await sendAlert(
        `❌ Tunnel restart แล้วยังไม่ได้ URL — ต้องเช็คเครื่องครับ`
      );
    }
    isRestarting = false;
    return;
  }

  // Check server health
  const healthy = await checkHealth();
  if (healthy) {
    const now = Date.now();
    if (now - lastOkLog > OK_LOG_INTERVAL) {
      const upMin = Math.floor((now - stats.startTime.getTime()) / 60000);
      log(
        `OK — uptime ${upMin}m, server restarts: ${stats.serverRestarts}, tunnel restarts: ${stats.tunnelRestarts}`
      );
      lastOkLog = now;
    }
    return;
  }

  // Server down
  isRestarting = true;
  stats.serverRestarts++;
  log(`Server DOWN — restart #${stats.serverRestarts}`);
  await sendAlert(
    `🔴 Server ล่ม! กำลัง restart (ครั้งที่ ${stats.serverRestarts})`
  );

  startServer();
  await sleep(5000);

  if (await checkHealth()) {
    log("Server recovered");
    await sendAlert(`✅ Server กลับมาทำงานแล้ว`);
  } else {
    log("Server STILL DOWN after restart");
    await sendAlert(
      `❌ Server restart แล้วยังไม่ขึ้น — ต้องเช็คเครื่องด้วยครับ`
    );
  }
  isRestarting = false;
}

// ==================== Slip Cleanup (ลบสลิปเก่ากว่า 30 วัน) ====================

const SLIP_DIR = path.join(DIR, "images", "slips");

function cleanOldSlips(daysToKeep = 30) {
  try {
    if (!fs.existsSync(SLIP_DIR)) return;
    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(SLIP_DIR);
    let deleted = 0;
    for (const f of files) {
      const fp = path.join(SLIP_DIR, f);
      try {
        const st = fs.statSync(fp);
        if (!st.isFile()) continue;
        if (st.mtimeMs < cutoff) {
          fs.unlinkSync(fp);
          deleted++;
        }
      } catch {}
    }
    if (deleted > 0) log(`[CLEANUP] Deleted ${deleted} slip(s) older than ${daysToKeep} days`);
  } catch (e) {
    log(`[CLEANUP] Error: ${e.message}`);
  }
}

// ทำงานสัปดาห์ละครั้ง (7 วัน)
setInterval(() => cleanOldSlips(30), 7 * 24 * 60 * 60 * 1000);

// ==================== Resource Monitoring (Memory) ====================

let memAlertCooldown = 0;

function checkResources() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedPct = ((totalMem - freeMem) / totalMem) * 100;

  if (usedPct > 85 && Date.now() > memAlertCooldown) {
    const usedGB = ((totalMem - freeMem) / 1073741824).toFixed(1);
    const totalGB = (totalMem / 1073741824).toFixed(1);
    log(`[RESOURCE] Memory HIGH: ${usedPct.toFixed(1)}% (${usedGB}/${totalGB} GB)`);
    sendAlert(
      `⚠️ Memory สูง ${usedPct.toFixed(1)}%\n` +
      `ใช้ ${usedGB} / ${totalGB} GB\n` +
      `กรุณาตรวจสอบเครื่องครับ`
    );
    memAlertCooldown = Date.now() + 30 * 60 * 1000; // cooldown 30 นาที กันแจ้งซ้ำ
  }
}

// ตรวจทุก 30 นาที
setInterval(checkResources, 30 * 60 * 1000);

// ==================== Shutdown ====================

function shutdown() {
  log("Watchdog shutting down...");
  sendAlert("🔴 ระบบ MGR ปิดตัวลง").finally(() => {
    killProc(serverProc);
    killProc(tunnelProc);
    process.exit(0);
  });
  setTimeout(() => {
    killProc(serverProc);
    killProc(tunnelProc);
    process.exit(0);
  }, 3000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ==================== Main ====================

async function main() {
  console.log("============================================");
  console.log("  MGR Watchdog — System Monitor");
  console.log("============================================\n");

  loadEnv();
  log("Watchdog starting...");

  // Start server
  startServer();
  log("Server starting...");
  await sleep(3000);

  // Start tunnel
  startTunnel();
  log("Tunnel starting — waiting for URL...");
  for (let i = 0; i < 15 && !tunnelUrl; i++) await sleep(2000);

  if (!tunnelUrl) {
    log("WARNING: No tunnel URL after 30 seconds");
  }

  const healthy = await checkHealth();
  const adminUrl = tunnelUrl ? `\n\n📊 แดชบอร์ดพนักงาน:\n${tunnelUrl}/admin.html` : "";
  await sendAlert(
    `🟢 ระบบ MGR เปิดทำงานแล้ว\n` +
      `${healthy ? "✅" : "⚠️"} Server: ${healthy ? "OK" : "starting..."}\n` +
      (tunnelUrl ? `🔗 ${tunnelUrl}` : "⚠️ Tunnel: waiting...") +
      adminUrl
  );

  log(`Monitoring started (every ${CHECK_INTERVAL / 1000}s)`);
  lastOkLog = Date.now();
  setInterval(monitor, CHECK_INTERVAL);

  // ทำความสะอาดสลิปเก่าตอนเริ่มต้น + ตรวจ resource ครั้งแรก
  cleanOldSlips(30);
  checkResources();
}

main().catch((e) => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
