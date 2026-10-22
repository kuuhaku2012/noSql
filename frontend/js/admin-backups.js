(function (root) {
  "use strict";

  function mount(host, { api, escape, toast }) {
    if (!host || !api) return;
    host._backupAbortController?.abort();
    const events = new AbortController();
    host._backupAbortController = events;
    const esc = escape || ((value) => String(value ?? ""));
    const notify = typeof toast === "function" ? toast : () => {};
    let savedCurrentBackup = false;
    let selectedFile = null;

    const formatSize = (value) => value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;

    function download(blob) {
      const url = URL.createObjectURL(blob);
      const link = root.document.createElement("a");
      link.href = url;
      link.download = `maison-belle-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      root.document.body.append(link);
      link.click();
      link.remove();
      root.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    async function createBackup(button) {
      if (button) button.disabled = true;
      try {
        const blob = await api.download();
        download(blob);
        savedCurrentBackup = true;
        const guard = host.querySelector("[data-backup-guard]");
        if (guard) guard.textContent = "Đã tải bản sao lưu hiện tại. Hãy giữ tệp này trước khi khôi phục.";
        updateRestoreButton();
        notify("Đã tạo và tải bản sao lưu MongoDB.", "success");
      } catch (error) {
        notify(root.MB?.errorMessage ? root.MB.errorMessage(error) : error.message, "error");
      } finally {
        if (button?.isConnected) button.disabled = false;
      }
    }

    function updateRestoreButton() {
      const button = host.querySelector("[data-backup-restore]");
      if (button) button.disabled = !selectedFile || !savedCurrentBackup;
    }

    async function render() {
      host.innerHTML = '<div class="state state-loading" role="status"><b>Đang đọc thông tin cơ sở dữ liệu…</b></div>';
      try {
        const response = await api.summary();
        const collections = Array.isArray(response?.data) ? response.data : [];
        const total = Number(response?.totalRecords || 0);
        host.innerHTML = `<div class="admin-backup-workspace">
          <section class="panel admin-backup-hero"><div><span class="eyebrow">BẢO TOÀN DỮ LIỆU</span><h2>Sao lưu & khôi phục</h2><p>Tải toàn bộ dữ liệu MongoDB thành một tệp JSON để lưu an toàn. Khi cần, dùng tệp đó để đưa cửa hàng về trạng thái tại thời điểm sao lưu.</p></div>
            <div class="admin-backup-total" aria-label="Tổng số dữ liệu"><span class="admin-backup-total-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/></svg></span><span class="admin-backup-total-copy"><small>TỔNG DỮ LIỆU</small><strong>${total.toLocaleString("vi-VN")}</strong><span>bản ghi · ${collections.length} bộ dữ liệu</span></span></div></section>
          <div class="admin-backup-grid">
            <section class="panel admin-backup-card"><div class="admin-backup-card-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 16v4h16v-4"/></svg></div><span class="eyebrow">TẢI DỮ LIỆU</span><h3>Tạo bản sao lưu</h3><p>Tệp bao gồm tài khoản, sản phẩm, đơn hàng, tồn kho, cấu hình và các dữ liệu đang có trong cơ sở dữ liệu.</p><button type="button" class="btn" data-backup-download>Tải bản sao lưu</button></section>
            <section class="panel admin-backup-card admin-backup-restore"><div class="admin-backup-card-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21V9m5 5-5-5-5 5"/><path d="M4 8V4h16v4"/><path d="M17 17a7 7 0 1 1-10 0"/></svg></div><span class="eyebrow">ĐƯA DỮ LIỆU TRỞ LẠI</span><h3>Khôi phục từ tệp</h3><p>Khôi phục sẽ thay thế dữ liệu hiện tại trong các bộ dữ liệu của cửa hàng. Tải bản hiện tại trước để có đường lui.</p>
              <label class="admin-backup-file"><span>Chọn tệp sao lưu Maison Belle</span><input type="file" accept=".json,application/json" data-backup-file></label><p class="admin-backup-file-info" data-backup-file-info role="status">Chưa chọn tệp.</p>
              <p class="admin-backup-guard" data-backup-guard role="status">Trước khi khôi phục, tải và lưu bản sao lưu hiện tại.</p><button type="button" class="btn danger" data-backup-restore disabled>Khôi phục dữ liệu</button></section>
          </div>
          <section class="panel admin-backup-collections"><div class="admin-backup-section-head"><div><span class="eyebrow">PHẠM VI SAO LƯU</span><h3>Dữ liệu trong cơ sở dữ liệu</h3><p>${total.toLocaleString("vi-VN")} bản ghi ở ${collections.length} bộ dữ liệu.</p></div><button type="button" class="outline" data-backup-refresh>Làm mới</button></div>
            <div class="admin-backup-collection-list">${collections.length ? collections.map((item) => `<div><span>${esc(item.name)}</span><strong>${Number(item.records).toLocaleString("vi-VN")} bản ghi</strong></div>`).join("") : '<p class="admin-backup-empty">Chưa có dữ liệu để sao lưu.</p>'}</div>
          </section>
          <p class="admin-backup-note">Tệp sao lưu có thông tin tài khoản và dữ liệu khách hàng. Hãy cất giữ ở nơi chỉ quản trị viên được truy cập.</p>
        </div>`;
      } catch (error) {
        const message = root.MB?.errorMessage ? root.MB.errorMessage(error) : error.message;
        host.innerHTML = `<div class="state state-error" role="alert"><b>Không tải được thông tin sao lưu</b><p>${esc(message)}</p><button type="button" class="outline" data-backup-refresh>Thử lại</button></div>`;
      }
    }

    host.addEventListener("change", async (event) => {
      const input = event.target.closest("[data-backup-file]");
      if (!input) return;
      selectedFile = input.files?.[0] || null;
      const info = host.querySelector("[data-backup-file-info]");
      if (!selectedFile) {
        if (info) info.textContent = "Chưa chọn tệp.";
        updateRestoreButton();
        return;
      }
      if (selectedFile.size > 50 * 1024 * 1024) {
        selectedFile = null;
        input.value = "";
        if (info) info.textContent = "Tệp vượt quá giới hạn 50 MB.";
        updateRestoreButton();
        return;
      }
      try {
        const backup = JSON.parse(await selectedFile.text());
        const docs = backup?.collections && Object.values(backup.collections).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0);
        const version = Number(backup?.version?.$numberInt ?? backup?.version);
        const valid = backup?.format === "maison-belle-mongodb-backup" && version === 1 && backup.fullSnapshot === true && Number.isFinite(docs);
        if (!valid) throw new Error("Đây không phải tệp sao lưu đầy đủ của Maison Belle.");
        if (info) info.textContent = `${selectedFile.name} · ${formatSize(selectedFile.size)} · ${docs.toLocaleString("vi-VN")} bản ghi`;
      } catch (error) {
        selectedFile = null;
        input.value = "";
        if (info) info.textContent = error.message || "Không đọc được tệp sao lưu.";
      }
      updateRestoreButton();
    }, { signal: events.signal });

    host.addEventListener("click", async (event) => {
      const refresh = event.target.closest("[data-backup-refresh]");
      if (refresh) { await render(); return; }
      const exportButton = event.target.closest("[data-backup-download]");
      if (exportButton) { await createBackup(exportButton); return; }
      const restoreButton = event.target.closest("[data-backup-restore]");
      if (!restoreButton || restoreButton.disabled || !selectedFile) return;
      const message = `Khôi phục ${selectedFile.name} sẽ thay thế toàn bộ dữ liệu hiện tại của cửa hàng. Hãy chắc chắn bạn đã tải bản sao lưu hiện tại. Tiếp tục?`;
      if (!root.confirm(message)) return;
      restoreButton.disabled = true;
      restoreButton.textContent = "Đang khôi phục…";
      try {
        const result = await api.restore(await selectedFile.arrayBuffer());
        const count = Number(result?.data?.totalRecords || 0);
        savedCurrentBackup = false;
        notify(`Đã khôi phục ${count.toLocaleString("vi-VN")} bản ghi. Hãy đăng nhập lại nếu phiên hiện tại bị thay đổi.`, "success");
        await render();
      } catch (error) {
        notify(root.MB?.errorMessage ? root.MB.errorMessage(error) : error.message, "error");
        restoreButton.disabled = false;
        restoreButton.textContent = "Khôi phục dữ liệu";
      }
    }, { signal: events.signal });

    return render();
  }

  root.MBAdminBackups = { mount };
})(typeof globalThis !== "undefined" ? globalThis : this);
