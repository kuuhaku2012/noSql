import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";
import request from "supertest";
import { createApp } from "../src/app.js";

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const dbName = `${process.env.MONGODB_TEST_DB || "maison_belle_test"}_completion`;
let client;
let db;
let app;
let customerAgent;
let otherCustomerAgent;
let salesAgent;
let warehouseAgent;
let managerAgent;
let categoryId;
let brandId;
let storeId;
let otherStoreId;
let variantId;

async function login(email) {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/login").send({ email, password: "Demo@123" });
  assert.equal(response.status, 200);
  return agent;
}

async function createOrder({ quantity = 1, paymentMethod = "cod", store = storeId } = {}) {
  return customerAgent.post("/api/orders").send({
    items: [{ variantId: variantId.toHexString(), quantity }], paymentMethod, storeId: store.toHexString(),
    shippingAddress: { receiverName: "Customer", receiverPhone: "0900000000", fullAddress: "1 Test Street" }
  });
}

async function moveOrder(id, statuses) {
  for (const status of statuses) {
    const response = await salesAgent.patch(`/api/orders/${id}/status`).send({ status });
    assert.equal(response.status, 200);
  }
}

before(async () => {
  client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db(dbName);
  await db.dropDatabase();

  const managerId = new ObjectId();
  const salesId = new ObjectId();
  const customerId = new ObjectId();
  const otherCustomerId = new ObjectId();
  const warehouseId = new ObjectId();
  categoryId = new ObjectId();
  brandId = new ObjectId();
  storeId = new ObjectId();
  otherStoreId = new ObjectId();
  const productId = new ObjectId();
  variantId = new ObjectId();
  const otherCategoryId = new ObjectId();
  const otherProductId = new ObjectId();
  await db.collection("users").insertMany([
    { _id: managerId, email: "manager-completion@test.local", fullName: "Manager", role: "manager", passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true },
    { _id: salesId, email: "sales-completion@test.local", fullName: "Sales", role: "sales", passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true },
    { _id: warehouseId, email: "warehouse-completion@test.local", fullName: "Warehouse", role: "warehouse", passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true },
    { _id: customerId, email: "customer-completion@test.local", fullName: "Customer", role: "customer", passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true },
    { _id: otherCustomerId, email: "other-customer-completion@test.local", fullName: "Other Customer", role: "customer", passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true }
  ]);
  await db.collection("categories").insertOne({ _id: categoryId, name: "Skincare", slug: "skincare", isActive: true });
  await db.collection("categories").insertOne({ _id: otherCategoryId, name: "Makeup", slug: "makeup", isActive: true });
  await db.collection("brands").insertOne({ _id: brandId, name: "Maison Test", code: "MBT", slug: "maison-test", isActive: true });
  await db.collection("stores").insertOne({ _id: storeId, name: "Test Store", address: "1 Test Street", isActive: true });
  await db.collection("stores").insertOne({ _id: otherStoreId, name: "Other Test Store", address: "2 Test Street", isActive: true });
  await db.collection("products").insertOne({ _id: productId, name: "Test Serum", slug: "test-serum", brandId, categoryId, isActive: true });
  await db.collection("products").insertOne({ _id: otherProductId, name: "Test Tint", slug: "test-tint", brandId, categoryId: otherCategoryId, isActive: true });
  await db.collection("product_variants").insertOne({ _id: variantId, productId, sku: "TEST-SERUM-30", retailPrice: 100000, originalPrice: 120000, isActive: true });
  await db.collection("product_variants").insertOne({ _id: new ObjectId(), productId: otherProductId, sku: "TEST-TINT-1", retailPrice: 50000, originalPrice: 60000, isActive: true });
  await db.collection("inventories").insertOne({ _id: new ObjectId(), storeId, variantId, stockQuantity: 10, reservedQuantity: 0, version: 1 });
  await db.collection("appointments").insertOne({
    _id: new ObjectId(), userId: customerId, appointmentDate: new Date("2026-11-01T00:00:00.000Z"),
    startTime: "09:00", endTime: "10:00", consultationType: "skincare", status: "confirmed"
  });

  app = createApp({ db, config: { jwtSecret: "test-secret", frontendRoot: new URL("../../", import.meta.url) } });
  managerAgent = await login("manager-completion@test.local");
  salesAgent = await login("sales-completion@test.local");
  warehouseAgent = await login("warehouse-completion@test.local");
  customerAgent = await login("customer-completion@test.local");
  otherCustomerAgent = await login("other-customer-completion@test.local");
});

