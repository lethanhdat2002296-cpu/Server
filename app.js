// Express app - được share giữa local dev (server.js) và Vercel function (api/index.js)
const express = require('express');
const path = require('path');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const checkinRoutes = require('./routes/checkin');
const settingsRoutes = require('./routes/settings');
const adminRoutes = require('./routes/admin');
const membersRoutes = require('./routes/members');
const publicRoutes = require('./routes/public');

const app = express();

app.use(cors());
// Tăng giới hạn body để chứa ảnh base64 (Vercel max body ~4.5MB)
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

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    server_time: new Date().toISOString(),
    has_db: !!process.env.DATABASE_URL
  });
});

// Trang chính - chỉ áp dụng khi chạy local (Vercel sẽ tự xử qua public/)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERR]', err);
  res.status(500).json({ error: err.message || 'Lỗi máy chủ' });
});

module.exports = app;
