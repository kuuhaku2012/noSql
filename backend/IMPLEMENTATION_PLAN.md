# Maison Belle Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a small Node.js/Express/MongoDB backend for the ten Maison Belle workflows while leaving the existing frontend files unchanged.

**Architecture:** Use Express routes backed by the native MongoDB driver. Keep validation and workflow rules in small pure modules, keep snapshots inside orders, and use references for independently managed entities. Serve the parent static site from the same process after API routes.

**Tech Stack:** Node.js LTS, Express, MongoDB native driver, bcryptjs, jsonwebtoken, cookie-parser, node:test, and the native `fetch` API.

**Spec:** `backend/DESIGN.md`

## Global Constraints

- Only create or modify files in `backend/` and the root `API_CONTRACT.md`.
- Do not modify existing HTML, CSS, or JavaScript frontend files.
- Use MongoDB; do not introduce SQL or a relational ORM.
- Seed only the dev database named by `MONGODB_DB`; demo data must be marked `isDemo: true`.
- Do not integrate a real payment gateway or carrier; use COD and mock payment/delivery states.
- API errors use `{ error: { code, message, details }, requestId }`.
- New behavior is covered by a test written and observed failing before the implementation.

## File Map

- `backend/package.json`: scripts and runtime/test dependencies.
- `backend/.env.example`: safe local configuration defaults.
- `backend/src/config.js`: environment parsing and frontend-root resolution.
- `backend/src/db.js`: MongoClient lifecycle and collection access.
- `backend/src/app.js`: Express app factory, middleware, static serving, and route mounting.
- `backend/src/server.js`: process entry point and graceful shutdown.
- `backend/src/lib/*.js`: pure validation, errors, pagination, status, and calculation rules.
- `backend/src/middleware/*.js`: request ID, authentication, authorization, and error handling.
- `backend/src/routes/*.js`: HTTP endpoints grouped by business area.
- `backend/scripts/create-indexes.js`: idempotent index creation.
- `backend/scripts/seed.js`: explicitly demo-only seed data.
- `backend/test/*.test.js`: unit and API integration tests.
- `API_CONTRACT.md`: Vietnamese endpoint contract, demo credentials, and run commands.

### Task 1: Scaffold the backend and test harness

**Files:** Create `backend/package.json`, `backend/.env.example`, `backend/src/config.js`, `backend/src/db.js`, `backend/src/app.js`, `backend/src/server.js`, `backend/test/health.test.js`.

**Interfaces:** `createApp({ db, config })` returns an Express app; `connectDatabase(config)` returns `{ client, db }`; `getConfig(env)` returns validated configuration.

- [ ] Write a health test that creates the app with a small in-memory collection stub and expects `GET /api/health` to return status `200` and `{ data: { status: "ok" } }`.
- [ ] Run `npm test -- --test-name-pattern="health"` from `backend/`; observe failure because the package and app do not exist.
- [ ] Add the minimal package scripts: `start`, `dev`, `test`, `seed`, and `indexes`; use Express, mongodb, bcryptjs, jsonwebtoken, cookie-parser, and supertest only where needed by tests.
- [ ] Implement configuration defaults for `PORT=3000`, `MONGODB_URI=mongodb://127.0.0.1:27017`, `MONGODB_DB=maison_belle_dev`, `JWT_SECRET=change-me-in-development`, and `ALLOW_DEMO_SEED=false`.
- [ ] Implement the app factory with JSON parsing, request IDs, API routing placeholder, JSON 404 handling, and static serving from the parent frontend root.
- [ ] Run the health test and confirm it passes without changing frontend files.

### Task 2: Add pure business rules with TDD

**Files:** Create `backend/src/lib/errors.js`, `backend/src/lib/validation.js`, `backend/src/lib/pagination.js`, `backend/src/lib/status.js`, `backend/src/lib/vouchers.js`, `backend/test/rules.test.js`.

**Interfaces:** `HttpError`, `validateBody(schema, body)`, `parsePagination(query)`, `assertTransition(flow, from, to)`, and `calculateVoucher(voucher, subtotal, now)`.

- [ ] Write tests for positive quantity validation, invalid ObjectId rejection, bounded pagination, allowed/forbidden order transitions, expired voucher rejection, minimum-order rejection, percentage discount capping, and fixed discount capping.
- [ ] Run the focused rules test and observe failure because the rule modules do not exist.
- [ ] Implement only the rules needed by the tests with structured `HttpError` instances and stable error codes.
- [ ] Run the focused rules test and confirm all rule cases pass.

### Task 3: Implement MongoDB indexes and demo seed

**Files:** Create `backend/src/collections.js`, `backend/scripts/create-indexes.js`, `backend/scripts/seed.js`, `backend/test/seed-safety.test.js`.

**Interfaces:** `collections(db)` returns named collection handles; `createIndexes(db)` returns the created index names; `seedDemo(db, config)` rejects unsafe databases and inserts demo records.

