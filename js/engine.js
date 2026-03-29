/**
 * 伤害计算引擎
 *
 * 常规技能计算流程：
 *   阶段1: 总攻击力 = ((基础攻击+武器攻击) × (1+攻击力%) + 固定攻击力) × (1+属性加成%)
 *   阶段2: 技能伤害 = 倍率 × 总攻击力 × ∏(1 + 各伤害乘区)
 *
 * 异常技能（status）独立计算：
 *   异常伤害 = statusBase × f(源石技艺强度) × ∏(1 + 各伤害乘区)
 *   阶段2: 技能伤害 = 倍率 × 总攻击力 × ∏(1 + 各伤害乘区)
 *
 * atkPercent/flatAtk 类 effect 不在 damageCategories 中，
 * calculate() 的 if(cat) 守卫会自动跳过它们。
 */

import { calculateAtk } from "./stats.js";

/**
 * 分段线性插值
 * @param {number} x     - 输入值
 * @param {Array}  curve - 分段点 [[x0,y0], [x1,y1], ...]，按 x 升序排列
 * @returns {number} 插值结果（超出范围则取端点值）
 */
export function piecewiseLinear(x, curve) {
  if (curve.length === 0) return 0;
  if (x <= curve[0][0]) return curve[0][1];
  if (x >= curve[curve.length - 1][0]) return curve[curve.length - 1][1];

  for (let i = 1; i < curve.length; i++) {
    if (x <= curve[i][0]) {
      const [x0, y0] = curve[i - 1];
      const [x1, y1] = curve[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return curve[curve.length - 1][1];
}

/**
 * 源石技艺强度 → 异常伤害倍率 分段线性曲线
 *
 * 格式: [[强度值, 倍率], ...]
 * 修改此数组即可调整曲线，引擎自动插值。
 * 实际上是线性的，分段线性曲线是我之前理解有错误
 * 示例: 强度0→倍率0, 强度100→倍率0.5, 强度200→倍率0.8, 强度300→倍率1.0
 */
export const ARTS_INTENSITY_CURVE = [
  [0, 1],
  [500, 6],
];

/**
 * 解析 effect 的实际值（处理 scaleStat 缩放）
 *
 * 四种模式：
 *   1. 固定值:       { value: 0.2 }
 *   2. 线性缩放:     { scaleStat, scaleRatio, scaleCap? }
 *   3. 分段线性曲线:  { scaleStat, scaleCurve: [[x,y], ...] }
 *   4. 饱和缩放:     { value, saturationScale: { stat, x, y, z } }
 *      公式: value × (x + (y × stat) / (z + stat))
 */
export function resolveEffectValue(effect, statTotals) {
  if (effect.saturationScale) {
    const { stat, x, y, z } = effect.saturationScale;
    const statVal = effect.scaleValue ?? (statTotals?.[stat] || 0);
    return (effect.value || 0) * (x + (y * statVal) / (z + statVal));
  }
  if (effect.scaleStat || effect.scaleValue != null) {
    const statVal = effect.scaleValue ?? (statTotals?.[effect.scaleStat] || 0);
    if (effect.scaleCurve) {
      if (effect.scaleRatio) {
        return piecewiseLinear(statVal, effect.scaleCurve) * effect.scaleRatio;
      }
      return piecewiseLinear(statVal, effect.scaleCurve);
    }
    const raw = statVal * effect.scaleRatio;
    return effect.scaleCap != null ? Math.min(raw, effect.scaleCap) : raw;
  }
  return effect.value;
}

/**
 * 检查 condition 是否匹配当前上下文
 */
export function matchesCondition(condition, context) {
  if (!condition) return true;

  if (condition.skillType) {
    const types = Array.isArray(condition.skillType)
      ? condition.skillType
      : [condition.skillType];
    if (!types.includes(context.skillType)) return false;
  }

  if (condition.element) {
    const elems = Array.isArray(condition.element)
      ? condition.element
      : [condition.element];
    if (!elems.includes(context.element)) return false;
  }

  return true;
}

/**
 * 计算单段伤害（阶段2: 伤害乘区计算）
 * @param {number} baseDamage   - 该段有效基础伤害 (= multiplier × totalAtk)
 * @param {Array}  activeBuffs  - 所有激活的 buff
 * @param {Array}  categoryDefs - 伤害乘区定义 [{ key, label }]
 * @param {Object} context      - { skillType, element, statTotals? }
 */
export function calculate(baseDamage, activeBuffs, categoryDefs, context) {
  const breakdown = {};
  for (const cat of categoryDefs) {
    breakdown[cat.key] = {
      label: cat.label,
      contributions: [],
      rawTotal: 0,
      metas: [],
      finalTotal: 0,
      multiplier: 1,
    };
  }

  for (const buff of activeBuffs) {
    if (buff.effects) {
      for (const effect of buff.effects) {
        if (!matchesCondition(effect.condition, context)) continue;
        const cat = breakdown[effect.category];
        if (cat) {
          const v = resolveEffectValue(effect, context.statTotals);
          cat.contributions.push({ buffName: buff.name, value: v });
          cat.rawTotal += v;
        }
      }
    }
  }

  for (const buff of activeBuffs) {
    if (buff.metas) {
      for (const meta of buff.metas) {
        if (!matchesCondition(meta.condition, context)) continue;
        const cat = breakdown[meta.category];
        if (cat) {
          cat.metas.push({ buffName: buff.name, multiplier: meta.multiplier });
        }
      }
    }
  }

  for (const cat of categoryDefs) {
    const b = breakdown[cat.key];
    b.finalTotal = b.rawTotal;
    for (const meta of b.metas) {
      b.finalTotal *= meta.multiplier;
    }
    b.multiplier = 1 + b.finalTotal;
  }

  let finalDamage = baseDamage;
  for (const cat of categoryDefs) {
    finalDamage *= breakdown[cat.key].multiplier;
  }

  return { finalDamage, breakdown };
}

/**
 * 处理 buff 替换：当某个 buff 含有 replaces 字段时，
 * 从列表中移除被替换的旧 buff（升级取代）。
 * @param {Array} buffs - 全部 buff 列表
 * @param {Array} buffs        - 全部 buff 列表
 * @param {Array} contextBuffs  - 额外的上下文 buff（仅用于检测 replaces，不会出现在输出中）
 * @returns {Array} 处理替换后的 buff 列表
 */
export function applyBuffReplacements(buffs, contextBuffs = []) {
  const replacedIds = new Set();
  for (const b of [...buffs, ...contextBuffs]) {
    if (b.replaces) {
      const ids = Array.isArray(b.replaces) ? b.replaces : [b.replaces];
      for (const id of ids) replacedIds.add(id);
    }
  }
  if (replacedIds.size === 0) return buffs;
  return buffs.filter((b) => !replacedIds.has(b.id));
}

/**
 * 应用技能倍率覆盖：扫描 buff 中的 skillOverrides 字段，
 * 返回修改后的技能副本（不改原数组）。
 *
 * skillOverrides 条目格式：
 *   { skillIndex, hitIndex?, multiplier?, element?, addHit? }  // 数字索引（角色技能）
 *   { skillId, hitIndex?, multiplier?, element?, addHit? }     // 字符串ID（通用技能）
 *
 * @param {Array} skills      - 角色原始技能列表
 * @param {Array} activeBuffs - 所有生效的 buff（含潜能 buff）
 * @returns {Array} 可能被修改过的技能列表（浅拷贝）
 */
export function applySkillOverrides(skills, activeBuffs) {
  const overrides = [];
  for (const buff of activeBuffs) {
    if (buff.skillOverrides) overrides.push(...buff.skillOverrides);
  }
  if (overrides.length === 0) return skills;

  return skills.map((skill, si) => {
    const relevant = overrides.filter((o) => o.skillIndex === si);
    if (relevant.length === 0) return skill;

    const newHits = skill.hits.map((h) => ({ ...h }));
    for (const o of relevant) {
      if (o.hitIndex != null && newHits[o.hitIndex]) {
        if (o.multiplier != null) newHits[o.hitIndex].multiplier = o.multiplier;
        if (o.element != null) newHits[o.hitIndex].element = o.element;
      }
      if (o.addHit) {
        newHits.push({ ...o.addHit });
      }
    }
    return { ...skill, hits: newHits };
  });
}

/**
 * 应用通用技能倍率覆盖（支持字符串 ID）
 * @param {Object} skill      - 通用技能对象
 * @param {Array}  activeBuffs - 所有生效的 buff
 * @returns {Object} 可能被修改过的技能副本
 */
export function applyGenericSkillOverrides(skill, activeBuffs) {
  const overrides = [];
  for (const buff of activeBuffs) {
    if (buff.skillOverrides) {
      overrides.push(...buff.skillOverrides.filter((o) => o.skillId === skill.id));
    }
  }
  if (overrides.length === 0) return skill;

  const newHits = skill.hits.map((h) => ({ ...h }));
  for (const o of overrides) {
    if (o.hitIndex != null && newHits[o.hitIndex]) {
      if (o.multiplier != null) newHits[o.hitIndex].multiplier = o.multiplier;
      if (o.element != null) newHits[o.hitIndex].element = o.element;
    }
    if (o.addHit) {
      newHits.push({ ...o.addHit });
    }
  }
  return { ...skill, hits: newHits };
}

/**
 * 收集暴击率和暴击伤害，返回期望伤害倍率
 *
 * buff 格式：
 *   { "category": "critRate",   "value": 0.05 }
 *   { "category": "critDamage", "value": 0.5  }
 *
 * @param {Array}  activeBuffs    - 所有激活的 buff
 * @param {Object} context        - { skillType, element, statTotals }
 * @param {number} baseCritRate   - 角色基础暴击率（默认0）
 * @param {number} baseCritDamage - 角色基础暴击伤害（默认0）
 * @returns {{ critRate, critDamage, expectedMultiplier }}
 */
export function collectCrit(activeBuffs, context, baseCritRate = 0, baseCritDamage = 0) {
  let critRate = baseCritRate;
  let critDamage = baseCritDamage;

  for (const buff of activeBuffs) {
    if (!buff.effects) continue;
    for (const effect of buff.effects) {
      if (!matchesCondition(effect.condition, context)) continue;
      const v = resolveEffectValue(effect, context.statTotals);
      if (effect.category === "critRate") critRate += v;
      else if (effect.category === "critDamage") critDamage += v;
    }
  }

  critRate = Math.min(Math.max(critRate, 0), 1);
  const expectedMultiplier = 1 + critRate * critDamage;

  return { critRate, critDamage, expectedMultiplier };
}

/**
 * 计算角色所有技能的伤害（含攻击力计算）
 * @param {Array}  skills       - 角色技能列表
 * @param {Array}  activeBuffs  - 所有激活的 buff
 * @param {Array}  categoryDefs - 伤害乘区定义
 * @param {Object} atkConfig    - 攻击力配置 { baseAtk, weaponAtk, statConfig, statTotals }
 */
export function calculateAllWithAtk(skills, activeBuffs, categoryDefs, atkConfig) {
  return skills.map((skill) => {
    const hits = skill.hits.map((hit) => {
      const context = { skillType: skill.type, element: hit.element, statTotals: atkConfig.statTotals };

      // 阶段1: 攻击力
      const atkResult = calculateAtk(atkConfig, activeBuffs, context);
      const effectiveBase = hit.multiplier * atkResult.totalAtk;

      // 阶段2: 伤害乘区
      const { finalDamage, breakdown } = calculate(
        effectiveBase, activeBuffs, categoryDefs, context
      );

      return {
        element: hit.element,
        multiplier: hit.multiplier,
        totalAtk: atkResult.totalAtk,
        atkBreakdown: atkResult.breakdown,
        effectiveBase,
        finalDamage: finalDamage * 0.5, // 怪物默认50%防御
        breakdown,
      };
    });

    const totalDamage = hits.reduce((sum, h) => sum + h.finalDamage, 0);
    return { skill, hits, totalDamage };
  });
}
