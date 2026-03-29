/**
 * 通用技能
 *
 * 数据从 data/generic-skills.json 加载，由 data-loader.js 注入。
 * 通用技能可在编队计算器的战斗网格中使用，享受当前角色的攻击力和 buff 加成。
 */
export let genericSkills = [];

export function setGenericSkills(data) {
  genericSkills = data;
}
