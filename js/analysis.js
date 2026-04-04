/**
 * analysis.js — 伤害分析图表模块
 *
 * 渲染角色/技能类型/元素的伤害占比条形图。
 */

import { elements } from "./elements.js";

const elementMap = Object.fromEntries(elements.map((e) => [e.key, e]));

const skillTypeColors = {
  basic: "#8bc34a",
  skill: "#ff9800",
  combo: "#2196f3",
  ultimate: "#e91e63",
  strike: "#9c27b0",
  status: "#00bcd4",
  generic: "#607d8b",
  other: "#9e9e9e",
};

const skillTypeLabels = {
  basic: "普攻",
  skill: "战技",
  combo: "连携",
  ultimate: "终结",
  strike: "重击",
  status: "异常",
  generic: "通用",
  other: "其他",
};

const charColors = ["#4fc3f7", "#ff8a65", "#aed581", "#ce93d8"];

function buildBarHTML(items, total) {
  if (total <= 0) return '<div class="bar-empty">无伤害数据</div>';
  let html = "";
  for (const item of items) {
    const pct = ((item.value / total) * 100).toFixed(1);
    const width = Math.max(parseFloat(pct), 0.5);
    html += `<div class="bar-row">`;
    html += `<span class="bar-label">${item.label}</span>`;
    html += `<div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${item.color};"></div></div>`;
    html += `<span class="bar-value">${pct}%</span>`;
    html += `<span class="bar-abs">${item.value.toFixed(0)}</span>`;
    html += `</div>`;
  }
  return html;
}

function buildCharBreakdown(slot) {
  const total = slot.totalDamage;
  if (total <= 0) return "";

  // 技能类型占比
  const typeMap = {};
  for (const row of slot.rowResults) {
    const t = row.skill?.type || "other";
    typeMap[t] = (typeMap[t] || 0) + row.rowDamage;
  }
  const typeItems = Object.entries(typeMap)
    .map(([t, v]) => ({ label: skillTypeLabels[t] || t, value: v, color: skillTypeColors[t] || "#9e9e9e" }))
    .sort((a, b) => b.value - a.value);

  // 元素占比
  const elemMap = {};
  for (const row of slot.rowResults) {
    const count = row.count || 1;
    for (const hit of row.hits) {
      const e = hit.element || "Physical";
      elemMap[e] = (elemMap[e] || 0) + hit.expectedDamage * count;
    }
  }
  const elemItems = Object.entries(elemMap)
    .map(([e, v]) => ({ label: elementMap[e]?.label || e, value: v, color: elementMap[e]?.color || "#c0c0c0" }))
    .sort((a, b) => b.value - a.value);

  let html = `<div class="char-breakdown">`;
  html += `<div class="char-breakdown-header">${slot.charName}</div>`;
  html += `<div class="char-breakdown-charts">`;
  html += `<div class="char-breakdown-col"><h4>技能类型</h4><div class="bar-chart">${buildBarHTML(typeItems, total)}</div></div>`;
  html += `<div class="char-breakdown-col"><h4>元素伤害</h4><div class="bar-chart">${buildBarHTML(elemItems, total)}</div></div>`;
  html += `</div></div>`;
  return html;
}

/**
 * @param {Array<{charName: string, totalDamage: number, rowResults: Array}>} slotResults
 */
export function renderAnalysis(slotResults) {
  const el = document.getElementById("damage-analysis");
  if (!el) return;

  const teamTotal = slotResults.reduce((s, r) => s + r.totalDamage, 0);

  // 1. 角色伤害占比
  const charItems = slotResults
    .filter((r) => r.charName)
    .map((r, i) => ({ label: r.charName, value: r.totalDamage, color: charColors[i % charColors.length] }))
    .sort((a, b) => b.value - a.value);

  // 2. 全队技能类型占比
  const typeMap = {};
  for (const slot of slotResults) {
    for (const row of slot.rowResults) {
      const t = row.skill?.type || "other";
      typeMap[t] = (typeMap[t] || 0) + row.rowDamage;
    }
  }
  const typeItems = Object.entries(typeMap)
    .map(([t, v]) => ({ label: skillTypeLabels[t] || t, value: v, color: skillTypeColors[t] || "#9e9e9e" }))
    .sort((a, b) => b.value - a.value);

  // 3. 全队元素占比
  const elemMap = {};
  for (const slot of slotResults) {
    for (const row of slot.rowResults) {
      const count = row.count || 1;
      for (const hit of row.hits) {
        const e = hit.element || "Physical";
        elemMap[e] = (elemMap[e] || 0) + hit.expectedDamage * count;
      }
    }
  }
  const elemItems = Object.entries(elemMap)
    .map(([e, v]) => ({ label: elementMap[e]?.label || e, value: v, color: elementMap[e]?.color || "#c0c0c0" }))
    .sort((a, b) => b.value - a.value);

  let html = "";

  html += `<div class="analysis-section"><h3>角色伤害占比</h3><div class="bar-chart">${buildBarHTML(charItems, teamTotal)}</div></div>`;
  html += `<div class="analysis-row">`;
  html += `<div class="analysis-section analysis-half"><h3>全队技能类型占比</h3><div class="bar-chart">${buildBarHTML(typeItems, teamTotal)}</div></div>`;
  html += `<div class="analysis-section analysis-half"><h3>全队元素伤害占比</h3><div class="bar-chart">${buildBarHTML(elemItems, teamTotal)}</div></div>`;
  html += `</div>`;

  // 4. 每个角色的单独分析（两列布局）
  const activeSlots = slotResults.filter((r) => r.charName && r.totalDamage > 0);
  if (activeSlots.length > 0) {
    html += `<div class="analysis-section"><h3>角色详细分析</h3><div class="char-breakdown-grid">`;
    for (const slot of activeSlots) {
      html += buildCharBreakdown(slot);
    }
    html += `</div></div>`;
  }

  el.innerHTML = html;
}
