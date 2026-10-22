# Bộ dữ liệu nhập Maison Belle

Thư mục này chứa trọn bộ dữ liệu được tách từ tài liệu Word nguồn: 20 sản phẩm, 10 thương hiệu, 5 danh mục và ảnh tương ứng.

## Tệp tải lên trang quản trị

1. `brands.json` — mục **Nhập thương hiệu từ file**.
2. `categories.json` — mục **Nhập danh mục từ file**.
3. `products.json` — mục **Nhập sản phẩm từ file**.

Nên nhập theo đúng thứ tự trên để sản phẩm tìm được thương hiệu và danh mục. Nếu bản ghi thương hiệu hoặc danh mục đã có, có thể bỏ qua dòng trùng rồi nhập sản phẩm.

## Ảnh sản phẩm

Toàn bộ ảnh gốc đã nằm trong thư mục `images/` ngay bên trong bộ dữ liệu này. Website cũng đã có bản sao tại `frontend/img/products/` và `products.json` tham chiếu đường dẫn chạy được là `/img/products/...`.

## Tồn kho

Tài liệu nguồn không có số lượng tồn kho. Sau khi nhập sản phẩm, dùng mục **Nhập phiếu nhập kho từ file** nếu cần thêm số lượng.
