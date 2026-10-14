# Maison Belle Storefront and Identity Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify and repair existing catalog, account, and guest-cart behavior from browser interaction through API contracts and persisted customer data.

**Architecture:** Keep the current HTML/JavaScript storefront and Express/MongoDB services. Test public catalog and identity APIs, then verify the guest-cart-to-account transition without changing visual styling or adding new commerce behavior.

**Tech Stack:** Node.js >=20, browser JavaScript, HTML/CSS, `node:test`, Express 5, MongoDB Node driver 6, Supertest.

**Spec:** `docs/superpowers/specs/2026-10-13-maison-belle-functional-data-audit-design.md`

## Global Constraints

- Preserve the existing Express/MongoDB architecture and role names.
- Preserve guest browsing and cart use; require sign-in only when submitting an order.
- Keep the current customer journey and API contract; backend values remain authoritative.
- Test functional behavior only; do not adjust visual styling or add features.
- Use only isolated test databases for integration tests and preserve all existing worktree changes.

**Prerequisite:** Complete the persistence-safety plan's isolated MongoDB setup and URI-fixture correction before running the backend tests in this plan.

---

### Task 1: Establish customer-facing frontend and API-client baseline

**Files:**
- Test: `js/app.test.js`, `js/api.test.js`, `js/catalog-pages.test.js`, `js/storefront-layout.test.js`, `js/warranty-page.test.js`
- Inspect: `js/app.js`, `js/api.js`, `js/catalog-pages.js`, `js/storefront.js`

**Interfaces:**
- Consumes: exported `MB` and `createApi` helpers, existing storefront page scripts, and documented API paths.
- Produces: a recorded baseline for catalog query mapping, account interactions, guest cart behavior, and customer-page API calls.

- [ ] **Step 1: Run focused customer-facing tests before edits**

Run from the repository root:

```powershell
node --test js/app.test.js js/api.test.js js/catalog-pages.test.js js/storefront-layout.test.js js/warranty-page.test.js
```

Expected: record every passing and failing test. The latest available full run was 95/100, so do not assume older failures disappeared.

- [ ] **Step 2: Reproduce navigation and theme test-double failures**

Run `node --test js/app.test.js`. Check the existing tests named `theme control displays only its icon and keeps an accessible action label`, `nav indicator also follows the product category menu`, and `product category menu closes when the pointer leaves or another nav item is clicked`.

Expected: failures caused only by mock elements missing browser methods are distinguishable from a real interaction failure.

- [ ] **Step 3: Make test doubles match the DOM methods production code uses**

If the focused failures are mock-only, update `js/app.test.js` so the theme host implements `append(node)` and each fake nav pill implements `getBoundingClientRect()` with `{ left: 0, width: 1 }`. Keep assertions that the theme button is mounted and nav geometry follows the hovered/clicked element. Do not weaken or remove behavioral assertions.

- [ ] **Step 4: Rerun the focused customer-facing suite**

Run the Step 1 command. Expected: PASS for the existing customer-facing tests; any remaining failure must be reproduced in the actual app/API before changing production code.

### Task 2: Verify account, guest cart, and catalog behavior across frontend and API

**Files:**
- Test: `js/app.test.js`, `js/api.test.js`, `backend/test/auth-products.test.js`, `backend/test/order-flows.test.js`
- Inspect: `account.html`, `cart.html`, `products.html`, `product.html`, `js/app.js`, `js/storefront.js`, `js/api.js`

**Interfaces:**
- Consumes: `/api/register`, `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`, `/api/products`, and `/api/cart`.
- Produces: verified registration/login/session behavior, catalog request mapping, local guest-cart behavior, and successful/failed account-cart merge semantics.

- [ ] **Step 1: Run public identity and catalog integration cases**

With the disposable MongoDB URI and test prefix established by the persistence-safety plan, run from `backend/`:

```powershell
node --test test/auth-products.test.js
```

Expected: registration validation, duplicate email/phone rejection, session login/logout, public product search/detail, price filtering/sorting, and role-protected catalog writes all pass.

Run the cart API regression from `backend/` with the same isolated URI/prefix:

```powershell
node --test --test-name-pattern="customer can replace a cart" test/order-flows.test.js
```

Expected: the authenticated cart is persisted to the fixture user and returned with the requested quantity.

- [ ] **Step 2: Verify guest cart and sign-in merge regression coverage**

Run from the repository root:

```powershell
node --test --test-name-pattern="anonymous cart|signing in merges|guest items stay saved|checkout asks guests to sign in|catalog query" js/app.test.js js/storefront-layout.test.js js/api.test.js
```

Expected: an anonymous cart persists locally, matching variants merge once after sign-in, failed sync does not clear the guest copy, and a guest is redirected to sign in before order submission.

- [ ] **Step 3: Add a focused regression test only for an uncovered contract**

If the existing tests do not verify one of the Step 2 outcomes, add a test to `js/app.test.js` using a guest-cart item with a stable `variantId`, then assert the account-cart request completes before local storage is cleared. For a failed request, assert the exact local cart value remains. Run that test alone and observe the expected failing assertion before editing `js/app.js` or `js/storefront.js`.

- [ ] **Step 4: Verify catalog query mapping and API error handling**

Run `node --test js/api.test.js js/catalog-pages.test.js`. Expected: search/filter/sort use the documented query parameters, stable category/brand codes remain in links, and API failures preserve status/code/message for the page layer.

- [ ] **Step 5: Rerun focused identity and catalog tests**

Rerun Steps 1, 2, and 4. Expected: PASS with no change to the public API contract or account role.

### Task 3: Smoke the customer journey in the isolated local demo

**Files:**
- Inspect only unless a regression test proves a defect: `index.html`, `products.html`, `product.html`, `account.html`, `cart.html`

**Interfaces:**
- Consumes: the test-only server started by the persistence-safety plan.
- Produces: a checklist of observed catalog, account, and guest-cart interactions; no production-data mutations.

- [ ] **Step 1: Open the local home and catalog pages**

With the test server on port 3001, verify the catalog loads, a search/filter action reaches the expected catalog URL/API query, and opening a product retains its product/variant identity.

- [ ] **Step 2: Verify guest-cart use and authentication boundary**

As a guest, add a product, change quantity, remove it explicitly, and open the cart. Confirm no login is needed for those actions; start checkout and confirm the sign-in boundary appears.

- [ ] **Step 3: Verify account merge and persistence**

Sign in using a test-only account, return to the cart, and verify guest items appear once. Repeat with a deliberately failed cart sync in the test harness and confirm the guest copy is retained.

- [ ] **Step 4: Rerun the complete frontend suite**

Run `node --test js/*.test.js`. Expected: every customer and shared frontend test passes; admin-only failures are listed for the admin/support plan rather than hidden.
