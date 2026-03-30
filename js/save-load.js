/**
 * 配置导出/导入模块
 *
 * 将状态序列化为 base64 字符串，方便复制分享。
 * 提供 UI（导出按钮 + 导入弹窗）。
 */

// ===== 编解码 =====

function toBase64(obj) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(str) {
  const binary = atob(str.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}

// ===== UI =====

/**
 * 初始化导出/导入功能
 * @param {Object} config
 *   - containerId: string       放置按钮的容器 ID
 *   - exportFn: () => Object    返回要导出的状态对象
 *   - importFn: (data) => void  接收导入的状态对象并应用
 */
export function initSaveLoad(config) {
  const { containerId, exportFn, importFn } = config;
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <button class="sl-btn sl-export-btn">导出配置</button>
    <button class="sl-btn sl-import-btn">导入配置</button>
    <button class="sl-btn sl-file-export-btn">保存文件</button>
    <label class="sl-btn sl-file-import-label">读取文件<input type="file" accept=".json" class="sl-file-input" /></label>
  `;

  // 导出
  container.querySelector(".sl-export-btn").addEventListener("click", () => {
    try {
      const data = exportFn();
      const encoded = toBase64(data);
      navigator.clipboard.writeText(encoded).then(
        () => showToast("已复制到剪贴板"),
        () => showExportModal(encoded)
      );
    } catch (e) {
      showToast("导出失败: " + e.message);
    }
  });

  // 导入
  container.querySelector(".sl-import-btn").addEventListener("click", () => {
    showImportModal((text) => {
      try {
        const data = fromBase64(text);
        importFn(data);
        showToast("导入成功");
      } catch (e) {
        showToast("导入失败：数据格式错误");
      }
    });
  });

  // 保存文件
  container.querySelector(".sl-file-export-btn").addEventListener("click", async () => {
    try {
      const data = exportFn();
      const json = JSON.stringify(data, null, 2);
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: "damage-calc.json",
          types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        showToast("保存成功");
      } else {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "damage-calc.json";
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      if (e.name !== "AbortError") showToast("保存失败: " + e.message);
    }
  });

  // 读取文件
  container.querySelector(".sl-file-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        importFn(data);
        showToast("导入成功");
      } catch (err) {
        showToast("读取失败：文件格式错误");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });
}

// ===== Toast =====

function showToast(msg) {
  let toast = document.querySelector(".sl-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "sl-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("sl-toast-show");
  setTimeout(() => toast.classList.remove("sl-toast-show"), 2000);
}

// ===== 导出弹窗（clipboard 不可用时的 fallback）=====

function showExportModal(text) {
  closeModal();
  const overlay = createOverlay();
  overlay.innerHTML = `
    <div class="sl-modal">
      <h3>导出配置</h3>
      <p class="sl-hint">复制以下文本分享给他人：</p>
      <textarea class="sl-textarea" readonly>${text}</textarea>
      <div class="sl-modal-actions">
        <button class="sl-btn sl-close-btn">关闭</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const ta = overlay.querySelector(".sl-textarea");
  ta.focus();
  ta.select();
  overlay.querySelector(".sl-close-btn").onclick = closeModal;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
}

// ===== 导入弹窗 =====

function showImportModal(onConfirm) {
  closeModal();
  const overlay = createOverlay();
  overlay.innerHTML = `
    <div class="sl-modal">
      <h3>导入配置</h3>
      <p class="sl-hint">粘贴导出的配置文本：</p>
      <textarea class="sl-textarea" placeholder="在此粘贴..."></textarea>
      <div class="sl-modal-actions">
        <button class="sl-btn sl-confirm-btn">确认导入</button>
        <button class="sl-btn sl-close-btn">取消</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector(".sl-textarea").focus();
  overlay.querySelector(".sl-confirm-btn").onclick = () => {
    const text = overlay.querySelector(".sl-textarea").value;
    if (text.trim()) {
      closeModal();
      onConfirm(text);
    }
  };
  overlay.querySelector(".sl-close-btn").onclick = closeModal;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
}

function createOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "sl-overlay";
  overlay.id = "sl-overlay";
  return overlay;
}

function closeModal() {
  document.getElementById("sl-overlay")?.remove();
}
