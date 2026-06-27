// Canonical menu seed data — source of truth ย้ายจาก hardcoded ใน order.html
// app.js ใช้ seedMenuIfEmpty() เพื่อ auto-insert เมื่อ DB ว่าง

const COFFEE_ADDONS = [
  { id: "น้ำผึ้ง", price: 10 }, { id: "คาราเมลไซรัป", price: 10 },
  { id: "นมโอ๊ต", price: 20 }, { id: "เพิ่มช็อต", price: 20 },
];
const MILK_ADDONS = [{ id: "น้ำผึ้ง", price: 10 }, { id: "คาราเมลไซรัป", price: 10 }];
// add-on มาตรฐานของอาหารตามสั่ง (เดิม fallback จาก global ADDONS / DEFAULT_ADDON_PRICES)
const FOOD_ADDONS = [{ id: "ไข่ดาว", price: 15 }, { id: "ไข่เจียว", price: 20 }, { id: "พิเศษ", price: 20 }];
const SWEETNESS = ["ไม่หวาน", "หวานปกติ", "หวานมาก"];
const SPICINESS = ["เผ็ดน้อย", "เผ็ดปกติ", "เผ็ดมาก"];

const MENU_SEED = [
  // 🍳 อาหารตามสั่ง
  { id: 1,  cat: "food", nameTh: "ข้าวราดไข่เจียว",         nameEn: "Rice with Thai Omelette",                   price: { default: 50 }, addons: [{ id: "หมูสับ", price: 10 }, { id: "พิเศษ", price: 20 }], level: [],        levelLabel: "",              variantLabel: "",          sortOrder: 1 },
  { id: 3,  cat: "food", nameTh: "ข้าวราดผัดกะเพรา",       nameEn: "Rice with Stir-fried Basil",                price: { "หมู": 70, "เนื้อ": 80 },  addons: FOOD_ADDONS, level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "เนื้อสัตว์", sortOrder: 2 },
  { id: 4,  cat: "food", nameTh: "ข้าวราดผัดน้ำมันหอย",     nameEn: "Rice with Stir-fried Oyster Sauce",          price: { "หมู": 70, "เนื้อ": 80 },  addons: FOOD_ADDONS, level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "เนื้อสัตว์", sortOrder: 3 },
  { id: 5,  cat: "food", nameTh: "ข้าวราดผัดเต้าเจี้ยว",     nameEn: "Rice with Stir-fried Bean Paste",            price: { "หมู": 70, "เนื้อ": 80 },  addons: FOOD_ADDONS, level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "เนื้อสัตว์", sortOrder: 4 },
  { id: 6,  cat: "food", nameTh: "ข้าวราดผัดพริกเผา",       nameEn: "Rice with Stir-fried Roasted Chili Paste",   price: { "หมู": 70, "เนื้อ": 80 },  addons: FOOD_ADDONS, level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "เนื้อสัตว์", sortOrder: 5 },
  { id: 7,  cat: "food", nameTh: "ข้าวราดผัดพริกแกง",       nameEn: "Rice with Stir-fried Curry Paste",           price: { "หมู": 70, "เนื้อ": 80 },  addons: FOOD_ADDONS, level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "เนื้อสัตว์", sortOrder: 6 },
  { id: 8,  cat: "food", nameTh: "ข้าวราดผัดกระเทียม",      nameEn: "Rice with Stir-fried Garlic",                price: { "หมู": 70, "เนื้อ": 80 },  addons: FOOD_ADDONS, level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "เนื้อสัตว์", sortOrder: 7 },
  { id: 9,  cat: "food", nameTh: "ข้าวราดพะแนง",           nameEn: "Rice with Panang Curry",                     price: { "หมู": 80, "เนื้อ": 90 },  addons: FOOD_ADDONS, level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "เนื้อสัตว์", sortOrder: 8 },
  { id: 10, cat: "food", nameTh: "ข้าวราดพริกแกงใต้",       nameEn: "Rice with Southern Curry",                   price: { "หมู": 80, "เนื้อ": 90 },  addons: FOOD_ADDONS, level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "เนื้อสัตว์", sortOrder: 9 },
  { id: 11, cat: "food", nameTh: "ข้าวราดพริกเกลือ",        nameEn: "Rice with Salt Chili Stir-fry",              price: { "หมู": 80, "เนื้อ": 90 },  addons: FOOD_ADDONS, level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "เนื้อสัตว์", sortOrder: 10 },
  { id: 12, cat: "food", nameTh: "ข้าวราดผัดไข่เค็ม",       nameEn: "Rice with Stir-fried Salted Egg",            price: { "หมู": 90, "เนื้อ": 100 }, addons: FOOD_ADDONS, level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "เนื้อสัตว์", sortOrder: 11 },
  { id: 13, cat: "food", nameTh: "ข้าวราดเขียวหวาน",        nameEn: "Rice with Green Curry",                      price: { "หมู": 90, "เนื้อ": 100 }, addons: FOOD_ADDONS, level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "เนื้อสัตว์", sortOrder: 12 },
  { id: 14, cat: "food", nameTh: "ข้าวราดหมูสับไข่ระเบิด",   nameEn: "Rice with Minced Pork & Runny Egg",          price: { default: 90 },              addons: FOOD_ADDONS, level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "",          sortOrder: 13 },
  { id: 15, cat: "food", nameTh: "ข้าวราดผัดผงกะหรี่",      nameEn: "Rice with Stir-fried Curry Powder",          price: { "หมู": 90, "เนื้อ": 100 }, addons: FOOD_ADDONS, level: SPICINESS, levelLabel: "ระดับความเผ็ด", variantLabel: "เนื้อสัตว์", sortOrder: 14 },

  // ☕ กาแฟ
  { id: 20, cat: "coffee", nameTh: "เอสเปรสโซ",          nameEn: "Espresso",          variantLabel: "เมล็ดกาแฟ", price: { "คั่วอ่อน": 70, "คั่วเข้ม": 70 }, addons: COFFEE_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 20 },
  { id: 21, cat: "coffee", nameTh: "อเมริกาโน่",          nameEn: "Americano",         variantLabel: "เมล็ดกาแฟ", price: { "คั่วอ่อน": 70, "คั่วเข้ม": 70 }, addons: COFFEE_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 21 },
  { id: 22, cat: "coffee", nameTh: "คาปูชิโน่",           nameEn: "Cappuccino",        variantLabel: "เมล็ดกาแฟ", price: { "คั่วอ่อน": 70, "คั่วเข้ม": 70 }, addons: COFFEE_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 22 },
  { id: 23, cat: "coffee", nameTh: "ลาเต้",               nameEn: "Latte",             variantLabel: "เมล็ดกาแฟ", price: { "คั่วอ่อน": 70, "คั่วเข้ม": 70 }, addons: COFFEE_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 23 },
  { id: 24, cat: "coffee", nameTh: "คาราเมล มัคคิอาโต",    nameEn: "Caramel Macchiato", variantLabel: "เมล็ดกาแฟ", price: { "คั่วอ่อน": 80, "คั่วเข้ม": 80 }, addons: COFFEE_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 24 },

  // 🥛 นม & ชา
  { id: 30, cat: "milk", nameTh: "นมสดเย็น",             nameEn: "Fresh Milk",    variantLabel: "", price: { default: 70 }, addons: MILK_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 30 },
  { id: 31, cat: "milk", nameTh: "นมชมพูเย็น",           nameEn: "Pink Milk",     variantLabel: "", price: { default: 70 }, addons: MILK_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 31 },
  { id: 32, cat: "milk", nameTh: "นมคาราเมลเย็น",        nameEn: "Caramel Milk",  variantLabel: "", price: { default: 70 }, addons: MILK_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 32 },
  { id: 33, cat: "milk", nameTh: "นมเฮเซลนัทเย็น",       nameEn: "Hazelnut Milk", variantLabel: "", price: { default: 70 }, addons: MILK_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 33 },
  { id: 34, cat: "milk", nameTh: "ช็อกโกแลตบานาน่าเย็น",  nameEn: "Choco Banana",  variantLabel: "", price: { default: 70 }, addons: MILK_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 34 },
  { id: 35, cat: "milk", nameTh: "โกโก้",                nameEn: "Cocoa",         variantLabel: "", price: { default: 70 }, addons: MILK_ADDONS, level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 35 },

  // 🥤 Italian Soda
  { id: 40, cat: "soda", nameTh: "Watermelon",  nameEn: "Watermelon",  variantLabel: "", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 40 },
  { id: 41, cat: "soda", nameTh: "Pineapple",   nameEn: "Pineapple",   variantLabel: "", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 41 },
  { id: 42, cat: "soda", nameTh: "Kiwi",        nameEn: "Kiwi",        variantLabel: "", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 42 },
  { id: 43, cat: "soda", nameTh: "Melon",       nameEn: "Melon",       variantLabel: "", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 43 },
  { id: 44, cat: "soda", nameTh: "Honey Lemon", nameEn: "Honey Lemon", variantLabel: "", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 44 },
  { id: 45, cat: "soda", nameTh: "Lychee",      nameEn: "Lychee",      variantLabel: "", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 45 },
  { id: 46, cat: "soda", nameTh: "Kyoho Grape", nameEn: "Kyoho Grape", variantLabel: "", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 46 },
  { id: 47, cat: "soda", nameTh: "Banana",      nameEn: "Banana",      variantLabel: "", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 47 },
  { id: 48, cat: "soda", nameTh: "Cantaloupe",  nameEn: "Cantaloupe",  variantLabel: "", price: { default: 70 }, addons: [], level: SWEETNESS, levelLabel: "ระดับความหวาน", sortOrder: 48 },
];

module.exports = MENU_SEED;
