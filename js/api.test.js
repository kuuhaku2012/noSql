const test = require("node:test");
const assert = require("node:assert/strict");
const { createApi } = require("./api.js");

test("catalog query maps customer filters to the agreed API parameters", async () => {
  let requestedUrl = "";
  const api = createApi(async (url) => {
    requestedUrl = url;
    return Response.json({ data: [], pagination: { page: 1, limit: 24, total: 0 } });
  });

  await api.products({ q: "serum", category: "skincare", brand: "Belle", minPrice: 100, maxPrice: 900, page: 2, limit: 12 });

  assert.equal(requestedUrl, "/api/products?q=serum&category=skincare&brand=Belle&minPrice=100&maxPrice=900&page=2&limit=12");
});

test("API requests include cookies and encode JSON writes", async () => {
  let captured;
  const api = createApi(async (url, options) => {
    captured = { url, options };
    return Response.json({ data: { id: "order-1" } }, { status: 201 });
  });

  await api.orders.create({ items: [{ variantId: "v1", quantity: 2 }], paymentMethod: "cod" });

  assert.equal(captured.url, "/api/orders");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.credentials, "same-origin");
  assert.equal(captured.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(captured.options.body), { items: [{ variantId: "v1", quantity: 2 }], paymentMethod: "cod" });
});

test("customer registration uses the public auth endpoint", async () => {
  let captured;
  const api = createApi(async (url, options) => {
    captured = { url, options };
    return Response.json({ data: { id: "customer-1", role: "customer" } }, { status: 201 });
  });

  const result = await api.auth.register({ email: "mai@example.com", fullName: "Mai", password: "secret1" });

  assert.equal(captured.url, "/api/auth/register");
  assert.equal(captured.options.method, "POST");
  assert.deepEqual(JSON.parse(captured.options.body), { email: "mai@example.com", fullName: "Mai", password: "secret1" });
  assert.equal(result.data.role, "customer");
});

test("API errors preserve status, code, and the server message", async () => {
  const api = createApi(async () => Response.json({ error: { code: "FORBIDDEN", message: "Không đủ quyền" } }, { status: 403 }));

  await assert.rejects(api.admin.inventory(), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.code, "FORBIDDEN");
    assert.equal(error.message, "Không đủ quyền");
    return true;
  });
});

test("admin product and promotion updates use the resource URLs documented by the API contract", async () => {
  const requests = [];
  const api = createApi(async (url, options) => {
    requests.push({ url, options });
    return Response.json({ data: { ok: true } });
  });

  await api.admin.products.update("product-7", { isActive: false });
  await api.admin.promotions.update("promo-3", { isActive: true });

  assert.deepEqual(requests.map(({ url, options }) => [url, options.method, JSON.parse(options.body)]), [
    ["/api/admin/products/product-7", "PATCH", { isActive: false }],
    ["/api/admin/promotions/promo-3", "PATCH", { isActive: true }]
  ]);
});

test("admin catalog exposes the soft-delete resource URL", async () => {
  let captured;
  const api = createApi(async (url, options) => {
    captured = { url, options };
    return new Response(null, { status: 204 });
  });

  await api.admin.catalog.remove("brands", "brand-4");

  assert.equal(captured.url, "/api/admin/catalog/brands/brand-4");
  assert.equal(captured.options.method, "DELETE");
});

test("business workflow methods call the agreed catalog, customer, appointment, payment, return, and admin routes", async () => {
  const requests = [];
  const api = createApi(async (url, options) => {
    requests.push([url, options.method || "GET", options.body ? JSON.parse(options.body) : undefined]);
    return options.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ data: {} });
  });

  await api.catalog();
  await api.appointments.availability({ appointmentDate: "2026-11-01", startTime: "09:00", endTime: "10:00" });
  await api.customers.me();
  await api.customers.updateProfile({ fullName: "Mai" });
  await api.customers.addresses.create({ fullAddress: "1 Street" });
  await api.customers.addresses.remove("address-1");
  await api.customers.loyalty();
  await api.orders.payment("order-1", { outcome: "success" });
  await api.returns.create({ orderId: "order-1" });
  await api.promotions.list();
  await api.admin.catalog.list();
  await api.admin.catalog.create("brands", { name: "Belle", code: "BELLE" });
  await api.admin.customers.list({ q: "Mai" });
  await api.admin.vouchers.create({ code: "BELLE10" });
  await api.admin.deliveries.update("delivery-1", { status: "assigned" });
  await api.admin.returns.update("return-1", { status: "approved" });

  assert.deepEqual(requests, [
    ["/api/catalog", "GET", undefined],
    ["/api/appointments/availability?appointmentDate=2026-11-01&startTime=09%3A00&endTime=10%3A00", "GET", undefined],
    ["/api/customers/me", "GET", undefined],
    ["/api/customers/me", "PATCH", { fullName: "Mai" }],
    ["/api/customers/me/addresses", "POST", { fullAddress: "1 Street" }],
    ["/api/customers/me/addresses/address-1", "DELETE", undefined],
    ["/api/customers/me/loyalty", "GET", undefined],
    ["/api/orders/order-1/payment", "POST", { outcome: "success" }],
    ["/api/returns", "POST", { orderId: "order-1" }],
    ["/api/promotions", "GET", undefined],
    ["/api/admin/catalog", "GET", undefined],
    ["/api/admin/catalog/brands", "POST", { name: "Belle", code: "BELLE" }],
    ["/api/admin/customers?q=Mai", "GET", undefined],
    ["/api/admin/vouchers", "POST", { code: "BELLE10" }],
    ["/api/admin/deliveries/delivery-1", "PATCH", { status: "assigned" }],
    ["/api/admin/returns/return-1", "PATCH", { status: "approved" }]
  ]);
});

test("offers and admin flash-sale methods use the live API resources", async () => {
  const requests = [];
  const api = createApi(async (url, options) => {
    requests.push([url, options.method || "GET", options.body ? JSON.parse(options.body) : undefined]);
    return options.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ data: {} });
  });

  await api.flashSales.list();
  await api.admin.flashSales.list({ page: 1, limit: 20 });
  await api.admin.flashSales.create({ name: "Weekend", items: [] });
  await api.admin.flashSales.update("flash-1", { isActive: false });
  await api.admin.flashSales.remove("flash-1");

  assert.deepEqual(requests, [
    ["/api/flash-sales", "GET", undefined],
    ["/api/admin/flash-sales?page=1&limit=20", "GET", undefined],
    ["/api/admin/flash-sales", "POST", { name: "Weekend", items: [] }],
    ["/api/admin/flash-sales/flash-1", "PATCH", { isActive: false }],
    ["/api/admin/flash-sales/flash-1", "DELETE", undefined]
  ]);
});

test("shipping rates and quotes use the public checkout endpoints", async () => {
  const requests = [];
  const api = createApi(async (url, options) => {
    requests.push([url, options.method || "GET", options.body ? JSON.parse(options.body) : undefined]);
    return Response.json({ data: [] });
  });

  await api.shipping.rates();
  await api.shipping.quote({ regionCode: "hcm-demo" });

  assert.deepEqual(requests, [
    ["/api/shipping/rates", "GET", undefined],
    ["/api/shipping/quote", "POST", { regionCode: "hcm-demo" }]
  ]);
});
