# Ticket 07 — Admin dashboard (thống kê)

## Mô tả
Màn hình dashboard tại `/admin` (sau khi login): thống kê tổng quan về dữ liệu sessions và có thể storage/media, thiết kế gọn, dễ đọc.

## Phạm vi
- Page: `app/admin/page.tsx` (hoặc `app/admin/dashboard/page.tsx` nếu tách).
- Chỉ đọc dữ liệu (sessions từ Prisma); không chỉnh sửa/xóa ở ticket này.
- Layout admin chung (sidebar hoặc header) có thể làm trong ticket này hoặc tách; nếu tách thì dashboard chỉ cần nội dung chính.

## Yêu cầu chức năng
- Thống kê hiển thị ít nhất:
  - Tổng số sessions.
  - Số sessions trong 7 ngày gần nhất (hoặc 24h).
  - Có thể thêm: số session có video, số session có calibration images; trung bình meanErrorPx (nếu có).
- Dữ liệu lấy từ Prisma: `Session` model (đã có trong schema). Có thể thêm API `GET /api/admin/stats` trả JSON thống kê, hoặc query trực tiếp trong Server Component.
- UI: thẻ (cards) hoặc bảng số liệu đơn giản; có thể có biểu đồ đơn giản (optional). Thiết kế chuẩn, rõ ràng (font, spacing, màu nền admin).
- Có link/navigation sang “Danh sách sessions” (/admin/sessions) và “Đăng xuất”.

## Acceptance criteria
- [ ] Truy cập `/admin` (đã login) hiển thị dashboard với ít nhất tổng số sessions và thống kê theo thời gian.
- [ ] Số liệu đúng với dữ liệu trong DB.
- [ ] Có điều hướng sang trang sessions và logout.
- [ ] Chưa login thì bị redirect (đã xử lý ở ticket 05).

## Ticket liên quan
- **05** (guard), **08** (sessions list). Có thể dùng layout chung admin (header/sidebar) cho 07, 08, 09.
