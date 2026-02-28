# Admin Feature — Overview & Ticket Index

## Mục tiêu
- Trang admin yêu cầu đăng nhập trước khi truy cập.
- Seed script để tạo tài khoản admin trong database.
- API riêng (hoặc one-time) để tạo tài khoản admin khi cần.
- Màn hình admin chuẩn: dashboard thống kê, xem session, hình ảnh sample, video đã lưu theo session.

## Công nghệ giả định
- Next.js App Router, Prisma, PostgreSQL (hiện tại).
- Auth: session-based (cookie + server check) hoặc JWT tùy ticket.
- Admin UI: có thể dùng Tailwind giống app chính, hoặc component đơn giản.

## Ticket list (implement theo thứ tự hoặc theo yêu cầu)

| # | Ticket | Mô tả ngắn |
|---|--------|-------------|
| 01 | [01-admin-schema-and-migration.md](./01-admin-schema-and-migration.md) | Prisma: model Admin + migration |
| 02 | [02-seed-admin-script.md](./02-seed-admin-script.md) | Script seed admin vào DB |
| 03 | [03-api-create-admin.md](./03-api-create-admin.md) | API tạo tài khoản admin |
| 04 | [04-api-admin-login.md](./04-api-admin-login.md) | API đăng nhập admin + session/token |
| 05 | [05-admin-auth-guard.md](./05-admin-auth-guard.md) | Bảo vệ route /admin (phải login) |
| 06 | [06-admin-login-page.md](./06-admin-login-page.md) | Trang đăng nhập admin (/admin/login) |
| 07 | [07-admin-dashboard.md](./07-admin-dashboard.md) | Dashboard thống kê (/admin) |
| 08 | [08-admin-sessions-list.md](./08-admin-sessions-list.md) | Trang danh sách sessions (/admin/sessions) |
| 09 | [09-admin-session-detail.md](./09-admin-session-detail.md) | Trang chi tiết session: ảnh, video (/admin/sessions/[id]) |

## Thứ tự gợi ý
1. **01** → **02** → **03** → **04** (nền tảng auth + data).
2. **05** → **06** (vào được khu vực admin và login).
3. **07** → **08** → **09** (dashboard và xem dữ liệu).

Đọc từng ticket, khi muốn implement ticket nào thì bảo rõ số/tên ticket để implement đúng scope.
