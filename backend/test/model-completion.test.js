import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createIndexes } from "../scripts/create-indexes.js";
import { seedDemo } from "../scripts/seed.js";

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const dbName = `${process.env.MONGODB_TEST_DB || "maison_belle_test"}_model_completion`;
let client;
let db;
let app;
let customerAgent;
let managerAgent;
let salesAgent;
let warehouseAgent;
let productId;
let recommendedProductId;
let recommendationId;
let variantId;
let customerId;

before(async () => {
  client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db(dbName);
  await db.dropDatabase();
  const brandId = new ObjectId();
  const categoryId = new ObjectId();
  productId = new ObjectId();
  recommendedProductId = new ObjectId();
  variantId = new ObjectId();
  customerId = new ObjectId();
  const managerId = new ObjectId();
  const salesId = new ObjectId();
  const warehouseId = new ObjectId();
  await db.collection("users").insertMany([
    { _id: customerId, email: "model-customer@test.local", fullName: "Model Customer", role: "customer", passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true },
    { _id: managerId, email: "model-manager@test.local", fullName: "Model Manager", role: "manager", passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true },
    { _id: salesId, email: "model-sales@test.local", fullName: "Model Sales", role: "sales", passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true },
    { _id: warehouseId, email: "model-warehouse@test.local", fullName: "Model Warehouse", role: "warehouse", passwordHash: bcrypt.hashSync("Demo@123", 8), isActive: true }
  ]);
  await db.collection("brands").insertOne({ _id: brandId, name: "Model Brand", isActive: true });
  await db.collection("categories").insertOne({ _id: categoryId, name: "Model Category", slug: "model-category", isActive: true });
  await db.collection("products").insertMany([
    { _id: productId, name: "Model Serum", slug: "model-serum", brandId, categoryId, isActive: true },
    { _id: recommendedProductId, name: "Model Cream", slug: "model-cream", brandId, categoryId, isActive: true }
  ]);
  await db.collection("product_variants").insertOne({ _id: variantId, productId, sku: "MODEL-001", retailPrice: 100000, originalPrice: 120000, isActive: true });
  recommendationId = new ObjectId();
  await db.collection("product_recommendations").insertOne({ _id: recommendationId, productId, recommendedProductId, rank: 1, isActive: true, createdAt: new Date() });
  await db.collection("vouchers").insertMany([
    { _id: new ObjectId(), code: "MODEL10", discountType: "percentage", discountValue: 10, minOrderValue: 0, startDate: new Date("2026-01-01"), endDate: new Date("2027-12-31"), isActive: true, usedCount: 0 },
    { _id: new ObjectId(), code: "MODELCLAIM", discountType: "fixed", discountValue: 10000, minOrderValue: 0, startDate: new Date("2026-01-01"), endDate: new Date("2027-12-31"), isActive: true, usedCount: 0 }
  ]);
  app = createApp({ db, config: { jwtSecret: "model-secret", frontendRoot: new URL("../../frontend/", import.meta.url) } });
  customerAgent = request.agent(app);
  managerAgent = request.agent(app);
  salesAgent = request.agent(app);
  warehouseAgent = request.agent(app);
  assert.equal((await customerAgent.post("/api/auth/login").send({ email: "model-customer@test.local", password: "Demo@123" })).status, 200);
  assert.equal((await managerAgent.post("/api/auth/login").send({ email: "model-manager@test.local", password: "Demo@123" })).status, 200);
  assert.equal((await salesAgent.post("/api/auth/login").send({ email: "model-sales@test.local", password: "Demo@123" })).status, 200);
  assert.equal((await warehouseAgent.post("/api/auth/login").send({ email: "model-warehouse@test.local", password: "Demo@123" })).status, 200);
});

after(async () => {
  await client?.db(dbName).dropDatabase();
  await client?.db(`${dbName}_seed`).dropDatabase();
  await client?.close();
});

test("model index script creates all missing logical collections and indexes", async () => {
  await createIndexes(db);
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name));
  for (const name of ["flash_sales", "consultation_reviews", "product_recommendations", "product_views", "reviews", "user_behaviors", "user_vouchers", "wishlists"]) {
    assert.equal(names.has(name), true, `${name} collection should exist`);
  }
  assert.ok((await db.collection("product_recommendations").indexes()).some((index) => index.name === "productId_1_recommendedProductId_1"));
  assert.ok((await db.collection("user_vouchers").indexes()).some((index) => index.name === "userId_1_voucherId_1"));
  assert.ok((await db.collection("wishlists").indexes()).some((index) => index.name === "userId_1"));
});

test("demo seed writes new entities to the canonical snake_case collections", async () => {
  const seedDb = client.db(`${dbName}_seed`);
  await seedDb.dropDatabase();
  await seedDemo(seedDb, { databaseName: `${dbName}_seed`, allowDemoSeed: false });
  for (const name of ["consultation_reviews", "flash_sales", "inventory_logs", "order_histories", "point_histories", "product_recommendations", "product_views", "user_behaviors", "user_vouchers", "user_addresses"]) {
    assert.ok(await seedDb.collection(name).countDocuments({ isDemo: true }), `${name} should contain demo data`);
  }
  for (const legacyName of ["consultationReviews", "flashSales", "inventoryLogs", "orderHistories", "pointHistories", "productRecommendations", "productViews", "userBehaviors", "userVouchers", "userAddresses"]) {
    assert.equal(await seedDb.collection(legacyName).countDocuments({}), 0, `${legacyName} should not contain seed data`);
  }
});

