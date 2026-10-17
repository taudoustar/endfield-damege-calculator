// Run with: node --test scripts/test-equipment.mjs scripts/test-si.mjs scripts/test-weapons.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, beforeEach } from "node:test";

globalThis.document = { addEventListener() {} };
globalThis.fetch = async (path) => ({
  ok: true,
  json: async () => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8")),
});
const { loadAllData } = await import("../js/data-loader.js");
const chars = await import("../js/characters.js");
const gear = await import("../js/equipment.js");
const app = await import("../js/team-app.js");
await loadAllData();
const catalog = gear.equipment.filter(e => e.id);
const wiki = JSON.parse(await readFile(new URL("fixtures/equipment-catalog.json", import.meta.url), "utf8"));
const elements = ["Physical", "Heat", "Cryo", "Electric", "Nature"];
const skillTypes = ["basic", "strike", "skill", "combo", "ultimate", "status"];
const skills = skillTypes.flatMap(type => elements.map(element => ({
  name: `${type}/${element}`, type, hits: [{ element, multiplier: 1 }],
})));
const attributes = ["strength", "agility", "intellect", "will"];
chars.setCharacters([...chars.characters, ...attributes.map((primary, i) => ({
  id: `GearTest_${primary}`, name: primary, weaponType: "Sword", baseAtk: 300,
  baseCritRate: 0.05, baseCritDamage: 0.5,
  baseStats: { strength: 100, agility: 100, intellect: 100, will: 100 },
  statConfig: { primary: { stat: primary, ratio: 0.005 }, secondary: [{ stat: attributes[(i + 1) % 4], ratio: 0.002 }] },
  uniqueBuffs: [], potentialBuffs: [], skills,
}))]);

// Independently transcribed +3 values from the linked Wiki detail pages.
// [name, attributes (main/sub are character-dependent), damage %, matching skill types/elements]
const specs = [
  ["50式应龙软甲", { intellect: 113, strength: 75 }, 26.9, ["combo"]],
  ["50式应龙手套", { intellect: 84, strength: 55 }, 44.9, ["combo"]],
  ["50式应龙信标", { intellect: 41, strength: 27 }, 53.8, ["combo"]],
  ["集成实训刃装护甲", { main: 96, sub: 63 }, 12.8, ["Physical"]],
  ["集成实训刃装护手", { main: 71, sub: 48 }, 21.3, ["Physical"]],
  ["集成实训刃装短锯", { main: 35, sub: 23 }, 25.6, ["Physical"]],
  ["脉冲式轻甲", { will: 113, strength: 75 }, 14.9, ["Cryo", "Electric"]],
  ["脉冲式轻护手", { will: 84, strength: 55 }, 24.9, ["Cryo", "Electric"]],
  ["脉冲式护甲板", { will: 41, strength: 27 }, 0, [], 32],
  ["长息改装护甲", { intellect: 113, strength: 75 }, 26.9, ["combo"]],
  ["长息防护服", { intellect: 113, strength: 75 }, 0, [], 16],
  ["长息导能护手", { intellect: 84, strength: 55 }, 44.9, ["combo"]],
  ["长息测距仪", { intellect: 41, strength: 27 }, 53.8, ["combo"]],
  ["涉渊钢甲", { agility: 149 }, 28.1, ["combo"]],
  ["涉渊防护服", { intellect: 149 }, 15.6, ["Heat", "Nature"]],
  ["涉渊裹手", { will: 111 }, 26, ["Cryo", "Electric"]],
  ["涉渊手甲", { strength: 111 }, 31.2, ["basic", "strike"]],
  ["涉渊白刃", { agility: 55 }, 0, [], 33.4],
];
const find = name => catalog.find(e => e.name.startsWith(`${name}·`));
const close = (actual, expected, context = "") => assert.ok(Math.abs(actual - expected) < 1e-8, `${context}: ${actual} != ${expected}`);
const { state } = app;
const defaultSlot = structuredClone(state.slots[0]);
const row = (skillIndex, buffCells = []) => ({ skillIndex, count: 1, buffCells });
const equip = name => {
  const item = find(name);
  state.slots[0].equipment[item.slot === "kit" ? "kit1" : item.slot] = item.id;
  return item;
};
beforeEach(() => {
  state.slots = Array.from({ length: 4 }, () => structuredClone(defaultSlot));
  state.slots[0].charId = "GearTest_intellect";
  state.grids = [skills.map((_, i) => row(i)), [], [], []];
});

test("every level-60-or-higher Wiki item is present once in the correct slot", () => {
  assert.equal(wiki.items.length, 276);
  const eligible = wiki.items.filter(([, , level]) => level >= 60);
  assert.equal(eligible.length, 185);
  for (const [name, slot] of eligible) {
    // The existing catalog uses 短剑 for the Wiki's 点剑短刃; retain its saved ID.
    const localName = name === "点剑短刃" ? "点剑短剑" : name;
    const matches = catalog.filter(e => e.name === localName || e.name.startsWith(`${localName}·`));
    // Exact base name, retaining variant suffixes such as ·壹型.
    const exact = matches.filter(e => !/[壹贰叁]型/.test(e.name.slice(localName.length)));
    assert.equal(exact.length, 1, name);
    assert.equal(exact[0].slot, slot, name);
  }
});

