/**
 * 属性系统
 *
 * 四属性：力量、敏捷、智识、意志
 * 主属性和副属性按不同比例提供攻击力加成%
 *
 * 总攻击力公式：
 *   totalAtk = ((baseAtk + weaponAtk) × (1 + Σ atkPercent) + Σ flatAtk) × (1 + statAtkBonus)
 *   statAtkBonus = 主属性 × 主比例 + Σ(副属性 × 副比例)
 */

import { matchesCondition, resolveEffectValue } from "./engine.js";
import { EQUIP_SLOT_KEYS } from "./equipment.js";

export const statDefs = [
  { key: "strength", label: "力量" },
  { key: "agility", label: "敏捷" },
  { key: "intellect", label: "智识" },
  { key: "will", label: "意志" },
  { key: "artsIntensity", label: "源石技艺强度" },
];

/**
 * 计算总攻击力
 * @param {Object} config
 *   - baseAtk: number
 *   - weaponAtk: number
 *   - statConfig: { primary: { stat, ratio }, secondary: [{ stat, ratio }] }
 *   - statTotals: { strength, agility, intellect, will }
 * @param {Array} activeBuffs - 所有生效的 buff
 * @param {Object} context - { skillType, element }
 * @returns {{ totalAtk: number, breakdown: Object }}
 */
export function calculateAtk(config, activeBuffs, context) {
  const { baseAtk, weaponAtk, statConfig, statTotals } = config;

  // 1. 收集攻击力% buff
  const atkPercentSources = [];
  let atkPercentTotal = 0;
  for (const buff of activeBuffs) {
    if (!buff.effects) continue;
    for (const effect of buff.effects) {
      if (effect.category !== "atkPercent") continue;
      if (!matchesCondition(effect.condition, context)) continue;
      const v = resolveEffectValue(effect, statTotals);
      atkPercentSources.push({ buffName: buff.name, value: v });
      atkPercentTotal += v;
    }
  }

  // 2. 收集固定攻击力 buff
  const flatAtkSources = [];
  let flatAtkTotal = 0;
  for (const buff of activeBuffs) {
    if (!buff.effects) continue;
    for (const effect of buff.effects) {
      if (effect.category !== "flatAtk") continue;
      if (!matchesCondition(effect.condition, context)) continue;
      const v = resolveEffectValue(effect, statTotals);
      flatAtkSources.push({ buffName: buff.name, value: v });
      flatAtkTotal += v;
    }
  }

  // 3. 计算属性攻击力加成
  const primaryStat = statConfig.primary;
  const primaryValue = statTotals[primaryStat.stat] || 0;
  const primaryContrib = primaryValue * primaryStat.ratio;

  const secondaryContribs = statConfig.secondary.map((sec) => ({
    stat: sec.stat,
    value: statTotals[sec.stat] || 0,
    ratio: sec.ratio,
    contrib: (statTotals[sec.stat] || 0) * sec.ratio,
  }));

  let extraStatAtkTotal = 0;
  for (const buff of activeBuffs) {
    if (!buff.effects) continue;
    for (const effect of buff.effects) {
      if (effect.category !== "extraStatAtk") continue;
      if (!matchesCondition(effect.condition, context)) continue;
      const v = resolveEffectValue(effect, statTotals);
      extraStatAtkTotal += v;
    }
  }

  const secondaryTotal = secondaryContribs.reduce((sum, s) => sum + s.contrib, 0);
  const statAtkBonus = primaryContrib + secondaryTotal + extraStatAtkTotal;

  // 4. 总攻击力公式
  const rawAtk = baseAtk + weaponAtk;
  const afterPercent = rawAtk * (1 + atkPercentTotal) + flatAtkTotal;
  const totalAtk = afterPercent * (1 + statAtkBonus);

  return {
    totalAtk,
    breakdown: {
      baseAtk,
      weaponAtk,
      rawAtk,
      atkPercentSources,
      atkPercentTotal,
      flatAtkSources,
      flatAtkTotal,
      afterPercent,
      statAtkBonus,
      primaryContrib,
      primaryStat: primaryStat.stat,
      primaryValue,
      primaryRatio: primaryStat.ratio,
      secondaryContribs,
      secondaryTotal,
    },
  };
}

/**
 * 计算属性总值（基础 + 装备加成 + 武器加成 + 词条固定值）
 *
 * 词条映射规则：mainAffix → statConfig.primary 对应属性，
 *              subAffixes[i] → statConfig.secondary[i] 对应属性
 *
 * 百分比词条不在此函数内乘算，而是通过 pendingPercent 返回，
 * 由调用方在所有固定值（含 buff statBonuses）累加完后统一应用。
 *
 * @returns {{ totals: Object, pendingPercent: Object }}
 */
