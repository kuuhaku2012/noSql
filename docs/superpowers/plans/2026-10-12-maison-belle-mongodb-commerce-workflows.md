# Maison Belle MongoDB Commerce Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the existing demo commerce journey using MongoDB as the source of truth for supported shipping regions, checkout totals, inventory reservations, orders, fulfillment, returns, and reporting.

**Architecture:** Extend the current Express/native-MongoDB API and storefront rather than replacing the data model. Add manager-configured demo shipping rates, have the server quote and revalidate them at checkout, and retain order snapshots plus compensating actions for multi-document failures. Connect a manager-only shipping-rate panel to the existing master-data admin view.

**Tech Stack:** Node.js 20+, pnpm, Express 5, MongoDB Node driver 6, `node:test`, Supertest, existing HTML/CSS/JavaScript frontend.

**Spec:** `docs/superpowers/specs/2026-10-12-maison-belle-mongodb-commerce-workflows-design.md`

## Global Constraints

- Keep the existing Express application, MongoDB driver, collections, route conventions, and role names.
- Preserve guest browsing and cart use. Require sign-in only when submitting an order; merge the guest cart into the user's MongoDB cart after sign-in.
- The backend is authoritative for product prices, promotions, vouchers, stock availability, and shipping fees.
- Use manager-maintained, demo-only shipping rates by configured province/city. A location without an active rate cannot be ordered to; it must never silently become free shipping.
- Keep COD and mock payment, and mock delivery. Do not connect real payment providers, carriers, OTP, or email in this scope.
- Preserve historical orders and addresses. Schema changes are additive and migrations are repeatable; no collection reset or destructive rewrite.
- Do not run migrations, seeds, or integration tests against a non-dev/non-test database.
- Preserve the current uncommitted admin-header edits in `admin.html`, `css/theme.css`, `js/admin.js`, and `js/admin.test.js`; never reset, checkout, or broadly stage those paths. Stage only task-specific hunks when a task touches an already-modified file.

## Repository and execution preflight

Before implementation, capture the current baseline without editing files:

```powershell
node --test js/*.test.js
```

```powershell
pnpm test
```

Run the second command from `backend/`. The previous project test run reported six frontend failures; compare the fresh output with that baseline and distinguish pre-existing failures from regressions. Existing backend integration tests use isolated database suffixes; every new integration fixture must likewise use a dedicated `*_test_*` database and drop only that exact test database in teardown.

## File map

- `backend/src/collections.js`: named MongoDB collection handles; add `shippingRates`.
- `backend/src/app.js`: mount public shipping quote/list and manager-only shipping-rate routes.
- `backend/src/routes/shipping.js`: list active configured regions and quote one region.
- `backend/src/routes/admin-shipping-rates.js`: manager-only rate list/create/update/deactivate.
- `backend/src/services/order-service.js`: authoritative shipping calculation, request idempotency, and order side effects/compensation.
- `backend/src/routes/customers.js`: validate structured region fields on saved addresses without invalidating legacy addresses.
- `backend/src/routes/admin-deliveries.js`, `backend/src/routes/admin-returns.js`, `backend/src/lib/status.js`: keep delivery/order/return transitions and stock logs consistent where tests identify gaps.
- `backend/scripts/create-indexes.js`, `backend/scripts/seed.js`, `backend/scripts/migrate-model.js`: safe unique/query indexes, labeled demo rates, and repeatable additive setup.
- `backend/test/shipping-rates.test.js`: public quote, manager CRUD, authorization, validation, and index behavior.
- `backend/test/order-flows.test.js`: secure checkout, idempotency, rollback, and cart/order integration cases.
- `backend/test/admin-workflows.test.js`: order/delivery/return/stock invariants and role permissions.
- `backend/test/business-completion.test.js`: saved address region compatibility and customer workflow coverage.
- `API_CONTRACT.md` (repository root): publish the updated payloads, errors, and demo limitations.
- `js/api.js`, `js/api.test.js`: typed-by-convention client methods for public shipping and manager rate operations.
- `cart.html`, `js/storefront.js`: supported-region selector, quote display, checkout request ID, and order payload.
- `js/admin.js`, `js/admin.test.js`: manager rate panel within the existing `master-data` view; reuse current admin form/table styles and preserve pending header work.

