/**
 * 组队伤害计算器 - 主入口
 *
 * 管理 4 人编队的状态与渲染，协调 team-grid / team-palette 子模块。
 */

import { categories } from "./categories.js";
import { elements } from "./elements.js";
import { statDefs, calculateAtk, calculateStatTotals, applyPercentBonuses, applyBuffStatBonuses } from "./stats.js";
import { commonBuffs } from "./buffs.js";
import { characters } from "./characters.js";
import { weapons, weaponTypeLabels, resolveWeaponBuffs } from "./weapons.js";
import { equipment, equipmentSets, collectEquipBuffs } from "./equipment.js";
import { externalBuffCatalog } from "./externalbuffs.js";
import { calculate, matchesCondition, applyBuffReplacements, applySkillOverrides, applyGenericSkillOverrides, collectCrit, piecewiseLinear, ARTS_INTENSITY_CURVE } from "./engine.js";
import { renderGrid, initGridEvents } from "./team-grid.js";
import { renderPalette, initPaletteEvents } from "./team-palette.js";
import { createSearchableSelect } from "./searchable-select.js";
import { renderAnalysis } from "./analysis.js";
import { initSaveLoad } from "./save-load.js";
import { loadAllData } from "./data-loader.js";
import { genericSkills } from "./generic-skills.js";

// ===== 查找表 =====
const elementMap = Object.fromEntries(elements.map((e) => [e.key, e]));
const statMap = Object.fromEntries(statDefs.map((s) => [s.key, s]));
const skillTypeLabels = { basic: "普攻", skill: "战技", combo: "连携", ultimate: "终结", strike: "重击", status: "异常", generic: "通用", other: "其他" };

// ===== 状态 =====
const state = {
  slots: [
    { charId: null, weaponId: null, weaponPotLevel: 0, charPotLevel: 0, equipment: { armor: null, gloves: null, kit1: null, kit2: null }, foodId: null, genericBuffs: [], addedGenericSkillIds: [], userInputValues: {} },
    { charId: null, weaponId: null, weaponPotLevel: 0, charPotLevel: 0, equipment: { armor: null, gloves: null, kit1: null, kit2: null }, foodId: null, genericBuffs: [], addedGenericSkillIds: [], userInputValues: {} },
    { charId: null, weaponId: null, weaponPotLevel: 0, charPotLevel: 0, equipment: { armor: null, gloves: null, kit1: null, kit2: null }, foodId: null, genericBuffs: [], addedGenericSkillIds: [], userInputValues: {} },
    { charId: null, weaponId: null, weaponPotLevel: 0, charPotLevel: 0, equipment: { armor: null, gloves: null, kit1: null, kit2: null }, foodId: null, genericBuffs: [], addedGenericSkillIds: [], userInputValues: {} },
  ],
  activeSlotIndex: 0,
  grids: [[], [], [], []], // each is GridRow[]
  paletteSelection: null, // { type: "skill"|"buff", id: string|number }
};

export { state };

// ===== 辅助：获取角色 =====

function getSlotChar(slotIndex) {
  const slot = state.slots[slotIndex];
  if (!slot || !slot.charId) return null;
  return characters.find((c) => c.id === slot.charId) || null;
}

// ===== 辅助：属性总值 =====

function getSlotStatTotals(slotIndex) {
  const char = getSlotChar(slotIndex);
  if (!char) return {};
  const slot = state.slots[slotIndex];
  const weapon = slot.weaponId ? weapons.find((w) => w.id === slot.weaponId) : null;
  const { totals, pendingPercent } = calculateStatTotals(char.baseStats, slot.equipment, equipment, weapon, char.statConfig);

  // 收集永久 buff（含潜能）的属性加成（固定值 + 词条）
  const permanentBuffs = getSlotPermanentBuffs(slotIndex);
  const primaryStat = char.statConfig?.primary?.stat;
  const secondaryStats = char.statConfig?.secondary || [];
  for (const buff of permanentBuffs) {
    if (buff.statBonuses) {
      for (const [stat, val] of Object.entries(buff.statBonuses)) {
        totals[stat] = (totals[stat] || 0) + val;
      }
    }
    if (buff.mainAffix && primaryStat) {
      if (buff.mainAffix.flat) totals[primaryStat] = (totals[primaryStat] || 0) + buff.mainAffix.flat;
      if (buff.mainAffix.percent) pendingPercent[primaryStat] = (pendingPercent[primaryStat] || 0) + buff.mainAffix.percent;
    }
    if (buff.subAffixes) {
      buff.subAffixes.forEach((affix, i) => {
        const sec = secondaryStats[i];
        if (!sec) return;
        if (affix.flat) totals[sec.stat] = (totals[sec.stat] || 0) + affix.flat;
        if (affix.percent) pendingPercent[sec.stat] = (pendingPercent[sec.stat] || 0) + affix.percent;
      });
    }
  }

  // 所有固定值累加完后，统一应用百分比词条
  applyPercentBonuses(totals, pendingPercent);

  return totals;
}