test("reviews recommendations views and behaviors follow ownership and moderation rules", async () => {
  const recommendation = await customerAgent.get(`/api/products/${productId}/recommendations`);
  assert.equal(recommendation.status, 200);
  assert.equal(recommendation.body.data[0].recommendedProductId, recommendedProductId.toHexString());

  const created = await customerAgent.post(`/api/products/${productId}/reviews`).send({ rating: 5, comment: "Very good" });
  assert.equal(created.status, 201);
  const reviewId = created.body.data.id;
  assert.equal(created.body.data.status, "pending");

  const publicBeforeApproval = await customerAgent.get(`/api/products/${productId}/reviews`);
  assert.equal(publicBeforeApproval.status, 200);
  assert.equal(publicBeforeApproval.body.data.length, 0);

  const moderated = await managerAgent.patch(`/api/reviews/${reviewId}`).send({ status: "approved" });
  assert.equal(moderated.status, 200);
  const publicAfterApproval = await customerAgent.get(`/api/products/${productId}/reviews`);
  assert.equal(publicAfterApproval.body.data.length, 1);

  const view = await customerAgent.post(`/api/products/${productId}/views`).send({ source: "detail" });
  assert.equal(view.status, 201);
  const behavior = await customerAgent.post("/api/behaviors").send({ productId: productId.toHexString(), actionType: "favorite", metadata: { source: "model-test" } });
  assert.equal(behavior.status, 201);
  assert.equal(await db.collection("product_views").countDocuments({ productId }), 1);
  assert.equal(await db.collection("user_behaviors").countDocuments({ productId, actionType: "favorite" }), 1);
});

test("manager-only recommendation writes and behavior reports reject other roles without mutation", async () => {
  const recommendation = await db.collection("product_recommendations").findOne({ _id: recommendationId });
  const recommendationCount = await db.collection("product_recommendations").countDocuments();
  const actors = [
    ["anonymous", request(app), 401],
    ["sales", salesAgent, 403],
    ["warehouse", warehouseAgent, 403],
    ["customer", customerAgent, 403]
  ];

  for (const [role, agent, expectedStatus] of actors) {
    const deniedCreate = await agent.post("/api/admin/recommendations").send({
      productId: productId.toHexString(),
      recommendedProductId: recommendedProductId.toHexString(),
      reason: `Denied ${role} recommendation`
    });
    assert.equal(deniedCreate.status, expectedStatus, `${role} cannot create recommendations`);
    assert.equal(await db.collection("product_recommendations").countDocuments(), recommendationCount);
    assert.deepEqual(await db.collection("product_recommendations").findOne({ _id: recommendationId }), recommendation);

    const deniedUpdate = await agent.patch(`/api/admin/recommendations/${recommendationId}`).send({ rank: 9 });
    assert.equal(deniedUpdate.status, expectedStatus, `${role} cannot update recommendations`);
    assert.deepEqual(await db.collection("product_recommendations").findOne({ _id: recommendationId }), recommendation);

    const deniedDelete = await agent.delete(`/api/admin/recommendations/${recommendationId}`);
    assert.equal(deniedDelete.status, expectedStatus, `${role} cannot deactivate recommendations`);
    assert.deepEqual(await db.collection("product_recommendations").findOne({ _id: recommendationId }), recommendation);

    const behaviorCount = await db.collection("user_behaviors").countDocuments();
    const deniedBehaviorRead = await agent.get("/api/admin/behaviors");
    assert.equal(deniedBehaviorRead.status, expectedStatus, `${role} cannot read admin behavior data`);
    assert.equal(await db.collection("user_behaviors").countDocuments(), behaviorCount);
  }
});

