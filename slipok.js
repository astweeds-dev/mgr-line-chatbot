// ==================== SlipOK slip verification ====================
// ตรวจสลิปกับธนาคารผ่าน SlipOK API (https://slipok.com)
// - เช็คว่าโอนจริงไหม + เข้าบัญชีร้านไหม (log:true) + สลิปซ้ำไหม
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

// error code ที่เป็นความผิดของ "สลิป/ลูกค้า" → ปฏิเสธ ให้ลูกค้าส่งใหม่
// (พร้อมข้อความที่ลูกค้าเข้าใจ — ดู REJECT_MESSAGES)
const SLIP_REJECT_CODE = {
  1005: "invalid",        // ไฟล์ไม่ใช่ภาพ
  1006: "invalid",        // รูปภาพไม่ถูกต้อง
  1007: "invalid",        // รูปไม่มี QR
  1008: "invalid",        // QR ไม่ใช่ QR ชำระเงิน
  1011: "not_found",      // QR หมดอายุ / ไม่มีรายการจริง (สลิปอาจปลอม)
  1012: "duplicate",      // สลิปซ้ำ
  1013: "wrong_amount",   // ยอดไม่ตรง (เผื่อกรณีส่ง amount ไป)
  1014: "wrong_account",  // บัญชีผู้รับไม่ตรงกับบัญชีร้าน
};

// ข้อความถึงลูกค้าต่อ status (wrong_amount สร้างแบบ dynamic ตอน verify)
const REJECT_MESSAGES = {
  invalid: "อ่านสลิปไม่ได้ กรุณาแนบรูปสลิปที่ชัดเจนครับ",
  not_found: "ตรวจไม่พบรายการโอนนี้ กรุณาตรวจสอบสลิปแล้วส่งใหม่ครับ",
  duplicate: "สลิปนี้ถูกใช้ไปแล้ว กรุณาโอนใหม่แล้วแนบสลิปที่ถูกต้องครับ",
  wrong_account: "โอนเข้าบัญชีไม่ถูกต้อง กรุณาโอนเข้าบัญชีของร้านแล้วส่งสลิปใหม่ครับ",
};

// status ที่ควร "ปฏิเสธลูกค้า" (ที่เหลือ เช่น error/disabled → fallback manual)
function isReject(status) {
  return Boolean(REJECT_MESSAGES[status]) || status === "wrong_amount";
}

// ตรวจสลิปจาก buffer รูป + ยอดที่คาดหวัง
// คืน { status, slipAmount?, data?, code?, customerMessage? }
//   verified      — สลิปจริง + ยอดตรง + เข้าบัญชีร้าน (data = ข้อมูลธุรกรรม)
//   wrong_amount  — สลิปจริง แต่ยอดไม่ตรง
//   duplicate     — สลิปนี้เคยใช้แล้ว (1012)
//   wrong_account — โอนผิดบัญชี (1014)
//   not_found     — ไม่มีรายการจริง/QR หมดอายุ (1011)
//   invalid       — อ่านสลิปไม่ได้ / ไม่ใช่สลิปจริง (1005-1008)
//   error         — config ผิด (key/โควต้า/สาขา) หรือธนาคาร/เน็ตล่ม → caller fallback manual
//   disabled      — ยังไม่ได้ตั้งค่า → caller ใช้ manual
async function verifySlip(buffer, expectedAmount) {
  if (process.env.NODE_ENV === "development") {
    console.log("[SlipOK] DEV mode — auto-verified (no real check)");
    return { status: "verified", slipAmount: Number(expectedAmount), data: { dev: true } };
  }
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
        return {
          status: "wrong_amount",
          slipAmount,
          data: json.data,
          customerMessage: `ยอดโอนไม่ตรงครับ (สลิป ${slipAmount}.- ต้องโอน ${expectedAmount}.-) กรุณาโอนให้ครบแล้วส่งสลิปใหม่ครับ`,
        };
      }
      return { status: "verified", slipAmount, data: json.data };
    }

    // error path — SlipOK ตอบ { success:false, code, message }
    const code = json.code;
    const message = json.message || (json.data && json.data.message) || "";
    console.warn(`[SlipOK] reject code=${code} msg=${message}`);

    const status = SLIP_REJECT_CODE[code];
    if (status) {
      return { status, code, message, customerMessage: REJECT_MESSAGES[status] };
    }
    // 1001/1002/1003/1004/1009/1010 ฯลฯ = ปัญหา config/โควต้า/ธนาคาร → fallback manual
    console.error(`[SlipOK] config/system error code=${code} msg=${message} — falling back to manual`);
    return { status: "error", code, message };
  } catch (e) {
    console.error("SlipOK error:", e.message);
    return { status: "error", message: e.message };
  }
}

module.exports = { verifySlip, isConfigured, isReject };
