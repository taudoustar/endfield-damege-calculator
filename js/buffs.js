/**
 * 通用 Buff 定义
 *
 * 数据从 data/buffs.json 加载，由 data-loader.js 注入。
 *
 * 结构：
 * {
 *   id, name, description,
 *   optional?: boolean,           // true = 需要手动勾选, 默认 false = 永久生效
 *   effects?: [{ category, value, condition? }],
 *   metas?: [{ category, multiplier, condition? }]
 * }
 *
 * category 可以是：
 *   - 伤害乘区: "DMG_Dealt", "DMG_Taken" 等（参见 categories.js）
 *   - 攻击力: "atkPercent"（攻击力%）, "flatAtk"（固定攻击力）
 */
export let commonBuffs = [];

export function setCommonBuffs(data) {
  commonBuffs = data;
}
