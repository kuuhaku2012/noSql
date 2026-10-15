import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";
import request from "supertest";
import { createApp } from "../src/app.js";

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const dbName = `${process.env.MONGODB_TEST_DB || "maison_belle_test"}_admin`;
let client;
let db;
let app;
let warehouseAgent;
let salesAgent;
let managerAgent;
let storeId;
let variantId;
let completedOrderId;
let shippedOrderId;

before(async () => {
  client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db(dbName);
  await db.dropDatabase();
  const ids = { warehouse: new ObjectId(), sales: new ObjectId(), manager: new ObjectId() };
  const users = [
    ["warehouse-admin@test.local", "warehouse"],
    ["sales-admin@test.local", "sales"],
    ["manager-admin@test.local", "manager"]
  ].map(([email, role]) => ({ _id: new ObjectId(), email, fullName: role, role, roleId: ids[role], passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true }));
  storeId = new ObjectId();
  const productId = new ObjectId();
  variantId = new ObjectId();
  completedOrderId = new ObjectId();
  shippedOrderId = new ObjectId();
  const cancelledOrderId = new ObjectId();
  const now = new Date("2026-10-01T12:00:00Z");
  await db.collection("users").insertMany(users);
  await db.collection("brands").insertOne({ _id: new ObjectId(), name: "Admin Brand" });
  await db.collection("categories").insertOne({ _id: new ObjectId(), name: "Admin Category" });
  await db.collection("products").insertOne({ _id: productId, name: "Admin Product", slug: "admin-product", isActive: true });
  await db.collection("product_variants").insertOne({ _id: variantId, productId, sku: "ADMIN-1", retailPrice: 50000, isActive: true });
  await db.collection("stores").insertOne({ _id: storeId, name: "Admin Store", isActive: true });
  await db.collection("inventories").insertOne({ _id: new ObjectId(), storeId, variantId, stockQuantity: 10, reservedQuantity: 0, version: 1 });
  await db.collection("orders").insertMany([
    { _id: completedOrderId, orderCode: "MB-COMPLETE", userId: users[1]._id, storeId, orderStatus: "completed", finalAmount: 100000, items: [{ productId, variantId, productName: "Admin Product", quantity: 1, unitPrice: 50000, lineTotal: 50000 }, { productId, variantId, productName: "Admin Product", quantity: 1, unitPrice: 50000, lineTotal: 50000 }], createdAt: now },
    { _id: shippedOrderId, orderCode: "MB-SHIPPED", userId: users[1]._id, storeId, orderStatus: "shipped", finalAmount: 75000, items: [{ productId, variantId, productName: "Admin Product", quantity: 1, unitPrice: 75000, lineTotal: 75000 }], createdAt: new Date("2025-01-01T12:00:00Z") },
    { _id: cancelledOrderId, orderCode: "MB-CANCELLED", userId: users[1]._id, storeId, orderStatus: "cancelled", finalAmount: 999999, items: [{ productId, variantId, productName: "Admin Product", quantity: 99, unitPrice: 9999 }], createdAt: now }
  ]);
  app = createApp({ db, config: { jwtSecret: "test-secret", frontendRoot: new URL("../../frontend/", import.meta.url) } });
  warehouseAgent = request.agent(app);
  salesAgent = request.agent(app);
  managerAgent = request.agent(app);
  await warehouseAgent.post("/api/auth/login").send({ email: "warehouse-admin@test.local", password: "Demo@123" });
  await salesAgent.post("/api/auth/login").send({ email: "sales-admin@test.local", password: "Demo@123" });
  await managerAgent.post("/api/auth/login").send({ email: "manager-admin@test.local", password: "Demo@123" });
});

after(async () => {
  await client?.db(dbName).dropDatabase();
  await client?.close();
});

