/**
 * team-palette.js — 组队伤害计算器的侧边栏技能/buff 面板。
 *
 * 渲染一个面板，用户可以选择技能和 buff，然后点击放置到战斗表格中。
 * 同时提供通用技能和通用 buff 的添加/移除管理界面。
 */

import {
  state,
  render,
  renderResult,
  getSlotChar,
  getSlotStatTotals,
  getSlotPermanentBuffs,
  getSlotOptionalBuffs,
  getAvailableBuffsForPalette,
  getGridPlacedBuffIds,
  findBuffById,
} from "./team-app.js";
import { genericSkills } from "./generic-skills.js";
import { commonBuffs } from "./buffs.js";
import { createSearchableSelect } from "./searchable-select.js";

/* ------------------------------------------------------------------ */
/*  辅助函数                                                           */
/* ------------------------------------------------------------------ */

function isSelected(type, id) {
  const sel = state.paletteSelection;
  if (!sel) return false;
  return sel.type === type && sel.id === id;
}

// 面板添加控件的待选值（在重渲染之间保持）
let pendingGsId = null;
let pendingGbBuffId = null;
let pendingGbSourceSlot = null;

function buffDesc(buff) {
  return buff.description || "";
}

/* ------------------------------------------------------------------ */
/*  渲染面板                                                           */
/* ------------------------------------------------------------------ */

