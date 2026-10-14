import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { MongoClient } from "mongodb";
import request from "supertest";
import { createApp } from "../src/app.js";

const dbName = "maison_belle_test_auth_flow";
if (process.env.MONGODB_TEST_DB !== dbName) {
  throw new Error(`MONGODB_TEST_DB must be exactly ${dbName}`);
}
const secret = "test-auth-code-secret-that-is-at-least-32-characters";
const accepted = { data: { accepted: true, resendAfterSeconds: 60 } };
const smtpFailure = "fake SMTP failure with private transport details";
const ownedCollections = new Set();
let client;
let database;
let fixtureId = 0;

before(async () => {
  client = new MongoClient("mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  database = client.db(dbName);
});

after(async () => {
  try {
    for (const name of ownedCollections) {
      await database.collection(name).drop().catch((error) => {
        if (error.code !== 26) throw error;
      });
    }
  } finally {
    await client?.close();
  }
});

async function makeFixture({ config: overrides = {}, configured = true } = {}) {
  const prefix = `task3_api_${process.pid}_${++fixtureId}_`;
  const scopedCollections = new Map();
  const db = { collection(name, ...args) {
    const scopedName = `${prefix}${name}`;
    ownedCollections.add(scopedName);
    if (!scopedCollections.has(name)) scopedCollections.set(name, database.collection(scopedName, ...args));
    return scopedCollections.get(name);
  } };
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("users").createIndex({ phone: 1 }, { unique: true, sparse: true });
  await db.collection("auth_email_verifications").createIndex({ email: 1, purpose: 1 }, { unique: true });
  const sent = new Map();
  const attempted = new Map();
  const mailer = { configured, fail: false, async sendAuthCode({ email, purpose, code }) {
    attempted.set(`${purpose}:${email}`, code);
    if (this.fail) throw new Error(smtpFailure);
    sent.set(`${purpose}:${email}`, code);
  } };
  const config = { jwtSecret: "test-secret", authCodeSecret: secret, trustProxy: false,
    frontendRoot: new URL("../../", import.meta.url), ...overrides };
  const app = createApp({ db, config, mailer });
  return { db, mailer, sent, attempted, config, app, agent: request.agent(app) };
}

async function seedUser(f, email = "active@test.local", extra = {}) {
  await f.db.collection("users").insertOne({ email, fullName: "Test Customer", role: "customer",
    isActive: true, passwordHash: await bcrypt.hash("Old@123", 8), ...extra });
  return email;
}

function assertAccepted(response, codes = []) {
  assert.equal(response.status, 202);
  assert.deepEqual(response.body, accepted);
  for (const code of codes) assert.equal(response.text.includes(code), false);
  assert.doesNotMatch(response.text, /smtp|transport|passwordHash|verificationCode|sent/i);
}

const registration = (email, verificationCode) => ({ email, fullName: "New Customer", password: "Secret@123", verificationCode });
const reset = (email, verificationCode) => ({ email, verificationCode, newPassword: "New@123" });

test("send-code routes reject invalid email before storing a challenge", async () => {
  const f = await makeFixture();
  for (const route of ["register", "password-reset"]) {
    for (const email of [undefined, 123, "bad", "a b@test.local", "x".repeat(255)]) {
      const response = await f.agent.post(`/api/auth/${route}/send-code`).send({ email });
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, "VALIDATION_ERROR");
    }
  }
  assert.equal(await f.db.collection("auth_email_verifications").countDocuments(), 0);
  assert.equal(f.attempted.size, 0);
});

test("registration requires a six-digit code and never creates an unverified user", async () => {
  const f = await makeFixture();
  for (const code of [undefined, 123456, "12345", "1234567", "abcdef"]) {
    const response = await f.agent.post("/api/auth/register").send(registration("new@test.local", code));
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "VALIDATION_ERROR");
  }
  const noChallenge = await f.agent.post("/api/auth/register").send(registration("new@test.local", "123456"));
  assert.equal(noChallenge.status, 400);
  assert.equal(noChallenge.body.error.code, "EMAIL_CODE_INVALID");
  assert.equal(await f.db.collection("users").countDocuments(), 0);
});

