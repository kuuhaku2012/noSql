const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");
const { createApi } = require("./api.js");
const MB = require("./app.js");
const { canAccess, defaultView, headerActionFor, pickRole, reportFields, reportSummaryEntries, formatReportDate, dashboardMetrics, reportChartData, crudActionPayload, rowActions, actionPopoverPosition } = require("./admin.js");

async function shippingRatePage(role = "manager", rates = [], failure = null) {
  const requests = [], events = {}, messages = [], states = [];
  const host = {
    innerHTML: "", children: [],
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (name, handler) => { events[name] = handler; }
  };
  const nav = { dataset: { navView: "master-data" }, style: { display: "" }, classList: { toggle() {} }, setAttribute() {}, removeAttribute() {} };
  let confirmed = true, confirmations = 0;
  const api = createApi(async (url, options) => {
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    requests.push([url, options.method, body]);
    if (url === "/api/auth/me") return Response.json({ data: { role, fullName: "Staff" } });
    if (url === "/api/admin/catalog") return Response.json({ data: { categories: [], brands: [], stores: [] } });
    if (failure && options.method !== "GET") return Response.json({ error: failure }, { status: 409 });
    return Response.json({ data: rates });
  });
  const sandbox = {
    module: { exports: {} }, URLSearchParams,
    location: { search: "?view=master-data" }, addEventListener() {},
    document: {
      addEventListener() {},
      querySelector: (selector) => selector === "#admin-content" ? host : selector === "#view-title" ? {} : null,
      querySelectorAll: () => [nav]
    },
    MBApi: api,
    MB: { ...MB, toast: (...args) => messages.push(args), showState: (target, kind, message) => { states.push(kind); target.innerHTML = message; } },
    FormData: class { constructor(form) { this.values = form.values; } entries() { return Object.entries(this.values); } },
    confirm: () => { confirmations++; return confirmed; }
  };
  runInNewContext(await readFile(join(__dirname, "admin.js"), "utf8"), sandbox);
  sandbox.module.exports.bind();
  await new Promise(setImmediate);
  return {
    host, nav, requests, messages, states,
    cancel: () => { confirmed = false; },
    confirmations: () => confirmations,
    async submit(action, values = {}, id = "rate-1") {
      const message = { textContent: "" }, button = { disabled: false };
      const form = { dataset: { adminAction: action, id }, values, querySelector: (selector) => selector === ".form-message" ? message : button };
      await events.submit({ preventDefault() {}, target: { closest: (selector) => selector === "form[data-admin-action]" ? form : null } });
      return { message, button };
    }
  };
}

test("shipping-rate master-data access is manager-only", async () => {
  assert.equal(canAccess("manager", "master-data"), true);
  assert.equal(canAccess("sales", "master-data"), false);
  assert.equal(canAccess("warehouse", "master-data"), false);
  for (const role of ["sales", "warehouse"]) {
    const page = await shippingRatePage(role);
    assert.equal(page.nav.hidden, true);
    assert.equal(page.nav.style.display, "none");
    assert.deepEqual(page.states, ["forbidden"]);
    assert.doesNotMatch(page.host.innerHTML, /data-admin-action="create-shipping-rate"/);
    assert.deepEqual(page.requests.map(([url]) => url), ["/api/auth/me"]);
  }
});

