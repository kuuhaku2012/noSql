# Hợp đồng API Maison Belle

## 1. Thông tin chung

- Base URL khi chạy local: `http://localhost:3000`
- API prefix: `/api`
- Backend dùng MongoDB, không dùng SQL.
- Backend phục vụ giao diện tĩnh trong cùng origin.
- Tất cả response API dùng JSON, trừ file giao diện tĩnh.
- Cookie phiên đăng nhập: `mb_token`, HttpOnly, SameSite=Lax.

## 2. Format response

Response thành công cho object:

```json
{ "data": { "id": "..." } }
```

Response thành công cho danh sách:

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

Response lỗi:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request data is invalid",
    "details": [
      { "field": "quantity", "message": "Must be a positive integer" }
    ]
  },
  "requestId": "uuid"
}
```

Các mã HTTP chính:

| Mã | Ý nghĩa |
|---|---|
| 200 | Thành công |
| 201 | Tạo mới thành công |
| 204 | Thành công, không có body |
| 400 | Dữ liệu gửi lên không hợp lệ |
| 401 | Chưa đăng nhập hoặc phiên không hợp lệ |
| 403 | Không đủ quyền |
| 404 | Không tìm thấy dữ liệu |
| 409 | Vi phạm nghiệp vụ hoặc dữ liệu trùng |
| 500 | Lỗi máy chủ |

## 3. Tài khoản demo

Mật khẩu chung cho dữ liệu demo: `Demo@123`

| Email | Vai trò |
|---|---|
| `customer@maisonbelle.local` | `customer` |
| `sales@maisonbelle.local` | `sales` |
| `warehouse@maisonbelle.local` | `warehouse` |
| `manager@maisonbelle.local` | `manager` |

Dữ liệu này chỉ dùng cho database dev và có trường `isDemo: true`.

## 4. Quyền theo vai trò

| Nhóm API | Customer | Sales | Warehouse | Manager |
|---|---:|---:|---:|---:|
| Health, sản phẩm công khai | Có | Có | Có | Có |
| Giỏ hàng, voucher, đơn hàng cá nhân | Có | Có | Có | Có |
| Sản phẩm quản trị | Không | Có | Xem | Có |
| Kho, nhập kho, kiểm kê | Không | Không | Có | Có |
| Khuyến mãi | Không | Có | Không | Có |
| Giao hàng | Không | Có | Có | Có |
| Đổi trả | Không | Có | Không | Có |
| Báo cáo | Không | Không | Không | Có |

## 5. API hệ thống

### GET `/api/health`

Không cần đăng nhập.

Response:

```json
{ "data": { "status": "ok" } }
```

## 6. API sản phẩm

### GET `/api/products`

Không cần đăng nhập.

Query hỗ trợ:

```text
q          Tìm trong tên và mô tả
category   ID hoặc slug danh mục
brand      ID hoặc mã thương hiệu
skinType   Loại da
minPrice   Giá tối thiểu
maxPrice   Giá tối đa
sale       true hoặc 1 để chỉ lấy sản phẩm có khuyến mãi đang hiệu lực
sort       nameAsc | nameDesc | priceAsc | priceDesc
page       Mặc định 1
limit      Mặc định 20, tối đa 100
```

### GET `/api/products/:id`

`:id` nhận ObjectId hoặc slug sản phẩm.

Response bao gồm thông tin sản phẩm, các biến thể và `availableQuantity` tính từ tồn thực tế trừ số lượng giữ chỗ.

Mỗi biến thể có thể kèm `promotionPrice`, `promotionName` và `promotionId` khi có chương trình đang hoạt động. Giá bán trong đơn được máy chủ tính lại, không tin giá do trình duyệt gửi.

### GET `/api/catalog` và GET `/api/promotions`

Không cần đăng nhập. Catalog trả danh mục và thương hiệu đang hoạt động. Danh sách khuyến mãi công khai chỉ gồm chương trình còn hiệu lực theo ngày.

## 7. API xác thực

### POST `/api/auth/login`

Request:

```json
{
  "email": "customer@maisonbelle.local",
  "password": "Demo@123"
}
```

Đăng nhập thành công trả `200` và set cookie `mb_token`.

### POST `/api/auth/register`

Request:

```json
{
  "email": "mai@example.com",
  "fullName": "Nguyễn Mai",
  "phone": "0900000000",
  "password": "matkhau123",
  "skinType": "sensitive"
}
```

`phone` và `skinType` là tùy chọn; `skinType` nhận `oily`, `dry`, `sensitive`, `combination` hoặc `normal`. Email được chuẩn hóa chữ thường; email phải hợp lệ, tên không được để trống, mật khẩu tối thiểu 6 ký tự. Email hoặc số điện thoại đã dùng trả `409 DUPLICATE_USER`. API luôn tạo tài khoản `customer`, không nhận quyền gửi từ client. Khi tạo thành công trả `201 { data: publicUser }` và set cookie `mb_token` HttpOnly, SameSite=Lax, hết hạn sau 7 ngày để người dùng được đăng nhập ngay. `passwordHash` không có trong response.

Hiện chưa tích hợp OTP, email hoặc SMS; giao diện không giả lập bước gửi mã xác minh.

### GET `/api/auth/me`

Cần đăng nhập. Trả thông tin tài khoản hiện tại, không trả `passwordHash`.

### POST `/api/auth/logout`

Không bắt buộc đăng nhập. Xóa cookie phiên và trả `204`.

## 8. API giỏ hàng

### GET `/api/cart`

Cần đăng nhập. Trả giỏ hàng của tài khoản hiện tại.

### PUT `/api/cart`

Request:

```json
{
  "items": [
    { "variantId": "66b000000000000000000001", "quantity": 2, "size": "30ml" }
  ]
}
```

Số lượng phải là số nguyên dương. Biến thể phải tồn tại và đang hoạt động.

## 9. API voucher

### POST `/api/vouchers/validate`

Cần đăng nhập.

Request:

```json
{
  "code": "BELLE10",
  "subtotal": 500000
}
```

Response trả số tiền giảm và tổng tiền sau giảm. Việc validate không làm tăng `usedCount`; số lượt chỉ được tăng khi tạo đơn thành công.

## 9A. API phí giao hàng demo

```http
GET  /api/shipping/rates
POST /api/shipping/quote
```

Hai endpoint công khai chỉ trả các khu vực demo đang hoạt động trong MongoDB. `POST /api/shipping/quote` nhận `{ "regionCode": "hcm-demo" }` và trả `regionCode`, `regionName`, `fee`, `currency: "VND"`, `isDemo: true`. Mã không tồn tại hoặc đã ngừng hoạt động trả `409 SHIPPING_UNAVAILABLE`.

Chỉ `manager` được quản lý bảng giá:

```http
GET    /api/admin/shipping-rates
POST   /api/admin/shipping-rates
PATCH  /api/admin/shipping-rates/:id
DELETE /api/admin/shipping-rates/:id
```

Tạo/cập nhật nhận `regionCode`, `regionName`, `fee` và tùy chọn `isActive`. `regionCode` được chuẩn hóa chữ thường; phí là số VND không âm. `DELETE` chỉ đặt `isActive: false`, không xóa bản ghi. Không có phí mặc định cho khu vực chưa cấu hình hoặc đã ngừng hoạt động.

## 10. API đơn hàng

### POST `/api/orders`

Cần đăng nhập.

Request:

```json
{
  "checkoutRequestId": "checkout-2026-001",
  "items": [
    { "variantId": "66b000000000000000000001", "quantity": 2 }
  ],
  "voucherCode": "BELLE10",
  "paymentMethod": "cod",
  "shippingAddress": {
    "receiverName": "Nguyễn Văn A",
    "receiverPhone": "0900000000",
    "fullAddress": "1 Đường Demo, Quận 1",
    "regionCode": "hcm-demo"
  }
}
```

`checkoutRequestId` là khóa tùy chọn để gửi lại cùng một yêu cầu an toàn; nếu có, đây phải là chuỗi không rỗng, tối đa 128 ký tự và được áp dụng theo từng tài khoản. Gửi lại khóa của đơn đã tạo hoàn tất sẽ trả lại đơn đó, không giữ thêm tồn kho hoặc dùng thêm voucher. Nếu lần gửi trước vẫn đang xử lý, API trả `409 CHECKOUT_IN_PROGRESS`; hãy thử lại với cùng khóa.

`shippingAddress.regionCode` bắt buộc cho đơn mới và phải trỏ tới khu vực đang hoạt động. Tên khu vực và phí lấy từ MongoDB; phí hoặc tên gửi thêm từ trình duyệt không được dùng để tính đơn. Khu vực không tồn tại hoặc đã ngừng hoạt động trả `409 SHIPPING_UNAVAILABLE`, không tự chuyển thành giao hàng miễn phí.

`paymentMethod` nhận `cod` hoặc `mock`. Máy chủ tính lại giá/khuyến mãi, tồn kho, voucher và phí giao hàng. `subtotal` là tổng các dòng hàng theo giá hiệu lực; `finalAmount = subtotal - discountAmount + deliveryFee`. Demo này không tính thêm khoản thuế. Order lưu snapshot sản phẩm, voucher, địa chỉ và `shippingRateSnapshot` gồm mã/tên khu vực, phí VND và cờ demo. Payment và invoice bắt đầu ở trạng thái chờ; đây là các bản ghi demo, không thu tiền thật.

Khi tạo đơn, backend sẽ:

1. Kiểm tra sản phẩm/biến thể đang hoạt động và tính giá từ dữ liệu MongoDB.
2. Kiểm tra khu vực giao hàng đang hoạt động và lấy phí từ MongoDB.
3. Kiểm tra tồn khả dụng và giữ chỗ bằng cập nhật nguyên tử.
4. Tính voucher trên subtotal; chỉ tăng lượt dùng khi tạo đơn thành công.
5. Lưu snapshot giá, voucher, địa chỉ và phí giao hàng.
6. Tạo payment/invoice demo với số tiền bằng `finalAmount`.

Địa chỉ đã lưu dạng văn bản tự do và đơn hàng cũ vẫn đọc được. `regionCode` trên API địa chỉ đã lưu là tùy chọn; migration không tự điền mã vùng cho địa chỉ hay đơn lịch sử.

### GET `/api/orders`

Cần đăng nhập. Customer chỉ thấy đơn của mình; nhân viên thấy danh sách nghiệp vụ.

### GET `/api/orders/:id`

Cần đăng nhập. Customer chỉ được xem đơn của mình.

### PATCH `/api/orders/:id/status`

Request:

```json
{
  "status": "confirmed",
  "note": "Đã kiểm tra đơn hàng"
}
```

Luồng đơn hàng:

```text
pending -> confirmed -> processing -> shipped -> delivered -> completed
pending|confirmed|processing -> cancelled
delivered -> returned
```

Customer chỉ được hủy đơn ở trạng thái `pending`. Nhân viên phải có vai trò phù hợp.

### POST `/api/orders/:id/payment`

Cần đăng nhập. Chỉ chấp nhận đơn dùng `paymentMethod: "mock"`; request `{ "outcome": "success" | "failure" }`. Đây là thao tác mô phỏng, không thu tiền thật. Payment ghi số tiền snapshot của đơn; kết quả thành công đánh dấu payment đã trả và invoice đã phát hành, kết quả thất bại giữ invoice ở trạng thái chờ. COD không dùng endpoint này: trạng thái thanh toán vẫn chờ trong lúc giao và được đánh dấu đã trả khi đơn hoàn tất. Chi tiết đơn trả thêm `payment`, `invoice` và `history`.

## 11. API lịch tư vấn

### GET `/api/appointments`

Cần đăng nhập. Customer chỉ xem lịch của mình; nhân viên xem lịch cần xử lý.

### POST `/api/appointments`

Request:

```json
{
  "appointmentDate": "2026-11-01",
  "startTime": "09:00",
  "endTime": "10:00",
  "consultationType": "skincare",
  "customerNote": "Tư vấn cho da nhạy cảm"
}
```

Trạng thái ban đầu là `requested`.

### PATCH `/api/appointments/:id`

Request tối thiểu:

```json
{ "status": "confirmed" }
```

### GET `/api/appointments/availability`

Cần đăng nhập. Query `appointmentDate=YYYY-MM-DD`, `startTime=HH:MM`, `endTime=HH:MM`; trả `{ available: boolean }`. `POST` từ chối khoảng giờ sai bằng `400` và trùng lịch bằng `409 APPOINTMENT_SLOT_UNAVAILABLE`.

## 11A. Hồ sơ khách hàng và hội viên

Các endpoint `/api/customers/me` và `/api/customers/me/addresses` chỉ thao tác trên tài khoản đang đăng nhập:

```http
GET   /api/customers/me
PATCH /api/customers/me
GET   /api/customers/me/addresses
POST  /api/customers/me/addresses
PATCH /api/customers/me/addresses/:id
DELETE /api/customers/me/addresses/:id
GET   /api/customers/me/loyalty
GET   /api/admin/customers?q=<name|email|phone>
```

Danh sách khách hàng dành cho `sales` và `manager`. `GET /api/customers/me/loyalty` trả điểm hiện tại, hạng và lịch sử điểm. Quy tắc demo: cộng `floor(finalAmount / 10.000)` điểm khi đơn hoàn tất, mỗi đơn chỉ cộng một lần.

## 12. API quản trị sản phẩm

### GET `/api/admin/products`

Cần vai trò `sales`, `warehouse` hoặc `manager`.

### POST `/api/admin/products`

Cần vai trò `sales` hoặc `manager`.

Request tối thiểu:

```json
{
  "name": "Demo Serum",
  "slug": "demo-serum",
  "brandId": "66b000000000000000000002",
  "categoryId": "66b000000000000000000003",
  "variants": [
    {
      "sku": "DEMO-SERUM-30",
      "volume": "30ml",
      "originalPrice": 300000,
      "retailPrice": 250000
    }
  ]
}
```

### PATCH `/api/admin/products/:id`

Cập nhật tên, slug, mô tả, thành phần, hướng dẫn sử dụng, loại da hoặc trạng thái hoạt động.

## 13. API kho

### GET `/api/admin/inventory`

Cần vai trò `warehouse` hoặc `manager`.

### POST `/api/admin/stock-receipts`

Request:

```json
{
  "storeId": "66b000000000000000000004",
  "items": [
    {
      "variantId": "66b000000000000000000001",
      "quantity": 20,
      "unitCost": 100000,
      "note": "Nhập hàng demo"
    }
  ]
}
```

### POST `/api/admin/stock-adjustments`

Request:

```json
{
  "storeId": "66b000000000000000000004",
  "variantId": "66b000000000000000000001",
  "quantity": -1,
  "note": "Kiểm kê chênh lệch"
}
```

Không cho phép kết quả tồn thấp hơn số lượng đang giữ chỗ.

## 14. API khuyến mãi

```http
GET   /api/admin/promotions
POST  /api/admin/promotions
PATCH /api/admin/promotions/:id
DELETE /api/admin/promotions/:id
```

POST nhận `name`, `startDate`, `endDate`, `isActive` và danh sách `items` gồm `variantId`, `promotionPrice`.

## 15. API giao hàng

```http
GET  /api/admin/deliveries
POST /api/admin/deliveries
PATCH /api/admin/deliveries/:id
```

Các endpoint yêu cầu vai trò `sales`, `warehouse` hoặc `manager`. POST nhận `orderId`, `storeId`, `deliveryAddress`; chỉ đơn đã `shipped` mới được tạo phiếu và mỗi đơn chỉ có một phiếu. Phiếu giao hàng là mô phỏng, bắt đầu ở `ready` và lưu lịch sử chuyển trạng thái: `ready -> assigned -> picked_up -> in_transit -> delivered|failed`. Khi giao thành công, đơn đang `shipped` chuyển sang `delivered` và thêm một bản ghi lịch sử đơn; gửi lại trạng thái `delivered` không áp dụng chuyển đổi lần hai.

## 16. API đổi trả

```http
GET   /api/returns
POST  /api/returns
GET   /api/admin/returns
POST  /api/admin/returns
PATCH /api/admin/returns/:id
```

Yêu cầu cần đăng nhập; `sales` và `manager` có thể xử lý. Khách chỉ được gửi yêu cầu cho đơn của mình ở trạng thái `delivered` hoặc `completed`; số lượng cộng dồn không vượt quá số đã mua. Trạng thái ban đầu là `requested` và bản ghi lưu lịch sử trạng thái. Duyệt yêu cầu chưa làm tăng tồn kho; khi nhận hàng trả (`received`), hệ thống cộng lại tồn và ghi inventory log một lần cho từng dòng. Gửi lại trạng thái `received` không cộng tồn lần nữa.

Luồng:

```text
requested -> approved -> received -> refunded|exchanged
requested -> rejected
```

## 17. API báo cáo

### GET `/api/admin/reports`

Chỉ `manager` được sử dụng.

Query:

```text
from=2026-10-01
to=2026-10-31
storeId=<ObjectId cửa hàng, tùy chọn>
```

Kết quả gồm tổng số đơn, doanh thu, số lượng sản phẩm bán và danh sách sản phẩm bán chạy. Đơn `cancelled` không được tính vào doanh thu.

## 18. Chạy backend

Từ thư mục `maison-belle/maison-belle/backend`:

```powershell
pnpm install
Copy-Item .env.example .env
pnpm run indexes
pnpm run seed
pnpm start
```

Hoặc thay `pnpm` bằng `npm` nếu môi trường đã cài npm.

Mặc định:

```env
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=maison_belle_dev
JWT_SECRET=change-me-in-development
ALLOW_DEMO_SEED=false
```

Seed chỉ xóa và tạo lại các bản ghi có `isDemo: true`. Không chạy seed trên dữ liệu thật.

## 19. Kiểm thử

```powershell
pnpm test
```

Test tích hợp dùng các database riêng có hậu tố test và tự dọn dữ liệu sau khi chạy.

Hệ thống hiện chỉ hỗ trợ COD và thanh toán/giao hàng mô phỏng; chưa kết nối cổng thanh toán hoặc đơn vị vận chuyển thật.

## 20. CRUD quản trị trên MongoDB thật

Các endpoint dưới đây thao tác trực tiếp trên MongoDB. Dữ liệu seed chỉ là dữ liệu demo cho database dev; không phải dữ liệu giả trong bộ nhớ.

### Sản phẩm và biến thể

```http
GET    /api/admin/products
POST   /api/admin/products
PATCH  /api/admin/products/:id
DELETE /api/admin/products/:id
```

`POST` nhận `name`, `slug`, `brandId`, `categoryId` và `variants`. Mỗi variant phải có `sku`, `retailPrice`; `originalPrice` là tùy chọn. `PATCH` cập nhật thông tin sản phẩm và các variant có `id`; variant không có `id` sẽ được thêm mới.

`DELETE` là xóa mềm: đặt `products.isActive=false` và `product_variants.isActive=false`. Không xóa cứng sản phẩm vì đơn hàng giữ snapshot và reference lịch sử.

### Voucher

```http
GET    /api/admin/vouchers
GET    /api/admin/vouchers/:id
POST   /api/admin/vouchers
PATCH  /api/admin/vouchers/:id
DELETE /api/admin/vouchers/:id
```

`POST` nhận `code`, `discountType` (`percentage` hoặc `fixed`), `discountValue`, `startDate`, `endDate`, cùng các trường tùy chọn `minOrderValue`, `maxDiscountAmount`, `totalUsageLimit`, `isActive`. Mã voucher được chuẩn hóa chữ hoa và không được trùng.

`DELETE` là xóa mềm bằng `isActive=false`; voucher không hoạt động trả lỗi `409 VOUCHER_INACTIVE` khi gọi `/api/vouchers/validate`.

### Khuyến mãi

```http
GET    /api/admin/promotions
POST   /api/admin/promotions
PATCH  /api/admin/promotions/:id
DELETE /api/admin/promotions/:id
```

`DELETE` là xóa mềm bằng `isActive=false`.

`GET /api/promotions` trả chương trình công khai đang hiệu lực. Giá trong khuyến mãi phải thấp hơn giá bán lẻ; đơn hàng lưu snapshot tên chương trình và giá đã áp dụng.

### Giao hàng và đổi trả

```http
GET   /api/admin/deliveries
POST  /api/admin/deliveries
PATCH /api/admin/deliveries/:id

