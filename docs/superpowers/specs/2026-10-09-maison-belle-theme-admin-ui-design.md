# UI theme and admin operations design

## Mục tiêu

- Đồng bộ chế độ sáng/tối giữa toàn bộ trang khách hàng và trang vận hành.
- Làm sidebar admin gọn hơn, có thể thu gọn trên desktop và mở dạng drawer trên màn hình nhỏ.
- Dùng font sans dễ đọc cho thao tác, bảng và form admin; chỉ giữ serif cho nhận diện/thành phần tiêu đề phù hợp.
- Làm dashboard/report chart dễ đọc ở cả hai theme, không thêm thư viện biểu đồ hoặc thay đổi API.

## Quyết định thiết kế

1. Tạo `css/theme.css` làm lớp override cuối cùng, dùng lại các token CSS hiện có và bổ sung token cho surface, border, input, table, chart và admin.
2. Gắn stylesheet này vào mọi HTML page sau các stylesheet hiện hữu để không phải lặp logic theme ở từng trang.
3. Sidebar admin có hai trạng thái desktop: đầy đủ và compact. Trạng thái được lưu ở `localStorage` với key `mb-admin-sidebar`. Trên mobile, nút menu hiện sidebar dạng drawer như hiện tại.
4. Không thay đổi nghiệp vụ, endpoint, payload hoặc cách gọi API. Biểu đồ sử dụng markup hiện có trong `js/admin.js` và chỉ được cải thiện bằng CSS.

## Tiêu chí nghiệm thu

- Mọi trang khách hàng và admin đều có theme stylesheet chung.
- Chuyển sáng/tối không còn các panel, input, table, loading/error state bị nền trắng/chữ chìm rõ rệt.
- Sidebar admin thu gọn được trên desktop, có tooltip/title và không làm mất khả năng truy cập bằng bàn phím.
- Dashboard/report có biểu đồ doanh thu và trạng thái đơn rõ ràng ở cả hai theme.
- Test frontend, syntax check và smoke test localhost đều đạt.
