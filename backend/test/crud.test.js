import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";
import request from "supertest";
import { createApp } from "../src/app.js";

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const dbName = `${process.env.MONGODB_TEST_DB || "maison_belle_test"}_crud`;
let client;
let db;
let app;
let customerAgent;
let salesAgent;
let warehouseAgent;
let managerAgent;
let brandId;
let categoryId;
let storeId;
let productId;
let variantId;
let orderId;
let shippedOrderId;

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

  const users = [
    ["customer-crud@test.local", "customer"],
    ["sales-crud@test.local", "sales"],
    ["warehouse-crud@test.local", "warehouse"],
    ["manager-crud@test.local", "manager"]
  ].map(([email, role]) => ({ _id: new ObjectId(), email, fullName: role, role, roleId: new ObjectId(), passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true }));
  brandId = new ObjectId();
  categoryId = new ObjectId();
  storeId = new ObjectId();
  productId = new ObjectId();
  variantId = new ObjectId();
  orderId = new ObjectId();
  shippedOrderId = new ObjectId();

  await db.collection("users").insertMany(users);
  await db.collection("brands").insertOne({ _id: brandId, name: "CRUD Brand", isActive: true });
  await db.collection("categories").insertOne({ _id: categoryId, name: "CRUD Category", slug: "crud-category", isActive: true });
  await db.collection("stores").insertOne({ _id: storeId, name: "CRUD Store", isActive: true });
  await db.collection("products").insertOne({ _id: productId, name: "CRUD Product", slug: "crud-product", brandId, categoryId, isActive: true, createdAt: new Date(), updatedAt: new Date() });
  await db.collection("product_variants").insertOne({ _id: variantId, productId, sku: "CRUD-001", retailPrice: 100000, originalPrice: 120000, isActive: true });
  await db.collection("inventories").insertOne({ _id: new ObjectId(), storeId, variantId, stockQuantity: 10, reservedQuantity: 0, version: 1 });
  await db.collection("orders").insertMany([
    { _id: orderId, orderCode: "CRUD-ORDER", userId: users[0]._id, storeId, orderStatus: "completed", finalAmount: 100000, items: [{ variantId, quantity: 1 }], createdAt: new Date() },
    { _id: shippedOrderId, orderCode: "CRUD-SHIPPED", userId: users[0]._id, storeId, orderStatus: "shipped", finalAmount: 100000, items: [{ variantId, quantity: 1 }], createdAt: new Date() }
  ]);

  app = createApp({ db, config: { jwtSecret: "test-secret", frontendRoot: new URL("../../", import.meta.url) } });
  customerAgent = await login("customer-crud@test.local");
  salesAgent = await login("sales-crud@test.local");
  warehouseAgent = await login("warehouse-crud@test.local");
  managerAgent = await login("manager-crud@test.local");
});

after(async () => {
  await client?.db(dbName).dropDatabase();
  await client?.close();
});

test("admin product CRUD persists and soft-deletes catalog data", async () => {
  const created = await salesAgent.post("/api/admin/products").send({
    name: "Created CRUD Product",
    slug: "created-crud-product",
    brandId: brandId.toHexString(),
    categoryId: categoryId.toHexString(),
    variants: [
      { sku: "CREATED-001", retailPrice: 150000, originalPrice: 180000, volume: "30ml" },
      { sku: "CREATED-002", retailPrice: 160000, originalPrice: 190000, volume: "50ml" }
    ]
  });
  assert.equal(created.status, 201);
  const createdId = created.body.data.id;
  const createdVariantId = created.body.data.variants[0].id;
  const otherVariantSku = created.body.data.variants[1].sku;

  const duplicateSku = await salesAgent.patch(`/api/admin/products/${createdId}`).send({ variants: [{ id: createdVariantId, sku: otherVariantSku }] });
  assert.equal(duplicateSku.status, 409);

  const updated = await salesAgent.patch(`/api/admin/products/${createdId}`).send({
    name: "Updated CRUD Product",
    variants: [{ id: createdVariantId, retailPrice: 140000, originalPrice: 180000 }]
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.name, "Updated CRUD Product");
  assert.equal(updated.body.data.variants[0].retailPrice, 140000);

  const deleted = await salesAgent.delete(`/api/admin/products/${createdId}`);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.data.isActive, false);
  assert.equal((await db.collection("products").findOne({ _id: new ObjectId(createdId) })).isActive, false);
  assert.equal((await db.collection("product_variants").findOne({ _id: new ObjectId(createdVariantId) })).isActive, false);
  const publicDetail = await request(app).get(`/api/products/${createdId}`);
  assert.equal(publicDetail.status, 404);
});

