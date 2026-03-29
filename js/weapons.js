/**
 * 武器系统
 *
 * 数据从 data/weapons.json 加载，由 data-loader.js 注入。
 *
 * 武器类型：单手剑、双手剑、施术单元、手铳、长柄武器
 * 每个武器提供基础攻击力和潜能等级缩放的 buff
 *
 * potentialBuffs 中 effect.value / meta.multiplier 为6元素数组 [lv0..lv5]
 * 使用 resolveWeaponBuffs(weapon, level) 转为标准标量 buff
 */

export const weaponTypeLabels = {
  Sword: "单手剑",
  Greatsword: "双手剑",
  Arts_Unit: "施术单元",
  Handcannon: "手铳",
  Polearm: "长柄武器",
};

export let weapons = [];

export function setWeapons(data) {
  weapons = data;
}

/**
 * 将武器的潜能 buff 按指定等级解析为标准标量 buff
 * @param {Object} weapon - 武器对象
 * @param {number} level  - 潜能等级 0-5
 * @returns {Array} 标准 buff 对象数组
 */
export function resolveWeaponBuffs(weapon, level) {
  if (!weapon.potentialBuffs) return [];
  const clampedLevel = Math.max(0, Math.min(5, level));

  const r = (v) => (Array.isArray(v) ? v[clampedLevel] : v);

  return weapon.potentialBuffs.map((pb) => ({
    id: pb.id,
    name: pb.name,
    description: pb.description,
    optional: pb.optional || false,
    scope: pb.scope,
    replaces: pb.replaces,
    userInput: pb.userInput,
    statBonuses: pb.statBonuses
      ? Object.fromEntries(Object.entries(pb.statBonuses).map(([k, v]) => [k, r(v)]))
      : undefined,
    mainAffix: pb.mainAffix
      ? { flat: r(pb.mainAffix.flat), percent: r(pb.mainAffix.percent) }
      : undefined,
    subAffixes: pb.subAffixes
      ? pb.subAffixes.map((a) => ({ flat: r(a.flat), percent: r(a.percent) }))
      : undefined,
    allAffix: pb.allAffix
      ? { flat: r(pb.allAffix.flat), percent: r(pb.allAffix.percent) }
      : undefined,
    effects: pb.effects
      ? pb.effects.map((e) => ({
          category: e.category,
          value: r(e.value),
          condition: e.condition,
          scaleStat: e.scaleStat,
          scaleRatio: r(e.scaleRatio),
          scaleCap: r(e.scaleCap),
          scaleCurve: e.scaleCurve,
          saturationScale: e.saturationScale,
          scaleValue: r(e.scaleValue),
          userInput: e.userInput,
        }))
      : undefined,
    metas: pb.metas
      ? pb.metas.map((m) => ({
          category: m.category,
          multiplier: r(m.multiplier),
          condition: m.condition,
          userInput: m.userInput,
        }))
      : undefined,
    skillOverrides: pb.skillOverrides
      ? pb.skillOverrides.map((o) => ({
          skillIndex: o.skillIndex,
          skillId: o.skillId,
          hitIndex: o.hitIndex,
          multiplier: r(o.multiplier),
          element: o.element,
          addHit: o.addHit
            ? { element: o.addHit.element, multiplier: r(o.addHit.multiplier) }
            : undefined,
        }))
      : undefined,
  }));
}
