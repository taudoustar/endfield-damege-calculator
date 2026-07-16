/**
 * 提取 weapons.json 中所有潜能数组的缩放模式
 *
 * 用法: node scripts/extract-potential-scales.js
 * 输出: 所有不同的 6 元素数组（潜能 0-5 等级数值）
 */

const fs = require("fs");
const path = require("path");

const weaponsPath = path.join(__dirname, "../data/weapons.json");
const weapons = JSON.parse(fs.readFileSync(weaponsPath, "utf-8"));

// 收集所有数组值，按来源分组
const scales = new Map(); // key: JSON字符串 -> { array, sources[] }

function collectArrays(obj, contextPath) {
  if (Array.isArray(obj) && obj.length === 6 && typeof obj[0] === "number") {
    const key = JSON.stringify(obj);
    if (!scales.has(key)) {
      scales.set(key, { array: obj, sources: [] });
    }
    scales.get(key).sources.push(contextPath);
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => collectArrays(item, `${contextPath}[${i}]`));
    return;
  }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      collectArrays(v, contextPath ? `${contextPath}.${k}` : k);
    }
  }
}

for (const item of weapons) {
  if (!item.id) continue;
  collectArrays(item.potentialBuffs, item.name);
}

// 按首元素排序输出
const sorted = [...scales.values()].sort((a, b) => {
  for (let i = 0; i < 6; i++) {
    if (a.array[i] !== b.array[i]) return a.array[i] - b.array[i];
  }
  return 0;
});

// 输出到文件（详细版）
const outputPath = path.join(__dirname, "potential-scales.txt");
const lines = [];

lines.push(`共发现 ${sorted.length} 种不同的潜能缩放数组:`);
lines.push("");
lines.push("数组值 [lv0, lv1, lv2, lv3, lv4, lv5]");
lines.push("=".repeat(60));

for (const { array, sources } of sorted) {
  const ratio = array[5] / array[0];
  const arrayStr = `[${array.join(", ")}]`;
  lines.push(`${arrayStr.padEnd(45)} 倍率: x${ratio.toFixed(2)}  (${sources.length}处使用)`);
  for (const src of sources) {
    lines.push(`    <- ${src}`);
  }
}

fs.writeFileSync(outputPath, lines.join("\n"), "utf-8");
console.log(`详细结果已保存到: ${outputPath}`);

// 输出到文件（纯数组版）
const arraysOnlyPath = path.join(__dirname, "potential-scales-arrays.txt");
const arrayLines = sorted.map(({ array }) => `[${array.join(", ")}]`);
fs.writeFileSync(arraysOnlyPath, arrayLines.join("\n"), "utf-8");
console.log(`纯数组已保存到: ${arraysOnlyPath}`);