## Task 1: Add shipping-rate persistence and API

**Files:**
- Modify: `backend/src/collections.js`
- Modify: `backend/src/app.js`
- Modify: `backend/scripts/create-indexes.js`
- Modify: `backend/scripts/seed.js`
- Create: `backend/src/routes/shipping.js`
- Create: `backend/src/routes/admin-shipping-rates.js`
- Create: `backend/test/shipping-rates.test.js`

**Interfaces:**
- `collections(db).shippingRates` returns `db.collection("shipping_rates")`.
- `GET /api/shipping/rates` returns active rate records as `{ data: [{ regionCode, regionName, fee, currency: "VND", isDemo: true }] }`.
- `POST /api/shipping/quote` accepts `{ regionCode }` and returns the same selected-region shape. Unknown/inactive region returns HTTP `409`, code `SHIPPING_UNAVAILABLE`.
- `GET|POST /api/admin/shipping-rates` and `PATCH|DELETE /api/admin/shipping-rates/:id` require `manager`; DELETE is a soft deactivation (`isActive: false`). Create/update request shape is `{ regionCode, regionName, fee, isActive }`.

- [ ] **Step 1: Add failing tests for public rate list and quote**

```js
test("public quote resolves only an active configured region", async () => {
  const quote = await request(app).post("/api/shipping/quote").send({ regionCode: "hcm-demo" });
  assert.equal(quote.status, 200);
  assert.deepEqual(quote.body.data, {
    regionCode: "hcm-demo", regionName: "Hồ Chí Minh (demo)", fee: 25000,
    currency: "VND", isDemo: true
  });
  const missing = await request(app).post("/api/shipping/quote").send({ regionCode: "unknown" });
  assert.equal(missing.body.error.code, "SHIPPING_UNAVAILABLE");
});
```

- [ ] **Step 2: Run the focused test and observe the missing-route failure**

Run from `backend/`: `node --test test/shipping-rates.test.js`
Expected: FAIL because the route/collection is not mounted yet.

- [ ] **Step 3: Add the rate collection, route mounts, validation, indexes, and safe demo seed**

```js
// Public API maps the stored `code` to the checkout contract's `regionCode`.
const rate = await shippingRates.findOne({ code: regionCode, isActive: true });
if (!rate) throw new HttpError(409, "SHIPPING_UNAVAILABLE", "This delivery region is not supported");
return { regionCode: rate.code, regionName: rate.regionName, fee: rate.fee, currency: "VND", isDemo: true };
```

Create a unique index on `shipping_rates.code` and an active-region query index. Add demo rates through a dedicated seed path using `updateOne({ code }, { $setOnInsert: record }, { upsert: true })`; explicitly exclude `shipping_rates` from the generic seed loop, which deletes/reinserts `isDemo` records. Test that rerunning seed preserves a manager-edited fee, name, and active flag. Validate non-empty normalized codes/names and finite non-negative VND fees. Require `manager` on every write.

- [ ] **Step 4: Run shipping and seed-safety tests**

Run from `backend/`: `node --test test/shipping-rates.test.js test/seed-safety.test.js`
Expected: PASS for public filtering/quote, manager CRUD, denied sales/customer writes, duplicate region code, invalid fee, and seed-safety cases.

- [ ] **Step 5: Commit only Task 1 files**

```powershell
git add backend/src/collections.js backend/src/app.js backend/src/routes/shipping.js backend/src/routes/admin-shipping-rates.js backend/scripts/create-indexes.js backend/scripts/seed.js backend/test/shipping-rates.test.js
git diff --cached --check
git commit -m "feat: add MongoDB demo shipping rates"
```

## Task 2: Make checkout server-authoritative and connect the customer UI

**Files:**
- Modify: `backend/src/services/order-service.js`
- Modify: `backend/src/routes/orders.js`
- Modify: `backend/src/routes/customers.js`
- Modify: `backend/scripts/create-indexes.js`
- Modify: `backend/test/order-flows.test.js`
- Modify: `backend/test/business-completion.test.js`
- Modify: `js/api.js`
- Modify: `js/api.test.js`
- Modify: `cart.html`
- Modify: `js/storefront.js`

