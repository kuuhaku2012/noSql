import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";
import request from "supertest";
import { createApp } from "../src/app.js";

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const dbName = `${process.env.MONGODB_TEST_DB || "maison_belle_test"}_orders`;
let client;
let db;
let app;
let variantId;
let customer;
let sales;
let customerAgent;
let salesAgent;
let orderId;

before(async () => {
  client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db(dbName);
  await db.dropDatabase();
  const roleCustomer = new ObjectId();
  const roleSales = new ObjectId();
  customer = { _id: new ObjectId(), email: "customer-orders@test.local", fullName: "Order Customer", role: "customer", roleId: roleCustomer, passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true };
  sales = { _id: new ObjectId(), email: "sales-orders@test.local", fullName: "Order Sales", role: "sales", roleId: roleSales, passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true };
  const brandId = new ObjectId();
  const categoryId = new ObjectId();
  const productId = new ObjectId();
  variantId = new ObjectId();
  const storeId = new ObjectId();
  await db.collection("roles").insertMany([{ _id: roleCustomer, name: "customer" }, { _id: roleSales, name: "sales" }]);
  await db.collection("users").insertMany([customer, sales]);
  await db.collection("brands").insertOne({ _id: brandId, name: "Order Brand", isActive: true });
  await db.collection("categories").insertOne({ _id: categoryId, name: "Order Category", slug: "order-category", isActive: true });
  await db.collection("products").insertOne({ _id: productId, slug: "order-serum", name: "Order Serum", brandId, categoryId, isActive: true });
  await db.collection("product_variants").insertOne({ _id: variantId, productId, sku: "ORDER-SERUM-30", retailPrice: 100000, originalPrice: 120000, volume: "30ml", isActive: true });
  await db.collection("stores").insertOne({ _id: storeId, name: "Order Store", isActive: true });
  await db.collection("inventories").insertOne({ storeId, variantId, stockQuantity: 10, reservedQuantity: 0, version: 1 });
  await db.collection("vouchers").insertOne({ code: "BELLE10", discountType: "percentage", discountValue: 10, minOrderValue: 100000, maxDiscountAmount: 100000, startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01"), totalUsageLimit: 10, usedCount: 0, isActive: true });
  app = createApp({ db, config: { jwtSecret: "test-secret", frontendRoot: new URL("../../", import.meta.url) } });
  customerAgent = request.agent(app);
  salesAgent = request.agent(app);
  await customerAgent.post("/api/auth/login").send({ email: customer.email, password: "Demo@123" });
  await salesAgent.post("/api/auth/login").send({ email: sales.email, password: "Demo@123" });
});

after(async () => {
  await client?.db(dbName).dropDatabase();
  await client?.close();
});

test("customer can replace a cart and validate a voucher", async () => {
  const saved = await customerAgent.put("/api/cart").send({ items: [{ variantId: variantId.toHexString(), quantity: 2 }] });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.items[0].quantity, 2);

  const voucher = await customerAgent.post("/api/vouchers/validate").send({ code: "BELLE10", subtotal: 200000 });
  assert.equal(voucher.status, 200);
  assert.equal(voucher.body.data.discountAmount, 20000);
});

test("order creation snapshots items and reserves stock", async () => {
  const created = await customerAgent.post("/api/orders").send({
    items: [{ variantId: variantId.toHexString(), quantity: 2 }],
    voucherCode: "BELLE10",
    paymentMethod: "cod",
    shippingAddress: { receiverName: "Order Customer", receiverPhone: "0900000000", fullAddress: "1 Demo Street" }
  });
  assert.equal(created.status, 201);
  orderId = created.body.data.id;
  assert.equal(created.body.data.orderStatus, "pending");
  assert.equal(created.body.data.items[0].unitPrice, 100000);
  assert.equal(created.body.data.discountAmount, 20000);

  const inventory = await db.collection("inventories").findOne({ variantId });
  assert.equal(inventory.reservedQuantity, 2);
});

test("order creation rejects insufficient stock", async () => {
  const response = await customerAgent.post("/api/orders").send({
    items: [{ variantId: variantId.toHexString(), quantity: 20 }],
    paymentMethod: "cod",
    shippingAddress: { receiverName: "Order Customer", receiverPhone: "0900000000", fullAddress: "1 Demo Street" }
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "STOCK_UNAVAILABLE");
});

test("staff can confirm an order but customer cannot", async () => {
  const denied = await customerAgent.patch(`/api/orders/${orderId}/status`).send({ status: "confirmed" });
  assert.equal(denied.status, 403);

  const confirmed = await salesAgent.patch(`/api/orders/${orderId}/status`).send({ status: "confirmed" });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.data.orderStatus, "confirmed");
});

test("customer can create and list an appointment", async () => {
  const created = await customerAgent.post("/api/appointments").send({
    appointmentDate: "2026-11-01",
    startTime: "09:00",
    endTime: "10:00",
    consultationType: "skincare",
    customerNote: "Need a routine for sensitive skin"
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.status, "requested");

  const list = await customerAgent.get("/api/appointments");
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
});
