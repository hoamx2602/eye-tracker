# Ticket 03 — API tạo tài khoản admin

## Mô tả
Cung cấp API (route Next.js) **dùng riêng** để tạo tài khoản admin khi cần (ví dụ lần đầu setup hoặc thêm admin mới). API này cần được bảo vệ để chỉ gọi trong điều kiện cho phép (secret key, hoặc chỉ khi chưa có admin nào).

## Phạm vi
- Một route: `POST /api/admin/register` (hoặc `/api/admin/accounts`).
- Chỉ tạo bản ghi Admin trong DB (email + password hash); không trả session/token (login làm ở ticket 04).

## Yêu cầu chức năng
- Body: `{ "email": string, "password": string }` (và optional `name`).
- Kiểm tra điều kiện gọi API:
  - **Cách A:** Header hoặc body có secret (vd: `ADMIN_REGISTER_SECRET` trong env). Nếu sai secret → 403.
  - **Cách B:** Chỉ cho tạo nếu DB chưa có admin nào (first-time setup). Nếu đã có admin → 403 trừ khi có secret.
- Validate email hợp lệ, password đủ mạnh (độ dài tối thiểu).
- Hash password (cùng cách với seed script) rồi lưu vào bảng Admin.
- Nếu email đã tồn tại: trả 409 Conflict hoặc 200 + message "already exists" (tùy product).

## Acceptance criteria
- [ ] `POST /api/admin/register` (hoặc tên tương đương) tồn tại và xử lý đúng.
- [ ] Có bảo vệ bằng secret hoặc điều kiện “chưa có admin”.
- [ ] Mật khẩu không lưu plain text; dùng hash giống seed.
- [ ] Trả mã HTTP và JSON rõ ràng (201 Created, 400 Validation, 403 Forbidden, 409 Conflict).
- [ ] Document trong README hoặc comment: env `ADMIN_REGISTER_SECRET` (nếu dùng).

## Ticket liên quan
- **01** (schema), **02** (seed – dùng chung logic hash). **04** (login) dùng admin đã tạo.
