/**
 * team-grid.js — 战斗表格渲染与拖拽交互模块
 *
 * 渲染类似 Excel 的表格，用户可将技能和 buff 放入伤害循环中。
 * 支持点击放置和拖拽填充，面板选中项保存在 `state.paletteSelection` 中。
 */

import { state, render, renderResult, getSlotChar, findBuffById } from "./team-app.js";
import { genericSkills } from "./generic-skills.js";

/* ------------------------------------------------------------------ */
/*  内部状态                                                            */
/* ------------------------------------------------------------------ */

let isDragging = false;
let dragMode = null; // "place" | "erase"

/* ------------------------------------------------------------------ */
/*  格子辅助函数                                                        */
/* ------------------------------------------------------------------ */

/**
 * 将当前面板选中项放入表格格子。
 *
 * @param {Array}  grid      - 当前槽位的表格数组。
 * @param {Object} char      - 当前槽位的角色对象。
 * @param {number} row       - 行索引。
 * @param {number} col       - 列索引（0 = 技能，1 = 次数，2+ = buff）。
 * @param {Object} selection - `{ type: "skill"|"buff", id }`。
 */
function placeItem(grid, char, row, col, selection) {
  if (col === 0 && selection.type === "skill") {
    // 放置技能到技能列
    grid[row].skillIndex = selection.id;
  } else if (col >= 2 && selection.type === "buff") {
    // 放置 buff 到 buff 列
    const buffCol = col - 2;
    // 按需扩展 buffCells
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
  // 列 1（次数）不是有效的放置目标
}

/**
 * 清除单个表格格子的内容。
 *
 * @param {Array}  grid - 当前槽位的表格数组。
 * @param {number} row  - 行索引。
 * @param {number} col  - 列索引。
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
/*  renderGrid — 渲染表格                                               */
/* ------------------------------------------------------------------ */

/**
 * 渲染当前活动槽位的战斗表格。
 *
 * 读取 `state.grids[state.activeSlotIndex]`，将生成的 HTML 写入
 * `#battle-grid` 容器。同时绑定次数输入框和增删行列按钮的事件。
 */
export function renderGrid() {
  const el = document.getElementById("battle-grid");
  const grid = state.grids[state.activeSlotIndex];
  const char = getSlotChar(state.activeSlotIndex);

  if (!char) {
    el.innerHTML = '<p class="empty">请先选择角色</p>';
    return;
  }

  // 确定 buff 列数（所有行中 buffCells 的最大长度，最少 3 列）
  const numBuffCols = Math.max(3, ...grid.map((r) => r.buffCells.length));

  let html = '<table class="grid-table">';

  // ---- 表头行 ----
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

  // ---- 数据行 ----
  html += "<tbody>";

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    html += '<tr class="grid-row">';

    // 技能格（列 0）
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

    // 次数格（列 1）
    html += '<td class="grid-cell grid-cell-count">';
    html += `<input type="number" class="grid-count-input" min="1" value="${row.count}" data-row="${r}">`;
    html += "</td>";

    // Buff 格（列 2+）
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

    // 添加列占位符
    html += '<td class="grid-cell-placeholder"></td>';

    // 行伤害显示
    html += `<td class="grid-cell grid-cell-damage" data-row="${r}">-</td>`;

    // 删除行按钮
    html += `<td class="grid-cell-action"><button class="grid-remove-row-btn" data-row="${r}" title="删除行">×</button></td>`;

    html += "</tr>";
  }

  // 添加行按钮（跨所有列）
  html += '<tr><td colspan="' + (numBuffCols + 4) + '">';
  html += '<button class="grid-add-row-btn">+ 添加行</button>';
  html += "</td></tr>";

  html += "</tbody></table>";
  el.innerHTML = html;

  // ---- 绑定次数输入框事件 ----
  el.querySelectorAll(".grid-count-input").forEach((input) => {
    input.addEventListener("change", () => {
      const r = parseInt(input.dataset.row);
      grid[r].count = Math.max(1, parseInt(input.value) || 1);
      render();
    });
  });

  // ---- 绑定添加行按钮 ----
  el.querySelector(".grid-add-row-btn")?.addEventListener("click", () => {
    const cols = Math.max(3, ...grid.map((r) => r.buffCells.length));
    grid.push({
      skillIndex: null,
      count: 1,
      buffCells: Array(cols).fill(null),
    });
    render();
  });

  // ---- 绑定添加列按钮 ----
  el.querySelector(".grid-add-col-btn")?.addEventListener("click", () => {
    for (const row of grid) {
      row.buffCells.push(null);
    }
    render();
  });

  // ---- 绑定删除列按钮 ----
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

  // ---- 绑定删除行按钮 ----
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

  // ---- 顶部镜像滚动条 ----
  const wrapper = el.closest(".grid-wrapper");
  if (wrapper) {
    let topBar = wrapper.querySelector(".grid-scroll-top");
    if (!topBar) {
      topBar = document.createElement("div");
      topBar.className = "grid-scroll-top";
      const inner = document.createElement("div");
      inner.className = "grid-scroll-top-inner";
      topBar.appendChild(inner);
      wrapper.insertBefore(topBar, el);
    }
    const table = el.querySelector(".grid-table");
    const inner = topBar.querySelector(".grid-scroll-top-inner");
    inner.style.width = table ? table.scrollWidth + "px" : "100%";
    let syncing = false;
    topBar.onscroll = () => { if (!syncing) { syncing = true; wrapper.scrollLeft = topBar.scrollLeft; syncing = false; } };
    wrapper.onscroll = () => { if (!syncing) { syncing = true; topBar.scrollLeft = wrapper.scrollLeft; syncing = false; } };
  }
}

/* ------------------------------------------------------------------ */
/*  initGridEvents — 初始化表格事件                                      */
/* ------------------------------------------------------------------ */

/**
 * 在表格容器上设置 mousedown / mousemove / mouseup 事件，
 * 实现点击放置和拖拽填充交互。
 *
 * - 当面板有选中项（`state.paletteSelection`）时，点击或拖拽格子会放置该项。
 * - 当没有选中项时，点击已填充的格子会清除它。
 *
 * 启动时调用一次即可。
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
      // 左键：放置或清除
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
      // 右键：清除
      e.preventDefault();
      clearCell(grid, row, col);
      isDragging = true;
      dragMode = "erase";
      render();
    }
  });

  // --- 禁用表格上的右键菜单 ---
  container.addEventListener("contextmenu", (e) => {
    if (e.target.closest("[data-row][data-col]")) {
      e.preventDefault();
    }
  });

  // --- 鼠标移动：拖拽填充或拖拽清除 ---
  container.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    // 如果按键已松开则停止拖拽（e.buttons: 1=左键, 2=右键）
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

  // --- 鼠标松开：结束拖拽 ---
  document.addEventListener("mouseup", () => {
    isDragging = false;
    dragMode = null;
  });
}

/* ------------------------------------------------------------------ */
/*  updateGridDamage — 更新伤害列                                       */
/* ------------------------------------------------------------------ */

/**
 * 计算完成后更新表格的伤害列。
 *
 * 由 team-app 调用，传入每行的计算结果数组。
 * 每个条目应包含 `rowDamage` 数值属性。
 *
 * @param {Array|null} rowResults - `{ rowDamage: number }` 数组或 null。
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
