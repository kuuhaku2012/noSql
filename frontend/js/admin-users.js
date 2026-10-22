(function (root) {
  "use strict";

  const roleLabels = {
    manager: "Quản trị viên",
    sales: "Nhân viên bán hàng",
    warehouse: "Nhân viên kho"
  };

  const permissions = [
    ["Quản trị viên", "Toàn bộ hệ thống, báo cáo, cấu hình và phân quyền nhân sự"],
    ["Nhân viên bán hàng", "Sản phẩm, đơn hàng, khách hàng, lịch hẹn, ưu đãi, giao hàng, đổi trả"],
    ["Nhân viên kho", "Xem sản phẩm, quản lý tồn kho, nhập hàng và giao hàng"]
  ];

  function mount(host, { api, currentUserId, escape, toast, onRendered }) {
    if (!host || !api) return;
    host._staffAbortController?.abort();
    const eventController = new AbortController();
    host._staffAbortController = eventController;
    const esc = escape || ((value) => String(value ?? ""));
    const notify = typeof toast === "function" ? toast : () => {};
    const filters = { q: "", role: "", page: 1, limit: 10 };
    let usersById = new Map();

    const options = (selected = "sales") => Object.entries(roleLabels)
      .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${esc(label)}</option>`).join("");

    function icon() {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M17 9h5m-2.5-2.5v5"/></svg>';
    }

    function createForm() {
      return `<section class="panel admin-staff-create" id="admin-form-create-user" tabindex="-1">
        <div class="admin-staff-section-title">
          <span class="admin-staff-icon" aria-hidden="true">${icon()}</span>
          <div><span class="eyebrow">CẤP TÀI KHOẢN</span><h2>Thêm nhân sự</h2>
            <p>Tạo tài khoản đăng nhập trang quản trị. Chỉ cấp vai trò đúng với công việc.</p></div>
        </div>
        <form data-staff-action="create" class="admin-staff-fields">
          <label class="field"><span>Họ và tên</span><input name="fullName" maxlength="160" autocomplete="name" required placeholder="Nhập tên nhân viên"></label>
          <label class="field"><span>Email đăng nhập</span><input name="email" type="email" maxlength="254" autocomplete="off" required placeholder="nhanvien@example.com"></label>
          <label class="field"><span>Mật khẩu ban đầu</span><input name="password" type="password" minlength="6" maxlength="200" autocomplete="new-password" required placeholder="Tối thiểu 6 ký tự"></label>
          <label class="field"><span>Số điện thoại (tùy chọn)</span><input name="phone" type="tel" maxlength="30" autocomplete="off" placeholder="Số điện thoại liên hệ"></label>
          <label class="field"><span>Vai trò</span><select name="role" required>${options()}</select></label>
          <div class="admin-staff-submit"><p class="form-message" role="status" aria-live="polite"></p>
            <button type="submit" class="btn">Tạo tài khoản nhân viên</button></div>
        </form>
      </section>`;
    }

    function filtersForm() {
      return `<form class="admin-staff-filters" data-staff-filter role="search">
        <label class="field"><span>Tìm nhân sự</span><input type="search" name="q" maxlength="100" value="${esc(filters.q)}" placeholder="Tên hoặc email"></label>
        <label class="field"><span>Lọc vai trò</span><select name="role">
          <option value="">Tất cả vai trò</option>
          ${Object.entries(roleLabels).map(([key, label]) => `<option value="${key}" ${filters.role === key ? "selected" : ""}>${esc(label)}</option>`).join("")}
        </select></label>
        <button type="submit" class="outline">Áp dụng</button>
      </form>`;
    }

    function staffTable(items) {
      if (!items.length) return '<p class="admin-staff-empty">Không có nhân sự phù hợp với bộ lọc hiện tại.</p>';
      return `<div class="table-wrap admin-staff-table"><table>
        <thead><tr><th>Nhân sự</th><th>Vai trò</th><th>Trạng thái</th><th>Ngày tạo</th><th>Thao tác</th></tr></thead>
        <tbody>${items.map((user) => {
          const userId = String(user.id || "");
          const self = userId === currentUserId;
          const active = user.isActive === true;
          const initials = String(user.fullName || user.email || "?").trim().slice(0, 1).toUpperCase();
          const date = user.createdAt ? new Date(user.createdAt) : null;
          const createdAt = date && Number.isFinite(date.getTime()) ? date.toLocaleDateString("vi-VN") : "—";
          return `<tr>
            <td><div class="admin-staff-person"><span class="admin-staff-avatar" aria-hidden="true">${esc(initials)}</span>
              <div><strong>${esc(user.fullName || "Chưa có tên")}${self ? ' <span class="admin-staff-self">(Bạn)</span>' : ""}</strong>
                <small>${esc(user.email || "")}</small>${user.phone ? `<small>${esc(user.phone)}</small>` : ""}</div></div></td>
            <td><span class="admin-staff-role admin-staff-role-${esc(user.role)}">${esc(roleLabels[user.role] || user.role)}</span></td>
            <td><span class="admin-staff-state ${active ? "is-active" : "is-inactive"}">${active ? "Đang hoạt động" : "Đã vô hiệu hóa"}</span></td>
            <td>${esc(createdAt)}</td>
            <td><div class="admin-staff-actions">
              <button class="outline" type="button" data-staff-edit="${esc(userId)}" aria-label="Sửa quyền và thông tin ${esc(user.fullName)}">Chỉnh sửa</button>
              ${self ? "" : `<button class="outline ${active ? "danger" : ""}" type="button" data-staff-toggle="${esc(userId)}">${active ? "Khóa" : "Mở lại"}</button>`}
            </div></td>
          </tr>`;
        }).join("")}</tbody></table></div>`;
    }

    function pagination(page, totalPages, total) {
      if (totalPages <= 1) return "";
      return `<nav class="admin-staff-pagination" aria-label="Trang danh sách nhân sự">
        <span>Trang ${page}/${totalPages} · ${total} nhân sự</span>
        <div><button type="button" class="outline" data-staff-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>← Trước</button>
        <button type="button" class="outline" data-staff-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>Sau →</button></div>
      </nav>`;
    }

    function dialog() {
      return `<dialog class="admin-staff-dialog" id="admin-staff-editor" aria-labelledby="staff-editor-title">
        <form data-staff-action="update">
          <div class="admin-staff-dialog-head">
            <div class="admin-staff-dialog-title"><span class="admin-staff-dialog-icon" aria-hidden="true">${icon()}</span><div><span class="eyebrow">CẬP NHẬT NHÂN SỰ</span><h2 id="staff-editor-title">Thông tin & phân quyền</h2>
              <p id="staff-editor-description">Thay đổi vai trò hoặc mật khẩu sẽ yêu cầu nhân viên đăng nhập lại.</p></div></div>
            <button type="button" class="admin-staff-close" data-staff-close aria-label="Đóng">×</button>
          </div>
          <section class="admin-staff-dialog-section" aria-labelledby="staff-profile-heading">
            <div class="admin-staff-dialog-section-head"><span id="staff-profile-heading">Hồ sơ nhân viên</span><small>Thông tin dùng để nhận diện và liên hệ.</small></div>
            <div class="admin-staff-fields admin-staff-dialog-fields">
              <label class="field"><span>Họ và tên</span><input name="fullName" maxlength="160" required></label>
              <label class="field"><span>Email đăng nhập</span><input name="email" type="email" maxlength="254" required></label>
              <label class="field"><span>Số điện thoại</span><input name="phone" type="tel" maxlength="30"></label>
              <label class="field"><span>Vai trò</span><select name="role" required>${options()}</select><small class="admin-staff-self-note" hidden>Không thể tự hạ quyền quản trị của chính mình.</small></label>
            </div>
          </section>
          <section class="admin-staff-dialog-section admin-staff-security-section" aria-labelledby="staff-security-heading">
            <div class="admin-staff-dialog-section-head"><span id="staff-security-heading">Bảo mật tài khoản</span><small>Chỉ điền khi cần đặt lại mật khẩu.</small></div>
            <label class="field admin-staff-wide"><span>Đặt mật khẩu mới <em>(tùy chọn)</em></span><input name="password" type="password" minlength="6" maxlength="200" autocomplete="new-password" placeholder="Để trống nếu không thay đổi"><small>Nhân viên sẽ đăng nhập lại sau khi mật khẩu được thay đổi.</small></label>
          </section>
          <div class="admin-staff-dialog-footer">
            <p class="form-message" role="status" aria-live="polite"></p>
            <div class="admin-staff-dialog-actions"><button class="outline" type="button" data-staff-close>Hủy</button><button class="btn" type="submit"><span aria-hidden="true">✓</span>Lưu thay đổi</button></div>
          </div>
        </form>
      </dialog>`;
    }

    async function render() {
      host.innerHTML = '<div class="state state-loading" role="status"><b>Đang tải nhân sự…</b></div>';
      try {
        const response = await api.list({ staff: "true", ...filters });
        const items = Array.isArray(response?.data) ? response.data : [];
        const meta = response?.pagination || {};
        const total = Number(meta.total ?? items.length);
        const page = Number(meta.page ?? filters.page);
        const totalPages = Number(meta.totalPages ?? 1);
        usersById = new Map(items.map((user) => [String(user.id), user]));
        host.innerHTML = `<div class="admin-staff-workspace">
          <section class="panel admin-staff-intro"><div class="admin-staff-intro-title"><span class="eyebrow">QUẢN TRỊ TRUY CẬP</span>
            <h2>Nhân sự & phân quyền</h2><p>Quyền được áp dụng ở máy chủ theo vai trò. Mọi thay đổi có hiệu lực với phiên đăng nhập của nhân viên.</p></div>
            <span class="admin-staff-intro-count">${total} nhân sự</span></section>
          ${createForm()}
          <section class="panel admin-staff-list">
            <div class="admin-staff-section-title"><span class="admin-staff-icon" aria-hidden="true">${icon()}</span>
              <div><span class="eyebrow">TÀI KHOẢN NỘI BỘ</span><h2>Danh sách nhân sự</h2><p>Tra cứu, điều chỉnh quyền và trạng thái truy cập.</p></div></div>
            ${filtersForm()}${staffTable(items)}${pagination(page, totalPages, total)}
          </section>
          <section class="panel admin-staff-permissions"><div class="admin-staff-section-title"><span class="admin-staff-icon" aria-hidden="true">${icon()}</span>
              <div><span class="eyebrow">PHẠM VI TRUY CẬP</span><h2>Quyền theo vai trò</h2><p>Quyền truy cập được kiểm tra tại API, kể cả khi người dùng truy cập trực tiếp bằng liên kết.</p></div></div>
            <div class="admin-staff-permission-grid">${permissions.map(([name, description]) => `<article><strong>${esc(name)}</strong><p>${esc(description)}</p></article>`).join("")}</div>
          </section>
        </div>${dialog()}`;
      } catch (error) {
        const message = root.MB?.errorMessage ? root.MB.errorMessage(error) : error.message;
        host.innerHTML = `<div class="state state-error" role="alert"><b>Không tải được danh sách nhân sự</b><p>${esc(message)}</p>
          <button type="button" class="outline" data-staff-retry>Thử lại</button></div>`;
      }
      if (typeof onRendered === "function") onRendered();
    }

    function openEditor(userId) {
      const user = usersById.get(userId);
      const editor = host.querySelector("#admin-staff-editor");
      if (!user || !editor) return;
      const form = editor.querySelector("form");
      form.dataset.id = userId;
      form.elements.fullName.value = user.fullName || "";
      form.elements.email.value = user.email || "";
      form.elements.phone.value = user.phone || "";
      form.elements.role.value = roleLabels[user.role] ? user.role : "sales";
      form.elements.password.value = "";
      const self = userId === currentUserId;
      form.elements.role.disabled = self;
      editor.querySelector(".admin-staff-self-note").hidden = !self;
      form.querySelector(".form-message").textContent = "";
      if (typeof editor.showModal === "function") editor.showModal();
      else editor.setAttribute("open", "");
    }

    host.addEventListener("submit", async (event) => {
      const filter = event.target.closest("[data-staff-filter]");
      if (filter) {
        event.preventDefault();
        const values = new FormData(filter);
        filters.q = String(values.get("q") || "").trim().slice(0, 100);
        filters.role = String(values.get("role") || "");
        filters.page = 1;
        await render();
        return;
      }
      const form = event.target.closest("[data-staff-action]");
      if (!form) return;
      event.preventDefault();
      const action = form.dataset.staffAction;
      const values = Object.fromEntries(new FormData(form).entries());
      const button = form.querySelector('[type="submit"]');
      const message = form.querySelector(".form-message");
      if (button) button.disabled = true;
      if (message) message.textContent = "Đang lưu thay đổi…";
      try {
        const payload = {
          fullName: String(values.fullName || "").trim(),
          email: String(values.email || "").trim(),
          phone: String(values.phone || "").trim()
        };
        if (values.role) payload.role = values.role;
        if (values.password) payload.password = values.password;
        if (action === "create") {
          if (!payload.password) throw new Error("Vui lòng nhập mật khẩu ban đầu.");
          await api.create(payload);
          filters.page = 1;
        } else {
          await api.update(form.dataset.id, payload);
          form.closest("dialog")?.close?.();
        }
        notify(action === "create" ? "Đã tạo tài khoản nhân viên." : "Đã cập nhật nhân sự.", "success");
        await render();
      } catch (error) {
        const text = root.MB?.errorMessage ? root.MB.errorMessage(error) : error.message;
        if (message) message.textContent = text;
        notify(text, "error");
      } finally {
        if (button) button.disabled = false;
      }
    }, { signal: eventController.signal });

    host.addEventListener("click", async (event) => {
      if (event.target.closest("[data-staff-retry]")) { await render(); return; }
      const edit = event.target.closest("[data-staff-edit]");
      if (edit) { openEditor(edit.dataset.staffEdit); return; }
      const close = event.target.closest("[data-staff-close]");
      if (close) {
        const modal = close.closest("dialog");
        if (typeof modal?.close === "function") modal.close();
        else modal?.removeAttribute("open");
        return;
      }
      const pageButton = event.target.closest("[data-staff-page]");
      if (pageButton && !pageButton.disabled) {
        filters.page = Math.max(1, Number(pageButton.dataset.staffPage) || 1);
        await render();
        return;
      }
      const toggle = event.target.closest("[data-staff-toggle]");
      if (!toggle) return;
      const user = usersById.get(toggle.dataset.staffToggle);
      if (!user || String(user.id) === currentUserId) return;
      const isActive = user.isActive === true;
      const description = isActive
        ? `Khóa tài khoản ${user.fullName || user.email}? Nhân viên sẽ bị đăng xuất và không thể truy cập admin.`
        : `Mở lại tài khoản ${user.fullName || user.email}?`;
      if (typeof root.confirm === "function" && !root.confirm(description)) return;
      toggle.disabled = true;
      try {
        await api.update(String(user.id), { isActive: !isActive });
        notify(isActive ? "Đã khóa tài khoản." : "Đã mở lại tài khoản.", "success");
        await render();
      } catch (error) {
        notify(root.MB?.errorMessage ? root.MB.errorMessage(error) : error.message, "error");
        toggle.disabled = false;
      }
    }, { signal: eventController.signal });

    return render();
  }

  root.MBAdminUsers = { mount };
})(typeof globalThis !== "undefined" ? globalThis : this);
