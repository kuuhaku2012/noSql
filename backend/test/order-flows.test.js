import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createOrder, transitionOrder } from "../src/services/order-service.js";
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
let lifecycleOrderSequence = 0;

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
  app = createApp({ db, config: { jwtSecret: "test-secret", frontendRoot: new URL("../../frontend/", import.meta.url) } });
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

async function createLifecycleOrder({ paymentMethod = "cod", quantity = 1 } = {}) {
  const response = await customerAgent.post("/api/orders").send({
    checkoutRequestId: `lifecycle-${++lifecycleOrderSequence}`,
    items: [{ variantId: variantId.toHexString(), quantity }],
    paymentMethod,
    shippingAddress: { receiverName: "Order Customer", receiverPhone: "0900000000", fullAddress: "1 Demo Street", regionCode: "hcm-demo" }
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return new ObjectId(response.body.data.id);
}

async function advanceOrder(orderId, statuses) {
  for (const status of statuses) {
    const response = await salesAgent.patch(`/api/orders/${orderId}/status`).send({ status });
    assert.equal(response.status, 200, `${status}: ${JSON.stringify(response.body)}`);
  }
}

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

test("checkout uses server prices and ignores forged client totals", async () => {
  const checkoutRequestId = `server-prices-${new ObjectId().toHexString()}`;
  const inventoryBefore = await db.collection("inventories").findOne({ variantId });
  try {
    const response = await customerAgent.post("/api/orders").send({
      checkoutRequestId,
      items: [{ variantId: variantId.toHexString(), quantity: 2, unitPrice: 1 }],
      paymentMethod: "cod",
      subtotal: 1,
      discountAmount: 999999,
      deliveryFee: 1,
      finalAmount: 1,
      shippingAddress: { receiverName: "Order Customer", receiverPhone: "0900000000", fullAddress: "1 Demo Street", regionCode: "hcm-demo" }
    });

    assert.equal(response.status, 201, JSON.stringify(response.body));
    const storedOrder = await db.collection("orders").findOne({ userId: customer._id, checkoutRequestId });
    assert.ok(storedOrder, "checkout order should be persisted");
    assert.equal(storedOrder.items[0].unitPrice, 100000);
    assert.equal(storedOrder.deliveryFee, 25000);
    assert.equal(storedOrder.subtotal, 200000);
    assert.equal(storedOrder.discountAmount, 0);
    assert.equal(storedOrder.finalAmount, 225000);
  } finally {
    try {
      const orderToCancel = await db.collection("orders").findOne({ userId: customer._id, checkoutRequestId });
      if (orderToCancel?.orderStatus === "pending") {
        const cancellation = await customerAgent.patch(`/api/orders/${orderToCancel._id}/status`).send({ status: "cancelled" });
        assert.equal(cancellation.status, 200, JSON.stringify(cancellation.body));
        assert.equal(cancellation.body.data.orderStatus, "cancelled");
      }
    } finally {
      try {
        const testOrder = await db.collection("orders").findOne({ userId: customer._id, checkoutRequestId });
        if (testOrder) {
          const cleanupResults = await Promise.allSettled([
            db.collection("order_histories").deleteMany({ orderId: testOrder._id }),
            db.collection("payments").deleteMany({ orderId: testOrder._id }),
            db.collection("invoices").deleteMany({ orderId: testOrder._id }),
            db.collection("orders").deleteOne({ _id: testOrder._id, userId: customer._id, checkoutRequestId })
          ]);
          const cleanupErrors = cleanupResults.filter((result) => result.status === "rejected");
          assert.equal(cleanupErrors.length, 0, JSON.stringify(cleanupErrors));
        }
      } finally {
        await db.collection("inventories").updateOne(
          { storeId: inventoryBefore.storeId, variantId },
          { $set: { reservedQuantity: inventoryBefore.reservedQuantity } }
        );
      }
      const inventoryAfter = await db.collection("inventories").findOne({ storeId: inventoryBefore.storeId, variantId });
      assert.equal(inventoryAfter.reservedQuantity, inventoryBefore.reservedQuantity);
      assert.equal(await db.collection("orders").countDocuments({ userId: customer._id, checkoutRequestId }), 0);
    }
  }
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

test("inactive shipping rates reject checkout before consuming anything", async () => {
  const checkoutRequestId = `checkout-inactive-region-${new ObjectId().toHexString()}`;
  const inactiveRateId = new ObjectId();
  const inventoryBefore = await db.collection("inventories").findOne({ variantId });
  const voucherBefore = await db.collection("vouchers").findOne({ code: "BELLE10" });
  await db.collection("shipping_rates").insertOne({
    _id: inactiveRateId, code: `inactive-${inactiveRateId.toHexString()}`, regionName: "Inactive demo region",
    fee: 25000, currency: "VND", isDemo: true, isActive: false
  });

  try {
    const customerOrderCountBefore = await db.collection("orders").countDocuments({ userId: customer._id });
    const response = await customerAgent.post("/api/orders").send({
      checkoutRequestId,
      items: [{ variantId: variantId.toHexString(), quantity: 1 }],
      voucherCode: "BELLE10",
      paymentMethod: "cod",
      shippingAddress: {
        receiverName: "Order Customer", receiverPhone: "0900000000", fullAddress: "1 Demo Street",
        regionCode: `inactive-${inactiveRateId.toHexString()}`
      }
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, "SHIPPING_UNAVAILABLE");
    const inventoryAfter = await db.collection("inventories").findOne({ variantId });
    assert.equal(inventoryAfter.stockQuantity, inventoryBefore.stockQuantity);
    assert.equal(inventoryAfter.reservedQuantity, inventoryBefore.reservedQuantity);
    assert.equal((await db.collection("vouchers").findOne({ code: "BELLE10" })).usedCount, voucherBefore.usedCount);
    assert.equal(await db.collection("orders").countDocuments({ userId: customer._id, checkoutRequestId }), 0);
    assert.equal(await db.collection("orders").countDocuments({ userId: customer._id }), customerOrderCountBefore);
  } finally {
    const unexpectedOrder = await db.collection("orders").findOne({ userId: customer._id, checkoutRequestId });
    if (unexpectedOrder) {
      await Promise.allSettled([
        db.collection("order_histories").deleteMany({ orderId: unexpectedOrder._id }),
        db.collection("payments").deleteMany({ orderId: unexpectedOrder._id }),
        db.collection("invoices").deleteMany({ orderId: unexpectedOrder._id }),
        db.collection("orders").deleteOne({ _id: unexpectedOrder._id, userId: customer._id, checkoutRequestId })
      ]);
    }
    await Promise.allSettled([
      db.collection("inventories").updateOne(
        { _id: inventoryBefore._id },
        { $set: { stockQuantity: inventoryBefore.stockQuantity, reservedQuantity: inventoryBefore.reservedQuantity } }
      ),
      db.collection("vouchers").updateOne({ _id: voucherBefore._id }, { $set: { usedCount: voucherBefore.usedCount } }),
      db.collection("shipping_rates").deleteOne({ _id: inactiveRateId })
    ]);
  }
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

test("COD stays pending through delivery, rejects mock payment, and settles only on completion", async () => {
  const inventoryBefore = await db.collection("inventories").findOne({ variantId });
  const id = await createLifecycleOrder();
  const order = await db.collection("orders").findOne({ _id: id });
  assert.equal(order.orderStatus, "pending");
  assert.equal(order.paymentStatus, "pending");

  const rejectedPayment = await customerAgent.post(`/api/orders/${id}/payment`).send({ outcome: "success" });
  assert.equal(rejectedPayment.status, 409);
  assert.equal(rejectedPayment.body.error.code, "PAYMENT_NOT_SUPPORTED");
  assert.equal((await db.collection("payments").findOne({ orderId: id })).status, "pending");

  await advanceOrder(id, ["confirmed", "processing", "shipped", "delivered"]);
  assert.equal((await db.collection("orders").findOne({ _id: id })).paymentStatus, "pending");
  await advanceOrder(id, ["completed"]);

  const settled = await db.collection("orders").findOne({ _id: id });
  assert.equal(settled.orderStatus, "completed");
  assert.equal(settled.paymentStatus, "paid");
  assert.equal((await db.collection("payments").findOne({ orderId: id })).status, "paid");
  assert.equal((await db.collection("invoices").findOne({ orderId: id })).status, "issued");
  assert.deepEqual((await db.collection("inventories").findOne({ variantId })).stockCommitClaims, []);
  assert.deepEqual((await db.collection("memberships").findOne({ userId: customer._id })).completionClaims, []);
  assert.equal((await db.collection("payments").findOne({ orderId: id })).completionClaim, undefined);
  assert.equal((await db.collection("invoices").findOne({ orderId: id })).completionClaim, undefined);
  assert.equal(await db.collection("order_histories").countDocuments({ orderId: id }), 6);
  for (const status of ["pending", "confirmed", "processing", "shipped", "delivered", "completed"]) {
    assert.equal(await db.collection("order_histories").countDocuments({ orderId: id, newStatus: status }), 1);
  }

  const repeatedCompletion = await salesAgent.patch(`/api/orders/${id}/status`).send({ status: "completed" });
  assert.equal(repeatedCompletion.status, 409);
  assert.equal((await db.collection("inventories").findOne({ variantId })).stockQuantity, inventoryBefore.stockQuantity - 1);
  assert.equal((await db.collection("inventories").findOne({ variantId })).reservedQuantity, inventoryBefore.reservedQuantity);
  assert.equal(await db.collection("order_histories").countDocuments({ orderId: id }), 6);
});

test("concurrent completion commits only this order's stock reservation once", async () => {
  const inventoryBefore = await db.collection("inventories").findOne({ variantId });
  const id = await createLifecycleOrder();
  await createLifecycleOrder(); // A second reservation leaves enough reserved stock to expose a duplicate commit.
  await advanceOrder(id, ["confirmed", "processing", "shipped", "delivered"]);
  const order = await db.collection("orders").findOne({ _id: id });

  let releaseOrderClaims;
  const bothOrderClaimsReady = new Promise((resolve) => { releaseOrderClaims = resolve; });
  let orderClaimCount = 0;
  const racingDb = {
    collection(name) {
      const target = db.collection(name);
      if (name !== "orders") return target;
      return new Proxy(target, {
        get(collection, property) {
          if (property === "findOneAndUpdate") return async (filter, ...args) => {
            if (String(filter._id) === String(id) && filter.orderStatus === "delivered") {
              orderClaimCount += 1;
              if (orderClaimCount === 2) releaseOrderClaims();
              await bothOrderClaimsReady;
            }
            return collection.findOneAndUpdate(filter, ...args);
          };
          const value = Reflect.get(collection, property, collection);
          return typeof value === "function" ? value.bind(collection) : value;
        }
      });
    }
  };

  const attempts = await Promise.allSettled([
    transitionOrder({ db: racingDb, order, user: sales, status: "completed" }),
    transitionOrder({ db: racingDb, order, user: sales, status: "completed" })
  ]);

  assert.equal(
    attempts.filter((attempt) => attempt.status === "fulfilled").length,
    1,
    attempts.map((attempt) => attempt.status === "rejected" ? `${attempt.reason.code || attempt.reason.name}: ${attempt.reason.message}` : attempt.status).join("; ")
  );
  const rejected = attempts.find((attempt) => attempt.status === "rejected");
  assert.equal(rejected.reason.status, 409);
  const inventoryAfter = await db.collection("inventories").findOne({ variantId });
  assert.equal(inventoryAfter.stockQuantity, inventoryBefore.stockQuantity - 1);
  assert.equal(inventoryAfter.reservedQuantity, inventoryBefore.reservedQuantity + 1);
  assert.equal(await db.collection("order_histories").countDocuments({ orderId: id, newStatus: "completed" }), 1);
});

test("failed multi-item completion restores earlier stock writes and can be retried", async () => {
  const secondProductId = new ObjectId();
  const secondVariantId = new ObjectId();
  const store = await db.collection("stores").findOne({ name: "Order Store" });
  await db.collection("products").insertOne({ _id: secondProductId, slug: `lifecycle-extra-${++lifecycleOrderSequence}`, name: "Lifecycle Extra", isActive: true });
  await db.collection("product_variants").insertOne({ _id: secondVariantId, productId: secondProductId, sku: "LIFECYCLE-EXTRA", retailPrice: 20000, isActive: true });
  await db.collection("inventories").insertOne({ _id: new ObjectId(), storeId: store._id, variantId: secondVariantId, stockQuantity: 5, reservedQuantity: 0, version: 1 });
  const created = await customerAgent.post("/api/orders").send({
    checkoutRequestId: `lifecycle-partial-${lifecycleOrderSequence}`,
    items: [
      { variantId: variantId.toHexString(), quantity: 1 },
      { variantId: secondVariantId.toHexString(), quantity: 1 }
    ],
    paymentMethod: "cod",
    shippingAddress: { receiverName: "Order Customer", receiverPhone: "0900000000", fullAddress: "1 Demo Street", regionCode: "hcm-demo" }
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = new ObjectId(created.body.data.id);
  await advanceOrder(id, ["confirmed", "processing", "shipped", "delivered"]);
  const firstBefore = await db.collection("inventories").findOne({ variantId });
  const secondBefore = await db.collection("inventories").findOne({ variantId: secondVariantId });
  await db.collection("inventories").updateOne({ _id: secondBefore._id }, { $set: { reservedQuantity: 0 } });

  const failed = await salesAgent.patch(`/api/orders/${id}/status`).send({ status: "completed" });
  assert.equal(failed.status, 409);
  assert.equal(failed.body.error.code, "STOCK_COMMIT_FAILED");
  assert.equal((await db.collection("orders").findOne({ _id: id })).orderStatus, "delivered");
  const firstAfterFailure = await db.collection("inventories").findOne({ _id: firstBefore._id });
  assert.equal(firstAfterFailure.stockQuantity, firstBefore.stockQuantity);
  assert.equal(firstAfterFailure.reservedQuantity, firstBefore.reservedQuantity);
  const secondAfterFailure = await db.collection("inventories").findOne({ _id: secondBefore._id });
  assert.equal(secondAfterFailure.stockQuantity, secondBefore.stockQuantity);
  assert.equal(secondAfterFailure.reservedQuantity, 0);
  assert.equal(await db.collection("order_histories").countDocuments({ orderId: id, newStatus: "completed" }), 0);

  await db.collection("inventories").updateOne({ _id: secondBefore._id }, { $set: { reservedQuantity: 1 } });
  const retried = await salesAgent.patch(`/api/orders/${id}/status`).send({ status: "completed" });
  assert.equal(retried.status, 200);
  assert.equal((await db.collection("inventories").findOne({ _id: firstBefore._id })).stockQuantity, firstBefore.stockQuantity - 1);
  assert.equal((await db.collection("inventories").findOne({ _id: secondBefore._id })).stockQuantity, secondBefore.stockQuantity - 1);
  assert.equal(await db.collection("order_histories").countDocuments({ orderId: id, newStatus: "completed" }), 1);
});

test("failed payment update during completion restores stock and leaves the order retryable", async () => {
  const inventoryBaseline = await db.collection("inventories").findOne({ variantId });
  const id = await createLifecycleOrder();
  await advanceOrder(id, ["confirmed", "processing", "shipped", "delivered"]);
  const order = await db.collection("orders").findOne({ _id: id });
  const inventoryBefore = await db.collection("inventories").findOne({ variantId });

  const failingDb = {
    collection(name) {
      const collection = db.collection(name);
      if (name !== "payments") return collection;
      return new Proxy(collection, {
        get(target, property) {
          if (property === "updateOne") return async () => { throw new Error("injected payment update failure"); };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
  };

  await assert.rejects(
    transitionOrder({ db: failingDb, order, user: sales, status: "completed" }),
    /injected payment update failure/
  );

  const savedOrder = await db.collection("orders").findOne({ _id: id });
  const inventoryAfter = await db.collection("inventories").findOne({ variantId });
  assert.equal(savedOrder.orderStatus, "delivered");
  assert.equal(savedOrder.paymentStatus, "pending");
  assert.equal(savedOrder.stockCommitted, false);
  assert.equal(savedOrder.stockCommitClaim, undefined);
  assert.equal(inventoryAfter.stockQuantity, inventoryBefore.stockQuantity);
  assert.equal(inventoryAfter.reservedQuantity, inventoryBefore.reservedQuantity);
  assert.equal((await db.collection("payments").findOne({ orderId: id })).status, "pending");
  assert.equal((await db.collection("invoices").findOne({ orderId: id })).status, "pending");
  assert.equal(await db.collection("order_histories").countDocuments({ orderId: id, newStatus: "completed" }), 0);

  const retried = await transitionOrder({ db, order: savedOrder, user: sales, status: "completed" });
  assert.equal(retried.orderStatus, "completed");
  const inventoryAfterRetry = await db.collection("inventories").findOne({ variantId });
  assert.equal(inventoryAfterRetry.stockQuantity, inventoryBefore.stockQuantity - 1);
  assert.equal(inventoryAfterRetry.reservedQuantity, inventoryBefore.reservedQuantity - 1);
  await db.collection("inventories").updateOne(
    { variantId },
    { $set: { stockQuantity: inventoryBaseline.stockQuantity, reservedQuantity: inventoryBaseline.reservedQuantity } }
  );
});

test("failed invoice update during completion restores the preceding payment update", async () => {
  const inventoryBaseline = await db.collection("inventories").findOne({ variantId });
  const id = await createLifecycleOrder();
  await advanceOrder(id, ["confirmed", "processing", "shipped", "delivered"]);
  const order = await db.collection("orders").findOne({ _id: id });

  const failingDb = {
    collection(name) {
      const collection = db.collection(name);
      if (name !== "invoices") return collection;
      return new Proxy(collection, {
        get(target, property) {
          if (property === "updateOne") return async () => { throw new Error("injected invoice update failure"); };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
  };

  await assert.rejects(
    transitionOrder({ db: failingDb, order, user: sales, status: "completed" }),
    /injected invoice update failure/
  );

  const savedOrder = await db.collection("orders").findOne({ _id: id });
  const payment = await db.collection("payments").findOne({ orderId: id });
  const invoice = await db.collection("invoices").findOne({ orderId: id });
  assert.equal(savedOrder.orderStatus, "delivered");
  assert.equal(savedOrder.paymentStatus, "pending");
  assert.equal(savedOrder.stockCommitted, false);
  assert.equal(savedOrder.stockCommitClaim, undefined);
  assert.equal(payment.status, "pending");
  assert.equal(payment.paidAt, undefined);
  assert.equal(invoice.status, "pending");
  assert.equal(invoice.issuedAt, undefined);
  assert.equal(await db.collection("order_histories").countDocuments({ orderId: id, newStatus: "completed" }), 0);
  await db.collection("inventories").updateOne(
    { variantId },
    { $set: { stockQuantity: inventoryBaseline.stockQuantity, reservedQuantity: inventoryBaseline.reservedQuantity } }
  );
});

test("completion rollback preserves mock payment settled after the caller loaded its stale order", async () => {
  const inventoryBaseline = await db.collection("inventories").findOne({ variantId });
  const id = await createLifecycleOrder({ paymentMethod: "mock" });
  await advanceOrder(id, ["confirmed", "processing", "shipped", "delivered"]);
  const staleOrder = await db.collection("orders").findOne({ _id: id });
  assert.equal(staleOrder.paymentStatus, "pending");

  const paid = await customerAgent.post(`/api/orders/${id}/payment`).send({ outcome: "success" });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.data.payment.status, "paid");
  const inventoryBeforeCompletion = await db.collection("inventories").findOne({ variantId });
  const failingDb = {
    collection(name) {
      const collection = db.collection(name);
      if (name !== "invoices") return collection;
      return new Proxy(collection, {
        get(target, property) {
          if (property === "updateOne") return async (filter, update, ...args) => {
            if (update?.$set?.completionClaim) throw new Error("injected completion invoice failure after mock payment");
            return target.updateOne(filter, update, ...args);
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
  };

  await assert.rejects(
    transitionOrder({ db: failingDb, order: staleOrder, user: sales, status: "completed" }),
    /injected completion invoice failure after mock payment/
  );
  const savedOrder = await db.collection("orders").findOne({ _id: id });
  assert.equal(savedOrder.orderStatus, "delivered");
  assert.equal(savedOrder.paymentStatus, "paid");
  assert.equal(savedOrder.stockCommitted, false);
  assert.equal(savedOrder.stockCommitClaim, undefined);
  assert.equal((await db.collection("payments").findOne({ orderId: id })).status, "paid");
  assert.equal((await db.collection("invoices").findOne({ orderId: id })).status, "issued");
  const inventoryAfter = await db.collection("inventories").findOne({ variantId });
  assert.equal(inventoryAfter.stockQuantity, inventoryBeforeCompletion.stockQuantity);
  assert.equal(inventoryAfter.reservedQuantity, inventoryBeforeCompletion.reservedQuantity);
  await db.collection("inventories").updateOne(
    { variantId },
    { $set: { stockQuantity: inventoryBaseline.stockQuantity, reservedQuantity: inventoryBaseline.reservedQuantity } }
  );
});

test("completion compensates an inventory write that applied before its acknowledgement was lost", async () => {
  const inventoryBaseline = await db.collection("inventories").findOne({ variantId });
  const id = await createLifecycleOrder();
  await advanceOrder(id, ["confirmed", "processing", "shipped", "delivered"]);
  const inventoryBeforeCompletion = await db.collection("inventories").findOne({ variantId });
  let injected = false;
  const ambiguousDb = {
    collection(name) {
      const collection = db.collection(name);
      if (name !== "inventories") return collection;
      return new Proxy(collection, {
        get(target, property) {
          if (property === "updateOne") return async (...args) => {
            const result = await target.updateOne(...args);
            if (!injected && args[1]?.$addToSet?.stockCommitClaims) {
              injected = true;
              throw new Error("injected lost inventory acknowledgement");
            }
            return result;
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
  };

  await assert.rejects(
    transitionOrder({ db: ambiguousDb, order: await db.collection("orders").findOne({ _id: id }), user: sales, status: "completed" }),
    /injected lost inventory acknowledgement/
  );
  const savedOrder = await db.collection("orders").findOne({ _id: id });
  const inventoryAfter = await db.collection("inventories").findOne({ variantId });
  assert.equal(savedOrder.orderStatus, "delivered");
  assert.equal(savedOrder.stockCommitClaim, undefined);
  assert.equal(inventoryAfter.stockQuantity, inventoryBeforeCompletion.stockQuantity);
  assert.equal(inventoryAfter.reservedQuantity, inventoryBeforeCompletion.reservedQuantity);
  assert.equal(await db.collection("order_histories").countDocuments({ orderId: id, newStatus: "completed" }), 0);
  await db.collection("inventories").updateOne(
    { variantId },
    { $set: { stockQuantity: inventoryBaseline.stockQuantity, reservedQuantity: inventoryBaseline.reservedQuantity } }
  );
});

test("completion compensates points when membership write applied before acknowledgement loss", async () => {
  const inventoryBaseline = await db.collection("inventories").findOne({ variantId });
  await db.collection("memberships").updateOne(
    { userId: customer._id },
    { $set: { pointsBalance: 41, lifetimePoints: 120, tier: "silver" } },
    { upsert: true }
  );
  const membershipBefore = await db.collection("memberships").findOne({ userId: customer._id });
  const id = await createLifecycleOrder();
  await advanceOrder(id, ["confirmed", "processing", "shipped", "delivered"]);
  const inventoryBeforeCompletion = await db.collection("inventories").findOne({ variantId });
  let injected = false;
  const ambiguousDb = {
    collection(name) {
      const collection = db.collection(name);
      if (name !== "memberships") return collection;
      return new Proxy(collection, {
        get(target, property) {
          if (property === "updateOne") return async (...args) => {
            const result = await target.updateOne(...args);
            if (!injected && args[1]?.$addToSet?.completionClaims) {
              injected = true;
              throw new Error("injected lost membership acknowledgement");
            }
            return result;
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
  };

  await assert.rejects(
    transitionOrder({ db: ambiguousDb, order: await db.collection("orders").findOne({ _id: id }), user: sales, status: "completed" }),
    /injected lost membership acknowledgement/
  );
  const membershipAfter = await db.collection("memberships").findOne({ userId: customer._id });
  const savedOrder = await db.collection("orders").findOne({ _id: id });
  const inventoryAfter = await db.collection("inventories").findOne({ variantId });
  assert.equal(membershipAfter.pointsBalance, membershipBefore.pointsBalance);
  assert.equal(membershipAfter.lifetimePoints, membershipBefore.lifetimePoints);
  assert.equal(await db.collection("point_histories").countDocuments({ orderId: id, type: "earned" }), 0);
  assert.equal(savedOrder.orderStatus, "delivered");
  assert.equal(savedOrder.stockCommitClaim, undefined);
  assert.equal(inventoryAfter.stockQuantity, inventoryBeforeCompletion.stockQuantity);
  assert.equal(inventoryAfter.reservedQuantity, inventoryBeforeCompletion.reservedQuantity);
  await db.collection("inventories").updateOne(
    { variantId },
    { $set: { stockQuantity: inventoryBaseline.stockQuantity, reservedQuantity: inventoryBaseline.reservedQuantity } }
  );
});

test("completion rejects orders missing payment or invoice before committing stock", async () => {
  const inventoryBaseline = await db.collection("inventories").findOne({ variantId });
  for (const missing of ["payments", "invoices"]) {
    const id = await createLifecycleOrder();
    await advanceOrder(id, ["confirmed", "processing", "shipped", "delivered"]);
    const inventoryBefore = await db.collection("inventories").findOne({ variantId });
    await db.collection(missing).deleteOne({ orderId: id });

    const response = await salesAgent.patch(`/api/orders/${id}/status`).send({ status: "completed" });
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.error.code, "ORDER_ARTIFACTS_MISSING");
    const savedOrder = await db.collection("orders").findOne({ _id: id });
    const inventoryAfter = await db.collection("inventories").findOne({ variantId });
    assert.equal(savedOrder.orderStatus, "delivered");
    assert.equal(savedOrder.stockCommitClaim, undefined);
    assert.equal(inventoryAfter.stockQuantity, inventoryBefore.stockQuantity);
    assert.equal(inventoryAfter.reservedQuantity, inventoryBefore.reservedQuantity);
    await db.collection("payments").deleteMany({ orderId: id });
    await db.collection("invoices").deleteMany({ orderId: id });
    await db.collection("inventories").updateOne(
      { variantId },
      { $set: { stockQuantity: inventoryBaseline.stockQuantity, reservedQuantity: inventoryBaseline.reservedQuantity } }
    );
  }
});

test("completion fails closed on missing payment artifacts for a stock-committed legacy order", async () => {
  const inventoryBaseline = await db.collection("inventories").findOne({ variantId });
  for (const missing of ["payments", "invoices"]) {
    const id = await createLifecycleOrder();
    await advanceOrder(id, ["confirmed", "processing", "shipped", "delivered"]);
    const inventoryBefore = await db.collection("inventories").findOne({ variantId });
    await db.collection("orders").updateOne({ _id: id }, { $set: { stockCommitted: true } });
    await db.collection(missing).deleteOne({ orderId: id });

    const response = await salesAgent.patch(`/api/orders/${id}/status`).send({ status: "completed" });
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.error.code, "ORDER_ARTIFACTS_MISSING");
    const savedOrder = await db.collection("orders").findOne({ _id: id });
    const inventoryAfter = await db.collection("inventories").findOne({ variantId });
    assert.equal(savedOrder.orderStatus, "delivered");
    assert.equal(savedOrder.paymentStatus, "pending");
    assert.equal(inventoryAfter.stockQuantity, inventoryBefore.stockQuantity);
    assert.equal(inventoryAfter.reservedQuantity, inventoryBefore.reservedQuantity);
    await db.collection("payments").deleteMany({ orderId: id });
    await db.collection("invoices").deleteMany({ orderId: id });
    await db.collection("inventories").updateOne(
      { variantId },
      { $set: { stockQuantity: inventoryBaseline.stockQuantity, reservedQuantity: inventoryBaseline.reservedQuantity } }
    );
  }
});

test("stock-committed legacy completion rejects pending payment and invoice records", async () => {
  const inventoryBaseline = await db.collection("inventories").findOne({ variantId });
  const id = await createLifecycleOrder({ paymentMethod: "mock" });
  await advanceOrder(id, ["confirmed", "processing", "shipped", "delivered"]);
  const inventoryBefore = await db.collection("inventories").findOne({ variantId });
  await db.collection("orders").updateOne({ _id: id }, { $set: { stockCommitted: true } });

  const response = await salesAgent.patch(`/api/orders/${id}/status`).send({ status: "completed" });
  assert.equal(response.status, 409, JSON.stringify(response.body));
  assert.equal(response.body.error.code, "ORDER_ARTIFACTS_INCOMPLETE");
  const savedOrder = await db.collection("orders").findOne({ _id: id });
  assert.equal(savedOrder.orderStatus, "delivered");
  assert.equal(savedOrder.paymentStatus, "pending");
  assert.equal((await db.collection("payments").findOne({ orderId: id })).status, "pending");
  assert.equal((await db.collection("invoices").findOne({ orderId: id })).status, "pending");
  const inventoryAfter = await db.collection("inventories").findOne({ variantId });
  assert.equal(inventoryAfter.stockQuantity, inventoryBefore.stockQuantity);
  assert.equal(inventoryAfter.reservedQuantity, inventoryBefore.reservedQuantity);
  await db.collection("orders").updateOne({ _id: id }, { $set: { stockCommitted: false } });
  await db.collection("inventories").updateOne(
    { variantId },
    { $set: { stockQuantity: inventoryBaseline.stockQuantity, reservedQuantity: inventoryBaseline.reservedQuantity } }
  );
});

test("mock payment cannot change a completed order whose payment is not settled", async () => {
  const inventoryBaseline = await db.collection("inventories").findOne({ variantId });
  const id = await createLifecycleOrder({ paymentMethod: "mock" });
  await db.collection("orders").updateOne({ _id: id }, { $set: { orderStatus: "completed", stockCommitted: true } });

  const response = await customerAgent.post(`/api/orders/${id}/payment`).send({ outcome: "success" });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "ORDER_NOT_PAYABLE");
  const order = await db.collection("orders").findOne({ _id: id });
  assert.equal(order.orderStatus, "completed");
  assert.equal(order.paymentStatus, "pending");
  assert.equal(order.paymentOperationClaim, undefined);
  assert.equal((await db.collection("payments").findOne({ orderId: id })).status, "pending");
  assert.equal((await db.collection("invoices").findOne({ orderId: id })).status, "pending");
  await db.collection("orders").updateOne({ _id: id }, { $set: { orderStatus: "pending", stockCommitted: false } });
  await db.collection("inventories").updateOne(
    { variantId },
    { $set: { stockQuantity: inventoryBaseline.stockQuantity, reservedQuantity: inventoryBaseline.reservedQuantity } }
  );
});

test("mock payment replay remains idempotent after a consistent order completion", async () => {
  const inventoryBaseline = await db.collection("inventories").findOne({ variantId });
  const id = await createLifecycleOrder({ paymentMethod: "mock" });
  await advanceOrder(id, ["confirmed", "processing", "shipped", "delivered", "completed"]);
  const attemptsBefore = (await db.collection("payments").findOne({ orderId: id })).attemptCount;

  const replay = await customerAgent.post(`/api/orders/${id}/payment`).send({ outcome: "success" });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.data.orderStatus, "completed");
  assert.equal(replay.body.data.payment.status, "paid");
  assert.equal(replay.body.data.invoice.status, "issued");
  const failure = await customerAgent.post(`/api/orders/${id}/payment`).send({ outcome: "failure" });
  assert.equal(failure.status, 409);
  assert.equal(failure.body.error.code, "PAYMENT_ALREADY_PAID");
  assert.equal((await db.collection("payments").findOne({ orderId: id })).attemptCount, attemptsBefore);
  await db.collection("inventories").updateOne(
    { variantId },
    { $set: { stockQuantity: inventoryBaseline.stockQuantity, reservedQuantity: inventoryBaseline.reservedQuantity } }
  );
});

test("mock payment replay waits while completed-order side effects are still claimed", async () => {
  const inventoryBaseline = await db.collection("inventories").findOne({ variantId });
  for (const claimField of ["stockCommitClaim", "paymentOperationClaim"]) {
    const id = await createLifecycleOrder({ paymentMethod: "mock" });
    await advanceOrder(id, ["confirmed", "processing", "shipped", "delivered", "completed"]);
    const claim = new ObjectId();
    await db.collection("orders").updateOne({ _id: id }, { $set: { [claimField]: claim } });

    const response = await customerAgent.post(`/api/orders/${id}/payment`).send({ outcome: "success" });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, "CONCURRENT_UPDATE");
    const order = await db.collection("orders").findOne({ _id: id });
    assert.equal(order[claimField].toHexString(), claim.toHexString());
    assert.equal(order.paymentStatus, "paid");
    assert.equal((await db.collection("payments").findOne({ orderId: id })).status, "paid");
    assert.equal((await db.collection("invoices").findOne({ orderId: id })).status, "issued");
    await db.collection("orders").updateOne({ _id: id }, { $unset: { [claimField]: "" } });
    await db.collection("inventories").updateOne(
      { variantId },
      { $set: { stockQuantity: inventoryBaseline.stockQuantity, reservedQuantity: inventoryBaseline.reservedQuantity } }
    );
  }
});

test("mock payment does not report an idempotent success for mismatched paid artifacts", async () => {
  const inventoryBaseline = await db.collection("inventories").findOne({ variantId });
  for (const mismatch of ["pending-invoice", "pending-order"]) {
    const id = await createLifecycleOrder({ paymentMethod: "mock" });
    await db.collection("payments").updateOne({ orderId: id }, { $set: { status: "paid", paidAt: new Date() } });
    if (mismatch === "pending-invoice") {
      await db.collection("orders").updateOne({ _id: id }, { $set: { paymentStatus: "paid" } });
    } else {
      await db.collection("invoices").updateOne({ orderId: id }, { $set: { status: "issued", issuedAt: new Date() } });
    }

    const response = await customerAgent.post(`/api/orders/${id}/payment`).send({ outcome: "success" });
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.error.code, "ORDER_ARTIFACTS_INCOMPLETE");
    const order = await db.collection("orders").findOne({ _id: id });
    assert.equal(order.paymentOperationClaim, undefined);
    assert.equal((await db.collection("payments").findOne({ orderId: id })).status, "paid");
    assert.equal((await db.collection("invoices").findOne({ orderId: id })).status, mismatch === "pending-invoice" ? "pending" : "issued");
    await db.collection("inventories").updateOne(
      { variantId },
      { $set: { stockQuantity: inventoryBaseline.stockQuantity, reservedQuantity: inventoryBaseline.reservedQuantity } }
    );
  }
});

test("stock-committed legacy completion rolls back order when history write fails", async () => {
  const inventoryBaseline = await db.collection("inventories").findOne({ variantId });
  const id = await createLifecycleOrder();
  await advanceOrder(id, ["confirmed", "processing", "shipped", "delivered"]);
  await db.collection("orders").updateOne({ _id: id }, { $set: { stockCommitted: true, paymentStatus: "paid" } });
  await db.collection("payments").updateOne({ orderId: id }, { $set: { status: "paid", paidAt: new Date() } });
  await db.collection("invoices").updateOne({ orderId: id }, { $set: { status: "issued", issuedAt: new Date() } });
  const order = await db.collection("orders").findOne({ _id: id });
  const inventoryBefore = await db.collection("inventories").findOne({ variantId });
  const failingDb = {
    collection(name) {
      const collection = db.collection(name);
      if (name !== "order_histories") return collection;
      return new Proxy(collection, {
        get(target, property) {
          if (property === "insertOne") return async (document, ...args) => {
            if (document.newStatus === "completed") throw new Error("injected legacy completion history failure");
            return target.insertOne(document, ...args);
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
  };

  await assert.rejects(
    transitionOrder({ db: failingDb, order, user: sales, status: "completed" }),
    /injected legacy completion history failure/
  );
  const savedOrder = await db.collection("orders").findOne({ _id: id });
  assert.equal(savedOrder.orderStatus, "delivered");
  assert.equal(savedOrder.stockCommitted, true);
  assert.equal(savedOrder.paymentStatus, "paid");
  assert.equal(savedOrder.stockCommitClaim, undefined);
  assert.equal(await db.collection("order_histories").countDocuments({ orderId: id, newStatus: "completed" }), 0);
  const inventoryAfter = await db.collection("inventories").findOne({ variantId });
  assert.equal(inventoryAfter.stockQuantity, inventoryBefore.stockQuantity);
  assert.equal(inventoryAfter.reservedQuantity, inventoryBefore.reservedQuantity);
  await db.collection("inventories").updateOne(
    { variantId },
    { $set: { stockQuantity: inventoryBaseline.stockQuantity, reservedQuantity: inventoryBaseline.reservedQuantity } }
  );
});

test("completion treats a lost final claim-release acknowledgement as committed success", async () => {
  const inventoryBaseline = await db.collection("inventories").findOne({ variantId });
  const id = await createLifecycleOrder();
  await advanceOrder(id, ["confirmed", "processing", "shipped", "delivered"]);
  const order = await db.collection("orders").findOne({ _id: id });
  let injected = false;
  const ambiguousDb = {
    collection(name) {
      const collection = db.collection(name);
      if (name !== "orders") return collection;
      return new Proxy(collection, {
        get(target, property) {
          if (property === "findOneAndUpdate") return async (filter, ...args) => {
            const result = await target.findOneAndUpdate(filter, ...args);
            if (!injected && filter.orderStatus === "completed" && args[0]?.$unset?.stockCommitClaim) {
              injected = true;
              throw new Error("injected lost final claim-release acknowledgement");
            }
            return result;
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
  };

  const completed = await transitionOrder({ db: ambiguousDb, order, user: sales, status: "completed" });
  assert.equal(completed.orderStatus, "completed");
  const savedOrder = await db.collection("orders").findOne({ _id: id });
  assert.equal(savedOrder.stockCommitClaim, undefined);
  assert.equal(savedOrder.stockCommitted, true);
  assert.equal((await db.collection("payments").findOne({ orderId: id })).status, "paid");
  assert.equal((await db.collection("invoices").findOne({ orderId: id })).status, "issued");
  assert.equal(await db.collection("order_histories").countDocuments({ orderId: id, newStatus: "completed" }), 1);
  const inventoryAfter = await db.collection("inventories").findOne({ variantId });
  assert.equal(inventoryAfter.stockQuantity, inventoryBaseline.stockQuantity - 1);
  await db.collection("inventories").updateOne(
    { variantId },
    { $set: { stockQuantity: inventoryBaseline.stockQuantity, reservedQuantity: inventoryBaseline.reservedQuantity } }
  );
});

test("completion fails closed while a mock-payment operation owns the order lock", async () => {
  const inventoryBefore = await db.collection("inventories").findOne({ variantId });
  const id = await createLifecycleOrder({ paymentMethod: "mock" });
  await advanceOrder(id, ["confirmed", "processing", "shipped", "delivered"]);
  const paymentOperationClaim = new ObjectId();
  await db.collection("orders").updateOne({ _id: id }, { $set: { paymentOperationClaim } });

  const response = await salesAgent.patch(`/api/orders/${id}/status`).send({ status: "completed" });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "CONCURRENT_UPDATE");
  const savedOrder = await db.collection("orders").findOne({ _id: id });
  const inventoryAfter = await db.collection("inventories").findOne({ variantId });
  assert.equal(savedOrder.orderStatus, "delivered");
  assert.equal(savedOrder.stockCommitClaim, undefined);
  assert.equal(inventoryAfter.stockQuantity, inventoryBefore.stockQuantity);
  assert.equal(inventoryAfter.reservedQuantity, inventoryBefore.reservedQuantity + 1);
  await db.collection("orders").updateOne({ _id: id }, { $unset: { paymentOperationClaim: "" } });
  await db.collection("inventories").updateOne(
    { variantId },
    { $set: { stockQuantity: inventoryBefore.stockQuantity, reservedQuantity: inventoryBefore.reservedQuantity } }
  );
});

test("mock payment rejects while completion owns the order lock", async () => {
  const id = await createLifecycleOrder({ paymentMethod: "mock" });
  const stockCommitClaim = new ObjectId();
  await db.collection("orders").updateOne({ _id: id }, { $set: { stockCommitClaim } });

  const response = await customerAgent.post(`/api/orders/${id}/payment`).send({ outcome: "success" });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "CONCURRENT_UPDATE");
  assert.equal((await db.collection("payments").findOne({ orderId: id })).status, "pending");
  assert.equal((await db.collection("invoices").findOne({ orderId: id })).status, "pending");
  assert.equal((await db.collection("orders").findOne({ _id: id })).paymentStatus, "pending");

  await db.collection("orders").updateOne({ _id: id }, { $unset: { stockCommitClaim: "" } });
  const inventory = await db.collection("inventories").findOne({ variantId });
  await db.collection("inventories").updateOne(
    { variantId },
    { $set: { reservedQuantity: inventory.reservedQuantity - 1 } }
  );
});

test("mock payment restores artifacts and releases its lock when an update ACK is lost", async () => {
  const inventoryBaseline = await db.collection("inventories").findOne({ variantId });
  for (const failedCollection of ["payments", "invoices"]) {
    const id = await createLifecycleOrder({ paymentMethod: "mock" });
    let injected = false;
    const failingDb = {
      collection(name) {
        const collection = db.collection(name);
        if (name !== failedCollection) return collection;
        return new Proxy(collection, {
          get(target, property) {
            if (property === "updateOne") return async (...args) => {
              const result = await target.updateOne(...args);
              if (!injected && args[1]?.$set?.paymentAttemptClaim) {
                injected = true;
                throw new Error(`injected lost ${failedCollection} acknowledgement`);
              }
              return result;
            };
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          }
        });
      }
    };
    const failingAgent = request.agent(createApp({ db: failingDb, config: { jwtSecret: "test-secret", frontendRoot: new URL("../../frontend/", import.meta.url) } }));
    const login = await failingAgent.post("/api/auth/login").send({ email: customer.email, password: "Demo@123" });
    assert.equal(login.status, 200);

    const failed = await failingAgent.post(`/api/orders/${id}/payment`).send({ outcome: "success" });
    assert.equal(failed.status, 500, JSON.stringify(failed.body));
    const savedOrder = await db.collection("orders").findOne({ _id: id });
    assert.equal(savedOrder.paymentOperationClaim, undefined);
    assert.equal(savedOrder.paymentStatus, "pending");
    assert.equal((await db.collection("payments").findOne({ orderId: id })).status, "pending");
    assert.equal((await db.collection("payments").findOne({ orderId: id })).paymentAttemptClaim, undefined);
    assert.equal((await db.collection("invoices").findOne({ orderId: id })).status, "pending");
    assert.equal((await db.collection("invoices").findOne({ orderId: id })).paymentAttemptClaim, undefined);

    const retry = await customerAgent.post(`/api/orders/${id}/payment`).send({ outcome: "success" });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.data.payment.status, "paid");
    assert.equal((await db.collection("orders").findOne({ _id: id })).paymentOperationClaim, undefined);
    await db.collection("inventories").updateOne(
      { variantId },
      { $set: { stockQuantity: inventoryBaseline.stockQuantity, reservedQuantity: inventoryBaseline.reservedQuantity } }
    );
  }
});

test("replayed pending-order cancellation releases reservation and writes history once", async () => {
  const inventoryBefore = await db.collection("inventories").findOne({ variantId });
  const id = await createLifecycleOrder({ paymentMethod: "mock", quantity: 2 });
  const responses = await Promise.all([
    salesAgent.delete(`/api/orders/${id}`),
    salesAgent.delete(`/api/orders/${id}`)
  ]);

  assert.deepEqual(responses.map(({ status }) => status).sort((a, b) => a - b), [200, 409]);
  const cancelled = await db.collection("orders").findOne({ _id: id });
  assert.equal(cancelled.orderStatus, "cancelled");
  assert.equal(cancelled.reservationReleased, true);
  const inventoryAfter = await db.collection("inventories").findOne({ variantId });
  assert.equal(inventoryAfter.stockQuantity, inventoryBefore.stockQuantity);
  assert.equal(inventoryAfter.reservedQuantity, inventoryBefore.reservedQuantity);
  assert.equal(await db.collection("order_histories").countDocuments({ orderId: id, newStatus: "cancelled" }), 1);

  const payment = await customerAgent.post(`/api/orders/${id}/payment`).send({ outcome: "success" });
  assert.equal(payment.status, 409);
  assert.equal(payment.body.error.code, "ORDER_NOT_PAYABLE");
  assert.equal((await db.collection("payments").findOne({ orderId: id })).status, "pending");
});

test("delivery replay marks the shipped order delivered and records each effect once", async () => {
  const id = await createLifecycleOrder();
  await advanceOrder(id, ["confirmed", "processing", "shipped"]);
  const order = await db.collection("orders").findOne({ _id: id });
  const created = await salesAgent.post("/api/admin/deliveries").send({
    orderId: id.toHexString(), storeId: order.storeId.toHexString(), deliveryAddress: "1 Demo Street"
  });
  assert.equal(created.status, 201);
  const deliveryId = created.body.data.id;
  for (const status of ["assigned", "picked_up", "in_transit", "delivered"]) {
    const response = await salesAgent.patch(`/api/admin/deliveries/${deliveryId}`).send({ status });
    assert.equal(response.status, 200, JSON.stringify(response.body));
  }
  const replay = await salesAgent.patch(`/api/admin/deliveries/${deliveryId}`).send({ status: "delivered" });
  assert.equal(replay.status, 409);

  const delivery = await db.collection("deliveries").findOne({ _id: new ObjectId(deliveryId) });
  assert.equal(delivery.status, "delivered");
  assert.deepEqual(delivery.history.map(({ status }) => status), ["ready", "assigned", "picked_up", "in_transit", "delivered"]);
  assert.equal((await db.collection("orders").findOne({ _id: id })).orderStatus, "delivered");
  assert.equal(await db.collection("order_histories").countDocuments({ orderId: id, oldStatus: "shipped", newStatus: "delivered" }), 1);
  assert.equal((await db.collection("payments").findOne({ orderId: id })).status, "pending");
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
