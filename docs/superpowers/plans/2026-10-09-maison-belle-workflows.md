# Maison Belle Business Workflow Completion Implementation Plan

> **For agentic workers:** Execute inline in this session, task by task, with a test checkpoint after each task. Use checkbox (`- [ ]`) syntax to track progress.

**Goal:** Complete and verify the customer and staff flows for the ten Maison Belle business workflows described in the project document.

**Architecture:** Keep the current vanilla HTML/CSS/JS frontend, Express API, and MongoDB collections. Add only the missing route/data behavior, expose it through the existing `MBApi` adapter, and render all business state from API responses. Mock payment stays explicitly simulated; no localStorage data substitute, real payment gateway, or carrier integration.

**Tech Stack:** Node.js 20+, Express 5, MongoDB Node driver 6, built-in `node:test`/`assert`, Supertest, browser-native HTML/CSS/JavaScript.

**Spec:** `API_CONTRACT.md`, `api-requests.md`, and `E:\lưu tài liệu\noSql\Nhom7_HoanThien.docx` (ten workflows NV01–NV10); approved implementation scope in this conversation.

## Global Constraints

- Preserve the current project stack and existing in-progress edits; do not replace files wholesale.
- Run integration tests only against a unique `MONGODB_TEST_DB` namespace; never seed, drop, or mutate `maison_belle_dev`.
- Enforce authorization in API routes; UI hiding is supplementary, not security.
- Keep demo/mock records visibly labeled and never present generated dashboard values as real data.
- Keep payment and delivery provider behavior simulated and document that boundary.
- Add a regression test before each production behavior change; observe the expected failure before implementing.
- Do not add a package dependency unless existing Node, Express, MongoDB, or browser features cannot meet the requirement.

---

### Task 1: Catalog references, master-data choices, and appointment availability

**Files:**
- Create: `backend/src/routes/catalog.js`
- Create: `backend/src/routes/admin-catalog.js`
- Modify: `backend/src/routes/products.js`
- Modify: `backend/src/routes/appointments.js`
- Modify: `backend/src/app.js`
- Create: `backend/test/business-completion.test.js`
- Modify: `API_CONTRACT.md`, `api-requests.md`

**Interfaces:**
- `GET /api/catalog` returns active categories and brands for public filters.
- `GET /api/admin/catalog` returns categories, brands, and stores for authorized staff forms.
- `POST/PATCH /api/admin/catalog/:kind[/:id]` creates or updates a category or brand; `kind` is `categories` or `brands`; manager-only.
- `GET /api/products` resolves category ID/slug and brand ID/code/name, returns brand/category names, and validates price ranges.
- `GET /api/appointments/availability?appointmentDate=&startTime=&endTime=` reports time overlap; `POST /api/appointments` rejects invalid ranges and overlapping active appointments.

- [x] Add failing integration assertions for slug/code product filters, invalid price range, category/brand choices, appointment overlap, and invalid start/end time.
- [x] Run `node --test test/business-completion.test.js` with a unique test database and confirm failures are the missing behaviors.
- [x] Implement the minimum route/query changes and mount the routes in `app.js`.
- [x] Re-run the targeted test and `node --check` on changed route files; confirm category/brand/store lookups return actual seeded fixture records.

### Task 2: Customer profile, addresses, loyalty, payment, and invoice data

**Files:**
- Create: `backend/src/routes/customers.js`
- Modify: `backend/src/collections.js`
- Modify: `backend/src/middleware/auth.js`
- Modify: `backend/src/routes/orders.js`
- Modify: `backend/src/services/order-service.js`
- Modify: `backend/src/app.js`
- Modify: `backend/test/business-completion.test.js`
- Modify: `API_CONTRACT.md`

**Interfaces:**
- `GET/PATCH /api/customers/me` reads/updates only the authenticated customer’s safe profile fields.
- `GET/POST/PATCH/DELETE /api/customers/me/addresses[/:id]` manages that customer’s saved addresses.
- `GET /api/customers/me/loyalty` returns membership balance and point history; `GET /api/admin/customers?q=` is available to sales/manager staff.
- Completing an order awards points once; for the demo, accrue `floor(finalAmount / 10,000)` points and record the order reference in `point_histories`.
- `GET /api/orders/:id` includes only that order’s payment, invoice, and status history, subject to existing customer ownership checks.
- `POST /api/orders/:id/payment` accepts `{ outcome: "success" | "failure" }` only for `paymentMethod: "mock"`; retries update the same payment/invoice records instead of duplicating them.

- [x] Add failing tests for own-profile access, cross-customer address isolation, completed-order point accrual/idempotency, mock payment failure then retry success, and exactly one invoice/payment per order.
- [x] Run the targeted integration test and verify each fails for the stated missing behavior.
- [x] Implement routes and service changes using the existing collections; keep `passwordHash`, role secrets, and other private fields out of responses.
- [x] Re-run the targeted test and existing `order-flows.test.js`; check that repeated payment calls never create duplicate records.

