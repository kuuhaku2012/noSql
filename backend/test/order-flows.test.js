import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createOrder } from "../src/services/order-service.js";
import { createIndexes } from "../scripts/create-indexes.js";

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const dbName = `${process.env.MONGODB_TEST_DB || "maison_belle_test"}_orders`;
const indexDbName = `${process.env.MONGODB_TEST_DB || "maison_belle_test"}_index_preflight`;
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
  await client.db(indexDbName).dropDatabase();
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
  await db.collection("shipping_rates").insertOne({ _id: new ObjectId(), code: "hcm-demo", regionName: "Hồ Chí Minh (demo)", fee: 25000, currency: "VND", isDemo: true, isActive: true });
  await db.collection("orders").createIndex({ userId: 1, checkoutRequestId: 1 }, { unique: true, partialFilterExpression: { checkoutRequestId: { $type: "string" } } });
  app = createApp({ db, config: { jwtSecret: "test-secret", frontendRoot: new URL("../../", import.meta.url) } });
  customerAgent = request.agent(app);
  salesAgent = request.agent(app);
  await customerAgent.post("/api/auth/login").send({ email: customer.email, password: "Demo@123" });
  await salesAgent.post("/api/auth/login").send({ email: sales.email, password: "Demo@123" });
});

after(async () => {
  await client?.db(dbName).dropDatabase();
  await client?.db(indexDbName).dropDatabase();
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

test("checkout derives shipping from the active rate and retries one request idempotently", async () => {
  const body = {
    checkoutRequestId: "checkout-attempt-1",
    items: [{ variantId: variantId.toHexString(), quantity: 2 }],
    voucherCode: "BELLE10",
    paymentMethod: "cod",
    deliveryFee: 999999,
    shippingAddress: { receiverName: "Order Customer", receiverPhone: "0900000000", fullAddress: "1 Demo Street", regionCode: "hcm-demo", regionName: "Forged Region" }
  };
  const before = {
    orders: await db.collection("orders").countDocuments({ userId: customer._id }),
    reservedQuantity: (await db.collection("inventories").findOne({ variantId })).reservedQuantity,
    voucherUses: (await db.collection("vouchers").findOne({ code: "BELLE10" })).usedCount
  };
  const responses = await Promise.all([
    customerAgent.post("/api/orders").send(body),
    customerAgent.post("/api/orders").send(body)
  ]);
  const responseDetails = JSON.stringify(responses.map(({ status, body: responseBody }) => ({ status, body: responseBody })));
  const createdResponses = responses.filter(({ status }) => status === 201);
  const inProgressResponses = responses.filter(({ status, body: responseBody }) =>
    status === 409 && responseBody?.error?.code === "CHECKOUT_IN_PROGRESS"
  );
  assert.ok(
    createdResponses.length === 2 || (createdResponses.length === 1 && inProgressResponses.length === 1),
    `Unexpected concurrent checkout outcomes: ${responseDetails}`
  );
  const created = createdResponses[0];
  orderId = created.body.data.id;
  assert.equal(created.body.data.orderStatus, "pending");
  assert.equal(created.body.data.items[0].unitPrice, 100000);
  assert.equal(created.body.data.discountAmount, 20000);
  assert.equal(created.body.data.deliveryFee, 25000);
  assert.equal(created.body.data.finalAmount, 205000);
  assert.equal(created.body.data.shippingAddress.regionName, "Hồ Chí Minh (demo)");
  assert.deepEqual(created.body.data.shippingRateSnapshot, {
    regionCode: "hcm-demo", regionName: "Hồ Chí Minh (demo)", fee: 25000, currency: "VND", isDemo: true
  });
  if (inProgressResponses.length) {
    const replay = await customerAgent.post("/api/orders").send(body);
    assert.equal(replay.status, 201, `Checkout retry failed: ${JSON.stringify({ status: replay.status, body: replay.body })}`);
    assert.equal(replay.body.data.id, orderId);
  } else {
    assert.equal(createdResponses[1].body.data.id, orderId);
  }
  assert.equal(await db.collection("orders").countDocuments({ userId: customer._id }), before.orders + 1);
  assert.equal(await db.collection("orders").countDocuments({ userId: customer._id, checkoutRequestId: body.checkoutRequestId }), 1);

  const inventory = await db.collection("inventories").findOne({ variantId });
  assert.equal(inventory.reservedQuantity, before.reservedQuantity + body.items[0].quantity);
  assert.equal((await db.collection("vouchers").findOne({ code: "BELLE10" })).usedCount, before.voucherUses + 1);
});

test("successful markerless legacy checkout replay does not consume resources again", async () => {
  const body = {
    checkoutRequestId: "legacy-markerless-replay",
    items: [{ variantId: variantId.toHexString(), quantity: 1 }],
    voucherCode: "BELLE10",
    paymentMethod: "cod",
    shippingAddress: { receiverName: "Order Customer", receiverPhone: "0900000000", fullAddress: "1 Demo Street", regionCode: "hcm-demo" }
  };
  const before = {
    reservedQuantity: (await db.collection("inventories").findOne({ variantId })).reservedQuantity,
    voucherUses: (await db.collection("vouchers").findOne({ code: "BELLE10" })).usedCount
  };
  const created = await createOrder({ db, user: customer, body });
  for (const collectionName of ["order_histories", "payments", "invoices"]) {
    assert.ok(await db.collection(collectionName).findOne({ orderId: created._id }));
  }
  await db.collection("orders").updateOne({ _id: created._id }, { $unset: { checkoutComplete: "" } });

  const replay = await createOrder({ db, user: customer, body });

  assert.equal(String(replay._id), String(created._id));
  assert.equal(await db.collection("orders").countDocuments({ userId: customer._id, checkoutRequestId: body.checkoutRequestId }), 1);
  assert.equal((await db.collection("inventories").findOne({ variantId })).reservedQuantity, before.reservedQuantity + 1);
  assert.equal((await db.collection("vouchers").findOne({ code: "BELLE10" })).usedCount, before.voucherUses + 1);
});

test("markerless legacy checkout missing any artifact remains in progress", async () => {
  const artifacts = {
    order_histories: { oldStatus: null, newStatus: "pending", note: "Order created" },
    payments: { method: "cod", status: "pending", amount: 0, isMock: true },
    invoices: { invoiceCode: "INV-LEGACY-INCOMPLETE", status: "pending", amount: 0 }
  };
  for (const missingArtifact of Object.keys(artifacts)) {
    const orderId = new ObjectId();
    const checkoutRequestId = `legacy-missing-${missingArtifact}`;
    await db.collection("orders").insertOne({ _id: orderId, userId: customer._id, checkoutRequestId });
    try {
      for (const [collectionName, artifact] of Object.entries(artifacts)) {
        if (collectionName !== missingArtifact) await db.collection(collectionName).insertOne({ ...artifact, orderId });
      }
      await assert.rejects(
        createOrder({ db, user: customer, body: { checkoutRequestId } }),
        (error) => error.status === 409 && error.code === "CHECKOUT_IN_PROGRESS"
      );
    } finally {
      await Promise.all(Object.keys(artifacts).map((collectionName) => db.collection(collectionName).deleteMany({ orderId })));
      await db.collection("orders").deleteOne({ _id: orderId });
    }
  }
});

test("checkout replay does not return a partial order and can retry after compensation", async () => {
  const body = {
    checkoutRequestId: "checkout-incomplete-race",
    items: [{ variantId: variantId.toHexString(), quantity: 1 }],
    voucherCode: "BELLE10",
    paymentMethod: "cod",
    shippingAddress: { receiverName: "Order Customer", receiverPhone: "0900000000", fullAddress: "1 Demo Street", regionCode: "hcm-demo" }
  };
  const before = {
    inventory: await db.collection("inventories").findOne({ variantId }),
    voucher: await db.collection("vouchers").findOne({ code: "BELLE10" })
  };
  let notifyOrderInserted;
  let resumeFirstAttempt;
  const orderInserted = new Promise((resolve) => { notifyOrderInserted = resolve; });
  const firstAttemptGate = new Promise((resolve) => { resumeFirstAttempt = resolve; });
  const failingDb = {
    collection(name) {
      const target = db.collection(name);
      if (name === "orders") {
        return new Proxy(target, {
          get(collection, property) {
            if (property === "insertOne") return async (order) => {
              const result = await collection.insertOne(order);
              notifyOrderInserted();
              await firstAttemptGate;
              return result;
            };
            const value = Reflect.get(collection, property, collection);
            return typeof value === "function" ? value.bind(collection) : value;
          }
        });
      }
      if (name === "payments") {
        return new Proxy(target, {
          get(collection, property) {
            if (property === "insertOne") return async () => { throw new Error("injected payment write failure"); };
            const value = Reflect.get(collection, property, collection);
            return typeof value === "function" ? value.bind(collection) : value;
          }
        });
      }
      return target;
    }
  };

  const firstAttempt = createOrder({ db: failingDb, user: customer, body });
  await orderInserted;
  const pendingOrder = await db.collection("orders").findOne({ userId: customer._id, checkoutRequestId: body.checkoutRequestId });
  assert.equal(pendingOrder.checkoutComplete, false);
  let replayOrder;
  let replayError;
  try { replayOrder = await createOrder({ db, user: customer, body }); }
  catch (error) { replayError = error; }
  resumeFirstAttempt();
  await assert.rejects(firstAttempt, /injected payment write failure/);

  assert.equal(replayOrder, undefined, "a retry must not receive the pending order as success");
  assert.equal(replayError?.status, 409);
  assert.equal(replayError?.code, "CHECKOUT_IN_PROGRESS");
  assert.equal(await db.collection("orders").countDocuments({ userId: customer._id, checkoutRequestId: body.checkoutRequestId }), 0);
  assert.equal((await db.collection("inventories").findOne({ variantId })).reservedQuantity, before.inventory.reservedQuantity);
  assert.equal((await db.collection("vouchers").findOne({ code: "BELLE10" })).usedCount, before.voucher.usedCount);

  await createOrder({ db, user: customer, body });
  const completedOrder = await db.collection("orders").findOne({ userId: customer._id, checkoutRequestId: body.checkoutRequestId });
  assert.equal(completedOrder.checkoutComplete, true);
  assert.equal(await db.collection("order_histories").countDocuments({ orderId: completedOrder._id }), 1);
  assert.equal(await db.collection("payments").countDocuments({ orderId: completedOrder._id }), 1);
  assert.equal(await db.collection("invoices").countDocuments({ orderId: completedOrder._id }), 1);
  assert.equal((await db.collection("inventories").findOne({ variantId })).reservedQuantity, before.inventory.reservedQuantity + 1);
  assert.equal((await db.collection("vouchers").findOne({ code: "BELLE10" })).usedCount, before.voucher.usedCount + 1);
});

test("duplicate-key conflict does not return an incomplete markerless checkout order", async () => {
  const checkoutRequestId = "checkout-markerless-incomplete-duplicate-key";
  const pendingOrder = {
    _id: new ObjectId(), orderCode: "PENDING-DUPLICATE-KEY", userId: customer._id,
    checkoutRequestId
  };
  await db.collection("orders").insertOne(pendingOrder);
  await db.collection("order_histories").insertOne({ orderId: pendingOrder._id, oldStatus: null, newStatus: "pending" });
  await db.collection("payments").insertOne({ orderId: pendingOrder._id, method: "cod", status: "pending", amount: 0 });
  const beforeInventory = await db.collection("inventories").findOne({ variantId });
  let hideInitialLookup = true;
  const conflictDb = {
    collection(name) {
      const target = db.collection(name);
      if (name !== "orders") return target;
      return new Proxy(target, {
        get(collection, property) {
          if (property === "findOne") return async (...args) => {
            if (hideInitialLookup) {
              hideInitialLookup = false;
              return null;
            }
            return collection.findOne(...args);
          };
          const value = Reflect.get(collection, property, collection);
          return typeof value === "function" ? value.bind(collection) : value;
        }
      });
    }
  };

  try {
    await assert.rejects(createOrder({
      db: conflictDb,
      user: customer,
      body: {
        checkoutRequestId,
        items: [{ variantId: variantId.toHexString(), quantity: 1 }],
        paymentMethod: "cod",
        shippingAddress: { receiverName: "Order Customer", receiverPhone: "0900000000", fullAddress: "1 Demo Street", regionCode: "hcm-demo" }
      }
    }), (error) => error.status === 409 && error.code === "CHECKOUT_IN_PROGRESS");
    assert.equal((await db.collection("orders").findOne({ _id: pendingOrder._id })).checkoutComplete, undefined);
    assert.equal(await db.collection("invoices").findOne({ orderId: pendingOrder._id }), null);
    assert.equal((await db.collection("inventories").findOne({ variantId })).reservedQuantity, beforeInventory.reservedQuantity);
  } finally {
    await db.collection("order_histories").deleteMany({ orderId: pendingOrder._id });
    await db.collection("payments").deleteMany({ orderId: pendingOrder._id });
    await db.collection("invoices").deleteMany({ orderId: pendingOrder._id });
    await db.collection("orders").deleteOne({ _id: pendingOrder._id });
  }
});

test("duplicate-key recovery can replay a complete markerless legacy checkout", async () => {
  const checkoutRequestId = "checkout-markerless-complete-duplicate-key";
  const legacyOrder = {
    _id: new ObjectId(), orderCode: "LEGACY-COMPLETE-DUPLICATE-KEY", userId: customer._id,
    checkoutRequestId
  };
  await db.collection("orders").insertOne(legacyOrder);
  await db.collection("order_histories").insertOne({ orderId: legacyOrder._id, oldStatus: null, newStatus: "pending" });
  await db.collection("payments").insertOne({ orderId: legacyOrder._id, method: "cod", status: "pending", amount: 0 });
  await db.collection("invoices").insertOne({ orderId: legacyOrder._id, invoiceCode: "INV-LEGACY-DUPLICATE-KEY", status: "pending", amount: 0 });
  const before = {
    reservedQuantity: (await db.collection("inventories").findOne({ variantId })).reservedQuantity,
    voucherUses: (await db.collection("vouchers").findOne({ code: "BELLE10" })).usedCount
  };
  let hideInitialLookup = true;
  const conflictDb = {
    collection(name) {
      const target = db.collection(name);
      if (name !== "orders") return target;
      return new Proxy(target, {
        get(collection, property) {
          if (property === "findOne") return async (...args) => {
            if (hideInitialLookup) {
              hideInitialLookup = false;
              return null;
            }
            return collection.findOne(...args);
          };
          const value = Reflect.get(collection, property, collection);
          return typeof value === "function" ? value.bind(collection) : value;
        }
      });
    }
  };

  try {
    const replay = await createOrder({
      db: conflictDb,
      user: customer,
      body: {
        checkoutRequestId,
        items: [{ variantId: variantId.toHexString(), quantity: 1 }],
        paymentMethod: "cod",
        shippingAddress: { receiverName: "Order Customer", receiverPhone: "0900000000", fullAddress: "1 Demo Street", regionCode: "hcm-demo" }
      }
    });
    assert.equal(String(replay._id), String(legacyOrder._id));
    assert.equal((await db.collection("inventories").findOne({ variantId })).reservedQuantity, before.reservedQuantity);
    assert.equal((await db.collection("vouchers").findOne({ code: "BELLE10" })).usedCount, before.voucherUses);
  } finally {
    await db.collection("order_histories").deleteMany({ orderId: legacyOrder._id });
    await db.collection("payments").deleteMany({ orderId: legacyOrder._id });
    await db.collection("invoices").deleteMany({ orderId: legacyOrder._id });
    await db.collection("orders").deleteOne({ _id: legacyOrder._id });
  }
});

test("unsupported or missing shipping regions reject checkout before consuming anything", async () => {
  const before = {
    inventory: await db.collection("inventories").findOne({ variantId }),
    voucher: await db.collection("vouchers").findOne({ code: "BELLE10" }),
    orders: await db.collection("orders").countDocuments({ userId: customer._id })
  };
  const unsupported = await customerAgent.post("/api/orders").send({
    checkoutRequestId: "checkout-unsupported-region",
    items: [{ variantId: variantId.toHexString(), quantity: 1 }], voucherCode: "BELLE10", paymentMethod: "cod",
    shippingAddress: { receiverName: "Order Customer", receiverPhone: "0900000000", fullAddress: "1 Demo Street", regionCode: "unknown-demo" }
  });
  assert.equal(unsupported.status, 409);
  assert.equal(unsupported.body.error.code, "SHIPPING_UNAVAILABLE");

  const missing = await customerAgent.post("/api/orders").send({
    checkoutRequestId: "checkout-missing-region",
    items: [{ variantId: variantId.toHexString(), quantity: 1 }], paymentMethod: "cod",
    shippingAddress: { receiverName: "Order Customer", receiverPhone: "0900000000", fullAddress: "1 Demo Street" }
  });
  assert.equal(missing.status, 400);

  assert.equal((await db.collection("inventories").findOne({ variantId })).reservedQuantity, before.inventory.reservedQuantity);
  assert.equal((await db.collection("inventories").findOne({ variantId })).stockQuantity, before.inventory.stockQuantity);
  assert.equal((await db.collection("vouchers").findOne({ code: "BELLE10" })).usedCount, before.voucher.usedCount);
  assert.equal(await db.collection("orders").countDocuments({ userId: customer._id }), before.orders);
});

test("failed payment write compensates stock, voucher usage, and incomplete order artifacts", async () => {
  const before = {
    inventory: await db.collection("inventories").findOne({ variantId }),
    voucher: await db.collection("vouchers").findOne({ code: "BELLE10" }),
    orderCount: await db.collection("orders").countDocuments({ userId: customer._id }),
    historyCount: await db.collection("order_histories").countDocuments({}),
    paymentCount: await db.collection("payments").countDocuments({}),
    invoiceCount: await db.collection("invoices").countDocuments({})
  };
  const failingDb = {
    collection(name) {
      const collection = db.collection(name);
      if (name !== "payments") return collection;
      return new Proxy(collection, {
        get(target, property) {
          if (property === "insertOne") return async () => { throw new Error("injected payment write failure"); };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
  };

  await assert.rejects(createOrder({
    db: failingDb,
    user: customer,
    body: {
      checkoutRequestId: "checkout-attempt-failure",
      items: [{ variantId: variantId.toHexString(), quantity: 1 }], voucherCode: "BELLE10", paymentMethod: "cod",
      shippingAddress: { receiverName: "Order Customer", receiverPhone: "0900000000", fullAddress: "1 Demo Street", regionCode: "hcm-demo" }
    }
  }), /injected payment write failure/);

  assert.equal((await db.collection("inventories").findOne({ variantId })).reservedQuantity, before.inventory.reservedQuantity);
  assert.equal((await db.collection("inventories").findOne({ variantId })).stockQuantity, before.inventory.stockQuantity);
  assert.equal((await db.collection("vouchers").findOne({ code: "BELLE10" })).usedCount, before.voucher.usedCount);
  assert.equal(await db.collection("orders").countDocuments({ userId: customer._id }), before.orderCount);
  assert.equal(await db.collection("order_histories").countDocuments({}), before.historyCount);
  assert.equal(await db.collection("payments").countDocuments({}), before.paymentCount);
  assert.equal(await db.collection("invoices").countDocuments({}), before.invoiceCount);
});

test("checkout request identifiers are bounded", async () => {
  const response = await customerAgent.post("/api/orders").send({
    checkoutRequestId: "x".repeat(129),
    items: [{ variantId: variantId.toHexString(), quantity: 1 }], paymentMethod: "cod",
    shippingAddress: { receiverName: "Order Customer", receiverPhone: "0900000000", fullAddress: "1 Demo Street", regionCode: "hcm-demo" }
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
});

test("order creation rejects insufficient stock", async () => {
  const response = await customerAgent.post("/api/orders").send({
    items: [{ variantId: variantId.toHexString(), quantity: 20 }],
    paymentMethod: "cod",
    shippingAddress: { receiverName: "Order Customer", receiverPhone: "0900000000", fullAddress: "1 Demo Street", regionCode: "hcm-demo" }
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

test("index setup preflights duplicate checkout keys and creates a partial per-user unique index", async () => {
  const indexDb = client.db(indexDbName);
  const userId = new ObjectId();
  await indexDb.collection("orders").insertMany([
    { _id: new ObjectId(), orderCode: "INDEX-1", userId, checkoutRequestId: "same-attempt" },
    { _id: new ObjectId(), orderCode: "INDEX-2", userId, checkoutRequestId: "same-attempt" }
  ]);

  await assert.rejects(createIndexes(indexDb), /duplicate checkout request IDs/i);
  assert.equal(await indexDb.collection("orders").countDocuments({ userId, checkoutRequestId: "same-attempt" }), 2);
  assert.equal((await indexDb.collection("orders").listIndexes().toArray()).some((index) => index.name === "userId_1_checkoutRequestId_1"), false);

  await indexDb.dropDatabase();
  await createIndexes(indexDb);
  const checkoutIndex = (await indexDb.collection("orders").listIndexes().toArray()).find((index) => index.name === "userId_1_checkoutRequestId_1");
  assert.deepEqual(checkoutIndex.partialFilterExpression, { checkoutRequestId: { $type: "string" } });

  await indexDb.collection("orders").insertMany([
    { _id: new ObjectId(), orderCode: "LEGACY-1", userId },
    { _id: new ObjectId(), orderCode: "LEGACY-2", userId },
    { _id: new ObjectId(), orderCode: "USER-1", userId, checkoutRequestId: "same-attempt" },
    { _id: new ObjectId(), orderCode: "USER-2", userId: new ObjectId(), checkoutRequestId: "same-attempt" }
  ]);
  await assert.rejects(indexDb.collection("orders").insertOne({ _id: new ObjectId(), orderCode: "DUPLICATE", userId, checkoutRequestId: "same-attempt" }), { code: 11000 });
});
