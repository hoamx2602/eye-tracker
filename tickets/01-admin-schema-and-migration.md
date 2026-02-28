# Ticket 01 — Admin schema và migration

## Mô tả
Thêm model **Admin** vào Prisma schema và tạo migration để lưu tài khoản admin (phục vụ login và bảo vệ trang admin).

## Phạm vi
- Chỉ thay đổi `prisma/schema.prisma` và tạo migration.
- Không viết API, không viết UI.

## Yêu cầu chức năng
- Bảng `Admin` có ít nhất: `id`, `email`, `passwordHash`, `createdAt`, `updatedAt`.
- Email dùng để đăng nhập; mật khẩu lưu dạng hash (bcrypt hoặc tương đương khi implement login).
- Có thể thêm field `name` (optional) cho hiển thị.

## Acceptance criteria
- [ ] Model `Admin` tồn tại trong `prisma/schema.prisma`.
- [ ] Chạy `npx prisma migrate dev --name add_admin` (hoặc tương đương) tạo migration thành công.
- [ ] Sau khi migrate, bảng admin tồn tại trong DB và Prisma Client có type `Admin`.

## Gợi ý schema (tham khảo)

```prisma
model Admin {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  name         String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

## Lưu ý kỹ thuật
- Tên bảng có thể để mặc định `Admin` hoặc map `@@map("admins")` tùy convention.
- Cần có migration SQL trong `prisma/migrations/` sau bước này.

## Ticket liên quan
- **02** (seed) và **04** (login) sẽ dùng model này.