after(async () => {
  await client?.db(dbName).dropDatabase();
  await client?.close();
});

test("catalog resolves category slug and brand code to active products", async () => {
  const catalog = await request(app).get("/api/catalog");
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.data.categories.some((item) => item.slug === "skincare"), true);
  assert.equal(catalog.body.data.brands[0].code, "MBT");

  const products = await request(app).get("/api/products?category=skincare&brand=MBT");
  assert.equal(products.status, 200);
  assert.equal(products.body.data.length, 1);
  assert.equal(products.body.data[0].brandName, "Maison Test");
  assert.equal(products.body.data[0].categoryName, "Skincare");
});

test("manager can maintain catalog choices while sales and customers cannot", async () => {
  const listed = await managerAgent.get("/api/admin/catalog");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.data.stores.some((store) => store.id === storeId.toHexString()), true);

  const created = await managerAgent.post("/api/admin/catalog/categories").send({ name: "Eye Makeup", slug: "eye-makeup" });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.slug, "eye-makeup");

  const salesDenied = await salesAgent.post("/api/admin/catalog/brands").send({ name: "Unauthorized Brand", code: "NOPE" });
  assert.equal(salesDenied.status, 403);
  const customerDenied = await customerAgent.get("/api/admin/catalog");
  assert.equal(customerDenied.status, 403);
});

test("product filters reject reversed price ranges", async () => {
  const response = await request(app).get("/api/products?minPrice=200000&maxPrice=100000");
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
});

test("appointment availability detects overlaps but allows adjacent slots", async () => {
  const staffSchedule = await salesAgent.get("/api/appointments");
  assert.equal(staffSchedule.status, 200);
  assert.equal(staffSchedule.body.data[0].customer.fullName, "Customer");

  const overlapping = await customerAgent.get("/api/appointments/availability?appointmentDate=2026-11-01&startTime=09%3A30&endTime=10%3A30");
  assert.equal(overlapping.status, 200);
  assert.equal(overlapping.body.data.available, false);

  const adjacent = await customerAgent.get("/api/appointments/availability?appointmentDate=2026-11-01&startTime=10%3A00&endTime=11%3A00");
  assert.equal(adjacent.status, 200);
  assert.equal(adjacent.body.data.available, true);
});

test("appointments reject invalid time ranges and duplicate active bookings", async () => {
  const reversed = await customerAgent.post("/api/appointments").send({ appointmentDate: "2026-11-01", startTime: "11:00", endTime: "10:00", consultationType: "skincare" });
  assert.equal(reversed.status, 400);

  const duplicate = await customerAgent.post("/api/appointments").send({ appointmentDate: "2026-11-01", startTime: "09:30", endTime: "10:30", consultationType: "skincare" });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, "APPOINTMENT_SLOT_UNAVAILABLE");
});