// ===== 辅助：攻击力配置 =====

function getSlotAtkConfig(slotIndex) {
  const char = getSlotChar(slotIndex);
  if (!char) return null;
  const slot = state.slots[slotIndex];
  const weapon = slot.weaponId ? weapons.find((w) => w.id === slot.weaponId) : null;
  const statTotals = getSlotStatTotals(slotIndex);
  return {
    baseAtk: char.baseAtk,
    weaponAtk: weapon ? weapon.baseAtk : 0,
    statConfig: char.statConfig,
    statTotals,
  };
}

// ===== Buff 收集：永久 =====

/**
 * 收集角色和潜能 buff，按 filter 过滤
 */
function collectCharBuffs(char, charPotLevel, filter) {
  const buffs = [];
  for (const b of char.uniqueBuffs) {
    if (filter(b)) buffs.push(b);
  }
  if (char.potentialBuffs) {
    for (let i = 0; i < charPotLevel && i < char.potentialBuffs.length; i++) {
      const pb = char.potentialBuffs[i];
      if (filter(pb)) buffs.push(pb);
      // 捆绑 buff：同一潜能等级可附带多个 buff（用于分别替换多个旧 buff）
      if (pb.bundle) {
        for (const bundled of pb.bundle) {
          if (filter(bundled)) buffs.push(bundled);
        }
      }
    }
  }
  return buffs;
}

function getSlotPermanentBuffs(slotIndex) {
  const char = getSlotChar(slotIndex);
  if (!char) return [];
  const slot = state.slots[slotIndex];

  const buffs = collectCharBuffs(char, slot.charPotLevel, (b) => !b.optional);

  // 武器 buff（仅非 optional）
  if (slot.weaponId) {
    const w = weapons.find((w) => w.id === slot.weaponId);
    if (w) {
      const resolved = resolveWeaponBuffs(w, slot.weaponPotLevel);
      buffs.push(...resolved.filter((b) => !b.optional));
    }
  }

  // 装备 + 套装 buff（非 optional）
  buffs.push(...collectEquipBuffs(slot.equipment, (b) => !b.optional));

  // 食物 buff
  if (slot.foodId) {
    const fb = externalBuffCatalog.find((b) => b.id === slot.foodId);
    if (fb) buffs.push(fb);
  }

  // 用所有已解锁 buff 检测替换（optional 潜能 buff 也能替换 permanent buff）
  const allUnlocked = collectCharBuffs(char, slot.charPotLevel, () => true);
  return applyBuffReplacements(buffs, allUnlocked);
}

// ===== Buff 收集：可选自身 =====

function getSlotOptionalBuffs(slotIndex) {
  const char = getSlotChar(slotIndex);
  if (!char) return [];
  const slot = state.slots[slotIndex];

  const buffs = collectCharBuffs(char, slot.charPotLevel, (b) => b.optional);
  buffs.push(...collectEquipBuffs(slot.equipment, (b) => b.optional));

  // 武器可选 buff
  if (slot.weaponId) {
    const w = weapons.find((w) => w.id === slot.weaponId);
    if (w) {
      const resolved = resolveWeaponBuffs(w, slot.weaponPotLevel);
      buffs.push(...resolved.filter((b) => b.optional));
    }
  }

  // 已解锁的升级版 buff 自动替换原版（面板中只显示升级版）
  return applyBuffReplacements(buffs);
}

// ===== Buff 收集：队友的 team scope buff =====

function getTeammateTeamBuffs(activeSlotIndex) {
  const results = [];
  for (let i = 0; i < 4; i++) {
    if (i === activeSlotIndex) continue;
    const char = getSlotChar(i);
    if (!char) continue;
    const slot = state.slots[i];

    const teamBuffs = [
      ...collectCharBuffs(char, slot.charPotLevel, (b) => b.scope === "team"),
      ...collectEquipBuffs(slot.equipment, (b) => b.scope === "team"),
    ];
    if (slot.weaponId) {
      const w = weapons.find((w) => w.id === slot.weaponId);
      if (w) {
        const resolved = resolveWeaponBuffs(w, slot.weaponPotLevel);
        teamBuffs.push(...resolved.filter((b) => b.scope === "team"));
      }
    }
    // 用所有已解锁 buff 检测替换，避免新旧版本同时出现
    const allUnlocked = collectCharBuffs(char, slot.charPotLevel, () => true);
    const filtered = applyBuffReplacements(teamBuffs, allUnlocked);
    for (const buff of filtered) {
      results.push({ fromCharName: char.name, buff });
    }
  }
  return results;
}

