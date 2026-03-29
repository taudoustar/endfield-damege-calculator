/**
 * team-grid.js — Battle grid rendering and drag interaction module.
 *
 * Renders an Excel-like grid where users place skills and buffs into a
 * damage rotation.  Supports click-to-place and drag-to-fill from the
 * palette selection held in `state.paletteSelection`.
 */

import { state, render, renderResult, getSlotChar, findBuffById } from "./team-app.js";
import { genericSkills } from "./generic-skills.js";

/* ------------------------------------------------------------------ */
/*  Internal state                                                     */
/* ------------------------------------------------------------------ */

let isDragging = false;
let dragMode = null; // "place" | "erase"

/* ------------------------------------------------------------------ */
/*  Cell helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Place the currently selected palette item into a grid cell.
 *
 * @param {Array}  grid      - The grid array for the active slot.
 * @param {Object} char      - The character object for the active slot.
 * @param {number} row       - Row index.
 * @param {number} col       - Column index (0 = skill, 1 = count, 2+ = buff).
 * @param {Object} selection - `{ type: "skill"|"buff", id }`.
 */
function placeItem(grid, char, row, col, selection) {
  if (col === 0 && selection.type === "skill") {
    // Place skill in skill column
    grid[row].skillIndex = selection.id; // id is skillIndex (number)
  } else if (col >= 2 && selection.type === "buff") {
    // Place buff in buff column
    const buffCol = col - 2;
    // Extend buffCells if needed
    while (grid[row].buffCells.length <= buffCol) {
      grid[row].buffCells.push(null);
    }
    // 若已有旧值保留其 inputValue；否则快照当前槽位值作为初始独立值
    const existing = grid[row].buffCells[buffCol];
    const prevInput = (existing && typeof existing === "object") ? existing.inputValue : undefined;
    let initInput = prevInput;
    if (initInput == null) {
      const buff = findBuffById(selection.id);
      if (buff?.userInput) {
        const slotVals = state.slots[state.activeSlotIndex]?.userInputValues || {};
        initInput = slotVals[buff.id] ?? buff.userInput.default ?? 0;
      }
    }
    grid[row].buffCells[buffCol] = initInput != null
      ? { id: selection.id, inputValue: initInput }
      : { id: selection.id };
  }
  // col 1 (count) is not a valid placement target
}

/**
 * Clear the contents of a single grid cell.
 *
 * @param {Array}  grid - The grid array for the active slot.
 * @param {number} row  - Row index.
 * @param {number} col  - Column index.
 */