test("customer can update a safe profile and addresses remain private", async () => {
  const updated = await customerAgent.patch("/api/customers/me").send({ fullName: "Updated Customer", phone: "0900000001", skinType: "sensitive", role: "manager" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.fullName, "Updated Customer");
  assert.equal(updated.body.data.role, "customer");

  const created = await customerAgent.post("/api/customers/me/addresses").send({ receiverName: "Updated Customer", receiverPhone: "0900000001", fullAddress: "2 Test Street", isDefault: true });
  assert.equal(created.status, 201);
  const ownAddresses = await customerAgent.get("/api/customers/me/addresses");
  assert.equal(ownAddresses.body.data.length, 1);
  const otherAddresses = await otherCustomerAgent.get("/api/customers/me/addresses");
  assert.equal(otherAddresses.status, 200);
  assert.equal(otherAddresses.body.data.length, 0);
});

test("completed orders award loyalty points once and order detail includes invoice/payment/history", async () => {
  const created = await customerAgent.post("/api/orders").send({
    items: [{ variantId: variantId.toHexString(), quantity: 1 }], paymentMethod: "cod",
    shippingAddress: { receiverName: "Customer", receiverPhone: "0900000000", fullAddress: "1 Test Street" }
  });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  for (const status of ["confirmed", "processing", "shipped", "delivered", "completed"]) {
    const response = await salesAgent.patch(`/api/orders/${id}/status`).send({ status });
    assert.equal(response.status, 200);
  }

  const detail = await customerAgent.get(`/api/orders/${id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.payment.status, "paid");
  assert.equal(detail.body.data.invoice.status, "issued");
  assert.match(detail.body.data.invoice.invoiceCode, /^INV-/);
  assert.equal(detail.body.data.history.length, 6);

  const loyalty = await customerAgent.get("/api/customers/me/loyalty");
  assert.equal(loyalty.status, 200);
  assert.equal(loyalty.body.data.membership.pointsBalance, 10);
  assert.equal(loyalty.body.data.history.length, 1);
});

test("mock payment failure and retry update one payment and invoice record", async () => {
  const created = await customerAgent.post("/api/orders").send({
    items: [{ variantId: variantId.toHexString(), quantity: 1 }], paymentMethod: "mock",
    shippingAddress: { receiverName: "Customer", receiverPhone: "0900000000", fullAddress: "1 Test Street" }
  });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  const failed = await customerAgent.post(`/api/orders/${id}/payment`).send({ outcome: "failure" });
  assert.equal(failed.status, 200);
  assert.equal(failed.body.data.payment.status, "failed");
  const paid = await customerAgent.post(`/api/orders/${id}/payment`).send({ outcome: "success" });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.data.payment.status, "paid");
  assert.equal(paid.body.data.invoice.status, "issued");
  assert.equal(await db.collection("payments").countDocuments({ orderId: new ObjectId(id) }), 1);
  assert.equal(await db.collection("invoices").countDocuments({ orderId: new ObjectId(id) }), 1);
  assert.equal((await customerAgent.post(`/api/orders/${id}/payment`).send({ outcome: "success" })).status, 200);
  assert.equal(await db.collection("payments").countDocuments({ orderId: new ObjectId(id) }), 1);
});

test("active promotions are visible and their price is snapshotted on an order", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const voucher = await managerAgent.post("/api/admin/vouchers").send({
    code: "TODAYONLY", discountType: "fixed", discountValue: 10000, startDate: today, endDate: today
  });
  assert.equal(voucher.status, 201);
  const validToday = await customerAgent.post("/api/vouchers/validate").send({ code: "TODAYONLY", subtotal: 100000 });
  assert.equal(validToday.status, 200);

  const invalid = await managerAgent.post("/api/admin/promotions").send({
    name: "Invalid Test Sale", startDate: "2026-01-01", endDate: "2027-01-01",
    items: [{ variantId: variantId.toHexString(), promotionPrice: 120001 }]
  });
  assert.equal(invalid.status, 400);
  const created = await managerAgent.post("/api/admin/promotions").send({
    name: "October Test Sale", startDate: today, endDate: today,
    items: [{ variantId: variantId.toHexString(), promotionPrice: 90000 }]
  });
  assert.equal(created.status, 201);

  const publicList = await request(app).get("/api/promotions");
  assert.equal(publicList.status, 200);
  assert.equal(publicList.body.data[0].items[0].promotionPrice, 90000);
  const saleProducts = await request(app).get("/api/products?sale=true");
  assert.equal(saleProducts.status, 200);
  assert.equal(saleProducts.body.data.length, 1);
  assert.equal(saleProducts.body.data[0].name, "Test Serum");

  const product = await request(app).get("/api/products?category=skincare");
  assert.equal(product.status, 200);
  assert.equal(product.body.data[0].variants[0].promotionPrice, 90000);

  const order = await createOrder();
  assert.equal(order.status, 201);
  assert.equal(order.body.data.items[0].unitPrice, 90000);
  assert.equal(order.body.data.items[0].appliedPromotion.name, "October Test Sale");
});

test("customer returns are owner-scoped, cumulative, and restock once on receipt", async () => {
  const before = await db.collection("inventories").findOne({ storeId, variantId });
  const order = await createOrder({ quantity: 2 });
  assert.equal(order.status, 201);
  const orderId = order.body.data.id;
  await moveOrder(orderId, ["confirmed", "processing", "shipped", "delivered", "completed"]);

  const otherRequest = await otherCustomerAgent.post("/api/returns").send({ orderId, reason: "Not my order", items: [{ variantId: variantId.toHexString(), quantity: 1 }] });
  assert.equal(otherRequest.status, 404);
  const returned = await customerAgent.post("/api/returns").send({ orderId, reason: "Damaged packaging", items: [{ variantId: variantId.toHexString(), quantity: 2 }] });
  assert.equal(returned.status, 201);
  const excess = await customerAgent.post("/api/returns").send({ orderId, reason: "Another request", items: [{ variantId: variantId.toHexString(), quantity: 1 }] });
  assert.equal(excess.status, 409);

  const approved = await managerAgent.patch(`/api/admin/returns/${returned.body.data.id}`).send({ status: "approved" });
  assert.equal(approved.status, 200);
  const received = await managerAgent.patch(`/api/admin/returns/${returned.body.data.id}`).send({ status: "received" });
  assert.equal(received.status, 200);
  assert.equal((await db.collection("inventories").findOne({ storeId, variantId })).stockQuantity, before.stockQuantity);
  assert.equal((await managerAgent.patch(`/api/admin/returns/${returned.body.data.id}`).send({ status: "received" })).status, 200);
  assert.equal((await db.collection("inventories").findOne({ storeId, variantId })).stockQuantity, before.stockQuantity);
});

test("delivered shipment advances its order to delivered", async () => {
  const pendingOrder = await createOrder();
  const premature = await warehouseAgent.post("/api/admin/deliveries").send({ orderId: pendingOrder.body.data.id, storeId: storeId.toHexString(), deliveryAddress: "1 Test Street" });
  assert.equal(premature.status, 409);

  const order = await createOrder();
  assert.equal(order.status, 201);
  const orderId = order.body.data.id;
  await moveOrder(orderId, ["confirmed", "processing", "shipped"]);
  const delivery = await warehouseAgent.post("/api/admin/deliveries").send({ orderId, storeId: storeId.toHexString(), deliveryAddress: "1 Test Street" });
  assert.equal(delivery.status, 201);
  const duplicate = await warehouseAgent.post("/api/admin/deliveries").send({ orderId, storeId: storeId.toHexString(), deliveryAddress: "1 Test Street" });
  assert.equal(duplicate.status, 409);
  let status = "ready";
  for (const next of ["assigned", "picked_up", "in_transit", "delivered"]) {
    const response = await warehouseAgent.patch(`/api/admin/deliveries/${delivery.body.data.id}`).send({ status: next });
    assert.equal(response.status, 200);
    status = response.body.data.status;
  }
  assert.equal(status, "delivered");
  assert.equal((await customerAgent.get(`/api/orders/${orderId}`)).body.data.orderStatus, "delivered");
});

test("invalid later receipt line cannot leave earlier stock partially changed", async () => {
  const before = await db.collection("inventories").findOne({ storeId, variantId });
  const response = await warehouseAgent.post("/api/admin/stock-receipts").send({
    storeId: storeId.toHexString(),
    items: [
      { variantId: variantId.toHexString(), quantity: 3 },
      { variantId: new ObjectId().toHexString(), quantity: 1 }
    ]
  });
  assert.equal(response.status, 404);
  assert.equal((await db.collection("inventories").findOne({ storeId, variantId })).stockQuantity, before.stockQuantity);
});

test("manager report can reconcile totals for one store", async () => {
  const reportDate = new Date("2027-02-01T12:00:00.000Z");
  await db.collection("orders").insertMany([
    { _id: new ObjectId(), userId: new ObjectId(), storeId, orderStatus: "completed", finalAmount: 100000, items: [{ productName: "Store Serum", productId: new ObjectId(), variantId, quantity: 2, lineTotal: 100000 }], createdAt: reportDate },
    { _id: new ObjectId(), userId: new ObjectId(), storeId: otherStoreId, orderStatus: "completed", finalAmount: 500000, items: [{ productName: "Other Serum", productId: new ObjectId(), variantId, quantity: 5, lineTotal: 500000 }], createdAt: reportDate }
  ]);
  const report = await managerAgent.get(`/api/admin/reports?from=2027-02-01&to=2027-02-01&storeId=${storeId.toHexString()}`);
  assert.equal(report.status, 200);
  assert.equal(report.body.data.summary.orderCount, 1);
  assert.equal(report.body.data.summary.revenue, 100000);
  assert.equal(report.body.data.summary.itemCount, 2);
});
