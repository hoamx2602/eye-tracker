# Ticket 09 — Admin: Chi tiết session (ảnh sample, video)

## Mô tả
Trang chi tiết một session tại `/admin/sessions/[id]`: xem metadata session và **xem hình ảnh sample + video** đã lưu trữ (từ `videoUrl`, `calibrationImageUrls` trong Session).

## Phạm vi
- Page: `app/admin/sessions/[id]/page.tsx`.
- Lấy session theo id: dùng `GET /api/sessions/[id]` (hoặc API admin tương đương). Dữ liệu trả về có `videoUrl`, `calibrationImageUrls` (array URL), `config`, `validationErrors`, `meanErrorPx`, `createdAt`, v.v.
- Hiển thị:
  - Metadata: id, createdAt, status, meanErrorPx, số lượng ảnh, có video hay không.
  - Phần “Video”: nếu có `videoUrl` thì nhúng `<video>` hoặc link mở tab mới; nếu không có thì hiển thị “Không có video”.
  - Phần “Ảnh calibration”: hiển thị grid/list các ảnh từ `calibrationImageUrls` (mỗi URL là một `<img>` hoặc link mở ảnh). Có thể lazy load nếu nhiều ảnh.
- Có nút/link “Quay lại danh sách” (/admin/sessions) và “Dashboard” (/admin).

## Yêu cầu chức năng
- Session không tồn tại (404) → hiển thị thông báo “Session không tìm thấy” và link về danh sách.
- URL ảnh/video từ S3 (hoặc storage đã cấu hình) có thể load trực tiếp trong browser (CORS và bucket policy cho phép; đã có khi upload).
- UI chuẩn: section rõ ràng (Thông tin chung / Video / Ảnh sample); responsive cơ bản.

## Acceptance criteria
- [ ] Truy cập `/admin/sessions/[id]` (đã login) hiển thị đúng session tương ứng.
- [ ] Metadata session hiển thị đầy đủ (ít nhất: id, createdAt, meanErrorPx, status).
- [ ] Nếu có `videoUrl`: hiển thị player hoặc link mở video.
- [ ] Nếu có `calibrationImageUrls`: hiển thị danh sách/grid ảnh; click có thể xem phóng to hoặc mở tab mới (tùy chọn).
- [ ] 404 khi id không tồn tại; có navigation về list và dashboard.
- [ ] Chưa login thì bị redirect.

## Ticket liên quan
- **05**, **08**. Dữ liệu Session đã có trong schema (videoUrl, calibrationImageUrls).