**Interfaces:**
- The UI calls `MBApi.shipping.rates()` and `MBApi.shipping.quote({ regionCode })`.
- Checkout sends `{ checkoutRequestId, items, voucherCode?, paymentMethod, shippingAddress: { receiverName, receiverPhone, fullAddress, regionCode } }`; it does not send a trusted region name, shipping fee, subtotal, discount, or final amount. The server fills `regionName` from the selected active rate.
- `createOrder({ db, user, body })` re-reads active product/variant, promotion, voucher, inventory, and shipping rate; stores `deliveryFee` plus a shipping-rate snapshot on the order.
- A repeated `{ userId, checkoutRequestId }` returns the original order without consuming more stock or voucher uses. Existing orders without `checkoutRequestId` remain valid.
- Saved address APIs accept optional `regionCode` and `regionName`; a new checkout requires a configured region, while legacy address records remain readable.

- [ ] **Step 1: Add failing API tests for rate-derived fee, unsupported region, and retries**

```js
const body = {
  checkoutRequestId: "checkout-attempt-1",
  items: [{ variantId: variantId.toHexString(), quantity: 2 }],
  voucherCode: "BELLE10",
  paymentMethod: "cod",
  deliveryFee: 999999,
  shippingAddress: {
    receiverName: "Order Customer", receiverPhone: "0900000000",
    fullAddress: "1 Demo Street", regionCode: "hcm-demo"
  }
};
const first = await customerAgent.post("/api/orders").send(body);
const retry = await customerAgent.post("/api/orders").send(body);
assert.equal(first.body.data.deliveryFee, 25000);
assert.equal(retry.body.data.id, first.body.data.id);
assert.equal(await db.collection("orders").countDocuments({ userId: customer._id }), 1);
```

Also assert an unsupported region leaves order count, reserved stock, and voucher `usedCount` unchanged; add the active rate to the dedicated order test fixture. Import `createOrder` and wrap only the payments collection to inject one failed write; assert compensation returns reserved stock and voucher usage to their starting values and removes the incomplete order/history records:

```js
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
const beforeFailure = {
  inventory: await db.collection("inventories").findOne({ variantId }),
  voucher: await db.collection("vouchers").findOne({ code: "BELLE10" }),
  orderCount: await db.collection("orders").countDocuments({ userId: customer._id }),
  historyCount: await db.collection("order_histories").countDocuments({}),
  paymentCount: await db.collection("payments").countDocuments({}),
  invoiceCount: await db.collection("invoices").countDocuments({})
};
await assert.rejects(
  createOrder({
    db: failingDb,
    user: customer,
    body: { ...body, checkoutRequestId: "checkout-attempt-failure", items: [{ variantId: variantId.toHexString(), quantity: 1 }] }
  }),
  /injected payment write failure/
);
assert.equal((await db.collection("inventories").findOne({ variantId })).reservedQuantity, beforeFailure.inventory.reservedQuantity);
assert.equal((await db.collection("inventories").findOne({ variantId })).stockQuantity, beforeFailure.inventory.stockQuantity);
assert.equal((await db.collection("vouchers").findOne({ code: "BELLE10" })).usedCount, beforeFailure.voucher.usedCount);
assert.equal(await db.collection("orders").countDocuments({ userId: customer._id }), beforeFailure.orderCount);
assert.equal(await db.collection("order_histories").countDocuments({}), beforeFailure.historyCount);
assert.equal(await db.collection("payments").countDocuments({}), beforeFailure.paymentCount);
assert.equal(await db.collection("invoices").countDocuments({}), beforeFailure.invoiceCount);
```

- [ ] **Step 2: Run the focused order tests and observe failures**

Run from `backend/`: `node --test test/order-flows.test.js test/business-completion.test.js`
Expected: FAIL on missing region/idempotency handling or incorrect fee authority.

- [ ] **Step 3: Implement rate revalidation, idempotency, and structured address support**

