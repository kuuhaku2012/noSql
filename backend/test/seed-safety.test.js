import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { MongoClient, ObjectId } from "mongodb";
import { createIndexes } from "../scripts/create-indexes.js";
import { migrateModel } from "../scripts/migrate-model.js";
import { buildDemoData, assertSafeSeedDatabase, seedDemo } from "../scripts/seed.js";

const mongoUri = "mongodb://127.0.0.1:27017";
const dbName = "maison_belle_test_auth_email_codes";
if (process.env.MONGODB_TEST_DB !== dbName) {
  throw new Error(`MONGODB_TEST_DB must be exactly ${dbName}`);
}
let client;
let db;
let connected = false;

before(async () => {
  client = new MongoClient(mongoUri);
  await client.connect();
  connected = true;
  db = client.db(dbName);
  await db.dropDatabase();
});

after(async () => {
  try {
    if (connected) await client.db(dbName).dropDatabase();
  } finally {
    await client?.close();
  }
});

test("demo seed rejects production-looking database names", () => {
  assert.throws(
    () => assertSafeSeedDatabase({ databaseName: "maison_belle_production", allowDemoSeed: false }),
    (error) => error.code === "UNSAFE_SEED_DATABASE"
  );
});

test("demo seed records are explicitly marked", () => {
  const data = buildDemoData();
  for (const collection of ["users", "products", "vouchers"]) {
    assert.ok(data[collection].length > 0);
    assert.ok(data[collection].every((record) => record.isDemo === true));
  }
});

test("demo users omit empty unique phone values", () => {
  const data = buildDemoData();
  assert.ok(data.users.every((user) => user.phone === undefined || typeof user.phone === "string"));
});

test("create-index setup preflights both unique keys before creating either index", async () => {
  const rates = db.collection("shipping_rates");
  const duplicateRates = [
    { _id: new ObjectId(), code: "same-rate", regionName: "First record", isActive: true },
    { _id: new ObjectId(), code: "same-rate", regionName: "Second record", isActive: true }
  ];
  await db.createCollection("users");
  await db.createCollection("orders");
  await rates.insertMany(duplicateRates);

  await assert.rejects(createIndexes(db), (error) => {
    assert.match(error.message, /shipping_rates\.code/i);
    assert.match(error.message, /same-rate/);
    for (const rate of duplicateRates) assert.ok(error.message.includes(rate._id.toHexString()));
    return true;
  });
  assert.deepEqual(await rates.find({ code: "same-rate" }).sort({ regionName: 1 }).toArray(), duplicateRates);
  assert.equal((await db.collection("users").indexes()).some((index) => index.unique && index.key.email === 1), false);
  assert.equal((await rates.indexes()).some((index) => index.unique && index.key.code === 1), false);
  assert.equal((await db.collection("orders").indexes()).some((index) => index.name === "userId_1_checkoutRequestId_1"), false);

  await db.dropDatabase();
  await db.createCollection("users");
  await db.createCollection("shipping_rates");
  const userId = new ObjectId();
  const duplicateOrders = [
    { _id: new ObjectId(), orderCode: "LEGACY-1", userId, checkoutRequestId: "same-checkout" },
    { _id: new ObjectId(), orderCode: "LEGACY-2", userId, checkoutRequestId: "same-checkout" }
  ];
  const orders = db.collection("orders");
  await orders.insertMany(duplicateOrders);

  await assert.rejects(createIndexes(db), (error) => {
    assert.match(error.message, /checkoutRequestId/i);
    assert.match(error.message, /same-checkout/);
    for (const order of duplicateOrders) assert.ok(error.message.includes(order._id.toHexString()));
    return true;
  });
  assert.deepEqual(await orders.find({ userId }).sort({ orderCode: 1 }).toArray(), duplicateOrders);
  assert.equal((await db.collection("users").indexes()).some((index) => index.unique && index.key.email === 1), false);
  assert.equal((await rates.indexes()).some((index) => index.unique && index.key.code === 1), false);
  assert.equal((await orders.indexes()).some((index) => index.name === "userId_1_checkoutRequestId_1"), false);
});

