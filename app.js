// Express app - được share giữa local dev (server.js) và Vercel function (api/index.js)
const express = require('express');
const path = require('path');
const cors = require('cors');
const { query } = require('./lib/db');
const config = require('./config');

const authRoutes = require('./routes/auth');
const checkinRoutes = require('./routes/checkin');
const settingsRoutes = require('./routes/settings');
const adminRoutes = require('./routes/admin');
const membersRoutes = require('./routes/members');
const publicRoutes = require('./routes/public');
const cronRoutes = require('./routes/cron');

const app = express();
const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

// ============ SECURITY HEADERS (defense-in-depth, không vỡ app) ============
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  // CSP permissive: cho phép inline/eval/CDN (app dùng nhiều) nhưng chặn plugin + nhúng iframe
  res.setHeader('Content-Security-Policy',
    "default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
  if (req.headers['x-forwarded-proto'] === 'https' || req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

// CORS: mặc định cho phép (app dùng chung origin). Đặt ALLOWED_ORIGINS để siết về domain cụ thể.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : null;
app.use(cors(allowedOrigins ? { origin: allowedOrigins } : {}));

// Tăng giới hạn body để chứa ảnh base64 (Vercel max body ~4.5MB; client đã resize ~600KB)
app.use(express.json({ limit: '6mb' }));

// Khi chạy local thì serve static từ public/ luôn cho tiện
// (trên Vercel, /public được CDN serve tự động qua vercel.json)
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);          // admin login + đổi mật khẩu
app.use('/api/checkin', checkinRoutes);    // admin điểm danh thành viên
app.use('/api/settings', settingsRoutes);  // admin profile/password
app.use('/api/admin', adminRoutes);        // duyệt thanh toán + báo cáo + audit
app.use('/api/members', membersRoutes);    // admin import/quản lý thành viên
app.use('/api/public', publicRoutes);      // CÔNG KHAI: gợi ý tên + submit thanh toán
app.use('/api/cron', cronRoutes);          // job định kỳ (bảo vệ bằng CRON_SECRET)

// Health check: kiểm tra DB THẬT (uptime monitor phát hiện được sự cố)
app.get('/api/health', async (req, res) => {
  let db = 'down', latency = null;
  try {
    const t0 = Date.now();
    await query('SELECT 1');
    db = 'up'; latency = Date.now() - t0;
  } catch (e) { /* db down */ }
  const ok = db === 'up';
  res.status(ok ? 200 : 503).json({
    ok,
    db,
    latency_ms: latency,
    has_smtp: !!(config.SMTP.host && config.SMTP.user && config.SMTP.pass),
    server_time: new Date().toISOString()
  });
});

// Trang chính - chỉ áp dụng khi chạy local (Vercel sẽ tự xử qua public/)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler: KHÔNG lộ chi tiết lỗi (tên bảng/cột/SQL) ra client ở production
app.use((err, req, res, next) => {
  console.error('[ERR]', req.method, req.originalUrl, '-', (err && err.message) || err);
  res.status((err && err.status) || 500).json({
    error: isProd ? 'Lỗi máy chủ. Vui lòng thử lại sau.' : ((err && err.message) || 'Lỗi máy chủ')
  });
});

module.exports = app;