```js
const rate = await db.collection("shipping_rates").findOne({ code: body.shippingAddress.regionCode, isActive: true });
if (!rate) throw new HttpError(409, "SHIPPING_UNAVAILABLE", "This delivery region is not supported");
const deliveryFee = Number(rate.fee); // never use body.deliveryFee
```

Add the partial unique compound index `{ userId: 1, checkoutRequestId: 1 }` for documents whose `checkoutRequestId` is a string. On duplicate-key race, compensate the losing attempt's reservation/voucher changes, load and return the winning order for the same user/key, and do not remove the winner's records. Validate request ID length and region code. Update customer-address normalization so partial updates preserve legacy records and newly supplied region fields are validated.

- [ ] **Step 4: Update checkout UI and API client in the same task so no intermediate contract is broken**

```html
<label class="field">Tỉnh / thành phố
  <select required name="regionCode" autocomplete="address-level1"></select>
</label>
<p id="shipping-quote" role="status" aria-live="polite"></p>
```

Populate the select from active rates, call the quote endpoint on region change, show the fee separately, preserve the request ID while retrying the same failed submission, and clear it only after success/new checkout. On 401, preserve the guest/user cart and return to checkout after sign-in. The order payload must include the selected `regionCode` and must omit `deliveryFee`.

- [ ] **Step 5: Run backend and API-client tests**

Run from `backend/`: `node --test test/order-flows.test.js test/business-completion.test.js`
Run from repository root: `node --test js/api.test.js js/app.test.js`
Expected: PASS for server fee calculation, forged fee resistance, address compatibility, checkout retry, login continuation, and guest-cart merge.

- [ ] **Step 6: Commit only Task 2 hunks/files**

```powershell
git add backend/src/services/order-service.js backend/src/routes/orders.js backend/src/routes/customers.js backend/scripts/create-indexes.js backend/test/order-flows.test.js backend/test/business-completion.test.js js/api.js js/api.test.js cart.html js/storefront.js
git diff --cached --check
git commit -m "feat: calculate shipping in authenticated checkout"
```

If a listed file is already modified by the pending admin-header work, stage only the checkout hunks; do not stage the whole file.

## Task 3: Add manager shipping-rate operations to the admin UI

**Files:**
- Modify: `js/admin.js`
- Modify: `js/admin.test.js`
- Modify: `js/api.js`
- Modify: `js/api.test.js`

**Interfaces:**
- Extend `MBApi.admin` with `shippingRates.list()`, `.create(body)`, `.update(id, body)`, and `.remove(id)` for the Task 1 endpoints.
- Render the shipping-rate panel inside the existing manager-only `master-data` view; do not create a second admin header or add a new role.
- Use the existing `formBlock`, `table`, `statusTag`, escaping, form-message, and soft-deactivation patterns in `js/admin.js`.

- [ ] **Step 1: Add failing API-client and access-view tests**

```js
assert.equal(canAccess("manager", "master-data"), true);
assert.equal(canAccess("sales", "master-data"), false);
assert.equal(canAccess("warehouse", "master-data"), false);
```

Add API-client assertions for `GET /api/admin/shipping-rates`, `POST`, `PATCH`, and `DELETE`, including JSON bodies and encoded rate IDs.

- [ ] **Step 2: Run focused tests and observe missing-client-method failures**

Run from repository root: `node --test js/admin.test.js js/api.test.js`
Expected: FAIL only for the new methods/panel contract.

- [ ] **Step 3: Implement the admin client and panel**

```js
shippingRates: {
  list: () => get("/api/admin/shipping-rates"),
  create: (body) => send("POST", "/api/admin/shipping-rates", body),
  update: (id, body) => request(idPath("/api/admin/shipping-rates", id), { method: "PATCH", body }),
  remove: (id) => request(idPath("/api/admin/shipping-rates", id), { method: "DELETE" })
}
```

Add create/edit/deactivate controls for region code, display name, demo VND fee, and active state. Display that these are demo rates. Keep the panel manager-only through the existing view access and server authorization; preserve the pending header edits and avoid unrelated layout/CSS changes.

- [ ] **Step 4: Run admin/API-client tests and inspect manager/sales visibility**

