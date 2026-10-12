# Maison Belle MongoDB Commerce Workflows Design

**Date:** 2026-10-12
**Status:** Draft for user review
**Scope:** Complete the existing demo commerce flow across storefront, MongoDB API, and admin operations without replacing the current database model.

## Goal

Make the current MongoDB-backed demo behave as one coherent commerce system: a guest can browse and maintain a cart, sign in at checkout, receive a server-calculated shipping quote, place an order against current product/voucher/stock data, and follow that order through staff fulfillment, delivery, completion, or returns. Admin operations and reports must reflect those same persisted records.

This is a staged completion of the existing Express/MongoDB application, not a rewrite of all collections or a CRUD screen for every collection.

## Current project context

The repository already contains MongoDB collections and APIs for users, catalog, variants, inventories, carts, orders and histories, vouchers/promotions, deliveries, returns, invoices/payments, customer addresses, memberships, and reports. The frontend already stores a guest cart locally and merges it into the authenticated cart after sign-in. Authentication is required to create an order.

The main commerce gap identified during design is shipping: checkout currently sends `deliveryFee: 0`, the order service accepts a fee from the request, and the delivery area is represented inside a free-form address string. Shipping rates are not a persisted/admin-managed business rule. Payment and carrier operations are explicitly demo/mock only.

## Decisions

- Keep the existing Express application, MongoDB driver, collections, route conventions, and role names.
- Preserve guest browsing and cart use. Require sign-in only when submitting an order; merge the guest cart into the user's MongoDB cart after sign-in.
- The backend is authoritative for product prices, promotions, vouchers, stock availability, and shipping fees.
- Use manager-maintained, demo-only shipping rates by configured province/city. A location without an active rate cannot be ordered to; it must never silently become free shipping.
- Keep COD and mock payment, and mock delivery. Do not connect real payment providers, carriers, OTP, or email in this scope.
- Preserve historical orders and addresses. Schema changes are additive and migrations are repeatable; no collection reset or destructive rewrite.
- Keep existing user changes in the working tree separate from this design/spec and later implementation commits.

## Architecture and data model

### Shipping rate data

Add a `shipping_rates` MongoDB collection. Each record contains:

```js
{
  _id,
  code,             // stable normalized key used by checkout
  regionName,       // configured province/city label
  fee,              // demo VND amount; no client-supplied override
  isActive,
  createdAt,
  updatedAt,
  updatedByUserId
}
```

Create a unique index on `code` and an index for active rates. The rate table is a demo configuration, not a carrier quote or a claim about real shipping prices. No free-shipping threshold or carrier/ETA integration is introduced.

Add a partial unique compound index on `{ userId: 1, checkoutRequestId: 1 }` for orders with a string `checkoutRequestId`. This makes retries idempotent without requiring changes to historical orders that predate the field.

Provide a public read endpoint for active supported regions and a quote endpoint that accepts a region code. Admin CRUD for rates is manager-only. The quote is informational; order creation re-reads the active rate and recalculates it server-side to avoid trusting a stale or forged browser value.

### Addresses and order snapshots

New checkout and saved-address data include structured `regionCode` and `regionName` for the selected province/city; the street/full-address text remains available. Existing saved addresses without a region code remain intact and prompt the customer to choose a supported region before checkout. Existing order address and fee snapshots are not rewritten.

Orders retain the existing `deliveryFee` field for compatibility, populated from the server-side rate. The order also snapshots the selected region/rate metadata so later admin edits cannot change historical totals. Product line, discount, voucher, and shipping values stored in the order remain immutable snapshots for history and reporting.

## Commerce lifecycle

