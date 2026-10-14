# Maison Belle

Demo cửa hàng mỹ phẩm gồm giao diện thương mại điện tử và API quản lý bằng Express/MongoDB.

## Chức năng

- Trang chủ, tìm kiếm/lọc sản phẩm, danh mục, thương hiệu và ưu đãi.
- Chi tiết sản phẩm, yêu thích và giỏ hàng; khách có thể duyệt và lưu giỏ trước khi đăng nhập, đăng nhập được yêu cầu khi đặt hàng.
- Tài khoản khách hàng, đơn hàng, tư vấn/chăm sóc và bảo hành.
- Đăng ký bằng mã xác minh email và tự đặt lại mật khẩu qua email khi SMTP đã được cấu hình.
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

### Cấu hình email xác minh

Backend tự nạp `backend/.env` qua `dotenv/config` khi khởi động. Điền cấu hình SMTP trong tệp này để bật gửi mã đăng ký và đặt lại mật khẩu:

| Biến | Mục đích |
| --- | --- |
| `SMTP_HOST` | Máy chủ SMTP |
| `SMTP_PORT` | Cổng SMTP, thường do nhà cung cấp chỉ định |
| `SMTP_SECURE` | `true` nếu kết nối TLS bảo mật ngay từ đầu; nếu không thì `false` |
| `SMTP_USER` | Tài khoản SMTP |
| `SMTP_PASS` | Mật khẩu SMTP |
| `SMTP_FROM` | Địa chỉ người gửi được máy chủ SMTP cho phép |
| `AUTH_CODE_SECRET` | Secret ngẫu nhiên riêng, tối thiểu 32 ký tự, dùng để bảo vệ mã xác minh; không dùng lại `JWT_SECRET` |

Không đưa thông tin SMTP hoặc secret vào mã nguồn, log hay Git. Khi cấu hình chưa đủ, API trả `EMAIL_NOT_CONFIGURED` thay vì giả vờ đã gửi thư. Với yêu cầu gửi mã đặt lại mật khẩu, phản hồi `202` chỉ có nghĩa là hệ thống đã tiếp nhận yêu cầu; nó **không xác nhận email đã được gửi**. Nếu không nhận được mã, hãy thử lại sau thời gian chờ gửi lại.

## Kiểm thử

```powershell
# Giao diện và API client — chạy từ thư mục gốc dự án
node --test js/*.test.js

# API/backend — chạy trong backend/
Push-Location backend
$env:MONGODB_URI = 'mongodb://127.0.0.1:27017'
$env:MONGODB_TEST_DB = 'maison_belle_test_full_regression'
$suiteFiles = Get-ChildItem test/*.test.js | Where-Object { $_.Name -notin @('auth-email-codes.test.js', 'seed-safety.test.js', 'auth-email-verification.test.js') } | ForEach-Object { $_.FullName }
node --test $suiteFiles

# Một số fixture yêu cầu tên database test cố định.
$env:MONGODB_TEST_DB = 'maison_belle_test_auth_email_codes'
node --test test/auth-email-codes.test.js
node --test test/seed-safety.test.js
$env:MONGODB_TEST_DB = 'maison_belle_test_auth_flow'
node --test test/auth-email-verification.test.js
Pop-Location
```

Các kiểm thử MongoDB dùng cơ sở dữ liệu test riêng và có thể xóa fixture của chính chúng; không trỏ `MONGODB_TEST_DB` đến database phát triển hoặc dữ liệu người dùng. Một số bộ kiểm thử xác nhận chính xác tên test DB, vì vậy chúng được chạy riêng thay vì dùng chung một giá trị `MONGODB_TEST_DB`.

## Cấu trúc

- `index.html`, `products.html`, `product.html`, `cart.html`, `account.html`: các trang mua sắm và tài khoản.
- `admin.html`: giao diện quản trị.
- `css/`, `js/`, `img/`: giao diện, tương tác và ảnh demo.
- `backend/src/`: API, xác thực, nghiệp vụ đơn hàng và các route.
- `backend/test/`: kiểm thử backend; `docs/superpowers/`: đặc tả và kế hoạch triển khai.
- `API_CONTRACT.md`: hợp đồng API.

Phí giao hàng theo tỉnh/thành chưa được tích hợp: backend hiện chưa có bảng giá hoặc dịch vụ báo phí. Không dùng số phí demo làm giá vận chuyển thực tế.
