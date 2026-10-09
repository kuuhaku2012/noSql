(function (root, factory) {
  const page = factory(root);
  if (typeof module === "object" && module.exports) module.exports = page;
  if (root) root.MBWarrantyPage = page;
  if (root?.document) root.document.addEventListener("DOMContentLoaded", () => page.bind());
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  const statusLabels = { pending: "Chờ xác nhận", confirmed: "Đã xác nhận", processing: "Đang xử lý", shipped: "Đang giao", delivered: "Đã giao", completed: "Hoàn tất", cancelled: "Đã hủy", returned: "Đã trả" };
  const esc = (value) => root.MB?.escape ? root.MB.escape(value) : String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const unwrap = (response) => response?.data ?? response;
  const list = (response) => {
    const value = unwrap(response);
    return Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
  };
  function findOrderByCode(orders, code) {
    const normalized = String(code || "").trim().toLowerCase();
    if (!normalized) return null;
    return (orders || []).find((order) => String(order?.orderCode || order?.code || "").trim().toLowerCase() === normalized) || null;
  }
  function supportGuide(status) {
    const guides = {
      pending: { title: "Đơn đang chờ xác nhận", description: "Bạn có thể liên hệ tư vấn để cập nhật thông tin giao hàng hoặc hỗ trợ đổi sản phẩm trước khi cửa hàng xác nhận và xử lý đơn." },
      delivered: { title: "Hướng dẫn đổi trả trong thời hạn hỗ trợ", description: "Chuẩn bị mã đơn, sản phẩm và lý do đổi trả. Vào chi tiết đơn hàng để gửi yêu cầu đổi trả cho cửa hàng." },
      completed: { title: "Cần hỗ trợ sau khi hoàn tất?", description: "Maison Belle sẽ tiếp nhận lịch sử đơn hàng và hướng dẫn theo chính sách của từng sản phẩm." },
      cancelled: { title: "Đơn đã được hủy", description: "Nếu trạng thái chưa đúng hoặc cần hỗ trợ khác, hãy đặt lịch để nhân viên kiểm tra cùng bạn." }
    };
    return guides[String(status || "").toLowerCase()] || { title: "Maison Belle sẵn sàng hỗ trợ", description: "Đặt lịch tư vấn để được kiểm tra đơn hàng và hướng dẫn đổi trả phù hợp." };
  }
  function renderOrderSummary(order) {
    const status = String(order?.orderStatus || order?.status || "").toLowerCase();
    const guide = supportGuide(status);
    const date = order?.createdAt ? new Date(order.createdAt).toLocaleDateString("vi-VN") : "—";
    const amount = root.MB?.money ? root.MB.money(order.finalAmount ?? order.totalAmount ?? order.total ?? 0) : String(order.finalAmount ?? 0);
    return `<article class="order-lookup-card"><div class="section-head"><div><span class="eyebrow">KẾT QUẢ TRA CỨU</span><h2>${esc(order.orderCode || order.code || "Đơn hàng")}</h2></div><span class="tag">${esc(statusLabels[status] || status || "Đang cập nhật")}</span></div><div class="lookup-facts"><span><small>Ngày đặt</small><b>${esc(date)}</b></span><span><small>Tổng tiền</small><b>${esc(amount)}</b></span><span><small>Người nhận</small><b>${esc(order.shippingAddress?.receiverName || order.customerName || "—")}</b></span></div><div class="lookup-guide"><b>${esc(guide.title)}</b><p>${esc(guide.description)}</p></div><a class="outline" href="account.html#appointments">ĐẶT LỊCH HỖ TRỢ</a></article>`;
  }
  function bind() {
    if (!root.document || !root.MBApi || root.document.body?.dataset.page !== "warranty") return;
    const form = root.document.querySelector("#order-lookup-form");
    const result = root.document.querySelector("#order-lookup-result");
    if (!form || !result) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("[type=submit]");
      const message = form.querySelector(".form-message");
      const code = new FormData(form).get("orderCode");
      button.disabled = true;
      if (message) message.textContent = "Đang tra cứu đơn hàng…";
      if (root.MB?.showState) root.MB.showState(result, "loading", "Đang tải thông tin đơn hàng…");
      try {
        await root.MBApi.auth.me();
        const order = findOrderByCode(list(await root.MBApi.orders.list({ page: 1, limit: 100 })), code);
        if (!order) {
          if (root.MB?.showState) root.MB.showState(result, "notFound", "Không tìm thấy mã đơn trong tài khoản hiện tại. Vui lòng đăng nhập đúng tài khoản đã đặt hàng.");
          return;
        }
        const detail = unwrap(await root.MBApi.orders.get(order.id || order._id)) || order;
        result.innerHTML = renderOrderSummary(detail);
        if (message) message.textContent = "Đã tìm thấy đơn hàng.";
      } catch (error) {
        const action = error.status === 401 ? '<a class="btn" href="account.html">ĐĂNG NHẬP</a>' : '<button class="outline" type="button" data-warranty-retry>Thử lại</button>';
        if (root.MB?.showState) root.MB.showState(result, error.status === 403 ? "forbidden" : "error", root.MB.errorMessage(error), action);
        else if (message) message.textContent = error.message;
      } finally { button.disabled = false; }
    });
    root.document.body.addEventListener("click", (event) => {
      if (event.target.closest("[data-warranty-retry]")) form.requestSubmit();
    });
  }
  return { findOrderByCode, supportGuide, renderOrderSummary, bind };
});
