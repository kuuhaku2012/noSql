# Maison Belle — Admin CRUD, Dashboard và Báo cáo

## Mục tiêu

Hoàn thiện khu vực vận hành cho nhân viên Maison Belle bằng shell `admin.html` hiện có, trong đó mỗi chức năng là một view có URL `admin.html?view=...`. Giao diện phải gọi API MongoDB thật, hiển thị lỗi rõ ràng và giữ phân quyền theo vai trò.

## Phạm vi

- Dashboard tổng quan: bộ lọc ngày/cửa hàng, doanh thu, đơn hàng, sản phẩm bán, tồn kho, voucher, khuyến mãi, giao hàng, sản phẩm bán chạy và thao tác nhanh.
- CRUD sản phẩm: xem danh sách, tìm kiếm/lọc, tạo, sửa, bật/tắt bán và xoá mềm qua API.
- CRUD khuyến mãi và voucher: xem, tạo, sửa các trường được API hỗ trợ, bật/tắt và xoá mềm.
- CRUD danh mục và thương hiệu: xem, tạo, sửa, bật/tắt và xoá mềm; chỉ quản lý được phép ghi.
- Workflow nghiệp vụ: đơn hàng, lịch hẹn, nhập/điều chỉnh kho, giao hàng và đổi trả giữ trạng thái lịch sử; không cho xoá tuỳ tiện.
- Báo cáo: lọc thời gian/cửa hàng, thẻ tổng hợp, doanh thu theo ngày, phân bổ trạng thái đơn, top sản phẩm và bảng dữ liệu chi tiết.

Không tạo cổng thanh toán thật, không thay đổi mô hình MongoDB, không thêm thư viện biểu đồ nếu CSS/HTML đủ để hiển thị các thanh thống kê.

## Phân quyền

- `manager`: toàn bộ dashboard, báo cáo và CRUD được backend cho phép.
- `sales`: sản phẩm, đơn hàng, khách hàng, lịch hẹn, khuyến mãi/voucher, giao hàng và đổi trả theo API.
- `warehouse`: sản phẩm ở mức được backend cho phép, tồn kho, nhập/điều chỉnh kho và giao hàng.
- Báo cáo chi tiết chỉ dành cho `manager`; view bị chặn phải hiển thị trạng thái không đủ quyền.

## Dữ liệu và API

Tận dụng các adapter trong `js/api.js` và route hiện có dưới `/api/admin`. Không gọi MongoDB trực tiếp từ trình duyệt.

Dashboard sử dụng `/api/admin/reports` và các endpoint đếm/danh sách hiện có. Endpoint báo cáo được mở rộng tối thiểu với `dailySales` và `orderStatuses`, vẫn giữ `summary` và `topProducts` để không phá vỡ giao diện hiện tại.

Mọi thao tác ghi phải khoá nút khi gửi, hiển thị lỗi từ `ApiError`, tải lại view sau khi thành công và dùng xoá mềm theo semantics của backend.

## Thiết kế giao diện

- Giữ sidebar, header, role guard và query view hiện tại.
- Mỗi view có vùng lọc/hành động, form ghi dữ liệu và bảng danh sách responsive.
- Xoá phải có xác nhận bằng `window.confirm` và mô tả đây là thao tác ẩn/ngừng dùng dữ liệu.
- Dashboard dùng stat cards và các thanh/tables HTML/CSS để không thêm dependency.
- Báo cáo có trạng thái loading, empty, error và ngày mặc định 30 ngày gần nhất.

## Kiểm thử và nghiệm thu

- Unit test helper: quyền, chuẩn hoá metrics, chuẩn hoá series báo cáo và payload CRUD.
- Backend integration test: response báo cáo có `summary`, `dailySales`, `orderStatuses`, `topProducts`; các route CRUD giữ quyền và xoá mềm.
- Frontend test: mọi view có hook form/bảng, thao tác CRUD gọi đúng API, dashboard/report render dữ liệu thật.
- Smoke test với MongoDB dev: đăng nhập manager, mở dashboard/products/promotions/master-data/reports và thực hiện tối thiểu tạo — sửa — xoá mềm một bản ghi demo.

## Tiêu chí hoàn thành

1. Manager xem được dashboard và báo cáo từ dữ liệu MongoDB dev.
2. Các form CRUD không còn là mô phỏng và gọi đúng endpoint thật.
3. Sales/warehouse không nhìn thấy hoặc không ghi được view ngoài quyền.
4. Dữ liệu demo vẫn được đánh dấu; không seed vào database thật.
5. Test frontend/backend và smoke test dev đạt, không sửa giao diện khách hàng ngoài các link cần thiết.
