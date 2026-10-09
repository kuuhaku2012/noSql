# Maison Belle — Đăng ký khách hàng và tài khoản kính trong suốt

## Mục tiêu

Cho phép khách tự tạo tài khoản trong MongoDB, đăng nhập ngay sau khi đăng ký, và trình bày đăng nhập/đăng ký theo phương án B đã duyệt: câu chuyện Maison Belle ở một bên, bảng tài khoản dạng glass ở bên còn lại.

## Phạm vi

- Thêm `POST /api/auth/register` vào router xác thực hiện có.
- Form đăng nhập và đăng ký trên `account.html`, vẫn dùng cookie phiên `mb_token` hiện có.
- Tài khoản mới luôn có vai trò `customer`; dữ liệu không được tin từ trường role gửi bởi trình duyệt.
- Giữ nguyên đăng nhập, đăng xuất và trang hồ sơ sau khi đăng nhập.
- Không thêm thư viện hoặc thay đổi mô hình phiên.

## Hợp đồng đăng ký

Request JSON:

```json
{
  "email": "mai@example.com",
  "fullName": "Nguyễn Mai",
  "phone": "0900000000",
  "password": "matkhau123",
  "skinType": "sensitive"
}
```

`phone` và `skinType` là tùy chọn trong API. `skinType` chỉ nhận `oily`, `dry`, `sensitive`, `combination` hoặc `normal`. Chuẩn hóa email bằng `trim().toLowerCase()`; tên và số điện thoại được trim. Email phải đúng định dạng cơ bản, tên không rỗng, mật khẩu từ 6 đến 200 ký tự; giữ giới hạn chiều dài hiện có của trường hồ sơ. Email hoặc số điện thoại đã được dùng trả `409 DUPLICATE_USER`. Tạo người dùng với `role: "customer"`, `isActive: true`, `isDemo: false`, hash mật khẩu bằng bcrypt; không trả hash. Khi tạo thành công, đặt cookie HttpOnly/SameSite/Lax giống đăng nhập, thời hạn 7 ngày, và trả `201 { data: publicUser }`.

Không có OTP/email/SMS provider trong dự án; không hiển thị xác minh đã gửi và không lưu dữ liệu đăng ký trên trình duyệt. Tự đăng nhập bằng cookie vừa tạo, không gọi lại endpoint login.

## Luồng giao diện

- Hai tab/điều khiển có trạng thái truy cập được: Đăng nhập và Tạo tài khoản.
- Form đăng nhập giữ điền nhanh tài khoản demo, có nhãn dữ liệu minh họa.
- Form đăng ký có họ tên, email, số điện thoại, mật khẩu, nhập lại mật khẩu và loại da tùy chọn; kiểm tra khớp mật khẩu ở trình duyệt trước khi gửi.
- Khi API tạo tài khoản thành công, gọi quy trình `load()` hiện có để hiện hồ sơ tài khoản.
- Trạng thái gửi khóa nút; lỗi xác thực/trùng lặp hiển thị ngay trong form; không lộ chi tiết nội bộ.
- Glass chỉ dùng cho lớp form và hiệu ứng sáng nhẹ; chữ/nút giữ độ tương phản, responsive và tôn trọng `prefers-reduced-motion`.

## An toàn và ngoài phạm vi

- Không nhận `role`, `roleId`, `isActive`, `isDemo` hoặc `passwordHash` từ request.
- Giữ unique index email và phone hiện có; xử lý xung đột unique ở thời điểm ghi để trả mã 409 nhất quán.
- Ngoài phạm vi: OTP, xác minh email, quên/đổi mật khẩu, đăng nhập mạng xã hội, CAPTCHA hoặc dịch vụ chống spam bên ngoài.

## Kiểm chứng

- Test tích hợp MongoDB: tạo thành công, chuẩn hóa email, cookie đăng nhập, `GET /me`, không lộ hash, không thể nâng role, payload sai, email/số điện thoại trùng.
- Test API adapter: `auth.register` gửi đúng endpoint và body JSON.
- Kiểm tra thủ công trang tài khoản: đổi tab, báo lỗi, đăng ký, tự đăng nhập và đăng xuất.
