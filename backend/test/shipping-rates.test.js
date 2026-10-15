import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";
import request from "supertest";
import { createApp } from "../src/app.js";
import { collections } from "../src/collections.js";
import { createIndexes } from "../scripts/create-indexes.js";
import { seedDemo } from "../scripts/seed.js";

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const configuredDbPrefix = process.env.MONGODB_TEST_DB || "maison_belle_test";
if (!/^maison_belle_test(?:_|$)/.test(configuredDbPrefix)) {
  throw new Error("MONGODB_TEST_DB must use the maison_belle_test_ prefix");
}
const testDbPrefix = `${configuredDbPrefix}_${process.pid}`;
const dbName = `${testDbPrefix}_shipping_rates`;
const seedDbName = `${testDbPrefix}_shipping_rates_seed`;
let client;
let db;
let app;
let connected = false;
let managerAgent;
let salesAgent;
let warehouseAgent;
let customerAgent;

before(async () => {
  client = new MongoClient(mongoUri);
  await client.connect();
  connected = true;
  db = client.db(dbName);
  await db.dropDatabase();
  await createIndexes(db);

  const users = ["manager", "sales", "customer", "warehouse"].map((role) => ({
    _id: new ObjectId(),
    email: `${role}-shipping@test.local`,
    fullName: `${role} shipping test`,
    role,
    passwordHash: bcrypt.hashSync("Demo@123", 8),
    isActive: true
  }));
  await db.collection("users").insertMany(users);
  await db.collection("shipping_rates").insertMany([
    { code: "hcm-demo", regionName: "Hồ Chí Minh (demo)", fee: 25000, currency: "VND", isActive: true, isDemo: true },
    { code: "hn-demo", regionName: "Hà Nội (demo)", fee: 30000, currency: "VND", isActive: true, isDemo: true },
    { code: "inactive-demo", regionName: "Inactive (demo)", fee: 10000, currency: "VND", isActive: false, isDemo: true }
  ]);

  app = createApp({ db, config: { jwtSecret: "test-secret", frontendRoot: new URL("../../frontend/", import.meta.url) } });
  [managerAgent, salesAgent, customerAgent, warehouseAgent] = users.map(() => request.agent(app));
  for (const [agent, user] of [[managerAgent, users[0]], [salesAgent, users[1]], [customerAgent, users[2]], [warehouseAgent, users[3]]]) {
    const login = await agent.post("/api/auth/login").send({ email: user.email, password: "Demo@123" });
    assert.equal(login.status, 200);
  }
});

after(async () => {
  if (!client) return;
  try {
    if (connected) {
      await client.db(dbName).dropDatabase();
      await client.db(seedDbName).dropDatabase();
    }
  } finally {
    await client.close();
  }
});

test("shipping-rate test databases use the configured prefix and isolate each process", () => {
  assert.equal(mongoUri, process.env.MONGODB_URI || "mongodb://127.0.0.1:27017");
  assert.equal(dbName, `${testDbPrefix}_shipping_rates`);
  assert.equal(seedDbName, `${testDbPrefix}_shipping_rates_seed`);
  assert.equal(testDbPrefix, `${configuredDbPrefix}_${process.pid}`);
  assert.match(dbName, /^maison_belle_test_/);
  assert.match(seedDbName, /^maison_belle_test_/);
});

test("collections exposes the shipping_rates collection", () => {
  assert.equal(collections(db).shippingRates.collectionName, "shipping_rates");
});

test("public rate list includes active configured regions only", async () => {
  const response = await request(app).get("/api/shipping/rates");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, [
    { regionCode: "hcm-demo", regionName: "Hồ Chí Minh (demo)", fee: 25000, currency: "VND", isDemo: true },
    { regionCode: "hn-demo", regionName: "Hà Nội (demo)", fee: 30000, currency: "VND", isDemo: true }
  ]);
});

test("public quote resolves only an active configured region", async () => {
  const quote = await request(app).post("/api/shipping/quote").send({ regionCode: "hcm-demo" });
  assert.equal(quote.status, 200);
  assert.deepEqual(quote.body.data, {
    regionCode: "hcm-demo", regionName: "Hồ Chí Minh (demo)", fee: 25000,
    currency: "VND", isDemo: true
  });

  for (const regionCode of ["unknown", "inactive-demo"]) {
    const missing = await request(app).post("/api/shipping/quote").send({ regionCode });
    assert.equal(missing.status, 409);
    assert.equal(missing.body.error.code, "SHIPPING_UNAVAILABLE");
  }
});

test("manager can list, create, update, and soft-deactivate shipping rates", async () => {
  const listed = await managerAgent.get("/api/admin/shipping-rates");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.data.length, 3);

  const created = await managerAgent.post("/api/admin/shipping-rates").send({
    regionCode: "  DA-NANG-DEMO ", regionName: " Đà Nẵng (demo) ", fee: 20000, isActive: true
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.regionCode, "da-nang-demo");
  assert.equal(created.body.data.regionName, "Đà Nẵng (demo)");
  assert.equal(created.body.data.currency, "VND");
  assert.equal(created.body.data.isDemo, true);

  const renamed = await managerAgent.patch(`/api/admin/shipping-rates/${created.body.data.id}`).send({ regionCode: "da-nang-city-demo" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.data.regionCode, "da-nang-city-demo");

  const updated = await managerAgent.patch(`/api/admin/shipping-rates/${created.body.data.id}`).send({ fee: 22000, isActive: false });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.fee, 22000);
  assert.equal(updated.body.data.isActive, false);

  const deactivated = await managerAgent.delete(`/api/admin/shipping-rates/${created.body.data.id}`);
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.body.data.isActive, false);
  assert.ok(await db.collection("shipping_rates").findOne({ code: "da-nang-city-demo" }));
});

