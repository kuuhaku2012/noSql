# Maison Belle CRUD Design

## Mục tiêu

Các API quản trị phải đọc/ghi dữ liệu thật trong MongoDB. Dữ liệu demo chỉ là dữ liệu khởi tạo cho database dev; không dùng mảng trong bộ nhớ và không xóa lịch sử nghiệp vụ.

## Phạm vi

- Products và product variants: create/read/update/soft-delete. Không xóa cứng sản phẩm đã có tham chiếu từ đơn hàng.
- Promotions: create/read/update/soft-delete.
- Vouchers: create/read/update/soft-delete; endpoint validate hiện có tiếp tục phục vụ khách hàng.
- Deliveries: create/read/update trạng thái; không xóa lịch sử giao hàng.
- Returns: create/read/update trạng thái; không xóa lịch sử đổi trả.
- Inventory: giữ mô hình giao dịch nhập kho/điều chỉnh append-only; không cho sửa/xóa log kho.

## Quyền

- `sales`, `manager`: products, promotions, vouchers, deliveries, returns theo nghiệp vụ.
- `warehouse`, `manager`: inventory và deliveries.
- `manager`: toàn bộ CRUD quản trị và reports.
- `customer`: chỉ dữ liệu catalog công khai, giỏ hàng, voucher validate, đơn và lịch của chính mình.

## Quy tắc dữ liệu

- Dùng MongoDB native driver và ObjectId reference theo mô hình hiện tại.
- Xóa quản trị là soft-delete bằng `isActive: false` hoặc `status: cancelled/rejected`; bảo toàn tham chiếu và audit.
- Mọi request body được validate; các status dùng transition map.
- Các trường tiền là số không âm; ngày phải hợp lệ; variant phải tồn tại và thuộc product tương ứng.
- Response giữ format `{ data: ... }` và lỗi giữ format hiện tại có `requestId`.

## Kiểm thử

- Mỗi endpoint CRUD mới có test integration với MongoDB test database.
- Mỗi test quyền phải chứng minh customer bị từ chối và role hợp lệ được phép.
- Chạy focused test trước khi viết production code, sau đó chạy toàn bộ `pnpm test`.
