(function (root, factory) {
  const admin = factory(root);
  if (typeof module === "object" && module.exports) module.exports = admin;
  if (root && root.document) root.document.addEventListener("DOMContentLoaded", () => admin.bind());
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  const esc = (value) => root.MB?.escape ? root.MB.escape(value) : String(value ?? "");
  const roleViews = {
    manager: ["dashboard", "products", "orders", "customers", "appointments", "promotions", "inventory", "deliveries", "returns", "reports", "master-data"],
    sales: ["products", "orders", "customers", "appointments", "promotions", "deliveries", "returns"],
    warehouse: ["products", "inventory", "deliveries"]
  };
  const titles = {
    dashboard: "Tổng quan", products: "Sản phẩm", orders: "Đơn hàng & hóa đơn", customers: "Khách hàng & hội viên",
    appointments: "Tư vấn & lịch hẹn", promotions: "Khuyến mãi & voucher", inventory: "Tồn kho & nhập hàng",
    deliveries: "Giao hàng", returns: "Đổi trả", reports: "Báo cáo", "master-data": "Danh mục & thương hiệu"
  };

  function pickRole(user = {}) {
    const role = user.role?.name || user.roleName || user.role || "";
    return String(role).toLowerCase();
  }
  function canAccess(role, view) { return (roleViews[String(role).toLowerCase()] || []).includes(view); }
  function defaultView(role, requested = "") {
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
    return `<label class="field">${label}${control}</label>`;
  }
  function imageField(label, currentUrl = "") {
    const preview = currentUrl ? '<img class="image-upload-preview" src="' + esc(currentUrl) + '" alt="Ảnh hiện tại">' : "";
    return '<label class="field image-upload"><span>' + label + '</span><input type="file" name="image" accept="image/*" data-image-input><small data-image-name>' + (currentUrl ? "Giữ ảnh hiện tại nếu không chọn tệp mới." : "PNG, JPG hoặc WEBP · tối đa 700KB") + '</small>' + preview + '</label>';
  }
  function selectField(label, name, options, required = true) {
    return `<label class="field">${label}<select name="${name}" ${required ? "required" : ""}>${options}</select></label>`;
  }
  function formBlock(title, action, fields, submit) {
    return `<section class="panel form-panel"><h2>${title}</h2><form data-admin-action="${action}" class="form-grid">${fields}<button class="btn" type="submit">${submit}</button><p class="form-message" role="status"></p></form></section>`;
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
    const syncNav = () => {
      title.textContent = titles[view];
      root.document.querySelectorAll("[data-nav-view]").forEach((link) => {
        link.classList.toggle("active", link.dataset.navView === view);
        link.hidden = Boolean(currentRole && !canAccess(currentRole, link.dataset.navView));
      });
    };
    syncNav();
    root.document.querySelector("#today").textContent = new Intl.DateTimeFormat("vi-VN", { dateStyle: "long" }).format(new Date());
    const layout = root.document.querySelector(".admin-layout");
    const side = root.document.querySelector("#side");
    const sidebarLogo = root.document.querySelector("#sidebar-logo");
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
    root.document.querySelector("#open-side")?.addEventListener("click", () => side?.classList.toggle("open"));

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
      if (!report || !["dashboard", "reports"].includes(view) || host.querySelector("#daily-sales-chart")) return;
      const chart = reportChartData(report);
      const daily = chart.dailySales.length
        ? chart.dailySales.map((item) => {
          const width = Math.round(item.revenue / chart.maxRevenue * 100);
          return `<div class="report-bar"><span>${esc(item.date)}</span><div class="report-bar-track"><i class="report-bar-fill" style="--bar-width:${width}%"></i></div><b>${money(item.revenue)}</b><small>${esc(item.orderCount)} đơn</small></div>`;
        }).join("")
        : '<p class="empty">Chưa có doanh thu trong khoảng thời gian này.</p>';
      const statuses = chart.orderStatuses.length
        ? chart.orderStatuses.map((item) => `<div class="report-status"><span>${esc(item.status)}</span><b>${esc(item.count)} đơn</b><strong>${money(item.amount)}</strong></div>`).join("")
        : '<p class="empty">Chưa có trạng thái đơn hàng.</p>';
      host.insertAdjacentHTML("beforeend", `<div class="report-grid"><section class="panel report-chart" id="daily-sales-chart"><div class="section-head"><div><span class="eyebrow">DOANH THU THEO NGÀY</span><h2>Xu hướng bán hàng</h2></div></div>${daily}</section><section class="panel report-chart" id="order-status-chart"><div class="section-head"><div><span class="eyebrow">TRẠNG THÁI ĐƠN</span><h2>Phân bổ vận hành</h2></div></div>${statuses}</section></div>`);
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
      add('form[data-admin-action="toggle-product"]', "remove-product", (form) => ({ id: form.dataset.id }), "ẨN SẢN PHẨM");
      add('form[data-admin-action="promotion-status"]', "remove-promotion", (form) => ({ id: form.dataset.id }), "XÓA");
      add('form[data-admin-action="voucher-status"]', "remove-voucher", (form) => ({ id: form.dataset.id }), "XÓA");
      add('form[data-admin-action="catalog-status"]', "remove-catalog", (form) => ({ kind: form.dataset.kind, id: form.dataset.id }), "XÓA");
      const addEdit = (selector, type, extra = () => ({})) => host.querySelectorAll(selector).forEach((source) => {
        if (source.parentElement?.querySelector(`[data-admin-edit="${type}"]`)) return;
        const attrs = Object.entries({ id: source.dataset.id, ...extra(source) }).map(([key, value]) => `data-${key}="${esc(value)}"`).join(" ");
        source.insertAdjacentHTML("afterend", `<button class="outline" type="button" data-admin-edit="${type}" ${attrs}>CHỈNH SỬA</button>`);
      });
      addEdit('form[data-admin-action="promotion-status"]', "promotion");
      addEdit('form[data-admin-action="voucher-status"]', "voucher");
      addEdit('form[data-admin-action="catalog-status"]', "catalog", (form) => ({ kind: form.dataset.kind }));
      renderReportCharts();
    }

    async function listOrState(fetcher, render) {
      state(host, "loading", "Đang tải dữ liệu vận hành…");
      try { await render(await fetcher()); decorateCrudView(); }
      catch (error) { errorState(host, error); }
    }

    async function renderView() {
      if (!canAccess(currentRole, view)) { state(host, "forbidden", "Vai trò hiện tại không được cấp quyền xem mục này."); return; }
      if (view === "dashboard") return dashboardView();
      if (view === "reports") return reportView();
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

    async function reportView(query = {}) {
      const today = new Date().toISOString().slice(0, 10);
      const thirtyDaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const from = query.from || thirtyDaysAgo, to = query.to || today;
      await listOrState(() => Promise.all([root.MBApi.admin.reports({ from, to, storeId: query.storeId || "" }), root.MBApi.admin.catalog.list()]), ([response, catalogResponse]) => {
        const report = data(response) || {}, catalog = data(catalogResponse) || {};
        root.__mbAdminReport = report;
        const storeOptions = `<option value="">Tất cả cửa hàng</option>${(catalog.stores || []).map((store) => `<option value="${esc(store.id)}" ${store.id === query.storeId ? "selected" : ""}>${esc(store.name)}</option>`).join("")}`;
        const filter = `<section class="panel"><form id="report-filter" class="form-grid"><label class="field">Từ ngày<input type="date" name="from" value="${esc(from)}" required></label><label class="field">Đến ngày<input type="date" name="to" value="${esc(to)}" required></label>${selectField("Cửa hàng", "storeId", storeOptions, false)}<button class="btn" type="submit">XEM BÁO CÁO</button></form></section>`;
        const entries = reportSummaryEntries(report);
        if (!entries.length && !Object.keys(report).length) { state(host, "empty", "Chưa có chỉ số báo cáo từ máy chủ."); return; }
        const cards = entries.map(({ label, value, money: isMoney }) => `<article class="stat"><small>${esc(label)}</small><b>${isMoney ? money(value) : esc(value)}</b></article>`).join("");
        const chart = reportChartData(report);
        const topProducts = Array.isArray(report.topProducts) ? report.topProducts : [];
        const topRows = topProducts.map((item) => `<tr><td>${esc(item.name || item.productName || "—")}</td><td>${esc(item.quantity || 0)}</td><td>${money(item.revenue || 0)}</td></tr>`).join("");
        const statusRows = chart.orderStatuses.map((item) => `<div class="report-detail-status"><span>${esc(item.status)}</span><b>${esc(item.count)} đơn</b><strong>${money(item.amount)}</strong></div>`).join("");
        const period = `<p class="report-period">Kỳ dữ liệu: <strong>${esc(formatReportDate(report.from || from))}</strong> – <strong>${esc(formatReportDate(report.to || to))}</strong></p>`;
        const detail = `<section class="panel report-detail-panel"><div class="section-head"><div><span class="eyebrow">CHI TIẾT KỲ BÁO CÁO</span><h2>Phân tích hoạt động</h2></div><span>Dữ liệu trực tiếp từ MongoDB</span></div>${period}<div class="report-detail-grid"><section class="report-detail-block"><h3>Sản phẩm bán chạy</h3>${topProducts.length ? table(["Sản phẩm", "Số lượng", "Doanh thu"], topRows) : "<p class='empty'>Chưa có dữ liệu sản phẩm trong kỳ.</p>"}</section><section class="report-detail-block"><h3>Trạng thái đơn hàng</h3>${statusRows || "<p class='empty'>Chưa có dữ liệu trạng thái đơn.</p>"}</section></div></section>`;
        host.innerHTML = `${filter}<section class="stats">${cards}</section><div class="admin-content"><section class="panel report-summary-panel"><span class="eyebrow">BÁO CÁO TỪ API</span><h2>${view === "dashboard" ? "Tổng quan cửa hàng" : "Phân tích hoạt động"}</h2><p>Chỉ số hiển thị được trả trực tiếp từ máy chủ; không có số liệu mẫu.</p>${period}</section>${detail}</div>`;
      });
    }

    async function dashboardView(query = {}) {
      const today = new Date().toISOString().slice(0, 10);
      const thirtyDaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const from = query.from || thirtyDaysAgo, to = query.to || today;
      await listOrState(() => Promise.all([
        root.MBApi.admin.reports({ from, to }),
        root.MBApi.admin.products.list({ page: 1, limit: 1 }),
        root.MBApi.orders.list({ page: 1, limit: 1 }),
        root.MBApi.admin.inventory(),
        root.MBApi.admin.vouchers.list({ page: 1, limit: 1 }),
        root.MBApi.admin.promotions.list({ page: 1, limit: 1 }),
        root.MBApi.admin.deliveries.list({ page: 1, limit: 1 })
      ]), ([reportResponse, products, orders, inventory, vouchers, promotions, deliveries]) => {
        const report = responsePayload(reportResponse);
        root.__mbAdminReport = report;
        const metrics = dashboardMetrics({ report, products, orders, inventory, vouchers, promotions, deliveries });
        const filter = `<section class="panel"><div class="section-head"><div><span class="eyebrow">DỮ LIỆU TRỰC TIẾP</span><h2>Tổng quan vận hành</h2></div><span>Đồng bộ từ MongoDB qua API</span></div><form id="dashboard-filter" class="form-grid"><label class="field">Từ ngày<input type="date" name="from" value="${esc(from)}" required></label><label class="field">Đến ngày<input type="date" name="to" value="${esc(to)}" required></label><button class="btn" type="submit">CẬP NHẬT DASHBOARD</button></form></section>`;
        const cards = [
          ["Doanh thu kỳ", money(metrics.revenue)],
          ["Đơn trong kỳ", metrics.orderCount],
          ["Sản phẩm", metrics.productCount],
          ["Dòng tồn kho", metrics.inventoryCount],
          ["Voucher", metrics.voucherCount],
          ["Khuyến mãi", metrics.promotionCount],
          ["Giao hàng", metrics.deliveryCount]
        ].map(([label, value]) => `<article class="stat"><small>${esc(label)}</small><b>${esc(value)}</b></article>`).join("");
        const topProducts = Array.isArray(report.topProducts) ? report.topProducts : [];
        const topRows = topProducts.map((item) => `<tr><td>${esc(item.name || "—")}</td><td>${esc(item.quantity || 0)}</td><td>${money(item.revenue || 0)}</td></tr>`).join("");
        const links = [
          ["products", "Quản lý sản phẩm"], ["orders", "Xử lý đơn hàng"], ["inventory", "Nhập và kiểm kê kho"],
          ["promotions", "Voucher & khuyến mãi"], ["deliveries", "Theo dõi giao hàng"], ["reports", "Mở báo cáo chi tiết"]
        ].map(([target, label]) => `<a class="dashboard-action" href="admin.html?view=${target}"><span>${esc(label)}</span><b>→</b></a>`).join("");
        host.innerHTML = `${filter}<section class="stats">${cards}</section><div class="dashboard-grid"><section class="panel"><div class="section-head"><div><span class="eyebrow">BÁN CHẠY TRONG KỲ</span><h2>Sản phẩm nổi bật</h2></div><span>${esc(metrics.itemCount)} sản phẩm đã bán</span></div>${topProducts.length ? table(["Sản phẩm", "Số lượng", "Doanh thu"], topRows) : "<p class='empty'>Chưa có dữ liệu bán hàng trong kỳ.</p>"}</section><section class="panel"><div class="section-head"><div><span class="eyebrow">THAO TÁC NHANH</span><h2>Vận hành cửa hàng</h2></div></div><div class="dashboard-actions">${links}</div></section></div>`;
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
          return `<tr><td>${esc(item.name || item.productName || "—")} ${demo(item)}</td><td>${esc(item.brandName || brandNames.get(String(item.brandId)) || "—")}</td><td>${esc(item.categoryName || categoryNames.get(String(item.categoryId)) || "—")}</td><td>${money(variant.retailPrice ?? item.price ?? 0)}</td><td>${esc(item.isActive === false ? "Ngừng bán" : "Đang bán")}</td><td>${actions}</td></tr>`;
        }).join("");
        host.innerHTML = `${canWrite ? formBlock("Thêm sản phẩm", "create-product", `${formField("Tên sản phẩm", "name")}${formField("Mã SKU phân loại", "sku")}${selectField("Thương hiệu", "brandId", brandOptions)}${selectField("Danh mục", "categoryId", categoryOptions)}${formField("Dung tích / phân loại", "volume", "text", false)}${formField("Giá gốc (₫)", "originalPrice", "number")}${formField("Giá bán lẻ (₫)", "retailPrice", "number")}${formField("Mô tả", "description", "textarea", false)}${imageField("Ảnh sản phẩm")}`, "TẠO SẢN PHẨM") : ""}
          <section class="panel"><div class="section-head"><div><span class="eyebrow">DANH MỤC HIỆN HÀNH</span><h2>Sản phẩm</h2></div><span>${products.length} bản ghi</span></div>${products.length ? table(["Sản phẩm", "Thương hiệu", "Danh mục", "Giá", "Trạng thái", "Thao tác"], body) : "<p class='empty'>Chưa có sản phẩm từ máy chủ.</p>"}</section>`;
      });
    }

    async function ordersView() {
      await listOrState(() => root.MBApi.orders.list({ page: 1, limit: 100 }), (response) => {
        const orders = rows(response);
        const next = { pending: ["confirmed", "cancelled"], confirmed: ["processing", "cancelled"], processing: ["shipped", "cancelled"], shipped: ["delivered"], delivered: ["completed", "returned"] };
        const statusLabel = { confirmed: "Xác nhận", processing: "Đang xử lý", shipped: "Đã gửi", delivered: "Đã giao", completed: "Hoàn tất", cancelled: "Hủy", returned: "Đã trả" };
        const body = orders.map((item) => {
          const id = item.id || item._id, current = item.orderStatus || item.status || "pending";
          const options = (next[current] || []).map((status) => `<option value="${status}">${statusLabel[status]}</option>`).join("");
          return `<tr><td>${esc(item.orderCode || item.code || id || "—")} ${demo(item)}<br><button class="textlink" type="button" data-admin-order-detail="${esc(id)}">Chi tiết & hóa đơn</button></td><td>${esc(item.customerName || item.customer?.fullName || item.customer?.name || item.user?.email || "—")}</td><td>${money(item.finalAmount ?? item.totalAmount ?? item.total ?? 0)}</td><td><span class="tag">${esc(current)}</span></td><td>${options ? `<form data-admin-action="order-status" data-id="${esc(id)}"><select name="status">${options}</select><button class="outline" type="submit">Cập nhật</button><p class="form-message" role="status"></p></form>` : "—"}</td></tr>`;
        }).join("");
        host.innerHTML = `<section class="panel"><div class="section-head"><div><span class="eyebrow">XỬ LÝ ĐƠN</span><h2>Đơn hàng & hóa đơn</h2></div><span>${orders.length} bản ghi</span></div>${orders.length ? table(["Mã đơn", "Khách hàng", "Tổng tiền", "Trạng thái", "Cập nhật"], body) : "<p class='empty'>Chưa có đơn hàng từ máy chủ.</p>"}<div id="admin-order-detail"></div><p class="service">Thanh toán qua cổng ngân hàng và hóa đơn thuế thật nằm ngoài bản mô phỏng.</p></section>`;
      });
    }

    async function customersView(query = {}) {
      const term = query.q || "";
      const search = `<section class="panel"><form data-admin-search="customers" class="form-grid"><label class="field">Tìm theo tên, email hoặc điện thoại<input name="q" value="${esc(term)}" type="search"></label><button class="btn" type="submit">TÌM KHÁCH HÀNG</button></form></section>`;
      await listOrState(() => root.MBApi.admin.customers.list({ q: term, page: 1, limit: 100 }), (response) => {
        const items = rows(response);
        const body = items.map((item) => `<tr><td>${esc(item.fullName || "—")} ${demo(item)}</td><td>${esc(item.email || "—")}</td><td>${esc(item.phone || "—")}</td><td>${esc(item.membership?.tier || "bronze")}</td><td>${esc(item.membership?.pointsBalance ?? 0)}</td></tr>`).join("");
        host.innerHTML = `${search}<section class="panel"><div class="section-head"><div><span class="eyebrow">HỒ SƠ KHÁCH HÀNG</span><h2>Khách hàng & hội viên</h2></div><span>${items.length} bản ghi</span></div>${items.length ? table(["Khách hàng", "Email", "Điện thoại", "Hạng", "Điểm hiện có"], body) : "<p class='empty'>Không tìm thấy khách hàng phù hợp.</p>"}</section>`;
      });
    }

    async function masterDataView() {
      await listOrState(() => root.MBApi.admin.catalog.list(), (response) => {
        const catalog = data(response) || {}, categories = catalog.categories || [], brands = catalog.brands || [], stores = catalog.stores || [];
        const rowsFor = (items, kind) => items.map((item) => `<tr><td>${esc(item.name || "—")} ${demo(item)}</td><td>${esc(item.slug || item.code || item.origin || "—")}</td><td>${esc(item.isActive === false ? "Đã ẩn" : "Đang dùng")}</td><td><form data-admin-action="catalog-status" data-kind="${kind}" data-id="${esc(item.id)}"><input type="hidden" name="isActive" value="${item.isActive === false ? "true" : "false"}"><button class="outline" type="submit">${item.isActive === false ? "Kích hoạt" : "Ẩn"}</button><p class="form-message" role="status"></p></form></td></tr>`).join("");
        const editable = currentRole === "manager";
        host.innerHTML = `${editable ? formBlock("Thêm danh mục", "create-category", `${formField("Tên danh mục", "name")}${formField("Mã đường dẫn", "slug")}${formField("Mô tả", "description", "textarea", false)}`, "TẠO DANH MỤC") : ""}
          ${editable ? formBlock("Thêm thương hiệu", "create-brand", `${formField("Tên thương hiệu", "name")}${formField("Mã thương hiệu", "code")}${formField("Đường dẫn", "slug", "text", false)}${formField("Xuất xứ", "origin", "text", false)}`, "TẠO THƯƠNG HIỆU") : ""}
          <section class="panel"><div class="section-head"><div><span class="eyebrow">PHÂN LOẠI CATALOG</span><h2>Danh mục</h2></div><span>${categories.length} bản ghi</span></div>${categories.length ? table(["Tên", "Mã", "Trạng thái", "Thao tác"], rowsFor(categories, "categories")) : "<p class='empty'>Chưa có danh mục.</p>"}</section>
          <section class="panel"><div class="section-head"><div><span class="eyebrow">THƯƠNG HIỆU</span><h2>Nhãn hàng</h2></div><span>${brands.length} bản ghi</span></div>${brands.length ? table(["Tên", "Mã", "Trạng thái", "Thao tác"], rowsFor(brands, "brands")) : "<p class='empty'>Chưa có thương hiệu.</p>"}</section>
          <section class="panel"><div class="section-head"><div><span class="eyebrow">ĐIỂM BÁN</span><h2>Cửa hàng</h2></div><span>${stores.length} bản ghi</span></div>${stores.length ? table(["Cửa hàng", "Địa chỉ", "Trạng thái"], stores.map((item) => `<tr><td>${esc(item.name)} ${demo(item)}</td><td>${esc(item.address || "—")}</td><td>${esc(item.isActive === false ? "Đã đóng" : "Đang hoạt động")}</td></tr>`).join("")) : "<p class='empty'>Chưa có cửa hàng.</p>"}</section>`;
      });
    }

    async function appointmentsView() {
      await listOrState(() => root.MBApi.appointments.list({ page: 1, limit: 100 }), (response) => {
        const items = rows(response);
        const next = { requested: ["confirmed", "cancelled"], confirmed: ["completed", "cancelled"] };
        const labels = { confirmed: "Xác nhận", completed: "Hoàn tất", cancelled: "Hủy" };
        const body = items.map((item) => {
          const current = item.status || "requested", options = (next[current] || []).map((status) => `<option value="${status}">${labels[status]}</option>`).join("");
          const action = options ? `<form data-admin-action="appointment-status" data-id="${esc(item.id || item._id)}"><select name="status">${options}</select><input name="employeeNote" aria-label="Ghi chú nhân viên" placeholder="Ghi chú nhân viên"><input name="consultationResult" aria-label="Kết quả tư vấn" placeholder="Kết quả tư vấn"><button class="outline" type="submit">Cập nhật</button><p class="form-message" role="status"></p></form>` : "—";
          return `<tr><td>${esc(item.customer?.fullName || item.user?.name || item.userId || "—")} ${demo(item)}</td><td>${esc(formatReportDate(item.appointmentDate || item.date || "—"))} ${esc(item.startTime || "")}–${esc(item.endTime || "")}</td><td>${esc(item.customerNote || item.note || "—")}</td><td><span class="tag">${esc(current)}</span></td><td>${action}</td></tr>`;
        }).join("");
        host.innerHTML = `<section class="panel"><div class="section-head"><div><span class="eyebrow">TƯ VẤN CÁ NHÂN</span><h2>Lịch hẹn</h2></div><span>${items.length} bản ghi</span></div>${items.length ? table(["Khách hàng", "Thời gian", "Nhu cầu", "Trạng thái", "Thao tác"], body) : "<p class='empty'>Chưa có yêu cầu tư vấn.</p>"}</section>`;
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
          return `<tr><td>${esc(found?.product.name || item.product?.name || item.variantId || "—")} ${demo(item)}</td><td>${esc(found?.variant.sku || item.variant?.sku || item.sku || "—")}</td><td>${esc(item.store?.name || storeById.get(String(item.storeId)) || item.storeId || "—")}</td><td>${esc(item.stockQuantity ?? item.quantity ?? "—")}</td><td>${esc(item.reservedQuantity ?? "—")}</td><td>${esc(item.availableQuantity ?? (Number(item.stockQuantity || 0) - Number(item.reservedQuantity || 0)))}</td><td>${action}</td></tr>`;
        }).join("");
        host.innerHTML = `${formBlock("Phiếu nhập kho", "stock-receipt", `${selectField("Cửa hàng", "storeId", storeOptions)}${selectField("Sản phẩm / phân loại", "variantId", variantOptions)}${formField("Số lượng nhập", "quantity", "number")}${formField("Đơn giá nhập (₫)", "unitCost", "number", false)}${formField("Ghi chú", "note", "text", false)}`, "GHI NHẬN NHẬP KHO")}
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
          const action = `<form data-admin-action="promotion-status" data-id="${esc(id)}"><input type="hidden" name="isActive" value="${item.isActive === false ? "true" : "false"}"><button class="outline" type="submit">${item.isActive === false ? "Kích hoạt" : "Tạm dừng"}</button><p class="form-message" role="status"></p></form>`;
          return `<tr><td>${esc(item.name || item.title || "—")} ${demo(item)}</td><td>${esc(item.items?.length || 0)} sản phẩm</td><td>${esc(formatReportDate(item.startDate || "—"))} → ${esc(formatReportDate(item.endDate || "—"))}</td><td>${esc(item.isActive === false ? "Tạm dừng" : "Đang chạy")}</td><td>${rowActions(action, `promotion-${id}`)}</td></tr>`;
        }).join("");
        const voucherRows = vouchers.map((item) => {
          const id = item.id || item._id;
          const action = `<form data-admin-action="voucher-status" data-id="${esc(id)}"><input type="hidden" name="isActive" value="${item.isActive === false ? "true" : "false"}"><button class="outline" type="submit">${item.isActive === false ? "Kích hoạt" : "Tạm dừng"}</button><p class="form-message" role="status"></p></form>`;
          return `<tr><td>${esc(item.code)} ${demo(item)}</td><td>${esc(item.discountType === "percentage" ? `${item.discountValue}%` : money(item.discountValue))}</td><td>${money(item.minOrderValue || 0)}</td><td>${esc(item.usedCount || 0)} / ${esc(item.totalUsageLimit || "∞")}</td><td>${esc(item.isActive === false ? "Tạm dừng" : "Đang hiệu lực")}</td><td>${rowActions(action, `voucher-${id}`)}</td></tr>`;
        }).join("");
        host.innerHTML = `${formBlock("Tạo chương trình giá ưu đãi", "create-promotion", `${formField("Tên chương trình", "name")}${formField("Bắt đầu", "startDate", "date")}${formField("Kết thúc", "endDate", "date")}${selectField("Sản phẩm / phân loại", "variantId", variantOptions)}${formField("Giá khuyến mãi (₫)", "promotionPrice", "number")}`, "TẠO KHUYẾN MÃI")}
          ${formBlock("Phát hành voucher", "create-voucher", `${formField("Mã voucher", "code")}${selectField("Kiểu giảm", "discountType", '<option value="percentage">Phần trăm</option><option value="fixed">Số tiền cố định</option>')}${formField("Giá trị giảm", "discountValue", "number")}${formField("Đơn tối thiểu (₫)", "minOrderValue", "number", false)}${formField("Mức giảm tối đa (₫)", "maxDiscountAmount", "number", false)}${formField("Số lượt dùng", "totalUsageLimit", "number", false)}${formField("Bắt đầu", "startDate", "date")}${formField("Kết thúc", "endDate", "date")}`, "TẠO VOUCHER")}
          <section class="panel"><div class="section-head"><div><span class="eyebrow">GIÁ ƯU ĐÃI THEO SẢN PHẨM</span><h2>Khuyến mãi</h2></div><span>${items.length} bản ghi</span></div>${items.length ? table(["Chương trình", "Nội dung", "Thời hạn", "Trạng thái", "Thao tác"], promotionRows) : "<p class='empty'>Chưa có chương trình khuyến mãi.</p>"}</section>
          <section class="panel"><div class="section-head"><div><span class="eyebrow">MÃ GIẢM GIÁ</span><h2>Voucher</h2></div><span>${vouchers.length} bản ghi</span></div>${vouchers.length ? table(["Mã", "Ưu đãi", "Đơn tối thiểu", "Đã dùng", "Trạng thái", "Thao tác"], voucherRows) : "<p class='empty'>Chưa có voucher.</p>"}</section>`;
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
          const id = item.id || item._id, options = (next[item.status] || []).map((status) => `<option value="${status}">${status}</option>`).join("");
          const order = orderById.get(String(item.orderId));
          return `<tr><td>${esc(item.deliveryCode || id || "—")} ${demo(item)}</td><td>${esc(order?.orderCode || item.order?.orderCode || item.orderCode || item.orderId || "—")}</td><td>${esc(item.carrier || "Mô phỏng")}</td><td>${esc(item.trackingCode || "—")}</td><td>${esc(item.status || "—")}</td><td>${options ? `<form data-admin-action="delivery-status" data-id="${esc(id)}"><select name="status">${options}</select><button class="outline" type="submit">Cập nhật</button><p class="form-message" role="status"></p></form>` : "—"}</td></tr>`;
        }).join("");
        host.innerHTML = `${formBlock("Tạo yêu cầu giao hàng mô phỏng", "create-delivery", `${selectField("Đơn hàng", "orderId", orderOptions)}${selectField("Cửa hàng", "storeId", stores)}${formField("Địa chỉ giao hàng", "deliveryAddress", "textarea")}`, "TẠO PHIẾU GIAO")}
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
          const id = item.id || item._id, options = (next[item.status] || []).map((status) => `<option value="${status}">${status}</option>`).join("");
          const order = orderById.get(String(item.orderId));
          return `<tr><td>${esc(item.returnCode || id || "—")} ${demo(item)}</td><td>${esc(order?.orderCode || item.order?.orderCode || item.orderCode || item.orderId || "—")}</td><td>${esc(item.reason || "—")}</td><td>${esc(item.status || "—")}</td><td>${esc(item.createdAt ? new Date(item.createdAt).toLocaleDateString("vi-VN") : "—")}</td><td>${options ? `<form data-admin-action="return-status" data-id="${esc(id)}"><select name="status">${options}</select>${item.status === "received" ? formField("Số tiền hoàn (₫)", "refundAmount", "number", false) : ""}<button class="outline" type="submit">Cập nhật</button><p class="form-message" role="status"></p></form>` : "—"}</td></tr>`;
        }).join("");
        host.innerHTML = `${formBlock("Ghi nhận yêu cầu đổi trả", "create-return", `${selectField("Đơn hàng", "orderId", orderOptions)}${selectField("Sản phẩm / phân loại", "variantId", variantOptions)}${formField("Số lượng", "quantity", "number")}${formField("Lý do", "reason", "textarea")}`, "TẠO YÊU CẦU")}
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

    async function editResource(button) {
      const ask = root.prompt || root.window?.prompt;
      if (typeof ask !== "function") return;
      try {
        if (button.dataset.adminEdit === "promotion") {
          const name = ask("Tên chương trình", "");
          if (name === null) return;
          await root.MBApi.admin.promotions.update(button.dataset.id, { name });
        } else if (button.dataset.adminEdit === "voucher") {
          const code = ask("Mã voucher", "");
          if (code === null) return;
          const discountValue = ask("Giá trị giảm", "");
          if (discountValue === null) return;
          await root.MBApi.admin.vouchers.update(button.dataset.id, { code, discountValue: Number(discountValue) });
        } else if (button.dataset.adminEdit === "catalog") {
          const name = ask("Tên danh mục/thương hiệu", "");
          if (name === null) return;
          await root.MBApi.admin.catalog.update(button.dataset.kind, button.dataset.id, { name });
        }
        root.MB.toast("Đã cập nhật bản ghi.", "success");
        await renderView();
      } catch (error) {
        root.MB.toast(root.MB.errorMessage(error), "error");
      }
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
      const reportForm = event.target.closest("#report-filter");
      if (reportForm) {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(reportForm).entries());
        await reportView(values);
        return;
      }
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
        root.document.querySelector("#staff-role").textContent = `${user.fullName || user.name || user.email || "Nhân viên"} · ${currentRole || "chưa xác định vai trò"}`;
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
