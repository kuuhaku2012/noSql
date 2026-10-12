# Task 5 report — API contract and additive data safety

## Scope and implementation

- Updated `API_CONTRACT.md` with the validated shipping, checkout/idempotency, legacy-address, payment, delivery, and return contracts. The contract states that MongoDB is authoritative and inactive/unsupported regions are rejected rather than made free.
- Added isolated MongoDB regression fixtures in `backend/test/seed-safety.test.js` for duplicate shipping codes and per-user string checkout keys, verifying preflight diagnostics, unchanged original records, and absence of either unique index on failure. Added repeated index/migration/seed checks for legacy address, order, payment, and order-history preservation.
- Added the shipping-code duplicate preflight to `backend/scripts/create-indexes.js`, before any unique-index creation. The TDD failure demonstrated that existing setup otherwise reached MongoDB's index build and failed with a generic duplicate-key error. No migration change was needed.
- Existing `backend/test/shipping-rates.test.js` already verifies that re-seeding preserves a manager-edited fee, display name, and active state, with one seeded record per code; it was included in focused verification and did not need modification.

## TDD and verification evidence

1. Before the implementation change, the new focused safety test failed on duplicate `shipping_rates.code`: index creation reported MongoDB `E11000` instead of the required preflight error. The other four seed-safety tests passed in that red run. Initial test startup also needed a `NODE_PATH` workaround for the repository's cached pnpm virtual-store dependencies; no package manifest or dependency files were changed.
2. A first green attempt exposed a fixture-only issue: MongoDB has no namespace to list indexes for a collection that has not been created. The fixture was corrected to create empty collections before asserting that no unique indexes were added; production code was not changed for this issue.
3. Final focused run, after the fixture/assertion hardening: `node --test --test-concurrency=1 test/shipping-rates.test.js test/seed-safety.test.js` — **15 passed, 0 failed**. It used only the isolated local MongoDB server and `MONGODB_TEST_DB=maison_belle_test_t5`; tests add process-specific suffixes and clean only their exact test databases.
4. Full backend suite: `pnpm test` — **89 passed, 0 failed**.
5. Frontend suite: `node --test js/*.test.js` — **93 passed, 6 failed**. The failures are the known baseline UI-test failures: home intro blur/overlay, admin CRUD soft-delete controls, report chart containers, theme icon/accessibility label, product-category nav indicator, and category-menu close behavior. No frontend files were changed.
6. Independent verification supplied by the controller: the focused Task 5 suite on `maison_belle_test_t5_controller_1013` — **15/15 passed, exit 0**. This is recorded as controller-provided evidence, not as a run by this agent.

## Isolation and handoff

The agent's runs used a temporary local MongoDB 8.3.8 server bound to `127.0.0.1:27017`, with only `maison_belle_test_t5_*` databases. No test, seed, or migration used `maison_belle_dev` or configured service data. The temporary server was stopped and its temporary data directory removed. The application dependency workaround used the existing cached pnpm packages only.

No browser/local smoke flow was run. No push or merge was performed. The unrelated pre-existing untracked plan file `docs/superpowers/plans/2026-10-12-maison-belle-mongodb-commerce-workflows.md` was preserved and excluded from the Task 5 commit.
