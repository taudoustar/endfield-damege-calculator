// Run with: node --test scripts/test-si.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, beforeEach } from "node:test";

// Load the real application and JSON catalog without starting the browser UI.
globalThis.document = { addEventListener() {} };
globalThis.fetch = async (path) => ({
  ok: true,
  json: async () => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8")),
});
const { loadAllData } = await import("../js/data-loader.js");
const characterData = await import("../js/characters.js");
const weaponData = await import("../js/weapons.js");
const app = await import("../js/team-app.js");
const { renderAnalysis } = await import("../js/analysis.js");
await loadAllData();

const { state } = app;
const defaultSlot = structuredClone(state.slots[0]);
const si = characterData.characters.find((character) => character.id === "Si");
const originalSkills = JSON.stringify(si.skills);
const baseAtk = 309 * (1 + 239 * 0.005 + 117 * 0.002);
const expected = (multiplier) => baseAtk * multiplier * 0.5 * 1.025;
const row = (skillIndex, skillInputValue, buffCells = [], count = 1) => ({
  skillIndex, skillInputValue, buffCells, count,
});
const close = (actual, target) => {
  assert.ok(Math.abs(actual - target) < 1e-8, `${actual} != ${target}`);
};

beforeEach(() => {
  state.slots = Array.from({ length: 4 }, () => structuredClone(defaultSlot));
  state.slots[0].charId = "Si";
  state.grids = [[], [], [], []];
  state.activeSlotIndex = 0;
});

test("Si loads once, uses Greatswords, and receives the attribute talent once", () => {
  assert.equal(characterData.characters.filter((c) => c.id === "Si").length, 1);
  assert.equal(si.skills.length, 11);
  assert.equal(si.potentialBuffs.length, 5);
  assert.equal(si.weaponType, "Greatsword");
  assert.ok(weaponData.weapons.some((weapon) => weapon.type === si.weaponType));
  assert.deepEqual(app.getSlotStatTotals(0), {
    strength: 117, agility: 100, intellect: 239, will: 100,
  });
});

test("all ordinary skills and potential overrides match the published multipliers", () => {
  for (let potential = 0; potential <= 5; potential++) {
    state.slots[0].charPotLevel = potential;
    const multipliers = [0.45, 0.72, 0.66, 0.54, 1.44, 1, null,
      potential === 5 ? 10.925 : 8.5, potential >= 3 ? 6 : 5, 1.8, 9];
    state.grids[0] = si.skills.map((_, index) => row(index));
    const result = app.calculateSlotDamage(0);
    multipliers.forEach((multiplier, index) => {
      close(result.rowResults[index].rowDamage, multiplier == null ? 0 : expected(multiplier));
    });
  }
  assert.equal(JSON.stringify(si.skills), originalSkills);
});

test("combo scales with actual stacks; P5 adds one stack and multiplies the whole skill", () => {
  for (const potential of [0, 2, 4, 5]) {
    state.slots[0].charPotLevel = potential;
    for (let stacks = 1; stacks <= 4; stacks++) {
      state.grids[0] = [row(7, stacks)];
      const effectiveStacks = stacks + (potential === 5 ? 1 : 0);
      const multiplier = (7.5 + effectiveStacks) * (potential === 5 ? 1.15 : 1);
      close(app.calculateSlotDamage(0).totalDamage, expected(multiplier));
      if (potential >= 2) {
        const buffs = app.getSlotOptionalBuffs(0).filter((b) => b.id.startsWith("Si_Three_Marks_Deep"));
        assert.equal(buffs.length, 1);
        state.grids[0][0].buffCells = [{ id: buffs[0].id, inputValue: stacks }];
        close(app.calculateSlotDamage(0).totalDamage, expected(multiplier) * (1.08 + 0.03 * effectiveStacks));
      }
    }
  }
});

test("combo input is bounded, integral, and safe after configuration import", () => {
  for (const [input, stacks] of [[-1, 1], [99, 4], [2.9, 2], ["invalid", 1], [null, 1]]) {
    state.grids[0] = [row(7, input)];
    close(app.calculateSlotDamage(0).totalDamage, expected(7.5 + stacks));
  }
});

