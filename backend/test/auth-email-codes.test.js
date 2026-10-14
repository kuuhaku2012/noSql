import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { createHmac } from "node:crypto";
import { createSmtpMailer } from "../src/services/smtp-mailer.js";
import { createAuthEmailCodeService } from "../src/services/auth-email-codes.js";

const dbName = "maison_belle_test_auth_email_codes";
const collectionPrefix = `task2_otp_${process.pid}_`;
if (process.env.MONGODB_TEST_DB !== dbName) {
  throw new Error(`MONGODB_TEST_DB must be exactly ${dbName}`);
}
let client;
let db;
before(async () => {
  client = new MongoClient("mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const database = client.db(dbName);
  db = { collection: (name, ...args) => database.collection(`${collectionPrefix}${name}`, ...args) };
  await db.collection("auth_email_verifications").drop().catch((error) => {
    if (error.code !== 26) throw error;
  });
  await db.collection("auth_email_verifications").createIndex({ email: 1, purpose: 1 }, { unique: true });
});

const secret = "test-auth-code-secret-that-is-at-least-32-characters";
async function makeFixture({ email, mailer, codeSecret = secret } = {}) {
  let clock = new Date("2026-10-14T00:00:00Z");
  const now = () => new Date(clock);
  const sentCodes = new Map();
  const transport = mailer || { configured: true, sendAuthCode: async ({ email, purpose, code, expiresAt }) => {
    assert.match(code, /^\d{6}$/);
    assert.equal(expiresAt.getTime(), now().getTime() + 10 * 60_000);
    sentCodes.set(`${purpose}:${email}`, code);
  } };
  return { service: createAuthEmailCodeService({ db, mailer: transport, secret: codeSecret, now }), sentCodes, now,
    setNow: (value) => { clock = new Date(value); }, email, mailer: transport };
}
const invalid = (error) => error.status === 400 && /invalid|expired|used|attempt/i.test(error.message) && typeof error.code === "string";
const limited = (error) => error.status === 429 && error.code === "EMAIL_CODE_RATE_LIMITED";
const unconfigured = (error) => error.status === 503 && error.code === "EMAIL_NOT_CONFIGURED";

test("email normalization and HMAC bind the stored challenge to its purpose", async () => {
  const f = await makeFixture({ email: "normalized@test.local" });
  await f.service.sendCode({ email: "  NORMALIZED@Test.Local  ", purpose: "register" });
  const code = f.sentCodes.get("register:normalized@test.local");
  const stored = await db.collection("auth_email_verifications").findOne({ email: f.email, purpose: "register" });
  assert.equal(stored.codeHash, createHmac("sha256", secret).update(`register:${f.email}:${code}`).digest("hex"));
  assert.equal(stored.purgeAt.getTime(), f.now().getTime() + 24 * 60 * 60_000);
  assert.equal(await f.service.consumeCode({ email: " NORMALIZED@test.local ", purpose: "register", code }), true);
  assert.equal((await db.collection("auth_email_verifications").findOne({ email: f.email, purpose: "register" })).attempts, 1);
});

test("a registration code is invalid for password reset", async () => {
  const f = await makeFixture({ email: "wrong-purpose@test.local" });
  await f.service.sendCode({ email: f.email, purpose: "register" });
  const code = f.sentCodes.get(`register:${f.email}`);
  await assert.rejects(f.service.consumeCode({ email: f.email, purpose: "password_reset", code }), invalid);
});

test("expiry is enforced at ten minutes before TTL cleanup", async () => {
  const f = await makeFixture({ email: "expired@test.local" });
  await f.service.sendCode({ email: f.email, purpose: "register" });
  const code = f.sentCodes.get(`register:${f.email}`);
  f.setNow(new Date(f.now().getTime() + 10 * 60_000));
  assert.ok(await db.collection("auth_email_verifications").findOne({ email: f.email, purpose: "register" }));
  await assert.rejects(f.service.consumeCode({ email: f.email, purpose: "register", code }), invalid);
});

test("five wrong guesses block even the correct code", async () => {
  const f = await makeFixture({ email: "attempts@test.local" });
  await f.service.sendCode({ email: f.email, purpose: "register" });
  const code = f.sentCodes.get(`register:${f.email}`);
  const wrong = code === "000000" ? "000001" : "000000";
  for (let i = 0; i < 5; i++) await assert.rejects(f.service.consumeCode({ email: f.email, purpose: "register", code: wrong }), invalid);
  await assert.rejects(f.service.consumeCode({ email: f.email, purpose: "register", code }), invalid);
  assert.equal((await db.collection("auth_email_verifications").findOne({ email: f.email, purpose: "register" })).attempts, 5);
});

test("a correct fifth guess succeeds and counts toward the attempt limit", async () => {
  const f = await makeFixture({ email: "fifth@test.local" });
  await f.service.sendCode({ email: f.email, purpose: "register" });
  const code = f.sentCodes.get(`register:${f.email}`);
  const wrong = code === "000000" ? "000001" : "000000";
  for (let i = 0; i < 4; i++) await assert.rejects(f.service.consumeCode({ email: f.email, purpose: "register", code: wrong }), invalid);
  assert.equal(await f.service.consumeCode({ email: f.email, purpose: "register", code }), true);
  assert.equal((await db.collection("auth_email_verifications").findOne({ email: f.email, purpose: "register" })).attempts, 5);
});

test("concurrent guesses cannot increment attempts past five", async () => {
  const f = await makeFixture({ email: "parallel-guesses@test.local" });
  await f.service.sendCode({ email: f.email, purpose: "register" });
  const code = f.sentCodes.get(`register:${f.email}`);
  const wrong = code === "000000" ? "000001" : "000000";
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => f.service.consumeCode({ email: f.email, purpose: "register", code: wrong })));
  assert.ok(results.every((result) => result.status === "rejected" && invalid(result.reason)));
  assert.equal((await db.collection("auth_email_verifications").findOne({ email: f.email, purpose: "register" })).attempts, 5);
  await assert.rejects(f.service.consumeCode({ email: f.email, purpose: "register", code }), invalid);
});

