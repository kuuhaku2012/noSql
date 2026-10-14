# Email Verification and Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Require an emailed one-time code before customer registration and let existing users reset passwords securely through SMTP.

**Architecture:** Add an injectable SMTP mailer and a Mongo-backed email-code service; connect both to the existing Express auth router. Keep the current cookie session model while adding a version claim so password reset invalidates older sessions. The account page calls the auth APIs and never stores codes or passwords in browser storage.

**Tech Stack:** Node.js 20+, Express 5, MongoDB Node driver, Nodemailer, express-rate-limit, dotenv, bcryptjs, JWT, vanilla JavaScript, Node test runner, Supertest.

**Spec:** `docs/superpowers/specs/2026-10-14-email-verification-password-reset-chatbot-design.md` (sections 1–3 and Migration and bảo toàn dữ liệu)

The user-selected anti-enumeration behavior for reset-send runtime mail failures is recorded in the spec and must be retained: public response is the generic `202`; the code is invalidated and delivery is not claimed.

## Global Constraints

- Email gửi qua SMTP được cấu hình bằng biến môi trường; không lưu thông tin đăng nhập SMTP trong mã nguồn.
- Thiếu cấu hình SMTP/secret thì API trả lỗi cấu hình rõ ràng; riêng lỗi SMTP tạm thời trong luồng quên mật khẩu phải nhận cùng phản hồi `202` chung, không tuyên bố email đã gửi.
- OTP chỉ lưu dạng hash, có hạn sử dụng, giới hạn lượt nhập và giới hạn gửi lại; không ghi OTP vào log hoặc trả về trình duyệt.
- Migration và index chỉ bổ sung; không xóa hoặc viết lại dữ liệu hiện có. Tài khoản cũ tiếp tục đăng nhập bình thường.
- Không giữ mật khẩu hoặc mã xác minh trong `localStorage`/`sessionStorage`.
- Mã sáu chữ số hết hạn sau 10 phút; tối đa 5 lần nhập; chờ tối thiểu 60 giây giữa các lần gửi và giới hạn 5 lần gửi mỗi email trong một giờ.
- Giới hạn các endpoint gửi mã ở mức 10 yêu cầu mỗi IP trong 15 phút.
- Không gửi SMTP thật trong CI/test; thông tin SMTP thật sẽ được cấu hình riêng ngoài repository.

---

## File Map

- `backend/test/config.test.js`: verifies SMTP parsing, independent secrets, port validation and explicit proxy trust.
- `backend/src/config.js`: đọc SMTP, `AUTH_CODE_SECRET` và cấu hình trust proxy an toàn từ môi trường.
- `backend/src/services/smtp-mailer.js`: transport SMTP và mẫu thư xác minh/đặt lại mật khẩu.
- `backend/src/services/auth-email-codes.js`: phát hành, giới hạn, HMAC, xác minh và tiêu thụ OTP trong MongoDB.
- `backend/src/collections.js`, `backend/scripts/create-indexes.js`: đăng ký collection OTP và index compound/TTL bổ sung.
- `backend/src/app.js`, `backend/src/routes/auth.js`: inject mailer/code service và cung cấp các endpoint auth.
- `backend/src/server.js`: load `.env` trước khi đọc cấu hình backend.
- `backend/src/middleware/auth.js`: phát hành và kiểm tra phiên bản JWT.
- `backend/test/config.test.js`: verifies SMTP parsing, secret separation, port validation and explicit proxy trust.
- `backend/test/auth-email-verification.test.js`, `backend/test/auth-email-codes.test.js`, `backend/test/smtp-mailer.test.js`: test Mongo/API và test transport SMTP giả.
- `backend/package.json`, `backend/pnpm-lock.yaml`, `backend/.env.example`: dependency và cấu hình mẫu không có secret.
- `js/api.js`: client wrapper cho ba endpoint mã xác minh/đặt lại mật khẩu.
- `js/storefront.js`, `js/app.js`, `js/storefront-layout.test.js`, `js/api.test.js`, `js/app.test.js`, `css/flows.css`: kiểm tra email, trạng thái gửi OTP, form đăng ký và form đặt lại mật khẩu.

## Task 1: SMTP mailer và cấu hình môi trường

**Files:**
- Create: `backend/src/services/smtp-mailer.js`
- Create: `backend/test/smtp-mailer.test.js`
- Create: `backend/test/config.test.js`
- Modify: `backend/src/config.js`
- Modify: `backend/src/server.js`
- Modify: `backend/package.json`
- Modify: `backend/pnpm-lock.yaml`
- Modify: `backend/.env.example`

**Interfaces:**
- Produces `createSmtpMailer(config, { createTransport })`, returning `{ configured, sendAuthCode({ to, purpose, code }) }`.
- `sendAuthCode` resolves after SMTP accepts the message; if SMTP is unconfigured it rejects with `HttpError(503, "EMAIL_NOT_CONFIGURED", ...)`.
- Test transport is injected as `createTransport(options)` and exposes `sendMail(message)`.