GET   /api/admin/returns
POST  /api/admin/returns
PATCH /api/admin/returns/:id
```

Giao hàng dùng transition: `ready -> assigned -> picked_up -> in_transit -> delivered|failed`.
Đổi trả dùng transition: `requested -> approved|rejected`, `approved -> received`, `received -> refunded|exchanged`. Transition sai trả `409 INVALID_STATUS_TRANSITION`.

### Tồn kho

Nhập kho và điều chỉnh tồn là giao dịch append-only:

```http
POST /api/admin/stock-receipts
POST /api/admin/stock-adjustments
```

Không có `PUT`/`DELETE` cho lịch sử tồn kho; sửa lịch sử sẽ làm sai số lượng đã giữ chỗ và báo cáo.

## 21. CRUD các entity còn lại

### Catalog: category, brand, store

Các API cần vai trò `manager` khi ghi; nhân viên được đọc danh sách:

```http
GET    /api/admin/catalog
GET    /api/admin/catalog/:kind
GET    /api/admin/catalog/:kind/:id
POST   /api/admin/catalog/:kind
PATCH  /api/admin/catalog/:kind/:id
DELETE /api/admin/catalog/:kind/:id
```

`:kind` nhận `categories`, `brands` hoặc `stores`. `DELETE` là xóa mềm bằng `isActive=false`. Catalog công khai đọc tại `GET /api/catalog`.

### Người dùng: khách hàng và nhân viên

Chỉ `manager` được quản lý tài khoản:

```http
GET    /api/admin/users
GET    /api/admin/users/:id
POST   /api/admin/users
PATCH  /api/admin/users/:id
DELETE /api/admin/users/:id
```

`POST` nhận `email`, `password`, `fullName`, `role`; `role` nhận `customer`, `sales`, `warehouse` hoặc `manager`. Password được hash bằng bcrypt và không bao giờ xuất hiện trong response. `DELETE` chỉ vô hiệu hóa tài khoản; không xóa cứng user đã có lịch sử.

### Lịch tư vấn

```http
GET    /api/appointments/:id
POST   /api/appointments
PATCH  /api/appointments/:id
DELETE /api/appointments/:id
```

`DELETE` chuyển lịch sang `cancelled` và giữ bản ghi lịch sử. Customer chỉ đọc/hủy lịch của mình; sales/manager xử lý lịch nghiệp vụ.

### Đơn hàng

```http
DELETE /api/orders/:id
```

Đây là thao tác hủy đơn theo nghiệp vụ, không xóa document. Customer chỉ hủy đơn `pending`; staff bị giới hạn bởi order transition và việc hủy sẽ hoàn lại tồn kho đã giữ chỗ.

### Hóa đơn và thanh toán mô phỏng

Chỉ `manager` được quản trị các bản ghi tài chính:

```http
GET    /api/admin/payments
GET    /api/admin/payments/:id
POST   /api/admin/payments
PATCH  /api/admin/payments/:id
DELETE /api/admin/payments/:id