// ===== Buff 目录（供 palette 展示）=====

function getAvailableBuffsForPalette(slotIndex) {
  const entries = [];

  // 可选自身 buff
  for (const b of getSlotOptionalBuffs(slotIndex)) {
    entries.push({ id: b.id, buff: b, source: "self" });
  }

  // 队友 team buff
  for (const { fromCharName, buff } of getTeammateTeamBuffs(slotIndex)) {
    entries.push({ id: buff.id, buff, source: `teammate:${fromCharName}` });
  }

  // 场地 buff
  for (const b of externalBuffCatalog) {
    if (b.group === "场地") {
      entries.push({ id: b.id, buff: b, source: "field" });
    }
  }

  return entries;
}

// ===== 根据 ID 查找 buff =====

function findBuffById(id, slotIndex) {
  // 通用 buff 复合 ID：提取原始 buffId
  if (typeof id === "string" && id.startsWith("gb:")) {
    const buffId = id.split(":")[1];
    return findBuffById(buffId, slotIndex);
  }

  // 搜索所有角色的固有 / 潜能 buff
  for (const char of characters) {
    for (const b of char.uniqueBuffs) {
      if (b.id === id) return b;
    }
    if (char.potentialBuffs) {
      for (const pb of char.potentialBuffs) {
        if (pb.id === id) return pb;
        if (pb.bundle) {
          for (const bundled of pb.bundle) {
            if (bundled.id === id ) return bundled;
          }
        }
      }
    }
  }

  // 通用 buff
  for (const b of commonBuffs) {
    if (b.id === id) return b;
  }

  // 外部 buff（场地/食物）
  for (const b of externalBuffCatalog) {
    if (b.id === id) return b;
  }

  // 武器 buff：返回 resolve 后的版本（标量值），避免数组参与计算导致 NaN
  if (slotIndex != null) {
    const slot = state.slots[slotIndex];
    if (slot && slot.weaponId) {
      const w = weapons.find((w) => w.id === slot.weaponId);
      if (w) {
        const resolved = resolveWeaponBuffs(w, slot.weaponPotLevel);
        const found = resolved.find((b) => b.id === id);
        if (found) return found;
      }
    }
  }
  // 兜底：无 slotIndex 时搜索所有武器的 resolved buff（使用 level 0）
  for (const w of weapons) {
    if (!w.potentialBuffs) continue;
    for (const pb of w.potentialBuffs) {
      if (pb.id === id) {
        const resolved = resolveWeaponBuffs(w, 0);
        return resolved.find((b) => b.id === id) || pb;
      }
    }
  }

  // 装备 buff
  for (const eq of equipment) {
    if (!eq.buffs) continue;
    for (const b of eq.buffs) {
      if (b.id === id) return b;
    }
  }

  // 套装 buff
  for (const set of equipmentSets) {
    if (!set.buffs) continue;
    for (const b of set.buffs) {
      if (b.id === id) return b;
    }
  }

  return null;
}

// ===== 用户输入 buff 值解析 =====

/**
 * 将含 userInput 标记的 buff 的 effects/metas 注入用户填写的数值。
 * 数据格式：
 *   buff.userInput = { label: "%", default: 0, scale: 0.01 }
 *   effect/meta 中 userInput: true 的条目，value/multiplier 会被替换为 rawVal × scale
 */
function resolveUserInputBuffs(buffs, slotIndex, rowOverrides = {}) {
  const slot = state.slots[slotIndex];
  const vals = slot?.userInputValues || {};
  return buffs.map(buff => {
    if (!buff.userInput) return buff;
    const rawVal = rowOverrides[buff.id] ?? vals[buff.id] ?? buff.userInput.default ?? 0;
    const scale = buff.userInput.scale ?? 1;
    const val = rawVal * scale;
    return {
      ...buff,
      // userInput: true → 替换 value/multiplier；userInput: "fieldName" → 替换指定字段
      effects: buff.effects?.map(e => {
        if (!e.userInput) return e;
        const field = typeof e.userInput === "string" ? e.userInput : "value";
        return { ...e, [field]: val };
      }),
      metas: buff.metas?.map(m => {
        if (!m.userInput) return m;
        const field = typeof m.userInput === "string" ? m.userInput : "multiplier";
        return { ...m, [field]: val };
      }),
    };
  });
}