test("product PATCH rejects invalid field types", async () => {
  const response = await salesAgent.patch(`/api/admin/products/${productId}`).send({ name: 42 });
  assert.equal(response.status, 400);
});

test("customer cannot use admin CRUD endpoints", async () => {
  const response = await customerAgent.post("/api/admin/vouchers").send({ code: "CUSTOMER10" });
  assert.equal(response.status, 403);
});

test("admin write role boundaries reject anonymous and non-authorized staff without mutation", async () => {
  const productsBefore = await db.collection("products").countDocuments();
  const anonymousProductWrite = await request(app).post("/api/admin/products").send({ name: "Anonymous Product" });
  assert.equal(anonymousProductWrite.status, 401);
  assert.equal(await db.collection("products").countDocuments(), productsBefore);

  const productsBeforeWarehouse = await db.collection("products").countDocuments();
  const warehouseProductWrite = await warehouseAgent.post("/api/admin/products").send({ name: "Warehouse Product" });
  assert.equal(warehouseProductWrite.status, 403);
  assert.equal(await db.collection("products").countDocuments(), productsBeforeWarehouse);

  const inventoryBefore = await db.collection("inventories").findOne({ storeId, variantId });
  const inventoryLogsBefore = await db.collection("inventory_logs").countDocuments({ storeId, variantId });
  const salesAdjustment = await salesAgent.post("/api/admin/stock-adjustments").send({ storeId: storeId.toHexString(), variantId: variantId.toHexString(), quantity: 1, note: "Denied sales adjustment" });
  assert.equal(salesAdjustment.status, 403);
  assert.deepEqual(await db.collection("inventories").findOne({ storeId, variantId }), inventoryBefore);
  assert.equal(await db.collection("inventory_logs").countDocuments({ storeId, variantId }), inventoryLogsBefore);
  const customerAdjustment = await customerAgent.post("/api/admin/stock-adjustments").send({ storeId: storeId.toHexString(), variantId: variantId.toHexString(), quantity: 1, note: "Denied customer adjustment" });
  assert.equal(customerAdjustment.status, 403);
  assert.deepEqual(await db.collection("inventories").findOne({ storeId, variantId }), inventoryBefore);
  assert.equal(await db.collection("inventory_logs").countDocuments({ storeId, variantId }), inventoryLogsBefore);

  const deliveriesBefore = await db.collection("deliveries").countDocuments();
  const customerDelivery = await customerAgent.post("/api/admin/deliveries").send({ orderId: shippedOrderId.toHexString(), storeId: storeId.toHexString(), deliveryAddress: "Denied delivery" });
  assert.equal(customerDelivery.status, 403);
  assert.equal(await db.collection("deliveries").countDocuments(), deliveriesBefore);
});

