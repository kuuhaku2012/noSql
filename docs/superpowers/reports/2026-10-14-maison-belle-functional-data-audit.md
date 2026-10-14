# Maison Belle functional/data audit

Date: 2026-10-14

Scope: existing customer, admin/staff, support, fulfillment, and reporting behavior; no visual redesign or new feature work.

## Outcome

The audit found and fixed three reproduced runtime defects, strengthened regression coverage for customer ownership and replay behavior, and corrected stale admin test expectations. No further failing assertion appeared in the final full test suites. This is not a claim that every role × endpoint × state combination has been exhaustively tested; the remaining coverage boundaries are listed below.

### Reproduced issues fixed

1. **Restricted admin navigation could still render for staff.** The `hidden` property was set for inaccessible links, but the author `.side-link { display:flex }` style kept them visible. `js/admin.js` now applies `display:none` when the current role cannot access a link and clears that inline override for allowed roles. A test was added before the fix and failed on the missing `display:none`; after the fix, role navigation tests passed. Server-side authorization was not changed.
2. **Split return lines could partially restock a variant.** Return receipt processed duplicate lines for the same variant separately. The first line added the return replay marker, causing the next line to miss the guarded update. A test reproduced stock 5 instead of 7 for accepted quantities 1+2. The route now aggregates quantities by variant before one guarded increment, marker, and inventory log. Replay assertions check stock, version, return marker, log, and stored return remain unchanged on retry.

The admin baseline tests also had outdated expectations for a removed chart host and soft-delete label. Those were updated to match the current API/rendering contract; they were stale tests, not additional runtime defects.

3. **A failed return audit-log insert could be silently skipped on retry.** The inventory increment and `receivedReturnIds` marker could persist while `inventory_logs.insertOne()` failed. Because the return was already marked received, a retry previously skipped that marker and returned without repairing the log. The retry path now checks for the per-return/per-variant log and inserts it only when missing, without changing stock again. Two integration regressions cover failure before insert and insert-applied/ACK-lost cases.

## Change preservation and review scope

The worktree already contained user changes when this audit began. They were preserved; the audit did not stage, commit, push, reset, or discard files. At audit completion, `git status` showed zero staged entries and HEAD remained `aa2e863`. This linked worktree's unstaged `git diff` command returned `fatal: this operation must be run in a work tree`; therefore the independent final reviewer could not verify exact VCS diff boundaries. It reviewed the scoped task packages and current source/test hunks directly, and reported that attribution limitation.

## Verification

- Admin focused suite: `node --test js/admin.test.js` — 35 passed, 0 failed.
- Report API focused suite: `node --test test/admin-reports.test.js` — 1 passed, 0 failed.
- Full frontend suite: `node --test js/*.test.js` — 100 passed, 0 failed.
- Full backend suite: `pnpm test` — 117 passed, 0 failed, 0 skipped. It used the isolated local MongoDB endpoint `mongodb://127.0.0.1:27019` with test prefix `maison_belle_test_audit`; test files derive their own test database names. A first sandboxed report-test attempt was blocked at the localhost connection boundary (`EACCES`); rerunning the same test against that isolated endpoint with approved local-network access passed.
- No non-test database was seeded or migrated. At audit completion, no files were staged, committed, or pushed. Existing user/worktree edits outside the audit hunks were preserved.

## Browser and data reconciliation

The isolated demo server ran on port 3002, separate from the user's existing port 3001 tab. Manager, sales, and warehouse sessions were smoke-tested for role-appropriate navigation and direct-route denial. Warehouse stock was increased by one and reversed to the original value. A sales promotion and a manager shipping-rate test record were soft-deactivated in the isolated UI database; the manager rate remained “Ngừng áp dụng” after reload.

The manager dashboard showed 2 non-cancelled orders totaling 913,000₫ and 3 units. Its order snapshot values reconcile to completed 289,000₫ plus pending 624,000₫. Both were created on 2026-10-13 UTC. Item snapshots reconcile to Madagascar Centella Ampoule: 2 units / 578,000₫ and Calm Eye Cream: 1 unit / 310,000₫. The focused report fixture additionally verifies cancelled orders are excluded from summary, daily sales, status, and product aggregates.

## Remaining limits

- The admin role tests are representative, not an exhaustive role × HTTP method × endpoint Cartesian matrix. Task 2's review package records manager-success and allowed staff-positive cases that lack dedicated assertions.
- Previously received historical split-line returns that were already partially restocked are not repaired; no historical data migration/reconciliation was authorized.
- Return inventory updates and inventory-log inserts remain separate MongoDB writes. Crash recovery between those writes and concurrent receipt interleavings are not established by these tests.
- Ownership/replay checks are sequential. They do not prove every simultaneous claim, review, transition, or role-change interleaving. Two concurrent retries can still race between checking for a missing return log and inserting it, potentially creating duplicate logs.
- Browser smoke covers manager/sales/warehouse role views and representative safe operations, not every admin interaction. Consultation and warranty UI event paths retain the limits documented in the Task 3 evidence report; warranty lookup currently examines only the first 100 listed orders.

## Final-review follow-up

The independent whole-audit review identified an additional return-receipt log failure path. A test-first sequential retry fix repairs a missing log without re-incrementing stock; a second regression preserves an already-inserted log after a lost acknowledgement. The scoped re-review marked the Important finding addressed and found no new Critical/Important breakage. Concurrent retries may still race between lookup and insert; that Minor limitation remains explicit and no transaction/outbox/saga was added.

Detailed evidence: [Task 2 role review](2026-10-14-maison-belle-admin-support-task-2-review.md), [Task 3 evidence](../../.superpowers/sdd/2026-10-13-maison-belle-audit-admin-support/task-3-report.md), and the progress ledger under the plan's ignored SDD workspace.