export function calculateStatTotals(baseStats, equippedItems, equipmentList, weapon, statConfig) {
  const totals = { ...baseStats };
  const pendingPercent = {};
  const primaryStat = statConfig?.primary?.stat;
  const secondaryStats = statConfig?.secondary || [];

  // 辅助：收集一个对象的词条（固定值直接加，百分比存入 pendingPercent）
  function applyAffixes(obj) {
    if (obj.mainAffix && primaryStat) {
      if (obj.mainAffix.flat) totals[primaryStat] = (totals[primaryStat] || 0) + obj.mainAffix.flat;
      if (obj.mainAffix.percent) pendingPercent[primaryStat] = (pendingPercent[primaryStat] || 0) + obj.mainAffix.percent;
    }
    if (obj.subAffixes) {
      obj.subAffixes.forEach((affix, i) => {
        const sec = secondaryStats[i];
        if (!sec) return;
        if (affix.flat) totals[sec.stat] = (totals[sec.stat] || 0) + affix.flat;
        if (affix.percent) pendingPercent[sec.stat] = (pendingPercent[sec.stat] || 0) + affix.percent;
      });
    }
  }

  // 装备 statBonuses + 词条
  for (const slotKey of EQUIP_SLOT_KEYS) {
    const eqId = equippedItems[slotKey];
    if (!eqId) continue;
    const eq = equipmentList.find((e) => e.id === eqId);
    if (!eq) continue;
    if (eq.statBonuses) {
      for (const [stat, val] of Object.entries(eq.statBonuses)) {
        totals[stat] = (totals[stat] || 0) + val;
      }
    }
    applyAffixes(eq);
  }

  // 武器固定属性 + 词条
  if (weapon) {
    if (weapon.statBonuses) {
      for (const [stat, val] of Object.entries(weapon.statBonuses)) {
        totals[stat] = (totals[stat] || 0) + val;
      }
    }
    applyAffixes(weapon);
  }

  return { totals, pendingPercent };
}

/**
 * 将待定的百分比加成应用到属性总值
 * @param {Object} totals        - 属性总值（会被就地修改）
 * @param {Object} pendingPercent - { stat: percentSum }
 */
export function applyPercentBonuses(totals, pendingPercent) {
  for (const [stat, pct] of Object.entries(pendingPercent)) {
    totals[stat] = (totals[stat] || 0) * (1 + pct);
  }
}

/**
 * 将 buff 数组中的 statBonuses / mainAffix / subAffixes / allAffixes 应用到属性总值
 * 用于网格放置的 buff（通用 buff 等）按行追加属性
 *
 * NOTE: 当前网格 buff 的 statBonuses 不受词条百分比放大（在百分比之后追加）。
 * 如果将来游戏中出现需要被百分比放大的临时 buff，需要将 pendingPercent
 * 传入此函数，在固定值累加后统一乘算。
 *
 * @param {Object} baseTotals - 基础属性总值（会被复制，不会修改原对象）
 * @param {Array}  buffs      - buff 数组
 * @param {Object} [statConfig] - 角色 statConfig { primary, secondary }
 * @param {Object} [extraPercent] - 额外待定百分比（来自装备/武器词条）
 * @returns {Object} 新的属性总值
 */
export function applyBuffStatBonuses(baseTotals, buffs, statConfig, extraPercent) {
  const totals = { ...baseTotals };
  const percentBonuses = { ...extraPercent };
  const primaryStat = statConfig?.primary?.stat;
  const secondaryStats = statConfig?.secondary || [];

  for (const buff of buffs) {
    if (buff.statBonuses) {
      for (const [stat, val] of Object.entries(buff.statBonuses)) {
        totals[stat] = (totals[stat] || 0) + val;
      }
    }
    if (buff.mainAffix && primaryStat) {
      if (buff.mainAffix.flat) totals[primaryStat] = (totals[primaryStat] || 0) + buff.mainAffix.flat;
      if (buff.mainAffix.percent) percentBonuses[primaryStat] = (percentBonuses[primaryStat] || 0) + buff.mainAffix.percent;
    }
    if (buff.subAffixes) {
      buff.subAffixes.forEach((affix, i) => {
        const sec = secondaryStats[i];
        if (!sec) return;
        if (affix.flat) totals[sec.stat] = (totals[sec.stat] || 0) + affix.flat;
        if (affix.percent) percentBonuses[sec.stat] = (percentBonuses[sec.stat] || 0) + affix.percent;
      });
    }
    if (buff.allAffix) {
      const allStats = ["strength", "agility", "intellect", "will"];
      if (buff.allAffix.flat) {
        for (const stat of allStats) {
          totals[stat] = (totals[stat] || 0) + buff.allAffix.flat;
        }
      }
      if (buff.allAffix.percent) {
        for (const stat of allStats) {
          percentBonuses[stat] = (percentBonuses[stat] || 0) + buff.allAffix.percent;
        }
      }
    }
  }

  // 所有固定值累加完后统一乘算百分比
  applyPercentBonuses(totals, percentBonuses);

  return totals;
}