// ===== 收集某行生效的全部 buff =====

function resolveBuffStatSource(buff, sourceStatTotals) {
  if (!buff.effects) return buff;
  const hasScale = buff.effects.some((e) => e.scaleStat);
  if (!hasScale) return buff;
  return {
    ...buff,
    effects: buff.effects.map((e) => {
      if (!e.scaleStat) return e;
      return {
        category: e.category,
        value: (sourceStatTotals[e.scaleStat] || 0) * e.scaleRatio,
        condition: e.condition,
      };
    }),
  };
}

function collectRowBuffs(slotIndex, rowIndex) {
  const buffs = [...getSlotPermanentBuffs(slotIndex)];

  const grid = state.grids[slotIndex];
  if (!grid || !grid[rowIndex]) return buffs;

  const row = grid[rowIndex];
  // 收集行级别的 userInput 覆盖值
  const rowOverrides = {};
  for (const cell of row.buffCells) {
    if (cell == null) continue;
    // 格子新格式: { id, inputValue? }；兼容旧格式（纯字符串）
    const cellObj = typeof cell === "object" ? cell : { id: cell };
    const cellId = cellObj.id;
    if (cellObj.inputValue != null) {
      // 提取真实 buffId（通用 buff 格式 gb:buffId:slot 或普通 id）
      const rawBuffId = typeof cellId === "string" && cellId.startsWith("gb:")
        ? cellId.split(":")[1]
        : cellId;
      rowOverrides[rawBuffId] = cellObj.inputValue;
    }

    if (cellId == null) continue;

    // 通用 buff：复合 ID 格式 "gb:buffId:sourceSlot"
    if (typeof cellId === "string" && cellId.startsWith("gb:")) {
      const parts = cellId.split(":");
      const buffId = parts[1];
      const sourceSlot = parseInt(parts[2], 10);
      const buff = findBuffById(buffId, slotIndex);
      if (buff) {
        const sourceStatTotals = getSlotStatTotals(sourceSlot);
        buffs.push(resolveBuffStatSource(buff, sourceStatTotals));
      }
      continue;
    }

    const found = findBuffById(cellId, slotIndex);
    if (found) buffs.push(found);
  }

  // 用所有已解锁 buff 检测替换（格子中放的旧版 buff 也能被替换）
  const char = getSlotChar(slotIndex);
  const slot = state.slots[slotIndex];
  const allUnlocked = char ? collectCharBuffs(char, slot.charPotLevel, () => true) : [];
  return resolveUserInputBuffs(applyBuffReplacements(buffs, allUnlocked), slotIndex, rowOverrides);
}

