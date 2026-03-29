/**
 * 可搜索下拉选择组件
 *
 * 用法：
 *   createSearchableSelect(containerEl, {
 *     options: [{ value: "id", label: "显示名称" }, ...],
 *     value: "当前选中值",
 *     placeholder: "搜索...",
 *     emptyLabel: "-- 未选择 --",
 *     onChange: (value) => { ... }
 *   });
 */

/**
 * @param {HTMLElement} container - 要渲染到的容器元素
 * @param {Object} config
 *   - options: [{ value: string, label: string }]
 *   - value: string|null  当前选中值
 *   - placeholder: string  搜索框占位文字
 *   - emptyLabel: string   未选择时的显示文字
 *   - onChange: (value: string|null) => void
 */
export function createSearchableSelect(container, config) {
  const { options, value, placeholder = "搜索...", emptyLabel = "-- 未选择 --", onChange } = config;

  const selectedOpt = options.find((o) => o.value === value);
  const displayText = selectedOpt ? selectedOpt.label : emptyLabel;

  container.classList.add("ss-container");
  container.innerHTML = `
    <div class="ss-display" tabindex="0">${escHtml(displayText)}</div>
    <div class="ss-dropdown ss-hidden">
      <input class="ss-input" type="text" placeholder="${escHtml(placeholder)}">
      <div class="ss-options"></div>
    </div>
  `;

  const display = container.querySelector(".ss-display");
  const dropdown = container.querySelector(".ss-dropdown");
  const input = container.querySelector(".ss-input");
  const optionsEl = container.querySelector(".ss-options");

  let isOpen = false;

  function renderOptions(filter) {
    const query = (filter || "").toLowerCase();
    const filtered = query
      ? options.filter((o) => o.label.toLowerCase().includes(query))
      : options;

    let html = `<div class="ss-option${!value ? " ss-selected" : ""}" data-value="">${escHtml(emptyLabel)}</div>`;
    for (const opt of filtered) {
      const sel = opt.value === value ? " ss-selected" : "";
      html += `<div class="ss-option${sel}" data-value="${escHtml(opt.value)}">${escHtml(opt.label)}</div>`;
    }
    if (filtered.length === 0 && query) {
      html += '<div class="ss-no-match">无匹配结果</div>';
    }
    optionsEl.innerHTML = html;
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    dropdown.classList.remove("ss-hidden");
    input.value = "";
    renderOptions("");
    input.focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    dropdown.classList.add("ss-hidden");
  }

  function select(val) {
    close();
    const opt = options.find((o) => o.value === val);
    display.textContent = opt ? opt.label : emptyLabel;
    if (onChange) onChange(val || null);
  }

  // Events
  display.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isOpen) close(); else open();
  });

  display.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
  });

  input.addEventListener("input", () => {
    renderOptions(input.value);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  optionsEl.addEventListener("click", (e) => {
    const opt = e.target.closest(".ss-option");
    if (!opt) return;
    select(opt.dataset.value);
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    if (!container.contains(e.target)) close();
  });
}

function escHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
