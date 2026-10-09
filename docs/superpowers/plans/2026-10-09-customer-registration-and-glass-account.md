# Customer Registration and Glass Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add public customer registration that securely creates a customer and immediately establishes the existing session, with the approved Maison Belle split-story/glass account UI.

**Architecture:** Extend the existing Express auth router and MongoDB users collection; reuse bcrypt, publicUser, signSession, cookie settings and the vanilla-JS API adapter. Keep login/dashboard behavior and render registration as a second account form state.

**Tech Stack:** Node.js 20+, Express 5, MongoDB 6, bcryptjs, node:test, Supertest, vanilla JavaScript/CSS.

**Spec:** `docs/superpowers/specs/2026-10-09-customer-registration-and-glass-account.md`

## Global Constraints

- New public accounts always have `role: "customer"` and `isActive: true`.
- Passwords are bcrypt-hashed; never return `passwordHash`.
- Registration sets the existing HttpOnly `mb_token` cookie and returns `201`.
- Do not add OTP, external providers, dependencies, local account storage, or new session formats.
- Preserve the existing login, account dashboard, order, appointment, and profile flows.

---

### Task 1: Specify registration behavior in failing backend integration tests

**Files:**
- Modify: `backend/test/auth-products.test.js`

**Interfaces:**
- Consumes: existing MongoDB test setup, `request.agent(app)`, and seeded roles.
- Produces: executable requirements for `POST /api/auth/register`.

- [ ] **Step 1: Add a success test** that registers a mixed-case email and checks status `201`, normalized email, role `customer`, `isDemo: false`, no `passwordHash`, `Set-Cookie` includes HttpOnly `mb_token`, `GET /api/auth/me` succeeds on the same agent, and MongoDB stores a bcrypt hash rather than the clear password.
- [ ] **Step 2: Add a trust-boundary test** that includes `role: "manager"`, `roleId`, `isActive: false`, and `isDemo: true` in the request and verifies the saved account remains an active, non-demo customer.
- [ ] **Step 3: Add invalid/duplicate tests** for malformed email, empty name, short password, existing email after case normalization, and existing phone; assert `400` or `409 DUPLICATE_USER` as appropriate.
- [ ] **Step 4: Verify RED.** Run `node --test --test-name-pattern="registration" test/auth-products.test.js` from `backend`; the new success test must fail with a missing route before any production edit.

### Task 2: Implement the registration endpoint

**Files:**
- Modify: `backend/src/routes/auth.js`
- Test: `backend/test/auth-products.test.js`

**Interfaces:**
- Consumes: existing `validateBody`, `HttpError`, `publicUser`, `signSession`, MongoDB `users` collection.
- Produces: `POST /api/auth/register` accepting `{ email, fullName, phone?, password, skinType? }` and returning `{ data: publicUser }` with a session cookie.

- [ ] **Step 1: Normalize and validate** email, full name, optional phone/skin type and password; return `400 VALIDATION_ERROR` for invalid input.
- [ ] **Step 2: Check conflicts** on normalized email and trimmed non-empty phone; return `409 DUPLICATE_USER`.
- [ ] **Step 3: Insert a new user** with server-selected customer role, active/non-demo flags, bcrypt hash, and timestamps; do not copy privilege fields from `req.body`.
- [ ] **Step 4: Handle unique-index races** by translating Mongo duplicate-key code `11000` into the same `409 DUPLICATE_USER` response.
- [ ] **Step 5: Set the same cookie policy as login** and return `201` through `publicUser`.
- [ ] **Step 6: Verify GREEN.** Run `node --test --test-name-pattern="registration" test/auth-products.test.js`; then run `node --test test/auth-products.test.js`.

### Task 3: Add the frontend adapter contract

**Files:**
- Modify: `js/api.test.js`
- Modify: `js/api.js`

**Interfaces:**
- Consumes: `createApi`, existing `send` helper.
- Produces: `MBApi.auth.register(body)` sending `POST /api/auth/register`.

- [ ] **Step 1: Write the adapter test** that calls `api.auth.register({ email: "mai@example.com", fullName: "Mai", password: "123456" })` and asserts URL, method and JSON body.
- [ ] **Step 2: Verify RED.** Run `node --test js/api.test.js`; the test must fail because `auth.register` is absent.
- [ ] **Step 3: Add the one-line adapter method** next to login.
- [ ] **Step 4: Verify GREEN.** Run `node --test js/api.test.js`.

### Task 4: Add the two-form account experience

**Files:**
- Modify: `js/storefront.js`
- Modify: `css/flows.css`

**Interfaces:**
- Consumes: `MBApi.auth.register`, existing `accountPage.load()`, `MB.escape`, error presentation and `#account-content` host.
- Produces: login/register switch, signup validation, auto-login dashboard rendering, and responsive glass/story layout.

- [ ] **Step 1: Render the B split layout** with a Maison Belle story panel and an accessible glass form panel; keep the demo credentials clearly marked and available only on login.
- [ ] **Step 2: Wire form switching** so the active form is visible and focused; use native required/email/password inputs and a client-side matching-password check.
- [ ] **Step 3: Wire registration** to `MBApi.auth.register` with only email, name, phone, password, and optional skin type; after `201`, call `load()` without a second login call.
- [ ] **Step 4: Preserve error/submit states** and prevent duplicate submits while requests are pending.
- [ ] **Step 5: Run `node --test js/*.test.js`** and manually test login, registration, duplicate/error feedback, successful auto-login and logout in the browser.

### Task 5: Document the endpoint and remove the obsolete limitation

**Files:**
- Modify: `API_CONTRACT.md`
- Modify: `api-requests.md`

**Interfaces:**
- Consumes: implemented route and spec request/response fields.
- Produces: documented public registration contract; no remaining statement that registration is unsupported.

- [ ] **Step 1: Document** request fields, validation, default customer role, conflict response, cookie and no-OTP limitation beside the existing auth endpoints.
- [ ] **Step 2: Remove** the obsolete unsupported-registration bullet from `api-requests.md` while retaining unrelated API limitations.
- [ ] **Step 3: Search** both documents for stale wording about registration being unavailable.

### Task 6: Verify the integrated auth change

**Files:**
- Verify: `backend/test/auth-products.test.js`
- Verify: `js/api.test.js`, `js/app.test.js`, `js/admin.test.js`

- [ ] **Step 1: Run backend tests** with `npm test` from `backend` and record the exit code and test totals.
- [ ] **Step 2: Run frontend tests** with `node --test js/*.test.js` from the project root.
- [ ] **Step 3: Run the local app** with MongoDB available and verify signup creates a customer, sets the session, and lands on the account dashboard.
- [ ] **Step 4: Inspect the changed files** to ensure no staff roles or password hashes can be assigned/returned by the public route.