function calculateSlotDamage(slotIndex) {
  const char = getSlotChar(slotIndex);
  if (!char) return { rowResults: [], totalDamage: 0 };

  const atkConfig = getSlotAtkConfig(slotIndex);
  if (!atkConfig) return { rowResults: [], totalDamage: 0 };

  // 预计算技能覆盖（潜能 buff 可能修改技能倍率）
  const permanentBuffs = getSlotPermanentBuffs(slotIndex);
  const finalSkills = applySkillOverrides(char.skills, permanentBuffs);

  const grid = state.grids[slotIndex];
  const rowResults = [];
  let totalDamage = 0;

  for (let rowIdx = 0; rowIdx < grid.length; rowIdx++) {
    const row = grid[rowIdx];
    if (row.skillIndex == null) {
      rowResults.push({ skill: null, count: row.count, skillOnce: 0, rowDamage: 0, hits: [] });
      continue;
    }

    const skill = typeof row.skillIndex === "string"
      ? applyGenericSkillOverrides(
          genericSkills.find((s) => s.id === row.skillIndex),
          permanentBuffs
        )
      : finalSkills[row.skillIndex];
    if (!skill) {
      rowResults.push({ skill: null, count: row.count, skillOnce: 0, rowDamage: 0, hits: [] });
      continue;
    }

    const rowBuffs = collectRowBuffs(slotIndex, rowIdx);

    // 按行重算属性：只把格子中额外加入的 buff 的 statBonuses 追加到已有属性上
    // permanent buff 的 statBonuses 已在 atkConfig.statTotals 中计入，不重复处理
    const permanentBuffIds = new Set(permanentBuffs.map((b) => b.id));
    const extraRowBuffs = rowBuffs.filter((b) => !permanentBuffIds.has(b.id));
    const rowStatTotals = applyBuffStatBonuses(atkConfig.statTotals, extraRowBuffs, char.statConfig);
    const rowAtkConfig = { ...atkConfig, statTotals: rowStatTotals };

    const hits = [];
    let skillOnce = 0;

    for (const hit of skill.hits) {
      const context = {
        skillType: skill.type,
        element: hit.element,
        statTotals: rowStatTotals,
      };

      const atkResult = calculateAtk(rowAtkConfig, rowBuffs, context);
      const effectiveBase = hit.multiplier * atkResult.totalAtk;
      const { finalDamage, breakdown } = calculate(effectiveBase, rowBuffs, categories, context);

      // 异常技能额外乘以 f(源石技艺强度)
      let artsInfo = null;
      let dmgAfterArts = finalDamage;
      if (skill.type === "status") {
        const artsIntensity = rowStatTotals.artsIntensity || 0;
        const artsMultiplier = piecewiseLinear(artsIntensity, ARTS_INTENSITY_CURVE);
        dmgAfterArts = finalDamage * artsMultiplier;
        artsInfo = { artsIntensity, artsMultiplier };
      }

      const crit = collectCrit(rowBuffs, context, char.baseCritRate || 0, char.baseCritDamage || 0);
      const expectedDamage = dmgAfterArts * crit.expectedMultiplier;

      hits.push({
        element: hit.element,
        multiplier: hit.multiplier,
        totalAtk: atkResult.totalAtk,
        atkBreakdown: atkResult.breakdown,
        effectiveBase,
        finalDamage: dmgAfterArts,
        artsInfo,
        expectedDamage,
        crit,
        breakdown,
      });
      skillOnce += expectedDamage;
    }

    const rowDamage = skillOnce * row.count;
    totalDamage += rowDamage;
    rowResults.push({ skill, count: row.count, skillOnce, rowDamage, hits });
  }

  return { rowResults, totalDamage };
}

// ===== 渲染：槽位标签 =====

function renderSlotTabs() {
  const el = document.getElementById("slot-tabs");
  if (!el) return;
  let html = "";
  for (let i = 0; i < 4; i++) {
    const char = getSlotChar(i);
    const label = char ? char.name : `槽位${i + 1}`;
    const cls = i === state.activeSlotIndex ? "slot-tab active" : "slot-tab";
    html += `<button class="${cls}" data-slot="${i}">${label}</button>`;
  }
  el.innerHTML = html;

  el.querySelectorAll(".slot-tab").forEach((btn) => {
    btn.onclick = () => {
      state.activeSlotIndex = parseInt(btn.dataset.slot, 10);
      state.paletteSelection = null;
      render();
    };
  });
}

// ===== 渲染：槽位配置 =====

function renderSlotConfig() {
  const el = document.getElementById("slot-config");
  if (!el) return;

  const idx = state.activeSlotIndex;
  const slot = state.slots[idx];
  const char = getSlotChar(idx);

  let html = "";

  // --- 角色选择 ---
  html += '<div class="config-row">';
  html += '<span class="config-label">角色</span>';
  html += '<div id="ss-char"></div></div>';

  if (!char) {
    el.innerHTML = html;
    initSlotSearchableSelects(el, idx);
    return;
  }

  // --- 角色潜能 ---
  if (char.potentialBuffs && char.potentialBuffs.length > 0) {
    html += '<div class="config-row">';
    html += '<span class="config-label">角色潜能</span>';
    for (let i = 0; i <= 5; i++) {
      const cls = i === slot.charPotLevel ? "pot-btn active" : "pot-btn";
      html += `<button class="${cls}" data-type="charPot" data-level="${i}">${i}</button>`;
    }
    html += "</div>";
  }

  // --- 武器选择 ---
  html += '<div class="config-row">';
  html += '<span class="config-label">武器</span>';
  html += '<div id="ss-weapon"></div></div>';

  // --- 武器潜能 ---
  if (slot.weaponId) {
    html += '<div class="config-row">';
    html += '<span class="config-label">武器潜能</span>';
    for (let i = 0; i <= 5; i++) {
      const cls = i === slot.weaponPotLevel ? "pot-btn active" : "pot-btn";
      html += `<button class="${cls}" data-type="weaponPot" data-level="${i}">${i}</button>`;
    }
    html += "</div>";
  }

  // --- 装备选择（4 栏）---
  const equipSlots = [
    { key: "armor", label: "护甲", slotType: "armor" },
    { key: "gloves", label: "护手", slotType: "gloves" },
    { key: "kit1", label: "配件1", slotType: "kit" },
    { key: "kit2", label: "配件2", slotType: "kit" },
  ];
  for (const es of equipSlots) {
    html += '<div class="config-row">';
    html += `<span class="config-label">${es.label}</span>`;
    html += `<div id="ss-equip-${es.key}"></div></div>`;
  }

  // --- 食物选择 ---
  html += '<div class="config-row">';
  html += '<span class="config-label">食物</span>';
  html += '<div id="ss-food"></div></div>';

  // --- 属性总览（紧凑单行）---
  const statTotals = getSlotStatTotals(idx);
  const weapon = slot.weaponId ? weapons.find((w) => w.id === slot.weaponId) : null;
  const totalBaseAtk = char.baseAtk + (weapon ? weapon.baseAtk : 0);

  html += '<div class="stat-summary-compact">';
  for (const sd of statDefs) {
    const val = statTotals[sd.key] || 0;
    html += `<span class="stat-compact">${sd.label}:${val}</span>`;
  }
  html += `<span class="stat-compact atk-compact">基攻:${totalBaseAtk}</span>`;
  html += "</div>";

  el.innerHTML = html;
  initSlotSearchableSelects(el, idx);
  bindSlotPotentialEvents(el, idx);
}