function clearCell(grid, row, col) {
  if (col === 0) {
    grid[row].skillIndex = null;
  } else if (col >= 2) {
    const buffCol = col - 2;
    if (grid[row].buffCells[buffCol]) {
      grid[row].buffCells[buffCol] = null;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  renderGrid                                                         */
/* ------------------------------------------------------------------ */

/**
 * Render the battle grid table for the currently active slot.
 *
 * Reads `state.grids[state.activeSlotIndex]` and writes the resulting
 * HTML into the `#battle-grid` container.  Also wires up count-input
 * change handlers and add/remove row/column buttons.
 */
export function renderGrid() {
  const el = document.getElementById("battle-grid");
  const grid = state.grids[state.activeSlotIndex];
  const char = getSlotChar(state.activeSlotIndex);

  if (!char) {
    el.innerHTML = '<p class="empty">请先选择角色</p>';
    return;
  }

  // Determine number of buff columns (max buffCells.length across rows, min 3)
  const numBuffCols = Math.max(3, ...grid.map((r) => r.buffCells.length));

  let html = '<table class="grid-table">';

  // ---- Header row ----
  html += "<thead><tr>";
  html += '<th class="grid-th">技能</th>';
  html += '<th class="grid-th grid-th-count">次数</th>';
  for (let c = 0; c < numBuffCols; c++) {
    html += `<th class="grid-th">buff ${c + 1} <button class="grid-remove-col-btn" data-col="${c}" title="删除列">×</button></th>`;
  }
  html +=
    '<th class="grid-th grid-th-add"><button class="grid-add-col-btn" title="添加列">+</button></th>';
  html += '<th class="grid-th">伤害</th>';
  html += "</tr></thead>";

  // ---- Body rows ----
  html += "<tbody>";

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    html += '<tr class="grid-row">';

    // Skill cell (col 0)
    if (row.skillIndex != null) {
      const skill = typeof row.skillIndex === "string"
        ? genericSkills.find((s) => s.id === row.skillIndex)
        : char.skills[row.skillIndex];
      const skillTypeClass = skill ? skill.type : "generic";
      const skillName = skill ? skill.name : row.skillIndex;
      html += `<td class="grid-cell grid-cell-skill filled" data-row="${r}" data-col="0">`;
      html += `<span class="grid-chip skill-chip ${skillTypeClass}">${skillName}</span>`;
      html += "</td>";
    } else {
      html += `<td class="grid-cell grid-cell-skill" data-row="${r}" data-col="0"></td>`;
    }

    // Count cell (col 1)
    html += '<td class="grid-cell grid-cell-count">';
    html += `<input type="number" class="grid-count-input" min="1" value="${row.count}" data-row="${r}">`;
    html += "</td>";

    // Buff cells (col 2+)
    for (let c = 0; c < numBuffCols; c++) {
      const cell = row.buffCells[c] ?? null;
      // 兼容旧格式（纯字符串 ID）和新格式（{ id, inputValue? }）
      const cellObj = cell && typeof cell === "object" ? cell : (cell ? { id: cell } : null);
      const buffId = cellObj ? cellObj.id : null;
      if (buffId) {
        const buff = findBuffById(buffId);
        const name = buff ? buff.name : buffId;
        html += `<td class="grid-cell grid-cell-buff filled" data-row="${r}" data-col="${c + 2}">`;
        if (buff?.userInput) {
          const slotVals = state.slots[state.activeSlotIndex]?.userInputValues || {};
          const defaultVal = buff.userInput.default ?? 0;
          // 优先用格子自己的值，其次用面板右侧填的值，最后用 default
          const curVal = cellObj.inputValue ?? slotVals[buff.id] ?? defaultVal;
          const label = buff.userInput.label || "";
          html += `<span class="grid-chip buff-chip" title="${buff?.description || ""}">${name}</span>`;
          html += `<input type="number" class="grid-cell-input" data-row="${r}" data-col="${c + 2}" value="${curVal}" step="any" />`;
          if (label) html += `<span class="grid-cell-input-label">${label}</span>`;
        } else {
          html += `<span class="grid-chip buff-chip" title="${buff?.description || ""}">${name}</span>`;
        }
        html += "</td>";
      } else {
        html += `<td class="grid-cell grid-cell-buff" data-row="${r}" data-col="${c + 2}"></td>`;
      }
    }

    // Add-col placeholder
    html += '<td class="grid-cell-placeholder"></td>';

    // Row damage display
    html += `<td class="grid-cell grid-cell-damage" data-row="${r}">-</td>`;

    // Remove row button
    html += `<td class="grid-cell-action"><button class="grid-remove-row-btn" data-row="${r}" title="删除行">×</button></td>`;

    html += "</tr>";
  }

  // Add row button (spans all columns)
  html += '<tr><td colspan="' + (numBuffCols + 4) + '">';
  html += '<button class="grid-add-row-btn">+ 添加行</button>';
  html += "</td></tr>";

  html += "</tbody></table>";
  el.innerHTML = html;

  // ---- Bind count input events ----
  el.querySelectorAll(".grid-count-input").forEach((input) => {
    input.addEventListener("change", () => {
      const r = parseInt(input.dataset.row);
      grid[r].count = Math.max(1, parseInt(input.value) || 1);
      render();
    });
  });

  // ---- Bind add-row button ----
  el.querySelector(".grid-add-row-btn")?.addEventListener("click", () => {
    const cols = Math.max(3, ...grid.map((r) => r.buffCells.length));
    grid.push({
      skillIndex: null,
      count: 1,
      buffCells: Array(cols).fill(null),
    });
    render();
  });

  // ---- Bind add-col button ----
  el.querySelector(".grid-add-col-btn")?.addEventListener("click", () => {
    for (const row of grid) {
      row.buffCells.push(null);
    }
    render();
  });

  // ---- Bind remove-col buttons ----
  el.querySelectorAll(".grid-remove-col-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const c = parseInt(btn.dataset.col);
      for (const row of grid) {
        if (c < row.buffCells.length) {
          row.buffCells.splice(c, 1);
        }
      }
      // 保留至少 1 列
      if (grid.length > 0 && grid[0].buffCells.length === 0) {
        for (const row of grid) {
          row.buffCells.push(null);
        }
      }
      render();
    });
  });

  // ---- Bind remove-row buttons ----
  el.querySelectorAll(".grid-remove-row-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const r = parseInt(btn.dataset.row);
      grid.splice(r, 1);
      if (grid.length === 0) {
        grid.push({
          skillIndex: null,
          count: 1,
          buffCells: [null, null, null],
        });
      }
      render();
    });
  });
}

