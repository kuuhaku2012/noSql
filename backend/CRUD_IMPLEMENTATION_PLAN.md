# Maison Belle CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Bổ sung CRUD MongoDB thật cho các resource quản trị mà không thay đổi frontend.

**Architecture:** Mở rộng các route Express hiện có, dùng soft-delete cho catalog/voucher/promotion và status transition cho delivery/return. Reuse validation, auth, serialization và native MongoDB driver hiện có.

**Tech Stack:** Node.js, Express, MongoDB native driver, node:test, Supertest.

**Spec:** `backend/CRUD_DESIGN.md`

## Global Constraints

- Chỉ sửa/tạo trong `backend/` và `API_CONTRACT.md`.
- Không sửa HTML, CSS hoặc JS giao diện.
- Không dùng SQL hoặc dữ liệu giả trong bộ nhớ.
- Seed demo chỉ chạy database dev riêng và mọi record demo có `isDemo: true`.
- Không tích hợp payment gateway/carrier thật; COD/mock giữ nguyên.

### Task 1: CRUD catalog và variants

**Files:**
- Modify: `backend/src/routes/admin-products.js`
- Test: `backend/test/crud.test.js`

- [x] Viết test đỏ cho GET/POST/PATCH/DELETE product, cập nhật variant, từ chối delete khi customer, giữ dữ liệu sau soft-delete.
- [x] Chạy focused test để xác nhận thiếu endpoint hoặc hành vi.
- [x] Implement validation variant và soft-delete product/variants trên MongoDB.
- [x] Chạy focused test và full suite.

### Task 2: CRUD vouchers và promotions

**Files:**
- Create: `backend/src/routes/admin-vouchers.js`
- Modify: `backend/src/app.js`, `backend/src/routes/admin-promotions.js`
- Test: `backend/test/crud.test.js`

- [x] Viết test đỏ cho voucher CRUD, unique code, số tiền/ngày hợp lệ và promotion DELETE soft-disable.
- [x] Implement route quản trị và mount dưới `/api/admin/vouchers`.
- [x] Giữ `/api/vouchers/validate` chỉ đọc dữ liệu active.
- [x] Chạy focused test và full suite.

### Task 3: Delivery và return state CRUD

**Files:**
- Modify: `backend/src/routes/admin-deliveries.js`, `backend/src/routes/admin-returns.js`, `backend/src/lib/status.js`
- Test: `backend/test/crud.test.js`

- [x] Viết test đỏ cho PATCH status hợp lệ, transition sai, role không đủ quyền.
- [x] Implement transition map và PATCH handlers có audit fields.
- [x] Chạy focused test và full suite.

### Task 4: API contract và verification

**Files:**
- Modify: `API_CONTRACT.md`

- [x] Document all CRUD methods, soft-delete semantics, request bodies, permissions and status transitions.
- [x] Chạy `pnpm test`, syntax checks, index script và live smoke trên database test riêng.
- [x] Xác nhận không có file frontend bị thay đổi.
