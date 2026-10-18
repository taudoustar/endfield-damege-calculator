// Run: node --test scripts/test-*.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test } from "node:test";

globalThis.document = { addEventListener() {} };
globalThis.fetch = async path => ({
  ok: true,
  json: async () => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8")),
});
const app = await import("../js/team-app.js");
const { loadAllData } = await import("../js/data-loader.js");
const chars = await import("../js/characters.js");
const gear = await import("../js/equipment.js");
const { calculate, resolveEffectValue } = await import("../js/engine.js");
const { categories } = await import("../js/categories.js");
await loadAllData();

const { state } = app;
const emptySlot = structuredClone(state.slots[0]);
const row = (skillIndex = 0, cells = []) => ({
  skillIndex, count: 1, buffCells: cells.map(cell => typeof cell === "string" ? { id: cell } : cell),
});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const damage = slot => app.calculateSlotDamage(slot).totalDamage;
const buffs = slot => app.collectRowBuffs(slot, 0);
const has = (slot, id) => buffs(slot).some(b => b.id === id);
const select = (...ids) => ids.forEach((charId, i) => { state.slots[i].charId = charId; });
function equipSet(slot, id) {
  for (const [key, type] of [["armor", "armor"], ["gloves", "gloves"], ["kit1", "kit"]]) {
    state.slots[slot].equipment[key] = gear.equipment.find(e => e.setId === id && e.slot === type).id;
  }
}

beforeEach(() => {
  state.slots = Array.from({ length: 4 }, () => structuredClone(emptySlot));
  state.grids = [[], [], [], []];
  state.activeSlotIndex = 0;
});

test("removing/changing a teammate immediately disables its Buff and cleanup prevents revival", () => {
  select("Si", "Wulfgard");
  state.grids[1] = [row()];
  const base = damage(1);
  state.grids[1][0].buffCells = [{ id: "tb:0:Si_Cryo_Heat_Amp" }];
  assert.ok(damage(1) > base);
  for (const charId of [null, "Ardelia"]) {
    state.slots[0].charId = charId;
    close(damage(1), base);
  }
  app.updateGridBuffIds();
  assert.deepEqual(state.grids[1][0].buffCells, [null]);
  state.slots[0].charId = "Si";
  close(damage(1), base);
});

test("locked potential Buffs cannot be restored by raw, team, or generic IDs", () => {
  select("Si", "Wulfgard");
  state.slots[0].charPotLevel = 2;
  state.grids[0] = [row(0, [{ id: "Si_Three_Marks_Deep", inputValue: 3 }])];
  assert.ok(has(0, "Si_Three_Marks_Deep"));
  state.slots[0].charPotLevel = 0;
  assert.ok(!has(0, "Si_Three_Marks_Deep"));
  state.grids[1] = [row(0, ["Si_Three_Marks_Deep", "tb:0:Si_Three_Marks_Deep", "gb:Si_Three_Marks_Deep:0"])];
  assert.ok(!has(1, "Si_Three_Marks_Deep"));
  app.updateGridBuffIds();
  assert.deepEqual(state.grids[0][0].buffCells, [null]);
  assert.deepEqual(state.grids[1][0].buffCells, [null, null, null]);
});

test("potential upgrades and downgrades follow each recorded source, preserving row inputs", () => {
  select("Si", "Si", "Wulfgard");
  state.slots[1].charPotLevel = 3;
  state.grids[2] = [
    row(0, [{ id: "tb:0:Si_Cryo_Heat_Amp_p3", inputValue: 2 }]),
    row(0, ["tb:1:Si_Cryo_Heat_Amp"]),
  ];
  app.updateGridBuffIds();
  assert.deepEqual(state.grids[2].map(r => r.buffCells[0]), [
    { id: "tb:0:Si_Cryo_Heat_Amp", inputValue: 2 },
    { id: "tb:1:Si_Cryo_Heat_Amp_p3" },
  ]);
  assert.ok(has(2, "Si_Cryo_Heat_Amp"));
  assert.ok(app.collectRowBuffs(2, 1).some(b => b.id === "Si_Cryo_Heat_Amp_p3"));
});

test("unequipped sets and weapons stop applying without borrowing another slot's weapon", () => {
  select("Ardelia", "Wulfgard", "Lifeng");
  equipSet(0, "Eternal_Xiranite");
  state.grids[0] = [row(0, ["Eternal_Xiranite_b2"])];
  state.grids[1] = [row(0, ["tb:0:Eternal_Xiranite_b2"])];
  assert.ok(has(0, "Eternal_Xiranite_b2") && has(1, "Eternal_Xiranite_b2"));
  state.slots[0].equipment.kit1 = null;
  assert.ok(!has(0, "Eternal_Xiranite_b2") && !has(1, "Eternal_Xiranite_b2"));
  state.slots[0].weaponId = "Farsight";
  state.slots[2].weaponId = "Farsight";
  state.slots[2].weaponPotLevel = 5;
  state.grids[0] = [row(0, ["Farsight_p2"])];
  state.grids[1] = [row(0, ["tb:0:Farsight_p2"])];
  assert.ok(has(1, "Farsight_p2"));
  state.slots[0].weaponId = null;
  assert.ok(!has(0, "Farsight_p2"));
  assert.ok(!has(1, "Farsight_p2"));
  // An explicit source never falls back to the identical weapon in slot 2.
  app.updateGridBuffIds();
  assert.deepEqual(state.grids[0][0].buffCells, [null]);
  assert.deepEqual(state.grids[1][0].buffCells, [null]);
});