test("registration after delivery normalizes email, marks verification and creates a safe customer session", async () => {
  const f = await makeFixture();
  const email = "new@test.local";
  const response = await f.agent.post("/api/auth/register/send-code").send({ email: " New@Test.Local " });
  const code = f.sent.get(`register:${email}`);
  assertAccepted(response, code ? [code] : []);
  assert.match(code, /^\d{6}$/);
  const registered = await f.agent.post("/api/auth/register").send({ ...registration(" New@Test.Local ", code),
    phone: "0900000999", skinType: "sensitive", role: "manager", isActive: false, isDemo: true });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.data.email, email);
  assert.equal(registered.body.data.role, "customer");
  assert.equal(registered.body.data.isActive, true);
  assert.equal(registered.body.data.passwordHash, undefined);
  assert.equal(registered.text.includes(code), false);
  assert.match(registered.headers["set-cookie"].join(";"), /mb_token=.*HttpOnly.*SameSite=Lax/i);
  const user = await f.db.collection("users").findOne({ email });
  assert.ok(user.emailVerifiedAt instanceof Date);
  assert.equal(user.emailVerifiedAt.getTime(), user.createdAt.getTime());
  assert.equal(user.role, "customer");
  assert.equal(user.isDemo, false);
  assert.equal(await bcrypt.compare("Secret@123", user.passwordHash), true);
  const me = await f.agent.get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.data.id, registered.body.data.id);
  await f.agent.post("/api/auth/logout").expect(204);
  await f.agent.post("/api/auth/login").send({ email, password: "Secret@123" }).expect(200);
  await f.db.collection("users").deleteOne({ email });
  const reused = await f.agent.post("/api/auth/register").send(registration(email, code));
  assert.equal(reused.status, 400);
  assert.equal(reused.body.error.code, "EMAIL_CODE_INVALID");
});

test("registration rejects duplicate email at send and duplicate email or phone at consume", async () => {
  const f = await makeFixture();
  const email = await seedUser(f, "existing@test.local", { phone: "0900000123" });
  const send = await f.agent.post("/api/auth/register/send-code").send({ email: email.toUpperCase() });
  assert.equal(send.status, 409);
  assert.equal(send.body.error.code, "DUPLICATE_USER");
  for (const input of [registration(email, "123456"), { ...registration("other@test.local", "123456"), phone: "0900000123" }]) {
    const response = await f.agent.post("/api/auth/register").send(input);
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, "DUPLICATE_USER");
  }
  assert.equal(f.attempted.size, 0);
});

test("purpose binding prevents registration and reset from accepting each other's codes", async () => {
  const f = await makeFixture();
  const email = "register-purpose@test.local";
  await f.agent.post("/api/auth/register/send-code").send({ email }).expect(202);
  const wrongReset = await f.agent.post("/api/auth/password-reset").send(reset(email, f.sent.get(`register:${email}`)));
  assert.equal(wrongReset.status, 400);
  assert.equal(wrongReset.body.error.code, "EMAIL_CODE_INVALID");
  const resetEmail = await seedUser(f, "reset-purpose@test.local");
  await f.agent.post("/api/auth/password-reset/send-code").send({ email: resetEmail }).expect(202);
  await f.db.collection("users").deleteOne({ email: resetEmail });
  const wrongRegister = await f.agent.post("/api/auth/register").send(registration(resetEmail, f.sent.get(`password_reset:${resetEmail}`)));
  assert.equal(wrongRegister.status, 400);
  assert.equal(wrongRegister.body.error.code, "EMAIL_CODE_INVALID");
});

test("reset-send returns identical accepted bodies for active, unknown and inactive accounts", async () => {
  const f = await makeFixture();
  const email = await seedUser(f);
  await seedUser(f, "inactive@test.local", { isActive: false });
  for (const address of [" ACTIVE@Test.Local ", "unknown@test.local", "inactive@test.local"]) {
    const response = await f.agent.post("/api/auth/password-reset/send-code").send({ email: address });
    assertAccepted(response, [...f.sent.values()]);
  }
  assert.match(f.sent.get(`password_reset:${email}`), /^\d{6}$/);
  assert.equal(f.attempted.size, 1);
});

test("reset-send hides cooldown and hourly-window throttling just like unknown accounts", async () => {
  const f = await makeFixture();
  const email = await seedUser(f);
  await f.agent.post("/api/auth/password-reset/send-code").send({ email }).expect(202);
  const code = f.sent.get(`password_reset:${email}`);
  assertAccepted(await f.agent.post("/api/auth/password-reset/send-code").send({ email }), [code]);
  await f.db.collection("auth_email_verifications").updateOne({ _id: `send-window:${email}` }, {
    $set: { lastSentAt: new Date(Date.now() - 60_001), sends: 5 }
  });
  assertAccepted(await f.agent.post("/api/auth/password-reset/send-code").send({ email }), [code]);
  assertAccepted(await f.agent.post("/api/auth/password-reset/send-code").send({ email: "unknown@test.local" }), [code]);
  await f.agent.post("/api/auth/password-reset").send(reset(email, code)).expect(204);
});

