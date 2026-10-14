# Maison Belle Commerce Lifecycle Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify that checkout, inventory, voucher, payment, delivery, cancellation, return, and report records remain consistent across retries and failures.

**Architecture:** Keep the existing order service, routes, status transitions, and MongoDB collections. Use server-authoritative snapshots and conditional inventory updates; preserve the already approved compensation/temporary-marker scope without introducing a durable saga.

**Tech Stack:** Node.js >=20, Express 5, MongoDB Node driver 6, Supertest, `node:test`, existing storefront JavaScript.

**Spec:** `docs/superpowers/specs/2026-10-13-maison-belle-functional-data-audit-design.md` and `docs/superpowers/specs/2026-10-12-maison-belle-mongodb-commerce-workflows-design.md`.

## Global Constraints

- The backend is authoritative for product prices, promotions, voucher eligibility, inventory, and demo shipping fees.
- Unknown/inactive shipping regions cannot create an order and cannot consume stock or a voucher.
- Keep payment and carrier behavior simulated; do not add real providers or a durable saga/reconciler.
- Preserve historical order/address snapshots; use only a dedicated test database for integration tests.
- Preserve existing worktree changes and do not push to a remote.

**Prerequisite:** Complete the persistence-safety plan's isolated MongoDB setup and URI-fixture correction before running any test in this plan.

---

### Task 1: Capture isolated commerce-test baseline

**Files:**
- Test: `backend/test/order-flows.test.js`, `backend/test/shipping-rates.test.js`, `backend/test/admin-workflows.test.js`, `backend/test/business-completion.test.js`, `backend/test/admin-reports.test.js`
- Inspect: `backend/src/services/order-service.js`, `backend/src/routes/orders.js`, `backend/src/lib/status.js`

**Interfaces:**
- Consumes: existing checkout request `{ checkoutRequestId, items, voucherCode?, paymentMethod, shippingAddress }` and the configured shipping-rate collection.
- Produces: a baseline for stored order snapshots, inventory/voucher side effects, and order lifecycle transitions.

- [ ] **Step 1: Verify the isolated test endpoint and prefix**

Set `MONGODB_URI=mongodb://127.0.0.1:27018` and `MONGODB_TEST_DB=maison_belle_test_audit`. Do not run the command if the URI is not the disposable local test instance.

- [ ] **Step 2: Run focused commerce integration tests**

Run from `backend/`:

```powershell
node --test test/order-flows.test.js test/shipping-rates.test.js test/admin-workflows.test.js test/business-completion.test.js test/admin-reports.test.js
```

Expected: tests use only test-prefixed fixture databases; record the exact first assertion and persisted-state mismatch for each failure.

### Task 2: Prove checkout uses server data rather than forged browser totals

**Files:**
- Modify only if the test fails: `backend/test/order-flows.test.js`, `backend/src/services/order-service.js`

**Interfaces:**
- Consumes: the existing `customerAgent`, `variantId`, and fixture rate `hcm-demo` from `order-flows.test.js`.
- Produces: an assertion that an order is priced from MongoDB or rejected before side effects; client-supplied totals never become persisted order data.

- [ ] **Step 1: Add a forged-total regression test**

Add a test named `checkout uses server prices and ignores forged client totals` beside `checkout derives shipping from the active rate and retries one request idempotently`. Submit two fixture units with `unitPrice: 1`, `subtotal: 1`, `discountAmount: 999999`, `deliveryFee: 1`, and `finalAmount: 1`, while selecting `regionCode: "hcm-demo"`. Keep the request ID unique. Assert the response is 201 and stores `unitPrice: 100000`, `deliveryFee: 25000`, `subtotal: 200000`, and `finalAmount: 225000`; also assert the client-supplied totals are absent from the stored calculation.

- [ ] **Step 2: Run the new test to establish the baseline**

Run from `backend/`:

```powershell
node --test --test-name-pattern="server prices and ignores forged client totals" test/order-flows.test.js
```

