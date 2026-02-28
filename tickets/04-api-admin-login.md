# Ticket 04 — API đăng nhập admin và session

## Mô tả
API đăng nhập admin: nhận email + password, kiểm tra với bảng Admin, trả session hoặc token để dùng cho các request vào khu vực admin (dùng trong ticket 05).

## Phạm vi
- Route: `POST /api/admin/login`.
- Body: `{ "email": string, "password": string }`.
- So sánh password với hash trong DB (bcrypt compare).
- Tạo session hoặc JWT:
  - **Session:** set HTTP-only cookie chứa session id, lưu session server-side (có thể dùng DB hoặc store đơn giản; nếu dùng DB có thể thêm bảng AdminSession).
  - **JWT:** trả access token (và optional refresh) trong JSON; client gửi kèm header `Authorization: Bearer <token>` khi gọi API admin.

## Yêu cầu chức năng
- Nếu email/password sai: trả 401, không set cookie / không trả token.
- Nếu đúng: trả 200 + session (cookie hoặc token); có thể kèm thông tin admin (id, email, name) không chứa password.
- Logout (optional nhưng nên có): `POST /api/admin/logout` xóa session / invalidate token.

## Acceptance criteria
- [ ] `POST /api/admin/login` tồn tại, so sánh password với hash an toàn.
- [ ] Trả 401 khi sai email hoặc password.
- [ ] Khi đúng: client có cách “đã đăng nhập” (cookie hoặc token) để gửi kèm request sau.
- [ ] Có endpoint hoặc cơ chế logout (xóa cookie hoặc blacklist token nếu dùng JWT).
- [ ] API đọc admin từ Prisma (model từ ticket 01).

## Gợi ý
- Nếu dùng JWT: env `JWT_SECRET`, thời hạn token (vd: 24h). Middleware/layout admin sẽ verify token từ header hoặc cookie.
- Nếu dùng cookie session: cần store (DB hoặc in-memory); cookie `httpOnly`, `secure` trong production.

## Ticket liên quan
- **01**, **02**, **03**. **05** (auth guard) sẽ gọi API kiểm tra session/token trước khi vào /admin.