1. A guest browses, adds, edits, and views cart items. Guest cart is kept in browser storage; it is not treated as inventory reservation.
2. At sign-in, guest items merge by variant and size into the MongoDB user cart, then the guest copy is cleared only after a successful merge.
3. Checkout collects recipient, phone, street address, and a configured province/city. The UI requests a shipping quote and displays it separately from the item subtotal.
4. On order submission, the backend validates the authenticated user, active variants/products, current prices/promotions, voucher eligibility and usage limits, active shipping rate, and available stock. Client values for price, discount, totals, and shipping fee are ignored/rejected.
5. The backend atomically reserves each inventory row using a conditional update, then writes the order snapshots, status history, payment, and invoice records. A checkout request identifier, unique per authenticated user and checkout attempt, prevents retries/double clicks from creating duplicate orders. If a multi-document step fails, completed writes and reservations are compensated; histories must not claim success for an order that was rolled back.
6. Staff process orders with the existing status flow: `pending → confirmed → processing → shipped → delivered → completed`, including allowed cancellations and the separate return workflow. Delivery status changes must stay consistent with order status. Stock is committed once on completion; cancellation releases reservations once. Return stock is restocked only after staff records receipt and acceptance of the returned items.
7. COD remains unpaid until staff completes/records receipt of the order. Mock payment can be simulated only for orders using the mock method. Invoice/payment records remain marked as demo data and are not tax or bank records.
8. Manager reports aggregate persisted order snapshots and exclude cancelled orders according to the existing report contract.

## Permissions

Keep the current role matrix and middleware conventions:

- Guest: public catalog and guest cart only.
- Customer: own cart, addresses, orders, loyalty, wishlist, and reviews; may cancel only an eligible pending order.
- Sales: customer/order support, catalog sales operations, promotions/vouchers, deliveries, and returns as already defined by the API contract.
- Warehouse: inventory receipts/adjustments and assigned fulfillment/delivery operations.
- Manager: all existing admin permissions, shipping-rate configuration, and reports.

No client-provided role is trusted. Every admin write, including shipping-rate changes, is tested for both allowed and denied roles.

## Consistency and failure handling

Use atomic conditional MongoDB updates for each inventory row and for status transitions. Retain compatibility with the current local MongoDB setup rather than requiring an external provider or a database replacement. For operations spanning multiple documents, use explicit compensating actions that are safe to retry; test partial failures, concurrent checkout, reservation release, voucher usage rollback, and repeated status updates. A repeated checkout request with the same idempotency key returns the original order result rather than consuming stock or a voucher twice.

Migration/index setup must be idempotent. Before creating new unique indexes, detect conflicting existing values and stop with a clear report; never silently delete or merge business records. Run migrations and seeds only against explicitly identified dev/test databases, with a backup before applying to any valued local dataset.

## Implementation stages

1. **Checkout and shipping foundation:** add shipping-rate collection/indexes and safe demo records; add active-rate listing/quote and manager CRUD; structure checkout/address region fields; remove client authority over delivery fee.
2. **Order correctness:** enforce server-side checkout totals, idempotency, stock/voucher rollback, and status/return consistency; preserve guest-cart merge and authentication boundary.
3. **Admin and customer integration:** connect shipping-rate management, display quote and saved region in checkout, ensure order detail/history and admin lists show consistent snapshots.
4. **Acceptance and data safety:** run focused tests, full backend and frontend suites, migration repeatability checks on a dedicated test database, and browser/API end-to-end smoke flows. Report any behavior still simulated.

## Verification and acceptance criteria

- Guest can add/change/remove/view cart without signing in; signing in merges matching items without losing or duplicating them.
- A guest can reach checkout but cannot create an order before signing in; after sign-in, checkout resumes with its cart.
- Active configured regions receive a server-calculated quote. Unknown/inactive regions cannot create orders and do not reserve stock or consume vouchers.
- Forged client prices, discounts, totals, or delivery fees cannot affect the created order.
- Successful checkout creates one order with correct item/rate/voucher snapshots, history, payment/invoice demo records, and stock reservations.
- Duplicate requests, insufficient inventory, expired/overused vouchers, and injected write failures do not create duplicate orders, oversell stock, or leak voucher uses/reservations.
- Role authorization, state transitions, cancellation, delivery completion, return receipt/restock, and reporting are covered by integration tests.
- Migrations/indexes can run repeatedly on the dedicated test database, preserve legacy addresses/orders, and fail safely on unique-index conflicts.
- Run full existing backend and frontend suites and a browser/API smoke test on the local app. All in-scope tests must pass with no regressions; identify any unrelated pre-existing failures separately rather than concealing them. No test or seed is run against a non-dev database.

## Explicitly out of scope

- Real payment processing, card data, bank callbacks, carrier labels/tracking/quotes, OTP/SMS/email delivery, tax invoices, and production deployment.
- Replacing MongoDB, introducing SQL/ORM, rebuilding the entire admin dashboard, or exposing every collection as generic CRUD.
- Destructive migrations, clearing the existing database, or publishing/pushing the repository.