test("cooldown is shared across purposes and a resend replaces the prior challenge", async () => {
  const f = await makeFixture({ email: "resend@test.local" });
  await f.service.sendCode({ email: f.email, purpose: "register" });
  const old = await db.collection("auth_email_verifications").findOne({ email: f.email, purpose: "register" });
  const oldCode = f.sentCodes.get(`register:${f.email}`);
  const wrongCode = oldCode === "000000" ? "000001" : "000000";
  await assert.rejects(f.service.consumeCode({ email: f.email, purpose: "register", code: wrongCode }), invalid);
  await assert.rejects(f.service.sendCode({ email: f.email, purpose: "register" }), limited);
  await assert.rejects(f.service.sendCode({ email: f.email, purpose: "password_reset" }), limited);
  f.setNow(new Date(f.now().getTime() + 59_999));
  await assert.rejects(f.service.sendCode({ email: f.email, purpose: "register" }), limited);
  f.setNow(new Date(f.now().getTime() + 1));
  await f.service.sendCode({ email: f.email, purpose: "register" });
  const stored = await db.collection("auth_email_verifications").findOne({ email: f.email, purpose: "register" });
  assert.equal(stored.codeExpiresAt.getTime(), f.now().getTime() + 10 * 60_000);
  assert.equal(stored.attempts, 0);
  const current = f.sentCodes.get(`register:${f.email}`);
  // Six-digit codes can collide. Assert old-code rejection when their digests differ.
  if (old.codeHash !== stored.codeHash) {
    await assert.rejects(f.service.consumeCode({ email: f.email, purpose: "register", code: oldCode }), invalid);
  }
  assert.equal(await f.service.consumeCode({ email: f.email, purpose: "register", code: current }), true);
  f.setNow(new Date(f.now().getTime() + 60_000));
  await f.service.sendCode({ email: f.email, purpose: "register" });
  assert.equal(await f.service.consumeCode({ email: f.email, purpose: "register", code: f.sentCodes.get(`register:${f.email}`) }), true);
});