export function renderPalette() {
  const el = document.getElementById("palette");
  if (!el) return;

  const slotIndex = state.activeSlotIndex;
  const slot = state.slots[slotIndex];
  const char = getSlotChar(slotIndex);

  if (!char) {
    el.innerHTML = '<div class="palette"><p class="palette-empty">请先选择角色</p></div>';
    return;
  }

  let html = '<div class="palette">';

  // ---- 1. 角色技能 ----
  html += '<div class="palette-section">';
  html += '<h3 class="palette-title">技能</h3>';

  for (let i = 0; i < char.skills.length; i++) {
    const skill = char.skills[i];
    const typeClass = skill.type; // basic / skill / combo / ultimate
    const selectedClass = isSelected("skill", i) ? " selected" : "";
    html += `<div class="palette-item skill-item ${typeClass}${selectedClass}" data-type="skill" data-id="${i}">${skill.name}`;
    if (skill.userInput) {
      const curVal = slot.skillInputValues?.[i] ?? skill.userInput.default ?? 0;
      const label = skill.userInput.label || "";
      const minAttr = skill.userInput.min != null ? ` min="${skill.userInput.min}"` : "";
      const maxAttr = skill.userInput.max != null ? ` max="${skill.userInput.max}"` : "";
      html += ` <input type="number" class="user-input-field skill-input-field" data-skill-index="${i}" value="${curVal}"${minAttr}${maxAttr} step="1" />`;
      if (label) html += `<span class="user-input-label">${label}</span>`;
    }
    html += `</div>`;
  }

  html += "</div>";

  // ---- 2. 通用技能（已添加的可拖放 + 添加/移除界面）----
  html += '<div class="palette-section">';
  html += '<h3 class="palette-title">通用技能</h3>';

  // 已添加的通用技能（可拖放）
  for (const gsId of slot.addedGenericSkillIds) {
    const gs = genericSkills.find((s) => s.id === gsId);
    if (!gs) continue;
    const selectedClass = isSelected("skill", gs.id) ? " selected" : "";
    html += `<div class="palette-item skill-item generic${selectedClass}" data-type="skill" data-id="${gs.id}">`;
    html += `${gs.name}`;
    if (gs.userInput) {
      const curVal = slot.skillInputValues?.[gs.id] ?? gs.userInput.default ?? 0;
      const label = gs.userInput.label || "";
      const minAttr = gs.userInput.min != null ? ` min="${gs.userInput.min}"` : "";
      const maxAttr = gs.userInput.max != null ? ` max="${gs.userInput.max}"` : "";
      html += ` <input type="number" class="user-input-field skill-input-field" data-skill-index="${gs.id}" value="${curVal}"${minAttr}${maxAttr} step="1" />`;
      if (label) html += `<span class="user-input-label">${label}</span>`;
    }
    html += `<button class="palette-remove-btn" data-remove-gs="${gs.id}" title="移除">×</button>`;
    html += `</div>`;
  }

  // 添加控件
  const availableGs = genericSkills.filter((gs) => !slot.addedGenericSkillIds.includes(gs.id));
  if (availableGs.length > 0) {
    html += '<div class="palette-add-row">';
    html += '<div id="ss-gs-add" class="palette-ss-container"></div>';
    html += '<button id="gs-add-btn" class="palette-add-btn">+</button>';
    html += '</div>';
  }

  html += "</div>";

  // ---- 3. 通用Buff（已添加的可拖放 + 添加/移除界面）----
  html += '<div class="palette-section">';
  html += '<h3 class="palette-title">通用Buff</h3>';

  // 已添加的通用 buff（可拖放，类似可选 buff）
  for (let gi = 0; gi < slot.genericBuffs.length; gi++) {
    const gb = slot.genericBuffs[gi];
    const buff = findBuffById(gb.buffId);
    const sourceChar = getSlotChar(gb.statSourceSlot);
    const compositeId = `gb:${gb.buffId}:${gb.statSourceSlot}`;
    const selectedClass = isSelected("buff", compositeId) ? " selected" : "";
    html += `<div class="palette-item buff-item generic-buff-entry${selectedClass}" data-type="buff" data-id="${compositeId}" title="${buff?.description || ''}">`;
    html += `○ ${buff ? buff.name : gb.buffId}`;
    html += `<span class="gb-source-tag">← ${sourceChar ? sourceChar.name : "?"}</span>`;
    if (buff?.userInput) {
      const curVal = slot.userInputValues?.[gb.buffId] ?? buff.userInput.default ?? 0;
      const label = buff.userInput.label || "";
      html += ` <input type="number" class="user-input-field" data-buff-id="${gb.buffId}" value="${curVal}" step="any" />`;
      if (label) html += `<span class="user-input-label">${label}</span>`;
    }
    html += `<button class="palette-remove-btn" data-remove-gb="${gi}" title="移除">×</button>`;
    html += `</div>`;
  }

  // 添加控件
  html += '<div class="palette-add-row">';
  html += '<div id="ss-gb-buff" class="palette-ss-container"></div>';
  html += '<div id="ss-gb-source" class="palette-ss-container palette-ss-narrow"></div>';
  html += '<button id="gb-add-btn" class="palette-add-btn">+</button>';
  html += '</div>';

  html += "</div>";

  // ---- 4. 可选 buff（点击后放置到表格）----
  const availableBuffs = getAvailableBuffsForPalette(slotIndex);

  if (availableBuffs.length > 0) {
    html += '<div class="palette-section">';
    html += '<h3 class="palette-title">可选效果</h3>';

    const groups = [];
    const groupMap = new Map();

    for (const entry of availableBuffs) {
      if (!groupMap.has(entry.source)) {
        const group = { source: entry.source, entries: [] };
        groupMap.set(entry.source, group);
        groups.push(group);
      }
      groupMap.get(entry.source).entries.push(entry);
    }

    for (const group of groups) {
      let sourceLabel;
      if (group.source === "self") {
        sourceLabel = "自身";
      } else if (group.source.startsWith("teammate:")) {
        const charName = group.source.slice("teammate:".length);
        sourceLabel = `队友·${charName}`;
      } else if (group.source === "common") {
        sourceLabel = "通用";
      } else if (group.source === "field") {
        sourceLabel = "场地";
      } else {
        sourceLabel = group.source;
      }

      html += `<div class="palette-subgroup">${sourceLabel}`;
      if (group.source.startsWith("teammate:")) {
        const srcSlot = group.entries[0].sourceSlotIndex;
        if (srcSlot != null) {
          html += ` <button class="team-buff-config-btn" data-source-slot="${srcSlot}" title="配置来源属性加成">&#9881;</button>`;
        }
      }
      html += `</div>`;

      for (const entry of group.entries) {
        const selectedClass = isSelected("buff", entry.id) ? " selected" : "";
        const desc = buffDesc(entry.buff);
        html += `<div class="palette-item buff-item${selectedClass}" data-type="buff" data-id="${entry.id}" title="${desc}">`;
        html += `○ ${entry.buff.name}`;
        if (entry.buff.userInput) {
          const slot = state.slots[slotIndex];
          const curVal = slot.userInputValues?.[entry.buff.id] ?? entry.buff.userInput.default ?? 0;
          const label = entry.buff.userInput.label || "";
          html += ` <input type="number" class="user-input-field" data-buff-id="${entry.buff.id}" value="${curVal}" step="any" />`;
          if (label) html += `<span class="user-input-label">${label}</span>`;
        } else if (desc) {
          html += ` <span class="palette-desc">${desc}</span>`;
        }
        html += "</div>";
      }
    }

    html += "</div>";
  }

  // ---- 5. 永久 buff（仅展示）----
  const permanentBuffs = getSlotPermanentBuffs(slotIndex);

  if (permanentBuffs.length > 0) {
    html += '<div class="palette-section">';
    html += '<h3 class="palette-title">永久生效（自动计入）</h3>';

    for (const buff of permanentBuffs) {
      const desc = buffDesc(buff);
      html += `<div class="palette-item permanent" title="${desc}">`;
      html += `● ${buff.name}`;
      if (buff.userInput) {
        const slot = state.slots[slotIndex];
        const curVal = slot.userInputValues?.[buff.id] ?? buff.userInput.default ?? 0;
        const label = buff.userInput.label || "";
        html += ` <input type="number" class="user-input-field" data-buff-id="${buff.id}" value="${curVal}" step="any" />`;
        if (label) html += `<span class="user-input-label">${label}</span>`;
      } else if (desc) {
        html += ` <span class="palette-desc">${desc}</span>`;
      }
      html += "</div>";
    }

    html += "</div>";
  }

  html += "</div>"; // end .palette wrapper
  el.innerHTML = html;

  // ---- 初始化可搜索下拉框 ----

  // 通用技能添加
  const gsContainer = el.querySelector("#ss-gs-add");
  if (gsContainer) {
    const availGs = genericSkills.filter((gs) => !slot.addedGenericSkillIds.includes(gs.id));
    createSearchableSelect(gsContainer, {
      options: availGs.map((gs) => {
        const hitsDesc = gs.hits.map((h) => `${(h.multiplier * 100).toFixed(0)}%`).join("+");
        return { value: gs.id, label: `${gs.name} (${hitsDesc})` };
      }),
      value: pendingGsId,
      emptyLabel: "-- 添加通用技能 --",
      placeholder: "搜索技能...",
      onChange: (val) => { pendingGsId = val; },
    });
  }

  // 通用 buff 添加 - buff 选择
  const gbBuffContainer = el.querySelector("#ss-gb-buff");
  if (gbBuffContainer) {
    createSearchableSelect(gbBuffContainer, {
      options: commonBuffs.map((b) => ({ value: b.id, label: `${b.name} (${b.description})` })),
      value: pendingGbBuffId,
      emptyLabel: "-- 选择 buff --",
      placeholder: "搜索buff...",
      onChange: (val) => { pendingGbBuffId = val; },
    });
  }

  // 通用 buff 添加 - 来源角色选择
  const gbSourceContainer = el.querySelector("#ss-gb-source");
  if (gbSourceContainer) {
    const sourceOptions = [];
    for (let si = 0; si < 4; si++) {
      const sc = getSlotChar(si);
      if (sc) sourceOptions.push({ value: String(si), label: sc.name });
    }
    createSearchableSelect(gbSourceContainer, {
      options: sourceOptions,
      value: pendingGbSourceSlot != null ? String(pendingGbSourceSlot) : null,
      emptyLabel: "-- 来源角色 --",
      placeholder: "搜索角色...",
      onChange: (val) => { pendingGbSourceSlot = val != null ? parseInt(val, 10) : null; },
    });
  }
}