test("legacy import binds valid teammate IDs, removes invalid effects, and retains common/field Buffs", () => {
  app.importTeamConfig({
    slots: [{ charId: "Si" }, { charId: "Wulfgard" }],
    grids: [[], [row(0, ["Si_Cryo_Heat_Amp", "must_crit", "Staggered", "The_Living_Banner_5"])], [], []],
  });
  assert.deepEqual(state.grids[1][0].buffCells.map(c => c?.id ?? null), [
    "tb:0:Si_Cryo_Heat_Amp", "must_crit", "Staggered", null,
  ]);
  assert.deepEqual(state.slots[0].teamBuffInputValues, {});
  assert.equal(state.slots[0].teamBuffActiveOptionals, null);
  assert.ok(Number.isFinite(damage(1)));
});

// Wiki v1.6 (2026-10-15): set effect applies to battle/combo/ultimate skills.
// https://warfarin.wiki/cn/gear/item_equip_t4_suit_burst01_edc_02
test("Tide Surge's 20% passive includes battle skills but excludes basic, strike and status", () => {
  select("Wulfgard");
  equipSet(0, "Tide_Surge");
  const passive = app.getSlotPermanentBuffs(0).find(b => b.id === "Tide_Surge_b1");
  assert.ok(passive);
  for (const skillType of ["basic", "strike", "skill", "combo", "ultimate", "status"]) {
    for (const element of ["Physical", "Heat", "Cryo", "Electric", "Nature"]) {
      const context = { skillType, element };
      const base = calculate(100, [], categories, context).finalDamage;
      const result = calculate(100, [passive], categories, context).finalDamage;
      close(result, base * (["skill", "combo", "ultimate"].includes(skillType) ? 1.2 : 1));
    }
  }
});

// https://warfarin.wiki/cn/operators/pogranichnik — P3 raises only his own cap.
test("Pogranichnik P3 unlocks 4/5 morale stacks only for himself; old 1–3 IDs still work", () => {
  select("Pogranichnik", "Wulfgard");
  state.slots[0].charPotLevel = 3;
  state.grids[0] = [row()];
  const base = damage(0);
  for (let stacks = 1; stacks <= 5; stacks++) {
    const id = `The_Living_Banner_${stacks}`;
    state.grids[0][0].buffCells = [{ id }];
    close(damage(0), base * (1 + stacks * 0.08));
    assert.equal(buffs(0).find(b => b.id === id).statBonuses.artsIntensity, stacks * 8);
    state.grids[1] = [row(0, [`tb:0:${id}`])];
    assert.equal(has(1, id), stacks <= 3);
  }
  const teamIds = app.getAvailableBuffsForPalette(1).map(e => e.buff.id);
  assert.ok(!teamIds.includes("The_Living_Banner_4") && !teamIds.includes("The_Living_Banner_5"));
  state.slots[0].charPotLevel = 2;
  assert.ok(!has(0, "The_Living_Banner_5"));
  assert.ok(!app.getSlotOptionalBuffs(0).some(b => /The_Living_Banner_[45]/.test(b.id)));
});

function setupSource() {
  select("Perlica", "Wulfgard", "Wulfgard");
  state.slots[0].charPotLevel = 4;
  equipSet(0, "Deep_Rampart");
  state.slots[0].teamBuffActiveOptionals = ["Deep_Rampart_b2"];
  state.slots[0].userInputValues = { Deep_Rampart_b2: 1 };
  state.grids[0] = [row(0, [{ id: "Deep_Rampart_b2", inputValue: 2 }])];
  state.grids[1] = [row(0, ["tb:0:Constant_Guidance"])];
  state.grids[2] = [row(0, [{ id: "gb:Electrification:0", inputValue: 1 }])];
}

test("global source stacks control both teammate and generic Buffs independently of all grid rows", () => {
  setupSource();
  const baseIntensity = app.getSlotStatTotals(0).artsIntensity;
  const ownDamage = damage(0);
  for (const [input, stacks] of [[0, 0], [1, 1], [3, 3], [99, 3], [-2, 0], [2.9, 2]]) {
    state.slots[0].teamBuffInputValues.Deep_Rampart_b2 = input;
    state.slots[1].userInputValues.Deep_Rampart_b2 = 99;
    const sourceIntensity = baseIntensity + stacks * 16;
    const scale = 1 + 2 * sourceIntensity / (300 + sourceIntensity);
    for (const [slot, id, value] of [[1, "Constant_Guidance", 0.1596], [2, "Electrification", 0.12]]) {
      const buff = buffs(slot).find(b => b.id === id);
      buff.effects.forEach(e => assert.equal(e.scaleValue, sourceIntensity));
      close(buff.effects.reduce((sum, e) => sum + resolveEffectValue(e, {}), 0), value * scale);
      const cells = state.grids[slot][0].buffCells;
      state.grids[slot][0].buffCells = [];
      const base = damage(slot);
      state.grids[slot][0].buffCells = cells;
      close(damage(slot), base * (1 + value * scale));
    }
    close(damage(0), ownDamage);
  }
  state.slots[0].teamBuffActiveOptionals = [];
  assert.equal(buffs(1).find(b => b.id === "Constant_Guidance").effects[0].scaleValue, baseIntensity);
});

