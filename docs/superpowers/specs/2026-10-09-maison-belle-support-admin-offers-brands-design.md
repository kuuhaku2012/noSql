# Maison Belle Support, Admin, Offers and Brands Design

## Mục tiêu

Hoàn thiện bốn khu vực giao diện cho đồ án Maison Belle: bảo hành/hỗ trợ, quản trị cửa hàng, ưu đãi và thương hiệu. Giao diện sử dụng REST API Node.js hiện có qua cùng origin và không kết nối trực tiếp MongoDB.

## Phạm vi giao diện

### Bảo hành và hỗ trợ

Giữ `warranty.html` làm trang đích. Bổ sung:

- Form tra cứu đơn hàng theo mã đơn.
- Khu vực hiển thị chi tiết trạng thái đơn, thanh toán, hóa đơn và lịch sử nếu người dùng đã đăng nhập và có quyền xem.
- Hướng dẫn đổi trả theo trạng thái đơn hàng.
- Nút mở `account.html#appointments` để đặt lịch hỗ trợ.
- Trạng thái loading, lỗi, không tìm thấy và chưa đăng nhập.

Tra cứu sẽ dùng danh sách đơn của tài khoản hiện tại hoặc chi tiết đơn sau khi xác thực; không tạo endpoint tra cứu công khai làm lộ dữ liệu đơn hàng.

### Admin

Giữ `admin.html` và cơ chế `?view=` hiện có. Hoàn thiện các view hiện tại bằng API thật:

- Dashboard: tổng quan đơn hàng, doanh thu, tồn kho thấp và dữ liệu báo cáo.
- Sản phẩm: danh sách và CRUD sản phẩm/variant.
- Đơn hàng/hóa đơn: trạng thái, chi tiết, payment/invoice.
- Tồn kho: tồn hiện tại, nhập kho, điều chỉnh.
- Voucher/khuyến mãi: tạo, cập nhật, tạm dừng/kích hoạt.
- Giao hàng/đổi trả: tạo và chuyển trạng thái.
- Báo cáo: lọc theo cửa hàng/ngày.

Không tạo dashboard song song; sửa các view và API adapter hiện có để tránh trùng logic.

### Ưu đãi

Tạo `offers.html` dùng layout storefront hiện tại. Trang lấy dữ liệu từ `/api/promotions`, `/api/flash-sales` và `/api/products?sale=1`, hiển thị:

- Banner/heading ưu đãi.
- Card chương trình đang hoạt động.
- Grid sản phẩm giảm giá.
- Empty/loading/error state.
- Link đến chi tiết sản phẩm và thêm vào giỏ theo flow hiện có.

### Thương hiệu

Tạo `brands.html`, lấy danh sách brand từ `/api/catalog`, hiển thị card thương hiệu và link đến `products.html?brand=<brand code|slug|id>`. Trang sản phẩm hiện tại tiếp tục xử lý query `brand`, không tạo bộ lọc thứ hai.

## Files

- Modify: `warranty.html`, `admin.html`, `products.html`, `index.html` và header/nav/footer liên quan.
- Create: `offers.html`, `brands.html`.
- Modify: `js/api.js`, `js/app.js`, `js/storefront.js`, `js/admin.js`.
- Modify: `css/style.css`, `css/flows.css`, `css/operations.css` khi cần style responsive.
- Create/modify tests: `js/*.test.js`.

## Tiêu chí nghiệm thu

1. Mở `/warranty.html`, `/offers.html`, `/brands.html`, `/admin.html` khi backend chạy đều không có lỗi JavaScript.
2. Offers và brands render dữ liệu từ API, không hard-code danh sách nghiệp vụ.
3. Warranty tra cứu được đơn của user đăng nhập và dẫn tới appointment.
4. Admin không gọi API nếu user không có role phù hợp; lỗi 401/403 hiển thị rõ.
5. Loading, empty, error state có cho mỗi trang mới.
6. Frontend test và backend test đều xanh.
7. Responsive không làm vỡ desktop storefront hiện có.
