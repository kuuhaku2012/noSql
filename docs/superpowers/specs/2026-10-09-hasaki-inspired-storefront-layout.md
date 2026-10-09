# Maison Belle — Bố cục storefront lấy cảm hứng từ Hasaki

## Mục tiêu

Làm quen thuộc luồng mua sắm ở trang chủ, danh sách sản phẩm, chi tiết sản phẩm và giỏ hàng theo cách tổ chức của Hasaki, nhưng giữ bộ nhận diện Maison Belle cao cấp, biên tập và có hiệu ứng glass/ánh kim vừa phải. Đây là tham khảo cấu trúc UX, không sao chép thương hiệu hay tài nguyên Hasaki.

## Phạm vi

- Chỉ các trang khách hàng: `index.html`, `products.html`, `product.html`, `cart.html`, cùng header chung trên `account.html`.
- Không restyle khu vực nhân viên/kho/quản lý (`admin.html`). Giữ URL và shape API hiện hành; chỉ thay cách trình bày dữ liệu sẵn có.
- Giữ HTML/CSS/JS thuần, adapter `js/api.js`, stylesheet hiện hữu; không thêm dependency.

## Bố cục

### Header dùng chung

- Dải thông điệp ngắn, không tạo khuyến mãi hoặc con số giả.
- Hàng chính: logo, ô tìm kiếm nổi bật, lối tắt tài khoản và giỏ hàng có số lượng.
- Hàng danh mục: trang chủ, chăm sóc da, trang điểm, chăm sóc cơ thể, sản phẩm/nhãn hàng và khuyến mãi.
- Bỏ link quản trị khỏi điều hướng storefront; trang nhân viên vẫn truy cập trực tiếp tại `admin.html`.
- Mobile: menu danh mục dạng drawer; tìm kiếm và nút giỏ hàng vẫn dễ dùng.

### Trang chủ

- Giữ hero kể chuyện Maison Belle.
- Đặt danh mục ngay dưới hero, tiếp theo là các dải sản phẩm lấy từ API và lời mời đặt lịch tư vấn.
- Không gọi sản phẩm là bán chạy/được yêu thích nếu API không cung cấp thứ hạng. Chỉ dùng nội dung trung tính như “Tuyển chọn từ cửa hàng”.
- Giữ nhãn `DỮ LIỆU MINH HỌA` cho bản ghi demo; trạng thái tải/rỗng/lỗi tiếp tục hiển thị rõ.

### Danh mục sản phẩm

- Breadcrumb và tiêu đề/dữ liệu kết quả ở đầu trang.
- Bộ lọc danh mục, thương hiệu, loại da, khoảng giá; bộ sắp xếp; lưới sản phẩm và phân trang.
- Desktop: bộ lọc bên trái, kết quả bên phải. Mobile: bộ lọc mở/đóng thành ngăn trượt, không che mất nút đóng hoặc kết quả.
- Giữ query/API hiện có, gồm tìm kiếm, sale, phân trang và trạng thái không có kết quả.

### Chi tiết sản phẩm

- Breadcrumb; ảnh lớn bên trái, thông tin và khối mua hàng bên phải.
- Giá, biến thể, số lượng và tồn kho chỉ lấy từ API; lựa chọn biến thể cập nhật đồng bộ giá/tồn.
- Nút thêm giỏ dùng API cart hiện có; thông tin mô tả, thành phần/cách dùng và gợi ý cùng danh mục nằm dưới khối mua.
- Không hiển thị rating/review giả hoặc tồn kho ước lượng.

### Giỏ hàng

- Bước tiến trình giỏ → giao hàng → xác nhận; danh sách dòng hàng cạnh khối tổng kết.
- Số lượng, xóa, voucher và tạo đơn giữ nguyên các endpoint đang có.
- Khối tổng kết sticky trên màn hình rộng, chuyển xuống dưới danh sách trên mobile; phí giao hàng không được quảng bá là miễn phí nếu backend chưa xác nhận.
- Giỏ trống, dữ liệu không còn hợp lệ, lỗi API và đơn tạo thành công có trạng thái riêng.

## Hệ thống hiển thị

- Dùng typography serif hiện có cho tiêu đề, sans hiện có cho thao tác; nền kem/rose/gold Maison Belle.
- Glass/ánh sáng tập trung vào header, thẻ tài khoản/khối mua; không làm giảm tương phản hoặc che chữ.
- Chuyển động chậm, theo trạng thái hover/reveal; không nhấp nháy; tắt/giảm với `prefers-reduced-motion`.
- Responsive ở màn hình rộng, tablet và điện thoại; điều khiển có nhãn/keyboard focus.

## Kiểm chứng

- Kiểm tra syntax và test JavaScript hiện có.
- Mở trang chủ, danh mục (có kết quả và rỗng), chi tiết, giỏ trống/có hàng ở viewport desktop và mobile.
- Xác minh tìm kiếm, lọc/sắp xếp, thêm hàng, cập nhật số lượng, xóa, voucher và tạo đơn vẫn gọi API, không rơi về localStorage.
- Kiểm tra không có link quản trị trong điều hướng storefront, nhãn demo còn nguyên và giảm chuyển động được tôn trọng.