test("shipping-rate manager panel renders demo VND fields, escaped rates and edit/deactivate controls", async () => {
  const page = await shippingRatePage("manager", [
    { id: "rate-1", regionCode: "hcm-demo", regionName: '<img src=x onerror="run()">', fee: 25000, isActive: true, isDemo: true },
    { id: "rate-2", regionCode: "other-demo", regionName: "Khác", fee: 0, isActive: false, isDemo: true }
  ]);
  assert.equal(page.nav.hidden, false);
  assert.equal(page.nav.style.display, "");
  assert.ok(page.requests.some(([url]) => url === "/api/admin/shipping-rates"));
  assert.match(page.host.innerHTML, /data-admin-action="create-shipping-rate"/);
  assert.match(page.host.innerHTML, /data-admin-action="update-shipping-rate"/);
  assert.match(page.host.innerHTML, /data-admin-action="remove-shipping-rate"/);
  for (const name of ["regionCode", "regionName", "fee", "isActive"]) assert.match(page.host.innerHTML, new RegExp(`name="${name}"`));
  assert.match(page.host.innerHTML, /demo VND/);
  assert.match(page.host.innerHTML, /name="fee"[^>]*min="0"/);
  assert.match(page.host.innerHTML, /value="25000"/);
  assert.match(page.host.innerHTML, /value="0"/);
  assert.match(page.host.innerHTML, /value="false" selected/);
  assert.match(page.host.innerHTML, /status-neutral/);
  assert.match(page.host.innerHTML, /&lt;img src=x onerror=&quot;run\(\)&quot;&gt;/);
  assert.doesNotMatch(page.host.innerHTML, /<img src=x/);
});

test("shipping-rate manager panel creates and edits typed payloads then refreshes", async () => {
  const page = await shippingRatePage();
  await page.submit("create-shipping-rate", { regionCode: "hcm-demo", regionName: "TP. Hồ Chí Minh", fee: "25000", isActive: "true" });
  await page.submit("update-shipping-rate", { regionCode: "other-demo", regionName: "Khác", fee: "0", isActive: "false" }, "rate /?#");
  assert.deepEqual(page.requests.filter(([, method]) => method !== "GET"), [
    ["/api/admin/shipping-rates", "POST", { regionCode: "hcm-demo", regionName: "TP. Hồ Chí Minh", fee: 25000, isActive: true }],
    ["/api/admin/shipping-rates/rate%20%2F%3F%23", "PATCH", { regionCode: "other-demo", regionName: "Khác", fee: 0, isActive: false }]
  ]);
  assert.equal(page.requests.filter(([url, method]) => url === "/api/admin/shipping-rates" && method === "GET").length, 3);
  assert.equal(page.messages.filter(([, tone]) => tone === "success").length, 2);
});

test("shipping-rate manager panel confirms soft deactivation and respects cancellation", async () => {
  const page = await shippingRatePage();
  await page.submit("remove-shipping-rate");
  page.cancel();
  await page.submit("remove-shipping-rate");
  assert.equal(page.confirmations(), 2);
  assert.deepEqual(page.requests.filter(([, method]) => method === "DELETE"), [["/api/admin/shipping-rates/rate-1", "DELETE", undefined]]);
  assert.equal(page.requests.filter(([url, method]) => url === "/api/admin/shipping-rates" && method === "GET").length, 2);
});

test("shipping-rate manager panel shows API write errors and re-enables submit", async () => {
  const page = await shippingRatePage("manager", [], { code: "DUPLICATE_SHIPPING_RATE", message: "Shipping region code already exists" });
  const { message, button } = await page.submit("create-shipping-rate", { regionCode: "hcm-demo", regionName: "TP. Hồ Chí Minh", fee: "25000", isActive: "true" });
  assert.equal(message.textContent, MB.errorMessage({ status: 409, code: "DUPLICATE_SHIPPING_RATE", message: "Shipping region code already exists" }));
  assert.equal(button.disabled, false);
  assert.equal(page.messages.length, 0);
});

test("staff navigation reflects the role while manager can inspect every supported view", () => {
  assert.equal(canAccess("warehouse", "inventory"), true);
  assert.equal(canAccess("warehouse", "reports"), false);
  assert.equal(canAccess("sales", "promotions"), true);
  assert.equal(canAccess("customer", "orders"), false);
  assert.equal(canAccess("manager", "customers"), true);
  assert.equal(canAccess("manager", "master-data"), true);
  assert.equal(canAccess("manager", "users"), false);
  assert.equal(canAccess("manager", "reviews"), false);
});

