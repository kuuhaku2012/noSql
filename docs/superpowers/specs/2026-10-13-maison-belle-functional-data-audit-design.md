# Maison Belle Functional and Data Audit Design

**Date:** 2026-10-13
**Status:** Draft for user review
**Scope:** Audit and repair existing application behavior and data workflows; no visual redesign or new business features.

## Goal

Determine what is still broken or unsafe in the existing Maison Belle project, repair verified in-scope defects, and re-run the relevant tests and user journeys. The audit covers the current storefront, backend API, MongoDB persistence, and admin/support workflows. It must preserve existing user changes and must not expose or mutate non-test business data.

## Scope and constraints

### Included

- Storefront behavior: catalog browsing, search/filter/sort, product detail, guest cart, account registration/login, guest-cart merge, checkout, order history, and customer-facing order actions.
- Commerce lifecycle: authoritative pricing, promotions/vouchers, shipping-rate lookup, inventory reservation, duplicate submission protection, payment/delivery demo states, cancellation, returns, and reporting.
- Admin and staff behavior: authentication and role enforcement, existing CRUD operations, inventory, fulfillment, shipping-rate management, returns, and reports.
- Existing support features: appointments/consultations, reviews, wishlist/engagement, warranty, and customer/address workflows where implemented.
- MongoDB and startup safety: collections/indexes, additive and repeatable migrations, seed restrictions, compatibility with legacy records, and consistency of persisted snapshots.
- Frontend-to-API contracts and interaction tests. This includes whether controls and forms perform the right action, but excludes visual polish.

### Excluded

- Visual redesign, layout, color, typography, or animation work.
- New business features or changing the previously approved demo rules.
- Real payment, shipping-carrier, email, OTP, or production integrations.
- Pushing to GitHub or changing remote repository state.
- Running seeds, migrations, or destructive operations against any database not explicitly identified as a disposable test database.

The existing Express/MongoDB architecture and role names remain in place. Guest cart use remains available before login; sign-in is required to submit an order. Backend values remain authoritative for prices, vouchers, inventory, and demo shipping rates. Payment and delivery remain simulated.

## Audit approach

Audit by independently testable business slices, while tracing each slice end-to-end across browser code, API routes/services, MongoDB records, and admin views:

1. **Storefront and identity:** browse/search/filter, product detail, guest cart mutations, registration/login, and guest-to-account cart merge.
2. **Checkout and order lifecycle:** shipping quote, authenticated checkout, totals, stock and voucher effects, retry/idempotency, order history, staff transitions, delivery, cancellation, payment simulation, and returns/restocking.
3. **Admin and support:** permissions and CRUD, catalog/inventory/master data, shipping rates, appointments, reviews, wishlist/engagement, warranty, and reports.
4. **Persistence and operational safety:** migration/index/seed repeatability, legacy data compatibility, error compensation, and startup/test configuration.

For each slice, map the UI action to its API contract and expected database changes. Record actual defects separately from outdated or incomplete tests. Fix only behavior that violates the existing contract or an already approved requirement. Where a defect is confirmed, first add a regression test that fails for the defect, then implement the smallest safe correction and rerun the slice tests.

Prioritize findings in this order:

1. Data loss/corruption, unauthorized access, overselling, duplicate orders, or non-idempotent financial/inventory effects.
2. Broken end-to-end business flows or disagreement between backend records, customer views, and admin reports.
3. Validation, error handling, legacy compatibility, and repeatability gaps.
4. Non-visual usability or test-harness issues that prevent reliable verification.

Do not change behavior solely to satisfy an obsolete test assertion. If a test double or expected selector/API contract is stale, establish the real browser/API behavior and update the test to reflect the intended contract.

## Test and data-safety design

1. Capture `git status` and test baselines before edits. Treat every existing modified or untracked file as user-owned; do not reset, checkout, broadly rewrite, or stage unrelated changes.
2. Inspect scripts/configuration without printing secrets. Confirm the actual Node and MongoDB runtime and whether the app/test services can start; do not install software unless the required environment is confirmed absent and installation is necessary for an approved test.
3. Run the frontend suite (`node --test js/*.test.js`) and backend suite (`pnpm test` from `backend/`) as the baseline. Confirm integration fixtures select dedicated test databases before running them.
4. For each slice, run focused tests, add missing regression coverage for verified gaps, then rerun the full frontend and backend suites.
5. When the local runtime is available, smoke the reachable flows against a dedicated disposable MongoDB test database. Verify persisted records as well as HTTP/browser outcomes. Never substitute a production or valued local database for the test fixture.
6. If a flow cannot be exercised because a service, dependency, test account, or browser automation capability is unavailable, document the exact unverified flow and blocker; do not report it as passed.

Preliminary context from the latest available frontend run is 100 tests with 95 passing and 5 failing. Those failures appeared related to a casing assertion, report selectors that no longer match the current markup, a DOM mock missing `append()`, and navigation test doubles missing `getBoundingClientRect()`. This is a lead for baseline investigation, not a conclusion that the product is correct or that the tests should simply be changed. Re-run the suite before making any judgment.

## Preservation and delivery

The audit must preserve the current worktree, including its existing commerce, storefront, and admin-related modifications. No push is part of this task. Code changes are limited to verified in-scope fixes and tests. The final report will list findings, fixes, test evidence, flows that could not be verified, and any remaining demo limitations.

## Acceptance criteria

- Every implemented customer, support, admin, and persistence domain is inventoried against its routes, services, frontend callers, and available tests.
- Confirmed defects have regression coverage; behavior remains consistent across frontend, API, and persisted records.
- Security/role, cart merge, checkout, stock/voucher, retry, order/delivery/return, migration, seed, and reporting invariants have explicit tests or an identified reason they cannot be tested.
- The full frontend and backend test suites are run after fixes, and all failures are either resolved or reported with their exact cause and scope.
- End-to-end smoke coverage is run on isolated test data wherever the runtime permits; unavailable flows are clearly distinguished from passed flows.
- No unrelated changes are lost, no non-test data is seeded/migrated/deleted, no visual redesign is included, and nothing is pushed to a remote.
