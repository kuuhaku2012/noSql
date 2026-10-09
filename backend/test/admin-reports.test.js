import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";
import request from "supertest";
import { createApp } from "../src/app.js";

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const dbName = `${process.env.MONGODB_TEST_DB || "maison_belle_test"}_reports`;
let client;
let db;
let managerAgent;

before(async () => {
  client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db(dbName);
  await db.dropDatabase();

  const managerId = new ObjectId();
  const productId = new ObjectId();
  const variantId = new ObjectId();
  await db.collection("users").insertOne({
    _id: managerId,
    email: "manager-reports@test.local",
    fullName: "Reports Manager",
    role: "manager",
    passwordHash: bcrypt.hashSync("Demo@123", 8),
    isActive: true
  });
  await db.collection("products").insertOne({
    _id: productId,
    name: "Report Serum",
    slug: "report-serum",
    isActive: true
  });
  await db.collection("product_variants").insertOne({
    _id: variantId,
    productId,
    sku: "REPORT-SERUM-30",
    retailPrice: 60000,
    isActive: true
  });
  await db.collection("orders").insertMany([
    {
      _id: new ObjectId(),
      orderCode: "REPORT-COMPLETED",
      userId: managerId,
      orderStatus: "completed",
      finalAmount: 120000,
      items: [{ productId, variantId, productName: "Report Serum", quantity: 2, unitPrice: 60000, lineTotal: 120000 }],
      createdAt: new Date("2026-10-01T10:00:00.000Z")
    },
    {
      _id: new ObjectId(),
      orderCode: "REPORT-SHIPPED",
      userId: managerId,
      orderStatus: "shipped",
      finalAmount: 80000,
      items: [{ productId, variantId, productName: "Report Serum", quantity: 1, unitPrice: 80000, lineTotal: 80000 }],
      createdAt: new Date("2026-10-02T10:00:00.000Z")
    },
    {
      _id: new ObjectId(),
      orderCode: "REPORT-CANCELLED",
      userId: managerId,
      orderStatus: "cancelled",
      finalAmount: 999999,
      items: [{ productId, variantId, productName: "Report Serum", quantity: 99, unitPrice: 9999, lineTotal: 999999 }],
      createdAt: new Date("2026-10-01T11:00:00.000Z")
    }
  ]);

  const app = createApp({ db, config: { jwtSecret: "test-secret", frontendRoot: new URL("../../", import.meta.url) } });
  managerAgent = request.agent(app);
  const login = await managerAgent.post("/api/auth/login").send({ email: "manager-reports@test.local", password: "Demo@123" });
  assert.equal(login.status, 200);
});

after(async () => {
  await client?.db(dbName).dropDatabase();
  await client?.close();
});

test("manager report includes daily sales and order status aggregates without cancelled orders", async () => {
  const response = await managerAgent.get("/api/admin/reports?from=2026-10-01&to=2026-10-03");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.summary, { orderCount: 2, revenue: 200000, itemCount: 3 });
  assert.deepEqual(response.body.data.topProducts, [{
    productId: response.body.data.topProducts[0].productId,
    name: "Report Serum",
    quantity: 3,
    revenue: 200000
  }]);
  assert.deepEqual(response.body.data.dailySales, [
    { date: "2026-10-01", orderCount: 1, revenue: 120000 },
    { date: "2026-10-02", orderCount: 1, revenue: 80000 }
  ]);
  assert.deepEqual(response.body.data.orderStatuses, [
    { status: "completed", count: 1, amount: 120000 },
    { status: "shipped", count: 1, amount: 80000 }
  ]);
  assert.equal(response.body.data.dailySales.some((item) => item.revenue === 999999), false);
  assert.equal(response.body.data.orderStatuses.some((item) => item.status === "cancelled"), false);
  assert.equal(response.body.data.topProducts[0].quantity, 3);
});