async function createApprovedSplitReturn(orderCode) {
  const returnStoreId = new ObjectId();
  const returnOrderId = new ObjectId();
  await db.collection("inventories").insertOne({
    _id: new ObjectId(), storeId: returnStoreId, variantId, stockQuantity: 4, reservedQuantity: 0, version: 1
  });
  await db.collection("orders").insertOne({
    _id: returnOrderId, orderCode, storeId: returnStoreId,
    orderStatus: "completed", items: [{ variantId, quantity: 3, unitPrice: 50000 }],
    createdAt: new Date("2025-01-01T00:00:00.000Z")
  });
  const created = await managerAgent.post("/api/admin/returns").send({
    orderId: String(returnOrderId), reason: "Split packaging",
    items: [{ variantId: String(variantId), quantity: 1 }, { variantId: String(variantId), quantity: 2 }]
  });
  assert.equal(created.status, 201);
  const returnId = new ObjectId(created.body.data.id);
  const url = `/api/admin/returns/${returnId}`;
  assert.equal((await managerAgent.patch(url).send({ status: "approved" })).status, 200);
  return { returnStoreId, returnId, url };
}

function dbWithInjectedInventoryLogFailure({ acknowledgementLost }) {
  let injected = false;
  const message = acknowledgementLost
    ? "injected lost return log acknowledgement"
    : "injected return log write failure";
  const failingDb = {
    collection(name) {
      const collection = db.collection(name);
      if (name !== "inventory_logs") return collection;
      return new Proxy(collection, {
        get(target, property) {
          if (property === "insertOne") return async (...args) => {
            if (injected) return target.insertOne(...args);
            injected = true;
            if (acknowledgementLost) await target.insertOne(...args);
            throw new Error(message);
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
  };
  return { db: failingDb, wasInjected: () => injected, message };
}

async function createManagerAgent(testDb) {
  const agent = request.agent(createApp({
    db: testDb,
    config: { jwtSecret: "test-secret", frontendRoot: new URL("../../frontend/", import.meta.url) }
  }));
  const login = await agent.post("/api/auth/login").send({ email: "manager-admin@test.local", password: "Demo@123" });
  assert.equal(login.status, 200);
  return agent;
}

test("warehouse receipt and adjustment protect stock", async () => {
  const list = await warehouseAgent.get("/api/admin/inventory");
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);

  const receipt = await warehouseAgent.post("/api/admin/stock-receipts").send({ storeId: storeId.toHexString(), items: [{ variantId: variantId.toHexString(), quantity: 5, unitCost: 40000, note: "Demo receipt" }] });
  assert.equal(receipt.status, 201);
  assert.equal(receipt.body.data.stockQuantity, 15);

  const rejected = await warehouseAgent.post("/api/admin/stock-adjustments").send({ storeId: storeId.toHexString(), variantId: variantId.toHexString(), quantity: -20, note: "Too low" });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error.code, "STOCK_NEGATIVE");
});

test("manager can create and update a promotion", async () => {
  const created = await managerAgent.post("/api/admin/promotions").send({ name: "Admin Demo Sale", startDate: "2026-10-01", endDate: "2026-10-31", items: [{ variantId: variantId.toHexString(), promotionPrice: 45000 }] });
  assert.equal(created.status, 201);
  const updated = await managerAgent.patch(`/api/admin/promotions/${created.body.data.id}`).send({ isActive: false });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.isActive, false);
});

test("sales can read promotions without receiving warehouse permissions", async () => {
  const response = await salesAgent.get("/api/admin/promotions");
  assert.equal(response.status, 200);
});

test("warehouse can create delivery and manager can create a return", async () => {
  const delivery = await warehouseAgent.post("/api/admin/deliveries").send({ orderId: shippedOrderId.toHexString(), storeId: storeId.toHexString(), deliveryAddress: "1 Admin Street" });
  assert.equal(delivery.status, 201);
  assert.equal(delivery.body.data.status, "ready");

  const returned = await managerAgent.post("/api/admin/returns").send({ orderId: completedOrderId.toHexString(), reason: "Demo return", items: [{ variantId: variantId.toHexString(), quantity: 1 }] });
  assert.equal(returned.status, 201);
  assert.equal(returned.body.data.status, "requested");
});

test("return approval does not restock and receipt restores accepted stock once", async () => {
  const returnStoreId = new ObjectId();
  const returnOrderId = new ObjectId();
  await db.collection("inventories").insertOne({
    _id: new ObjectId(), storeId: returnStoreId, variantId, stockQuantity: 4, reservedQuantity: 0, version: 1
  });
  await db.collection("orders").insertOne({
    _id: returnOrderId,
    orderCode: "MB-RETURN-REPLAY",
    storeId: returnStoreId,
    orderStatus: "completed",
    items: [{ variantId, quantity: 2, unitPrice: 50000 }],
    createdAt: new Date("2025-01-01T00:00:00.000Z")
  });

  const created = await managerAgent.post("/api/admin/returns").send({
    orderId: returnOrderId.toHexString(), reason: "Demo return", items: [{ variantId: variantId.toHexString(), quantity: 1 }]
  });
  assert.equal(created.status, 201);
  const returnId = new ObjectId(created.body.data.id);
  const approved = await managerAgent.patch(`/api/admin/returns/${returnId}`).send({ status: "approved" });
  assert.equal(approved.status, 200);
  assert.equal((await db.collection("inventories").findOne({ storeId: returnStoreId, variantId })).stockQuantity, 4);
  assert.equal(await db.collection("inventory_logs").countDocuments({ returnId }), 0);

  const received = await managerAgent.patch(`/api/admin/returns/${returnId}`).send({ status: "received" });
  assert.equal(received.status, 200);
  assert.equal((await db.collection("inventories").findOne({ storeId: returnStoreId, variantId })).stockQuantity, 5);
  assert.equal(await db.collection("inventory_logs").countDocuments({ returnId }), 1);

  const replay = await managerAgent.patch(`/api/admin/returns/${returnId}`).send({ status: "received" });
  assert.equal(replay.status, 200);
  assert.equal((await db.collection("inventories").findOne({ storeId: returnStoreId, variantId })).stockQuantity, 5);
  assert.equal(await db.collection("inventory_logs").countDocuments({ returnId }), 1);
  const stored = await db.collection("returns").findOne({ _id: returnId });
  assert.deepEqual(stored.history.map(({ status }) => status), ["requested", "approved", "received"]);
});

test("return receipt aggregates repeated variant lines and replay preserves all effects", async () => {
  const returnStoreId = new ObjectId();
  const returnOrderId = new ObjectId();
  await db.collection("inventories").insertOne({
    _id: new ObjectId(), storeId: returnStoreId, variantId, stockQuantity: 4, reservedQuantity: 0, version: 1
  });
  await db.collection("orders").insertOne({
    _id: returnOrderId, orderCode: "MB-RETURN-SPLIT", storeId: returnStoreId,
    orderStatus: "completed", items: [{ variantId, quantity: 3, unitPrice: 50000 }],
    createdAt: new Date("2025-01-01T00:00:00.000Z")
  });
  const created = await managerAgent.post("/api/admin/returns").send({
    orderId: String(returnOrderId), reason: "Split packaging",
    items: [{ variantId: String(variantId), quantity: 1 }, { variantId: String(variantId), quantity: 2 }]
  });
  assert.equal(created.status, 201);
  const returnId = new ObjectId(created.body.data.id);
  const url = `/api/admin/returns/${returnId}`;
  assert.equal((await managerAgent.patch(url).send({ status: "approved" })).status, 200);
  assert.equal((await db.collection("inventories").findOne({ storeId: returnStoreId, variantId })).stockQuantity, 4);
  assert.equal((await managerAgent.patch(url).send({ status: "received" })).status, 200);
  const inventory = await db.collection("inventories").findOne({ storeId: returnStoreId, variantId });
  assert.equal(inventory.stockQuantity, 7, "all three accepted units must be restocked");
  assert.equal(inventory.version, 2);
  assert.deepEqual(inventory.receivedReturnIds, [returnId]);
  const logs = await db.collection("inventory_logs").find({ returnId }).toArray();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].quantityChanged, 3);
  const stored = await db.collection("returns").findOne({ _id: returnId });
  assert.deepEqual(stored.history.map(({ status }) => status), ["requested", "approved", "received"]);
  assert.equal((await managerAgent.patch(url).send({ status: "received" })).status, 200);
  assert.deepEqual(await db.collection("inventories").findOne({ storeId: returnStoreId, variantId }), inventory);
  assert.deepEqual(await db.collection("inventory_logs").find({ returnId }).toArray(), logs);
  assert.deepEqual(await db.collection("returns").findOne({ _id: returnId }), stored);
});

