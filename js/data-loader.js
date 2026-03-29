/**
 * 数据加载模块
 *
 * 从 data/ 目录的 JSON 文件中加载所有游戏数据，
 * 通过各数据模块的 setter 函数注入数据。
 *
 * 调用方式：在 app 入口 DOMContentLoaded 中 await loadAllData()
 */

import { setCharacters } from "./characters.js";
import { setWeapons } from "./weapons.js";
import { setEquipment, setEquipmentSets } from "./equipment.js";
import { setCommonBuffs } from "./buffs.js";
import { setExternalBuffCatalog } from "./externalbuffs.js";
import { setGenericSkills } from "./generic-skills.js";

async function fetchJSON(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`Failed to load ${path}: ${resp.status}`);
  return resp.json();
}

export async function loadAllData() {
  // 1. 加载角色索引，然后并行加载各角色文件
  const charIndex = await fetchJSON("data/characters/index.json");
  const charPromises = charIndex.map((file) =>
    fetchJSON(`data/characters/${file}`)
  );

  // 2. 并行加载其余数据文件 + 角色文件
  const [characters, weaponsData, equipmentData, setsData, buffsData, extBuffsData, genericSkillsData] =
    await Promise.all([
      Promise.all(charPromises),
      fetchJSON("data/weapons.json"),
      fetchJSON("data/equipment.json"),
      fetchJSON("data/equipment-sets.json"),
      fetchJSON("data/buffs.json"),
      fetchJSON("data/external-buffs.json"),
      fetchJSON("data/generic-skills.json"),
    ]);

  // 3. 注入到各数据模块
  setCharacters(characters);
  setWeapons(weaponsData);
  setEquipment(equipmentData);
  setEquipmentSets(setsData);
  setCommonBuffs(buffsData);
  setExternalBuffCatalog(extBuffsData);
  setGenericSkills(genericSkillsData);
}
