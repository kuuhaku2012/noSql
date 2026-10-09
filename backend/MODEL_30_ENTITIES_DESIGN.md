# Thiết kế mô hình MongoDB theo mục 2.6.2 và 2.6.3

## Mục tiêu

Mở rộng backend để bao phủ 30 thực thể nghiệp vụ trong tài liệu Phase4, giữ nguyên hợp đồng API hiện có và không sửa giao diện. Mô hình MongoDB dùng document cha cho dữ liệu chi tiết có vòng đời phụ thuộc, collection riêng cho dữ liệu tăng trưởng/lịch sử hoặc được nhiều nghiệp vụ dùng chung.

## Ánh xạ 30 thực thể logic

| Thực thể tài liệu | MongoDB | Cách lưu |
|---|---|---|
| Brands | `brands` | Collection riêng |
| CartItems | `carts.items[]` | Nhúng trong cart |
| Carts | `carts` | Collection riêng |
| Categories | `categories` | Collection riêng, hỗ trợ `parentCategoryId` |
| ConsultationProducts | `appointments.products[]` | Nhúng trong phiên tư vấn |
| ConsultationReviews | `consultation_reviews` | Collection riêng |
| Consultations | `appointments` | Collection hiện hữu, giữ tên để tương thích API |
| FlashSaleItems | `flash_sales.items[]` | Nhúng trong flash sale |
| FlashSales | `flash_sales` | Collection riêng |
| Inventories | `inventories` | Collection riêng, unique theo store/variant |
| InventoryLogs | `inventory_logs` | Collection append-only |
| Memberships | `memberships` | Collection riêng, unique theo user |
| OrderDetails | `orders.items[]` | Snapshot nhúng trong đơn hàng |
| OrderHistories | `order_histories` | Collection append-only |
| Orders | `orders` | Collection riêng |
| PointHistories | `point_histories` | Collection append-only |
| ProductRecommendations | `product_recommendations` | Collection riêng |
| ProductVariants | `product_variants` | Collection riêng |
| ProductViews | `product_views` | Collection tăng trưởng theo lượt xem |
| Products | `products` | Collection riêng |
| Reviews | `reviews` | Collection riêng, có kiểm duyệt |
| Roles | `roles` | Collection riêng |
| Stores | `stores` | Collection riêng |
| UserAddresses | `user_addresses` | Collection riêng |
| UserBehaviors | `user_behaviors` | Collection tăng trưởng theo sự kiện |
| UserVouchers | `user_vouchers` | Collection riêng, unique theo user/voucher |
| Users | `users` | Collection riêng |
| Vouchers | `vouchers` | Collection riêng |
| WishlistItems | `wishlists.items[]` | Nhúng trong wishlist |
| Wishlists | `wishlists` | Collection riêng, unique theo user |

`payments`, `invoices`, `deliveries` và `returns` là các collection mở rộng cần cho phạm vi API/10 nghiệp vụ hiện tại; chúng không thay thế 30 thực thể trong tài liệu.

## Dữ liệu và quan hệ chính

- Sản phẩm tham chiếu category, brand; variant tham chiếu product; inventory tham chiếu store và variant.
- Order giữ snapshot tên sản phẩm, SKU, giá bán, giảm giá, thông tin nhận hàng và voucher đã áp dụng.
- Cart, wishlist, flash sale và consultation nhúng các dòng chi tiết nhỏ, đọc cùng document cha.
- Review tham chiếu user/product; recommendation tham chiếu product/recommendedProduct.
- User voucher tham chiếu user/voucher; user behavior và product view lưu riêng để không làm phình document user/product.
- Consultation review tham chiếu consultation/user; sản phẩm tư vấn được snapshot nhúng trong appointment.

## Quyền và tính nhất quán

- Customer chỉ sửa dữ liệu của mình: cart, address, wishlist, review, behavior/view, user voucher claim và appointment.
- Sales/manager xử lý tư vấn, recommendation và review moderation.
- Manager quản lý flash sale, user voucher assignment và model catalog mở rộng.
- Giá, số lượng và trạng thái giao dịch phải được kiểm tra trước khi ghi.
- Không xóa cứng lịch sử, review đã phát sinh, view/behavior, inventory log hoặc point history.

## Chỉ mục

- Unique: users.email/phone, products.slug, variants.sku, vouchers.code, categories.slug, brands.code/slug, stores.code.
- Quan hệ: inventories(storeId, variantId), memberships.userId, userVouchers(userId, voucherId), wishlists.userId.
- Truy vấn: reviews(productId, status, createdAt), recommendations(productId, rank), views(userId, viewedAt), behaviors(userId, createdAt), flashSales(startDate, endDate, isActive).

## Tương thích và migration

ID hiện hữu được giữ nguyên để không phá database dev/API. Script migration chỉ bổ sung field mặc định, tạo collection/index và chuyển các field tương thích; không xóa document không có `isDemo`. Seed demo tạo dữ liệu mẫu cho các collection mới và gắn `isDemo: true`.

## Tiêu chí nghiệm thu

1. `create-indexes.js` tạo đủ collection/index mới trên database dev.
2. Seed tạo bản ghi demo cho 30 thực thể logic, gồm cả các entity nhúng.
3. API public/admin cho review, wishlist, recommendation, flash sale, behavior/view, user voucher và consultation review chạy đúng quyền.
4. Test bao phủ validation, scope theo user, moderation, unique relation và không xóa cứng lịch sử.
5. Bộ test hiện hữu không bị phá; frontend không bị sửa.