test("the sixth send in one hour is limited across purposes and the window resets", async () => {
  const f = await makeFixture({ email: "hourly@test.local" });
  for (let i = 0; i < 5; i++) {
    await f.service.sendCode({ email: f.email, purpose: i % 2 ? "password_reset" : "register" });
    f.setNow(new Date(f.now().getTime() + 60_000));
  }
  await assert.rejects(f.service.sendCode({ email: f.email, purpose: "register" }), limited);
  f.setNow(new Date("2026-10-14T01:00:00Z"));
  await f.service.sendCode({ email: f.email, purpose: "password_reset" });
});

test("simultaneous first sends reserve exactly one slot", async () => {
  const f = await makeFixture({ email: "parallel-sends@test.local" });
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => f.service.sendCode({ email: f.email, purpose: i % 2 ? "register" : "password_reset" })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok(results.filter((result) => result.status === "rejected").every((result) => limited(result.reason)));
});

test("simultaneous sends at the hourly cap cannot reserve a sixth slot", async () => {
  const f = await makeFixture({ email: "parallel-cap@test.local" });
  for (let i = 0; i < 4; i++) {
    await f.service.sendCode({ email: f.email, purpose: "register" });
    f.setNow(new Date(f.now().getTime() + 60_000));
  }
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => f.service.sendCode({ email: f.email, purpose: "register" })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  f.setNow(new Date(f.now().getTime() + 60_000));
  await assert.rejects(f.service.sendCode({ email: f.email, purpose: "register" }), limited);
});

test("simultaneous correct submissions consume a code exactly once", async () => {
  const f = await makeFixture({ email: "parallel-consume@test.local" });
  await f.service.sendCode({ email: f.email, purpose: "register" });
  const code = f.sentCodes.get(`register:${f.email}`);
  const results = await Promise.allSettled([1, 2].map(() => f.service.consumeCode({ email: f.email, purpose: "register", code })));
  assert.deepEqual(results.filter((result) => result.status === "fulfilled").map((result) => result.value), [true]);
  assert.ok(invalid(results.find((result) => result.status === "rejected").reason));
});

