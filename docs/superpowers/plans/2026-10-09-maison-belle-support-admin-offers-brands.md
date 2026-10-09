# Maison Belle Support Admin Offers Brands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Hoàn thiện trang bảo hành, admin, ưu đãi và thương hiệu bằng API Node.js/MongoDB thật.

**Architecture:** Reuse các layout, API adapter và view router hiện có. Tạo hai trang storefront mới (`offers.html`, `brands.html`), mở rộng `warranty.html` và hoàn thiện view trong `admin.html`; không cho frontend truy cập MongoDB trực tiếp.

**Tech Stack:** HTML, CSS, vanilla JavaScript, REST API cùng origin, Node.js test runner.

**Spec:** `docs/superpowers/specs/2026-10-09-maison-belle-support-admin-offers-brands-design.md`

## Global Constraints

- Frontend gọi API bằng `credentials: same-origin` qua `js/api.js`.
- Không hard-code dữ liệu sản phẩm, brand, promotion hoặc order trong giao diện.
- Giữ các endpoint backend và layout storefront/admin đang tồn tại.
- Hiển thị lỗi API, loading và empty state thay vì để màn hình trắng.
- Không dùng payment gateway/carrier thật.

---

### Task 1: API adapter và test helpers

**Files:**
- Modify: `js/api.js`
- Test: `js/api.test.js`

- [ ] Viết test đỏ cho các method `promotions.list`, `flashSales.list`, `catalog.list`, `orders.get` và `reports.get`.
- [ ] Chạy `node --test js/api.test.js` và xác nhận fail vì method chưa tồn tại.
- [ ] Thêm method adapter theo pattern `MBApi` hiện có, giữ query/body serialization và error handling.
- [ ] Chạy lại test API adapter.

### Task 2: Trang thương hiệu và ưu đãi

**Files:**
- Create: `brands.html`
- Create: `offers.html`
- Modify: `index.html`, `products.html`, `js/storefront.js`, `css/flows.css`
- Test: `js/storefront-layout.test.js`, create `js/catalog-pages.test.js`

- [ ] Viết test đỏ cho brand link query, offer data mapping và empty state.
- [ ] Chạy focused frontend tests để xác nhận thiếu trang/render helper.
- [ ] Tạo `brands.html` theo header/nav/footer hiện tại; render `/api/catalog` và link brand bằng code/slug/id.
- [ ] Tạo `offers.html`; render promotions, flash sales, sale products và link sản phẩm.
- [ ] Cập nhật nav/header/footer để dẫn đến `brands.html` và `offers.html` mà không bỏ các query link cũ.
- [ ] Chạy test focused và kiểm tra DOM/static script references.

### Task 3: Trang bảo hành và tra cứu đơn

**Files:**
- Modify: `warranty.html`, `js/app.js`, `js/storefront.js`, `css/flows.css`
- Test: create `js/warranty.test.js`

- [ ] Viết test đỏ cho normalize order detail, trạng thái tra cứu và hướng dẫn đổi trả theo order status.
- [ ] Chạy focused test và xác nhận fail.
- [ ] Thêm form tra cứu theo mã đơn cho user đăng nhập; gọi `orders.list` rồi `orders.get` khi khớp.
- [ ] Render order status/payment/invoice/history, hướng dẫn đổi trả và CTA appointment.
- [ ] Bổ sung loading, empty, unauthorized và API error states.
- [ ] Chạy focused test và kiểm tra warranty route bằng server thật.

### Task 4: Hoàn thiện dashboard admin

**Files:**
- Modify: `admin.html`, `js/admin.js`, `css/operations.css`
- Test: `js/admin.test.js`

- [ ] Viết test đỏ cho dashboard summary mapping và view permission mapping.
- [ ] Chạy focused admin tests để xác nhận fail.
- [ ] Kết nối dashboard với `/api/admin/reports`, hiển thị KPI và cảnh báo tồn kho thấp.
- [ ] Bổ sung các form/list còn thiếu cho voucher, promotion, delivery, return, inventory và reports bằng `MBApi.admin`.
- [ ] Hiển thị trạng thái forbidden/unauthorized và giữ điều hướng `?view=`.
- [ ] Chạy focused admin tests và static route smoke test.

### Task 5: Full verification

**Files:**
- Modify: `API_CONTRACT.md` nếu có endpoint/UI behavior mới cần ghi chú.
- All changed frontend files.

- [ ] Chạy toàn bộ frontend tests bằng `node --test js/*.test.js` hoặc lệnh tương đương PowerShell.
- [ ] Chạy toàn bộ backend tests `pnpm test`.
- [ ] Chạy syntax check toàn bộ JS.
- [ ] Khởi động backend và kiểm tra HTTP 200 cho bốn trang cùng các API chính.
- [ ] Kiểm tra không có lỗi console blocking trên các trang mới.
