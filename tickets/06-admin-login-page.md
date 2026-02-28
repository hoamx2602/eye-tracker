# Ticket 06 — Trang đăng nhập admin

## Mô tả
Màn hình đăng nhập admin tại `/admin/login`: form email + password, gọi API login (ticket 04), xử lý thành công/ lỗi và chuyển hướng vào dashboard.

## Phạm vi
- Một page: `app/admin/login/page.tsx` (hoặc route tương đương).
- Form đơn giản: email (input), password (input type password), nút Submit.
- Gọi `POST /api/admin/login` với body `{ email, password }`.
- Không nằm trong layout yêu cầu auth (để tránh redirect loop); có thể dùng layout riêng cho `/admin/login`.

## Yêu cầu chức năng
- Submit form → gọi API login. Nếu 401: hiển thị lỗi “Email hoặc mật khẩu không đúng” (hoặc tương đương).
- Nếu 200: lưu session/token (set cookie đã do server set, hoặc client lưu token vào cookie/memory rồi redirect) → redirect đến `/admin` (dashboard).
- UI chuẩn: có thể dùng Tailwind giống app chính; không cần design phức tạp nhưng rõ ràng (label, placeholder, nút đăng nhập).
- Optional: link “Quay lại app” về `/`.

## Acceptance criteria
- [ ] Truy cập `/admin/login` hiển thị form đăng nhập.
- [ ] Nhập sai email/password → hiển thị thông báo lỗi, không redirect.
- [ ] Nhập đúng → redirect đến `/admin` và có thể truy cập các trang admin (đã login).
- [ ] Trang không bị guard redirect khi chưa login (chỉ trang login được phép vào không cần auth).

## Ticket liên quan
- **04** (API login). **05** (guard redirect về đây khi chưa login).