test("reset SMTP failure stays generic and leaves the failed code unusable", async () => {
  const f = await makeFixture();
  const email = await seedUser(f);
  const original = await f.db.collection("users").findOne({ email });
  f.mailer.fail = true;
  const active = await f.agent.post("/api/auth/password-reset/send-code").send({ email });
  const failedCode = f.attempted.get(`password_reset:${email}`);
  assert.match(failedCode, /^\d{6}$/);
  const unknown = await f.agent.post("/api/auth/password-reset/send-code").send({ email: "unknown@test.local" });
  assertAccepted(active, [failedCode]);
  assertAccepted(unknown, [failedCode]);
  assert.equal(f.attempted.size, 1);
  assert.equal(f.sent.size, 0);
  const failed = await f.agent.post("/api/auth/password-reset").send(reset(email, failedCode));
  assert.equal(failed.status, 400);
  assert.equal(failed.body.error.code, "EMAIL_CODE_INVALID");
  assert.equal((await f.db.collection("users").findOne({ email })).passwordHash, original.passwordHash);
  assertAccepted(await f.agent.post("/api/auth/password-reset/send-code").send({ email }), [failedCode]);
});

test("missing SMTP or OTP secret fails uniformly before querying users", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const options of [{ configured: false }, { config: { authCodeSecret: "" } }, { config: { authCodeSecret: "short" } }]) {
    const f = await makeFixture(options);
    const email = await seedUser(f);
    const users = f.db.collection("users");
    const lookup = t.mock.method(users, "findOne", () => { throw new Error("user lookup must not happen"); });
    for (const address of [email, "unknown@test.local"]) {
      for (const route of ["register", "password-reset"]) {
        const response = await f.agent.post(`/api/auth/${route}/send-code`).set("x-request-id", "test-config").send({ email: address });
        assert.equal(response.status, 503);
        assert.deepEqual(response.body, { error: { code: "EMAIL_NOT_CONFIGURED", message: "Email delivery is not configured" }, requestId: "test-config" });
      }
    }
    assert.equal(lookup.mock.callCount(), 0);
    assert.equal(await f.db.collection("auth_email_verifications").countDocuments(), 0);
    assert.equal(f.attempted.size, 0);
  }
});

test("reset validates email, six-digit code and password length before consuming the code", async () => {
  const f = await makeFixture();
  const email = await seedUser(f);
  await f.agent.post("/api/auth/password-reset/send-code").send({ email }).expect(202);
  const code = f.sent.get(`password_reset:${email}`);
  for (const input of [{ email: "bad" }, { verificationCode: undefined }, { verificationCode: 123456 },
    { verificationCode: "abcdef" }, { verificationCode: "1234567" }, { newPassword: "12345" },
    { newPassword: "x".repeat(201) }, { newPassword: 123456 }]) {
    const response = await f.agent.post("/api/auth/password-reset").send({ ...reset(email, code), ...input });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "VALIDATION_ERROR");
  }
  await f.agent.post("/api/auth/password-reset").send(reset(email, code)).expect(204);
});

test("reset atomically consumes once, changes the hash, increments authVersion and supports login", async () => {
  const f = await makeFixture();
  const email = await seedUser(f, "active@test.local", { authVersion: 2 });
  const original = await f.db.collection("users").findOne({ email });
  await f.agent.post("/api/auth/password-reset/send-code").send({ email }).expect(202);
  const code = f.sent.get(`password_reset:${email}`);
  const results = await Promise.all([1, 2].map(() => request(f.app).post("/api/auth/password-reset").send(reset(" ACTIVE@Test.Local ", code))));
  assert.deepEqual(results.map((response) => response.status).sort(), [204, 400]);
  const success = results.find((response) => response.status === 204);
  assert.equal(success.text, "");
  assert.equal(success.headers["set-cookie"], undefined);
  assert.equal(results.find((response) => response.status === 400).body.error.code, "EMAIL_CODE_INVALID");
  const user = await f.db.collection("users").findOne({ email });
  assert.notEqual(user.passwordHash, original.passwordHash);
  assert.equal(await bcrypt.compare("New@123", user.passwordHash), true);
  assert.equal(user.authVersion, 3);
  assert.ok(user.updatedAt instanceof Date);
  await f.agent.post("/api/auth/login").send({ email, password: "Old@123" }).expect(401);
  await f.agent.post("/api/auth/login").send({ email, password: "New@123" }).expect(200);
  const reused = await f.agent.post("/api/auth/password-reset").send(reset(email, code));
  assert.equal(reused.status, 400);
  assert.equal(reused.body.error.code, "EMAIL_CODE_INVALID");
});

test("password reset invalidates old sessions and a fresh login authenticates with the new password", async () => {
  const f = await makeFixture();
  const email = await seedUser(f);
  const oldSession = request.agent(f.app);
  await oldSession.post("/api/auth/login").send({ email, password: "Old@123" }).expect(200);
  await oldSession.get("/api/auth/me").expect(200);
  await f.agent.post("/api/auth/password-reset/send-code").send({ email }).expect(202);
  const code = f.sent.get(`password_reset:${email}`);
  await f.agent.post("/api/auth/password-reset").send(reset(email, code)).expect(204);
  const invalid = await oldSession.get("/api/auth/me");
  assert.equal(invalid.status, 401);
  assert.deepEqual(invalid.body.error, { code: "AUTH_INVALID", message: "Session is invalid or expired" });
  const freshSession = request.agent(f.app);
  await freshSession.post("/api/auth/login").send({ email, password: "New@123" }).expect(200);
  await freshSession.get("/api/auth/me").expect(200);
});

