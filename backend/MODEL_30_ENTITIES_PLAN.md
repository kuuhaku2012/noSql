# Model 30 Entities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Hoàn thiện mô hình MongoDB theo mục 2.6.2/2.6.3 với 30 thực thể logic, API bổ sung và dữ liệu demo an toàn.

**Architecture:** Giữ API hiện tại và collection `appointments` làm tên tương thích cho thực thể `Consultations`. Nhúng các dòng có kích thước giới hạn vào cart/order/wishlist/flash-sale/consultation; tách review, recommendation, view, behavior và user voucher thành collection riêng.

**Tech Stack:** Node.js, Express, MongoDB native driver, node:test, Supertest.

**Spec:** `backend/MODEL_30_ENTITIES_DESIGN.md`

## Global Constraints

- Chỉ sửa/tạo trong `backend/` và `API_CONTRACT.md`.
- Không sửa HTML, CSS hoặc JS giao diện.
- Không chuyển MongoDB sang SQL.
- Seed chỉ dùng database dev/test, mọi bản ghi seed có `isDemo: true`.
- Payment/carrier thật không được tích hợp; COD/mock giữ nguyên.
- Mọi API mới phải có validation, authentication/role scope và lỗi JSON thống nhất.

---

### Task 1: Collection registry, index và migration an toàn

**Files:**
- Modify: `backend/src/collections.js`
- Modify: `backend/scripts/create-indexes.js`
- Create: `backend/scripts/migrate-model.js`
- Modify: `backend/scripts/seed.js`
- Test: `backend/test/model-completion.test.js`

**Interfaces:**
- Produces collections `flash_sales`, `consultation_reviews`, `product_recommendations`, `product_views`, `reviews`, `user_behaviors`, `user_vouchers`, `wishlists`.
- Produces migration `migrateModel(db)` that only adds defaults/index-compatible fields and never deletes non-demo documents.

- [ ] Write a failing test that runs `migrateModel` against a clean database and asserts the eight new collections plus required indexes exist.
- [ ] Run `pnpm test -- test/model-completion.test.js`; expect failure because the collections/migration do not exist.
- [ ] Add the collections to `src/collections.js`, add unique/query indexes in `create-indexes.js`, and implement `migrateModel` with non-destructive `$set` defaults.
- [ ] Extend `buildDemoData`/`seedDemo` with demo flash sales, reviews, recommendations, views, behaviors, user vouchers, wishlists and consultation reviews; keep all new documents marked `isDemo: true`.
- [ ] Run focused model test and verify collection/index assertions pass.

### Task 2: Reviews, product recommendations and product engagement

**Files:**
- Create: `backend/src/routes/reviews.js`
- Create: `backend/src/routes/engagement.js`
- Modify: `backend/src/app.js`
- Test: `backend/test/model-completion.test.js`

**Interfaces:**
- `GET /api/products/:id/reviews` lists approved reviews.
- `POST /api/products/:id/reviews` creates an owner-scoped pending review.
- `PATCH /api/reviews/:id` lets the owner edit pending content; sales/manager can moderate.
- `GET /api/products/:id/recommendations` returns active recommendations.
- `POST /api/products/:id/views` records a view for authenticated users.
- `POST /api/behaviors` records an authenticated user behavior event.

- [ ] Add failing tests for approved-review visibility, customer ownership, manager moderation, recommendation lookup and behavior/view writes.
- [ ] Run focused tests and confirm 404/403 failures before implementation.
- [ ] Implement validation for rating 1-5, review text, action type and referenced product IDs; prevent duplicate active recommendation pairs.
- [ ] Mount the routes without changing existing product response shapes.
- [ ] Run focused tests and confirm the new behavior passes.

### Task 3: Wishlist and user voucher workflows

**Files:**
- Create: `backend/src/routes/wishlists.js`
- Create: `backend/src/routes/user-vouchers.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/routes/vouchers.js`
- Test: `backend/test/model-completion.test.js`

**Interfaces:**
- `GET /api/wishlist`, `PUT /api/wishlist`, `DELETE /api/wishlist/items/:productId` manage the owner wishlist with embedded `items`.
- `GET /api/vouchers/mine` lists assigned vouchers for the current user.
- `POST /api/vouchers/claim` claims an active voucher once per user.
- Manager-only `POST /api/admin/user-vouchers` assigns an existing voucher to a user.

- [ ] Add failing tests for wishlist replacement/removal, private ownership, duplicate claim and manager assignment.
- [ ] Run focused tests and verify the expected failures.
- [ ] Implement embedded wishlist item validation and user-voucher state transitions (`available`, `used`, `expired`).
- [ ] Ensure order voucher validation checks an assigned voucher when `user_vouchers` exists, without breaking public voucher validation.
- [ ] Run focused tests and confirm all ownership/role checks pass.

### Task 4: Flash sale and consultation extensions

**Files:**
- Create: `backend/src/routes/admin-flash-sales.js`
- Create: `backend/src/routes/flash-sales.js`
- Modify: `backend/src/routes/appointments.js`
- Modify: `backend/src/app.js`
- Test: `backend/test/model-completion.test.js`

**Interfaces:**
- `GET /api/flash-sales` lists active sales and embedded items.
- `GET/POST/PATCH/DELETE /api/admin/flash-sales` provides manager CRUD with variant references, price and quantity limits.
- Existing appointment APIs accept `products[]` snapshots and expose consultation review data.
- `POST /api/appointments/:id/reviews` creates a review only after a completed consultation.

- [ ] Add failing tests for active flash-sale filtering, invalid sale prices/quantities, manager-only writes and completed-consultation review rules.
- [ ] Run focused tests and confirm the expected failures.
- [ ] Implement flash-sale date/status validation, variant existence checks and soft deactivation.
- [ ] Extend appointment serialization/validation for embedded consultation products and add consultation review route.
- [ ] Run focused tests and verify existing appointment tests remain green.

### Task 5: Contract, seed verification and complete regression suite

**Files:**
- Modify: `API_CONTRACT.md`
- Modify: `backend/test/model-completion.test.js`
- Modify: `backend/scripts/create-indexes.js`

- [ ] Document new endpoints, embedded fields, permissions, indexes and migration/seed commands.
- [ ] Run `pnpm indexes` and `pnpm seed` only against `maison_belle_dev` or a disposable test database.
- [ ] Query MongoDB directly to verify all 30 logical entities are represented and no non-demo records were changed.
- [ ] Run `pnpm test` and syntax checks for every JavaScript file.
- [ ] Run a live API smoke test against the seeded dev database, then report changed files, commands, results and remaining non-real integrations.