- [x] **Step 1: Add the SMTP adapter dependencies and environment names**

Run in `backend/`:

```powershell
pnpm add nodemailer express-rate-limit dotenv
```

Add `smtpHost`, `smtpPort`, `smtpSecure`, `smtpUser`, `smtpPass`, `smtpFrom`, `authCodeSecret`, and optional `trustProxy` to `getConfig()`. Parse `SMTP_SECURE` only when its value is exactly `"true"`; reject invalid ports. Keep proxy trust disabled unless a valid explicit hop count/IP is supplied; reject the unsafe blanket value `true`. Import `dotenv/config` in `server.js` before reading config so the documented `.env` setup works while externally supplied environment variables keep precedence. Add the SMTP and secret names to `.env.example` with empty values and documentation; document optional `TRUST_PROXY` only for a known reverse-proxy deployment. Do not read or copy local `.env` secrets. Read `AUTH_CODE_SECRET` as optional config but fail closed at the email-code boundary unless it is at least 32 characters; never fall back to `JWT_SECRET` or a hard-coded secret so the store can still start without email configured.

- [x] **Step 2: Write failing config and mailer tests**

Create `backend/test/config.test.js` and `backend/test/smtp-mailer.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { getConfig } from "../src/config.js";

test("getConfig parses SMTP settings and keeps the code secret independent", () => {
  const config = getConfig({ SMTP_HOST: "mail.test", SMTP_PORT: "587", SMTP_SECURE: "true", SMTP_USER: "user", SMTP_PASS: "pass", SMTP_FROM: "shop@test", AUTH_CODE_SECRET: "a".repeat(32), JWT_SECRET: "jwt-secret", TRUST_PROXY: "1" });
  assert.equal(config.smtpPort, 587);
  assert.equal(config.smtpSecure, true);
  assert.equal(config.authCodeSecret, "a".repeat(32));
  assert.notEqual(config.authCodeSecret, config.jwtSecret);
  assert.equal(config.trustProxy, 1);
  assert.equal(getConfig({}).trustProxy, false);
  assert.equal(getConfig({ SMTP_SECURE: "1" }).smtpSecure, false);
  assert.throws(() => getConfig({ SMTP_PORT: "not-a-port" }), /SMTP_PORT/);
  assert.throws(() => getConfig({ TRUST_PROXY: "true" }), /TRUST_PROXY/);
});
```

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createSmtpMailer } from "../src/services/smtp-mailer.js";

test("mailer sends a registration code through the injected transport", async () => {
  const messages = [];
  const mailer = createSmtpMailer({ smtpHost: "mail.test", smtpPort: 587, smtpFrom: "shop@test", smtpUser: "test-user", smtpPass: "test-password" }, {
    createTransport: (options) => ({ sendMail: async (message) => messages.push({ options, message }) })
  });
  await mailer.sendAuthCode({ to: "mai@test.local", purpose: "register", code: "123456" });
  assert.equal(messages[0].message.to, "mai@test.local");
  assert.match(messages[0].message.text, /123456/);
});

test("unconfigured SMTP refuses to claim a code was sent", async () => {
  const mailer = createSmtpMailer({}, { createTransport: () => { throw new Error("must not create transport"); } });
  assert.equal(mailer.configured, false);
  await assert.rejects(mailer.sendAuthCode({ to: "mai@test.local", purpose: "register", code: "123456" }),
    (error) => error.status === 503 && error.code === "EMAIL_NOT_CONFIGURED");
});

