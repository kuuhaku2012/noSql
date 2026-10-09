(function () {
  const host = document.querySelector("#consultation-content");
  if (!host) return;

  const esc = MB.escape;
  const data = (response) => MBApi.data(response);
  const rows = (response) => {
    const value = data(response);
    return Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
  };
  const pad = (value) => String(value).padStart(2, "0");
  const today = () => {
    const date = new Date();
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  };
  const dateLabel = (value) => {
    const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return match[3] + "/" + match[2] + "/" + match[1];
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  };
  const timeLabel = (value) => {
    const match = String(value ?? "").match(/(\d{1,2}):(\d{2})/);
    return match ? pad(match[1]) + ":" + match[2] : "—";
  };
  const statusLabel = (value) => ({ requested: "Chờ xác nhận", confirmed: "Đã xác nhận", completed: "Hoàn tất", cancelled: "Đã hủy" }[String(value || "").toLowerCase()] || value || "Đang cập nhật");
  const typeLabel = (value) => ({ skincare: "Chăm sóc da", skin: "Chăm sóc da", makeup: "Trang điểm", product: "Tư vấn sản phẩm" }[String(value || "").toLowerCase()] || value || "Tư vấn cá nhân");

  function appointmentList(appointments) {
    if (!appointments.length) return '<div class="consultation-empty"><span class="consultation-empty-icon" aria-hidden="true">♡</span><b>Bạn chưa có lịch hẹn</b><p>Chọn ngày và khung giờ phù hợp để gửi yêu cầu tư vấn đầu tiên.</p></div>';
    const body = appointments.map((item) => {
      const status = String(item.status || "requested").toLowerCase();
      const id = item.id || item._id;
      return '<tr><td><strong>' + esc(dateLabel(item.appointmentDate || item.date)) + '</strong><small>' + esc(timeLabel(item.startTime)) + ' – ' + esc(timeLabel(item.endTime)) + '</small></td><td>' + esc(typeLabel(item.consultationType)) + '</td><td><span class="consultation-status status-' + esc(status) + '">' + esc(statusLabel(status)) + '</span></td><td>' + (status === "requested" ? '<button class="textlink" type="button" data-cancel-appointment="' + esc(id) + '">Hủy lịch</button>' : "—") + '</td></tr>';
    }).join("");
    return '<div class="table-wrap consultation-table"><table><thead><tr><th>Ngày & giờ</th><th>Nội dung</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function render(appointments) {
    host.innerHTML = '<section class="account-card consultation-booking"><header class="consultation-card-heading"><span class="consultation-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-14 5h3m3 0h3"/></svg></span><div><span class="eyebrow">ĐẶT LỊCH CÁ NHÂN</span><h2>Chọn thời gian phù hợp</h2><p>Gửi yêu cầu để đội ngũ tư vấn xác nhận lịch hẹn với bạn.</p></div></header>' +
      '<form id="appointment-form" class="form-grid consultation-form"><label class="field">Ngày hẹn<input type="date" name="appointmentDate" required min="' + today() + '"></label><label class="field">Bắt đầu<input type="time" name="startTime" required></label><label class="field">Kết thúc<input type="time" name="endTime" required></label><label class="field">Nội dung tư vấn<select name="consultationType" required><option value="skincare">Chăm sóc da</option><option value="makeup">Trang điểm</option><option value="product">Tư vấn sản phẩm</option></select></label><label class="field consultation-note">Ghi chú <span class="optional">(không bắt buộc)</span><textarea name="customerNote" rows="3" maxlength="1000" placeholder="Loại da, mối quan tâm hoặc sản phẩm cần tư vấn"></textarea></label><div class="consultation-submit"><button class="btn" type="submit"><span>GỬI YÊU CẦU ĐẶT LỊCH</span><span aria-hidden="true">→</span></button><p class="form-message" role="status" aria-live="polite"></p></div></form>' +
      '<div class="consultation-footnote"><span aria-hidden="true">✧</span> Lịch hẹn có hiệu lực sau khi cửa hàng xác nhận.</div></section>' +
      '<section class="account-card consultation-history"><header class="consultation-history-heading"><div><span class="eyebrow">LỊCH SỬ CỦA BẠN</span><h2>Lịch hẹn đã đặt</h2></div><span class="consultation-count">' + appointments.length + ' lịch hẹn</span></header>' + appointmentList(appointments) + '</section>';
  }

  async function load() {
    MB.showState(host, "loading", "Đang tải lịch hẹn…");
    try {
      await MBApi.auth.me();
      render(rows(await MBApi.appointments.list({ page: 1, limit: 50 })));
    } catch (error) {
      if (error.status === 401) {
        host.innerHTML = '<section class="account-card consultation-auth"><span class="consultation-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18"/></svg></span><span class="eyebrow">CHĂM SÓC CÁ NHÂN</span><h2>Đăng nhập để đặt lịch</h2><p>Đăng nhập hoặc tạo tài khoản để gửi yêu cầu và theo dõi lịch hẹn của bạn.</p><a class="btn" href="account.html?next=consultation">ĐĂNG NHẬP / TẠO TÀI KHOẢN</a></section>';
      } else {
        MB.showState(host, error.status === 403 ? "forbidden" : "error", MB.errorMessage(error), '<button class="outline" type="button" data-retry>Thử lại</button>');
      }
    }
  }

  host.addEventListener("submit", async (event) => {
    const form = event.target.closest("#appointment-form");
    if (!form) return;
    event.preventDefault();
    const message = form.querySelector(".form-message");
    const button = form.querySelector('[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.appointmentDate < today()) { message.textContent = "Ngày hẹn không thể ở trong quá khứ."; return; }
    if (values.endTime <= values.startTime) { message.textContent = "Giờ kết thúc phải sau giờ bắt đầu."; return; }
    button.disabled = true;
    message.textContent = "Đang kiểm tra khung giờ…";
    try {
      const availability = data(await MBApi.appointments.availability({ appointmentDate: values.appointmentDate, startTime: values.startTime, endTime: values.endTime })) || {};
      if (!availability.available) throw new Error("Khung giờ vừa chọn đã có lịch. Vui lòng chọn thời gian khác.");
      message.textContent = "Đang gửi yêu cầu…";
      await MBApi.appointments.create(values);
      await load();
      const success = host.querySelector("#appointment-form .form-message");
      if (success) success.textContent = "Đã gửi yêu cầu. Lịch có hiệu lực sau khi cửa hàng xác nhận.";
      MB.toast("Yêu cầu đặt lịch đã được gửi.", "success");
    } catch (error) {
      message.textContent = MB.errorMessage(error);
    } finally {
      button.disabled = false;
    }
  });

  host.addEventListener("click", async (event) => {
    if (event.target.closest("[data-retry]")) { await load(); return; }
    const cancel = event.target.closest("[data-cancel-appointment]");
    if (!cancel || !window.confirm("Bạn muốn hủy yêu cầu lịch hẹn này chứ?")) return;
    cancel.disabled = true;
    try {
      await MBApi.appointments.update(cancel.dataset.cancelAppointment, { status: "cancelled" });
      MB.toast("Lịch hẹn đã được hủy.", "success");
      await load();
    } catch (error) {
      MB.toast(MB.errorMessage(error), "error");
      cancel.disabled = false;
    }
  });

  document.addEventListener("DOMContentLoaded", load);
})();