test("shipping-rate reads are manager-only", async () => {
  assert.equal((await salesAgent.get("/api/admin/shipping-rates")).status, 403);
  assert.equal((await customerAgent.get("/api/admin/shipping-rates")).status, 403);
});

test("shipping-rate writes require manager role, preserve state on denials, and validate unique codes and fees", async () => {
  const shippingRates = db.collection("shipping_rates");
  const hcmRate = await shippingRates.findOne({ code: "hcm-demo" });
  const countBeforeDeniedWrites = await shippingRates.countDocuments();
  const actors = [
    ["anonymous", request(app), 401],
    ["sales", salesAgent, 403],
    ["warehouse", warehouseAgent, 403],
    ["customer", customerAgent, 403]
  ];
  for (const [role, agent, expectedStatus] of actors) {
    const deniedCreate = await agent.post("/api/admin/shipping-rates").send({ regionCode: "denied-demo", regionName: "Denied", fee: 1 });
    assert.equal(deniedCreate.status, expectedStatus, `${role} cannot create shipping rates`);
    assert.equal(await shippingRates.countDocuments(), countBeforeDeniedWrites);
    assert.equal(await shippingRates.countDocuments({ code: "denied-demo" }), 0);

    const deniedUpdate = await agent.patch(`/api/admin/shipping-rates/${hcmRate._id}`).send({ fee: 1 });
    assert.equal(deniedUpdate.status, expectedStatus, `${role} cannot update shipping rates`);
    assert.deepEqual(await shippingRates.findOne({ _id: hcmRate._id }), hcmRate);

    const deniedDelete = await agent.delete(`/api/admin/shipping-rates/${hcmRate._id}`);
    assert.equal(deniedDelete.status, expectedStatus, `${role} cannot deactivate shipping rates`);
    assert.deepEqual(await shippingRates.findOne({ _id: hcmRate._id }), hcmRate);
  }

  const duplicate = await managerAgent.post("/api/admin/shipping-rates").send({ regionCode: " HCM-DEMO ", regionName: "Duplicate", fee: 1 });
  assert.equal(duplicate.status, 409);

  for (const fee of [-1, "25000"]) {
    const invalid = await managerAgent.post("/api/admin/shipping-rates").send({ regionCode: "invalid-fee", regionName: "Invalid fee", fee });
    assert.equal(invalid.status, 400);
  }
  const blankCode = await managerAgent.post("/api/admin/shipping-rates").send({ regionCode: "  ", regionName: "No code", fee: 0 });
  assert.equal(blankCode.status, 400);
  const blankName = await managerAgent.post("/api/admin/shipping-rates").send({ regionCode: "no-name", regionName: "  ", fee: 0 });
  assert.equal(blankName.status, 400);
});

test("shipping rate indexes enforce unique codes and support active-region queries", async () => {
  const indexes = await db.collection("shipping_rates").indexes();
  assert.ok(indexes.some((index) => index.unique && index.key.code === 1));
  assert.ok(indexes.some((index) => index.key.isActive === 1 && index.key.code === 1));
  await assert.rejects(
    db.collection("shipping_rates").insertOne({ code: "hcm-demo" }),
    (error) => error.code === 11000
  );
});

test("rerunning demo seed preserves manager-edited shipping rates", async () => {
  const seedDb = client.db(seedDbName);
  const config = { databaseName: seedDbName, allowDemoSeed: false };
  await seedDemo(seedDb, config);
  await seedDb.collection("shipping_rates").updateOne(
    { code: "hcm-demo" },
    { $set: { regionName: "Custom HCMC", fee: 42000, isActive: false } }
  );

  await seedDemo(seedDb, config);

  const saved = await seedDb.collection("shipping_rates").findOne({ code: "hcm-demo" });
  assert.equal(saved.regionName, "Custom HCMC");
  assert.equal(saved.fee, 42000);
  assert.equal(saved.isActive, false);
  assert.equal(await seedDb.collection("shipping_rates").countDocuments({ code: "hcm-demo" }), 1);
});

test("seeded shipping-rate codes cannot be renamed and seed reruns keep deactivation", async () => {
  const config = { databaseName: dbName, allowDemoSeed: false };
  const hcm = await db.collection("shipping_rates").findOne({ code: "hcm-demo" });
  const renamed = await managerAgent.patch(`/api/admin/shipping-rates/${hcm._id}`).send({
    regionCode: "hcm-city-demo"
  });
  assert.equal(renamed.status, 400);

  const deactivated = await managerAgent.delete(`/api/admin/shipping-rates/${hcm._id}`);
  assert.equal(deactivated.status, 200);

  await seedDemo(db, config);

  const rates = db.collection("shipping_rates");
  assert.equal(await rates.countDocuments({ code: "hcm-demo" }), 1);
  assert.equal(await rates.countDocuments({ code: "hcm-city-demo" }), 0);
  const saved = await rates.findOne({ code: "hcm-demo" });
  assert.equal(saved.isActive, false);
});
