# Maison Belle Admin CRUD, Dashboard và Báo cáo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện khu vực `admin.html` để quản lý dữ liệu MongoDB thật bằng CRUD, dashboard tổng quan và báo cáo thống kê có phân quyền.

**Architecture:** Giữ một admin shell với các view `admin.html?view=...`; frontend chỉ dùng adapter `js/api.js`, backend cung cấp dữ liệu báo cáo đã tổng hợp. CRUD xoá dùng semantics xoá mềm hiện có từ backend, còn đơn hàng/lịch hẹn/kho/giao hàng/đổi trả vẫn là workflow trạng thái.

**Tech Stack:** Node.js 20+, Express 5, MongoDB driver 6, vanilla JavaScript, HTML và CSS hiện có, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-09-maison-belle-admin-crud-dashboard-reports-design.md`

## Global Constraints

- Không gọi MongoDB trực tiếp từ trình duyệt; dùng các adapter trong `js/api.js`.
- Giữ phân quyền `manager`, `sales`, `warehouse` theo backend hiện tại.
- Dữ liệu demo phải được đánh dấu; không seed vào database thật.
- Không thêm thư viện biểu đồ; dùng HTML/CSS/JS hiện có.
- Không sửa giao diện khách hàng ngoài các link cần thiết.
- Mọi thao tác ghi phải khoá nút, hiển thị lỗi và tải lại view sau khi thành công.

---

### Task 1: Mở rộng báo cáo MongoDB với dữ liệu biểu đồ

**Files:**
- Modify: `backend/src/routes/admin-reports.js`
- Create: `backend/test/admin-reports.test.js`

**Interfaces:**
- Produces response fields `data.summary`, `data.dailySales`, `data.orderStatuses`, `data.topProducts`.
- `dailySales` items have `{ date, orderCount, revenue }`.
- `orderStatuses` items have `{ status, count, amount }`.

- [ ] **Step 1: Write the failing integration test**

Seed two non-cancelled orders and one cancelled order in the isolated report test database, call `GET /api/admin/reports?from=2026-10-01&to=2026-10-03` as a manager, and assert the response contains the existing summary/top products plus the exact daily and status aggregates. Assert the cancelled order is absent.

- [ ] **Step 2: Run the focused backend test**

Run from `backend`:

```powershell
$node='C:\Users\kuuhaku\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node --test test/admin-reports.test.js
```

Expected: FAIL because `dailySales` and `orderStatuses` are not returned.

- [ ] **Step 3: Implement the two aggregation pipelines**

Keep the existing match range and cancelled-order filter. Add one aggregation grouped by UTC `YYYY-MM-DD` for daily sales and one grouped by `orderStatus` for status counts and `finalAmount` totals. Sort daily data ascending and statuses by count descending.

- [ ] **Step 4: Run the focused and full backend tests**

```powershell
& $node --test test/admin-reports.test.js
& $node --test
```

Expected: focused and full backend suites pass.

### Task 2: Complete API adapter and pure admin helpers

**Files:**
- Modify: `js/api.js`
- Modify: `js/admin.js`
- Modify: `js/admin.test.js`

**Interfaces:**
- Add `MBApi.admin.catalog.remove(kind, id)` using `DELETE /api/admin/catalog/:kind/:id`.
- Add pure `reportChartData(report)` returning `{ dailySales, orderStatuses, maxRevenue }` with numeric-safe values.
- Add pure `crudActionPayload(action, values)` for product, promotion, voucher and catalog writes.

- [ ] **Step 1: Write failing unit tests**

Add tests for the catalog delete URL, numeric report series normalization, and representative CRUD payloads including `isActive` booleans and numeric money fields.

- [ ] **Step 2: Run focused frontend tests**

```powershell
& $node --test js/api.test.js js/admin.test.js
```

Expected: FAIL for the missing catalog remove method and helper exports.

- [ ] **Step 3: Implement the adapter and helpers**

Keep the helpers side-effect free and export them from the existing CommonJS test surface returned by `admin.js`. Reuse `root.MBApi` for all network operations.

- [ ] **Step 4: Run focused tests**

Expected: all API/admin helper tests pass.

### Task 3: Add real CRUD controls to admin views

**Files:**
- Modify: `js/admin.js`
- Modify: `js/admin.test.js`

**Interfaces:**
- Product rows expose create, edit, soft-delete and status actions.
- Promotion and voucher rows expose create, edit, status and soft-delete actions.
- Master-data rows expose create, edit, status and soft-delete actions for categories and brands.
- Every destructive action uses `window.confirm` with a soft-delete message.

- [ ] **Step 1: Write failing view/action tests**

Assert the rendered admin source includes action names for product, promotion, voucher and catalog removal, and test a confirmation helper that returns false without calling the adapter and true before calling it.

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
& $node --test js/admin.test.js
```

- [ ] **Step 3: Implement minimum CRUD UI**

Add inline `details` edit forms where the backend supports patching. Add `remove-product`, `remove-promotion`, `remove-voucher`, and `remove-catalog` actions to `submitAction`. Use `crudActionPayload` for numeric conversions and call the existing adapter remove methods. Keep order, appointment, inventory, delivery and return operations as status workflows.

- [ ] **Step 4: Verify CRUD views**

Run `js/admin.test.js` and the complete frontend suite. Check that failed requests render the existing Vietnamese error state and successful writes rerender the active view.

### Task 4: Build dashboard and report visual summaries

**Files:**
- Modify: `js/admin.js`
- Modify: `css/operations.css`
- Modify: `js/admin.test.js`

**Interfaces:**
- `dashboardView` renders live KPI cards and top-product data from `/api/admin/reports` and resource counts.
- `reportView` renders filters, summary cards, daily revenue bars, order-status bars and top products.

- [ ] **Step 1: Write failing rendering tests**

Test `reportChartData` with empty and populated reports, asserting zero-safe output and the largest revenue value used for bar widths. Add source-level assertions for `daily-sales-chart`, `order-status-chart`, and report filters.

- [ ] **Step 2: Implement chart markup without dependencies**

Render each series as escaped HTML rows with inline CSS custom property `--bar-width`, labels, counts and formatted money. Use `Math.max(maxRevenue, 1)` to avoid division by zero. Keep loading, empty, error and forbidden states.

- [ ] **Step 3: Add responsive/dark admin styles**

Add `.report-chart`, `.report-bar`, `.report-bar-fill`, and mobile rules to `css/operations.css`; use existing variables and dark-theme colors.

- [ ] **Step 4: Run frontend tests and syntax checks**

```powershell
& $node --test js/*.test.js
Get-ChildItem js -Filter '*.js' | ForEach-Object { & $node --check $_.FullName }
```

Expected: zero test failures and zero syntax errors.

### Task 5: MongoDB dev smoke test and handoff

**Files:**
- No production file changes unless a verified defect is found.

- [ ] **Step 1: Start backend against dev MongoDB**

From `backend`, run `node src/server.js` with the default dev database or explicit `MONGODB_DB=maison_belle_dev`; do not run seed against an unverified database name.

- [ ] **Step 2: Verify manager flows**

Use the running app to call `/api/health`, manager login, dashboard reports, products CRUD, promotions/vouchers CRUD, catalog CRUD and report filters. Confirm soft-deleted records remain inactive.

- [ ] **Step 3: Verify role restrictions**

Confirm sales and warehouse accounts cannot access manager reports/master data and cannot submit writes outside their backend roles.

- [ ] **Step 4: Run final suites and report evidence**

Run the full backend suite, full frontend suite, JavaScript syntax check and endpoint smoke checks. Report changed files, commands, pass counts, and any remaining gaps.
