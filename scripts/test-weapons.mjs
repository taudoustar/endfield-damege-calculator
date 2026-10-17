// Run with: node --test scripts/test-weapons.mjs scripts/test-si.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, beforeEach } from "node:test";

globalThis.document = { addEventListener() {} };
globalThis.fetch = async (path) => ({
  ok: true,
  json: async () => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8")),
});
const { loadAllData } = await import("../js/data-loader.js");
const characterData = await import("../js/characters.js");
const { resolveWeaponBuffs } = await import("../js/weapons.js");
const app = await import("../js/team-app.js");
await loadAllData();
// Use the live binding after loadAllData injects the catalog.
const weaponData = await import("../js/weapons.js");
const catalog = weaponData.weapons.filter((weapon) => weapon.id);
const types = ["Sword", "Greatsword", "Arts_Unit", "Handcannon", "Polearm"];
const skillDefs = [["basic", "Heat"], ["skill", "Electric"], ["combo", "Cryo"],
  ["ultimate", "Nature"], ["strike", "Physical"], ["status", "Nature"]];
characterData.setCharacters([...characterData.characters, ...types.map((type) => ({
  id: `Test_${type}`, name: type, weaponType: type, baseAtk: 300,
  baseCritRate: 0.05, baseCritDamage: 0.5,
  baseStats: { strength: 100, agility: 100, intellect: 100, will: 100 },
  statConfig: { primary: { stat: "intellect", ratio: 0.005 }, secondary: [{ stat: "strength", ratio: 0.002 }] },
  uniqueBuffs: [], potentialBuffs: [],
  skills: skillDefs.map(([type, element]) => ({ name: `${type}/${element}`, type, hits: [{ element, multiplier: 1 }] })),
}))]);

// Wiki v1.6, updated 2026-10-15: https://warfarin.wiki/cn/weapons
// Deduplicates the repeated 宏愿 link in the source catalog.
const sixStars = {
  Sword: ["宏愿", "聚合工业", "热熔切割器", "熔铸火焰", "狼之绯", "黯色火炬", "扶摇", "显赫声名", "白夜新星", "不知归", "光荣记忆", "遥望"],
  Arts_Unit: ["寒夜幽影", "四二式·肃阵", "雾中微光", "作品：蚀迹", "爆破单元", "遗忘", "骑士精神", "使命必达", "沧溟星梦", "孤舟", "联结点", "苦难的尽头"],
  Greatsword: ["典范", "昔日精品", "大雷斑", "破碎君王", "赫拉芬格", "幻想苦痛", "赤缨", "玉中身", "悠久传承"],
  Polearm: ["灯火使命", "J.E.T.", "负山", "骁勇", "曜夜的首演", "镀红祝福", "黄金时代"],
  Handcannon: ["落草", "望乡", "领航者", "楔子", "同类相食", "艺术暴君"],
};
// Independent level-90/rank-9 affixes and rank-4 passive values from the ten source pages.
const specs = {
  Complexed_Industry: { atk: 490, stat: "will", element: "Electric", damage: 0.433, atkPct: 0.112 },
  Farsight: { atk: 500, main: 132, intensity: 78 },
  Former_Finery: { atk: 495, stat: "will" },
  Thunderberge: { atk: 495, stat: "strength" },
  Sundered_Prince: { atk: 490, stat: "strength", crit: 0.195 },
  Jade_Vessel: { atk: 500, stat: "intellect", element: "Cryo", damage: 0.433, atkPct: 0.256 },
  Long_Heritage: { atk: 485, stat: "intellect", element: "Cryo", damage: 0.433, mainPct: 0.112 },
  Opus_Etch_Figure: { atk: 485, stat: "will", element: "Nature", damage: 0.433, atkPct: 0.112 },
  Navigator: { atk: 490, stat: "intellect", element: "Cryo", damage: 0.433, scalingCrit: 0.056 },
  Wedge: { atk: 500, main: 132, crit: 0.195, artsDamage: 0.192 },
};
const rankFactors = [1, 1.125, 1.25, 1.375, 1.5, 1.75];
const { state } = app;
const defaultSlot = structuredClone(state.slots[0]);
const row = (skillIndex, buffCells = []) => ({ skillIndex, count: 1, buffCells });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const equip = (id, level, slot = 0) => {
  const weapon = catalog.find((w) => w.id === id);
  Object.assign(state.slots[slot], { charId: `Test_${weapon.type}`, weaponId: id, weaponPotLevel: level });
  return weapon;
};
const expectedDamage = (id, level, skillIndex, extra = {}) => {
  const spec = specs[id];
  const factor = rankFactors[level];
  const [type, element] = skillDefs[skillIndex];
  const intellect = (100 + (spec.stat === "intellect" ? 156 : 0) + (spec.main || 0)) * (1 + (spec.mainPct || 0) * factor);
  const strength = 100 + (spec.stat === "strength" ? 156 : 0);
  const atk = (300 + spec.atk) * (1 + (spec.atkPct || 0) * factor + (extra.atk || 0)) * (1 + intellect * 0.005 + strength * 0.002);
  const damage = (spec.element === element ? spec.damage : 0) + (element !== "Physical" ? (spec.artsDamage || 0) * factor : 0) + (extra.damage || 0);
  const crit = 0.05 + (spec.crit || 0) + (spec.scalingCrit || 0) * factor + (extra.crit || 0);
  const intensity = type === "status" ? 1 + ((spec.intensity || 0) + (extra.intensity || 0)) * 0.01 : 1;
  return atk * (1 + damage) * (1 + (extra.taken || 0)) * 0.5 * (1 + crit * 0.5) * intensity;
};