### Task 3: Voucher/promotion pricing, returns, deliveries, inventory, and reporting

**Files:**
- Create: `backend/src/routes/promotions.js`
- Create: `backend/src/routes/returns.js`
- Modify: `backend/src/routes/admin-promotions.js`
- Modify: `backend/src/routes/admin-returns.js`
- Modify: `backend/src/routes/admin-deliveries.js`
- Modify: `backend/src/routes/admin-inventory.js`
- Modify: `backend/src/routes/admin-reports.js`
- Modify: `backend/src/services/order-service.js`
- Modify: `backend/src/app.js`
- Modify: `backend/test/business-completion.test.js`
- Modify: `API_CONTRACT.md`, `api-requests.md`

**Interfaces:**
- `GET /api/promotions` returns active, date-valid promotions; the lowest valid promotion price is snapshotted on a new order.
- Existing admin voucher CRUD remains the source of voucher lifecycle; `POST /api/vouchers/validate` remains side-effect free.
- `GET/POST /api/returns` is customer-scoped; `/api/admin/returns` remains staff-scoped. A customer may request return only for their own delivered/completed order and cannot return more than the unreturned purchased quantity.
- `PATCH /api/admin/returns/:id` enforces transitions; stock is restocked once, only when status becomes `received`.
- `PATCH /api/admin/deliveries/:id` records transitions and synchronizes the linked order when delivery becomes delivered.
- Stock receipt validates all input/reference rows before changing any inventory. Reports accept the documented date range and optional store filter.

- [x] Add failing integration assertions for promotion validity/price bounds, return ownership and cumulative quantity, restock-once at `received`, delivery/order synchronization, invalid second receipt line leaving all stock unchanged, and store-filtered report totals.
- [x] Run the targeted integration tests and confirm failures are expected.
- [x] Implement the smallest service/route changes; retain the current API response envelope and error codes.
- [x] Re-run the targeted tests plus `admin-workflows.test.js` and `order-flows.test.js`; inspect inventory, order, and history documents after each transition.

### Task 4: Connect customer and staff screens to the completed API

**Files:**
- Modify: `js/api.js`
- Modify: `js/storefront.js`
- Modify: `js/admin.js`
- Modify: `account.html`, `admin.html`, and, only where selectors are needed, `products.html`/`product.html`
- Modify: `css/operations.css` and `css/flows.css` only for necessary form/table states
- Modify: `js/api.test.js`, `js/admin.test.js`, `js/app.test.js`; create `js/storefront.test.js` only if a behavior cannot be covered by the existing test modules

**Interfaces:**
- Extend `MBApi` only with the routes in the updated API contract; keep the same error handling, credentials behavior, and JSON envelope.
- Customer account supports profile/address update, member points, order details, mock-payment retry, invoice display, cancellation where allowed, and return request.
- Staff screens support customer lookup, product forms with catalog choices, voucher CRUD/status, promotion status, appointment status, stock/store selection, order details, delivery transitions, return transitions, and date/store-filtered reports.
- Remove dead-end navigation entries for unrequested reviews/user administration instead of leaving screens that claim they are implemented; preserve role-appropriate navigation for all ten workflows.
- All screens retain loading, empty, failure, not-found, success, and forbidden states; demo/mock labels remain visible; no silent localStorage fallback is introduced.

- [x] Add failing adapter/UI-logic tests for new endpoint methods, role-filtered navigation, voucher/order status actions, and safe rendering of API values.
- [x] Run `node --test js/*.test.js` and verify the new assertions fail before wiring the UI.
- [x] Connect each form/action to `MBApi`, populate ID selectors from catalog responses, and render the server result or state message.
- [x] Re-run frontend tests and `node --check` for every JavaScript file; verify no unsupported placeholder text remains in the ten workflow screens.

### Task 5: Full verification and live demo

**Files:**
- Verify/update: `API_CONTRACT.md`, `api-requests.md`, `backend/test/business-completion.test.js`, all existing backend/frontend tests.

- [x] Run backend tests with a fresh unique value such as `$env:MONGODB_TEST_DB='maison_belle_codex_20261009_final'; npm test` from `backend/`.
- [x] Run frontend tests with `node --test js/*.test.js` and syntax checks for every frontend/backend JavaScript file.
- [x] Keep the existing port-3000 process untouched because stopping it was blocked; start the integrated demo on port 3001 and verify `/api/health`, HTML/CSS/JS entrypoints, catalog queries, and authenticated read-only samples without mutating `maison_belle_dev`.
- [x] Browser-client import failed with `EPERM`; report that UI automation limitation and the route/test/live-HTTP coverage performed.
- [x] Re-read this plan and API contract, check NV01–NV10 against their routes and screens, and record remaining unsupported/external integrations without claiming they were tested.
