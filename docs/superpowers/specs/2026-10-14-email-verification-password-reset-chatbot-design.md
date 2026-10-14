# Maison Belle — xác minh email, đặt lại mật khẩu và chatbot FAQ

## Trạng thái

Thiết kế được duyệt trong hội thoại ngày 2026-10-14; chờ người dùng rà soát tài liệu trước khi lập kế hoạch triển khai.

## Mục tiêu

- Xác minh email bằng mã dùng một lần trước khi tạo tài khoản khách hàng.
- Cho phép khách tự đặt lại mật khẩu bằng mã gửi đến email đã đăng ký.
- Thêm chatbot FAQ tiếng Việt dùng nội dung thực của cửa hàng, không gọi dịch vụ AI.
- Giữ MongoDB và Express hiện có, không làm thay đổi các luồng mua hàng, giỏ hàng, quản trị hoặc phân quyền.

## Các quyết định thiết kế

- Email gửi qua SMTP được cấu hình bằng biến môi trường; không lưu thông tin đăng nhập SMTP trong mã nguồn.
- Không có SMTP hợp lệ thì API báo lỗi cấu hình rõ ràng, không trả thông báo giả rằng email đã được gửi.
- OTP chỉ lưu dạng hash, có hạn sử dụng, giới hạn lượt nhập và giới hạn gửi lại; không ghi OTP vào log hoặc trả về trình duyệt.
- Chatbot là FAQ xác định theo nội dung đã duyệt, không dùng AI, không lưu lịch sử hội thoại và không truy cập dữ liệu cá nhân/đơn hàng.
- Migration và index chỉ bổ sung; không xóa hoặc viết lại dữ liệu hiện có. Tài khoản cũ tiếp tục đăng nhập bình thường.

## 1. Xác minh email và đăng ký

### Giao diện

- Trường email báo định dạng hợp lệ/không hợp lệ khi người dùng nhập; nút gửi mã chỉ bật với email hợp lệ. Backend vẫn chuẩn hóa và kiểm tra email độc lập.
- Thêm nút gửi/gửi lại mã và trường mã xác minh trong form đăng ký.
- Nút tạo tài khoản yêu cầu đủ thông tin và mã; trạng thái gửi, hết hạn, sai mã, giới hạn thử và lỗi SMTP được thông báo ngay trong form, có `aria-live`.
- Không giữ mật khẩu hoặc mã xác minh trong `localStorage`/`sessionStorage`.

### API và dữ liệu

- `POST /api/auth/register/send-code` nhận `{ email }`, chuẩn hóa email và gửi mã đăng ký.
- `POST /api/auth/register` bổ sung trường `verificationCode`; chỉ tạo tài khoản khách hàng nếu mã còn hạn, đúng mục đích, chưa dùng và email chưa thuộc tài khoản khác.
- Tài khoản mới lưu `emailVerifiedAt`; các tài khoản cũ không bị buộc xác minh lại.
- Thêm collection ngắn hạn `auth_email_verifications`, một bản ghi cho mỗi cặp email/mục đích, chứa HMAC của mã (dùng secret riêng phía server), thời điểm hết hạn, số lần nhập, bộ đếm gửi theo cửa sổ một giờ và thời gian dọn bản ghi sau 24 giờ. Không lưu mã thô.
- Tạo index duy nhất theo email/mục đích và TTL cho bản ghi hết thời gian lưu; luôn kiểm tra thời hạn trong truy vấn vì tác vụ TTL của MongoDB không xóa tức thời.
- Mã sáu chữ số hết hạn sau 10 phút; tối đa 5 lần nhập; chờ tối thiểu 60 giây giữa các lần gửi và giới hạn 5 lần gửi mỗi email trong một giờ. Giới hạn các endpoint gửi mã ở mức 10 yêu cầu mỗi IP trong 15 phút để giảm lạm dụng SMTP; cấu hình tin cậy proxy phải tường minh khi triển khai sau reverse proxy. Gửi mã mới làm mã cũ mất hiệu lực.
- Tính HMAC bằng secret riêng và so sánh constant-time; tuyệt đối không log mã thô.
- Chỉ đánh dấu mã đã dùng một cách nguyên tử một lần. Nếu sau đó tạo tài khoản thất bại vì dữ liệu vừa trùng, người dùng có thể xin mã mới.

## 2. Quên và đặt lại mật khẩu

