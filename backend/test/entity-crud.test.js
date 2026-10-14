import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";
import request from "supertest";
import { createApp } from "../src/app.js";

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const dbName = `${process.env.MONGODB_TEST_DB || "maison_belle_test"}_entity_crud`;
let client;
let db;
let app;
let managerAgent;
let customerAgent;
let salesAgent;
let brandId;
let categoryId;
let storeId;
let variantId;

async function login(email) {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/login").send({ email, password: "Demo@123" });
  assert.equal(response.status, 200);
  return agent;
}

before(async () => {
  client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db(dbName);
  await db.dropDatabase();
  const manager = { _id: new ObjectId(), email: "manager-entity@test.local", fullName: "Entity Manager", role: "manager", passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true };
  const customer = { _id: new ObjectId(), email: "customer-entity@test.local", fullName: "Entity Customer", role: "customer", passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true };
  const sales = { _id: new ObjectId(), email: "sales-entity@test.local", fullName: "Entity Sales", role: "sales", passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true };
  brandId = new ObjectId();
  categoryId = new ObjectId();
  storeId = new ObjectId();
  const productId = new ObjectId();
  variantId = new ObjectId();
  await db.collection("users").insertMany([manager, customer, sales]);
  await db.collection("brands").insertOne({ _id: brandId, name: "Entity Brand", code: "ENT", slug: "entity-brand", isActive: true });
  await db.collection("categories").insertOne({ _id: categoryId, name: "Entity Category", slug: "entity-category", isActive: true });
  await db.collection("stores").insertOne({ _id: storeId, name: "Entity Store", isActive: true });
  await db.collection("products").insertOne({ _id: productId, name: "Entity Product", slug: "entity-product", brandId, categoryId, isActive: true });
  await db.collection("product_variants").insertOne({ _id: variantId, productId, sku: "ENTITY-001", retailPrice: 100000, originalPrice: 120000, isActive: true });
  await db.collection("inventories").insertOne({ _id: new ObjectId(), storeId, variantId, stockQuantity: 5, reservedQuantity: 0, version: 1 });
  await db.collection("shipping_rates").insertOne({ _id: new ObjectId(), code: "hcm-demo", regionName: "Hồ Chí Minh (demo)", fee: 25000, currency: "VND", isDemo: true, isActive: true });
  app = createApp({ db, config: { jwtSecret: "test-secret", frontendRoot: new URL("../../", import.meta.url) } });
  managerAgent = await login(manager.email);
  customerAgent = await login(customer.email);
  salesAgent = await login(sales.email);
});

after(async () => {
  await client?.db(dbName).dropDatabase();
  await client?.close();
});

test("manager has full CRUD for catalog stores", async () => {
  const created = await managerAgent.post("/api/admin/catalog/stores").send({ name: "Created Store", address: "1 Entity Street", isActive: true });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  const listed = await managerAgent.get("/api/admin/catalog/stores");
  assert.equal(listed.status, 200);
  assert.ok(listed.body.data.some((item) => item.id === id));
  const fetched = await managerAgent.get(`/api/admin/catalog/stores/${id}`);
  assert.equal(fetched.status, 200);
  const updated = await managerAgent.patch(`/api/admin/catalog/stores/${id}`).send({ name: "Updated Store" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.name, "Updated Store");
  const deleted = await managerAgent.delete(`/api/admin/catalog/stores/${id}`);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.data.isActive, false);
});

test("only manager can create, update, and deactivate users", async () => {
  const denied = await customerAgent.post("/api/admin/users").send({ email: "denied-entity@test.local", password: "Demo@123", fullName: "Denied", role: "customer" });
  assert.equal(denied.status, 403);
  const salesDenied = await salesAgent.post("/api/admin/users").send({ email: "sales-denied-entity@test.local", password: "Demo@123", fullName: "Denied Sales", role: "customer" });
  assert.equal(salesDenied.status, 403);
  assert.equal(await db.collection("users").countDocuments({ email: "sales-denied-entity@test.local" }), 0);
  const invalidActive = await managerAgent.post("/api/admin/users").send({ email: "invalid-active@test.local", password: "Demo@123", fullName: "Invalid Active", role: "customer", isActive: "false" });
  assert.equal(invalidActive.status, 400);
  const created = await managerAgent.post("/api/admin/users").send({ email: "created-entity@test.local", password: "Demo@123", fullName: "Created Entity", role: "customer", phone: "0900000011" });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  assert.equal(created.body.data.passwordHash, undefined);
  const listed = await managerAgent.get("/api/admin/users?role=customer");
  assert.equal(listed.status, 200);
  assert.ok(listed.body.data.some((item) => item.id === id));
  const fetched = await managerAgent.get(`/api/admin/users/${id}`);
  assert.equal(fetched.status, 200);
  const updated = await managerAgent.patch(`/api/admin/users/${id}`).send({ fullName: "Updated Entity" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.fullName, "Updated Entity");
  const deleted = await managerAgent.delete(`/api/admin/users/${id}`);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.data.isActive, false);
});