test("source configuration survives export/import; old saves use the prior source default", () => {
  setupSource();
  state.slots[0].teamBuffInputValues.Deep_Rampart_b2 = 3;
  const before = [damage(0), damage(1), damage(2)];
  const saved = JSON.parse(JSON.stringify(app.exportTeamConfig()));
  state.slots[0].teamBuffInputValues.Deep_Rampart_b2 = 0;
  app.importTeamConfig(saved);
  before.forEach((expected, slot) => close(damage(slot), expected));
  delete saved.slots[0].teamBuffInputValues;
  app.importTeamConfig(saved);
  assert.deepEqual(state.slots[0].teamBuffInputValues, {});
  assert.equal(buffs(1).find(b => b.id === "Constant_Guidance").effects[0].scaleValue,
    app.getSlotStatTotals(0).artsIntensity + 16);
});

test("source config supports multi-input stat bonuses without reading recipient values", () => {
  const source = {
    ...chars.characters.find(c => c.id === "Perlica"), id: "SourceInputTest",
    uniqueBuffs: [{
      id: "SourceInputs", optional: true,
      userInputs: [{ key: "stacks", default: 1, min: 0, max: 5, integer: true }, { key: "extra", default: 0 }],
      scaledStatBonuses: { artsIntensity: { input: "stacks", perStack: 10 } },
    }],
  };
  chars.setCharacters([...chars.characters, source]);
  select(source.id, "Wulfgard");
  state.slots[0].teamBuffActiveOptionals = ["SourceInputs"];
  state.slots[0].teamBuffInputValues = { SourceInputs__stacks: 4, SourceInputs__extra: 2 };
  state.slots[1].userInputValues = { SourceInputs__stacks: 1 };
  state.grids[1] = [row(0, ["gb:Electrification:0"])];
  assert.equal(buffs(1).find(b => b.id === "Electrification").effects[0].scaleValue, 40);
});

// Independent Wiki expectations for all eleven description/calculation discrepancies.
const wikiCases = [
  ["Model_Employee", "operators/da-pan", 0.08, "8%"],
  ["Delayed_Work", "operators/estella", 0.4, "40%"],
  ["Hard_Negotiator", "operators/avywenna", 0.08, "8%"],
  ["Turbid_Avatar_p1", "operators/lifeng", 0.17, "17%"],
  ["Æthertech_b1", "gear/item_equip_t4_suit_poise01_body_01", 0.08, "8%"],
  ["Turbid_Cutting_Torch_b1", "gear/item_equip_t4_suit_burst01_edc_02", 0.359, "35.9%"],
  ["Type_50_Yinglung_Heavy_Armor_b1", "gear/item_equip_t4_suit_atk02_body_01", 0.149, "14.9%"],
  ["MI_Security_Overalls_b1", "gear/item_equip_t4_suit_criti01_body_02", 0.179, "17.9%"],
  ["MI_Security_Hands_PPE_b1", "gear/item_equip_t4_suit_criti01_hand_02", 0.299, "29.9%"],
];
test("nine percentage discrepancies match the Wiki values and displayed descriptions", () => {
  for (const [id, path, expected, text] of wikiCases) {
    const buff = app.findBuffById(id);
    const source = `https://warfarin.wiki/cn/${path}`;
    assert.ok(buff.description.includes(text), `${id}: ${source}`);
    for (const effect of buff.effects) close(effect.value, expected);
  }
});

test("Lifeng P2 adds 15 flat to each stat, and Typhoeus P5 scales burst by 1.1 vs ultimate by 1.2", () => {
  // https://warfarin.wiki/cn/operators/lifeng
  select("Lifeng");
  state.slots[0].charPotLevel = 1;
  const before = app.getSlotStatTotals(0);
  state.slots[0].charPotLevel = 2;
  const after = app.getSlotStatTotals(0);
  for (const stat of ["strength", "agility", "intellect", "will"]) assert.equal(after[stat] - before[stat], 15);
  assert.equal(app.findBuffById("Self_Refinement").description, "全能力+15");
  // https://warfarin.wiki/cn/operators/typhoeus
  select("Typhoeus");
  state.slots[0].charPotLevel = 4;
  state.grids[0] = [row(8), row(11), row(12), row(13)];
  const baseRows = app.calculateSlotDamage(0).rowResults;
  state.slots[0].charPotLevel = 5;
  app.calculateSlotDamage(0).rowResults.forEach((result, i) =>
    close(result.rowDamage, baseRows[i].rowDamage * (i === 0 ? 1.1 : 1.2)));
});
