// ==================== SlipOK slip verification ====================
// ตรวจสลิปกับธนาคารผ่าน SlipOK API (https://slipok.com)
// - เช็คว่าโอนจริงไหม + เข้าบัญชีร้านไหม (log:true) + สลิปซ้ำไหม (code 1012)
// - เทียบยอดเงินกับยอดออเดอร์เอง (ไม่เชื่อรูปสลิป)
// ถ้าไม่ได้ตั้งค่า SLIPOK_* → คืน status "disabled" → ระบบ fallback ไปใช้แอดมินยืนยันเอง

// อ่าน env แบบ lazy ตอนเรียกใช้ — กันปัญหา require ก่อน dotenv.config() จะรัน
function getConfig() {
  return {
    branchId: process.env.SLIPOK_BRANCH_ID,
    apiKey: process.env.SLIPOK_API_KEY,
  };
}

function isConfigured() {
  const { branchId, apiKey } = getConfig();
  return Boolean(branchId && apiKey);
}

// ตรวจสลิปจาก buffer รูป + ยอดที่คาดหวัง
// คืน { status, slipAmount?, data?, message? }
//   verified      — สลิปจริง + ยอดตรง (data = ข้อมูลธุรกรรม)
//   wrong_amount  — สลิปจริง แต่ยอดไม่ตรง
//   duplicate     — สลิปนี้เคยใช้แล้ว (code 1012)
//   invalid       — อ่านสลิปไม่ได้ / ไม่ใช่สลิปจริง
//   error         — เน็ต/ระบบ SlipOK ล่ม → caller ควร fallback เป็น manual
//   disabled      — ยังไม่ได้ตั้งค่า → caller ใช้ manual
async function verifySlip(buffer, expectedAmount) {
  const { branchId, apiKey } = getConfig();
  if (!branchId || !apiKey) return { status: "disabled" };
  try {
    const form = new FormData();
    form.append("files", new Blob([buffer], { type: "image/jpeg" }), "slip.jpg");
    form.append("log", "true"); // เปิดเช็คบัญชีปลายทาง + กันสลิปซ้ำ

    const resp = await fetch(
      `https://api.slipok.com/api/line/apikey/${branchId}`,
      {
        method: "POST",
        headers: { "x-authorization": apiKey },
        body: form,
        signal: AbortSignal.timeout(15000),
      }
    );
    const json = await resp.json().catch(() => ({}));

    if (resp.ok && json.success && json.data) {
      const slipAmount = Number(json.data.amount);
      if (expectedAmount != null && slipAmount !== Number(expectedAmount)) {
        return { status: "wrong_amount", slipAmount, data: json.data };
      }
      return { status: "verified", slipAmount, data: json.data };
    }

    // error path — SlipOK ตอบ { success:false, code, message }
    if (json.code === 1012) return { status: "duplicate", message: json.message };
    return { status: "invalid", code: json.code, message: json.message };
  } catch (e) {
    console.error("SlipOK error:", e.message);
    return { status: "error", message: e.message };
  }
}

module.exports = { verifySlip, isConfigured };
