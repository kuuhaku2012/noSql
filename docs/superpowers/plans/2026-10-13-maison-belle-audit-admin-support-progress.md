# Admin and Support Audit Progress

Plan: [2026-10-13-maison-belle-audit-admin-support.md](2026-10-13-maison-belle-audit-admin-support.md)

## Task 2 — role matrix and admin write workflows

Status: completed for the approved Task 2 API and UI verification scope. The report records endpoint-specific coverage limits; this does not claim a four-role test for every route and method.

Round history:

- Initial backend baseline: 25/25 passed.
- Round 1 backend result: 26/26 passed.
- Round 2 baseline for `model-completion.test.js` and `shipping-rates.test.js`: 15/15 passed.
- Round 2 updated two-file focused result: 16/16 passed.
- Final six-file backend result: 42/42 passed.
- Final full frontend result: 100/100 passed after the role-navigation visibility fix.

Round 2 closed the review findings by checking product count immediately after the anonymous denial, checking scoped inventory log counts after denied stock adjustments, and adding manager-only denial/no-mutation checks for flash sales, recommendations/admin behavior reads, user-voucher assignment, and shipping-rate writes. Those manager-only checks cover anonymous, sales, warehouse, and customer requests.

No server-side route/middleware authorization or persistence defect reproduced in the audited API cases. Browser smoke found and reproduced a frontend visibility defect: CSS kept links rendered despite their `hidden` property. Added a focused regression assertion, observed the expected red failure, then fixed `js/admin.js`; independent review approved the two-hunk change. Sales dashboard/inventory/master-data links now compute to `display:none`, and direct unauthorized inventory navigation remains denied. Warehouse navigation shows its allowed products/inventory/delivery views and direct dashboard remains denied. The isolated warehouse stock smoke increased Calm Eye Cream stock by 1 then reversed it by 1; it returned to 50 with one held and 49 available. No backend route/middleware source or CSS was changed. No stage, commit, or push was performed.

Detailed route evidence, exact commands/results, and remaining endpoint-specific limits: [Task 2 review package](../reports/2026-10-14-maison-belle-admin-support-task-2-review.md).

## Task 3 — support and fulfillment workflows

Status: complete for the approved support/ownership/replay scope. The review approved the implementation with no findings requiring changes. Final isolated verification is recorded in the Task 3 evidence report under the plan's ignored SDD workspace.

- Found a concrete repeated-line return receipt defect: duplicate variant lines were processed separately, so the first line's replay marker caused later lines to be skipped. A failing-first integration test reproduced stock 5 instead of expected 7.
- Fixed by totaling accepted return quantities per variant before one guarded inventory update. Regression verifies full stock restoration, exactly one version increment/marker/log, and unchanged inventory, return, and log state on replay.
- Added customer ownership/privacy tests for appointments, consultation/product reviews, wishlists, and voucher claims; strengthened delivery and return replay checks.
- Verification: focused regression RED then GREEN; required backend support suite 37/37; frontend/API support suite 50/50. No production seed or migration was run. No stage, commit, or push.
- Explicit residual limits: no historical repair for prior under-restocked returns, no crash-atomic guarantee across inventory/log writes, and no concurrency guarantee from sequential replay tests.

## Task 4 — admin/staff smoke and report reconciliation

Status: complete for the approved functional/data audit scope. The final Important review finding was fixed and the scoped re-review passed; one concurrency limitation is deferred below.

- Focused report API `node --test test/admin-reports.test.js`: 1/1 passed. Focused admin `node --test js/admin.test.js`: 35/35 passed.
- Isolated manager browser dashboard values reconcile to persisted order snapshots: 2 non-cancelled orders and 913,000₫, composed of completed 289,000₫ plus pending 624,000₫; all three item units match product totals and daily sales on 2026-10-13 UTC. The report fixture test confirms cancelled orders are excluded.
- Manager shipping rate was soft-deactivated in test-only UI data and remained deactivated after reload. Earlier manager/sales/warehouse smoke verified their allowed menus/direct-route denials; warehouse stock was adjusted then reversed, and sales promotion status persisted in the test-only database.
- Final full suites: frontend `node --test js/*.test.js` — 100/100; backend `pnpm test` with `MONGODB_URI=mongodb://127.0.0.1:27019`, `MONGODB_TEST_DB=maison_belle_test_audit` — 115/115. The sandbox first denied the focused report connection with `EACCES`; rerunning against the same isolated test endpoint with approved local-network access passed. No non-test DB seed or migration was run.
- The final whole-audit review found an Important gap: when stock+receipt marker persist but inventory-log insertion fails, retry could skip the missing log. A test-first fix adds sequential retry log repair without stock duplication; the scoped re-review marked it ADDRESSED and found no new Critical/Important breakage. No transaction/saga/migration.
- Final post-fix suites: `node --test js/*.test.js` — 100/100; backend `pnpm test` on the isolated Mongo test prefix — 117/117. The report counts two expected injected write/ACK errors, whose assertions passed.
- Minor deferred limitation: simultaneous retries can race between checking for a missing log and inserting it, potentially creating duplicate logs. Concurrency coordination was outside the approved sequential retry scope.
- No stage, commit, or push.