test("18 additions have unique IDs, source metadata, and no equipment below level 60", () => {
  const oldBuffs = new Set(catalog.filter(e => !specs.some(([n]) => e === find(n))).flatMap(e => (e.buffs || []).map(b => b.id)));
  const newBuffs = new Set();
  for (const [name] of specs) {
    const item = find(name);
    assert.ok(item, name);
    assert.equal(catalog.filter(e => e.id === item.id).length, 1, name);
    assert.equal(item.level, wiki.items.find(([n]) => n === name)[2]);
    assert.ok(item.level >= 60);
    assert.equal(item.enhancement, 3);
    assert.match(item.source, /^https:\/\/warfarin\.wiki\/cn\/gear\/item_equip_/);
    for (const b of item.buffs) {
      assert.ok(!oldBuffs.has(b.id) && !newBuffs.has(b.id), b.id);
      newBuffs.add(b.id);
    }
  }
  assert.equal(specs.filter(([name]) => find(name).level === 60).length, 3);
});

test("all new item attributes and damage affixes work across 30 damage contexts", () => {
  for (const [name, stats, percent, match, charge] of specs) {
    state.slots[0].equipment = structuredClone(defaultSlot.equipment);
    const item = equip(name);
    const expectedStats = Object.fromEntries(attributes.map(s => [s, 100 + (stats[s] || 0)]));
    expectedStats.intellect += stats.main || 0;
    expectedStats.will += stats.sub || 0;
    const totals = app.getSlotStatTotals(0);
    for (const s of attributes) assert.equal(totals[s], expectedStats[s], `${name}/${s}`);
    if (charge) {
      assert.ok(item.buffs.some(b => b.description.includes(`${charge}%`)));
      assert.ok(item.buffs.every(b => !b.effects?.length));
    }
    const atk = 300 * (1 + expectedStats.intellect * 0.005 + expectedStats.will * 0.002);
    app.calculateSlotDamage(0).rowResults.forEach((result, i) => {
      const skill = skills[i];
      const applies = match.includes(skill.type) || match.includes(skill.hits[0].element);
      const expected = atk * (1 + (applies ? percent / 100 : 0)) * 0.5 * 1.025;
      close(result.rowDamage, expected, `${name}/${skill.name}`);
    });
  }
});

test("level-60 main/sub affixes follow each character, including duplicate accessories", () => {
  equip("集成实训刃装护甲");
  equip("集成实训刃装护手");
  equip("集成实训刃装短锯");
  state.slots[0].equipment.kit2 = find("集成实训刃装短锯").id;
  for (let i = 0; i < attributes.length; i++) {
    const primary = attributes[i], secondary = attributes[(i + 1) % 4];
    state.slots[0].charId = `GearTest_${primary}`;
    const totals = app.getSlotStatTotals(0);
    assert.equal(totals[primary], 337);
    assert.equal(totals[secondary], 257);
    const atk = 300 * (1 + 337 * 0.005 + 257 * 0.002);
    app.calculateSlotDamage(0).rowResults.forEach((result, j) => {
      const physical = skills[j].hits[0].element === "Physical";
      close(result.rowDamage, atk * (1.2 + (physical ? 0.128 + 0.213 + 2 * 0.256 : 0)) * 0.5 * 1.025);
    });
  }
  assert.deepEqual(gear.countSets(state.slots[0].equipment), { AIC_Fieldwork: 4 });
});

test("new pieces activate existing sets at three pieces, and remove effects at two", () => {
  const sets = [
    ["Type_50_Yinglung", "50式应龙软甲", "50式应龙手套", "50式应龙信标"],
    ["AIC_Fieldwork", "集成实训刃装护甲", "集成实训刃装护手", "集成实训刃装短锯"],
    ["Pulser_Labs", "脉冲式轻甲", "脉冲式轻护手", "脉冲式护甲板"],
    ["Eternal_Xiranite", "长息改装护甲", "长息导能护手", "长息测距仪"],
  ];
  for (const [id, ...names] of sets) {
    state.slots[0].equipment = structuredClone(defaultSlot.equipment);
    names.forEach(equip);
    const set = gear.equipmentSets.find(s => s.id === id);
    const active = gear.collectEquipBuffs(state.slots[0].equipment, () => true);
    for (const b of set.buffs) assert.equal(active.filter(x => x.id === b.id).length, 1, b.id);
    state.slots[0].equipment.kit1 = null;
    const inactive = gear.collectEquipBuffs(state.slots[0].equipment, () => true);
    for (const b of set.buffs) assert.ok(!inactive.some(x => x.id === b.id), b.id);
  }
});

test("two beacons stack their combo bonus and count toward the Yinglung set", () => {
  equip("50式应龙软甲");
  equip("50式应龙信标");
  state.slots[0].equipment.kit2 = find("50式应龙信标").id;
  assert.deepEqual(gear.countSets(state.slots[0].equipment), { Type_50_Yinglung: 3 });
  const atk = 300 * 1.15 * (1 + 295 * 0.005 + 100 * 0.002);
  app.calculateSlotDamage(0).rowResults.forEach((result, i) => {
    close(result.rowDamage, atk * (1 + (skills[i].type === "combo" ? 0.269 + 2 * 0.538 : 0)) * 0.5 * 1.025);
  });
});

test("Riftbound pieces are standalone and grant no invented set bonus", () => {
  equip("涉渊钢甲");
  equip("涉渊裹手");
  equip("涉渊白刃");
  state.slots[0].equipment.kit2 = find("涉渊白刃").id;
  assert.deepEqual(gear.countSets(state.slots[0].equipment), {});
  assert.equal(app.getSlotStatTotals(0).agility, 359);
  assert.equal(gear.collectEquipBuffs(state.slots[0].equipment, () => true).length, 4);
  for (const [name] of specs.filter(([n]) => n.startsWith("涉渊"))) assert.equal(find(name).setId, "");
});