Run from repository root: `node --test js/admin.test.js js/api.test.js`
Expected: PASS; manager sees the rate editor and sales/warehouse do not receive the master-data view.

- [ ] **Step 5: Commit only Task 3 hunks/files**

```powershell
git add js/admin.js js/admin.test.js js/api.js js/api.test.js
git diff --cached --check
git commit -m "feat: manage demo shipping rates in admin"
```

Stage only the new rate-management hunks in `js/admin.js` and `js/admin.test.js`; keep the existing header changes unstaged unless they are separately approved for inclusion.

## Task 4: Verify and close order, delivery, and return invariants

**Files:**
- Modify only if a new invariant test fails: `backend/src/services/order-service.js`
- Modify only if a new invariant test fails: `backend/src/routes/admin-deliveries.js`
- Modify only if a new invariant test fails: `backend/src/routes/admin-returns.js`
- Modify only if a new invariant test fails: `backend/src/lib/status.js`
- Modify: `backend/test/order-flows.test.js`
- Modify: `backend/test/admin-workflows.test.js`

**Interfaces:** Existing order, delivery, return, and inventory-log APIs remain in place. A successful delivery transition to `delivered` updates a `shipped` order once; cancellation releases each reservation once; accepted return receipt restocks and logs each returned line once.

- [ ] **Step 1: Add failing tests for replayed delivery, cancellation, and return receipt**

```js
const received = await managerAgent.patch(`/api/admin/returns/${returnId}`).send({ status: "received" });
assert.equal(received.status, 200);
const stockAfterFirstReceipt = (await db.collection("inventories").findOne({ variantId })).stockQuantity;
await managerAgent.patch(`/api/admin/returns/${returnId}`).send({ status: "received" });
assert.equal((await db.collection("inventories").findOne({ variantId })).stockQuantity, stockAfterFirstReceipt);
assert.equal(await db.collection("inventory_logs").countDocuments({ returnId }), 1);
```

Assert stock does not change on return creation/approval, is restored once on accepted receipt, and repeated receipt does not change it again. Also assert COD remains pending until completion, mock payment rejects a COD order, one order-history entry exists per valid state transition, stock is not double committed/released, and reports exclude cancelled orders.

- [ ] **Step 2: Run focused workflow tests and record current invariant failures**

Run from `backend/`: `node --test test/order-flows.test.js test/admin-workflows.test.js test/admin-reports.test.js`
Expected: PASS for already-correct invariants; any failures identify a concrete gap before implementation.

- [ ] **Step 3: Fix only failing state/stock invariants with conditional updates and idempotent log writes**

```js
const now = new Date();
const update = { status: req.body.status, updatedAt: now };
const historyEntry = { status: req.body.status, userId: req.user._id, createdAt: now, note: req.body.note || "" };
const saved = await deliveries.findOneAndUpdate(
  { _id: id, status: delivery.status },
  { $set: update, $push: { history: historyEntry } },
  { returnDocument: "after" }
);
if (!saved) throw new HttpError(409, "CONCURRENT_UPDATE", "Delivery was changed by another request");
```

Use the existing status transition maps, conditional state filters, unique/guard fields, and inventory change logs. Preserve the single-node MongoDB compatibility in the spec; do not require a replica set or introduce a transaction dependency. When tests already pass, keep the implementation unchanged and retain the regression tests only.

- [ ] **Step 4: Re-run the workflow and report tests**

Run from `backend/`: `node --test test/order-flows.test.js test/admin-workflows.test.js test/admin-reports.test.js`
Expected: PASS; inventory reservations/stock, histories, return logs, and report totals agree with order states.

- [ ] **Step 5: Commit only Task 4 changes**

```powershell
git add backend/src/services/order-service.js backend/src/routes/admin-deliveries.js backend/src/routes/admin-returns.js backend/src/lib/status.js backend/test/order-flows.test.js backend/test/admin-workflows.test.js backend/test/admin-reports.test.js
git diff --cached --check
git commit -m "fix: keep fulfillment and return stock consistent"
```

Do not stage source files that had no Task 4 change.

## Task 5: Document the contract and verify migration/data safety