// ===== 初始化可搜索下拉框 =====

function initSlotSearchableSelects(el, slotIndex) {
  const slot = state.slots[slotIndex];
  const char = getSlotChar(slotIndex);

  // 角色选择
  const charContainer = el.querySelector("#ss-char");
  if (charContainer) {
    createSearchableSelect(charContainer, {
      options: characters.map((c) => ({ value: c.id, label: c.name })),
      value: slot.charId,
      emptyLabel: "-- 未选择 --",
      placeholder: "搜索角色...",
      onChange: (val) => {
        slot.charId = val;
        slot.weaponId = null;
        slot.weaponPotLevel = 0;
        slot.charPotLevel = 0;
        slot.equipment = { armor: null, gloves: null, kit1: null, kit2: null };
        slot.foodId = null;
        slot.genericBuffs = [];
        slot.addedGenericSkillIds = [];
        slot.userInputValues = {};
        state.grids[slotIndex] = Array.from({ length: 4 }, () => ({
          skillIndex: null, count: 1, buffCells: [null, null, null],
        }));
        state.paletteSelection = null;
        render();
      },
    });
  }

  if (!char) return;

  // 武器选择
  const weaponContainer = el.querySelector("#ss-weapon");
  if (weaponContainer) {
    const availWeapons = weapons.filter((w) => w.type === char.weaponType);
    createSearchableSelect(weaponContainer, {
      options: availWeapons.map((w) => ({
        value: w.id,
        label: `${w.name} (${weaponTypeLabels[w.type]} ATK:${w.baseAtk})`,
      })),
      value: slot.weaponId,
      emptyLabel: "-- 未装备 --",
      placeholder: "搜索武器...",
      onChange: (val) => { slot.weaponId = val; slot.weaponPotLevel = 0; render(); },
    });
  }

  // 装备选择（4 栏）
  const equipSlots = [
    { key: "armor", slotType: "armor" },
    { key: "gloves", slotType: "gloves" },
    { key: "kit1", slotType: "kit" },
    { key: "kit2", slotType: "kit" },
  ];
  for (const es of equipSlots) {
    const container = el.querySelector(`#ss-equip-${es.key}`);
    if (!container) continue;
    const available = equipment.filter((e) => e.slot === es.slotType);

    createSearchableSelect(container, {
      options: available.map((eq) => {
        const statStr = Object.entries(eq.statBonuses || {})
          .filter(([, v]) => v)
          .map(([k, v]) => `${statMap[k]?.label || k}+${v}`)
          .join(" ");
        const setName = eq.setId ? equipmentSets.find((s) => s.id === eq.setId)?.name : null;
        const infoStr = [statStr, setName].filter(Boolean).join(" | ");
        return { value: eq.id, label: `${eq.name}${infoStr ? " (" + infoStr + ")" : ""}` };
      }),
      value: slot.equipment[es.key],
      emptyLabel: "-- 空 --",
      placeholder: "搜索装备...",
      onChange: (val) => { slot.equipment[es.key] = val; render(); },
    });
  }

  // 食物选择
  const foodContainer = el.querySelector("#ss-food");
  if (foodContainer) {
    const foods = externalBuffCatalog.filter((b) => b.group === "食物");
    createSearchableSelect(foodContainer, {
      options: foods.map((f) => ({ value: f.id, label: `${f.name} (${f.description})` })),
      value: slot.foodId,
      emptyLabel: "-- 无 --",
      placeholder: "搜索食物...",
      onChange: (val) => { slot.foodId = val; render(); },
    });
  }
}

