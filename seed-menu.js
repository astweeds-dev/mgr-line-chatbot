// seed-menu.js — เพิ่มเมนูจาก hardcoded ลง SQLite (menu_items)
const store = require("./db");

// ตรวจสอบว่ามีข้อมูลอยู่แล้วหรือไม่
const count = store.menuCount();
const force = process.argv.includes("--force");
if (count > 0 && !force) {
  console.log(`ตาราง menu_items มีข้อมูลอยู่แล้ว ${count} รายการ — ใช้ --force เพื่อเขียนทับ`);
  process.exit(0);
}

// ค่าคงที่ (คัดจาก order.html)
const COFFEE_ADDONS = [
  { id: "น้ำผึ้ง", price: 10 }, { id: "คาราเมลไซรัป", price: 10 },
  { id: "นมโอ๊ต", price: 20 }, { id: "เพิ่มช็อต", price: 20 },
];
const MILK_ADDONS = [{ id: "น้ำผึ้ง", price: 10 }, { id: "คาราเมลไซรัป", price: 10 }];
const SWEETNESS = ["ไม่หวาน", "หวานปกติ", "หวานมาก"];
const SPICINESS = ["เผ็ดน้อย", "เผ็ดปกติ", "เผ็ดมาก"];

// เมนูทั้งหมด (คัดจาก order.html)
const MENU = [
  // 🍚 อาหาร
  { id: 1,  cat: "food", nameTh: "ข้าวราดไข่เจียว", nameEn: "Rice with Thai Omelette", price: { default: 50 }, addons: [{ id: "หมูสับ", price: 10 }, { id: "พิเศษ", price: 20 }], level: [], levelLabel: "", variantLabel: "" },
  { id: 3,  cat: "food", nameTh: "ข้าวราดผัดกะเพรา", nameEn: "Rice with Stir-fried Basil", price: { "หมู": 70, "เนื้อ": 80 }, addons: [], level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "" },
  { id: 4,  cat: "food", nameTh: "ข้าวราดผัดน้ำมันหอย", nameEn: "Rice with Stir-fried Oyster Sauce", price: { "หมู": 70, "เนื้อ": 80 }, addons: [], level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "" },
  { id: 5,  cat: "food", nameTh: "ข้าวราดผัดเต้าเจี้ยว", nameEn: "Rice with Stir-fried Bean Paste", price: { "หมู": 70, "เนื้อ": 80 }, addons: [], level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "" },
  { id: 6,  cat: "food", nameTh: "ข้าวราดผัดพริกเผา", nameEn: "Rice with Stir-fried Roasted Chili Paste", price: { "หมู": 70, "เนื้อ": 80 }, addons: [], level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "" },
  { id: 7,  cat: "food", nameTh: "ข้าวราดผัดพริกแกง", nameEn: "Rice with Stir-fried Curry Paste", price: { "หมู": 70, "เนื้อ": 80 }, addons: [], level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "" },
  { id: 8,  cat: "food", nameTh: "ข้าวราดผัดกระเทียม", nameEn: "Rice with Stir-fried Garlic", price: { "หมู": 70, "เนื้อ": 80 }, addons: [], level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "" },
  { id: 9,  cat: "food", nameTh: "ข้าวราดพะแนง", nameEn: "Rice with Panang Curry", price: { "หมู": 80, "เนื้อ": 90 }, addons: [], level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "" },
  { id: 10, cat: "food", nameTh: "ข้าวราดพริกแกงใต้", nameEn: "Rice with Southern Curry", price: { "หมู": 80, "เนื้อ": 90 }, addons: [], level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "" },
  { id: 11, cat: "food", nameTh: "ข้าวราดพริกเกลือ", nameEn: "Rice with Salt Chili Stir-fry", price: { "หมู": 80, "เนื้อ": 90 }, addons: [], level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "" },
  { id: 12, cat: "food", nameTh: "ข้าวราดผัดไข่เค็ม", nameEn: "Rice with Stir-fried Salted Egg", price: { "หมู": 90, "เนื้อ": 100 }, addons: [], level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "" },
  { id: 13, cat: "food", nameTh: "ข้าวราดเขียวหวาน", nameEn: "Rice with Green Curry", price: { "หมู": 90, "เนื้อ": 100 }, addons: [], level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "" },
  { id: 14, cat: "food", nameTh: "ข้าวราดหมูสับไข่ระเบิด", nameEn: "Rice with Minced Pork & Runny Egg", price: { default: 90 }, addons: [], level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "" },
  { id: 15, cat: "food", nameTh: "ข้าวราดผัดผงกะหรี่", nameEn: "Rice with Stir-fried Curry Powder", price: { "หมู": 90, "เนื้อ": 100 }, addons: [], level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "" },

  // ☕ กาแฟ
  { id: 20, cat: "coffee", nameTh: "เอสเปรสโซ", nameEn: "Espresso", price: { "คั่วอ่อน": 70, "คั่วเข้ม": 70 }, addons: COFFEE_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "เมล็ดกาแฟ" },
  { id: 21, cat: "coffee", nameTh: "อเมริกาโน่", nameEn: "Americano", price: { "คั่วอ่อน": 70, "คั่วเข้ม": 70 }, addons: COFFEE_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "เมล็ดกาแฟ" },
  { id: 22, cat: "coffee", nameTh: "คาปูชิโน่", nameEn: "Cappuccino", price: { "คั่วอ่อน": 70, "คั่วเข้ม": 70 }, addons: COFFEE_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "เมล็ดกาแฟ" },
  { id: 23, cat: "coffee", nameTh: "ลาเต้", nameEn: "Latte", price: { "คั่วอ่อน": 70, "คั่วเข้ม": 70 }, addons: COFFEE_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "เมล็ดกาแฟ" },
  { id: 24, cat: "coffee", nameTh: "คาราเมล มัคคิอาโต", nameEn: "Caramel Macchiato", price: { "คั่วอ่อน": 80, "คั่วเข้ม": 80 }, addons: COFFEE_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "เมล็ดกาแฟ" },

  // 🥛 นม
  { id: 30, cat: "milk", nameTh: "นมสดเย็น", nameEn: "Fresh Milk", price: { default: 70 }, addons: MILK_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "" },
  { id: 31, cat: "milk", nameTh: "นมชมพูเย็น", nameEn: "Pink Milk", price: { default: 70 }, addons: MILK_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "" },
  { id: 32, cat: "milk", nameTh: "นมคาราเมลเย็น", nameEn: "Caramel Milk", price: { default: 70 }, addons: MILK_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "" },
  { id: 33, cat: "milk", nameTh: "นมเฮเซลนัทเย็น", nameEn: "Hazelnut Milk", price: { default: 70 }, addons: MILK_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "" },
  { id: 34, cat: "milk", nameTh: "ช็อกโกแลตบานาน่าเย็น", nameEn: "Choco Banana", price: { default: 70 }, addons: MILK_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "" },
  { id: 35, cat: "milk", nameTh: "โกโก้", nameEn: "Cocoa", price: { default: 70 }, addons: MILK_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "" },

  // 🥤 Italian Soda
  { id: 40, cat: "soda", nameTh: "Watermelon", nameEn: "Watermelon", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "" },
  { id: 41, cat: "soda", nameTh: "Pineapple", nameEn: "Pineapple", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "" },
  { id: 42, cat: "soda", nameTh: "Kiwi", nameEn: "Kiwi", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "" },
  { id: 43, cat: "soda", nameTh: "Melon", nameEn: "Melon", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "" },
  { id: 44, cat: "soda", nameTh: "Honey Lemon", nameEn: "Honey Lemon", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "" },
  { id: 45, cat: "soda", nameTh: "Lychee", nameEn: "Lychee", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "" },
  { id: 46, cat: "soda", nameTh: "Kyoho Grape", nameEn: "Kyoho Grape", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "" },
  { id: 47, cat: "soda", nameTh: "Banana", nameEn: "Banana", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "" },
  { id: 48, cat: "soda", nameTh: "Cantaloupe", nameEn: "Cantaloupe", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", variantLabel: "" },
];

// บันทึกลง DB พร้อม sortOrder
MENU.forEach((item, i) => {
  store.saveMenuItem({ ...item, sortOrder: i, enabled: true });
});

console.log(`เพิ่มเมนูแล้ว ${MENU.length} รายการ`);