**Files:**
- Modify: `API_CONTRACT.md`
- Modify: `backend/scripts/migrate-model.js` only if an additive migration is required by the final address schema.
- Modify: `backend/test/shipping-rates.test.js`
- Modify: `backend/test/seed-safety.test.js` only if seed behavior changes.

**Interfaces:** The API contract documents the public rate list/quote, manager CRUD, checkout request ID and structured region address, server-calculated `deliveryFee`, `SHIPPING_UNAVAILABLE`, legacy-address handling, and demo-only fees/payment/delivery.

- [ ] **Step 1: Add a failing repeatability test for indexes and legacy records**

```js
await db.collection("user_addresses").insertOne({ _id: new ObjectId(), userId, fullAddress: "Old saved address" });
const testConfig = { databaseName: "maison_belle_test_shipping_safety", allowDemoSeed: true };
await seedDemo(db, testConfig);
await createIndexes(db);
await createIndexes(db);
await seedDemo(db, testConfig);
assert.equal((await db.collection("user_addresses").findOne({ userId })).fullAddress, "Old saved address");
assert.equal(await db.collection("shipping_rates").countDocuments({ code: "hcm-demo" }), 1);
```

Import `createIndexes` and `seedDemo` into this test, and use a fixture connected only to `maison_belle_test_shipping_safety`. Add duplicate-key preflight tests for both `shipping_rates.code` and existing string `orders.checkoutRequestId` values per user. Each test verifies the error identifies the conflicting key and both existing records remain untouched. Update the seeded rate to manager-chosen values between the two seed calls and verify the second call preserves its fee, name, and active state.

- [ ] **Step 2: Run the focused safety test and observe its initial failure**

Run from `backend/`: `node --test test/shipping-rates.test.js test/seed-safety.test.js`
Expected: FAIL only if index/migration/seed behavior is not repeatable or safe.

- [ ] **Step 3: Make required migrations/index setup additive and document the final API contract**

```md
POST /api/shipping/quote
{ "regionCode": "hcm-demo" }

POST /api/orders
{ "checkoutRequestId": "...", "items": [...], "paymentMethod": "cod",
  "shippingAddress": { "receiverName": "...", "receiverPhone": "...",
    "fullAddress": "...", "regionCode": "hcm-demo" } }
```

Preflight both new unique indexes before creating either: report duplicate shipping codes and duplicate per-user checkout request IDs without deleting records. Do not backfill historical order totals or force a region onto existing free-form addresses. Update migration behavior only for fields required by new checkout; preserve null/missing region on old addresses until the customer selects one.

- [ ] **Step 4: Run complete backend/frontend tests and local smoke flow**

Run from repository root: `node --test js/*.test.js`
Run from `backend/`: `pnpm test`
Then start the local server with `pnpm dev`, verify `GET /api/health`, and exercise in the browser: guest add/view cart → login → choose configured region → quote → place order → inspect order in admin → transition through delivery → complete/return. Confirm the stored order uses the MongoDB rate even if the browser request is altered. Record unrelated baseline failures separately; do not seed or migrate another database.

- [ ] **Step 5: Commit the contract/safety changes**

```powershell
git add API_CONTRACT.md backend/scripts/migrate-model.js backend/test/shipping-rates.test.js backend/test/seed-safety.test.js
git diff --cached --check
git commit -m "docs: document MongoDB checkout and shipping workflow"
```

Stage only files that changed in Task 5.

## Completion checklist

- [ ] Public active-rate list/quote and manager CRUD are covered by tests.
- [ ] Checkout requires sign-in, keeps/merges cart correctly, and calculates all order amounts server-side.
- [ ] Unsupported shipping region, duplicate submit, insufficient stock, voucher rejection, and partial-write failure leave no leaked reservation or usage.
- [ ] Order/delivery/return/payment snapshots, role checks, and reports agree with the lifecycle.
- [ ] Legacy orders and addresses remain readable; index/seed setup is repeatable and restricted to test/dev databases.
- [ ] Full test results and local smoke results are reported, including any known baseline failures and all remaining demo limitations.
- [ ] No unrelated pending admin-header edits are staged or lost.