GET    /api/admin/invoices
GET    /api/admin/invoices/:id
POST   /api/admin/invoices
PATCH  /api/admin/invoices/:id
DELETE /api/admin/invoices/:id
```

## 22. Bổ sung mô hình 30 thực thể theo Phase4

### Đánh giá và gợi ý sản phẩm

```http
GET   /api/products/:id/reviews
POST  /api/products/:id/reviews
PATCH /api/reviews/:id
GET   /api/products/:id/recommendations
POST  /api/admin/recommendations
PATCH /api/admin/recommendations/:id
DELETE /api/admin/recommendations/:id
```

Review của khách hàng bắt đầu ở trạng thái `pending`; sales/manager duyệt bằng `status=approved`. Chỉ review đã duyệt mới xuất hiện công khai.

### Lượt xem và hành vi

```http
POST /api/products/:id/views
POST /api/behaviors
GET  /api/admin/behaviors
```

Các event được lưu riêng trong `product_views` và `user_behaviors`, không nhúng vào user/product để tránh document tăng không giới hạn.

### Wishlist và voucher theo người dùng

```http
GET    /api/wishlist
PUT    /api/wishlist
DELETE /api/wishlist/items/:productId
GET    /api/vouchers/mine
POST   /api/vouchers/claim
POST   /api/admin/user-vouchers
```

Wishlist nhúng `items[]`. User voucher có trạng thái `available`, `used` hoặc `expired`, unique theo cặp `userId/voucherId`.

### Flash sale và tư vấn mở rộng

```http
GET    /api/flash-sales
GET    /api/admin/flash-sales
POST   /api/admin/flash-sales
PATCH  /api/admin/flash-sales/:id
DELETE /api/admin/flash-sales/:id
POST   /api/appointments/:id/reviews
```

Flash sale nhúng các dòng `items[]` gồm variant, giá bán, hạn mức và số lượng đã bán. Appointment nhúng snapshot sản phẩm tư vấn; chỉ appointment `completed` mới được đánh giá.

### Collection và migration

Các entity mới gồm `flash_sales`, `consultation_reviews`, `product_recommendations`, `product_views`, `reviews`, `user_behaviors`, `user_vouchers` và `wishlists`. Chạy `pnpm run migrate-model` để bổ sung field mặc định và index không phá dữ liệu hiện hữu; chạy `pnpm run indexes` rồi `pnpm run seed` trên database dev riêng để tạo dữ liệu demo.

Các bản ghi này là mock/COD và thường được tạo cùng đơn hàng. `DELETE` chuyển payment/invoice sang `void`, không xóa cứng lịch sử tài chính.

### Entity không dùng CRUD xóa cứng

`roles`, `memberships`, `order_histories`, `inventory_logs` và `point_histories` là dữ liệu hệ thống/lịch sử append-only. `carts` và `orders` được thao tác qua workflow riêng để bảo toàn các ràng buộc tồn kho, thanh toán và báo cáo.