/* ------------------------------------------------------------------ */
/*  initGridEvents                                                     */
/* ------------------------------------------------------------------ */

/**
 * Set up mousedown / mousemove / mouseup on the grid container for
 * click-to-place and drag-to-fill interactions.
 *
 * - When a palette item is selected (`state.paletteSelection`), clicking
 *   or dragging over cells places the item.
 * - When no palette item is selected, clicking a filled cell clears it.
 *
 * Call this once at startup.
 */
export function initGridEvents() {
  const container = document.getElementById("battle-grid");

  // --- 格子内 userInput 输入框：保存值，不触发放置/清除 ---
  container.addEventListener("input", (e) => {
    if (!e.target.classList.contains("grid-cell-input")) return;
    const r = parseInt(e.target.dataset.row);
    const c = parseInt(e.target.dataset.col) - 2;
    const grid = state.grids[state.activeSlotIndex];
    if (!grid?.[r]) return;
    const cell = grid[r].buffCells[c];
    // 空字符串表示用户未填，inputValue 设为 null（计算时回落到槽位级别值）
    const parsed = e.target.value.trim() === "" ? null : (parseFloat(e.target.value) || 0);
    if (cell && typeof cell === "object") {
      cell.inputValue = parsed;
    } else if (cell) {
      grid[r].buffCells[c] = { id: cell, inputValue: parsed };
    }
    renderResult();
  });

  container.addEventListener("mousedown", (e) => {
    // 防止点击输入框触发放置/清除
    if (e.target.classList.contains("grid-cell-input")) return;
    const cell = e.target.closest("[data-row][data-col]");
    if (!cell) return;

    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    const grid = state.grids[state.activeSlotIndex];
    const char = getSlotChar(state.activeSlotIndex);
    if (!char || !grid[row]) return;

    if (e.button === 0) {
      // Left click: place or clear
      e.preventDefault();
      const sel = state.paletteSelection;
      if (sel) {
        placeItem(grid, char, row, col, sel);
        isDragging = true;
        dragMode = "place";
      } else {
        clearCell(grid, row, col);
      }
      render();
    } else if (e.button === 2) {
      // Right click: erase
      e.preventDefault();
      clearCell(grid, row, col);
      isDragging = true;
      dragMode = "erase";
      render();
    }
  });

  // --- block context menu on grid ---
  container.addEventListener("contextmenu", (e) => {
    if (e.target.closest("[data-row][data-col]")) {
      e.preventDefault();
    }
  });

  // --- mousemove: drag-to-fill or drag-to-erase ---
  container.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    // Stop dragging if button was released (e.buttons: 1=left, 2=right)
    if (dragMode === "place" && !(e.buttons & 1)) { isDragging = false; dragMode = null; return; }
    if (dragMode === "erase" && !(e.buttons & 2)) { isDragging = false; dragMode = null; return; }

    const cell = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest("[data-row][data-col]");
    if (!cell) return;

    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    const grid = state.grids[state.activeSlotIndex];
    if (!grid[row]) return;

    if (dragMode === "erase") {
      clearCell(grid, row, col);
      render();
    } else if (dragMode === "place") {
      const char = getSlotChar(state.activeSlotIndex);
      const sel = state.paletteSelection;
      if (char && sel) {
        placeItem(grid, char, row, col, sel);
        render();
      }
    }
  });

  // --- mouseup: end drag ---
  document.addEventListener("mouseup", () => {
    isDragging = false;
    dragMode = null;
  });
}

/* ------------------------------------------------------------------ */
/*  updateGridDamage                                                   */
/* ------------------------------------------------------------------ */

/**
 * Update the damage column after a calculation pass.
 *
 * Called by team-app with an array of per-row results.  Each entry is
 * expected to have a `rowDamage` numeric property.
 *
 * @param {Array|null} rowResults - Array of `{ rowDamage: number }` or null.
 */
export function updateGridDamage(rowResults) {
  const cells = document.querySelectorAll(".grid-cell-damage");
  cells.forEach((cell, i) => {
    if (rowResults && rowResults[i]) {
      cell.textContent = rowResults[i].rowDamage.toFixed(0);
      cell.classList.add("has-damage");
    } else {
      cell.textContent = "-";
      cell.classList.remove("has-damage");
    }
  });
}