// ===== 潜能按钮事件绑定 =====

function bindSlotPotentialEvents(el, slotIndex) {
  const slot = state.slots[slotIndex];

  el.querySelectorAll('.pot-btn[data-type="charPot"]').forEach((btn) => {
    btn.onclick = () => { slot.charPotLevel = parseInt(btn.dataset.level, 10); render(); };
  });

  el.querySelectorAll('.pot-btn[data-type="weaponPot"]').forEach((btn) => {
    btn.onclick = () => { slot.weaponPotLevel = parseInt(btn.dataset.level, 10); render(); };
  });
}

// ===== 渲染：结果 =====

function renderResult() {
  const el = document.getElementById("team-result");
  if (!el) return;

  let html = "";
  let teamTotal = 0;
  const slotResults = [];

  for (let i = 0; i < 4; i++) {
    const char = getSlotChar(i);
    const charName = char ? char.name : `槽位${i + 1}`;
    const { rowResults, totalDamage } = calculateSlotDamage(i);
    teamTotal += totalDamage;
    slotResults.push({ charName: char ? char.name : null, totalDamage, rowResults });

    html += `<div class="slot-result${i === state.activeSlotIndex ? " active-slot-result" : ""}">`;
    html += `<div class="slot-result-header">`;
    html += `<span class="slot-result-name">${charName}</span>`;
    html += `<span class="slot-result-total">${totalDamage.toFixed(0)}</span>`;
    html += `</div>`;

    if (rowResults.length > 0) {
      html += '<div class="slot-result-rows">';
      for (let r = 0; r < rowResults.length; r++) {
        const rr = rowResults[r];
        if (!rr.skill) {
          html += `<div class="row-result empty-row">行${r + 1}: --</div>`;
          continue;
        }
        const typeLabel = skillTypeLabels[rr.skill.type] || rr.skill.type;
        html += `<div class="row-result">`;
        html += `<span class="row-skill-tag ${rr.skill.type}">${typeLabel}</span>`;
        html += `<span class="row-skill-name">${rr.skill.name}</span>`;
        if (rr.count > 1) {
          html += `<span class="row-count">\u00d7${rr.count}</span>`;
        }

        // 各段伤害（期望伤害）
        html += '<span class="row-hits">';
        for (const hit of rr.hits) {
          const elemInfo = elementMap[hit.element] || { label: hit.element, color: "#aaa" };
          const dmgText = hit.expectedDamage.toFixed(0);
          const critTip = hit.crit.critRate > 0
            ? ` title="暴击率:${(hit.crit.critRate * 100).toFixed(1)}% 爆伤:${(hit.crit.critDamage * 100).toFixed(1)}% 非暴击:${hit.finalDamage.toFixed(0)}"`
            : "";
          html += `<span class="row-hit" style="color:${elemInfo.color}"${critTip}>${dmgText}</span>`;
        }
        html += "</span>";

        html += `<span class="row-damage">${rr.rowDamage.toFixed(0)}</span>`;
        html += `</div>`;
      }
      html += "</div>";
    }

    html += "</div>";
  }

  html += `<div class="team-total">全队总伤害: ${teamTotal.toFixed(0)}</div>`;
  el.innerHTML = html;

  renderAnalysis(slotResults);
}

// ===== 主渲染 =====

function render() {
  updateGridBuffIds();
  renderSlotTabs();
  renderSlotConfig();
  renderGrid(state.activeSlotIndex);
  renderPalette(state.activeSlotIndex);
  renderResult();
}

/**
 * 潜能变化时，自动更新格子中的旧 buff ID 为新版本。
 * 构建全局替换映射（所有 slot 的角色），然后扫描每个 slot 的 grid。
 */
