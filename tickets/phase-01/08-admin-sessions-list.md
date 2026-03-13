# Ticket 08 — Admin: Danh sách sessions

## Mô tả
Trang danh sách sessions tại `/admin/sessions`: bảng hoặc danh sách các session đã lưu, có link sang trang chi tiết từng session (ticket 09).

## Phạm vi
- Page: `app/admin/sessions/page.tsx`.
- Lấy danh sách từ API hiện có `GET /api/sessions` (có thể thêm API riêng `GET /api/admin/sessions` nếu cần phân quyền hoặc thêm field). Nếu dùng API công cộng thì cần đảm bảo chỉ admin mới gọi được (gọi từ server với session admin).
- Hiển thị: id (hoặc rút gọn), createdAt, status, meanErrorPx (nếu có), có video / có ảnh (boolean). Có cột “Chi tiết” hoặc click vào row → sang `/admin/sessions/[id]`.

## Yêu cầu chức năng
- Danh sách có phân trang hoặc “load more” (tùy số lượng; có thể limit 20–50 mỗi trang).
- Sắp xếp mặc định theo `createdAt` giảm dần (mới nhất trước).
- UI: bảng (table) hoặc card list; chuẩn, dễ đọc. Có link “Dashboard” và “Đăng xuất”.
- Optional: filter theo khoảng thời gian, tìm theo id (nếu product cần).

## Acceptance criteria
- [ ] Truy cập `/admin/sessions` (đã login) hiển thị danh sách sessions từ DB.
- [ ] Mỗi session có link hoặc nút sang trang chi tiết `/admin/sessions/[id]`.
- [ ] Có navigation về dashboard và logout.
- [ ] Chưa login thì bị redirect.

## Ticket liên quan
- **05**, **07**. **09** (session detail – trang đích khi click vào một session).