/* ------------------------------------------------------------------ */
/*  团队 buff 属性加成弹出面板                                           */
/* ------------------------------------------------------------------ */

function showTeamBuffStatPopup(sourceSlotIndex, anchorEl) {
  document.querySelector(".team-buff-popup")?.remove();

  const slot = state.slots[sourceSlotIndex];
  const optionalBuffs = getSlotOptionalBuffs(sourceSlotIndex);
  if (optionalBuffs.length === 0) return;

  // 初始化：null 表示自动模式，从 grid 推导
  if (slot.teamBuffActiveOptionals == null) {
    const gridIds = getGridPlacedBuffIds(sourceSlotIndex);
    slot.teamBuffActiveOptionals = optionalBuffs
      .filter(b => gridIds.has(b.id))
      .map(b => b.id);
  }

  const popup = document.createElement("div");
  popup.className = "team-buff-popup";
  const rect = anchorEl.getBoundingClientRect();
  popup.style.position = "fixed";
  popup.style.left = `${rect.right + 4}px`;
  popup.style.top = `${rect.top}px`;

  const srcChar = getSlotChar(sourceSlotIndex);
  let html = `<div class="team-buff-popup-title">${srcChar ? srcChar.name : ""} 属性加成</div>`;
  for (const buff of optionalBuffs) {
    const checked = slot.teamBuffActiveOptionals.includes(buff.id) ? "checked" : "";
    const desc = buff.description || "";
    html += `<label class="team-buff-popup-item">`;
    html += `<input type="checkbox" data-buff-id="${buff.id}" ${checked} />`;
    html += `<span>${buff.name}</span>`;
    if (desc) html += `<span class="popup-buff-desc">${desc}</span>`;
    html += `</label>`;
  }
  popup.innerHTML = html;
  document.body.appendChild(popup);

  // 确保不超出视口
  const popupRect = popup.getBoundingClientRect();
  if (popupRect.bottom > window.innerHeight) {
    popup.style.top = `${window.innerHeight - popupRect.height - 8}px`;
  }
  if (popupRect.right > window.innerWidth) {
    popup.style.left = `${rect.left - popupRect.width - 4}px`;
  }

  popup.addEventListener("change", (e) => {
    const cb = e.target;
    if (!cb.dataset.buffId) return;
    const id = cb.dataset.buffId;
    if (cb.checked) {
      if (!slot.teamBuffActiveOptionals.includes(id)) {
        slot.teamBuffActiveOptionals.push(id);
      }
    } else {
      slot.teamBuffActiveOptionals = slot.teamBuffActiveOptionals.filter(x => x !== id);
    }
    renderResult();
  });

  const closeHandler = (e) => {
    if (!popup.contains(e.target) && e.target !== anchorEl) {
      popup.remove();
      document.removeEventListener("click", closeHandler);
    }
  };
  setTimeout(() => document.addEventListener("click", closeHandler), 0);
}