test("SMTP transport errors become sanitized retryable errors", async () => {
  const mailer = createSmtpMailer({ smtpHost: "mail.test", smtpPort: 587, smtpFrom: "shop@test", smtpUser: "u", smtpPass: "p" }, {
    createTransport: () => ({ sendMail: async () => { throw new Error("provider details must not escape"); } })
  });
  await assert.rejects(mailer.sendAuthCode({ to: "mai@test.local", purpose: "register", code: "123456" }),
    (error) => error.status === 503 && error.code === "EMAIL_DELIVERY_FAILED" && !error.message.includes("provider details"));
});
```

- [x] **Step 3: Run the mailer test and confirm it fails because the adapter is absent**

Run: `node --test test/config.test.js test/smtp-mailer.test.js` from `backend/`.
Expected: config assertions fail because the new settings are absent, and the mailer test fails because `smtp-mailer.js` is absent; no SMTP network request should occur.

- [x] **Step 4: Implement the SMTP adapter**

Create a transport only when host, port, sender, and authentication configuration are valid. Keep the injected transport interface and encode the code as text and escaped HTML:

```js
export function createSmtpMailer(config, { createTransport = nodemailer.createTransport } = {}) {
  const configured = Boolean(config.smtpHost && config.smtpPort && config.smtpFrom && config.smtpUser && config.smtpPass);
  const transport = configured ? createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: { user: config.smtpUser, pass: config.smtpPass }
  }) : null;
  return {
    configured,
    async sendAuthCode({ to, purpose, code }) {
      if (!transport) throw new HttpError(503, "EMAIL_NOT_CONFIGURED", "Email delivery is not configured");
      try {
        await transport.sendMail({ from: config.smtpFrom, to, subject: subjectFor(purpose), text: textFor(purpose, code), html: htmlFor(purpose, code) });
      } catch {
        throw new HttpError(503, "EMAIL_DELIVERY_FAILED", "Email could not be sent. Please try again later.");
      }
    }
  };
}
```

Define `subjectFor`, `textFor`, and `htmlFor` in the same module; restrict `purpose` to `register` or `password_reset`, escape dynamic content, and never log the message or code.

- [x] **Step 5: Run the mailer test and verify both configured and missing-SMTP cases pass**

Run: `node --test test/config.test.js test/smtp-mailer.test.js` from `backend/`.
Expected: all config and mailer tests PASS; no SMTP network connection is attempted.

- [x] **Step 6: Commit the mailer boundary**

```powershell
git add backend/src/config.js backend/src/server.js backend/src/services/smtp-mailer.js backend/test/config.test.js backend/test/smtp-mailer.test.js backend/package.json backend/pnpm-lock.yaml backend/.env.example
git commit -m "feat: add configurable SMTP mailer"
```

## Task 2: Mongo OTP storage, throttling and one-time consumption

**Files:**
- Create: `backend/src/services/auth-email-codes.js`
- Create: `backend/test/auth-email-codes.test.js`
- Modify: `backend/src/collections.js`
- Modify: `backend/scripts/create-indexes.js`
- Modify: `backend/test/seed-safety.test.js`

**Interfaces:**
- Consumes the mailer interface from Task 1.
- Produces `createAuthEmailCodeService({ db, mailer, secret, now })` with `assertSendConfigured()`, `assertSecretConfigured()`, `sendCode({ email, purpose })` and `consumeCode({ email, purpose, code })`.
- `purpose` is exactly `register` or `password_reset`; `sendCode` returns `{ expiresAt }`, never the raw code.
- `consumeCode` returns `true` once and throws typed 400 errors for invalid, expired, used, or over-attempt codes; send-window limits use `429 EMAIL_CODE_RATE_LIMITED`.

- [x] **Step 1: Write an isolated Mongo test for send, verify and single use**

Create `backend/test/auth-email-codes.test.js` using the existing `MongoClient` pattern. Set `MONGODB_TEST_DB=maison_belle_test_auth_email_codes` before running; this test database may be dropped by its fixture. Inject a mailer that captures the code only in test memory. Use a secret at least 32 characters long even in tests:

```js
test("a code is stored only as a keyed digest and can be consumed once", async () => {
  let sentCode;
  const service = createAuthEmailCodeService({ db, secret: "test-auth-code-secret-that-is-at-least-32-characters", now: () => new Date("2026-10-14T00:00:00Z"),
    mailer: { configured: true, sendAuthCode: async ({ code }) => { sentCode = code; } }
  });
  await service.sendCode({ email: "mai@test.local", purpose: "register" });
  const stored = await db.collection("auth_email_verifications").findOne({ email: "mai@test.local", purpose: "register" });
  assert.equal(stored.code, undefined);
  assert.notEqual(stored.codeHash, sentCode);
  assert.equal(JSON.stringify(stored).includes(sentCode), false);
  const result = await service.consumeCode({ email: "mai@test.local", purpose: "register", code: sentCode });
  assert.equal(JSON.stringify(result).includes(sentCode), false);
  await assert.rejects(service.consumeCode({ email: "mai@test.local", purpose: "register", code: sentCode }), /used|invalid/i);
});
```

- [x] **Step 2: Run the isolated service test to confirm it fails before implementation**

Run from `backend/` against local MongoDB only. Three suites enforce distinct test-database names, so run them in separate Node processes and exclude them from the general group:

```powershell
$env:MONGODB_TEST_DB = 'maison_belle_test_auth_email_codes'
node --test test/auth-email-codes.test.js
```

Expected: FAIL because the service module/collection is not implemented; it must connect only to the named test database.

- [x] **Step 3: Add the collection and repeatable additive indexes**

Expose `authEmailVerifications: db.collection("auth_email_verifications")` from `collections(db)`. Add indexes in `createIndexes(db)`:

```js
await add(c.authEmailVerifications, { email: 1, purpose: 1 }, { unique: true });
await add(c.authEmailVerifications, { purgeAt: 1 }, { expireAfterSeconds: 0 });
```

Do not add a migration that edits or deletes existing user documents. Extend `seed-safety.test.js` to assert its existing double `createIndexes(db)` call creates the unique email/purpose and TTL indexes without changing legacy user documents or their counts.

- [x] **Step 4: Implement the OTP service with HMAC, limits and atomic consumption**

Generate six-digit codes with `crypto.randomInt`, normalize email, compute an HMAC-SHA256 using `secret`, compare equal-length digest buffers using `crypto.timingSafeEqual`, and persist only the digest. `assertSecretConfigured()` must fail closed unless the separate code secret is at least 32 characters. `assertSendConfigured()` checks both the code secret and SMTP readiness and throws the same `503 EMAIL_NOT_CONFIGURED`; call it before account lookup in either send route and inside `sendCode()`. `consumeCode()` requires the code secret but not a currently available SMTP transport. Use `codeExpiresAt` at 10 minutes, `purgeAt` at 24 hours, five guesses, 60-second resend cooldown and five sends per one-hour email window. Atomically reserve the per-email send window before issuing a code; concurrent sends must not exceed the cooldown/hourly cap. Enforce the separate per-IP limit with route middleware, not in this collection. Invalidate the prior code when issuing a new one. If mail delivery fails, immediately expire the newly issued code while retaining the rate-limit record.

```js
const codeHash = createHmac("sha256", secret).update(`${purpose}:${email}:${code}`).digest("hex");
const expected = Buffer.from(codeHash, "hex");
const actual = Buffer.from(storedHash, "hex");
if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
  await incrementFailedAttempt(email, purpose, now());
  throw invalidCodeError();
}
```

Count every submitted guess with an atomic conditional update that refuses further attempts at five; a correct guess must also be blocked once the limit is reached. Consume only with a conditional update matching `{ email, purpose, codeHash, usedAt: { $exists: false }, codeExpiresAt: { $gt: now }, attempts: { $lt: 5 } }`; reject when `modifiedCount !== 1` so simultaneous submissions cannot reuse a code. Before comparing, decode both digests and check decoded buffer lengths, then call `timingSafeEqual`.

- [x] **Step 5: Add expiry, wrong-purpose, attempt-limit, resend and mail-failure tests**

Use an isolated fixture helper that returns `{ service, sentCodes, now, setNow }`. The fake mailer captures each OTP in a test-only `Map` keyed by `purpose:email`; every scenario uses a fresh email and reads its own captured code. Use the injected `now()` to advance time without sleeping. Cover these concrete assertions:

```js
const wrongPurposeFixture = await makeFixture({ email: "wrong-purpose@test.local" });
await wrongPurposeFixture.service.sendCode({ email: "wrong-purpose@test.local", purpose: "register" });
const purposeCode = wrongPurposeFixture.sentCodes.get("register:wrong-purpose@test.local");
await assert.rejects(wrongPurposeFixture.service.consumeCode({ email: "wrong-purpose@test.local", purpose: "password_reset", code: purposeCode }), /invalid/i);

