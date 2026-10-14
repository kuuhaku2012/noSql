# Maison Belle Admin and Support Workflow Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify admin/staff permissions and existing catalog, inventory, appointment, promotion, voucher, delivery, return, engagement, warranty, and reporting workflows.

**Architecture:** Retain the current admin dashboard, Express routes, role middleware, and collections. Validate actions and persisted effects rather than changing the visual design; reconcile test expectations with the current supported UI/API contract.

**Tech Stack:** Node.js >=20, browser JavaScript, Express 5, MongoDB Node driver 6, Supertest, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-13-maison-belle-functional-data-audit-design.md`

## Global Constraints

- Keep the current role names and server-side authorization; never trust client-provided roles.
- Keep existing demo rules and route contracts; no new features or visual redesign.
- Use an isolated MongoDB test instance for integration tests and preserve existing user changes.
- Do not seed/migrate non-test databases and do not push changes to a remote.

**Prerequisite:** Complete the persistence-safety plan's isolated MongoDB setup and URI-fixture correction before running the backend tests in this plan.

---

### Task 1: Establish admin frontend baseline and repair stale assertions

**Files:**
- Modify: `js/admin.test.js`
- Inspect: `js/admin.js`, `admin.html`

**Interfaces:**
- Consumes: current `canAccess`, `defaultView`, report rendering, and CRUD-action helpers in `js/admin.js`.
- Produces: tests that assert supported visible actions and report hooks instead of removed labels/IDs.

- [x] **Step 1: Run the current admin tests**

Run from repository root:

```powershell
node --test js/admin.test.js
```

Expected: record exact baseline failures; the latest available full run reported an obsolete delete-label assertion and obsolete chart container identifiers.

- [x] **Step 2: Verify the soft-delete action in the current rendered source**

Run `rg -n -C 2 'remove-promotion|Xóa|XÓA|confirm\(' js/admin.js js/admin.test.js`. Confirm the user-facing label is the current Vietnamese `Xóa` and the operation remains a confirmed soft-delete action.

- [x] **Step 3: Replace the casing-only assertion with semantic behavior**

Update `admin CRUD views expose soft-delete actions with confirmation` to assert each supported `remove-*` action is present and the confirmation handler is wired. Assert the current visible label as `Xóa`; do not change product copy to uppercase to satisfy the old regex.

- [x] **Step 4: Align report chart assertions with the actual report contract**

Run `rg -n 'admin-report-charts|daily-sales-chart|order-status-chart|report-detail-panel|renderReportCharts' js/admin.js js/admin.test.js`. Update `admin report view renders chart containers for live report series` to assert the current `#admin-report-charts` host and the data produced by `reportChartData`; remove only selectors proven absent from the current report implementation.

- [x] **Step 5: Rerun admin frontend tests**

Run `node --test js/admin.test.js`. Expected: all functional admin assertions pass without layout/style changes.

### Task 2: Verify role matrix and admin write workflows in API and UI

**Files:**
- Test: `js/admin.test.js`, `js/api.test.js`, `backend/test/auth-products.test.js`, `backend/test/crud.test.js`, `backend/test/entity-crud.test.js`, `backend/test/admin-workflows.test.js`
- Inspect: `js/admin.js`, `js/api.js`, `backend/src/middleware/auth.js`, `backend/src/routes/admin-*.js`

**Interfaces:**
- Consumes: manager, sales, warehouse, and customer sessions; existing admin view access and route methods.
- Produces: verified read/write authorization and consistent client-to-route requests for supported admin operations.

- [x] **Step 1: Run admin API integration tests on the isolated database**

From `backend/`, with the test-only MongoDB URI and prefix, run:

```powershell
node --test test/auth-products.test.js test/crud.test.js test/entity-crud.test.js test/admin-workflows.test.js
```

Expected: permitted roles can perform supported operations, forbidden roles receive the documented authorization error, and soft-deactivation preserves records.

- [x] **Step 2: Run frontend role and API-client tests**

From the repository root run:

```powershell
node --test js/admin.test.js js/api.test.js
```

Expected: manager/staff views match the role matrix and API client methods use the documented endpoints, HTTP verbs, and typed payloads.

- [x] **Step 3: Add a missing-denial regression test before any middleware change**

If a route has no negative-role test, add one beside that route's current test in `backend/test/crud.test.js`, `backend/test/entity-crud.test.js`, or `backend/test/admin-workflows.test.js`. Authenticate as a customer or the nearest non-authorized staff role, invoke the exact write route, and assert a denied status plus unchanged collection state.

- [x] **Step 4: Fix only a reproduced authorization or client-contract defect**

If the regression fails, update the owning route/middleware or API-client method; do not relax `requireRoles` and do not add client-side role trust. Rerun the single test before the full Task 1/2 commands.

### Task 3: Verify support and fulfillment workflows

**Files:**
- Test: `backend/test/business-completion.test.js`, `backend/test/model-completion.test.js`, `backend/test/admin-workflows.test.js`, `backend/test/crud.test.js`, `js/api.test.js`, `js/admin.test.js`, `js/warranty-page.test.js`
- Inspect: `backend/src/routes/appointments.js`, `reviews.js`, `wishlists.js`, `engagement.js`, `user-vouchers.js`, `admin-deliveries.js`, `admin-returns.js`, `js/consultation.js`, `js/warranty-page.js`

**Interfaces:**
- Consumes: existing appointment, review, wishlist, recommendation/behavior, voucher, delivery, return, and warranty APIs.
- Produces: verified ownership boundaries, allowed status transitions, and one-time persisted effects for the current support features.

- [x] **Step 1: Run the support workflow integration tests**

Run from `backend/`:

```powershell
node --test test/business-completion.test.js test/model-completion.test.js test/admin-workflows.test.js test/crud.test.js
```

Expected: appointment ownership/overlap, review moderation, wishlist privacy, voucher claims, delivery transitions, and return receipt/restock assertions pass.

- [x] **Step 2: Run support frontend/API tests**

Run `node --test js/api.test.js js/admin.test.js js/warranty-page.test.js`. Expected: consultation/admin actions map to existing routes and warranty lookup/status copy follows the current order state.

- [x] **Step 3: Cover only concrete uncovered ownership or replay gaps**

For an uncovered customer-owned resource, add a test that creates the record as customer A, reads or mutates it as customer B, and asserts denial plus unchanged data. For a repeated state transition, assert the second request does not add duplicate history or inventory logs. Run the new test first and observe the failing assertion before any route edit.

- [x] **Step 4: Rerun targeted support tests**

Rerun the Task 3 commands. Expected: all existing support flows pass and no status or role transition is broadened.

### Task 4: Smoke admin and staff views and reconcile reports

**Files:**
- Inspect: `admin.html`, `js/admin.js`, `backend/src/routes/admin-reports.js`
- Test: `backend/test/admin-reports.test.js`, `js/admin.test.js`

**Interfaces:**
- Consumes: isolated test server and test-only manager/sales/warehouse accounts.
- Produces: observed role-appropriate views and report metrics matching stored non-cancelled orders.

- [x] **Step 1: Run report API and chart-data tests**

Run from `backend/`: `node --test test/admin-reports.test.js`; then from the repository root: `node --test js/admin.test.js`.

- [x] **Step 2: Browser-smoke role-specific operations**

On the isolated test server, sign in as manager, sales, and warehouse in separate sessions. Confirm each sees only supported views; exercise one safe demo CRUD/status action per role and verify its persisted result.

- [x] **Step 3: Reconcile report values against fixture orders**

Create or use the test fixture's completed/shipped/cancelled orders. Confirm report order count, revenue, product totals, daily sales, and statuses include the intended orders and exclude cancelled orders.

- [x] **Step 4: Run all frontend and backend tests**

Run `node --test js/*.test.js` from the repository root and `pnpm test` from `backend/` with the isolated URI/prefix. Report all remaining failures by exact test name and owner plan.
