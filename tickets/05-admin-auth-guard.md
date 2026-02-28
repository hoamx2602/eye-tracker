# Ticket 05 — Admin auth guard (bảo vệ route /admin)

## Mô tả
Đảm bảo mọi trang dưới `/admin` (trừ `/admin/login`) đều yêu cầu đăng nhập. Nếu chưa login → redirect về `/admin/login` (hoặc trả 401/403).

## Phạm vi
- Next.js: dùng middleware hoặc layout trong `app/admin/` kiểm tra session/token.
- Không implement form login UI ở ticket này (form login ở ticket 06); chỉ logic “đã login chưa” và redirect.

## Yêu cầu chức năng
- Cách 1 (Middleware): trong `middleware.ts` (root), nếu path bắt đầu `/admin` và không phải `/admin/login`, kiểm tra cookie hoặc header auth; nếu không hợp lệ → redirect đến `/admin/login`.
- Cách 2 (Layout): trong `app/admin/layout.tsx`, get session/token (từ cookie hoặc header), nếu không có → redirect đến `/admin/login`; nếu có thì render `children`. Trang `/admin/login` không dùng layout này (đặt ngoài hoặc exclude trong layout).
- Session/token lấy từ kết quả ticket 04 (cookie sau login hoặc JWT trong cookie/header).

## Acceptance criteria
- [ ] Truy cập `/admin` hoặc `/admin/sessions` khi chưa login → redirect về `/admin/login`.
- [ ] Truy cập `/admin/login` khi chưa login → hiển thị trang login (không redirect loop).
- [ ] Sau khi login thành công, truy cập `/admin` và `/admin/*` không bị redirect về login (trong phạm vi session còn hiệu lực).
- [ ] Sau logout, truy cập lại `/admin` → redirect về `/admin/login`.

## Gợi ý
- Nếu dùng JWT trong cookie: layout đọc cookie, gọi API `GET /api/admin/me` (optional ticket) hoặc verify JWT tại server để lấy admin info và xác nhận còn hiệu lực.
- Next.js middleware: `matcher: ['/admin/:path*']`, exclude `/admin/login`.

## Ticket liên quan
- **04** (login/session). **06** (trang login). **07**, **08**, **09** (các trang admin dùng guard này).
