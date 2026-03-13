# Ticket 02 — Seed script cho admin

## Mô tả
Tạo script (npm script + file thực thi) để seed ít nhất một tài khoản admin vào database. Dùng khi setup lần đầu hoặc cần tạo admin từ CLI.

## Phạm vi
- Một script chạy được bằng lệnh (vd: `npm run db:seed` hoặc `npx ts-node scripts/seed-admin.ts`).
- Script đọc email/password từ biến môi trường hoặc argument/giá trị mặc định (chỉ dùng cho dev/staging; production nên dùng env).
- Hash mật khẩu trước khi ghi DB (bcrypt hoặc thư viện tương đương).

## Yêu cầu chức năng
- Khi chạy script: kết nối DB qua Prisma, tạo một bản ghi Admin (email + passwordHash) nếu chưa tồn tại (upsert by email).
- Tránh ghi đè mật khẩu nếu admin đã tồn tại, trừ khi có flag kiểu `--force` hoặc env `SEED_ADMIN_FORCE=1`.
- Có thể seed nhiều admin nếu cần (đọc từ env list hoặc file).

## Acceptance criteria
- [ ] Có file script (vd: `scripts/seed-admin.ts` hoặc `prisma/seed.ts`) thực hiện seed admin.
- [ ] Có npm script trong `package.json` để chạy seed (vd: `db:seed`).
- [ ] Script dùng biến môi trường (vd: `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`) hoặc argument; không hardcode mật khẩu thật.
- [ ] Mật khẩu được hash trước khi lưu (bcrypt hoặc tương đương).
- [ ] Chạy script thành công tạo/update admin trong DB; chạy lại không lỗi (idempotent nếu dùng upsert).

## Gợi ý
- Dependency: `bcrypt` hoặc `bcryptjs` để hash password.
- Trong `package.json`: `"db:seed": "ts-node --compiler-options '{\"module\":\"CommonJS\"}' scripts/seed-admin.ts"` (hoặc dùng `prisma db seed` nếu dùng Prisma seed).
- README hoặc .env.example ghi rõ các biến SEED_ADMIN_* (không ghi giá trị thật).

## Ticket liên quan
- **01** (schema) phải xong trước. **03** (API tạo admin) có thể dùng logic hash tương tự.