beforeEach(() => {
  state.slots = Array.from({ length: 4 }, () => structuredClone(defaultSlot));
  state.grids = [[], [], [], []];
  state.activeSlotIndex = 0;
});

test("all 46 six-star weapons in the Wiki catalog are present exactly once", () => {
  assert.equal(Object.values(sixStars).flat().length, 46);
  assert.equal(new Set(catalog.map((w) => w.id)).size, catalog.length);
  for (const [type, names] of Object.entries(sixStars)) {
    for (const name of names) {
      const matches = catalog.filter((w) => w.name === name);
      assert.equal(matches.length, 1, name);
      assert.equal(matches[0].type, type, name);
    }
  }
  const allBuffIds = catalog.flatMap((w) => w.potentialBuffs || []).map((b) => b.id);
  for (const id of Object.keys(specs)) {
    const weapon = catalog.find((w) => w.id === id);
    assert.equal(weapon.rarity, 6);
    assert.match(weapon.source, /^https:\/\/warfarin\.wiki\/cn\/weapons\//);
    for (const buff of weapon.potentialBuffs) {
      assert.equal(allBuffIds.filter((candidate) => candidate === buff.id).length, 1, buff.id);
    }
  }
});

test("all ten weapons have correct permanent damage and attributes at every refinement", () => {
  for (const id of Object.keys(specs)) {
    for (let level = 0; level <= 5; level++) {
      const weapon = equip(id, level);
      state.grids[0] = skillDefs.map((_, i) => row(i));
      const result = app.calculateSlotDamage(0);
      result.rowResults.forEach((result, i) => close(result.rowDamage, expectedDamage(id, level, i)));
      for (const buff of resolveWeaponBuffs(weapon, level)) {
        assert.equal(typeof buff.description, "string");
        assert.ok(!buff.description.includes("undefined"));
      }
    }
  }
});

test("Complexed Industry adds conditional Electric damage and status Arts intensity", () => {
  for (let level = 0; level <= 5; level++) {
    equip("Complexed_Industry", level);
    state.grids[0] = skillDefs.map((_, i) => row(i, [{ id: "Complexed_Industry_p3" }]));
    app.calculateSlotDamage(0).rowResults.forEach((result, i) => close(result.rowDamage,
      expectedDamage("Complexed_Industry", level, i, {
        damage: i === 1 ? 0.128 * rankFactors[level] : 0, intensity: 24 * rankFactors[level],
      })));
  }
});

test("Sundered Prince and Navigator distinguish doubled triggers and clamp imported input", () => {
  for (const id of ["Sundered_Prince", "Navigator"]) {
    for (let level = 0; level <= 5; level++) {
      equip(id, level);
      for (const [inputValue, doubled] of [[0, 0], [1, 1], [-10, 0], [99, 1], [0.9, 0]]) {
        const factor = rankFactors[level] * (1 + doubled);
        const buffId = id === "Navigator" ? "Navigator_p3" : "Sundered_Prince_p2";
        state.grids[0] = skillDefs.map((_, i) => row(i, [{ id: buffId, inputValue }]));
        app.calculateSlotDamage(0).rowResults.forEach((result, i) => close(result.rowDamage,
          expectedDamage(id, level, i, id === "Navigator" ? {
            damage: [2, 3, 5].includes(i) ? 0.056 * factor : 0, crit: 0.032 * factor,
          } : { atk: 0.16 * factor })));
      }
    }
  }
});

test("Jade Vessel vulnerability and next-combo damage are independent", () => {
  for (let level = 0; level <= 5; level++) {
    equip("Jade_Vessel", level);
    for (const ids of [[], ["Jade_Vessel_p3"], ["Jade_Vessel_p4"], ["Jade_Vessel_p3", "Jade_Vessel_p4"]]) {
      state.grids[0] = skillDefs.map((_, i) => row(i, ids.map((id) => ({ id }))));
      app.calculateSlotDamage(0).rowResults.forEach((result, i) => close(result.rowDamage,
        expectedDamage("Jade_Vessel", level, i, {
          taken: ids.includes("Jade_Vessel_p3") ? 0.12 * rankFactors[level] : 0,
          damage: ids.includes("Jade_Vessel_p4") && i === 2 ? 0.4 * rankFactors[level] : 0,
        })));
    }
    state.slots[1].charId = "Test_Sword";
    state.grids[1] = [row(4)];
    const baseline = app.calculateSlotDamage(1).totalDamage;
    const entries = app.getAvailableBuffsForPalette(1).filter((b) => b.buff.id.startsWith("Jade_Vessel"));
    assert.deepEqual(entries.map((b) => b.buff.id), ["Jade_Vessel_p3"]);
    state.grids[1][0].buffCells = [{ id: entries[0].id }];
    close(app.calculateSlotDamage(1).totalDamage, baseline * (1 + 0.12 * rankFactors[level]));
  }
  state.slots[0].charId = "Si";
  state.grids[0] = [{ ...row(6, [{ id: "Jade_Vessel_p3" }]), skillInputValue: 100000 }];
  close(app.calculateSlotDamage(0).totalDamage, 13000);
});

test("Farsight shares damage and Arts intensity with teammates, using the source refinement", () => {
  equip("Farsight", 0);
  equip("Farsight", 5, 1);
  for (const [source, level] of [[0, 0], [1, 5]]) {
    state.slots[2].charId = "Test_Sword";
    state.grids[2] = skillDefs.map((_, i) => row(i));
    const baseline = app.calculateSlotDamage(2).rowResults;
    const entry = app.getAvailableBuffsForPalette(2).find((b) => b.buff.id === "Farsight_p2" && b.sourceSlotIndex === source);
    state.grids[2] = skillDefs.map((_, i) => row(i, [{ id: entry.id }]));
    app.calculateSlotDamage(2).rowResults.forEach((result, i) => close(result.rowDamage,
      baseline[i].rowDamage * (1 + 0.08 * rankFactors[level]) * (i === 5 ? 1 + 0.16 * rankFactors[level] : 1)));
  }
  state.grids[0] = [row(5, [{ id: "Farsight_p2" }])];
  close(app.calculateSlotDamage(0).totalDamage, expectedDamage("Farsight", 0, 5, { damage: 0.08, intensity: 16 }));
});

test("Long Heritage applies main-stat percent once and limits its two independent damage buffs", () => {
  for (let level = 0; level <= 5; level++) {
    equip("Long_Heritage", level);
    close(app.getSlotStatTotals(0).intellect, 256 * (1 + 0.112 * rankFactors[level]));
    state.grids[0] = skillDefs.map((_, i) => row(i, [{ id: "Long_Heritage_p3" }, { id: "Long_Heritage_p4" }]));
    app.calculateSlotDamage(0).rowResults.forEach((result, i) => close(result.rowDamage,
      expectedDamage("Long_Heritage", level, i, {
        damage: ((i === 2 ? 0.096 : 0) + (i !== 4 ? 0.064 : 0)) * rankFactors[level],
      })));
  }
});

test("Opus Etch Figure excludes its owner and scales teammate Arts damage with 0–3 enemies", () => {
  for (let level = 0; level <= 5; level++) {
    equip("Opus_Etch_Figure", level);
    assert.ok(!app.getAvailableBuffsForPalette(0).some((b) => b.buff.id === "Opus_Etch_Figure_p3"));
    for (const id of ["Opus_Etch_Figure_p3", "tb:0:Opus_Etch_Figure_p3", "gb:Opus_Etch_Figure_p3:0"]) {
      state.grids[0] = [row(3, [{ id, inputValue: 3 }])];
      close(app.calculateSlotDamage(0).totalDamage, expectedDamage("Opus_Etch_Figure", level, 3));
    }
    state.slots[1].charId = "Test_Sword";
    const entry = app.getAvailableBuffsForPalette(1).find((b) => b.buff.id === "Opus_Etch_Figure_p3");
    assert.ok(entry);
    state.grids[1] = skillDefs.map((_, i) => row(i));
    const baseline = app.calculateSlotDamage(1).rowResults;
    for (const [inputValue, enemies] of [[0, 0], [1, 1], [3, 3], [100, 3], [-1, 0], [2.9, 2]]) {
      state.grids[1] = skillDefs.map((_, i) => row(i, [{ id: entry.id, inputValue }]));
      app.calculateSlotDamage(1).rowResults.forEach((result, i) => close(result.rowDamage,
        baseline[i].rowDamage * (1 + (i !== 4 ? (0.08 + 0.032 * enemies) * rankFactors[level] : 0))));
    }
  }
});

test("Wedge's two triggers add independently and never increase Physical damage", () => {
  for (let level = 0; level <= 5; level++) {
    equip("Wedge", level);
    for (const ids of [[], ["Wedge_p3"], ["Wedge_p4"], ["Wedge_p3", "Wedge_p4"]]) {
      state.grids[0] = skillDefs.map((_, i) => row(i, ids.map((id) => ({ id }))));
      const extra = (ids.includes("Wedge_p3") ? 0.128 : 0) + (ids.includes("Wedge_p4") ? 0.256 : 0);
      app.calculateSlotDamage(0).rowResults.forEach((result, i) => close(result.rowDamage,
        expectedDamage("Wedge", level, i, { damage: i !== 4 ? extra * rankFactors[level] : 0 })));
    }
  }
});

test("support-only weapon descriptions follow refinement without adding damage", () => {
  for (const id of ["Former_Finery", "Thunderberge"]) {
    const weapon = equip(id, 0);
    const low = resolveWeaponBuffs(weapon, 0);
    const high = resolveWeaponBuffs(weapon, 5);
    assert.notEqual(low[1].description, high[1].description);
    assert.match(low[1].description, /当前仅展示，不计入伤害/);
    assert.ok(high.every((b) => !b.effects));
    assert.equal(app.getSlotOptionalBuffs(0).length, 0);
  }
});