test("manager can CRUD vouchers and validate only active records", async () => {
  const created = await managerAgent.post("/api/admin/vouchers").send({
    code: "CRUD10",
    discountType: "percentage",
    discountValue: 10,
    minOrderValue: 100000,
    maxDiscountAmount: 50000,
    startDate: "2026-01-01",
    endDate: "2027-01-01",
    totalUsageLimit: 100
  });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  assert.equal(created.body.data.code, "CRUD10");

  const listed = await managerAgent.get("/api/admin/vouchers");
  assert.equal(listed.status, 200);
  assert.ok(listed.body.pagination);
  assert.equal(listed.body.data.some((voucher) => voucher.id === id), true);
  const fetched = await managerAgent.get(`/api/admin/vouchers/${id}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.data.code, "CRUD10");

  const updated = await managerAgent.patch(`/api/admin/vouchers/${id}`).send({ discountValue: 15 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.discountValue, 15);
  const invalidBoolean = await managerAgent.patch(`/api/admin/vouchers/${id}`).send({ isActive: "false" });
  assert.equal(invalidBoolean.status, 400);

  const validated = await customerAgent.post("/api/vouchers/validate").send({ code: "CRUD10", subtotal: 200000 });
  assert.equal(validated.status, 200);
  assert.equal(validated.body.data.discountAmount, 30000);

  const deleted = await managerAgent.delete(`/api/admin/vouchers/${id}`);
  assert.equal(deleted.status, 200);
  const rejected = await customerAgent.post("/api/vouchers/validate").send({ code: "CRUD10", subtotal: 200000 });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error.code, "VOUCHER_INACTIVE");
});

test("promotion CRUD soft-deactivates the promotion", async () => {
  const created = await managerAgent.post("/api/admin/promotions").send({ name: "CRUD Sale", startDate: "2026-10-01", endDate: "2026-10-31", items: [{ variantId: variantId.toHexString(), promotionPrice: 90000 }] });
  assert.equal(created.status, 201);
  const listed = await managerAgent.get("/api/admin/promotions");
  assert.equal(listed.status, 200);
  assert.ok(listed.body.pagination);
  const deleted = await managerAgent.delete(`/api/admin/promotions/${created.body.data.id}`);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.data.isActive, false);
  const persisted = await db.collection("promotions").findOne({ _id: new ObjectId(created.body.data.id) });
  assert.ok(persisted);
  assert.equal(persisted.isActive, false);
});

test("delivery and return status updates enforce transitions", async () => {
  const delivery = await warehouseAgent.post("/api/admin/deliveries").send({ orderId: shippedOrderId.toHexString(), storeId: storeId.toHexString(), deliveryAddress: "1 CRUD Street" });
  assert.equal(delivery.status, 201);
  const deliveryList = await managerAgent.get("/api/admin/deliveries");
  assert.equal(deliveryList.status, 200);
  assert.ok(deliveryList.body.pagination);
  const assigned = await warehouseAgent.patch(`/api/admin/deliveries/${delivery.body.data.id}`).send({ status: "assigned" });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.data.status, "assigned");
  const invalidDelivery = await warehouseAgent.patch(`/api/admin/deliveries/${delivery.body.data.id}`).send({ status: "delivered" });
  assert.equal(invalidDelivery.status, 409);

  const returned = await managerAgent.post("/api/admin/returns").send({ orderId: orderId.toHexString(), reason: "CRUD return", items: [{ variantId: variantId.toHexString(), quantity: 1 }] });
  assert.equal(returned.status, 201);
  const returnList = await managerAgent.get("/api/admin/returns");
  assert.equal(returnList.status, 200);
  assert.ok(returnList.body.pagination);
  const approved = await managerAgent.patch(`/api/admin/returns/${returned.body.data.id}`).send({ status: "approved" });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.data.status, "approved");
  const invalidReturn = await managerAgent.patch(`/api/admin/returns/${returned.body.data.id}`).send({ status: "refunded" });
  assert.equal(invalidReturn.status, 409);
});

test("promotion and return writes reject malformed references", async () => {
  const invalidPromotion = await managerAgent.post("/api/admin/promotions").send({ name: "Invalid CRUD Sale", startDate: "2026-10-01", endDate: "2026-10-31", items: { variantId: "bad" } });
  assert.equal(invalidPromotion.status, 400);

  const invalidReturn = await managerAgent.post("/api/admin/returns").send({ orderId: orderId.toHexString(), reason: "Invalid CRUD return", items: [{ variantId: new ObjectId().toHexString(), quantity: 1 }] });
  assert.equal(invalidReturn.status, 409);
});
