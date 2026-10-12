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

## Task 5 fix round 1 — Important review finding

> Finding (Important): backend/scripts/create-indexes.js currently filters shipping_rates preflight to code values of BSON type string, while the unique single-field index on code also indexes null and missing values as the same key. Two legacy documents with missing/null code bypass preflight; index creation then fails with generic E11000 after earlier unique indexes may already have been created. Add a regression using colliding missing/null shipping code values, verify the actionable duplicate preflight identifies both IDs and leaves records and all relevant unique-index state untouched; demonstrate red before changing production code. Then implement the smallest fix so the shipping-rate preflight matches unique-index key semantics. Keep the per-user string checkoutRequestId partial-index behavior unchanged.

Root cause verified: the non-sparse `{ code: 1 }` unique index groups absent and null code values under the same null key. The regression inserts one absent `code` and one explicit `code: null`, checks both `_id`s in the preflight error, asserts both documents unchanged, and asserts no custom unique index was created. The minimal production fix removes only the shipping-code `$type: "string"` match; grouping by `$code` now preflights missing/null collisions. The checkoutRequestId string filter and partial index are unchanged.

The test runs used MongoDB 8.3.8 bound to `127.0.0.1:27018` with disposable worktree data, and only test DBs under the short `maison_belle_test_*` prefix. PowerShell setup for the commands below set `NODE_PATH` to the existing `backend/node_modules/.pnpm/*/node_modules` directories and set `MONGODB_URI=mongodb://127.0.0.1:27018`.

### RED — before the production change

Exact test command and prefix:

```powershell
$env:MONGODB_TEST_DB = 'maison_belle_test_t5_round1_1013'
node --test --test-concurrency=1 test/seed-safety.test.js
```

Output:

```text
✔ demo seed rejects production-looking database names (18.1036ms)
✔ demo seed records are explicitly marked (284.2929ms)
✔ demo users omit empty unique phone values (262.1135ms)
✔ create-index setup preflights both unique keys before creating either index (83.2993ms)
✖ create-index setup preflights missing and null shipping codes as the same unique key (299.6565ms)
✔ seed and additive migration are repeatable and preserve legacy addresses and order history (1682.3882ms)
ℹ tests 6
ℹ suites 0
ℹ pass 5
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2881.3789

AssertionError [ERR_ASSERTION]: The input did not match the regular expression /shipping_rates\.code/i. Input:
'Index build failed: a85fde43-0804-4190-8916-821d7dc63551: Collection maison_belle_test_t5_round1_1013_15572_seed_safety.shipping_rates ( 110880dc-0655-444b-97db-907b30d6d7ad ) :: caused by :: E11000 duplicate key error collection: maison_belle_test_t5_round1_1013_15572_seed_safety.shipping_rates index: code_1 dup key: { code: null }'
```

### GREEN — after the production change

Exact focused command and fresh short prefix:

```powershell
$env:MONGODB_TEST_DB = 'maison_belle_test_r1'
node --test --test-concurrency=1 test/shipping-rates.test.js test/seed-safety.test.js
```

Output:

```text
✔ demo seed rejects production-looking database names (15.3334ms)
✔ demo seed records are explicitly marked (269.1135ms)
✔ demo users omit empty unique phone values (262.2004ms)
✔ create-index setup preflights both unique keys before creating either index (77.6847ms)
✔ create-index setup preflights missing and null shipping codes as the same unique key (36.594ms)
✔ seed and additive migration are repeatable and preserve legacy addresses and order history (1831.4887ms)
✔ shipping-rate test databases use the configured prefix and isolate each process (662.3668ms)
✔ collections exposes the shipping_rates collection (0.2577ms)
✔ public rate list includes active configured regions only (6.8257ms)
✔ public quote resolves only an active configured region (14.3027ms)
✔ manager can list, create, update, and soft-deactivate shipping rates (31.3588ms)
✔ shipping-rate reads are manager-only (7.3066ms)
✔ shipping-rate writes require manager role and validate unique codes and fees (39.1282ms)
✔ shipping rate indexes enforce unique codes and support active-region queries (3.1354ms)
✔ rerunning demo seed preserves manager-edited shipping rates (894.0475ms)
✔ seeded shipping-rate codes cannot be renamed and seed reruns keep deactivation (355.0194ms)
ℹ tests 16
ℹ suites 0
ℹ pass 16
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5370.0304
```

Complete backend suite command: `pnpm test` (same isolated MongoDB URI and `maison_belle_test_r1` prefix). Result: **90 passed, 0 failed**, duration `6797.0641ms`. The initially attempted longer prefix generated a 64-character shipping-test database name and was rejected by MongoDB; the focused suite was rerun successfully with the shorter prefix above. An initial non-elevated MongoDB server/client attempt timed out and is not counted as test evidence; the valid red and green runs used the isolated server and elevated loopback test process.