test("team Amp is replaced at P3 and only affects Cryo and Heat", () => {
  for (const potential of [0, 2, 3, 5]) {
    state.slots[0].charPotLevel = potential;
    for (const [charId, element] of [["Yvonne", "Cryo"], ["Wulfgard", "Heat"],
      ["Endministrator", "Physical"], ["Perlica", "Electric"], ["Ardelia", "Nature"]]) {
      state.slots[1].charId = charId;
      const character = app.getSlotChar(1);
      const skillIndex = character.skills.findIndex((s) => s.hits.every((h) => h.element === element));
      assert.ok(skillIndex >= 0);
      state.grids[1] = [row(skillIndex)];
      const baseline = app.calculateSlotDamage(1).totalDamage;
      const entries = app.getAvailableBuffsForPalette(1).filter((e) => e.buff.id.startsWith("Si_Cryo_Heat_Amp"));
      assert.equal(entries.length, 1);
      state.grids[1][0].buffCells = [{ id: entries[0].id }];
      const amp = ["Cryo", "Heat"].includes(element) ? (potential >= 3 ? 0.432 : 0.36) : 0;
      close(app.calculateSlotDamage(1).totalDamage, baseline * (1 + amp));
    }
  }
});

test("recorded damage skips ATK, damage buffs, DEF, RES, and critical hits", () => {
  const recordedDamage = 123456.75;
  for (const potential of [0, 1, 5]) {
    state.slots[0].charPotLevel = potential;
    state.slots[0].weaponId = weaponData.weapons.find((w) => w.type === "Greatsword").id;
    const buffs = app.getSlotOptionalBuffs(0).map((buff) => ({ id: buff.id, inputValue: 4 }));
    buffs.push({ id: "must_crit" }, { id: "Staggered", inputValue: 100 },
      { id: "Resistance_Change", inputValue: -50 });
    state.grids[0] = [row(6, recordedDamage, buffs, 2)];
    const result = app.calculateSlotDamage(0);
    close(result.totalDamage, recordedDamage * (potential >= 1 ? 0.2 : 0.13) * 2);
    assert.equal(result.rowResults[0].hits[0].element, "Fixed");
    assert.equal(result.rowResults[0].hits[0].crit.critRate, 0);
    assert.deepEqual(result.rowResults[0].hits[0].breakdown, {});
  }
});

test("recorded damage supports zero and decimals, rejects negative/non-finite inputs, and survives export", () => {
  for (const input of [undefined, null, -100, "invalid", Infinity]) {
    state.grids[0] = [row(6, input)];
    close(app.calculateSlotDamage(0).totalDamage, 0);
  }
  state.grids[0] = [row(6, 100000.5)];
  const snapshot = JSON.parse(JSON.stringify({ slots: state.slots, grids: state.grids }));
  state.slots = snapshot.slots;
  state.grids = snapshot.grids;
  close(app.calculateSlotDamage(0).totalDamage, 13000.065);
});

test("fixed damage appears in both total damage and the analysis chart", () => {
  state.grids[0] = [row(6, 100000), row(5)];
  const result = app.calculateSlotDamage(0);
  close(result.totalDamage, 13000 + expected(1));
  const target = { innerHTML: "" };
  document.getElementById = () => target;
  renderAnalysis([{ charName: si.name, ...result }]);
  assert.match(target.innerHTML, /固定/);
  assert.match(target.innerHTML, /13000/);
  delete document.getElementById;
});

test("existing Purrchena, ordinary ATK damage, and status damage retain their calculations", () => {
  state.slots[0].charId = "Purrchena";
  state.slots[0].charPotLevel = 5;
  state.grids[0] = [row(8, undefined, [], 3)];
  close(app.calculateSlotDamage(0).totalDamage, 8230.03578);
  state.slots[0].charId = "Endministrator";
  state.slots[0].charPotLevel = 0;
  const atk = 319 * (1 + 200 * 0.005 + 123 * 0.002);
  state.grids[0] = [row(0), row("Knock_Down")];
  const result = app.calculateSlotDamage(0);
  close(result.rowResults[0].rowDamage, atk * 0.51 * 0.5 * 1.025);
  close(result.rowResults[1].rowDamage, atk * 1.4724 * 0.5 * 1.025);
});
