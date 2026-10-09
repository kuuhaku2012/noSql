# Maison Belle theme/admin UI implementation plan

> **For the implementation agent:** Follow this plan task-by-task. Run the specified verification after each task.

**Goal:** Đồng bộ theme sáng/tối toàn hệ thống và làm admin shell gọn, dễ vận hành, không thay đổi API/business logic.

**Architecture:** Thêm `css/theme.css` làm lớp theme cuối trên toàn bộ HTML; bổ sung hook collapse vào `admin.html`, trạng thái sidebar vào `js/admin.js`, và style vận hành/chart vào lớp theme dùng chung.

**Testing:** Node built-in test runner hiện có, `node --check` cho JS và smoke test localhost bằng browser runtime.

### Task 1: Khóa các hook giao diện bằng test trước

**Files:** `js/storefront-layout.test.js`

- Thêm test xác nhận các trang đều load `css/theme.css`.
- Thêm test xác nhận admin có hook sidebar compact và chart hook đang dùng.
- Chạy test để thấy trạng thái đỏ trước khi triển khai.

### Task 2: Thêm theme stylesheet dùng chung

**Files:** `css/theme.css`, các HTML page trong project root

- Định nghĩa token surface/input/table/state/chart cho light/dark.
- Chuẩn hóa font và các component thường bị hard-code màu.
- Gắn stylesheet sau stylesheet hiện có trên toàn bộ page.

### Task 3: Triển khai sidebar admin compact

**Files:** `admin.html`, `js/admin.js`, `css/operations.css` hoặc `css/theme.css`

- Thêm nút thu gọn desktop và cấu trúc label/icon có title.
- Lưu/khôi phục trạng thái `mb-admin-sidebar`.
- Đảm bảo mobile drawer hiện tại vẫn hoạt động.

### Task 4: Căn chỉnh dashboard/report chart

**Files:** `css/theme.css`, `js/admin.js` nếu cần

- Tăng tương phản track/fill/legend/badge ở hai theme.
- Giữ biểu đồ doanh thu và trạng thái đơn từ API hiện có, không thêm dependency.

### Task 5: Verification

- Chạy `node --test js/*.test.js`.
- Chạy syntax check toàn bộ JS.
- Nếu backend đang chạy, smoke test admin dashboard ở localhost bằng browser và kiểm tra light/dark + compact sidebar.