function updateGridBuffIds() {
  // 构建全局替换映射（所有角色的已解锁 buff）
  const globalReplaceMap = new Map();  // 旧 ID → 新 ID
  const globalReverseMap = new Map();  // 新 ID → 旧 ID
  const globalUnlockedIds = new Set();

  for (let s = 0; s < 4; s++) {
    const char = getSlotChar(s);
    if (!char) continue;
    const slot = state.slots[s];
    const allUnlocked = collectCharBuffs(char, slot.charPotLevel, () => true);
    for (const b of allUnlocked) {
      globalUnlockedIds.add(b.id);
      if (b.replaces) {
        const ids = Array.isArray(b.replaces) ? b.replaces : [b.replaces];
        for (const oldId of ids) {
          globalReplaceMap.set(oldId, b.id);
          globalReverseMap.set(b.id, oldId);
        }
      }
    }
    // 全部潜能（不限等级）用于降级回退
    const allPotBuffs = collectCharBuffs(char, char.potentialBuffs?.length || 0, () => true);
    for (const b of allPotBuffs) {
      if (b.replaces) {
        const ids = Array.isArray(b.replaces) ? b.replaces : [b.replaces];
        for (const oldId of ids) globalReverseMap.set(b.id, oldId);
      }
    }
  }

  // 扫描每个 slot 的 grid
  for (let s = 0; s < 4; s++) {
    const grid = state.grids[s];
    if (!grid) continue;
    for (const row of grid) {
      for (let c = 0; c < row.buffCells.length; c++) {
        const cell = row.buffCells[c];
        if (cell == null) continue;
        const cellObj = typeof cell === "object" ? cell : { id: cell };
        const cellId = cellObj.id;

        // 处理通用 buff 格式：gb:buffId:sourceSlot
        if (typeof cellId === "string" && cellId.startsWith("gb:")) {
          const parts = cellId.split(":");
          const buffId = parts[1];
          const sourceSlot = parts[2];
          const newBuffId = globalReplaceMap.get(buffId);
          if (newBuffId) {
            row.buffCells[c] = { ...cellObj, id: `gb:${newBuffId}:${sourceSlot}` };
            continue;
          }
          if (!globalUnlockedIds.has(buffId) && globalReverseMap.has(buffId)) {
            const oldBuffId = globalReverseMap.get(buffId);
            if (globalUnlockedIds.has(oldBuffId)) {
              row.buffCells[c] = { ...cellObj, id: `gb:${oldBuffId}:${sourceSlot}` };
            }
          }
          continue;
        }

        // 处理普通 buff ID
        const newId = globalReplaceMap.get(cellId);
        if (newId) {
          row.buffCells[c] = { ...cellObj, id: newId };
          continue;
        }
        if (!globalUnlockedIds.has(cellId) && globalReverseMap.has(cellId)) {
          const oldId = globalReverseMap.get(cellId);
          if (globalUnlockedIds.has(oldId)) {
            row.buffCells[c] = { ...cellObj, id: oldId };
          }
        }
      }
    }
  }
}

// ===== 初始化 =====

document.addEventListener("DOMContentLoaded", async () => {
  await loadAllData();

  // 初始化每个槽位的 grid（4 行空行）
  for (let i = 0; i < 4; i++) {
    state.grids[i] = Array.from({ length: 4 }, () => ({
      skillIndex: null,
      count: 1,
      buffCells: [null, null, null],
    }));
  }

  render();
  initGridEvents();
  initPaletteEvents();

  // 导出/导入
  initSaveLoad({
    containerId: "save-load-bar",
    exportFn: () => ({
      version: 1,
      slots: state.slots,
      grids: state.grids,
      activeSlotIndex: state.activeSlotIndex,
    }),
    importFn: (data) => {
      const defaultSlot = () => ({
        charId: null, weaponId: null, weaponPotLevel: 0, charPotLevel: 0,
        equipment: { armor: null, gloves: null, kit1: null, kit2: null },
        foodId: null, genericBuffs: [], addedGenericSkillIds: [], userInputValues: {},
      });
      if (data.slots) {
        for (let i = 0; i < 4; i++) {
          state.slots[i] = Object.assign(defaultSlot(), data.slots[i] || {});
        }
      }
      if (data.grids) {
        // 兼容旧格式：buffCells 元素可能是纯字符串
        state.grids = data.grids.map(grid =>
          grid.map(row => ({
            ...row,
            buffCells: (row.buffCells || []).map(cell =>
              cell == null || typeof cell === "object" ? cell : { id: cell }
            ),
          }))
        );
      }
      if (data.activeSlotIndex != null) state.activeSlotIndex = data.activeSlotIndex;
      state.paletteSelection = null;
      render();
    },
  });

  // 折叠/展开配置面板
  document.getElementById("slot-config-toggle")?.addEventListener("click", () => {
    const cfg = document.getElementById("slot-config");
    const btn = document.getElementById("slot-config-toggle");
    cfg.classList.toggle("collapsed");
    btn.textContent = cfg.classList.contains("collapsed") ? "展开" : "折叠";
  });
});

// ===== 导出 =====
export {
  render,
  renderResult,
  getSlotChar,
  getSlotStatTotals,
  getSlotPermanentBuffs,
  getAvailableBuffsForPalette,
  collectRowBuffs,
  calculateSlotDamage,
  findBuffById,
};
