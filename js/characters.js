/**
 * 角色定义
 *
 * 数据从 data/characters/*.json 加载，由 data-loader.js 注入。
 *
 * 结构：
 * {
 *   id: string,
 *   name: string,
 *   baseAtk: number,                    // 基础攻击力
 *   baseStats: { strength, agility, intellect, will },  // 基础属性
 *   statConfig: {
 *     primary: { stat, ratio },          // 主属性及攻击力转化比例
 *     secondary: [{ stat, ratio }, ...]  // 副属性（1-3个）
 *   },
 *   weaponType: string,                  // 可装备的武器类型（唯一）
 *   skills: [{
 *     name, type,
 *     hits: [{ element, multiplier }]    // multiplier 为技能倍率（如 1.2 = 120%）
 *   }],
 *   uniqueBuffs: Buff[],                 // 固有 buff
 *   potentialBuffs: Buff[5]              // 潜能 buff，等级 N 时解锁前 N 个
 *
 * 每个 buff 可设置 optional: true 表示需要手动勾选生效，
 * 不设置则为永久生效。
 * }
 */
export let characters = [];

export function setCharacters(data) {
  characters = data;
}