test("wishlist and user voucher workflows are private, unique and role-scoped", async () => {
  const saved = await customerAgent.put("/api/wishlist").send({ items: [{ productId: productId.toHexString() }, { productId: recommendedProductId.toHexString() }] });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.items.length, 2);
  const listed = await customerAgent.get("/api/wishlist");
  assert.equal(listed.status, 200);
  const removed = await customerAgent.delete(`/api/wishlist/items/${productId.toHexString()}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.data.items.length, 1);

  const voucherId = (await db.collection("vouchers").findOne({ code: "MODEL10" }))._id.toHexString();
  const claimVoucherId = (await db.collection("vouchers").findOne({ code: "MODELCLAIM" }))._id;
  const assignedBeforeDeniedWrites = await db.collection("user_vouchers").countDocuments({ userId: customerId, voucherId: claimVoucherId });
  const nonManagerAgents = [
    ["anonymous", request(app), 401],
    ["sales", salesAgent, 403],
    ["warehouse", warehouseAgent, 403],
    ["customer", customerAgent, 403]
  ];
  for (const [role, agent, expectedStatus] of nonManagerAgents) {
    const deniedAssignment = await agent.post("/api/admin/user-vouchers").send({ userId: customerId.toHexString(), voucherId: claimVoucherId.toHexString() });
    assert.equal(deniedAssignment.status, expectedStatus, `${role} cannot assign a voucher through the admin route`);
    assert.equal(
      await db.collection("user_vouchers").countDocuments({ userId: customerId, voucherId: claimVoucherId }),
      assignedBeforeDeniedWrites,
      `${role} denial must not create an assignment`
    );
  }

  const assigned = await managerAgent.post("/api/admin/user-vouchers").send({ userId: customerId.toHexString(), voucherId });
  assert.equal(assigned.status, 201);
  const mine = await customerAgent.get("/api/vouchers/mine");
  assert.equal(mine.status, 200);
  assert.equal(mine.body.data.length, 1);
  const claimed = await customerAgent.post("/api/vouchers/claim").send({ code: "MODELCLAIM" });
  assert.equal(claimed.status, 201);
  const duplicate = await customerAgent.post("/api/vouchers/claim").send({ code: "MODELCLAIM" });
  assert.equal(duplicate.status, 409);
});

test("flash sales and consultation products/reviews follow business rules", async () => {
  const sale = await managerAgent.post("/api/admin/flash-sales").send({
    name: "Model Flash Sale",
    startDate: "2026-01-01",
    endDate: "2027-01-01",
    items: [{ variantId: variantId.toHexString(), promotionPrice: 80000, quantityLimit: 10, maxQuantityPerUser: 2 }]
  });
  assert.equal(sale.status, 201);
  const flashSales = db.collection("flash_sales");
  const saleId = new ObjectId(sale.body.data.id);
  const saleBeforeDeniedWrites = await flashSales.findOne({ _id: saleId });
  const saleCountBeforeDeniedWrites = await flashSales.countDocuments();
  const nonManagerAgents = [
    ["anonymous", request(app), 401],
    ["sales", salesAgent, 403],
    ["warehouse", warehouseAgent, 403],
    ["customer", customerAgent, 403]
  ];
  for (const [role, agent, expectedStatus] of nonManagerAgents) {
    const deniedCreate = await agent.post("/api/admin/flash-sales").send({ name: `Denied ${role} sale`, startDate: "2026-01-01", endDate: "2027-01-01", items: [{ variantId: variantId.toHexString(), promotionPrice: 80000, quantityLimit: 1 }] });
    assert.equal(deniedCreate.status, expectedStatus, `${role} cannot create flash sales`);
    assert.equal(await flashSales.countDocuments(), saleCountBeforeDeniedWrites);
    assert.deepEqual(await flashSales.findOne({ _id: saleId }), saleBeforeDeniedWrites);

    const deniedUpdate = await agent.patch(`/api/admin/flash-sales/${saleId}`).send({ name: `Changed by ${role}` });
    assert.equal(deniedUpdate.status, expectedStatus, `${role} cannot update flash sales`);
    assert.deepEqual(await flashSales.findOne({ _id: saleId }), saleBeforeDeniedWrites);

    const deniedDelete = await agent.delete(`/api/admin/flash-sales/${saleId}`);
    assert.equal(deniedDelete.status, expectedStatus, `${role} cannot deactivate flash sales`);
    assert.deepEqual(await flashSales.findOne({ _id: saleId }), saleBeforeDeniedWrites);
  }

  const activeSales = await customerAgent.get("/api/flash-sales");
  assert.equal(activeSales.status, 200);
  assert.equal(activeSales.body.data.length, 1);
  const invalidSale = await managerAgent.post("/api/admin/flash-sales").send({ name: "Invalid Sale", startDate: "2026-01-01", endDate: "2027-01-01", items: [{ variantId: variantId.toHexString(), promotionPrice: 120000, quantityLimit: 1 }] });
  assert.equal(invalidSale.status, 400);

  const appointment = await customerAgent.post("/api/appointments").send({ appointmentDate: "2027-03-10", startTime: "10:00", endTime: "11:00", consultationType: "skin", products: [{ productId: productId.toHexString(), variantId: variantId.toHexString(), note: "Model recommendation" }] });
  assert.equal(appointment.status, 201);
  assert.equal(appointment.body.data.products.length, 1);
  const appointmentId = appointment.body.data.id;
  assert.equal((await managerAgent.patch(`/api/appointments/${appointmentId}`).send({ status: "confirmed" })).status, 200);
  assert.equal((await managerAgent.patch(`/api/appointments/${appointmentId}`).send({ status: "completed" })).status, 200);
  const consultationReview = await customerAgent.post(`/api/appointments/${appointmentId}/reviews`).send({ rating: 5, comment: "Helpful consultation" });
  assert.equal(consultationReview.status, 201);
  const duplicate = await customerAgent.post(`/api/appointments/${appointmentId}/reviews`).send({ rating: 4, comment: "Duplicate" });
  assert.equal(duplicate.status, 409);
});