const expiryFixture = await makeFixture({ email: "expired@test.local" });
await expiryFixture.service.sendCode({ email: "expired@test.local", purpose: "register" });
const expiredCode = expiryFixture.sentCodes.get("register:expired@test.local");
expiryFixture.setNow(new Date(expiryFixture.now().getTime() + 10 * 60_000));
await assert.rejects(expiryFixture.service.consumeCode({ email: "expired@test.local", purpose: "register", code: expiredCode }), /expired|invalid/i);

const attemptFixture = await makeFixture({ email: "attempts@test.local" });
await attemptFixture.service.sendCode({ email: "attempts@test.local", purpose: "register" });
const attemptCode = attemptFixture.sentCodes.get("register:attempts@test.local");
const wrongCode = attemptCode === "000000" ? "000001" : "000000";
for (let attempt = 0; attempt < 5; attempt++) {
  await assert.rejects(attemptFixture.service.consumeCode({ email: "attempts@test.local", purpose: "register", code: wrongCode }), /invalid/i);
}
await assert.rejects(attemptFixture.service.consumeCode({ email: "attempts@test.local", purpose: "register", code: attemptCode }), /attempt|invalid/i);
```

Also test with separate fixture emails that an immediate resend and the sixth send inside one hour return `429`, while advancing beyond the respective window allows a send. Run two simultaneous correct `consumeCode` calls and assert exactly one succeeds. Verify an expired record cannot be consumed even if Mongo TTL has not removed it yet. Force the fake mailer to reject, then verify the challenge cannot be consumed and the rate-limit record still prevents immediate retries.

- [x] **Step 6: Run isolated OTP tests and migration tests**

Run `node --test test/auth-email-codes.test.js test/seed-safety.test.js` from `backend/` with `MONGODB_TEST_DB=maison_belle_test_auth_email_codes`.
Expected: OTP and additive-index tests PASS; the fixture does not connect to `maison_belle_dev`.

- [x] **Step 7: Commit the OTP storage boundary**

```powershell
git add backend/src/services/auth-email-codes.js backend/src/collections.js backend/scripts/create-indexes.js backend/test/auth-email-codes.test.js backend/test/seed-safety.test.js
git commit -m "feat: add expiring email verification codes"
```

## Task 3: Registration and password-reset APIs

**Files:**
- Modify: `backend/src/app.js`
- Modify: `backend/src/routes/auth.js`
- Create: `backend/test/auth-email-verification.test.js`
- Modify: `backend/test/auth-products.test.js`

**Interfaces:**
- `POST /api/auth/register/send-code` accepts `{ email }` and returns `202 { data: { accepted: true, resendAfterSeconds: 60 } }` after successful delivery.
- `POST /api/auth/register` requires `{ email, fullName, phone?, password, skinType?, verificationCode }`.
- `POST /api/auth/password-reset/send-code` accepts `{ email }` and always returns the same exact `202 { data: { accepted: true, resendAfterSeconds: 60 } }` for an unknown account, email-window throttle or runtime SMTP send failure; this confirms request receipt, not successful delivery. Missing SMTP/OTP-secret configuration returns `503 EMAIL_NOT_CONFIGURED` before account lookup for every email.
- `POST /api/auth/password-reset` accepts `{ email, verificationCode, newPassword }`, changes the hash and returns `204`.

- [x] **Step 1: Add failing API tests with a captured fake-mailer code**

Build an isolated `auth-email-verification.test.js` fixture with the existing test app pattern and `createApp({ db, config, mailer })`. Use a dedicated `maison_belle_test_auth_flow` database and fake mailer with a `Map` keyed by `purpose:email`. Test invalid email, registration without a code, wrong-purpose and reused codes, successful registration only after send-code, duplicate email, `emailVerifiedAt`, and matching reset-send status/body for unknown versus active accounts on normal send, email throttle, and fake SMTP failure. Also assert neither response contains the OTP or SMTP details, missing configuration returns the same `503 EMAIL_NOT_CONFIGURED` for both email cases before user lookup, and a failed fake send leaves the code unusable.

```js
const response = await agent.post("/api/auth/register/send-code").send({ email: "new@test.local" });
assert.equal(response.status, 202);
const code = sent.get("register:new@test.local");
const registered = await agent.post("/api/auth/register").send({ email: "new@test.local", fullName: "New Customer", password: "Secret@123", verificationCode: code });
assert.equal(registered.status, 201);
```

- [x] **Step 2: Run the isolated API test and confirm the current direct-registration contract fails it**

Run from `backend/` with `MONGODB_TEST_DB=maison_belle_test_auth_flow`:

```powershell
$env:MONGODB_TEST_DB = 'maison_belle_test_auth_flow'
node --test test/auth-email-verification.test.js
```

Expected: FAIL because the new send-code and reset endpoints do not exist yet.

- [x] **Step 3: Inject mailer and code service into the app and auth router**

Change the factory signature to accept `mailer: injectedMailer`; create production defaults only when the DB-backed auth routes are mounted, while allowing a fake mailer/config in tests:

```js
export function createApp({ db = null, config = getConfig(), mailer: injectedMailer } = {}) {
  // existing middleware setup...
  if (db) {
    const mailer = injectedMailer || createSmtpMailer(config);
    const authEmailCodes = createAuthEmailCodeService({ db, mailer, secret: config.authCodeSecret });
    api.use("/auth", authRouter({ db, config, authEmailCodes }));
  }
}
```

Add a shared `express-rate-limit` middleware to the two send-code routes: 10 requests per IP per 15 minutes, standard headers on, legacy headers off, JSON `429 RATE_LIMITED` response. Call `authEmailCodes.assertSendConfigured()` before any user query. In the reset-send route, translate email-window throttling and runtime `EMAIL_DELIVERY_FAILED` to the same generic accepted status/body and suppress delivery. Do not catch configuration errors: return `503 EMAIL_NOT_CONFIGURED` uniformly before looking up the email. The IP limiter still returns `429` equally for every email. Set `app.set("trust proxy", config.trustProxy || false)` only after validating the explicit setting; test that a spoofed `X-Forwarded-For` cannot change the client IP when proxy trust is disabled.

- [x] **Step 4: Implement both send-code endpoints and make registration require a verified code**

Validate email syntax server-side after trim/lowercase. Registration send-code rejects an already-registered email with `409 DUPLICATE_USER`. Forgot-password send-code checks SMTP and secret readiness before checking the account, sends only for an active account, and always returns the exact same generic `202` status/body for unknown accounts, per-email throttling and runtime SMTP delivery failure. The response says only that the request was received, not that an email was sent. If delivery fails, invalidate the code and do not expose SMTP details; the customer can retry after the cooldown. Missing configuration returns `503 EMAIL_NOT_CONFIGURED` uniformly before account lookup. The IP limiter is shared and independent of account existence; the code service enforces per-email windows atomically while the route middleware enforces per-IP limits. Never place the code in an API response.

Implement the route flow with injected dependencies (keep the existing router style and response helpers):

```js
function normalizedEmail(body) {
  validateBody({ email: { required: true, type: "string", maxLength: 254 } }, body);
  const email = body.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, "VALIDATION_ERROR", "email is invalid");
  return email;
}

