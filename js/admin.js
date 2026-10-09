(function (root, factory) {
  const admin = factory(root);
  if (typeof module === "object" && module.exports) module.exports = admin;
  if (root && root.document) root.document.addEventListener("DOMContentLoaded", () => admin.bind());
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  const esc = (value) => root.MB?.escape ? root.MB.escape(value) : String(value ?? "");
  const roleViews = {
    manager: ["dashboard", "products", "orders", "customers", "appointments", "promotions", "inventory", "deliveries", "returns", "master-data"],
    sales: ["products", "orders", "customers", "appointments", "promotions", "deliveries", "returns"],
    warehouse: ["products", "inventory", "deliveries"]
  };
  const titles = {
    dashboard: "Tổng quan & Báo cáo", products: "Sản phẩm", orders: "Đơn hàng & hóa đơn", customers: "Khách hàng & hội viên",
    appointments: "Tư vấn & lịch hẹn", promotions: "Khuyến mãi & voucher", inventory: "Tồn kho & nhập hàng",
    deliveries: "Giao hàng", returns: "Đổi trả", "master-data": "Danh mục & thương hiệu"
  };
  const descriptions = {
    dashboard: "Theo dõi doanh thu, đơn hàng và hoạt động cửa hàng trong một nơi.",
    products: "Quản lý sản phẩm, phân loại, giá bán và trạng thái kinh doanh.",
    orders: "Theo dõi đơn hàng, thanh toán và cập nhật tiến độ xử lý.",
    customers: "Tra cứu hồ sơ khách hàng và quyền lợi hội viên.",
    appointments: "Điều phối lịch tư vấn và lưu kết quả chăm sóc.",
    promotions: "Tạo chương trình ưu đãi và theo dõi hiệu quả voucher.",
    inventory: "Kiểm soát lượng tồn, hàng đã giữ và phiếu nhập kho.",
    deliveries: "Theo dõi từng chặng giao hàng và mã vận đơn.",
    returns: "Tiếp nhận đổi trả, xác nhận hàng nhận và xử lý hoàn tiền.",
    "master-data": "Quản lý danh mục, thương hiệu và cửa hàng."
  };
  const statusLabels = {
    pending: "Chờ xác nhận", requested: "Chờ tiếp nhận", confirmed: "Đã xác nhận",
    processing: "Đang xử lý", shipped: "Đang giao", delivered: "Đã giao",
    completed: "Hoàn tất", cancelled: "Đã hủy", returned: "Đã trả hàng",
    approved: "Đã duyệt", rejected: "Từ chối", received: "Đã nhận hàng",
    refunded: "Đã hoàn tiền", exchanged: "Đã đổi hàng", ready: "Sẵn sàng giao",
    assigned: "Đã phân công", picked_up: "Đã lấy hàng", in_transit: "Đang vận chuyển",
    failed: "Giao thất bại", active: "Đang hoạt động", inactive: "Đã ẩn",
    bronze: "Đồng", silver: "Bạc", gold: "Vàng", platinum: "Bạch kim"
  };
  const statusTones = {
    pending: "warning", requested: "warning", ready: "warning",
    confirmed: "info", processing: "info", shipped: "info", assigned: "info", picked_up: "info", in_transit: "info",
    delivered: "success", completed: "success", approved: "success", refunded: "success", active: "success",
    cancelled: "danger", rejected: "danger", returned: "danger", failed: "danger", inactive: "neutral",
    received: "success", exchanged: "success", bronze: "neutral", silver: "info", gold: "warning", platinum: "success"
  };
  const statusLabel = (value) => statusLabels[String(value || "").toLowerCase()] || String(value || "—").replaceAll("_", " ");
  const statusTag = (value, label = statusLabel(value)) => `<span class="tag status-${statusTones[String(value || "").toLowerCase()] || "neutral"}">${esc(label)}</span>`;

  function pickRole(user = {}) {
    const role = user.role?.name || user.roleName || user.role || "";
    return String(role).toLowerCase();
  }
  function canAccess(role, view) { return (roleViews[String(role).toLowerCase()] || []).includes(view); }
  function defaultView(role, requested = "") {
    if (requested === "reports" && String(role).toLowerCase() === "manager") return "dashboard";
    if (requested === "reports") return "reports";
    if (titles[requested]) return requested;
    return role === "warehouse" ? "inventory" : role === "sales" ? "products" : "dashboard";
  }
  function reportFields(report, prefix = "") {
    if (!report || typeof report !== "object" || Array.isArray(report)) return [];
    return Object.entries(report).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return [[path, value]];
      return value && !Array.isArray(value) ? reportFields(value, path) : [];
    });
  }
  function formatReportDate(value) {
    const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : value ? String(value) : "—";
  }
  function reportSummaryEntries(report = {}) {
    const summary = report.summary && typeof report.summary === "object" ? report.summary : {};
    const known = [
      { key: "revenue", label: "Doanh thu", value: summary.revenue, money: true },
      { key: "orderCount", label: "Đơn hàng", value: summary.orderCount, money: false },
      { key: "itemCount", label: "Sản phẩm đã bán", value: summary.itemCount, money: false }
    ].filter((item) => item.value !== undefined && item.value !== null);
    if (known.length) return known;
    return reportFields(report)
      .filter(([key]) => !/(^|\.)from$/i.test(key) && !/(^|\.)to$/i.test(key))
      .slice(0, 6)
      .map(([key, value]) => ({ key, label: key.replace(/([A-Z])/g, " $1").replace(/[_.-]/g, " "), value, money: /revenue|amount|sales|total/i.test(key) }));
  }
  function responsePayload(response) {
    const payload = response?.data ?? response;
    return payload && typeof payload === "object" ? payload : {};
  }
  function responseTotal(response) {
    if (Number.isFinite(Number(response?.pagination?.total))) return Number(response.pagination.total);
    const payload = response?.data;
    if (Array.isArray(payload)) return payload.length;
    if (Array.isArray(payload?.items)) return payload.items.length;
    return 0;
  }
  function dashboardMetrics({ report, products, orders, inventory, vouchers, promotions, deliveries } = {}) {
    const summary = responsePayload(report).summary || {};
    return {
      revenue: Number(summary.revenue || 0),
      orderCount: Number(summary.orderCount || 0),
      itemCount: Number(summary.itemCount || 0),
      productCount: responseTotal(products),
      orderTotal: responseTotal(orders),
      inventoryCount: responseTotal(inventory),
      voucherCount: responseTotal(vouchers),
      promotionCount: responseTotal(promotions),
      deliveryCount: responseTotal(deliveries)
    };
  }
  function reportChartData(report = {}) {
    const dailySales = (Array.isArray(report.dailySales) ? report.dailySales : []).map((item) => ({
      date: String(item.date || ""),
      revenue: Number(item.revenue) || 0,
      orderCount: Number(item.orderCount) || 0
    })).filter((item) => item.date);
    const orderStatuses = (Array.isArray(report.orderStatuses) ? report.orderStatuses : []).map((item) => ({
      status: String(item.status || "unknown"),
      amount: Number(item.amount) || 0,
      count: Number(item.count) || 0
    }));
    const summary = report.summary || {};
    const summaryRevenue = Number(summary.revenue) || 0;
    const summaryOrders = Number(summary.orderCount) || 0;
    if (!dailySales.length && summaryRevenue > 0) dailySales.push({ date: "Toàn kỳ", revenue: summaryRevenue, orderCount: summaryOrders });
    if (!orderStatuses.length && summaryOrders > 0) orderStatuses.push({ status: "Tổng kỳ", count: summaryOrders, amount: summaryRevenue });
    return { dailySales, orderStatuses, maxRevenue: Math.max(1, ...dailySales.map((item) => item.revenue)) };
  }
  const numberValue = (value, fallback = 0) => value === "" || value === null || value === undefined ? fallback : Number(value) || 0;
  const booleanValue = (value) => value === true || value === "true";
  function crudActionPayload(action, values = {}) {
    if (action === "create-product") return {
      name: values.name,
      ...(values.slug ? { slug: values.slug } : {}),
      brandId: values.brandId,
      categoryId: values.categoryId,
      description: values.description || "",
      variants: [{ sku: values.sku, volume: values.volume, originalPrice: numberValue(values.originalPrice), retailPrice: numberValue(values.retailPrice), ...(values.imageUrl ? { imageUrl: values.imageUrl } : {}) }]
    };
    if (action === "update-product") return {
      name: values.name,
      ...(values.slug ? { slug: values.slug } : {}),
      description: values.description || "",
      variants: [{ id: values.variantId, sku: values.sku, retailPrice: numberValue(values.retailPrice), ...(values.originalPrice !== "" ? { originalPrice: numberValue(values.originalPrice) } : {}), ...(values.imageUrl ? { imageUrl: values.imageUrl } : {}) }]
    };
    if (["toggle-product", "promotion-status", "voucher-status", "catalog-status", "remove-product", "remove-promotion", "remove-voucher", "remove-catalog"].includes(action)) return { isActive: booleanValue(values.isActive) };
    if (action === "create-promotion") return { name: values.name, startDate: values.startDate, endDate: values.endDate, isActive: true, items: [{ variantId: values.variantId, promotionPrice: numberValue(values.promotionPrice) }] };
    if (action === "update-promotion") return { name: values.name, startDate: values.startDate, endDate: values.endDate, isActive: booleanValue(values.isActive), items: [{ variantId: values.variantId, promotionPrice: numberValue(values.promotionPrice) }] };
    if (action === "create-voucher" || action === "update-voucher") return {
      code: values.code,
      discountType: values.discountType,
      discountValue: numberValue(values.discountValue),
      minOrderValue: numberValue(values.minOrderValue),
      ...(values.maxDiscountAmount ? { maxDiscountAmount: numberValue(values.maxDiscountAmount) } : {}),
      ...(values.totalUsageLimit ? { totalUsageLimit: numberValue(values.totalUsageLimit) } : {}),
      startDate: values.startDate,
      endDate: values.endDate,
      ...(action === "create-voucher" ? { isActive: true } : { isActive: booleanValue(values.isActive) })
    };
    if (action === "create-category" || action === "update-category") return { name: values.name, slug: values.slug, description: values.description || "" };
    if (action === "create-brand" || action === "update-brand") return { name: values.name, code: values.code, slug: values.slug, origin: values.origin || "" };
    return values;
  }
  function productSlug(name = "") {
    return String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.size) return resolve("");
      if (!String(file.type || "").startsWith("image/")) {
        const error = new Error("Vui lòng chọn tệp hình ảnh hợp lệ.");
        error.status = 400;
        reject(error);
        return;
      }
      if (file.size > 700 * 1024) {
        const error = new Error("Ảnh tải lên không được vượt quá 700KB.");
        error.status = 400;
        reject(error);
        return;
      }
      const reader = new root.FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")));
      reader.addEventListener("error", () => reject(new Error("Không thể đọc tệp hình ảnh.")));
      reader.readAsDataURL(file);
    });
  }
  const data = (response) => root.MBApi.data(response);
  const rows = (response) => root.MBApi.list(response).items;
  const state = (host, kind, message, action = "") => root.MB.showState(host, kind, message, action);
  const errorState = (host, error) => state(host, error.status === 403 ? "forbidden" : error.status === 404 ? "notFound" : "error", root.MB.errorMessage(error), '<button class="outline" type="button" data-admin-retry>Thử lại</button>');
  const demo = (item) => item?.isDemo ? '<span class="demo-label">DỮ LIỆU MINH HỌA</span>' : item?.isMock ? '<span class="demo-label">MÔ PHỎNG</span>' : "";
  const money = (value) => root.MB.money(value);

  function table(headers, body) {
    return `<div class="table-wrap"><table><thead><tr>${headers.map((item) => `<th>${esc(item)}</th>`).join("")}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}">Không có bản ghi.</td></tr>`}</tbody></table></div>`;
  }
  function tableSection(eyebrow, title, count, content) {
    return `<section class="admin-table-section"><div class="section-head"><div><span class="eyebrow">${eyebrow}</span><h3>${title}</h3></div><span>${count} bản ghi</span></div>${content}</section>`;
  }
  const calendarIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-14 5h3m3 0h3m-9 3h3"/></svg>';
  function analyticsSection(eyebrow, title, count, description, content) {
    return `<section class="admin-analytics-section"><header class="admin-analytics-section-head"><span class="admin-create-icon" aria-hidden="true">${calendarIcon}</span><div><span class="eyebrow">${esc(eyebrow)}</span><h3>${esc(title)}</h3><p>${esc(description)}</p></div><span class="admin-feature-panel-count">${esc(count)}</span></header><div class="admin-analytics-content">${content}</div></section>`;
  }
  function analyticsGroup(eyebrow, title, description, meta, content, action = "") {
    return `<section class="panel admin-table-group admin-insights-group admin-create-panel"><header class="admin-table-group-heading"><div class="admin-insights-group-title"><span class="admin-create-icon" aria-hidden="true">${calendarIcon}</span><div><span class="eyebrow">${esc(eyebrow)}</span><h2>${esc(title)}</h2><p>${esc(description)}</p></div></div><div class="admin-insights-group-tools"><span class="admin-feature-panel-count">${esc(meta)}</span>${action}</div></header>${content}</section>`;
  }
  function rowActions(content, id = "menu", options = {}) {
    const target = `admin-row-actions-${String(id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const triggerLabel = options.triggerLabel || "…";
    const triggerClass = triggerLabel === "…" ? "admin-row-actions-trigger" : "admin-row-actions-trigger admin-row-actions-trigger-wide";
    const ariaLabel = options.ariaLabel || (triggerLabel === "…" ? "Mở thao tác" : triggerLabel);
    const menuClass = options.menuClass ? ` ${esc(options.menuClass)}` : "";
    return `<div class="admin-row-actions"><button class="${triggerClass}" type="button" aria-label="${esc(ariaLabel)}" aria-haspopup="menu" popovertarget="${target}">${esc(triggerLabel)}</button><div class="admin-row-actions-menu${menuClass}" id="${target}" popover="auto">${content}</div></div>`;
  }
  function actionPopoverPosition(triggerRect = {}, menuSize = {}, viewport = {}, gap = 8, margin = 12) {
    const viewportWidth = Number(viewport.width) || 0;
    const viewportHeight = Number(viewport.height) || 0;
    const menuWidth = Math.max(0, Number(menuSize.width) || 0);
    const menuHeight = Math.max(0, Number(menuSize.height) || 0);
    const triggerLeft = Number(triggerRect.left) || 0;
    const triggerRight = Number(triggerRect.right) || triggerLeft;
    const triggerTop = Number(triggerRect.top) || 0;
    const triggerBottom = Number(triggerRect.bottom) || triggerTop;
    let left = triggerRight + gap;
    let top = triggerBottom + gap;
    if (left + menuWidth > viewportWidth - margin) left = triggerLeft - menuWidth - gap;
    if (top + menuHeight > viewportHeight - margin) top = triggerTop - menuHeight - gap;
    return {
      left: Math.max(margin, Math.min(left, Math.max(margin, viewportWidth - menuWidth - margin))),
      top: Math.max(margin, Math.min(top, Math.max(margin, viewportHeight - menuHeight - margin)))
    };
  }
  function positionActionPopover(trigger) {
    if (!trigger || !root.document) return;
    const target = root.document.getElementById(trigger.getAttribute("popovertarget"));
    if (!target || !target.matches?.(":popover-open")) return;
    const position = actionPopoverPosition(trigger.getBoundingClientRect(), target.getBoundingClientRect(), { width: root.innerWidth, height: root.innerHeight });
    target.style.setProperty("--admin-row-actions-top", `${position.top}px`);
    target.style.setProperty("--admin-row-actions-left", `${position.left}px`);
  }
  function repositionOpenActionPopovers() {
    if (!root.document?.querySelectorAll) return;
    root.document.querySelectorAll(".admin-row-actions-trigger").forEach((trigger) => positionActionPopover(trigger));
  }
  function formField(label, name, type = "text", required = true, extra = "") {
    const control = type === "textarea" ? `<textarea name="${name}" ${required ? "required" : ""} ${extra}></textarea>` : `<input type="${type}" name="${name}" ${required ? "required" : ""} ${extra}>`;
    return `<label class="field${type === "textarea" ? " admin-create-wide" : ""}">${label}${control}</label>`;
  }
  function imageField(label, currentUrl = "") {
    const preview = currentUrl ? '<img class="image-upload-preview" src="' + esc(currentUrl) + '" alt="Ảnh hiện tại">' : "";
    return '<label class="field image-upload"><span>' + label + '</span><input type="file" name="image" accept="image/*" data-image-input><small data-image-name>' + (currentUrl ? "Giữ ảnh hiện tại nếu không chọn tệp mới." : "PNG, JPG hoặc WEBP · tối đa 700KB") + '</small>' + preview + '</label>';
  }
  function selectField(label, name, options, required = true) {
    return `<label class="field">${label}<select name="${name}" ${required ? "required" : ""}>${options}</select></label>`;
  }
  function formBlock(title, action, fields, submit) {
    const copy = {
      "create-category": ["PHÂN LOẠI CATALOG", "Tạo nhóm sản phẩm mới để khách hàng tìm đúng dòng sản phẩm nhanh hơn."],
      "create-product": ["DANH MỤC SẢN PHẨM", "Thêm sản phẩm, phân loại và giá bán vào cửa hàng."],
      "create-brand": ["THƯƠNG HIỆU", "Thiết lập thương hiệu để nhóm và giới thiệu sản phẩm nhất quán."],
      "stock-receipt": ["NHẬP KHO", "Ghi nhận hàng mới nhập để tồn kho được cập nhật chính xác."],
      "create-promotion": ["ƯU ĐÃI SẢN PHẨM", "Tạo chương trình giá ưu đãi theo thời gian và sản phẩm."],
      "create-voucher": ["MÃ GIẢM GIÁ", "Phát hành mã giảm giá với điều kiện sử dụng rõ ràng."],
      "create-delivery": ["GIAO NHẬN", "Tạo phiếu theo dõi giao hàng cho đơn đã xác nhận."],
      "create-return": ["HẬU MÃI", "Ghi nhận yêu cầu đổi trả và theo dõi xử lý."]
    }[action] || ["MAISON BELLE · STUDIO", "Nhập thông tin để tiếp tục."];
    const icons = {
      "create-category": '<svg viewBox="0 0 24 24" focusable="false"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>',
      "create-product": '<svg viewBox="0 0 24 24" focusable="false"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.8 7.5 4.4 7.5-4.4M12 12.2V21"/></svg>',
      "create-brand": '<svg viewBox="0 0 24 24" focusable="false"><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"/><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/></svg>',
      "stock-receipt": '<svg viewBox="0 0 24 24" focusable="false"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M12 7v8m-3-3 3 3 3-3M4.5 7.8 12 12l7.5-4.2"/></svg>',
      "create-promotion": '<svg viewBox="0 0 24 24" focusable="false"><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"/><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/></svg>',
      "create-voucher": '<svg viewBox="0 0 24 24" focusable="false"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5V9a3 3 0 0 0 0 6v2.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5V15a3 3 0 0 0 0-6V6.5Z"/><path d="M13 7v2m0 3v2m0 3v.01"/></svg>',
      "create-delivery": '<svg viewBox="0 0 24 24" focusable="false"><path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z"/><circle cx="7.5" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
      "create-return": '<svg viewBox="0 0 24 24" focusable="false"><path d="M9 14 4 9l5-5"/><path d="M4 9h9a7 7 0 1 1-6.4 9.8"/></svg>'
    };
    return `<section class="panel form-panel admin-create-panel"><div class="admin-create-heading"><span class="admin-create-icon" aria-hidden="true">${icons[action] || icons["create-category"]}</span><div><span class="eyebrow">${copy[0]}</span><h2>${title}</h2><p>${copy[1]}</p></div></div><form data-admin-action="${action}" class="form-grid admin-create-form">${fields}<div class="admin-create-actions"><p class="form-message" role="status"></p><button class="btn" type="submit"><span aria-hidden="true">＋</span>${submit}</button></div></form></section>`;
  }

  function groupAdminWorkspace(host) {
    if (!host || host.querySelector(":scope > .admin-workspace")) return;
    const children = [...host.children];
    if (!children.some((child) => child.matches(".panel"))) return;
    const workspace = root.document.createElement("div");
    workspace.className = "admin-workspace";
    workspace.setAttribute("aria-label", "Không gian quản lý");
    children.forEach((child) => workspace.append(child));
    host.append(workspace);
  }

  function bind() {
    const host = root.document.querySelector("#admin-content");
    if (!host || !root.MBApi) return;
    const reposition = () => {
      const schedule = root.requestAnimationFrame || ((callback) => root.setTimeout(callback, 0));
      schedule(repositionOpenActionPopovers);
    };
    root.addEventListener?.("scroll", reposition, true);
    root.addEventListener?.("resize", reposition);
    const params = new URLSearchParams(root.location.search);
    let view = defaultView("manager", params.get("view"));
    let currentRole = "";
    const title = root.document.querySelector("#view-title");
    const description = root.document.querySelector("#view-description");
    const localDateValue = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
    function exportDashboardReport() {
      const report = root.__mbAdminReport;
      if (!report || view !== "dashboard" || !root.URL?.createObjectURL || !root.Blob) return;
      const range = root.__mbAdminReportRange || {};
      const summary = report.summary || {};
      const chart = reportChartData(report);
      const products = Array.isArray(report.topProducts) ? report.topProducts : [];
      const orderCount = chart.orderStatuses.reduce((total, item) => total + (Number(item.count) || 0), 0);
      const rows = [
        ["Báo cáo Maison Belle"],
        ["Từ ngày", range.from || report.from || ""],
        ["Đến ngày", range.to || report.to || ""],
        [], ["TỔNG QUAN"], ["Chỉ số", "Giá trị"],
        ["Doanh thu", summary.revenue ?? 0],
        ["Đơn hàng", summary.orderCount ?? orderCount],
        ["Sản phẩm đã bán", summary.itemCount ?? 0],
        [], ["DOANH THU THEO NGÀY"], ["Ngày", "Doanh thu", "Số đơn"],
        ...chart.dailySales.map((item) => [item.date, item.revenue, item.orderCount]),
        [], ["SẢN PHẨM NỔI BẬT"], ["Sản phẩm", "Số lượng", "Doanh thu"],
        ...products.map((item) => [item.name || "", item.quantity || 0, item.revenue || 0]),
        [], ["TRẠNG THÁI ĐƠN HÀNG"], ["Trạng thái", "Số đơn", "Giá trị"],
        ...chart.orderStatuses.map((item) => [statusLabel(item.status), item.count, item.amount])
      ];
      const csvCell = (value) => {
        const raw = String(value ?? "");
        const safe = typeof value === "string" && /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
        return `"${safe.replaceAll('"', '""')}"`;
      };
      const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
      const blobUrl = root.URL.createObjectURL(new root.Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = root.document.createElement("a");
      link.href = blobUrl;
      link.download = `maison-belle-report-${String(range.from || "").replace(/[^\d-]/g, "")}-${String(range.to || "").replace(/[^\d-]/g, "")}.csv`;
      root.document.body.append(link);
      link.click();
      link.remove();
      root.setTimeout(() => root.URL.revokeObjectURL(blobUrl), 0);
      root.MB?.toast?.("Đã tải báo cáo CSV.", "success");
    }
    const syncNav = () => {
      title.textContent = titles[view];
      if (description) description.textContent = descriptions[view] || "Quản lý hoạt động cửa hàng.";
      const exportButton = root.document.querySelector("#admin-export-report");
      if (exportButton) exportButton.disabled = !root.__mbAdminReport || view !== "dashboard";
      root.document.querySelectorAll("[data-nav-view]").forEach((link) => {
        const active = link.dataset.navView === view;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
        link.hidden = Boolean(currentRole && !canAccess(currentRole, link.dataset.navView));
      });
    };
    syncNav();
    const layout = root.document.querySelector(".admin-layout");
    const side = root.document.querySelector("#side");
    const sidebarLogo = root.document.querySelector("#sidebar-logo");
    const openSideButton = root.document.querySelector("#open-side");
    const closeSideButton = root.document.querySelector("#close-side");
    const sideBackdrop = root.document.querySelector("#side-backdrop");
    const setMobileSidebar = (open, restoreFocus = true) => {
      side?.classList.toggle("open", open);
      openSideButton?.setAttribute("aria-expanded", String(open));
      sideBackdrop?.classList.toggle("open", open);
      if (sideBackdrop) sideBackdrop.hidden = !open;
      root.document.body.classList.toggle("sidebar-open", open);
      if (open) {
        side?.setAttribute("role", "dialog");
        side?.setAttribute("aria-modal", "true");
        side?.setAttribute("aria-label", "Điều hướng quản trị");
        side?.querySelector(".side-link:not([hidden])")?.focus();
      } else {
        side?.removeAttribute("role");
        side?.removeAttribute("aria-modal");
        side?.removeAttribute("aria-label");
        if (restoreFocus) openSideButton?.focus();
      }
    };
    const syncSidebar = (collapsed) => {
      layout?.classList.toggle("sidebar-collapsed", collapsed);
      sidebarLogo?.setAttribute("aria-expanded", String(!collapsed));
      sidebarLogo?.setAttribute("aria-label", collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên");
      sidebarLogo?.setAttribute("title", collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên");
    };
    let sidebarCollapsed = false;
    try { sidebarCollapsed = root.localStorage.getItem("mb-admin-sidebar") === "collapsed"; } catch {}
    syncSidebar(sidebarCollapsed);
    sidebarLogo?.addEventListener("click", () => {
      sidebarCollapsed = !sidebarCollapsed;
      syncSidebar(sidebarCollapsed);
      try { root.localStorage.setItem("mb-admin-sidebar", sidebarCollapsed ? "collapsed" : "expanded"); } catch {}
    });
    openSideButton?.addEventListener("click", () => setMobileSidebar(true));
    closeSideButton?.addEventListener("click", () => setMobileSidebar(false));
    sideBackdrop?.addEventListener("click", () => setMobileSidebar(false));
    side?.addEventListener("click", (event) => {
      if (event.target.closest(".side-link")) setMobileSidebar(false, false);
    });
    root.document.addEventListener("keydown", (event) => {
      if (!side?.classList.contains("open")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileSidebar(false);
      } else if (event.key === "Tab") {
        const controls = [...side.querySelectorAll("a[href]:not([hidden]), button:not([hidden])")]
          .filter((item) => !item.disabled && item.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && root.document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && root.document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    root.addEventListener("resize", () => {
      if (root.innerWidth > 980 && side?.classList.contains("open")) setMobileSidebar(false, false);
    });

    function login(message = "Đăng nhập bằng tài khoản nhân viên để tiếp tục.") {
      host.innerHTML = `<section class="login-panel"><span class="eyebrow">MAISON BELLE · STUDIO</span><h2>Đăng nhập vận hành</h2><p>${esc(message)}</p><div class="demo-credential"><b>Tài khoản thử nghiệm · chỉ dùng dữ liệu demo</b><div><button class="outline" type="button" data-demo-email="sales@maisonbelle.local">Bán hàng</button><button class="outline" type="button" data-demo-email="warehouse@maisonbelle.local">Kho</button><button class="outline" type="button" data-demo-email="manager@maisonbelle.local">Quản lý</button></div><small>Mật khẩu demo: Demo@123</small></div><form id="staff-login" class="form-grid"><label class="field">Email<input type="email" name="email" required autocomplete="username"></label><label class="field">Mật khẩu<input type="password" name="password" required autocomplete="current-password"></label><button class="btn" type="submit">ĐĂNG NHẬP</button><p class="form-message" role="status"></p></form></section>`;
      host.querySelector("#staff-login").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget, button = form.querySelector("[type=submit]"), messageEl = form.querySelector(".form-message");
        button.disabled = true; messageEl.textContent = "Đang xác thực…";
        try { await root.MBApi.auth.login(Object.fromEntries(new FormData(form).entries())); await start(); }
        catch (error) { messageEl.textContent = root.MB.errorMessage(error); }
        finally { button.disabled = false; }
      });
    }

    function renderReportCharts() {
      const report = root.__mbAdminReport;
      const chartHost = host.querySelector("#admin-report-charts");
      if (!report || view !== "dashboard" || !chartHost || chartHost.dataset.rendered) return;
      const chart = reportChartData(report);
      const daily = chart.dailySales.length
        ? chart.dailySales.map((item) => {
          const width = Math.round(item.revenue / chart.maxRevenue * 100);
          return `<div class="report-bar"><span>${esc(item.date)}</span><div class="report-bar-track"><i class="report-bar-fill" style="--bar-width:${width}%"></i></div><b>${money(item.revenue)}</b><small>${esc(item.orderCount)} đơn</small></div>`;
        }).join("")
        : '<p class="empty">Chưa có doanh thu trong khoảng thời gian này.</p>';
      const statuses = chart.orderStatuses.length
        ? chart.orderStatuses.map((item) => `<div class="report-status">${statusTag(item.status)}<b>${esc(item.count)} đơn</b><strong>${money(item.amount)}</strong></div>`).join("")
        : '<p class="empty">Chưa có trạng thái đơn hàng.</p>';
      const orderCount = chart.orderStatuses.reduce((total, item) => total + (Number(item.count) || 0), 0);
      chartHost.innerHTML = `<div class="admin-analytics-grid">${analyticsSection("DOANH THU THEO NGÀY", "Xu hướng bán hàng", `${chart.dailySales.length} ngày`, "Doanh thu ghi nhận theo từng ngày trong kỳ đã chọn.", daily)}${analyticsSection("TRẠNG THÁI ĐƠN", "Phân bổ vận hành", `${orderCount} đơn`, "Số lượng và doanh thu đơn hàng theo từng trạng thái.", statuses)}</div>`;
      chartHost.dataset.rendered = "true";
    }

    function decorateCrudView() {
      const add = (selector, action, attributes, label) => {
        host.querySelectorAll(selector).forEach((source) => {
          const parent = source.parentElement;
          if (parent?.querySelector(`[data-admin-action="${action}"]`)) return;
          const attrs = Object.entries(attributes(source)).map(([key, value]) => `data-${key}="${esc(value)}"`).join(" ");
          source.insertAdjacentHTML("afterend", `<form data-admin-action="${action}" ${attrs}><input type="hidden" name="isActive" value="false"><button class="outline danger" type="submit">${label}</button><p class="form-message" role="status"></p></form>`);
        });
      };
      add('form[data-admin-action="toggle-product"]', "remove-product", (form) => ({ id: form.dataset.id }), "Ẩn sản phẩm");
      add('form[data-admin-action="promotion-status"]', "remove-promotion", (form) => ({ id: form.dataset.id }), "Xóa");
      add('form[data-admin-action="voucher-status"]', "remove-voucher", (form) => ({ id: form.dataset.id }), "Xóa");
      add('form[data-admin-action="catalog-status"]', "remove-catalog", (form) => ({ kind: form.dataset.kind, id: form.dataset.id }), "Xóa");
      const addEdit = (selector, type, extra = () => ({})) => host.querySelectorAll(selector).forEach((source) => {
        if (source.parentElement?.querySelector(`[data-admin-edit="${type}"]`)) return;
        const attrs = Object.entries({ id: source.dataset.id, ...extra(source) }).map(([key, value]) => `data-${key}="${esc(value)}"`).join(" ");
        source.insertAdjacentHTML("afterend", `<button class="outline" type="button" data-admin-edit="${type}" ${attrs}>Chỉnh sửa</button>`);
      });
      addEdit('form[data-admin-action="promotion-status"]', "promotion", (form) => ({ name: form.dataset.name }));
      addEdit('form[data-admin-action="voucher-status"]', "voucher", (form) => ({ code: form.dataset.code, discountValue: form.dataset.discountValue }));
      addEdit('form[data-admin-action="catalog-status"]', "catalog", (form) => ({ kind: form.dataset.kind, name: form.dataset.name }));
      renderReportCharts();
    }

    async function listOrState(fetcher, render) {
      state(host, "loading", "Đang tải dữ liệu vận hành…");
      try {
        await render(await fetcher());
        if (["products", "orders", "customers", "appointments", "inventory", "promotions", "deliveries", "returns", "master-data"].includes(view)) groupAdminWorkspace(host);
        decorateCrudView();
      }
      catch (error) { errorState(host, error); }
    }

    async function renderView() {
      if (!canAccess(currentRole, view)) { state(host, "forbidden", "Vai trò hiện tại không được cấp quyền xem mục này."); return; }
      if (view === "dashboard") return dashboardView();
      if (view === "products") return productsView();
      if (view === "orders") return ordersView();
      if (view === "customers") return customersView();
      if (view === "appointments") return appointmentsView();
      if (view === "inventory") return inventoryView();
      if (view === "promotions") return promotionsView();
      if (view === "deliveries") return deliveriesView();
      if (view === "returns") return returnsView();
      if (view === "master-data") return masterDataView();
      state(host, "notFound", "Mục vận hành không tồn tại.");
    }

    async function dashboardView(query = {}) {
      const today = localDateValue(new Date());
      const thirtyDaysBefore = new Date();
      thirtyDaysBefore.setDate(thirtyDaysBefore.getDate() - 29);
      const thirtyDaysAgo = localDateValue(thirtyDaysBefore);
      const from = query.from || thirtyDaysAgo, to = query.to || today;
      const currentExportButton = host.querySelector("#admin-export-report");
      if (currentExportButton) currentExportButton.disabled = true;
      await listOrState(() => Promise.all([
        root.MBApi.admin.reports({ from, to, storeId: query.storeId || "" }),
        root.MBApi.admin.catalog.list(),
        root.MBApi.admin.products.list({ page: 1, limit: 1 }),
        root.MBApi.orders.list({ page: 1, limit: 1 }),
        root.MBApi.admin.inventory(),
        root.MBApi.admin.vouchers.list({ page: 1, limit: 1 }),
        root.MBApi.admin.promotions.list({ page: 1, limit: 1 }),
        root.MBApi.admin.deliveries.list({ page: 1, limit: 1 })
      ]), ([reportResponse, catalogResponse, products, orders, inventory, vouchers, promotions, deliveries]) => {
        const report = responsePayload(reportResponse);
        const catalog = data(catalogResponse) || {};
        root.__mbAdminReport = report;
        root.__mbAdminReportRange = { from, to };
        const metrics = dashboardMetrics({ report, products, orders, inventory, vouchers, promotions, deliveries });
        const storeOptions = `<option value="">Tất cả cửa hàng</option>${(catalog.stores || []).map((store) => `<option value="${esc(store.id || store._id)}" ${String(store.id || store._id) === String(query.storeId || "") ? "selected" : ""}>${esc(store.name)}</option>`).join("")}`;
        const filter = `<section class="panel dashboard-filter-panel"><div class="section-head"><div><span class="eyebrow">DỮ LIỆU TRỰC TIẾP</span><h2>Lọc theo kỳ và cửa hàng</h2></div><span>Đồng bộ từ MongoDB qua API</span></div><form id="dashboard-filter" class="form-grid"><label class="field">Từ ngày<input type="date" name="from" value="${esc(from)}" required></label><label class="field">Đến ngày<input type="date" name="to" value="${esc(to)}" required></label>${selectField("Cửa hàng", "storeId", storeOptions, false)}<button class="btn" type="submit">CẬP NHẬT TỔNG QUAN</button></form></section>`;
        const cards = [
          ["Doanh thu kỳ", money(metrics.revenue)],
          ["Đơn trong kỳ", metrics.orderCount],
          ["Sản phẩm đã bán", metrics.itemCount],
          ["Sản phẩm trong cửa hàng", metrics.productCount],
          ["Dòng tồn kho", metrics.inventoryCount],
          ["Voucher", metrics.voucherCount],
          ["Khuyến mãi", metrics.promotionCount],
          ["Giao hàng", metrics.deliveryCount]
        ].map(([label, value]) => `<article class="stat"><small>${esc(label)}</small><b>${esc(value)}</b></article>`).join("");
        const topProducts = Array.isArray(report.topProducts) ? report.topProducts : [];
        const topRows = topProducts.map((item) => `<tr><td>${esc(item.name || "—")}</td><td>${esc(item.quantity || 0)}</td><td>${money(item.revenue || 0)}</td></tr>`).join("");
        const links = [
          ["products", "Quản lý sản phẩm"], ["orders", "Xử lý đơn hàng"], ["inventory", "Nhập và kiểm kê kho"],
          ["promotions", "Voucher & khuyến mãi"], ["deliveries", "Theo dõi giao hàng"], ["appointments", "Tư vấn & lịch hẹn"]
        ].map(([target, label]) => `<a class="dashboard-action" href="admin.html?view=${target}"><span>${esc(label)}</span><b>→</b></a>`).join("");
        const quickActions = `<section class="panel dashboard-actions-panel"><div class="section-head"><div><span class="eyebrow">THAO TÁC NHANH</span><h2>Vận hành cửa hàng</h2></div></div><div class="dashboard-actions">${links}</div></section>`;
        const chart = reportChartData(report);
        const statusRows = chart.orderStatuses.map((item) => `<div class="report-detail-status">${statusTag(item.status)}<b>${esc(item.count)} đơn</b><strong>${money(item.amount)}</strong></div>`).join("");
        const orderCount = chart.orderStatuses.reduce((total, item) => total + (Number(item.count) || 0), 0);
        const period = `<p class="report-period">Kỳ dữ liệu: <strong>${esc(formatReportDate(report.from || from))}</strong> – <strong>${esc(formatReportDate(report.to || to))}</strong></p>`;
        const exportAction = `<button class="admin-export-btn" id="admin-export-report" type="button" aria-label="Tải xuống báo cáo CSV"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/></svg><span>Xuất báo cáo</span></button>`;
        const insights = analyticsGroup("TỔNG QUAN KINH DOANH", "Tổng quan & Báo cáo", "Chỉ số, sản phẩm bán chạy, doanh thu theo ngày và trạng thái đơn trong cùng một trang.", `${formatReportDate(from)} – ${formatReportDate(to)}`, `${filter}<section class="stats">${cards}</section>${period}<div class="admin-analytics-grid">${analyticsSection("BÁN CHẠY TRONG KỲ", "Sản phẩm nổi bật", `${topProducts.length} sản phẩm`, "Các sản phẩm có kết quả bán hàng tốt trong khoảng thời gian đã chọn.", topProducts.length ? table(["Sản phẩm", "Số lượng", "Doanh thu"], topRows) : "<p class='empty'>Chưa có dữ liệu bán hàng trong kỳ.</p>")}${analyticsSection("ĐƠN HÀNG", "Trạng thái đơn hàng", `${orderCount} đơn`, "Số lượng và doanh thu đơn hàng theo từng trạng thái.", statusRows || "<p class='empty'>Chưa có trạng thái đơn hàng trong kỳ.</p>")}</div><div id="admin-report-charts"></div>${quickActions}`, exportAction);
        host.innerHTML = insights;
      });
    }

    async function productsView() {
      await listOrState(() => Promise.all([root.MBApi.admin.products.list({ page: 1, limit: 100 }), root.MBApi.admin.catalog.list()]), ([response, catalogResponse]) => {
        const products = rows(response), catalog = data(catalogResponse) || {};
        const canWrite = ["sales", "manager"].includes(currentRole);
        const brands = catalog.brands || [], categories = catalog.categories || [];
        const brandOptions = brands.filter((item) => item.isActive !== false).map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");
        const categoryOptions = categories.filter((item) => item.isActive !== false).map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");
        const brandNames = new Map(brands.map((item) => [String(item.id), item.name]));
        const categoryNames = new Map(categories.map((item) => [String(item.id), item.name]));
        const body = products.map((item) => {
          const id = item.id || item._id, variant = item.variants?.[0] || {};
          const imageUrl = variant.imageUrl || item.imageUrl || item.image || "";
          const edit = canWrite ? `<details class="product-edit"><summary>Chỉnh sửa</summary><form data-admin-action="update-product" data-id="${esc(id)}" class="form-grid product-edit-form" data-product-editor><div class="product-edit-heading"><span>Thông tin sản phẩm</span><small>Cập nhật tên, giá, mô tả hoặc ảnh sản phẩm.</small></div><label class="field">Tên<input name="name" value="${esc(item.name || "")}" required></label>${imageField("Ảnh sản phẩm", imageUrl)}<label class="field">SKU<input name="sku" value="${esc(variant.sku || "")}" required></label><label class="field">Giá bán<input name="retailPrice" type="number" min="0" value="${esc(variant.retailPrice ?? 0)}" required></label><label class="field">Giá gốc<input name="originalPrice" type="number" min="0" value="${esc(variant.originalPrice ?? variant.retailPrice ?? 0)}"></label><label class="field product-edit-description">Mô tả<textarea name="description">${esc(item.description || "")}</textarea></label><input type="hidden" name="variantId" value="${esc(variant.id || variant._id || "")}"><div class="product-edit-actions"><button class="btn" type="submit">LƯU THAY ĐỔI</button><button class="outline" type="button" data-product-editor-close>ĐÓNG</button></div><p class="form-message" role="status"></p></form></details>` : "Chỉ xem";
          const toggle = canWrite ? `<form data-admin-action="toggle-product" data-id="${esc(id)}"><input type="hidden" name="isActive" value="${item.isActive === false ? "true" : "false"}"><button class="outline" type="submit">${item.isActive === false ? "Mở bán" : "Ngừng bán"}</button><p class="form-message" role="status"></p></form>` : "";
          const actions = canWrite ? rowActions(`${edit}${toggle}`, `product-${id}`) : "—";
          return `<tr><td>${esc(item.name || item.productName || "—")} ${demo(item)}</td><td>${esc(item.brandName || brandNames.get(String(item.brandId)) || "—")}</td><td>${esc(item.categoryName || categoryNames.get(String(item.categoryId)) || "—")}</td><td>${money(variant.retailPrice ?? item.price ?? 0)}</td><td>${statusTag(item.isActive === false ? "inactive" : "active", item.isActive === false ? "Ngừng bán" : "Đang bán")}</td><td>${actions}</td></tr>`;
        }).join("");
        host.innerHTML = `${canWrite ? formBlock("Thêm sản phẩm", "create-product", `${formField("Tên sản phẩm", "name")}${formField("Mã SKU phân loại", "sku")}${selectField("Thương hiệu", "brandId", brandOptions)}${selectField("Danh mục", "categoryId", categoryOptions)}${formField("Dung tích / phân loại", "volume", "text", false)}${formField("Giá gốc (₫)", "originalPrice", "number")}${formField("Giá bán lẻ (₫)", "retailPrice", "number")}${formField("Mô tả", "description", "textarea", false)}${imageField("Ảnh sản phẩm")}`, "Tạo sản phẩm") : ""}
          <section class="panel"><div class="section-head"><div><span class="eyebrow">DANH MỤC HIỆN HÀNH</span><h2>Sản phẩm</h2></div><span>${products.length} bản ghi</span></div>${products.length ? table(["Sản phẩm", "Thương hiệu", "Danh mục", "Giá", "Trạng thái", "Thao tác"], body) : "<p class='empty'>Chưa có sản phẩm từ máy chủ.</p>"}</section>`;
      });
    }

    async function ordersView() {
      await listOrState(() => root.MBApi.orders.list({ page: 1, limit: 100 }), (response) => {
        const orders = rows(response);
        const next = { pending: ["confirmed", "cancelled"], confirmed: ["processing", "cancelled"], processing: ["shipped", "cancelled"], shipped: ["delivered"], delivered: ["completed", "returned"] };
        const body = orders.map((item) => {
          const id = item.id || item._id, current = item.orderStatus || item.status || "pending";
          const options = (next[current] || []).map((status) => `<option value="${status}">${esc(statusLabel(status))}</option>`).join("");
          const hasNext = Boolean(options);
          const update = hasNext ? `<button class="outline admin-record-action" type="button" data-admin-order-update aria-controls="admin-workflow-editor" aria-expanded="false" data-id="${esc(id)}" data-order-code="${esc(item.orderCode || item.code || id || "")}" data-status="${esc(current)}" data-next-statuses="${esc((next[current] || []).join(","))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v14A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V5.5A1.5 1.5 0 0 0 18.5 4H16"/><path d="M9 3h6v4H9zM8 13h8m-8 4h5"/></svg><span>Cập nhật</span></button>` : "<span class='admin-muted-note'>—</span>";
          const details = `<button class="outline admin-order-detail-action" type="button" data-admin-order-detail="${esc(id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M14 3.5V8h4M9 12h6m-6 4h6"/></svg><span>Chi tiết & hóa đơn</span></button>`;
          return `<tr><td>${esc(item.orderCode || item.code || id || "—")} ${demo(item)}</td><td>${esc(item.customerName || item.customer?.fullName || item.customer?.name || item.user?.email || "—")}</td><td>${money(item.finalAmount ?? item.totalAmount ?? item.total ?? 0)}</td><td>${statusTag(current)}</td><td><div class="admin-order-actions">${update}${details}</div></td></tr>`;
        }).join("");
        host.innerHTML = `<section class="panel orders-panel admin-create-panel"><div class="admin-feature-panel-head"><div class="admin-create-heading"><span class="admin-create-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v14A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V5.5A1.5 1.5 0 0 0 18.5 4H16"/><path d="M9 3h6v4H9zM8 12h8m-8 4h5"/></svg></span><div><span class="eyebrow">XỬ LÝ ĐƠN</span><h2>Đơn hàng & hóa đơn</h2><p>Theo dõi trạng thái và tiến độ xử lý đơn hàng.</p></div></div><span class="admin-feature-panel-count">${orders.length} bản ghi</span></div>${orders.length ? table(["Mã đơn", "Khách hàng", "Tổng tiền", "Trạng thái", "Thao tác"], body) : "<p class='empty'>Chưa có đơn hàng từ máy chủ.</p>"}<div id="admin-order-detail"></div><p class="service">Thanh toán qua cổng ngân hàng và hóa đơn thuế thật nằm ngoài bản mô phỏng.</p></section><div id="admin-workflow-editor"></div>`;
      });
    }

    async function customersView(query = {}) {
      const term = query.q || "";
      const search = `<section class="panel form-panel admin-create-panel customer-search-panel"><div class="admin-create-heading"><span class="admin-create-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0M18 8v6m-3-3h6"/></svg></span><div><span class="eyebrow">HỒ SƠ KHÁCH HÀNG</span><h2>Tìm khách hàng</h2><p>Tìm nhanh hồ sơ theo tên, email hoặc số điện thoại.</p></div></div><form data-admin-search="customers" class="form-grid admin-create-form customer-search-form"><label class="field admin-create-wide"><span>Từ khóa tìm kiếm</span><span class="customer-search-control"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg><input name="q" value="${esc(term)}" type="search" placeholder="Nhập tên, email hoặc số điện thoại" autocomplete="off"></span></label><p class="customer-search-hint">Có thể để trống để xem toàn bộ danh sách khách hàng.</p><div class="admin-create-actions"><p class="form-message" role="status"></p><button class="btn" type="submit"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg><span>Tìm khách hàng</span></button></div></form></section>`;
      await listOrState(() => root.MBApi.admin.customers.list({ q: term, page: 1, limit: 100 }), (response) => {
        const items = rows(response);
        const body = items.map((item) => `<tr><td>${esc(item.fullName || "—")} ${demo(item)}</td><td>${esc(item.email || "—")}</td><td>${esc(item.phone || "—")}</td><td>${statusTag(item.membership?.tier || "bronze")}</td><td>${esc(item.membership?.pointsBalance ?? 0)}</td></tr>`).join("");
        host.innerHTML = `${search}<section class="customer-results"><div class="section-head"><div><span class="eyebrow">DANH SÁCH HỘI VIÊN</span><h2>Khách hàng & hội viên</h2></div><span>${items.length} bản ghi</span></div>${items.length ? table(["Khách hàng", "Email", "Điện thoại", "Hạng", "Điểm hiện có"], body) : "<p class='empty'>Không tìm thấy khách hàng phù hợp.</p>"}</section>`;
      });
    }

    async function masterDataView() {
      await listOrState(() => root.MBApi.admin.catalog.list(), (response) => {
        const catalog = data(response) || {}, categories = catalog.categories || [], brands = catalog.brands || [], stores = catalog.stores || [];
        const rowsFor = (items, kind) => items.map((item) => {
          const id = item.id || item._id;
          const action = `<form data-admin-action="catalog-status" data-kind="${kind}" data-id="${esc(id)}" data-name="${esc(item.name || "")}"><input type="hidden" name="isActive" value="${item.isActive === false ? "true" : "false"}"><button class="outline" type="submit">${item.isActive === false ? "Kích hoạt" : "Ẩn"}</button><p class="form-message" role="status"></p></form>`;
          return `<tr><td>${esc(item.name || "—")} ${demo(item)}</td><td>${esc(item.slug || item.code || item.origin || "—")}</td><td>${statusTag(item.isActive === false ? "inactive" : "active", item.isActive === false ? "Đã ẩn" : "Đang dùng")}</td><td>${rowActions(action, `catalog-${kind}-${id}`)}</td></tr>`;
        }).join("");
        const editable = currentRole === "manager";
        const categoryFields = `${formField("Tên danh mục", "name", "text", true, 'placeholder="Ví dụ: Chăm sóc da"')}<label class="field">Mã đường dẫn<input name="slug" placeholder="cham-soc-da" required><small>Chữ thường, không dấu; dùng dấu gạch ngang để ngăn cách.</small></label>${formField("Mô tả", "description", "textarea", false, 'placeholder="Mô tả ngắn về nhóm sản phẩm này"')}`;
        const categoryForm = editable ? formBlock("Thêm danh mục", "create-category", categoryFields, "Tạo danh mục") : "";
        const storeRows = stores.map((item) => `<tr><td>${esc(item.name)} ${demo(item)}</td><td>${esc(item.address || "—")}</td><td>${statusTag(item.isActive === false ? "inactive" : "active", item.isActive === false ? "Đã đóng" : "Đang hoạt động")}</td></tr>`).join("");
        host.innerHTML = `${categoryForm}
          ${editable ? formBlock("Thêm thương hiệu", "create-brand", `${formField("Tên thương hiệu", "name")}${formField("Mã thương hiệu", "code")}${formField("Đường dẫn", "slug", "text", false)}${formField("Xuất xứ", "origin", "text", false)}`, "Tạo thương hiệu") : ""}
          <section class="panel admin-table-group"><div class="admin-table-group-heading"><div><span class="eyebrow">DỮ LIỆU CỬA HÀNG</span><h2>Danh mục, thương hiệu & cửa hàng</h2></div><span>${categories.length + brands.length + stores.length} bản ghi</span></div>
            ${tableSection("PHÂN LOẠI CATALOG", "Danh mục", categories.length, categories.length ? table(["Tên", "Mã", "Trạng thái", "Thao tác"], rowsFor(categories, "categories")) : "<p class='empty'>Chưa có danh mục.</p>")}
            ${tableSection("THƯƠNG HIỆU", "Nhãn hàng", brands.length, brands.length ? table(["Tên", "Mã", "Trạng thái", "Thao tác"], rowsFor(brands, "brands")) : "<p class='empty'>Chưa có thương hiệu.</p>")}
            ${tableSection("ĐIỂM BÁN", "Cửa hàng", stores.length, stores.length ? table(["Cửa hàng", "Địa chỉ", "Trạng thái"], storeRows) : "<p class='empty'>Chưa có cửa hàng.</p>")}
          </section>`;
      });
    }

    async function appointmentsView() {
      await listOrState(() => root.MBApi.appointments.list({ page: 1, limit: 100 }), (response) => {
        const items = rows(response);
        const next = { requested: ["confirmed", "cancelled"], confirmed: ["completed", "cancelled"] };
        const body = items.map((item) => {
          const current = item.status || "requested", options = (next[current] || []).map((status) => `<option value="${status}">${esc(statusLabel(status))}</option>`).join("");
          const canEdit = Boolean(options) || current === "completed";
          const action = `<button class="outline admin-record-action" type="button" data-admin-appointment-update aria-controls="admin-workflow-editor" aria-expanded="false" data-id="${esc(item.id || item._id)}" data-status="${esc(current)}" data-next-statuses="${esc((next[current] || []).join(","))}" data-employee-note="${esc(item.employeeNote || "")}" data-consultation-result="${esc(item.consultationResult || "")}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v14A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V5.5A1.5 1.5 0 0 0 18.5 4H16"/><path d="M9 3h6v4H9zM8 13l2.5 2.5L16 10"/></svg><span>${canEdit ? "Cập nhật" : "Xem"}</span></button>`;
          return `<tr><td>${esc(item.customer?.fullName || item.user?.name || item.userId || "—")} ${demo(item)}</td><td>${esc(formatReportDate(item.appointmentDate || item.date || "—"))} ${esc(item.startTime || "")}–${esc(item.endTime || "")}</td><td>${esc(item.customerNote || item.note || "—")}</td><td>${statusTag(current)}</td><td>${action}</td></tr>`;
        }).join("");
        host.innerHTML = `<section class="panel appointments-panel admin-create-panel"><div class="admin-feature-panel-head"><div class="admin-create-heading"><span class="admin-create-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-14 5h3m3 0h3m-9 3h3"/></svg></span><div><span class="eyebrow">TƯ VẤN CÁ NHÂN</span><h2>Lịch hẹn</h2><p>Theo dõi lịch tư vấn và kết quả chăm sóc khách hàng.</p></div></div><span class="admin-feature-panel-count">${items.length} bản ghi</span></div>${items.length ? table(["Khách hàng", "Thời gian", "Nhu cầu", "Trạng thái", "Thao tác"], body) : "<p class='empty'>Chưa có yêu cầu tư vấn.</p>"}</section><div id="admin-workflow-editor"></div>`;
      });
    }

    async function inventoryView() {
      await listOrState(() => Promise.all([root.MBApi.admin.inventory(), root.MBApi.admin.catalog.list(), root.MBApi.admin.products.list({ page: 1, limit: 100 })]), ([response, catalogResponse, productResponse]) => {
        const items = rows(response), catalog = data(catalogResponse) || {}, products = rows(productResponse);
        const storeOptions = (catalog.stores || []).filter((item) => item.isActive !== false).map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");
        const variantOptions = products.flatMap((product) => (product.variants || []).filter((item) => item.isActive !== false).map((variant) => `<option value="${esc(variant.id || variant._id)}">${esc(product.name)} · ${esc(variant.sku)} · ${esc(variant.volume || "")}</option>`)).join("");
        const variantById = new Map(products.flatMap((product) => (product.variants || []).map((variant) => [String(variant.id || variant._id), { product, variant }])));
        const storeById = new Map((catalog.stores || []).map((store) => [String(store.id || store._id), store.name]));
        const body = items.map((item) => {
          const found = variantById.get(String(item.variantId));
          const variantId = item.variantId || found?.variant?.id || found?.variant?._id || "";
          const storeId = item.storeId || item.store?.id || item.store?._id || "";
          const action = variantId && storeId
            ? rowActions('<form class="inventory-action-form" data-inventory-action="' + esc(String(storeId) + ":" + String(variantId)) + '" data-admin-action="stock-adjustment"><input type="hidden" name="storeId" value="' + esc(storeId) + '"><input type="hidden" name="variantId" value="' + esc(variantId) + '">' + formField("Chênh lệch (+/-)", "quantity", "number") + formField("Lý do", "note", "text", false) + '<button class="outline" type="submit">Ghi nhận</button><p class="form-message" role="status"></p></form>', `inventory-${storeId}-${variantId}`, { triggerLabel: "Điều chỉnh tồn kho", menuClass: "inventory-adjustment-popover" })
            : "—";
          const available = Number(item.availableQuantity ?? (Number(item.stockQuantity || 0) - Number(item.reservedQuantity || 0)));
          const stockTone = available <= 0 ? "danger" : available <= 5 ? "warning" : "success";
          return `<tr><td>${esc(found?.product.name || item.product?.name || item.variantId || "—")} ${demo(item)}</td><td>${esc(found?.variant.sku || item.variant?.sku || item.sku || "—")}</td><td>${esc(item.store?.name || storeById.get(String(item.storeId)) || item.storeId || "—")}</td><td>${esc(item.stockQuantity ?? item.quantity ?? "—")}</td><td>${esc(item.reservedQuantity ?? "—")}</td><td><span class="tag status-${stockTone}">${esc(Number.isFinite(available) ? available : "—")}</span></td><td>${action}</td></tr>`;
        }).join("");
        host.innerHTML = `${formBlock("Phiếu nhập kho", "stock-receipt", `${selectField("Cửa hàng", "storeId", storeOptions)}${selectField("Sản phẩm / phân loại", "variantId", variantOptions)}${formField("Số lượng nhập", "quantity", "number")}${formField("Đơn giá nhập (₫)", "unitCost", "number", false)}${formField("Ghi chú", "note", "text", false)}`, "Ghi nhận nhập kho")}
          <section class="panel"><div class="section-head"><div><span class="eyebrow">SỐ LIỆU TỪ KHO</span><h2>Tồn kho khả dụng</h2></div><span>${items.length} bản ghi</span></div>${items.length ? table(["Sản phẩm", "SKU", "Cửa hàng", "Tồn", "Đã giữ", "Khả dụng", "Thao tác"], body) : "<p class='empty'>Chưa có số liệu tồn kho.</p>"}</section>`;
      });
    }

    async function promotionsView() {
      await listOrState(() => Promise.all([
        root.MBApi.admin.promotions.list({ page: 1, limit: 100 }),
        root.MBApi.admin.vouchers.list({ page: 1, limit: 100 }),
        root.MBApi.admin.products.list({ page: 1, limit: 100 })
      ]), ([promotionResponse, voucherResponse, productResponse]) => {
        const items = rows(promotionResponse), vouchers = rows(voucherResponse), products = rows(productResponse);
        const variantOptions = products.flatMap((product) => (product.variants || []).filter((variant) => variant.isActive !== false).map((variant) => `<option value="${esc(variant.id || variant._id)}">${esc(product.name)} · ${esc(variant.sku)} · ${esc(variant.volume || "")}</option>`)).join("");
        const promotionRows = items.map((item) => {
          const id = item.id || item._id;
          const action = `<form data-admin-action="promotion-status" data-id="${esc(id)}" data-name="${esc(item.name || item.title || "")}"><input type="hidden" name="isActive" value="${item.isActive === false ? "true" : "false"}"><button class="outline" type="submit">${item.isActive === false ? "Kích hoạt" : "Tạm dừng"}</button><p class="form-message" role="status"></p></form>`;
          return `<tr><td>${esc(item.name || item.title || "—")} ${demo(item)}</td><td>${esc(item.items?.length || 0)} sản phẩm</td><td>${esc(formatReportDate(item.startDate || "—"))} → ${esc(formatReportDate(item.endDate || "—"))}</td><td>${statusTag(item.isActive === false ? "inactive" : "active", item.isActive === false ? "Tạm dừng" : "Đang chạy")}</td><td>${rowActions(action, `promotion-${id}`)}</td></tr>`;
        }).join("");
        const voucherRows = vouchers.map((item) => {
          const id = item.id || item._id;
          const action = `<form data-admin-action="voucher-status" data-id="${esc(id)}" data-code="${esc(item.code || "")}" data-discount-value="${esc(item.discountValue ?? "")}"><input type="hidden" name="isActive" value="${item.isActive === false ? "true" : "false"}"><button class="outline" type="submit">${item.isActive === false ? "Kích hoạt" : "Tạm dừng"}</button><p class="form-message" role="status"></p></form>`;
          return `<tr><td>${esc(item.code)} ${demo(item)}</td><td>${esc(item.discountType === "percentage" ? `${item.discountValue}%` : money(item.discountValue))}</td><td>${money(item.minOrderValue || 0)}</td><td>${esc(item.usedCount || 0)} / ${esc(item.totalUsageLimit || "∞")}</td><td>${statusTag(item.isActive === false ? "inactive" : "active", item.isActive === false ? "Tạm dừng" : "Đang hiệu lực")}</td><td>${rowActions(action, `voucher-${id}`)}</td></tr>`;
        }).join("");
        const promotionTable = items.length ? table(["Chương trình", "Nội dung", "Thời hạn", "Trạng thái", "Thao tác"], promotionRows) : "<p class='empty'>Chưa có chương trình khuyến mãi.</p>";
        const voucherTable = vouchers.length ? table(["Mã", "Ưu đãi", "Đơn tối thiểu", "Đã dùng", "Trạng thái", "Thao tác"], voucherRows) : "<p class='empty'>Chưa có voucher.</p>";
        host.innerHTML = `${formBlock("Tạo chương trình giá ưu đãi", "create-promotion", `${formField("Tên chương trình", "name")}${formField("Bắt đầu", "startDate", "date")}${formField("Kết thúc", "endDate", "date")}${selectField("Sản phẩm / phân loại", "variantId", variantOptions)}${formField("Giá khuyến mãi (₫)", "promotionPrice", "number")}`, "Tạo khuyến mãi")}
          ${formBlock("Phát hành voucher", "create-voucher", `${formField("Mã voucher", "code")}${selectField("Kiểu giảm", "discountType", '<option value="percentage">Phần trăm</option><option value="fixed">Số tiền cố định</option>')}${formField("Giá trị giảm", "discountValue", "number")}${formField("Đơn tối thiểu (₫)", "minOrderValue", "number", false)}${formField("Mức giảm tối đa (₫)", "maxDiscountAmount", "number", false)}${formField("Số lượt dùng", "totalUsageLimit", "number", false)}${formField("Bắt đầu", "startDate", "date")}${formField("Kết thúc", "endDate", "date")}`, "Tạo voucher")}
          <section class="panel admin-table-group"><div class="admin-table-group-heading"><div><span class="eyebrow">QUẢN LÝ ƯU ĐÃI</span><h2>Khuyến mãi & voucher</h2></div><span>${items.length + vouchers.length} bản ghi</span></div>
            ${tableSection("GIÁ ƯU ĐÃI THEO SẢN PHẨM", "Khuyến mãi", items.length, promotionTable)}
            ${tableSection("MÃ GIẢM GIÁ", "Voucher", vouchers.length, voucherTable)}
          </section>`;
      });
    }

    async function deliveriesView() {
      await listOrState(() => Promise.all([
        root.MBApi.admin.deliveries.list({ page: 1, limit: 100 }),
        root.MBApi.admin.catalog.list(),
        root.MBApi.orders.list({ page: 1, limit: 100 })
      ]), ([response, catalogResponse, orderResponse]) => {
        const items = rows(response), catalog = data(catalogResponse) || {}, orders = rows(orderResponse).filter((item) => (item.orderStatus || item.status) === "shipped");
        const allOrders = rows(orderResponse), orderById = new Map(allOrders.map((order) => [String(order.id || order._id), order]));
        const stores = (catalog.stores || []).filter((item) => item.isActive !== false).map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");
        const orderOptions = `<option value="" disabled selected>Chọn đơn đã gửi</option>${orders.map((item) => `<option value="${esc(item.id || item._id)}">${esc(item.orderCode || item.id || item._id)}</option>`).join("")}`;
        const next = { ready: ["assigned"], assigned: ["picked_up"], picked_up: ["in_transit"], in_transit: ["delivered", "failed"] };
        const body = items.map((item) => {
          const id = item.id || item._id, options = (next[item.status] || []).map((status) => `<option value="${status}">${esc(statusLabel(status))}</option>`).join("");
          const order = orderById.get(String(item.orderId));
          return `<tr><td>${esc(item.deliveryCode || id || "—")} ${demo(item)}</td><td>${esc(order?.orderCode || item.order?.orderCode || item.orderCode || item.orderId || "—")}</td><td>${esc(item.carrier || "Mô phỏng")}</td><td>${esc(item.trackingCode || "—")}</td><td>${statusTag(item.status)}</td><td>${options ? `<form data-admin-action="delivery-status" data-id="${esc(id)}"><select name="status">${options}</select><button class="outline" type="submit">Cập nhật</button><p class="form-message" role="status"></p></form>` : "—"}</td></tr>`;
        }).join("");
        host.innerHTML = `${formBlock("Tạo yêu cầu giao hàng mô phỏng", "create-delivery", `${selectField("Đơn hàng", "orderId", orderOptions)}${selectField("Cửa hàng", "storeId", stores)}${formField("Địa chỉ giao hàng", "deliveryAddress", "textarea")}`, "Tạo phiếu giao")}
          <section class="panel"><div class="section-head"><div><span class="eyebrow">GIAO NHẬN</span><h2>Phiếu giao hàng</h2></div><span>${items.length} bản ghi</span></div>${items.length ? table(["Mã giao", "Đơn hàng", "Đơn vị", "Mã vận đơn", "Trạng thái", "Cập nhật"], body) : "<p class='empty'>Chưa có phiếu giao hàng.</p>"}<p class="service">Đơn vị vận chuyển và trạng thái đang được mô phỏng trong hệ thống.</p></section>`;
      });
    }

    async function returnsView() {
      await listOrState(() => Promise.all([
        root.MBApi.admin.returns.list({ page: 1, limit: 100 }),
        root.MBApi.orders.list({ page: 1, limit: 100 })
      ]), ([response, orderResponse]) => {
        const items = rows(response), allOrders = rows(orderResponse), orders = allOrders.filter((item) => ["delivered", "completed"].includes(item.orderStatus || item.status));
        const orderById = new Map(allOrders.map((order) => [String(order.id || order._id), order]));
        const orderOptions = `<option value="" disabled selected>Chọn đơn đã giao</option>${orders.map((item) => `<option value="${esc(item.id || item._id)}">${esc(item.orderCode || item.id || item._id)}</option>`).join("")}`;
        const variantOptions = orders.map((order) => `<optgroup label="${esc(order.orderCode || order.id || order._id)}" data-order-id="${esc(order.id || order._id)}">${(order.items || []).map((line) => `<option value="${esc(line.variantId)}" data-max="${esc(line.quantity)}">${esc(line.productName || line.sku || "Sản phẩm")} · tối đa ${esc(line.quantity)}</option>`).join("")}</optgroup>`).join("");
        const next = { requested: ["approved", "rejected"], approved: ["received"], received: ["refunded", "exchanged"] };
        const body = items.map((item) => {
          const id = item.id || item._id, options = (next[item.status] || []).map((status) => `<option value="${status}">${esc(statusLabel(status))}</option>`).join("");
          const order = orderById.get(String(item.orderId));
          return `<tr><td>${esc(item.returnCode || id || "—")} ${demo(item)}</td><td>${esc(order?.orderCode || item.order?.orderCode || item.orderCode || item.orderId || "—")}</td><td>${esc(item.reason || "—")}</td><td>${statusTag(item.status)}</td><td>${esc(item.createdAt ? new Date(item.createdAt).toLocaleDateString("vi-VN") : "—")}</td><td>${options ? `<form data-admin-action="return-status" data-id="${esc(id)}"><select name="status">${options}</select>${item.status === "received" ? formField("Số tiền hoàn (₫)", "refundAmount", "number", false) : ""}<button class="outline" type="submit">Cập nhật</button><p class="form-message" role="status"></p></form>` : "—"}</td></tr>`;
        }).join("");
        host.innerHTML = `${formBlock("Ghi nhận yêu cầu đổi trả", "create-return", `${selectField("Đơn hàng", "orderId", orderOptions)}${selectField("Sản phẩm / phân loại", "variantId", variantOptions)}${formField("Số lượng", "quantity", "number")}${formField("Lý do", "reason", "textarea")}`, "Tạo yêu cầu")}
          <section class="panel returns-panel"><div class="section-head"><div><span class="eyebrow">HẬU MÃI</span><h2>Yêu cầu đổi trả</h2></div><span>${items.length} bản ghi</span></div>${items.length ? table(["Mã đổi trả", "Đơn hàng", "Lý do", "Trạng thái", "Ngày tạo", "Cập nhật"], body) : "<p class='empty'>Chưa có yêu cầu đổi trả.</p>"}<p class="service">Hàng chỉ được nhập lại tồn khi nhân viên xác nhận đã nhận hàng.</p></section>`;
        const returnForm = host.querySelector('[data-admin-action="create-return"]');
        returnForm?.querySelector('[name="orderId"]')?.setAttribute("data-return-order", "");
        returnForm?.querySelector('[name="variantId"]')?.setAttribute("data-return-variant", "");
        if (returnForm) {
          const firstOrder = returnForm.querySelector('[name="orderId"] option:not([disabled])');
          if (firstOrder) {
            returnForm.querySelector('[name="orderId"]').value = firstOrder.value;
            const groups = [...returnForm.querySelectorAll('[name="variantId"] optgroup')];
            const group = groups.find((item) => item.dataset.orderId === firstOrder.value);
            groups.forEach((item) => { item.hidden = item !== group; });
            if (group?.querySelector("option")) {
              const variantSelect = returnForm.querySelector('[name="variantId"]');
              variantSelect.value = group.querySelector("option").value;
              returnForm.querySelector('[name="quantity"]').max = group.querySelector("option").dataset.max || "1";
            }
          }
        }
      });
    }

    function openWorkflowEditor(button) {
      const editorHost = host.querySelector("#admin-workflow-editor");
      if (!editorHost) return;
      host.querySelectorAll(".admin-record-action").forEach((action) => {
        action.classList.remove("is-active");
        action.setAttribute("aria-expanded", "false");
      });
      button.classList.add("is-active");
      button.setAttribute("aria-expanded", "true");
      const isOrder = button.hasAttribute("data-admin-order-update");
      const status = button.dataset.status || "";
      const nextStatuses = (button.dataset.nextStatuses || "").split(",").filter(Boolean);
      const canEdit = isOrder ? nextStatuses.length > 0 : nextStatuses.length > 0 || status === "completed";
      const action = isOrder ? "order-status" : "appointment-status";
      const identifier = button.dataset.id;
      const title = isOrder ? (canEdit ? "Cập nhật đơn hàng" : "Trạng thái đơn hàng") : (canEdit ? "Cập nhật lịch hẹn" : "Thông tin lịch hẹn");
      const eyebrow = isOrder ? "XỬ LÝ ĐƠN HÀNG" : "TƯ VẤN CÁ NHÂN";
      const description = isOrder
        ? (canEdit ? `Cập nhật tiến độ cho đơn ${button.dataset.orderCode || "này"}.` : "Đơn đã kết thúc và không còn bước xử lý tiếp theo.")
        : (canEdit ? "Cập nhật trạng thái, ghi chú và kết quả tư vấn." : "Lịch hẹn đã kết thúc; thông tin được giữ để tra cứu.");
      const icon = isOrder
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v14A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V5.5A1.5 1.5 0 0 0 18.5 4H16"/><path d="M9 3h6v4H9zM8 13h8m-8 4h5"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-14 5 2.5 2.5L15 12"/></svg>';
      const statusOptions = isOrder || status !== "completed"
        ? nextStatuses.map((item) => `<option value="${esc(item)}">${esc(statusLabel(item))}</option>`).join("")
        : `<option value="completed" selected>Hoàn tất · giữ nguyên</option>`;
      const statusField = `<label class="field"><span>${isOrder ? "Trạng thái tiếp theo" : "Trạng thái lịch hẹn"}</span><select name="status">${statusOptions}</select></label>`;
      const fields = isOrder ? statusField : `${statusField}<label class="field workflow-wide"><span>Ghi chú nhân viên</span><textarea name="employeeNote" rows="3" placeholder="Trao đổi với khách hàng…">${esc(button.dataset.employeeNote || "")}</textarea></label><label class="field workflow-wide"><span>Kết quả tư vấn</span><textarea name="consultationResult" rows="3" placeholder="Ghi lại hướng chăm sóc được đề xuất…">${esc(button.dataset.consultationResult || "")}</textarea></label>`;
      const terminal = isOrder
        ? `<div class="admin-workflow-state"><span>Trạng thái hiện tại</span>${statusTag(status)}</div>`
        : `<div class="admin-workflow-state"><span>Trạng thái hiện tại</span>${statusTag(status)}<div><b>Ghi chú nhân viên</b><p>${esc(button.dataset.employeeNote || "Chưa có ghi chú.")}</p></div><div><b>Kết quả tư vấn</b><p>${esc(button.dataset.consultationResult || "Chưa có kết quả.")}</p></div></div>`;
      const editor = root.document.createElement("section");
      editor.className = "panel admin-workflow-editor";
      editor.setAttribute("aria-labelledby", "admin-workflow-title");
      editor.innerHTML = `<button class="admin-workflow-close" type="button" data-workflow-close aria-label="Đóng phần cập nhật"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><div class="admin-workflow-layout"><header class="admin-workflow-heading"><span class="admin-create-icon" aria-hidden="true">${icon}</span><div><span class="eyebrow">${eyebrow}</span><h2 id="admin-workflow-title">${title}</h2><p>${description}</p></div></header>${canEdit ? `<form class="admin-workflow-form" data-admin-action="${action}" data-id="${esc(identifier)}"><div class="admin-workflow-fields">${fields}</div><div class="admin-workflow-footer"><p class="form-message" role="status" aria-live="polite"></p><button class="outline" type="button" data-workflow-close>Hủy</button><button class="btn" type="submit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span>Lưu cập nhật</span></button></div></form>` : `${terminal}<div class="admin-workflow-footer"><span class="admin-muted-note">Không cần thao tác thêm.</span><button class="btn" type="button" data-workflow-close>Đóng</button></div>`}</div>`;
      editorHost.replaceChildren(editor);
      editor.querySelectorAll("[data-workflow-close]").forEach((control) => control.addEventListener("click", () => {
        editor.remove();
        button.classList.remove("is-active");
        button.setAttribute("aria-expanded", "false");
        if (button.isConnected) button.focus();
      }));
      const reduceMotion = root.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      editor.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      editor.querySelector("select, textarea")?.focus({ preventScroll: true });
    }

    async function editResource(button) {
      const type = button.dataset.adminEdit;
      const schemas = {
        promotion: { title: "Chỉnh sửa chương trình", fields: [{ name: "name", label: "Tên chương trình", value: button.dataset.name }] },
        voucher: { title: "Chỉnh sửa voucher", fields: [
          { name: "code", label: "Mã voucher", value: button.dataset.code },
          { name: "discountValue", label: "Giá trị giảm", type: "number", value: button.dataset.discountValue }
        ] },
        catalog: { title: "Chỉnh sửa danh mục", fields: [{ name: "name", label: "Tên danh mục hoặc thương hiệu", value: button.dataset.name }] }
      };
      const schema = schemas[type];
      if (!schema || !root.document.createElement || typeof root.HTMLDialogElement === "undefined") return;
      const dialog = root.document.createElement("dialog");
      dialog.className = "admin-dialog";
      dialog.setAttribute("aria-labelledby", "admin-editor-title");
      dialog.innerHTML = `<form class="admin-dialog-form"><div class="admin-dialog-heading"><span class="eyebrow">MAISON BELLE · STUDIO</span><h2 id="admin-editor-title">${esc(schema.title)}</h2><p>Thông tin sẽ được cập nhật ngay sau khi lưu.</p></div>${schema.fields.map((field) => `<label class="field">${esc(field.label)}<input name="${field.name}" type="${field.type || "text"}" value="${esc(field.value || "")}" ${field.type === "number" ? 'min="0" step="any"' : ""} required></label>`).join("")}<p class="form-message" role="status" aria-live="polite"></p><div class="admin-dialog-actions"><button class="outline" type="button" data-dialog-close>Hủy</button><button class="btn" type="submit">Lưu thay đổi</button></div></form>`;
      root.document.body.append(dialog);
      let saving = false;
      dialog.addEventListener("close", () => {
        dialog.remove();
        if (!saving && button.isConnected) button.focus();
      }, { once: true });
      dialog.querySelector("[data-dialog-close]").addEventListener("click", () => dialog.close());
      dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
      dialog.querySelector("form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const submit = form.querySelector('[type="submit"]');
        const message = form.querySelector(".form-message");
        const values = Object.fromEntries(new FormData(form).entries());
        submit.disabled = true;
        message.textContent = "Đang lưu…";
        saving = true;
        try {
          if (type === "promotion") await root.MBApi.admin.promotions.update(button.dataset.id, { name: values.name });
          else if (type === "voucher") await root.MBApi.admin.vouchers.update(button.dataset.id, { code: values.code, discountValue: Number(values.discountValue) });
          else await root.MBApi.admin.catalog.update(button.dataset.kind, button.dataset.id, { name: values.name });
          root.MB.toast("Đã cập nhật bản ghi.", "success");
          dialog.close();
          await renderView();
        } catch (error) {
          saving = false;
          message.textContent = root.MB.errorMessage(error);
          submit.disabled = false;
        }
      });
      dialog.showModal();
      dialog.querySelector("input")?.focus();
    }

    async function submitAction(form) {
      const action = form.dataset.adminAction;
      const values = Object.fromEntries(new FormData(form).entries());
      const message = form.querySelector(".form-message");
      const button = form.querySelector("[type=submit]");
      const destructive = ["remove-product", "remove-promotion", "remove-voucher", "remove-catalog"].includes(action);
      const confirmMessage = "Thao tác này sẽ ẩn bản ghi khỏi hoạt động. Bạn có chắc chắn không?";
      if (destructive && typeof root.confirm === "function" && !root.confirm(confirmMessage)) return;
      if (destructive && typeof root.confirm !== "function" && typeof root.window?.confirm === "function" && !root.window.confirm(confirmMessage)) return;
      button.disabled = true;
      if (message) message.textContent = "Đang lưu…";
      try {
       if (action === "create-product") {
          const imageUrl = await readImageFile(values.image);
          const body = crudActionPayload(action, { ...values, slug: productSlug(values.name), imageUrl });
         await root.MBApi.admin.products.create(body);
       } else if (action === "update-product") {
          const imageUrl = await readImageFile(values.image);
          await root.MBApi.admin.products.update(form.dataset.id, crudActionPayload(action, { ...values, imageUrl }));
       } else if (action === "toggle-product") await root.MBApi.admin.products.update(form.dataset.id, crudActionPayload(action, values));
        else if (action === "remove-product") await root.MBApi.admin.products.remove(form.dataset.id);
        else if (action === "order-status") await root.MBApi.orders.updateStatus(form.dataset.id, { status: values.status });
        else if (action === "appointment-status") await root.MBApi.appointments.update(form.dataset.id, { status: values.status, employeeNote: values.employeeNote, consultationResult: values.consultationResult });
        else if (action === "stock-receipt") await root.MBApi.admin.receiveStock({ storeId: values.storeId, items: [{ variantId: values.variantId, quantity: Number(values.quantity), unitCost: Number(values.unitCost || 0), note: values.note }] });
        else if (action === "stock-adjustment") await root.MBApi.admin.adjustStock({ storeId: values.storeId, variantId: values.variantId, quantity: Number(values.quantity), note: values.note });
        else if (action === "create-promotion") await root.MBApi.admin.promotions.create({ name: values.name, startDate: values.startDate, endDate: values.endDate, isActive: true, items: [{ variantId: values.variantId, promotionPrice: Number(values.promotionPrice) }] });
        else if (action === "promotion-status") await root.MBApi.admin.promotions.update(form.dataset.id, crudActionPayload(action, values));
        else if (action === "remove-promotion") await root.MBApi.admin.promotions.remove(form.dataset.id);
        else if (action === "create-voucher") await root.MBApi.admin.vouchers.create({ code: values.code, discountType: values.discountType, discountValue: Number(values.discountValue), minOrderValue: Number(values.minOrderValue || 0), ...(values.maxDiscountAmount ? { maxDiscountAmount: Number(values.maxDiscountAmount) } : {}), ...(values.totalUsageLimit ? { totalUsageLimit: Number(values.totalUsageLimit) } : {}), startDate: values.startDate, endDate: values.endDate, isActive: true });
        else if (action === "voucher-status") await root.MBApi.admin.vouchers.update(form.dataset.id, crudActionPayload(action, values));
        else if (action === "remove-voucher") await root.MBApi.admin.vouchers.remove(form.dataset.id);
        else if (action === "create-delivery") await root.MBApi.admin.deliveries.create(values);
        else if (action === "delivery-status") await root.MBApi.admin.deliveries.update(form.dataset.id, { status: values.status });
        else if (action === "create-return") await root.MBApi.admin.returns.create({ orderId: values.orderId, reason: values.reason, items: [{ variantId: values.variantId, quantity: Number(values.quantity) }] });
        else if (action === "return-status") await root.MBApi.admin.returns.update(form.dataset.id, { status: values.status, ...(values.refundAmount ? { refundAmount: Number(values.refundAmount) } : {}) });
        else if (action === "create-category") await root.MBApi.admin.catalog.create("categories", { name: values.name, slug: values.slug, description: values.description });
        else if (action === "create-brand") await root.MBApi.admin.catalog.create("brands", { name: values.name, code: values.code, slug: values.slug, origin: values.origin });
        else if (action === "catalog-status") await root.MBApi.admin.catalog.update(form.dataset.kind, form.dataset.id, crudActionPayload(action, values));
        else if (action === "remove-catalog") await root.MBApi.admin.catalog.remove(form.dataset.kind, form.dataset.id);
        root.MB.toast("Đã gửi yêu cầu đến hệ thống.", "success");
        await renderView();
      } catch (error) {
        if (message) message.textContent = root.MB.errorMessage(error);
        if (error.status === 403) root.MB.toast("Không đủ quyền cho thao tác này.", "error");
      } finally { button.disabled = false; }
    }

    host.addEventListener("submit", async (event) => {
      const dashboardForm = event.target.closest("#dashboard-filter");
      if (dashboardForm) {
        event.preventDefault();
        await dashboardView(Object.fromEntries(new FormData(dashboardForm).entries()));
        return;
      }
      const searchForm = event.target.closest("form[data-admin-search]");
      if (searchForm) {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(searchForm).entries());
        await customersView(values);
        return;
      }
      const form = event.target.closest("form[data-admin-action]");
      if (!form) return;
      event.preventDefault();
      await submitAction(form);
    });
   host.addEventListener("change", (event) => {
      const imageInput = event.target.closest("[data-image-input]");
      if (imageInput) {
        const file = imageInput.files?.[0];
        const name = imageInput.closest(".image-upload")?.querySelector("[data-image-name]");
        if (name) name.textContent = file ? file.name : "Giữ ảnh hiện tại nếu không chọn tệp mới.";
        const preview = imageInput.closest(".image-upload")?.querySelector(".image-upload-preview");
        if (file && preview && root.URL?.createObjectURL) preview.src = root.URL.createObjectURL(file);
      }
     const orderSelect = event.target.closest("[data-return-order]");
      const variantSelect = orderSelect?.form.querySelector("[data-return-variant]") || event.target.closest("[data-return-variant]");
      if (orderSelect && variantSelect) {
        const groups = [...variantSelect.querySelectorAll("optgroup")];
        const group = groups.find((item) => item.dataset.orderId === orderSelect.value);
        groups.forEach((item) => { item.hidden = item !== group; });
        variantSelect.value = group?.querySelector("option")?.value || "";
        const quantity = variantSelect.form.querySelector('[name="quantity"]');
        quantity.max = variantSelect.selectedOptions[0]?.dataset.max || "1";
        quantity.value = "1";
      }
      if (event.target.matches("[data-return-variant]")) {
        const quantity = event.target.form.querySelector('[name="quantity"]');
        quantity.max = event.target.selectedOptions[0]?.dataset.max || "1";
        quantity.value = "1";
      }
    });
   host.addEventListener("click", async (event) => {
      if (event.target.closest?.("#admin-export-report")) {
        exportDashboardReport();
        return;
      }
      const actionTrigger = event.target.closest?.(".admin-row-actions-trigger");
      if (actionTrigger) {
        const schedule = root.requestAnimationFrame || ((callback) => root.setTimeout(callback, 0));
        schedule(() => positionActionPopover(actionTrigger));
      }
      const closeEditor = event.target.closest("[data-product-editor-close]");
      if (closeEditor) {
        closeEditor.closest("details")?.removeAttribute("open");
        return;
      }
     if (event.target.closest("[data-admin-retry]")) renderView();
      const demoButton = event.target.closest("[data-demo-email]");
      if (demoButton) {
        host.querySelector("#staff-login [name=email]").value = demoButton.dataset.demoEmail;
        host.querySelector("#staff-login [name=password]").value = "Demo@123";
      }
      const editButton = event.target.closest("[data-admin-edit]");
      if (editButton) {
        await editResource(editButton);
        return;
      }
      const workflowButton = event.target.closest("[data-admin-order-update], [data-admin-appointment-update]");
      if (workflowButton) {
        openWorkflowEditor(workflowButton);
        return;
      }
      const detailButton = event.target.closest("[data-admin-order-detail]");
      if (detailButton) {
        const detailHost = host.querySelector("#admin-order-detail");
        state(detailHost, "loading", "Đang tải thông tin đơn và hóa đơn…");
        try {
          const order = data(await root.MBApi.orders.get(detailButton.dataset.adminOrderDetail)) || {};
          const lines = order.items || [];
          const lineRows = lines.map((item) => `<tr><td>${esc(item.productName || "Sản phẩm")}</td><td>${esc(item.sku || "—")}</td><td>${esc(item.quantity || 0)}</td><td>${money(item.unitPrice || 0)}</td></tr>`).join("");
          const invoice = order.invoice || {};
          const payment = order.payment || {};
          detailHost.innerHTML = `<section class="panel"><span class="eyebrow">CHI TIẾT ĐƠN ${demo(order)}</span><h2>${esc(order.orderCode || "Đơn hàng")}</h2>${lines.length ? table(["Sản phẩm", "SKU", "Số lượng", "Đơn giá"], lineRows) : "<p>Đơn chưa có mặt hàng.</p>"}<p>Thanh toán: ${esc(payment.status || order.paymentStatus || "—")} · ${esc(payment.method || order.paymentMethod || "—")}</p><p>Hóa đơn: ${esc(invoice.invoiceCode || "Chưa phát hành")} · ${esc(invoice.status || "—")} · ${money(invoice.amount || order.finalAmount || 0)}</p><p>Địa chỉ: ${esc(order.shippingAddress?.fullAddress || "—")}</p></section>`;
        } catch (error) { errorState(detailHost, error); }
      }
    });
    async function start() {
      try {
        const user = data(await root.MBApi.auth.me()) || {};
        currentRole = pickRole(user);
        if (!params.has("view")) view = defaultView(currentRole);
        syncNav();
        const staffName = user.fullName || user.name || user.email || "Nhân viên";
        const roleLabels = { manager: "Quản trị viên", admin: "Quản trị viên", sales: "Nhân viên bán hàng", warehouse: "Nhân viên kho" };
        const nameNode = root.document.querySelector("#staff-name");
        const roleNode = root.document.querySelector("#staff-role");
        if (nameNode) nameNode.textContent = staffName;
        if (roleNode) roleNode.textContent = roleLabels[currentRole] || "Nhân viên";
        const initials = String(staffName).replace(/@.*$/, "").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
        const avatar = root.document.querySelector("#staff-avatar");
        if (avatar) avatar.textContent = currentRole === "manager" && /demo/i.test(staffName) ? "MD" : initials || "MB";
        await renderView();
      } catch (error) {
        if (error.status === 401) login();
        else errorState(host, error);
      }
    }
    start();
  }

  return { canAccess, defaultView, pickRole, reportFields, reportSummaryEntries, formatReportDate, dashboardMetrics, reportChartData, crudActionPayload, rowActions, actionPopoverPosition, bind };
});