- Nút “Quên mật khẩu?” mở luồng gồm email, gửi mã, mã xác minh, mật khẩu mới và nhập lại mật khẩu.
- `POST /api/auth/password-reset/send-code` nhận `{ email }`; phản hồi không tiết lộ email có tài khoản hay không. Nếu email không tồn tại, không gửi thư.
- `POST /api/auth/password-reset` nhận `{ email, verificationCode, newPassword }`; xác minh mục đích/mã/thời hạn/lượt thử, hash mật khẩu bằng bcrypt và cập nhật người dùng.
- Sau khi đổi mật khẩu, tăng phiên bản xác thực của tài khoản. JWT mới mang phiên bản hiện tại; middleware từ chối các cookie phiên được phát hành trước đó. Tài khoản cũ chưa có trường phiên bản được xem như phiên bản `0`, không cần backfill. Người dùng đăng nhập lại sau khi đặt lại mật khẩu.
- Mã đặt lại chỉ dùng một lần và tuân theo cùng chính sách thời hạn, thử mã và giới hạn gửi của OTP đăng ký.

## 3. SMTP và xử lý lỗi

- Dùng Nodemailer với cấu hình `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` và secret riêng `AUTH_CODE_SECRET`; ví dụ biến được bổ sung vào `.env.example` nhưng không có giá trị bí mật.
- Mailer được tiêm vào router để test bằng transport giả. Không cần gửi email thật trong bộ kiểm thử.
- Nếu cấu hình thiếu, trả `503 EMAIL_NOT_CONFIGURED`. Nếu gửi thư thất bại, vô hiệu mã vừa tạo và trả lỗi có thể thử lại; không để mã chưa nhận được vẫn dùng được.
- Không đưa mã, mật khẩu, SMTP credentials hoặc nội dung nhạy cảm vào log. Nội dung HTML email phải escape dữ liệu động.
- Không ghi nhận rằng tích hợp đã gửi được email thật cho đến khi có cấu hình SMTP hợp lệ và kiểm tra thủ công thành công.

## 4. Chatbot FAQ

- Thêm widget dùng chung cho các trang phía khách hàng; không hiển thị trên trang quản trị.
- Chatbot dùng bộ FAQ tiếng Việt được quản lý trong mã nguồn và nhận diện một số ý định/cụm từ phổ biến. Có nút gợi ý và liên kết tới trang liên quan.
- Chủ đề ban đầu: tìm sản phẩm/chăm sóc da, cách xem phí giao hàng tại bước checkout, tra đơn qua tài khoản, đổi trả/bảo hành và đặt lịch tư vấn.
- Bot chỉ nêu dữ kiện có trong luồng/trang hiện tại. Không tự đưa ra phí giao hàng, tồn kho, hạn đổi trả hoặc tình trạng đơn nếu không có dữ liệu xác nhận.
- Không gọi API AI, không đọc dữ liệu đơn hàng riêng tư, không yêu cầu thông tin thanh toán và không lưu hội thoại. Câu hỏi không khớp trả lời trung thực và dẫn tới trang đặt lịch/liên hệ hỗ trợ.
- Nội dung người dùng được hiển thị dưới dạng text, không render HTML tùy ý. Widget dùng được bằng bàn phím, có nhãn truy cập và bố cục phù hợp màn hình nhỏ.

## Phạm vi không bao gồm

- Không tích hợp dịch vụ AI hoặc tạo câu trả lời tự do.
- Không tra cứu đơn hàng trong cửa sổ chat.
- Không thêm đăng nhập mạng xã hội, CAPTCHA, SMS, đổi địa chỉ email hoặc quản lý hội thoại.
- Không gửi SMTP thật trong CI/test; thông tin SMTP thật sẽ được cấu hình riêng ngoài repository.

## Migration và bảo toàn dữ liệu

- Thay đổi schema chỉ thêm collection, index và trường xác minh cho tài khoản mới; không xóa trường hay sửa lịch sử tài khoản.
- Tích hợp index OTP vào cơ chế `createIndexes`/`migrateModel` hiện có theo cách chạy lặp an toàn.
- Nếu index không thể tạo do dữ liệu vi phạm uniqueness, migration phải dừng với lỗi rõ ràng thay vì xóa/sửa dữ liệu.

## Kiểm chứng chấp nhận

- API: email sai định dạng, mã sai/hết hạn/dùng lại, sai mục đích, vượt lượt thử, giới hạn gửi, SMTP thiếu cấu hình/lỗi gửi, đăng ký thành công, trùng email, đặt lại mật khẩu thành công và cookie cũ bị từ chối.
- Kiểm tra mật khẩu được hash, OTP không lưu dạng thô, thông tin xác thực không lộ trong response/log, phản hồi quên mật khẩu không tiết lộ sự tồn tại tài khoản.
- Frontend: kiểm tra email trực tiếp, trạng thái gửi mã, lỗi/đếm ngược gửi lại, xác nhận mật khẩu, điều hướng đăng nhập sau khi đổi mật khẩu.
- Chatbot: kiểm tra từng ý định FAQ, fallback, liên kết, không truy cập dữ liệu riêng tư, không lưu hội thoại, hiển thị an toàn cho chuỗi HTML và thao tác bàn phím/mobile.
- Chạy unit/API/regression tests trên MongoDB test riêng và fake SMTP. Kiểm tra thủ công gửi email thật chỉ sau khi người dùng cấu hình SMTP.