test("return receipt retry inserts a missing inventory log after a failed insert without restocking again", async () => {
  const { returnStoreId, returnId, url } = await createApprovedSplitReturn("MB-RETURN-LOG-FAILURE");
  const injectedDb = dbWithInjectedInventoryLogFailure({ acknowledgementLost: false });
  const failingAgent = await createManagerAgent(injectedDb.db);

  const failed = await failingAgent.patch(url).send({ status: "received" });
  assert.equal(injectedDb.wasInjected(), true);
  assert.equal(failed.status, 500);
  const inventoryAfterFailure = await db.collection("inventories").findOne({ storeId: returnStoreId, variantId });
  assert.equal(inventoryAfterFailure.stockQuantity, 7);
  assert.equal(inventoryAfterFailure.version, 2);
  assert.deepEqual(inventoryAfterFailure.receivedReturnIds, [returnId]);
  assert.equal(await db.collection("inventory_logs").countDocuments({ returnId, variantId }), 0);

  const retried = await managerAgent.patch(url).send({ status: "received" });
  assert.equal(retried.status, 200);
  assert.deepEqual(await db.collection("inventories").findOne({ storeId: returnStoreId, variantId }), inventoryAfterFailure);
  const logs = await db.collection("inventory_logs").find({ returnId, variantId }).toArray();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].quantityChanged, 3);
  assert.equal(logs[0].changeType, "return");
  assert.equal(String(logs[0].inventoryId), String(inventoryAfterFailure._id));
  const stored = await db.collection("returns").findOne({ _id: returnId });
  assert.deepEqual(stored.history.map(({ status }) => status), ["requested", "approved", "received"]);
});

