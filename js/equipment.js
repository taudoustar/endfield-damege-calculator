/**
 * 装备系统
 *
 * 数据从 data/equipment.json 和 data/equipment-sets.json 加载，
 * 由 data-loader.js 注入。
 *
 * 装备栏位: armor(护甲), gloves(护手), kit(配件×2)
 * 装备可提供:
 *   - statBonuses: 属性点数加成
 *   - buffs: 标准 buff 效果（可设置 optional: true）
 *   - setId: 所属套装（可选）
 *
 * 套装 buff 也可设置 optional: true
 *
 * 套装系统:
 *   装备 3 件同套装装备时，激活套装 buff
 */

export const slotLabels = {
  armor: "护甲",
  gloves: "护手",
  kit: "配件",
};

export const EQUIP_SLOT_KEYS = ["armor", "gloves", "kit1", "kit2"];

export let equipment = [];
export let equipmentSets = [];

export function setEquipment(data) {
  equipment = data;
}

export function setEquipmentSets(data) {
  equipmentSets = data;
}

/**
 * 计算已装备各套装的件数
 * @param {Object} equippedItems - { armor, gloves, kit1, kit2 }
 * @returns {Object} setId → count
 */
export function countSets(equippedItems) {
  const setCount = {};
  for (const slotKey of EQUIP_SLOT_KEYS) {
    const eqId = equippedItems[slotKey];
    if (!eqId) continue;
    const eq = equipment.find((e) => e.id === eqId);
    if (eq && eq.setId) setCount[eq.setId] = (setCount[eq.setId] || 0) + 1;
  }
  return setCount;
}

/**
 * 收集装备和套装 buff，按 filter 过滤
 * @param {Object} equippedItems - { armor, gloves, kit1, kit2 }
 * @param {Function} filter - (buff) => boolean，决定是否收集
 * @returns {Array} buff 数组
 */
export function collectEquipBuffs(equippedItems, filter) {
  const buffs = [];
  const setCount = countSets(equippedItems);

  // 装备 buff
  for (const slotKey of EQUIP_SLOT_KEYS) {
    const eqId = equippedItems[slotKey];
    if (!eqId) continue;
    const eq = equipment.find((e) => e.id === eqId);
    if (eq && eq.buffs) {
      for (const b of eq.buffs) {
        if (filter(b)) buffs.push(b);
      }
    }
  }

  // 套装 buff
  for (const set of equipmentSets) {
    if ((setCount[set.id] || 0) >= set.requiredCount) {
      for (const b of set.buffs) {
        if (filter(b)) buffs.push(b);
      }
    }
  }

  return buffs;
}