Expected: the new test fails if any persisted amount comes from the request, or passes with the server-computed values above.

- [ ] **Step 3: Make the smallest service correction only if the regression fails**

Use only the fixture’s `product_variants.retailPrice`, active promotions, voucher collection, inventory, and `shipping_rates` values to build the order. Never read client `unitPrice`, `subtotal`, `discountAmount`, `deliveryFee`, `regionName`, or `finalAmount` as authoritative inputs. Preserve the current temporary checkout marker and compensation behavior.

- [ ] **Step 4: Rerun the focused checkout tests**

Run `node --test --test-name-pattern="checkout|shipping region|voucher|stock|compensat|markerless|replay" test/order-flows.test.js`. Expected: server snapshots and rollback/idempotency assertions pass.

### Task 3: Verify reservation, payment, fulfillment, cancellation, and return invariants

**Files:**
- Test first: `backend/test/order-flows.test.js`, `backend/test/admin-workflows.test.js`, `backend/test/business-completion.test.js`
- Modify only for a reproduced failure: `backend/src/services/order-service.js`, `backend/src/routes/admin-deliveries.js`, `backend/src/routes/admin-returns.js`, `backend/src/lib/status.js`

**Interfaces:**
- Consumes: current transitions `pending → confirmed → processing → shipped → delivered → completed`, cancellation rules, payment artifacts, and return status flow.
- Produces: one-time stock/voucher/loyalty effects and consistent order, delivery, return, payment, invoice, and history records.

- [ ] **Step 1: Run the lifecycle and partial-write tests**

Run the focused commerce command from Task 1. Confirm coverage for insufficient stock, unsupported region, duplicate checkout, acknowledgement loss, failed multi-item writes, COD settlement, replayed cancellation, delivery replay, return receipt/restock, and cancelled-order report exclusion.

- [ ] **Step 2: Add a regression test for each uncovered invariant before changing source**

Use the existing fixture helpers `createLifecycleOrder` and `advanceOrder` for order transitions. For return receipt, assert a repeated `received` update leaves `stockQuantity` unchanged and leaves exactly one `inventory_logs` row for that return. For cancellation, assert a repeated cancel releases a reservation only once and writes one terminal history effect.

- [ ] **Step 3: Correct only the transition or compensation that violates the invariant**

Use conditional status updates and existing attempt/claim markers. Keep rollback local to the current request and retain the documented limitation that an abrupt process stop between MongoDB writes can leave work requiring manual inspection; do not add restart reconciliation in this scope.

- [ ] **Step 4: Rerun lifecycle tests and the report reconciliation test**

Run `node --test test/order-flows.test.js test/admin-workflows.test.js test/business-completion.test.js test/admin-reports.test.js`. Expected: repeated operations do not double-apply stock, payment, voucher, points, or report totals.

### Task 4: Verify storefront checkout and end-to-end persisted order

**Files:**
- Test: `js/api.test.js`, `js/storefront-layout.test.js`, backend commerce tests above
- Inspect: `cart.html`, `js/storefront.js`, `js/api.js`

**Interfaces:**
- Consumes: public shipping-rate listing/quote and authenticated order creation.
- Produces: one observable customer journey whose order snapshot matches the selected configured test rate and database values.

- [ ] **Step 1: Run the checkout UI/API contract tests**

Run `node --test js/api.test.js js/storefront-layout.test.js`. Expected: the quote API is called with `regionCode`, guests are prompted to sign in, and the shipping fee is displayed separately from the item subtotal.

- [ ] **Step 2: Use the test-only demo server for a browser smoke flow**

Browse as a guest, add an item, open the cart, start checkout, sign in with a test-only account, select an active test region, and submit once. Confirm the created order in the test database has a matching `shippingRateSnapshot` and correct subtotal/fee/total.

- [ ] **Step 3: Rerun the full backend and frontend suites**

Run `pnpm test` from `backend/` with the isolated URI/prefix, then `node --test js/*.test.js` from the repository root. Record all remaining failures rather than marking the workflow complete based only on a unit test.
