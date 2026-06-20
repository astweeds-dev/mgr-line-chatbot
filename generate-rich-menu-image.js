const fs = require("fs");

// Simple BMP-like approach: generate an HTML file to screenshot,
// or we create a simple SVG and convert.
// For simplicity, we'll create an SVG that can be converted to PNG.

const width = 2500;
const height = 843;
const colWidth = Math.floor(width / 3);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <!-- Background -->
  <rect width="${width}" height="${height}" fill="#2D2D2D"/>

  <!-- Column 1: เมนูอาหาร -->
  <rect x="0" y="0" width="${colWidth}" height="${height}" fill="#E85D3A"/>
  <rect x="5" y="5" width="${colWidth - 10}" height="${height - 10}" rx="20" fill="#E85D3A" stroke="#FFFFFF" stroke-width="3"/>
  <text x="${colWidth / 2}" y="${height / 2 - 40}" text-anchor="middle" font-family="Arial, sans-serif" font-size="120" fill="white">🍱</text>
  <text x="${colWidth / 2}" y="${height / 2 + 60}" text-anchor="middle" font-family="Arial, sans-serif" font-size="64" font-weight="bold" fill="white">เมนูอาหาร</text>

  <!-- Column 2: เมนูกาแฟ -->
  <rect x="${colWidth}" y="0" width="${colWidth + 1}" height="${height}" fill="#6F4E37"/>
  <rect x="${colWidth + 5}" y="5" width="${colWidth - 10}" height="${height - 10}" rx="20" fill="#6F4E37" stroke="#FFFFFF" stroke-width="3"/>
  <text x="${colWidth + colWidth / 2}" y="${height / 2 - 40}" text-anchor="middle" font-family="Arial, sans-serif" font-size="120" fill="white">☕</text>
  <text x="${colWidth + colWidth / 2}" y="${height / 2 + 60}" text-anchor="middle" font-family="Arial, sans-serif" font-size="64" font-weight="bold" fill="white">เมนูกาแฟ</text>

  <!-- Column 3: ติดต่อ -->
  <rect x="${colWidth * 2}" y="0" width="${colWidth + 1}" height="${height}" fill="#2196F3"/>
  <rect x="${colWidth * 2 + 5}" y="5" width="${colWidth - 10}" height="${height - 10}" rx="20" fill="#2196F3" stroke="#FFFFFF" stroke-width="3"/>
  <text x="${colWidth * 2 + colWidth / 2}" y="${height / 2 - 40}" text-anchor="middle" font-family="Arial, sans-serif" font-size="120" fill="white">📞</text>
  <text x="${colWidth * 2 + colWidth / 2}" y="${height / 2 + 60}" text-anchor="middle" font-family="Arial, sans-serif" font-size="64" font-weight="bold" fill="white">ติดต่อ</text>
</svg>`;

fs.writeFileSync("rich-menu.svg", svg);
console.log("Created rich-menu.svg (2500x843)");
console.log("");
console.log("To convert to PNG, use one of these methods:");
console.log("  1. Open rich-menu.svg in a browser and screenshot");
console.log("  2. Use online converter: svg to png");
console.log('  3. Install sharp: npm install sharp, then run:');
console.log('     node -e "require(\'sharp\')(\'rich-menu.svg\').png().toFile(\'rich-menu-image.png\')"');