test("create-index setup preflights missing and null shipping codes as the same unique key", async () => {
  await db.dropDatabase();
  await db.createCollection("users");
  await db.createCollection("orders");
  const rates = db.collection("shipping_rates");
  const missingCodeRate = { _id: new ObjectId(), regionName: "Missing code", isActive: true };
  const nullCodeRate = { _id: new ObjectId(), code: null, regionName: "Null code", isActive: true };
  await rates.insertMany([missingCodeRate, nullCodeRate]);

  await assert.rejects(createIndexes(db), (error) => {
    assert.match(error.message, /shipping_rates\.code/i);
    assert.match(error.message, /null/i);
    assert.ok(error.message.includes(missingCodeRate._id.toHexString()));
    assert.ok(error.message.includes(nullCodeRate._id.toHexString()));
    return true;
  });
  assert.deepEqual(await rates.findOne({ _id: missingCodeRate._id }), missingCodeRate);
  assert.deepEqual(await rates.findOne({ _id: nullCodeRate._id }), nullCodeRate);

  const customUniqueIndexes = [];
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    for (const index of await db.collection(name).indexes()) {
      if (index.unique && index.name !== "_id_") customUniqueIndexes.push(`${name}.${index.name}`);
    }
  }
  assert.deepEqual(customUniqueIndexes, []);
});

test("seed and additive migration are repeatable and preserve legacy addresses and order history", async () => {
  await db.dropDatabase();
  const userId = new ObjectId();
  const orderId = new ObjectId();
  const legacyAddress = {
    _id: new ObjectId(), userId, receiverName: "Legacy Customer", receiverPhone: "0900000000",
    fullAddress: "9 Old Street", isDefault: true, createdAt: new Date("2024-01-01T00:00:00.000Z")
  };
  const legacyShippingAddress = { receiverName: "Legacy Customer", receiverPhone: "0900000000", fullAddress: "9 Old Street" };
  const legacyOrder = {
    _id: orderId, orderCode: "LEGACY-TASK5", userId, shippingAddress: legacyShippingAddress,
    items: [], subtotal: 321000, deliveryFee: 0, discountAmount: 0, finalAmount: 321000,
    paymentMethod: "cod", orderStatus: "completed", createdAt: new Date("2024-01-02T00:00:00.000Z")
  };
  const legacyPayment = { _id: new ObjectId(), orderId, method: "cod", status: "paid", amount: 321000 };
  const legacyHistory = { _id: new ObjectId(), orderId, oldStatus: "delivered", newStatus: "completed", note: "Legacy completion" };
  await db.collection("user_addresses").insertOne(legacyAddress);
  await db.collection("orders").insertOne(legacyOrder);
  await db.collection("payments").insertOne(legacyPayment);
  await db.collection("order_histories").insertOne(legacyHistory);

  const config = { databaseName: dbName, allowDemoSeed: false };
  await seedDemo(db, config);
  const legacyUser = { _id: userId, email: "legacy-index@test.local", passwordHash: "legacy-hash", addresses: [legacyAddress], emailVerified: false };
  await db.collection("users").insertOne(legacyUser);
  const usersBeforeIndexes = await db.collection("users").find().sort({ _id: 1 }).toArray();
  const userCountBeforeIndexes = await db.collection("users").countDocuments();
  await createIndexes(db);
  await createIndexes(db);
  assert.deepEqual(await db.collection("users").find().sort({ _id: 1 }).toArray(), usersBeforeIndexes);
  assert.equal(await db.collection("users").countDocuments(), userCountBeforeIndexes);
  assert.deepEqual(await db.collection("users").findOne({ _id: userId }), legacyUser);
  const authIndexes = await db.collection("auth_email_verifications").indexes();
  assert.ok(authIndexes.some((index) => index.unique === true && JSON.stringify(index.key) === JSON.stringify({ email: 1, purpose: 1 })));
  assert.ok(authIndexes.some((index) => index.expireAfterSeconds === 0 && JSON.stringify(index.key) === JSON.stringify({ purgeAt: 1 })));
  await migrateModel(db);
  await migrateModel(db);
  await seedDemo(db, config);

  assert.deepEqual(await db.collection("user_addresses").findOne({ _id: legacyAddress._id }), legacyAddress);
  assert.deepEqual(await db.collection("orders").findOne({ _id: orderId }), { ...legacyOrder, district: null, ward: null });
  assert.deepEqual(await db.collection("payments").findOne({ _id: legacyPayment._id }), legacyPayment);
  assert.deepEqual(await db.collection("order_histories").findOne({ _id: legacyHistory._id }), legacyHistory);
  assert.equal((await db.collection("user_addresses").findOne({ _id: legacyAddress._id })).regionCode, undefined);
  assert.equal((await db.collection("orders").findOne({ _id: orderId })).shippingAddress.regionCode, undefined);
  assert.equal(await db.collection("shipping_rates").countDocuments({ code: "hcm-demo" }), 1);
});