test("admin sidebar hides the reports menu item", async () => {
  const source = await readFile(join(__dirname, "..", "admin.html"), "utf8");
  assert.doesNotMatch(source, /href="admin\.html\?view=reports"/);
  assert.doesNotMatch(source, /<span class="side-link-label">Báo cáo<\/span>/);
});

test("home intro keeps the subject sharp while blurring the image seam into the copy", async () => {
  const source = await readFile(join(__dirname, "..", "css", "atelier.css"), "utf8");
  assert.match(source, /\.hero-visual \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;/);
  const imageRule = source.match(/\.hero-visual img \{([^}]*)\}/);
  assert.ok(imageRule, "hero image keeps an explicit styling rule");
  assert.doesNotMatch(imageRule[1], /filter:[^;]*blur\(/, "the product image itself must stay sharp");
  const seamRule = source.match(/\.hero-visual::before \{([^}]*)\}/);
  assert.ok(seamRule, "a separate overlay blends the image seam");
  assert.match(seamRule[1], /backdrop-filter:\s*blur\(6px\)/);
  assert.match(seamRule[1], /mask-image:\s*linear-gradient\(90deg/);
  assert.match(source, /\.hero-visual::after \{[\s\S]*?inset: 0;[\s\S]*?background: linear-gradient/);
  assert.match(source, /\.hero-copy \{[\s\S]*?min-height: 640px;/);
});

test("admin analytics grids stack into one column below 980px", async () => {
  const source = await readFile(join(__dirname, "..", "css", "theme.css"), "utf8");
  const baseRule = source.indexOf(".admin .admin-analytics-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));");
  const responsiveBlock = source.lastIndexOf("@media (max-width: 980px)");
  const responsiveRule = source.indexOf(".admin .admin-analytics-grid { grid-template-columns: minmax(0, 1fr);", responsiveBlock);
  assert.ok(baseRule >= 0, "analytics grid has its two-column desktop layout");
  assert.ok(responsiveBlock > baseRule, "responsive override comes after the desktop rule");
  assert.ok(responsiveRule > responsiveBlock, "tablet layout overrides the two-column grid");
});

test("report chart data keeps a visible summary bar when the API has no series rows", () => {
  assert.deepEqual(reportChartData({ summary: { revenue: 544000, orderCount: 2 } }), {
    dailySales: [{ date: "Toàn kỳ", revenue: 544000, orderCount: 2 }],
    orderStatuses: [{ status: "Tổng kỳ", count: 2, amount: 544000 }],
    maxRevenue: 544000
  });
});

test("report dates use the MongoDB calendar date without exposing ISO timestamps", () => {
  assert.equal(formatReportDate("2026-09-10T00:00:00.000Z"), "10/09/2026");
  assert.equal(formatReportDate("2026-10-09T23:59:59.999Z"), "09/10/2026");
  assert.equal(formatReportDate("2026-10-09"), "09/10/2026");
  assert.equal(formatReportDate(""), "—");
});

test("promotion periods render calendar dates instead of raw ISO timestamps", async () => {
  const source = await readFile(join(__dirname, "admin.js"), "utf8");
  assert.match(source, /formatReportDate\(item\.startDate \|\| "—"\)/);
  assert.match(source, /formatReportDate\(item\.endDate \|\| "—"\)/);
});

test("appointment periods render calendar dates instead of raw ISO timestamps", async () => {
  const source = await readFile(join(__dirname, "admin.js"), "utf8");
  assert.match(source, /formatReportDate\(item\.appointmentDate \|\| item\.date \|\|/);
});

test("returns table keeps long values aligned inside the admin panel", async () => {
  const adminSource = await readFile(join(__dirname, "admin.js"), "utf8");
  const themeSource = await readFile(join(__dirname, "..", "css", "theme.css"), "utf8");
  assert.match(adminSource, /<section class="panel returns-panel">/);
  assert.match(themeSource, /\.admin \.returns-panel table \{[\s\S]*?min-width: 760px;[\s\S]*?table-layout: auto;/);
  assert.match(themeSource, /\.admin \.returns-panel th,[\s\S]*?min-width: 110px;[\s\S]*?overflow-wrap: anywhere;[\s\S]*?word-break: normal;/);
});

test("product file upload control follows the active admin theme", async () => {
  const source = await readFile(join(__dirname, "..", "css", "theme.css"), "utf8");
  assert.match(source, /input\[type="file"\]::file-selector-button[\s\S]*?background: var\(--surface\);/);
  assert.match(source, /input\[type="file"\]::file-selector-button:hover[\s\S]*?background: var\(--blush\);/);
});

test("report summary cards keep business metrics separate from date metadata", () => {
  assert.deepEqual(reportSummaryEntries({
    from: "2026-09-10T00:00:00.000Z",
    to: "2026-10-09T23:59:59.999Z",
    summary: { orderCount: 2, revenue: 544000, itemCount: 2 }
  }), [
    { key: "revenue", label: "Doanh thu", value: 544000, money: true },
    { key: "orderCount", label: "Đơn hàng", value: 2, money: false },
    { key: "itemCount", label: "Sản phẩm đã bán", value: 2, money: false }
  ]);
});

test("admin CRUD views expose soft-delete actions with confirmation", async () => {
  const source = await readFile(join(__dirname, "admin.js"), "utf8");
  for (const action of ["remove-product", "remove-promotion", "remove-voucher", "remove-catalog"]) assert.match(source, new RegExp(action));
  assert.doesNotMatch(source, /XÓA MỀM/);
  assert.match(source, /remove-promotion[^\n]*Xóa/);
  assert.match(source, /const destructive = \[[^\]]*"remove-promotion"[^\]]*\]\.includes\(action\);[\s\S]*?if \(destructive && typeof root\.confirm === "function" && !root\.confirm\(confirmMessage\)\) return;/);
});

test("admin row actions stay behind an accessible overflow menu", () => {
  const menu = rowActions('<button type="button">Chỉnh sửa</button>', "product-1");
  assert.match(menu, /^<div class="admin-row-actions">/);
  assert.match(menu, /<button class="admin-row-actions-trigger"[^>]*popovertarget="admin-row-actions-product-1"[^>]*>…<\/button>/);
  assert.match(menu, /<div class="admin-row-actions-menu" id="admin-row-actions-product-1" popover="auto"><button type="button">Chỉnh sửa<\/button><\/div>/);
});

test("admin action popovers stay hidden until the trigger opens them", async () => {
  const source = await readFile(join(__dirname, "..", "css", "theme.css"), "utf8");
  assert.match(source, /\.admin \.admin-row-actions-menu \{[\s\S]*?display: none;/);
  assert.match(source, /\.admin \.admin-row-actions-menu:popover-open \{[\s\S]*?display: grid;/);
});

test("open row action popovers follow their trigger while the page scrolls", async () => {
  const source = await readFile(join(__dirname, "admin.js"), "utf8");
  assert.match(source, /function repositionOpenActionPopovers\(\)/);
  assert.match(source, /root\.addEventListener\?\.\("scroll", reposition, true\)/);
  assert.match(source, /root\.addEventListener\?\.\("resize", reposition\)/);
});

test("admin action popovers position beside the trigger and flip from the viewport edge", () => {
  assert.deepEqual(actionPopoverPosition(
    { left: 1070, top: 240, right: 1114, bottom: 278 },
    { width: 220, height: 150 },
    { width: 1186, height: 698 }
  ), { left: 842, top: 286 });
});

test("product action buttons share the compact edit-button shape", async () => {
  const source = await readFile(join(__dirname, "..", "css", "theme.css"), "utf8");
  assert.match(source, /\.admin \.admin-row-actions-menu > form \.outline,[\s\S]*?min-height: 38px !important;[\s\S]*?border-radius: 10px;/);
});

test("product action buttons use one shared color and tighter spacing", async () => {
  const source = await readFile(join(__dirname, "..", "css", "theme.css"), "utf8");
  const menuBlock = source.slice(source.indexOf(".admin .admin-row-actions-menu {"), source.indexOf(".admin .admin-row-actions-menu .form-message"));
  assert.match(menuBlock, /gap: 6px;/);
  assert.match(menuBlock, /background: var\(--surface-alt\);/);
  assert.match(menuBlock, /color: var\(--ink\)(?: !important)?;/);
  assert.match(menuBlock, /border: 1px solid var\(--line\);/);
});

test("product action labels stay lowercase and empty messages do not add gaps", async () => {
  const source = await readFile(join(__dirname, "..", "css", "theme.css"), "utf8");
  assert.match(source, /\.admin \.admin-row-actions-menu > form \.outline,[\s\S]*?text-transform: lowercase;/);
  assert.match(source, /\.admin \.admin-row-actions-menu \.form-message:empty \{[\s\S]*?display: none;/);
});

test("admin report view renders chart containers for live report series", async () => {
  const source = await readFile(join(__dirname, "admin.js"), "utf8");
  assert.match(source, /querySelector\("#admin-report-charts"\)/);
  assert.match(source, /id="admin-report-charts"/);
  assert.match(source, /DOANH THU THEO NGÀY/);
  assert.match(source, /TRẠNG THÁI ĐƠN/);
  assert.match(source, /const chart = reportChartData\(report\);/);
  assert.match(source, /chart\.dailySales\.map\(\(item\) =>/);
  assert.match(source, /chart\.orderStatuses\.map\(\(item\) =>/);
});

test("report chart data is numeric-safe and exposes the largest revenue", () => {
  assert.deepEqual(reportChartData({
    dailySales: [{ date: "2026-10-01", revenue: "1250000", orderCount: "4" }, { date: "2026-10-02", revenue: 0, orderCount: 0 }],
    orderStatuses: [{ status: "completed", amount: "1250000", count: "4" }]
  }), {
    dailySales: [{ date: "2026-10-01", revenue: 1250000, orderCount: 4 }, { date: "2026-10-02", revenue: 0, orderCount: 0 }],
    orderStatuses: [{ status: "completed", amount: 1250000, count: 4 }],
    maxRevenue: 1250000
  });
  assert.deepEqual(reportChartData({}), { dailySales: [], orderStatuses: [], maxRevenue: 1 });
});

test("CRUD payload helper converts admin form values to API types", () => {
  assert.deepEqual(crudActionPayload("create-product", { name: "Serum", slug: "serum", brandId: "brand-1", categoryId: "cat-1", sku: "SKU-1", volume: "30ml", originalPrice: "300000", retailPrice: "250000" }), {
    name: "Serum", slug: "serum", brandId: "brand-1", categoryId: "cat-1", description: "", variants: [{ sku: "SKU-1", volume: "30ml", originalPrice: 300000, retailPrice: 250000 }]
  });
  assert.deepEqual(crudActionPayload("toggle-product", { isActive: "false" }), { isActive: false });
  assert.deepEqual(crudActionPayload("catalog-status", { isActive: "true" }), { isActive: true });
});

test("product payload accepts an uploaded image without exposing slug as an operator field", () => {
  assert.deepEqual(crudActionPayload("create-product", {
    name: "Kem dưỡng ẩm",
    brandId: "brand-1",
    categoryId: "cat-1",
    sku: "SKU-2",
    originalPrice: "400000",
    retailPrice: "350000",
    imageUrl: "data:image/png;base64,AAA"
  }), {
    name: "Kem dưỡng ẩm",
    brandId: "brand-1",
    categoryId: "cat-1",
    description: "",
    variants: [{ sku: "SKU-2", volume: undefined, originalPrice: 400000, retailPrice: 350000, imageUrl: "data:image/png;base64,AAA" }]
  });
});

test("product creation form balances the first row and places image after description", async () => {
  const source = await readFile(join(__dirname, "admin.js"), "utf8");
  const start = source.indexOf('formBlock("Thêm sản phẩm"');
  const end = source.indexOf('`, "Tạo sản phẩm")', start);
  const fields = source.slice(start, end);
  assert.ok(fields.indexOf('${formField("Tên sản phẩm", "name")}') < fields.indexOf('${formField("Mã SKU phân loại", "sku")}'));
  assert.ok(fields.indexOf('${formField("Mô tả", "description", "textarea", false)}') < fields.indexOf('${imageField("Ảnh sản phẩm")}'));
});

test("inventory table exposes stock adjustment inside the row actions", async () => {
  const source = await readFile(join(__dirname, "admin.js"), "utf8");
  assert.match(source, /data-inventory-action/);
  assert.match(source, /data-admin-action="stock-adjustment"/);
  assert.doesNotMatch(source, /formBlock\([^)]*stock-adjustment/s);
});

test("inventory adjustment opens from a labeled popup instead of inline details", async () => {
  const source = await readFile(join(__dirname, "admin.js"), "utf8");
  const themeSource = await readFile(join(__dirname, "..", "css", "theme.css"), "utf8");
  const menu = rowActions("<form></form>", "inventory-1", { triggerLabel: "Điều chỉnh tồn kho", menuClass: "inventory-adjustment-popover" });
  assert.doesNotMatch(source, /<details class="inventory-actions"/);
  assert.match(source, /rowActions[\s\S]*Điều chỉnh tồn kho/);
  assert.match(source, /inventory-adjustment-popover/);
  assert.match(menu, /admin-row-actions-trigger-wide[^>]*>Điều chỉnh tồn kho<\/button>/);
  assert.match(menu, /admin-row-actions-menu inventory-adjustment-popover/);
  assert.match(themeSource, /\.admin \.inventory-adjustment-popover[\s\S]*?width: min\(320px/);
});

test("API identity role accepts both a role name and a populated role object", () => {
  assert.equal(pickRole({ role: "warehouse" }), "warehouse");
  assert.equal(pickRole({ role: { name: "manager" } }), "manager");
});

test("staff without a requested section land on a section their role can use", () => {
  assert.equal(defaultView("manager"), "dashboard");
  assert.equal(defaultView("sales"), "products");
  assert.equal(defaultView("warehouse"), "inventory");
  assert.equal(defaultView("sales", "reports"), "reports");
});

test("admin header actions only expose forms the current role can use", () => {
  assert.deepEqual(headerActionFor("products", "sales"), {
    label: "Thêm sản phẩm",
    target: "#admin-form-create-product"
  });
  assert.deepEqual(headerActionFor("inventory", "warehouse"), {
    label: "Nhập hàng",
    target: "#admin-form-stock-receipt"
  });
  assert.deepEqual(headerActionFor("master-data", "manager"), {
    label: "Thêm danh mục",
    target: "#admin-form-create-category"
  });
  assert.equal(headerActionFor("products", "warehouse"), null);
  assert.equal(headerActionFor("dashboard", "manager"), null);
});

test("report cards extract real scalar metrics from nested API responses", () => {
  assert.deepEqual(reportFields({ summary: { revenue: 1250000, orders: 4 }, daily: [{ date: "2026-10-01", total: 3 }] }), [
    ["summary.revenue", 1250000], ["summary.orders", 4]
]);

test("dashboard metrics keep counts from each live admin resource", () => {
  assert.deepEqual(dashboardMetrics({
    report: { summary: { revenue: 1250000, orderCount: 4, itemCount: 9 } },
    products: { pagination: { total: 18 } },
    orders: { pagination: { total: 27 } },
    inventory: { data: [{ id: "stock-1" }, { id: "stock-2" }] },
    vouchers: { pagination: { total: 5 } },
    promotions: { pagination: { total: 3 } },
    deliveries: { pagination: { total: 7 } }
  }), {
    revenue: 1250000,
    orderCount: 4,
    itemCount: 9,
    productCount: 18,
    orderTotal: 27,
    inventoryCount: 2,
    voucherCount: 5,
    promotionCount: 3,
    deliveryCount: 7
  });
});
});