function validateVerificationCode(code) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw new HttpError(400, "VALIDATION_ERROR", "verificationCode must be six digits");
}

function validatePasswordResetBody(body) {
  validateBody({ email: { required: true, type: "string", maxLength: 254 }, verificationCode: { required: true, type: "string", maxLength: 6 }, newPassword: { required: true, type: "string", maxLength: 200 } }, body);
  const email = normalizedEmail(body);
  validateVerificationCode(body.verificationCode);
  if (body.newPassword.length < 6) throw new HttpError(400, "VALIDATION_ERROR", "newPassword must be at least 6 characters");
  return { email, verificationCode: body.verificationCode, newPassword: body.newPassword };
}

router.post("/register/send-code", sendCodeIpLimiter, async (req, res) => {
  const email = normalizedEmail(req.body);
  authEmailCodes.assertSendConfigured();
  if (await users.findOne({ email })) throw duplicateUserError();
  await authEmailCodes.sendCode({ email, purpose: "register" });
  res.status(202).json({ data: { accepted: true, resendAfterSeconds: 60 } });
});

router.post("/password-reset/send-code", sendCodeIpLimiter, async (req, res) => {
  const email = normalizedEmail(req.body);
  authEmailCodes.assertSendConfigured(); // Uniform setup check before account lookup.
  const user = await users.findOne({ email, isActive: true });
  if (user) {
    try {
      await authEmailCodes.sendCode({ email, purpose: "password_reset" });
    } catch (error) {
      if (!new Set(["EMAIL_CODE_RATE_LIMITED", "EMAIL_DELIVERY_FAILED"]).has(error.code)) throw error;
      // Both throttling and transient delivery failure intentionally have the same public response.
    }
  }
  res.status(202).json({ data: { accepted: true, resendAfterSeconds: 60 } });
});

