# Dữ liệu nhập Maison Belle

Bộ dữ liệu này được tách từ tài liệu Word được cung cấp, gồm 20 sản phẩm và ảnh tương ứng.

## Tệp nhập trong trang quản trị

1. `brands.json` — nhập tại mục **Nhập thương hiệu từ file**.
2. `categories.json` — nhập tại mục **Nhập danh mục từ file**.
3. `products.json` — nhập tại mục **Nhập sản phẩm từ file**, sau khi thương hiệu và danh mục đã có trong hệ thống.

## Ảnh sản phẩm

Ảnh đã được lưu sẵn trong `frontend/img/products/` và được tham chiếu bằng đường dẫn `/img/products/...` trong `products.json`. Khi chạy website từ thư mục này, ảnh sẽ được phục vụ tự động; không cần nhúng ảnh base64 vào file nhập.

## Thứ tự nhập

Nhập thương hiệu trước, tiếp theo nhập danh mục, cuối cùng nhập sản phẩm. Nếu thương hiệu hoặc danh mục đã tồn tại, hệ thống có thể báo dòng trùng; có thể bỏ qua các dòng trùng đó rồi nhập sản phẩm.

## Ghi chú tồn kho

Tài liệu nguồn không có số lượng tồn kho, nên bộ này chỉ tạo thương hiệu, danh mục, sản phẩm và phân loại. Sau khi nhập sản phẩm, dùng mục **Nhập phiếu nhập kho từ file** nếu cần bổ sung số lượng.