- [ ] Write tests that reject seeding when `MONGODB_DB` contains `prod` or `production` without `ALLOW_DEMO_SEED=true`, and that every inserted user/product/voucher carries `isDemo: true`.
- [ ] Run the focused seed safety test and observe failure because the scripts do not exist.
- [ ] Implement collection names matching the design: users, roles, stores, brands, categories, products, product_variants, inventories, carts, orders, order_histories, appointments, vouchers, promotions, deliveries, returns, invoices, payments, inventory_logs, memberships, point_histories.
- [ ] Implement idempotent indexes for identity, catalog, stock, carts, orders, vouchers, appointments, and history dates.
- [ ] Implement demo records: roles, one store, four users, twelve products/variants, categories, brands, inventory, one active voucher `BELLE10`, and one promotion. Hash demo passwords with bcryptjs.
- [ ] Run the focused seed safety test and confirm it passes. Do not run seed against a non-dev database.

### Task 4: Authentication and product/catalog APIs

**Files:** Create `backend/src/middleware/auth.js`, `backend/src/middleware/errors.js`, `backend/src/routes/auth.js`, `backend/src/routes/products.js`, `backend/src/routes/admin-products.js`, `backend/test/auth-products.test.js`.

**Interfaces:** `authenticate`, `requireRoles(...roles)`, `signSession(user)`, `GET /api/products`, `GET /api/products/:id`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, and admin catalog methods.

- [ ] Write API tests for product search, product detail, invalid login, successful demo login, `/me`, logout, customer access denial for admin writes, and sales access to catalog writes.
- [ ] Run the focused API test and observe failure because routes and middleware do not exist.
- [ ] Implement cookie JWT auth, password verification, product filters/sort/page/limit, product detail with variants and inventory summary, and role checks.
- [ ] Implement catalog create/update validation for product fields, category/brand references, and unique variant SKU.
- [ ] Run the focused API test and confirm all cases pass.

### Task 5: Cart, voucher, appointments, and orders

**Files:** Create `backend/src/routes/cart.js`, `backend/src/routes/vouchers.js`, `backend/src/routes/appointments.js`, `backend/src/routes/orders.js`, `backend/src/services/order-service.js`, `backend/test/orders.test.js`.

**Interfaces:** `loadCart`, `replaceCart`, `calculateOrderDraft`, `createOrder`, `transitionOrder`, and the contract endpoints for cart, voucher, appointments, and orders.

- [ ] Write tests for replacing a cart, rejecting quantity zero, validating `BELLE10`, creating a COD order with immutable item snapshots, rejecting insufficient stock, customer-only order listing, valid status transition, and forbidden customer transition.
- [ ] Run the focused order test and observe failure because the service and routes do not exist.
- [ ] Implement cart ownership by user/session, voucher calculation, atomic inventory reservation with a non-negative availability filter, rollback on failed order insert, order snapshots, order history, mock payment, and status transition rules.
- [ ] Implement appointment ownership/staff access and requested/confirmed/cancelled/completed transitions.
- [ ] Run the focused order test and confirm all cases pass against a dedicated MongoDB test database.

### Task 6: Inventory, promotions, deliveries, returns, invoices, and reports

**Files:** Create `backend/src/routes/admin-inventory.js`, `backend/src/routes/admin-promotions.js`, `backend/src/routes/admin-deliveries.js`, `backend/src/routes/admin-returns.js`, `backend/src/routes/admin-reports.js`, `backend/test/admin-workflows.test.js`.

**Interfaces:** Staff-protected admin routes from the contract; each write appends the relevant inventory/order/delivery/return history document.

- [ ] Write tests for warehouse-only stock receipt and adjustment, negative-stock rejection, promotion create/update, delivery create, return create, manager-only reports, and report totals excluding cancelled orders.
- [ ] Run the focused admin test and observe failure because the routes do not exist.
- [ ] Implement inventory receipt/adjustment with atomic updates and `inventory_logs`, promotion CRUD, delivery workflow records, return records, invoice/payment visibility, and manager report aggregations.
- [ ] Mount all routes under `/api/admin` and enforce the role matrix from the design.
- [ ] Run the focused admin test and confirm all cases pass.

### Task 7: Contract, smoke checks, and final verification

**Files:** Create root `API_CONTRACT.md`, `backend/test/smoke.test.js`; modify only backend files if a verification defect is found.

- [ ] Write smoke tests for `/api/health`, `/`, `/products.html`, JSON 404, and validation error shape.
- [ ] Run smoke tests and observe any missing route or static-root failure.
- [ ] Write the Vietnamese API contract with authentication, headers/cookies, request/response examples, status codes, role matrix, demo credentials, seed/index commands, and explicit COD/mock limitations.
- [ ] Run `npm test` from `backend/` with a dedicated test database and confirm the full suite has zero failures.
- [ ] Run `npm run indexes` against the dev database and confirm index creation output.
- [ ] Run a manual smoke request to the live server for `/api/health` and `/products.html`.
- [ ] Compare changed paths with the user constraint and confirm no HTML, CSS, or JS file changed.