test("appointment CRUD is owner-scoped and delete cancels instead of erasing history", async () => {
  const created = await customerAgent.post("/api/appointments").send({ appointmentDate: "2027-01-10", startTime: "09:00", endTime: "10:00", consultationType: "skincare" });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  const fetched = await customerAgent.get(`/api/appointments/${id}`);
  assert.equal(fetched.status, 200);
  const tampered = await customerAgent.patch(`/api/appointments/${id}`).send({ status: "cancelled", employeeNote: "customer hack" });
  assert.equal(tampered.status, 403);
  const deleted = await customerAgent.delete(`/api/appointments/${id}`);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.data.status, "cancelled");
  assert.equal(await db.collection("appointments").countDocuments({ _id: new ObjectId(id) }), 1);
});

test("appointment booking serializes overlapping requests for one date", async () => {
  const requests = ["09:00", "09:30"].map((startTime) => customerAgent.post("/api/appointments").send({ appointmentDate: "2027-01-11", startTime, endTime: startTime === "09:00" ? "10:00" : "10:30", consultationType: "skincare" }));
  const responses = await Promise.all(requests);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
});

test("customer can delete only a pending order and reservation is released", async () => {
  const created = await customerAgent.post("/api/orders").send({ items: [{ variantId: variantId.toHexString(), quantity: 1 }], paymentMethod: "cod", shippingAddress: { receiverName: "Entity Customer", receiverPhone: "0900000000", fullAddress: "1 Entity Street", regionCode: "hcm-demo" } });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  const deleted = await customerAgent.delete(`/api/orders/${id}`);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.data.orderStatus, "cancelled");
  const inventory = await db.collection("inventories").findOne({ storeId, variantId });
  assert.equal(inventory.reservedQuantity, 0);
});

test("manager can CRUD mock payments and invoices", async () => {
  const manualOrderId = new ObjectId();
  await db.collection("orders").insertOne({ _id: manualOrderId, orderCode: "ENTITY-MANUAL", finalAmount: 1000, orderStatus: "pending" });
  const nonMock = await managerAgent.post("/api/admin/payments").send({ orderId: manualOrderId.toHexString(), method: "stripe", amount: 1000 });
  assert.equal(nonMock.status, 400);
  const order = await customerAgent.post("/api/orders").send({ items: [{ variantId: variantId.toHexString(), quantity: 1 }], paymentMethod: "cod", shippingAddress: { receiverName: "Entity Customer", receiverPhone: "0900000000", fullAddress: "1 Entity Street", regionCode: "hcm-demo" } });
  assert.equal(order.status, 201);
  const orderId = order.body.data.id;
  const payments = await managerAgent.get("/api/admin/payments");
  assert.equal(payments.status, 200);
  const payment = payments.body.data.find((item) => item.orderId === orderId);
  assert.ok(payment);
  const paymentUpdate = await managerAgent.patch(`/api/admin/payments/${payment.id}`).send({ status: "paid" });
  assert.equal(paymentUpdate.status, 200);
  const invoices = await managerAgent.get("/api/admin/invoices");
  assert.equal(invoices.status, 200);
  const invoice = invoices.body.data.find((item) => item.orderId === orderId);
  assert.ok(invoice);
  const invoiceUpdate = await managerAgent.patch(`/api/admin/invoices/${invoice.id}`).send({ status: "issued" });
  assert.equal(invoiceUpdate.status, 200);
  const invoiceVoid = await managerAgent.delete(`/api/admin/invoices/${invoice.id}`);
  assert.equal(invoiceVoid.status, 200);
  assert.equal(invoiceVoid.body.data.status, "void");
});
