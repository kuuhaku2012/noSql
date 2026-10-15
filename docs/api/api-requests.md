# API cần bổ sung hoặc xác nhận

Các endpoint trong phạm vi mười nghiệp vụ đã được nối giữa frontend và backend, cập nhật tại [API_CONTRACT.md](API_CONTRACT.md). Frontend không dùng localStorage để thay dữ liệu nghiệp vụ; sản phẩm, đơn hàng, voucher và tài khoản demo phải được nhận diện là dữ liệu minh họa.

## Còn ngoài phạm vi bản demo

- Thanh toán thật: hiện hỗ trợ COD và thanh toán mô phỏng; chưa kết nối ngân hàng/cổng thanh toán.
- Vận chuyển thật: phiếu giao hàng và cập nhật trạng thái đang mô phỏng; chưa tích hợp hãng vận chuyển, mã vận đơn hay tính phí vận chuyển.
- Đánh giá và yêu thích sản phẩm: chưa có trong mười luồng nghiệp vụ được triển khai; các nút dẫn tới chức năng chưa có API đã được bỏ khỏi giao diện.
- Đăng ký email nhận tin: chưa có API gửi email; không lưu đăng ký giả trên trình duyệt.
- Bảng xếp hạng “Bán chạy”: bổ sung endpoint GET /api/products?sort=bestSelling (hoặc endpoint tương đương), sắp xếp toàn bộ sản phẩm đang kinh doanh theo số lượng bán thành công; loại đơn đã hủy/hoàn trả và giữ nhãn dữ liệu minh họa. Hiện frontend để trạng thái chờ, không lấy sản phẩm mới nhất thay cho thứ hạng bán.

Các giới hạn này được hiển thị như trạng thái/chú thích trong giao diện, không thay bằng dữ liệu cục bộ hoặc dữ liệu giả mạo như dữ liệu thật.
