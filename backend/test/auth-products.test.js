import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";
import request from "supertest";
import { createApp } from "../src/app.js";

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const dbName = process.env.MONGODB_TEST_DB || "maison_belle_test";
const collectionPrefix = `task3_auth_products_${process.pid}_`;
const ownedCollections = new Set();
const sentCodes = new Map();
let client;
let db;
let app;
let productId;
let brandId;
let categoryId;
let customer;
let sales;

before(async () => {
  client = new MongoClient(mongoUri);
  await client.connect();
  const database = client.db(dbName);
  const scopedCollections = new Map();
  db = { collection(name, ...args) {
    const scopedName = `${collectionPrefix}${name}`;
    ownedCollections.add(scopedName);
    if (!scopedCollections.has(name)) {
      const collection = database.collection(scopedName, ...args);
      scopedCollections.set(name, name === "products" ? new Proxy(collection, {
        get(target, property) {
          if (property === "aggregate") return (pipeline, ...aggregateArgs) => target.aggregate(pipeline.map((stage) => stage.$lookup?.from === "product_variants"
            ? { ...stage, $lookup: { ...stage.$lookup, from: `${collectionPrefix}product_variants` } }
            : stage), ...aggregateArgs);
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      }) : collection);
    }
    return scopedCollections.get(name);
  } };
  const roleCustomer = new ObjectId();
  const roleSales = new ObjectId();
  customer = { _id: new ObjectId(), email: "customer@test.local", fullName: "Test Customer", role: "customer", roleId: roleCustomer, passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true };
  sales = { _id: new ObjectId(), email: "sales@test.local", fullName: "Test Sales", role: "sales", roleId: roleSales, passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true };
  brandId = new ObjectId();
  categoryId = new ObjectId();
  productId = new ObjectId();
  const variantId = new ObjectId();
  await db.collection("roles").insertMany([{ _id: roleCustomer, name: "customer" }, { _id: roleSales, name: "sales" }]);
  await db.collection("users").insertMany([customer, sales]);
  await db.collection("brands").insertOne({ _id: brandId, name: "Test Brand", isActive: true });
  await db.collection("categories").insertOne({ _id: categoryId, name: "Skincare", slug: "skincare", isActive: true });
  await db.collection("products").insertOne({ _id: productId, slug: "test-serum", name: "Test Serum", brandId, categoryId, skinTypes: ["sensitive"], isActive: true, createdAt: new Date("2026-01-01") });
  await db.collection("product_variants").insertOne({ _id: variantId, productId, sku: "TEST-SERUM-30", retailPrice: 100000, originalPrice: 120000, volume: "30ml", isActive: true });
  await db.collection("stores").insertOne({ _id: new ObjectId("000000000000000000000001"), name: "Test Store", isActive: true });
  await db.collection("inventories").insertOne({ storeId: new ObjectId("000000000000000000000001"), variantId, stockQuantity: 10, reservedQuantity: 0, version: 1 });
  app = createApp({ db, mailer: { configured: true, async sendAuthCode({ email, purpose, code }) {
    sentCodes.set(`${purpose}:${email}`, code);
  } }, config: { jwtSecret: "test-secret", authCodeSecret: "test-auth-code-secret-at-least-32-chars", trustProxy: false, frontendRoot: new URL("../../", import.meta.url) } });
});

after(async () => {
  try {
    for (const name of ownedCollections) {
      await client?.db(dbName).collection(name).drop().catch((error) => {
        if (error.code !== 26) throw error;
      });
    }
  } finally {
    await client?.close();
  }
});

test("product search and detail return catalog data", async () => {
  const list = await request(app).get("/api/products?q=serum");
  assert.equal(list.status, 200);
  assert.equal(list.body.data[0].name, "Test Serum");

  const detail = await request(app).get(`/api/products/${productId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.variants.length, 1);
});

test("product search supports price sorting and price filters", async () => {
  const extraProductId = new ObjectId();
  const extraVariantId = new ObjectId();
  await db.collection("products").insertOne({ _id: extraProductId, slug: "expensive-serum", name: "Expensive Serum", brandId, categoryId, isActive: true, createdAt: new Date("2027-01-01") });
  await db.collection("product_variants").insertOne({ _id: extraVariantId, productId: extraProductId, sku: "EXPENSIVE-1", retailPrice: 200000, originalPrice: 220000, isActive: true });
  const response = await request(app).get("/api/products?sort=priceAsc&minPrice=50000");
  assert.equal(response.status, 200);
  assert.equal(response.body.data[0].name, "Test Serum");
});

test("login creates a session and logout clears it", async () => {
  const agent = request.agent(app);
  const failed = await agent.post("/api/auth/login").send({ email: customer.email, password: "wrong" });
  assert.equal(failed.status, 401);

  const loggedIn = await agent.post("/api/auth/login").send({ email: customer.email, password: "Demo@123" });
  assert.equal(loggedIn.status, 200);
  assert.equal(loggedIn.body.data.email, customer.email);

  const me = await agent.get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.data.role, "customer");

  const loggedOut = await agent.post("/api/auth/logout");
  assert.equal(loggedOut.status, 204);
});

test("public customer registration creates a safe customer session", async () => {
  const agent = request.agent(app);
  const input = {
    email: "  New.Customer@Test.Local  ",
    fullName: "New Customer",
    phone: "0900000999",
    password: "Secret@123",
    skinType: "sensitive",
    role: "manager",
    roleId: new ObjectId().toHexString(),
    isActive: false,
    isDemo: true
  };

  await agent.post("/api/auth/register/send-code").send({ email: input.email }).expect(202);
  input.verificationCode = sentCodes.get("register:new.customer@test.local");
  const registered = await agent.post("/api/auth/register").send(input);
  assert.equal(registered.status, 201);
  assert.equal(registered.body.data.email, "new.customer@test.local");
  assert.equal(registered.body.data.fullName, "New Customer");
  assert.equal(registered.body.data.phone, input.phone);
  assert.equal(registered.body.data.role, "customer");
  assert.equal(registered.body.data.isActive, true);
  assert.equal(registered.body.data.isDemo, undefined);
  assert.equal(registered.body.data.passwordHash, undefined);
  assert.match(registered.headers["set-cookie"].join(";"), /mb_token=/);
  assert.match(registered.headers["set-cookie"].join(";"), /HttpOnly/i);

  const stored = await db.collection("users").findOne({ email: "new.customer@test.local" });
  assert.equal(stored.role, "customer");
  assert.equal(stored.isActive, true);
  assert.equal(stored.isDemo, false);
  assert.notEqual(stored.passwordHash, input.password);
  assert.equal(await bcrypt.compare(input.password, stored.passwordHash), true);

  const current = await agent.get("/api/auth/me");
  assert.equal(current.status, 200);
  assert.equal(current.body.data.id, registered.body.data.id);
});

test("customer registration validates fields and rejects duplicate email or phone", async () => {
  const agent = request.agent(app);
  const invalid = await agent.post("/api/auth/register").send({ email: "bad", fullName: " ", password: "12345" });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "VALIDATION_ERROR");

  const invalidSkinType = await agent.post("/api/auth/register").send({ email: "skin@test.local", fullName: "Skin User", password: "Secret@123", skinType: "unknown" });
  assert.equal(invalidSkinType.status, 400);

  const duplicateEmail = await agent.post("/api/auth/register").send({ email: customer.email.toUpperCase(), fullName: "Duplicate", password: "Secret@123", verificationCode: "123456" });
  assert.equal(duplicateEmail.status, 409);
  assert.equal(duplicateEmail.body.error.code, "DUPLICATE_USER");

  await agent.post("/api/auth/register/send-code").send({ email: "phone-owner@test.local" }).expect(202);
  await agent.post("/api/auth/register").send({ email: "phone-owner@test.local", fullName: "Phone Owner", phone: "0900000123", password: "Secret@123", verificationCode: sentCodes.get("register:phone-owner@test.local") }).expect(201);
  await agent.post("/api/auth/register/send-code").send({ email: "phone-copy@test.local" }).expect(202);
  const duplicatePhone = await agent.post("/api/auth/register").send({ email: "phone-copy@test.local", fullName: "Phone Copy", phone: "0900000123", password: "Secret@123", verificationCode: sentCodes.get("register:phone-copy@test.local") });
  assert.equal(duplicatePhone.status, 409);
  assert.equal(duplicatePhone.body.error.code, "DUPLICATE_USER");
});

test("role checks protect admin catalog writes", async () => {
  const customerAgent = request.agent(app);
  await customerAgent.post("/api/auth/login").send({ email: customer.email, password: "Demo@123" });
  const denied = await customerAgent.post("/api/admin/products").send({ name: "Denied" });
  assert.equal(denied.status, 403);

  const salesAgent = request.agent(app);
  await salesAgent.post("/api/auth/login").send({ email: sales.email, password: "Demo@123" });
  const created = await salesAgent.post("/api/admin/products").send({
    name: "New Demo Product",
    slug: "new-demo-product",
    brandId: brandId.toHexString(),
    categoryId: categoryId.toHexString(),
    variants: [{ sku: "NEW-DEMO-1", retailPrice: 50000, originalPrice: 60000, volume: "15ml" }]
  });
  assert.equal(created.status, 201);
});