test("a stale sender cannot overwrite a newer challenge after reserving first", async () => {
  const email = "stale-reservation@test.local";
  const sentCodes = new Map();
  const mailer = { configured: true, sendAuthCode: async ({ email, purpose, code }) => sentCodes.set(`${purpose}:${email}`, code) };
  const f = await makeFixture({ email, mailer });
  let reachedChallengeWrite;
  const challengeWriteReached = new Promise((resolve) => { reachedChallengeWrite = resolve; });
  let releaseStaleWrite;
  const staleWriteGate = new Promise((resolve) => { releaseStaleWrite = resolve; });
  let paused = false;
  const fencedDb = {
    collection(name) {
      const collection = db.collection(name);
      if (name !== "auth_email_verifications") return collection;
      return new Proxy(collection, {
        get(target, property) {
          if (property === "updateOne") return async (filter, ...args) => {
            if (!paused && filter?._id === `challenge:register:${email}`) {
              paused = true;
              reachedChallengeWrite();
              await staleWriteGate;
            }
            return target.updateOne(filter, ...args);
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
  };
  const first = createAuthEmailCodeService({ db: fencedDb, mailer, secret, now: f.now });
  const second = createAuthEmailCodeService({ db, mailer, secret, now: f.now });
  const firstSend = first.sendCode({ email, purpose: "register" });
  await challengeWriteReached;
  f.setNow(new Date(f.now().getTime() + 60_000));
  await second.sendCode({ email, purpose: "register" });
  const secondCode = sentCodes.get(`register:${email}`);
  releaseStaleWrite();
  await assert.rejects(firstSend, (error) => error.code === "EMAIL_CODE_SUPERSEDED");
  const stored = await db.collection("auth_email_verifications").findOne({ email, purpose: "register" });
  assert.equal(stored.issuanceGeneration, 2);
  assert.equal(stored.codeHash, createHmac("sha256", secret).update(`register:${email}:${secondCode}`).digest("hex"));
  assert.equal(await second.consumeCode({ email, purpose: "register", code: secondCode }), true);
});

test("failed delivery cannot leave an older code consumable while a newer sender is paused", async () => {
  const email = "stale-delivery-failure@test.local";
  let olderCode;
  let releaseOlderDelivery;
  let enteredOlderDelivery;
  const olderDeliveryEntered = new Promise((resolve) => { enteredOlderDelivery = resolve; });
  const olderDeliveryGate = new Promise((resolve) => { releaseOlderDelivery = resolve; });
  const olderMailer = { configured: true, sendAuthCode: async ({ code }) => {
    olderCode = code;
    enteredOlderDelivery();
    await olderDeliveryGate;
    throw new Error("fake older delivery failure");
  } };
  let newerCode;
  const newerMailer = { configured: true, sendAuthCode: async ({ code }) => { newerCode = code; } };
  const f = await makeFixture({ email, mailer: olderMailer });

  let releaseNewerReplacement;
  let enteredNewerReplacement;
  const newerReplacementReached = new Promise((resolve) => { enteredNewerReplacement = resolve; });
  const newerReplacementGate = new Promise((resolve) => { releaseNewerReplacement = resolve; });
  const challengeId = `challenge:register:${email}`;
  let pausedNewerReplacement = false;
  const pausedDb = {
    collection(name) {
      const collection = db.collection(name);
      if (name !== "auth_email_verifications") return collection;
      return new Proxy(collection, {
        get(target, property) {
          if (property === "updateOne") return async (filter, update, ...args) => {
            if (!pausedNewerReplacement && filter?._id === challengeId && update?.$set?.codeHash) {
              pausedNewerReplacement = true;
              enteredNewerReplacement();
              await newerReplacementGate;
            }
            return target.updateOne(filter, update, ...args);
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
  };
  const newer = createAuthEmailCodeService({ db: pausedDb, mailer: newerMailer, secret, now: f.now });
  const olderSend = f.service.sendCode({ email, purpose: "register" });
  let newerSend;

  try {
    await olderDeliveryEntered;
    f.setNow(new Date(f.now().getTime() + 60_000));
    newerSend = newer.sendCode({ email, purpose: "register" });
    await newerReplacementReached;
    assert.equal((await db.collection("auth_email_verifications").findOne({ _id: `send-window:${email}` })).issuanceGenerations.register, 2);

    releaseOlderDelivery();
    await assert.rejects(olderSend, (error) => error.code === "EMAIL_DELIVERY_FAILED");
    await assert.rejects(f.service.consumeCode({ email, purpose: "register", code: olderCode }), invalid);

    releaseNewerReplacement();
    await newerSend;
    assert.equal(await newer.consumeCode({ email, purpose: "register", code: newerCode }), true);
  } finally {
    releaseOlderDelivery();
    releaseNewerReplacement();
    await Promise.allSettled([olderSend, newerSend].filter(Boolean));
  }
});

test("failed mail delivery expires its challenge and retains the cooldown", async () => {
  let code;
  const f = await makeFixture({ email: "mail-failure@test.local", mailer: { configured: true, sendAuthCode: async (message) => {
    code = message.code;
    throw new Error("fake delivery failure");
  } } });
  await assert.rejects(f.service.sendCode({ email: f.email, purpose: "register" }));
  const stored = await db.collection("auth_email_verifications").findOne({ email: f.email, purpose: "register" });
  assert.ok(stored.codeExpiresAt <= f.now());
  await assert.rejects(f.service.consumeCode({ email: f.email, purpose: "register", code }), invalid);
  await assert.rejects(f.service.sendCode({ email: f.email, purpose: "register" }), limited);
});

test("secrets shorter than 32 characters fail closed before storing any code", async () => {
  for (const [i, codeSecret] of [undefined, "", "x".repeat(31), 123].entries()) {
    const f = await makeFixture({ email: `secret-${i}@test.local`, codeSecret: codeSecret === undefined ? null : codeSecret });
    assert.throws(() => f.service.assertSecretConfigured(), unconfigured);
    assert.throws(() => f.service.assertSendConfigured(), unconfigured);
    await assert.rejects(f.service.sendCode({ email: f.email, purpose: "register" }), unconfigured);
    await assert.rejects(f.service.consumeCode({ email: f.email, purpose: "register", code: "123456" }), unconfigured);
    assert.equal(await db.collection("auth_email_verifications").countDocuments({ email: f.email }), 0);
  }
});

test("SMTP readiness gates sending but does not prevent consuming an issued code", async () => {
  const sentCodes = new Map();
  const mailer = { configured: true, sendAuthCode: async ({ email, purpose, code }) => sentCodes.set(`${purpose}:${email}`, code) };
  const f = await makeFixture({ email: "smtp-down@test.local", codeSecret: "x".repeat(32), mailer });
  f.service.assertSecretConfigured();
  f.service.assertSendConfigured();
  await f.service.sendCode({ email: f.email, purpose: "register" });
  mailer.configured = false;
  assert.throws(() => f.service.assertSendConfigured(), unconfigured);
  await assert.rejects(f.service.sendCode({ email: "smtp-unconfigured@test.local", purpose: "register" }), unconfigured);
  assert.equal(await f.service.consumeCode({ email: f.email, purpose: "register", code: sentCodes.get(`register:${f.email}`) }), true);
});

test("malformed stored digests and submitted guesses yield typed errors", async () => {
  const f = await makeFixture({ email: "malformed@test.local" });
  await f.service.sendCode({ email: f.email, purpose: "register" });
  const code = f.sentCodes.get(`register:${f.email}`);
  await db.collection("auth_email_verifications").updateOne({ email: f.email, purpose: "register" }, { $set: { codeHash: "ab" } });
  await assert.rejects(f.service.consumeCode({ email: f.email, purpose: "register", code }), invalid);
  await assert.rejects(f.service.consumeCode({ email: f.email, purpose: "register", code: null }), invalid);
  assert.equal((await db.collection("auth_email_verifications").findOne({ email: f.email, purpose: "register" })).attempts, 2);
});

test("unsupported purposes cannot issue or consume challenges", async () => {
  const f = await makeFixture({ email: "invalid-purpose@test.local" });
  await assert.rejects(f.service.sendCode({ email: f.email, purpose: "login" }), (error) => error.status === 400);
  await assert.rejects(f.service.consumeCode({ email: f.email, purpose: "login", code: "123456" }), (error) => error.status === 400);
  assert.equal(await db.collection("auth_email_verifications").countDocuments({ email: f.email }), 0);
});

test("the service supplies the recipient expected by the committed Task 1 mailer", async () => {
  const messages = [];
  const mailer = createSmtpMailer({ smtpHost: "mail.test", smtpPort: 587, smtpFrom: "shop@test.local", smtpUser: "fake-user", smtpPass: "fake-password" }, {
    createTransport: () => ({ sendMail: async (message) => messages.push(message) })
  });
  const f = await makeFixture({ email: "task-one@test.local", mailer });
  await f.service.sendCode({ email: f.email, purpose: "password_reset" });
  assert.equal(messages[0].to, f.email);
  assert.match(messages[0].subject, /reset/i);
});
after(async () => {
  try {
    if (db) await db.collection("auth_email_verifications").drop();
  } finally {
    await client?.close();
  }
});

test("a code is stored only as a keyed digest and can be consumed once", async () => {
  let sentCode;
  const service = createAuthEmailCodeService({ db, secret: "test-auth-code-secret-that-is-at-least-32-characters", now: () => new Date("2026-10-14T00:00:00Z"),
    mailer: { configured: true, sendAuthCode: async ({ code }) => { sentCode = code; } }
  });
  const sent = await service.sendCode({ email: "mai@test.local", purpose: "register" });
  assert.deepEqual(sent, { expiresAt: new Date("2026-10-14T00:10:00Z") });
  assert.match(sentCode, /^\d{6}$/);
  const stored = await db.collection("auth_email_verifications").findOne({ email: "mai@test.local", purpose: "register" });
  assert.equal(stored.code, undefined);
  assert.notEqual(stored.codeHash, sentCode);
  assert.equal(JSON.stringify(stored).includes(sentCode), false);
  const result = await service.consumeCode({ email: "mai@test.local", purpose: "register", code: sentCode });
  assert.equal(result, true);
  assert.equal(JSON.stringify(result).includes(sentCode), false);
  await assert.rejects(service.consumeCode({ email: "mai@test.local", purpose: "register", code: sentCode }), /used|invalid/i);
});
