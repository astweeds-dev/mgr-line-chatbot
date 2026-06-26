// ============================================================
// Google Apps Script — วางโค้ดนี้ใน Google Sheet > Extensions > Apps Script
// แล้ว Deploy > New deployment > Web app > Anyone > Deploy
// คัดลอก URL มาใส่ในไฟล์ .env ที่ GOOGLE_SHEET_URL=<url>
// ============================================================

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Orders") || ss.insertSheet("Orders");

    // สร้าง header ถ้ายังไม่มี
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "วันที่", "Order ID", "ชื่อลูกค้า", "เบอร์โทร",
        "สถานที่จัดส่ง", "รายการอาหาร", "ยอดรวม (฿)", "สถานะ"
      ]);
      // จัด format header
      var headerRange = sheet.getRange(1, 1, 1, 8);
      headerRange.setFontWeight("bold");
      headerRange.setBackground("#F9E84A");
    }

    sheet.appendRow([
      data.date || new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }),
      data.orderId || "",
      data.customerName || "",
      data.phone || "",
      data.location || "",
      data.items || "",
      data.total || 0,
      data.status || "delivered"
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
