/**
 * team-palette.js — Sidebar skill/buff palette for the team damage calculator.
 *
 * Renders a palette sidebar where the user can select skills and buffs,
 * then click/drag them onto the battle grid.  Also provides management UI
 * for generic skills and generic buffs (add/remove).
 */

import {
  state,
  render,
  renderResult,
  getSlotChar,
  getSlotStatTotals,
  getSlotPermanentBuffs,
  getAvailableBuffsForPalette,
  findBuffById,
} from "./team-app.js";
import { genericSkills } from "./generic-skills.js";
import { commonBuffs } from "./buffs.js";
import { createSearchableSelect } from "./searchable-select.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function isSelected(type, id) {
  const sel = state.paletteSelection;
  if (!sel) return false;
  return sel.type === type && sel.id === id;
}

// Pending selections for add controls (persisted across re-renders within session)
let pendingGsId = null;
let pendingGbBuffId = null;
let pendingGbSourceSlot = null;

function buffDesc(buff) {
  return buff.description || "";
}

/* ------------------------------------------------------------------ */
/*  renderPalette                                                      */
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

  // ---- 1. Character skills section ----
  html += '<div class="palette-section">';
  html += '<h3 class="palette-title">技能</h3>';

  for (let i = 0; i < char.skills.length; i++) {
    const skill = char.skills[i];
    const typeClass = skill.type; // basic / skill / combo / ultimate
    const selectedClass = isSelected("skill", i) ? " selected" : "";
    html += `<div class="palette-item skill-item ${typeClass}${selectedClass}" data-type="skill" data-id="${i}">${skill.name}</div>`;
  }

  html += "</div>";

  // ---- 2. Generic skills (added ones shown as draggable + add/remove UI) ----
  html += '<div class="palette-section">';
  html += '<h3 class="palette-title">通用技能</h3>';

  // Added generic skills (draggable)
  for (const gsId of slot.addedGenericSkillIds) {
    const gs = genericSkills.find((s) => s.id === gsId);
    if (!gs) continue;
    const selectedClass = isSelected("skill", gs.id) ? " selected" : "";
    html += `<div class="palette-item skill-item generic${selectedClass}" data-type="skill" data-id="${gs.id}">`;
    html += `${gs.name}`;
    html += `<button class="palette-remove-btn" data-remove-gs="${gs.id}" title="移除">×</button>`;
    html += `</div>`;
  }

  // Add control
  const availableGs = genericSkills.filter((gs) => !slot.addedGenericSkillIds.includes(gs.id));
  if (availableGs.length > 0) {
    html += '<div class="palette-add-row">';
    html += '<div id="ss-gs-add" class="palette-ss-container"></div>';
    html += '<button id="gs-add-btn" class="palette-add-btn">+</button>';
    html += '</div>';
  }

  html += "</div>";

  // ---- 3. Generic buffs (added ones as draggable + add/remove UI) ----
  html += '<div class="palette-section">';
  html += '<h3 class="palette-title">通用Buff</h3>';

  // Added generic buffs (draggable, like optional buffs)
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

  // Add control
  html += '<div class="palette-add-row">';
  html += '<div id="ss-gb-buff" class="palette-ss-container"></div>';
  html += '<div id="ss-gb-source" class="palette-ss-container palette-ss-narrow"></div>';
  html += '<button id="gb-add-btn" class="palette-add-btn">+</button>';
  html += '</div>';

  html += "</div>";

  // ---- 4. Optional buffs section (clickable for grid placement) ----
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

      html += `<div class="palette-subgroup">${sourceLabel}</div>`;

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

  // ---- 5. Permanent buffs section (display-only) ----
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

  // ---- Initialize searchable selects ----

  // Generic skill add
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

  // Generic buff add - buff select
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

  // Generic buff add - source select
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
/*  initPaletteEvents                                                  */
/* ------------------------------------------------------------------ */

export function initPaletteEvents() {
  const container = document.getElementById("palette");

  // 用户输入 buff 值变更（仅刷新结果，不重建面板，避免失焦）
  container.addEventListener("input", (e) => {
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
    if (e.target.classList.contains("user-input-field")) return;
    // --- Remove generic skill ---
    const removeGs = e.target.closest("[data-remove-gs]");
    if (removeGs) {
      e.stopPropagation();
      const slot = state.slots[state.activeSlotIndex];
      const gsId = removeGs.dataset.removeGs;
      slot.addedGenericSkillIds = slot.addedGenericSkillIds.filter((id) => id !== gsId);
      // Also clear from grid
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

    // --- Remove generic buff ---
    const removeGb = e.target.closest("[data-remove-gb]");
    if (removeGb) {
      e.stopPropagation();
      const slot = state.slots[state.activeSlotIndex];
      slot.genericBuffs.splice(parseInt(removeGb.dataset.removeGb, 10), 1);
      render();
      return;
    }

    // --- Add generic skill ---
    if (e.target.id === "gs-add-btn" || e.target.closest("#gs-add-btn")) {
      if (pendingGsId) {
        const slot = state.slots[state.activeSlotIndex];
        slot.addedGenericSkillIds.push(pendingGsId);
        pendingGsId = null;
        render();
      }
      return;
    }

    // --- Add generic buff ---
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

    // --- Select skill / buff for grid placement ---
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