test("return receipt retry does not duplicate an inventory log whose insert acknowledgement was lost", async () => {
  const { returnStoreId, returnId, url } = await createApprovedSplitReturn("MB-RETURN-LOG-ACK-LOST");
  const injectedDb = dbWithInjectedInventoryLogFailure({ acknowledgementLost: true });
  const failingAgent = await createManagerAgent(injectedDb.db);

  const failed = await failingAgent.patch(url).send({ status: "received" });
  assert.equal(injectedDb.wasInjected(), true);
  assert.equal(failed.status, 500);
  const inventoryAfterFailure = await db.collection("inventories").findOne({ storeId: returnStoreId, variantId });
  assert.equal(inventoryAfterFailure.stockQuantity, 7);
  assert.equal(inventoryAfterFailure.version, 2);
  assert.deepEqual(inventoryAfterFailure.receivedReturnIds, [returnId]);
  const logsAfterFailure = await db.collection("inventory_logs").find({ returnId, variantId }).toArray();
  assert.equal(logsAfterFailure.length, 1);
  assert.equal(logsAfterFailure[0].quantityChanged, 3);

  const retried = await managerAgent.patch(url).send({ status: "received" });
  assert.equal(retried.status, 200);
  assert.deepEqual(await db.collection("inventories").findOne({ storeId: returnStoreId, variantId }), inventoryAfterFailure);
  assert.deepEqual(await db.collection("inventory_logs").find({ returnId, variantId }).toArray(), logsAfterFailure);
  const stored = await db.collection("returns").findOne({ _id: returnId });
  assert.deepEqual(stored.history.map(({ status }) => status), ["requested", "approved", "received"]);
});

test("reports are manager-only and exclude cancelled orders", async () => {
  const denied = await salesAgent.get("/api/admin/reports");
  assert.equal(denied.status, 403);

  const report = await managerAgent.get("/api/admin/reports?from=2026-10-01&to=2026-10-31");
  assert.equal(report.status, 200);
  assert.equal(report.body.data.summary.orderCount, 1);
  assert.equal(report.body.data.summary.revenue, 100000);
  assert.equal(report.body.data.summary.itemCount, 2);
});
