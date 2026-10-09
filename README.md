# Maison Belle

Demo cửa hàng mỹ phẩm gồm giao diện thương mại điện tử và API quản lý bằng Express/MongoDB.

## Chức năng

- Trang chủ, tìm kiếm/lọc sản phẩm, danh mục, thương hiệu và ưu đãi.
- Chi tiết sản phẩm, yêu thích và giỏ hàng; khách có thể duyệt và lưu giỏ trước khi đăng nhập, đăng nhập được yêu cầu khi đặt hàng.
- Tài khoản khách hàng, đơn hàng, tư vấn/chăm sóc và bảo hành.
- Khu vực quản trị cho sản phẩm, danh mục, kho, khuyến mãi, voucher, đơn hàng, đổi trả, giao hàng và báo cáo.
- Giao diện responsive, hỗ trợ sáng/tối.

## Chạy ứng dụng

Cần Node.js 20+, pnpm và MongoDB đang chạy. Trong PowerShell:

```powershell
cd backend
Copy-Item .env.example .env
pnpm install
pnpm dev
```

Mở <http://localhost:3000>. Backend đồng thời phục vụ các trang HTML/CSS/JS. Nếu dùng cấu hình khác, cập nhật `MONGODB_URI`, `MONGODB_DB` và đặt `JWT_SECRET` ngẫu nhiên trong `backend/.env`. Không commit tệp `.env`.

## Kiểm thử

```powershell
# Giao diện và API client — chạy từ thư mục gốc dự án
node --test js/*.test.js

# API/backend — chạy trong backend/
pnpm test
```

## Cấu trúc

- `index.html`, `products.html`, `product.html`, `cart.html`, `account.html`: các trang mua sắm và tài khoản.
- `admin.html`: giao diện quản trị.
- `css/`, `js/`, `img/`: giao diện, tương tác và ảnh demo.
- `backend/src/`: API, xác thực, nghiệp vụ đơn hàng và các route.
- `backend/test/`: kiểm thử backend; `docs/superpowers/`: đặc tả và kế hoạch triển khai.
- `API_CONTRACT.md`: hợp đồng API.

Phí giao hàng theo tỉnh/thành chưa được tích hợp: backend hiện chưa có bảng giá hoặc dịch vụ báo phí. Không dùng số phí demo làm giá vận chuyển thực tế.