/* ------------------------------------------------------------------ */
/*  面板事件绑定                                                       */
/* ------------------------------------------------------------------ */

export function initPaletteEvents() {
  const container = document.getElementById("palette");

  // 用户输入 buff 值变更（仅刷新结果，不重建面板，避免失焦）
  container.addEventListener("input", (e) => {
    // 技能等级输入
    if (e.target.classList.contains("skill-input-field")) {
      const rawIdx = e.target.dataset.skillIndex;
      const slot = state.slots[state.activeSlotIndex];
      if (!slot.skillInputValues) slot.skillInputValues = {};
      slot.skillInputValues[rawIdx] = parseInt(e.target.value) || 0;
      renderResult();
      return;
    }
    // buff 输入
    if (e.target.classList.contains("user-input-field")) {
      const buffId = e.target.dataset.buffId;
      const slot = state.slots[state.activeSlotIndex];
      if (!slot.userInputValues) slot.userInputValues = {};
      slot.userInputValues[buffId] = parseFloat(e.target.value) || 0;
      renderResult();
    }
  });

  container.addEventListener("click", (e) => {
    // --- 防止点击输入框触发选中 ---
    if (e.target.classList.contains("user-input-field") || e.target.classList.contains("skill-input-field")) return;
    // --- 团队 buff 属性加成配置按钮 ---
    const configBtn = e.target.closest(".team-buff-config-btn");
    if (configBtn) {
      e.stopPropagation();
      const sourceSlot = parseInt(configBtn.dataset.sourceSlot, 10);
      showTeamBuffStatPopup(sourceSlot, configBtn);
      return;
    }
    // --- 移除通用技能 ---
    const removeGs = e.target.closest("[data-remove-gs]");
    if (removeGs) {
      e.stopPropagation();
      const slot = state.slots[state.activeSlotIndex];
      const gsId = removeGs.dataset.removeGs;
      slot.addedGenericSkillIds = slot.addedGenericSkillIds.filter((id) => id !== gsId);
      // 同时从表格中清除
      const grid = state.grids[state.activeSlotIndex];
      for (const row of grid) {
        if (row.skillIndex === gsId) row.skillIndex = null;
      }
      if (state.paletteSelection?.type === "skill" && state.paletteSelection?.id === gsId) {
        state.paletteSelection = null;
      }
      render();
      return;
    }

    // --- 移除通用 buff ---
    const removeGb = e.target.closest("[data-remove-gb]");
    if (removeGb) {
      e.stopPropagation();
      const slot = state.slots[state.activeSlotIndex];
      slot.genericBuffs.splice(parseInt(removeGb.dataset.removeGb, 10), 1);
      render();
      return;
    }

    // --- 添加通用技能 ---
    if (e.target.id === "gs-add-btn" || e.target.closest("#gs-add-btn")) {
      if (pendingGsId) {
        const slot = state.slots[state.activeSlotIndex];
        slot.addedGenericSkillIds.push(pendingGsId);
        pendingGsId = null;
        render();
      }
      return;
    }

    // --- 添加通用 buff ---
    if (e.target.id === "gb-add-btn" || e.target.closest("#gb-add-btn")) {
      if (pendingGbBuffId && pendingGbSourceSlot != null) {
        const slot = state.slots[state.activeSlotIndex];
        slot.genericBuffs.push({
          buffId: pendingGbBuffId,
          statSourceSlot: pendingGbSourceSlot,
        });
        pendingGbBuffId = null;
        pendingGbSourceSlot = null;
        render();
      }
      return;
    }

    // --- 选择技能/buff 用于放置到表格 ---
    const item = e.target.closest(".palette-item[data-type]");
    if (!item) return;

    const type = item.dataset.type;
    const rawId = item.dataset.id;
    const id = type === "skill" && /^\d+$/.test(rawId) ? parseInt(rawId, 10) : rawId;

    if (
      state.paletteSelection &&
      state.paletteSelection.type === type &&
      state.paletteSelection.id === id
    ) {
      state.paletteSelection = null;
    } else {
      state.paletteSelection = { type, id };
    }

    renderPalette();
  });
}
