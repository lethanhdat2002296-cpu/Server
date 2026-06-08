# 5AM Check-in

Hệ thống điểm danh dậy sớm 5:00 sáng + thu **phí thành viên định kỳ** cho nhóm.
Stack: **Node.js + Express + Neon Postgres**, deploy trên **Vercel** (1 serverless function).

> Mô hình: **không có tài khoản cho thành viên**. Admin import danh sách, tự điểm danh,
> và duyệt biên lai thanh toán. Thành viên chỉ dùng **trang công khai** để nộp biên lai
> và tra cứu trạng thái (xác minh bằng 4 số cuối SĐT).

---

## Tính năng

**Admin (đăng nhập):**
- Đăng nhập JWT (12h) + khoá sau 5 lần sai, rate-limit theo IP, thu hồi token khi đổi mật khẩu.
- Import thành viên từ Excel (dedup theo SĐT), sửa/xoá thành viên.
- **Điểm danh** bằng tích chọn, nghiêm khung **5:00–5:59** (theo giờ VN); tích/bỏ hàng loạt theo bộ lọc; xuất Excel hôm nay.
- **Duyệt thanh toán**: pending → confirmed/rejected, gửi email kết quả, ghi số tiền thực thu.
- **Báo cáo**: tổng quan, nhanh/chi tiết (streak, tổng đã/chưa), tuần/tháng + biểu đồ, **bảng xếp hạng**, **xem chi tiết 1 thành viên**, xuất Excel.
- **Công nợ theo kỳ** (`YYYY-MM`): ai đã đóng / chờ duyệt / chưa đóng + tổng dự kiến vs đã thu; **nhắc đóng phí** qua email.
- **Sao lưu / Lưu trữ / Khôi phục**: backup JSON, archive cộng dồn (giữ tổng + nối streak), restore (cần nhập lại mật khẩu).
- Cấu hình **QR VietQR** (ngân hàng/STK/số tiền/nội dung), tải mã QR để in.
- Nhật ký thao tác (audit log).

**Công khai (`/payment.html`, không đăng nhập):**
- Gõ tên → gợi ý (che bớt SĐT/email) → **xác minh 4 số cuối SĐT** (khoá 5 lần sai/15 phút).
- Hiện **mã QR** chuyển khoản + nút copy số tiền/nội dung + tải QR.
- Nộp biên lai (OCR client bằng Tesseract) → gửi email "đã nhận"; xem **lịch sử & trạng thái** của mình.

---

## Cấu trúc

```
app.js                 # Express app (dùng chung local + Vercel) + security headers + /api/health
server.js              # chạy local
api/index.js           # entrypoint Vercel
config.js              # đọc env (JWT, SMTP, timezone, khung giờ check-in)
lib/db.js              # Neon pool + initSchema (mọi bảng + index)
middleware/auth.js     # authRequired / adminRequired / passwordConfirmRequired (+ token_version)
routes/
  auth.js              # login, forgot/reset password
  members.js           # import Excel, CRUD thành viên
  checkin.js           # điểm danh (time-gate 5h) + bulk + xuất
  admin.js             # duyệt thanh toán, báo cáo, công nợ, backup/archive/restore, QR config, nhắc phí
  public.js            # gợi ý tên, xác minh, lịch sử, nộp biên lai, qr-download
  settings.js          # admin profile + đổi mật khẩu
  cron.js              # /api/cron/prune + /retry-email (bảo vệ bằng CRON_SECRET)
utils/                 # time, validators, ratelimit, mask, stats, receipt, email, appconfig
public/                # index.html (login), dashboard.html, payment.html, backup-viewer.html, css, js
tests/                 # Vitest: validators, time, stats, mask, receipt
```

---

## Chạy local

```bash
npm install
cp .env.example .env        # điền DATABASE_URL, JWT_SECRET, SMTP_*
npm run init-db             # tạo/migrate schema trên Neon
npm run create-admin        # tạo tài khoản admin đầu tiên
npm run dev                 # http://localhost:3000
npm test                    # chạy unit test
npm run lint                # ESLint
```

## Biến môi trường (`.env`)

| Biến | Bắt buộc | Ghi chú |
|------|----------|---------|
| `DATABASE_URL` | ✅ | Neon connection string (bắt buộc ở production) |
| `JWT_SECRET` | ✅ (prod) | chuỗi random 32+ ký tự |
| `JWT_EXPIRES_IN` | | mặc định `12h` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | (gửi email) | dùng domain có SPF/DKIM để tránh vào spam |
| `CRON_SECRET` | (cron) | bắt buộc để bật `/api/cron/*` |
| `ALLOWED_ORIGINS` | | danh sách origin (phẩy) để siết CORS |
| `CHECKIN_START_HOUR` / `CHECKIN_END_HOUR` | | mặc định 5 / 6 |
| `TIMEZONE` | | mặc định `Asia/Ho_Chi_Minh` |

---

## Deploy Vercel

- `vercel.json`: rewrite `/api/(.*)` → 1 function, security headers cho static, 2 cron daily (`prune`, `retry-email`).
- Đặt các biến môi trường trong **Vercel → Settings → Environment Variables** (đặc biệt `JWT_SECRET`, `DATABASE_URL`, `CRON_SECRET`).
- Vercel Cron gửi `Authorization: Bearer <CRON_SECRET>`. Hobby giới hạn cron 1 lần/ngày — cần dày hơn thì dùng GitHub Actions gọi `/api/cron/...?secret=...`.

## Bảo trì

- `/api/cron/prune` dọn bảng phụ phình to; `/api/cron/retry-email` gửi lại email kết quả bị lỗi.
- Khi DB gần đầy: **Sao lưu** (tải JSON) → **Lưu trữ** (gộp + dọn điểm danh cũ) → tiếp tục; tổng vẫn hiển thị đầy đủ.
- `/api/health` trả trạng thái DB thật (gắn uptime monitor).
