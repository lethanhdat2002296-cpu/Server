# 5AM Check-in

Hệ thống check-in dậy sớm 5:00 AM hàng ngày. Stack: **Node.js + Express + Neon Postgres**, deploy lên **Vercel**.

## Tính năng

- Đăng ký / đăng nhập với validation đầy đủ
- Khoá tài khoản 60s sau 5 lần sai mật khẩu
- Check-in trong khung 5:00 - 6:00 sáng (nút đổi màu: đỏ → xanh → xám)
- Lịch sử + thống kê tháng (đã check / quên / tổng)
- Cập nhật profile + đổi mật khẩu qua mã email
- Timezone Asia/Ho_Chi_Minh (Vercel mặc định UTC, đã handle)

---

## 🚀 Deploy Vercel + GitHub + Neon (từng bước)

### Bước 0 — ⚠ Reset Neon password trước

Mày đã share connection string ra ngoài chat. Vào **Neon Console → Project → Settings → Reset Password** để tạo password mới. Lấy lại **connection string mới** (sẽ dùng ở Bước 2).

### Bước 1 — Push code lên GitHub

```bash
cd C:\Users\letha\OneDrive\Desktop\5AM
git init
git add .
git commit -m "Initial: 5AM check-in app"
```

Tạo repo trống trên GitHub (không chọn README/gitignore), copy URL rồi:

```bash
git remote add origin https://github.com/<your-username>/5am-checkin.git
git branch -M main
git push -u origin main
```

✅ File `.env` đã có trong `.gitignore` nên password DB sẽ không bị push lên.

### Bước 2 — Init schema lên Neon (chạy 1 lần)

Sửa file `.env` local, dán connection string MỚI (sau khi reset password):

```env
DATABASE_URL=postgresql://neondb_owner:NEW_PASSWORD@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
JWT_SECRET=<random-32-ky-tu>
```

Tạo `JWT_SECRET` bằng cách (chạy trong PowerShell):
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Chạy init schema:
```bash
npm install
npm run init-db
```

Output:
```
✓ Tạo schema thành công!
  - users
  - check_ins
  - login_attempts
  - reset_codes
```

### Bước 3 — Deploy Vercel

1. Vào https://vercel.com/new
2. **Import** repo GitHub vừa push
3. Khi setup, vào tab **Environment Variables**, paste các biến sau:

| Tên | Giá trị |
|-----|---------|
| `DATABASE_URL` | Connection string Neon (đã reset) |
| `JWT_SECRET` | Chuỗi random 32 ký tự (như Bước 2) |
| `TIMEZONE` | `Asia/Ho_Chi_Minh` |
| `COMPANY_DOMAIN` | `company` (hoặc tên domain công ty mày) |
| `JWT_EXPIRES_IN` | `7d` (tuỳ chọn) |
| `CHECKIN_START_HOUR` | `5` (tuỳ chọn) |
| `CHECKIN_END_HOUR` | `6` (tuỳ chọn) |
| `MAX_LOGIN_ATTEMPTS` | `5` (tuỳ chọn) |
| `LOCKOUT_SECONDS` | `60` (tuỳ chọn) |

> Cấu hình SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, …) thêm sau nếu muốn gửi email reset password thật. Để trống thì mã sẽ log ra Vercel Function Logs (chỉ DEV).

4. Bấm **Deploy**. Đợi 1-2 phút.
5. Vercel cấp URL dạng `https://5am-checkin-xxx.vercel.app`. Mở thử.

### Bước 4 — Tích hợp Neon ↔ Vercel (tuỳ chọn, nhưng nên làm)

Vercel có integration sẵn với Neon. Vào **Vercel Project → Storage → Connect Database → Neon** để auto-sync env. Lúc đó không cần tự dán `DATABASE_URL` nữa.

### Bước 5 — Push update tự động deploy

Từ giờ mỗi `git push origin main` sẽ tự build & deploy. Vercel có preview deploy cho từng PR.

---

## 🖥 Chạy local

```bash
npm install
# Sửa .env với DATABASE_URL của Neon (đã reset password)
npm run init-db    # chỉ chạy 1 lần
npm start
```

Mở http://localhost:3000

---

## 📁 Cấu trúc

```
5AM/
├── api/index.js          # Vercel serverless entry
├── app.js                # Express app (dùng chung local + Vercel)
├── server.js             # Local dev only
├── config.js             # Đọc env vars
├── vercel.json           # Cấu hình routing Vercel
├── lib/db.js             # Neon Postgres pool + schema
├── routes/
│   ├── auth.js           # Đăng ký / đăng nhập
│   ├── checkin.js        # Check-in + lịch sử + stats
│   └── settings.js       # Profile + đổi password
├── middleware/auth.js    # JWT verify
├── utils/
│   ├── validators.js
│   └── email.js
├── scripts/init-db.js    # Tạo schema 1 lần
├── public/               # Frontend (auto serve trên Vercel)
│   ├── index.html        # Login / Register
│   ├── dashboard.html
│   ├── css/style.css
│   └── js/{auth,app}.js
├── .env.example          # Template (commit lên Git)
├── .env                  # Local thật (KHÔNG commit)
└── .gitignore
```

---

## 🛢 Schema Postgres

Đã được tạo tự động bởi `npm run init-db` (hoặc lazy trên cold start đầu tiên):

```sql
-- users
id SERIAL PRIMARY KEY,
full_name, phone (UNIQUE), email (UNIQUE), username (UNIQUE), password_hash,
created_at TIMESTAMPTZ

-- check_ins
id SERIAL, user_id FK, check_date TEXT (YYYY-MM-DD), check_time TEXT,
UNIQUE(user_id, check_date)

-- login_attempts
username TEXT PK, failed_count INT, locked_until BIGINT (ms)

-- reset_codes
id SERIAL, user_id FK, code TEXT, expires_at BIGINT, used INT
```

---

## 🔌 API Endpoints

| Method | Endpoint | Auth | Mô tả |
|--------|----------|------|-------|
| POST | `/api/auth/register` | – | Đăng ký |
| POST | `/api/auth/login` | – | Đăng nhập |
| GET | `/api/checkin/status` | JWT | Trạng thái check-in hôm nay |
| POST | `/api/checkin/check-in` | JWT | Check-in |
| GET | `/api/checkin/history` | JWT | Lịch sử check-in |
| GET | `/api/checkin/stats` | JWT | Thống kê tháng |
| GET | `/api/settings/me` | JWT | Profile hiện tại |
| PUT | `/api/settings/profile` | JWT | Cập nhật họ tên + email |
| POST | `/api/settings/password/request-code` | JWT | Gửi mã đổi mật khẩu |
| POST | `/api/settings/password/change` | JWT | Đổi mật khẩu |
| GET | `/api/health` | – | Health check |

---

## 🐛 Troubleshooting

**Vercel deploy fail "Cannot find module"**
→ Push lại, đảm bảo `package.json` có dep đầy đủ. Không commit `node_modules/`.

**`has_db: false` ở `/api/health`**
→ Chưa set `DATABASE_URL` trên Vercel Env. Settings → Environment Variables.

**500 error khi gọi API**
→ Mở **Vercel Dashboard → Project → Logs**, xem stack trace.

**Check-in lúc 5h sáng VN nhưng vẫn báo disabled**
→ Kiểm tra biến `TIMEZONE=Asia/Ho_Chi_Minh` đã set chưa.

**Email reset không gửi được**
→ Bình thường nếu chưa set SMTP. Mã được log ra Vercel Function Logs (Dashboard → Logs).