test("session versions default absent claims and user fields to zero and reject mismatches", async () => {
  const f = await makeFixture();
  const email = await seedUser(f);
  const user = await f.db.collection("users").findOne({ email });
  for (const [userVersion, claimVersion, status] of [
    [undefined, undefined, 200], [undefined, 0, 200], [0, undefined, 200],
    [1, undefined, 401], [undefined, 1, 401], [1, 0, 401], [1, 1, 200]
  ]) {
    await f.db.collection("users").updateOne({ email }, userVersion === undefined
      ? { $unset: { authVersion: "" } } : { $set: { authVersion: userVersion } });
    const claims = { sub: user._id.toString(), role: user.role };
    if (claimVersion !== undefined) claims.authVersion = claimVersion;
    const token = jwt.sign(claims, f.config.jwtSecret, { expiresIn: "7d" });
    const response = await request(f.app).get("/api/auth/me").set("Cookie", `mb_token=${token}`);
    assert.equal(response.status, status, `user=${userVersion}, claim=${claimVersion}`);
    if (status === 401) assert.equal(response.body.error.code, "AUTH_INVALID");
  }
});

test("versioned sessions preserve customer, sales, warehouse and manager role protection", async () => {
  const f = await makeFixture();
  for (const [role, catalogStatus, inventoryStatus] of [
    ["customer", 403, 403], ["sales", 200, 403], ["warehouse", 200, 200], ["manager", 200, 200]
  ]) {
    const email = await seedUser(f, `${role}@test.local`, { role, authVersion: 1 });
    const agent = request.agent(f.app);
    await agent.post("/api/auth/login").send({ email, password: "Old@123" }).expect(200);
    await agent.get("/api/admin/products").expect(catalogStatus);
    await agent.get("/api/admin/inventory").expect(inventoryStatus);
  }
});

test("deactivation between send and reset leaves the password and authVersion unchanged", async () => {
  const f = await makeFixture();
  const email = await seedUser(f);
  await f.agent.post("/api/auth/password-reset/send-code").send({ email }).expect(202);
  const code = f.sent.get(`password_reset:${email}`);
  await f.db.collection("users").updateOne({ email }, { $set: { isActive: false } });
  const original = await f.db.collection("users").findOne({ email });
  const response = await f.agent.post("/api/auth/password-reset").send(reset(email, code));
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "CODE_INVALID");
  assert.doesNotMatch(response.text, /inactive|deactivated|account/i);
  const user = await f.db.collection("users").findOne({ email });
  assert.equal(user.passwordHash, original.passwordHash);
  assert.equal(user.authVersion, undefined);
});

test("send-code IP limit is shared across purposes and ignores spoofed forwarding with trust disabled", async () => {
  const f = await makeFixture();
  assert.equal(f.app.get("trust proxy"), false);
  for (let i = 0; i < 10; i++) {
    const route = i % 2 ? "register" : "password-reset";
    const response = await f.agent.post(`/api/auth/${route}/send-code`).set("x-forwarded-for", `192.0.2.${i + 1}`).send({ email: `limit-${i}@test.local` });
    assertAccepted(response, [...f.sent.values()]);
    assert.ok(response.headers["ratelimit-limit"] || response.headers.ratelimit);
    assert.equal(response.headers["x-ratelimit-limit"], undefined);
  }
  for (const route of ["register", "password-reset"]) {
    for (const email of ["limit-1@test.local", "unknown@test.local"]) {
      const response = await f.agent.post(`/api/auth/${route}/send-code`).set("x-forwarded-for", "198.51.100.123").send({ email });
      assert.equal(response.status, 429);
      assert.equal(response.body.error.code, "RATE_LIMITED");
      assert.equal(response.body.error.message.includes("sent"), false);
    }
  }
});

test("app rejects unsafe injected proxy trust and accepts only explicit counts or addresses", async () => {
  const f = await makeFixture();
  for (const trustProxy of [true, "true", -1, 1.5, "loopback", "192.0.2.1/33"]) {
    assert.throws(() => createApp({ db: f.db, mailer: f.mailer, config: { ...f.config, trustProxy } }), /TRUST_PROXY/);
  }
  for (const trustProxy of [1, "192.0.2.1", "2001:db8::/64"]) {
    const app = createApp({ db: f.db, mailer: f.mailer, config: { ...f.config, trustProxy } });
    assert.equal(app.get("trust proxy"), trustProxy);
  }
});