router.post("/register", async (req, res) => {
  validateBody({ email: { required: true, type: "string", maxLength: 254 }, fullName: { required: true, type: "string", maxLength: 160 }, phone: { type: "string", maxLength: 30 }, password: { required: true, type: "string", maxLength: 200 }, skinType: { type: "string", maxLength: 60 }, verificationCode: { required: true, type: "string", maxLength: 6 } }, req.body);
  const email = normalizedEmail(req.body);
  validateVerificationCode(req.body.verificationCode);
  const fullName = req.body.fullName.trim();
  const phone = req.body.phone?.trim() || "";
  if (await users.findOne({ $or: [{ email }, ...(phone ? [{ phone }] : [])] })) throw new HttpError(409, "DUPLICATE_USER", "Email or phone already exists");
  authEmailCodes.assertSecretConfigured();
  await authEmailCodes.consumeCode({ email, purpose: "register", code: req.body.verificationCode });
  // Keep the existing insert, fixed customer role, safe response and cookie behavior.
});
```

In `/register`, set `emailVerifiedAt: now`; preserve the fixed customer role and current safe response/cookie behavior. If the unique-index race still finds a duplicate after code consumption, return `409 DUPLICATE_USER`; the customer can request another code as specified.

- [x] **Step 5: Implement reset endpoint and fake-mailer coverage**

In `/password-reset`, validate email, six-digit code, and new password length (6–200); validate confirmation in the browser. Consume purpose `password_reset`, hash with bcrypt, update only the matching active user and increment `authVersion` atomically. Return 204; never return hashes, codes, or SMTP metadata. Keep reset-send response status/body identical for unknown/active accounts, email-window throttling and runtime SMTP failure; test all cases and confirm no email is sent to an unknown address. Update existing registration tests to request a code through the injected fake mailer before registering.

```js
router.post("/password-reset", async (req, res) => {
  const { email, verificationCode, newPassword } = validatePasswordResetBody(req.body);
  const passwordHash = await bcrypt.hash(newPassword, 10);
  authEmailCodes.assertSecretConfigured();
  await authEmailCodes.consumeCode({ email, purpose: "password_reset", code: verificationCode });
  const result = await users.updateOne(
    { email, isActive: true },
    { $set: { passwordHash, updatedAt: new Date() }, $inc: { authVersion: 1 } }
  );
  if (result.matchedCount !== 1) throw new HttpError(400, "CODE_INVALID", "The reset code is invalid or expired");
  res.status(204).end();
});
```

Ensure the service has an atomic claim/consume operation and the user update is guarded by the active-user predicate. Hash the new password before consuming the code so a local hash failure does not burn the OTP. If the account is deactivated between send and reset, do not change its password or disclose account state.

- [x] **Step 6: Run the auth API and existing auth tests**

Run from `backend/` with the isolated auth test database:

```powershell
$env:MONGODB_TEST_DB = 'maison_belle_test_auth_flow'
node --test test/auth-email-verification.test.js test/auth-products.test.js test/smoke.test.js
```

Expected: registration/session/login regression tests PASS; test fixture uses the dedicated test database and fake SMTP only.

- [x] **Step 7: Commit the auth API workflows**

```powershell
git add backend/src/app.js backend/src/routes/auth.js backend/test/auth-email-verification.test.js backend/test/auth-products.test.js
git commit -m "feat: require email codes for account auth"
```

## Task 4: Invalidate old sessions after password reset

**Files:**
- Modify: `backend/src/middleware/auth.js`
- Modify: `backend/test/auth-email-verification.test.js`

**Interfaces:**
- `signSession(user, secret)` adds `authVersion: user.authVersion ?? 0` to JWT claims.
- `authenticate` treats absent claim/field as version `0`; otherwise rejects mismatches with the existing `401 AUTH_INVALID` shape.

- [x] **Step 1: Add a failing session-invalidation test**

Login with the test account, retain its cookie, complete password reset with a fake email code, then assert the old cookie receives 401 while a fresh login with the new password receives 200.

```js
const oldSession = request.agent(app);
await oldSession.post("/api/auth/login").send({ email: "customer@test.local", password: "OldPass@123" }).expect(200);
await request.post("/api/auth/password-reset/send-code").send({ email: "customer@test.local" }).expect(202);
const code = sent.get("password_reset:customer@test.local");
await request.post("/api/auth/password-reset").send({ email: "customer@test.local", verificationCode: code, newPassword: "NewPass@123" }).expect(204);
await oldSession.get("/api/auth/me").expect(401);
await request.agent(app).post("/api/auth/login").send({ email: "customer@test.local", password: "NewPass@123" }).expect(200);
```

- [x] **Step 2: Run the focused test and confirm it fails before middleware changes**

Run `node --test test/auth-email-verification.test.js` from `backend/`.
Expected: FAIL because the old JWT currently remains accepted.

- [x] **Step 3: Add auth-version claims and comparison**

```js
export function signSession(user, secret) {
  return jwt.sign({ sub: user._id.toString(), role: user.role, authVersion: user.authVersion ?? 0 }, secret, { expiresIn: "7d" });
}
```

In `authenticate`, after loading the active user, compare `(payload.authVersion ?? 0)` with `(user.authVersion ?? 0)` and return the existing invalid-session error on mismatch.

- [x] **Step 4: Run auth, role-protection and session tests**

Run: `node --test test/auth-email-verification.test.js test/auth-products.test.js test/admin-workflows.test.js` from `backend/`.
Expected: old sessions fail after reset; new sessions and existing manager/sales/warehouse role checks pass.

- [x] **Step 5: Commit session invalidation**

```powershell
git add backend/src/middleware/auth.js backend/test/auth-email-verification.test.js
git commit -m "fix: invalidate sessions after password reset"
```

## Task 5: Account-page verification and recovery flows

**Files:**
- Modify: `js/api.js`
- Modify: `js/api.test.js`
- Modify: `js/app.js`
- Modify: `js/app.test.js`
- Modify: `js/storefront.js`
- Modify: `js/storefront-layout.test.js`
- Modify: `css/flows.css`

**Interfaces:**
- Add `MBApi.auth.sendRegistrationCode({ email })`, `sendPasswordResetCode({ email })`, and `resetPassword({ email, verificationCode, newPassword })`.
- Keep current `MBApi.auth.register()` signature but send `verificationCode` with the existing registration fields.
- Use browser-native `type="email"` validity plus a pure `MB.isValidEmail(value)` helper for enabling the send-code controls.

- [x] **Step 1: Write failing API-wrapper and email-validation tests**

In `js/api.test.js`, assert each wrapper uses its exact endpoint and JSON body. In `js/app.test.js`, assert trimmed valid addresses pass and malformed/empty addresses fail:

```js
assert.equal(MB.isValidEmail(" belle@example.com "), true);
assert.equal(MB.isValidEmail("belle@"), false);
assert.equal(MB.isValidEmail(""), false);
```

- [x] **Step 2: Run frontend tests and confirm the new wrappers/helper are missing**

Run from repository root: `node --test js/api.test.js js/app.test.js`.
Expected: FAIL only on the newly specified methods/helper.

- [x] **Step 3: Add the API wrappers and pure email validator**

```js
sendRegistrationCode: (body) => send("POST", "/api/auth/register/send-code", body),
sendPasswordResetCode: (body) => send("POST", "/api/auth/password-reset/send-code", body),
resetPassword: (body) => send("POST", "/api/auth/password-reset", body)
```

Implement `MB.isValidEmail` by trimming and checking the existing basic email pattern; keep server validation authoritative. Ensure `register()` includes `verificationCode` and add tests that wrapper bodies contain no unrelated form fields.

- [x] **Step 4: Add registration and forgot-password form controls**

Replace the current unsupported forgot-password note with a form for email, send-code, six-digit code, new password, and confirmation. Add a registration send-code action and OTP field. On each email `input`, update validity feedback and send-button disabled state. Keep code/password values in form controls only; start a 60-second resend timer after successful API response; disable submit during requests; show API errors in `aria-live` messages. After a reset-code request, use non-committal copy such as “Nếu email đã đăng ký, yêu cầu đã được tiếp nhận. Nếu chưa nhận mã, hãy thử lại sau khi hết thời gian chờ.” Registration submits the OTP; password reset calls the reset endpoint and returns the user to login without auto-login. Ensure the timer is cleared when the form closes or changes mode, and do not start it when the send request fails.

```js
emailInput.addEventListener("input", () => {
  const valid = MB.isValidEmail(emailInput.value);
  sendCodeButton.disabled = !valid || sending || secondsRemaining > 0;
  emailInput.setAttribute("aria-invalid", String(emailInput.value.length > 0 && !valid));
});
```

- [x] **Step 5: Update DOM/layout regression tests for email-code controls and accessible states**

Assert that login, registration and recovery forms expose one email field each, code fields use numeric input mode and max length six, send buttons start disabled until valid email input, status messages use `role="status"`/`aria-live`, and password controls remain accessible. Add focused CSS for inline email/send-code controls and mobile stacking; do not change unrelated account styling.

- [x] **Step 6: Run all frontend tests and manually verify account states when browser automation is available**

Run: `node --test js/*.test.js` from repository root. When browser automation is available, open `account.html` and verify malformed email disables sending, valid email submits to the API, register/reset feedback displays in the correct form, resend cooldown counts down, and successful reset returns to login. If browser automation is unavailable, record the limitation and rely only on automated DOM/state tests (do not claim a manual smoke test). If SMTP is not configured, verify the form accurately displays `EMAIL_NOT_CONFIGURED`; the generic reset-send confirmation must never claim email delivery.

- [x] **Step 7: Commit account-page flows**

```powershell
git add js/api.js js/api.test.js js/app.js js/app.test.js js/storefront.js js/storefront-layout.test.js css/flows.css
git commit -m "feat: add email verification and password recovery forms"
```

## Task 6: Full regression and configuration handoff

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-14-email-verification-password-reset-chatbot-design.md`
- Modify: `docs/superpowers/plans/2026-10-14-email-verification-password-reset.md`
- Test: `backend/test/auth-email-verification.test.js`
- Test: all existing `backend/test/*.test.js` and `js/*.test.js`

- [x] **Step 1: Document the six SMTP environment variables and local startup command**

Update the existing PowerShell setup instructions to explain that `backend/.env` is loaded through `dotenv/config`. List `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, and `AUTH_CODE_SECRET`; state that the code secret must be separately generated and must not reuse `JWT_SECRET`; secrets must stay out of Git. Do not put real secrets in documentation. Ensure the reset-send docs explain that generic `202` means request received, not email delivered, and users may retry if no code arrives.

- [x] **Step 2: Run the complete frontend regression suite**

Run from repository root: `node --test js/*.test.js`.
Expected: all storefront, account, API and admin tests PASS; admin UI behavior remains unchanged.

- [x] **Step 3: Run backend tests on the isolated configured test database**

Run from `backend/`:

```powershell
$env:MONGODB_URI = 'mongodb://127.0.0.1:27017'
$env:MONGODB_TEST_DB = 'maison_belle_test_full_regression'
$suiteFiles = Get-ChildItem test/*.test.js | Where-Object { $_.Name -notin @('auth-email-codes.test.js', 'seed-safety.test.js', 'auth-email-verification.test.js') } | ForEach-Object { $_.FullName }
node --test $suiteFiles
$env:MONGODB_TEST_DB = 'maison_belle_test_auth_email_codes'
node --test test/auth-email-codes.test.js
node --test test/seed-safety.test.js
$env:MONGODB_TEST_DB = 'maison_belle_test_auth_flow'
node --test test/auth-email-verification.test.js
```

Expected: all API, auth, order, shipping, migration and admin regression tests PASS against dedicated local test databases and fake SMTP. Do not run seed against development or user databases.

- [x] **Step 4: Check whitespace, changed-file scope and repository state**

Run: `git diff-files --check` and `git status --short --branch` from repository root.
Expected: no whitespace errors; the documentation commit contains only files listed in this plan. Leave unrelated plans or pre-existing worktree changes untouched.

- [x] **Step 5: Commit setup and policy documentation**

After confirming Tasks 1–5 are complete and reviewed in the SDD ledger, mark those task checkboxes complete in this plan before committing. Mark Task 6 complete only after its regression and documentation checks pass.

```powershell
git add README.md docs/superpowers/specs/2026-10-14-email-verification-password-reset-chatbot-design.md docs/superpowers/plans/2026-10-14-email-verification-password-reset.md
git commit -m "docs: document email auth configuration and privacy behavior"
```

Do not push until the user explicitly asks for this feature branch to be pushed.
