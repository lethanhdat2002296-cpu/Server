// Express app - được share giữa local dev (server.js) và Vercel function (api/index.js)
const express = require('express');
const path = require('path');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const checkinRoutes = require('./routes/checkin');
const settingsRoutes = require('./routes/settings');
const paymentRoutes = require('./routes/payment');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(cors());
// Tăng giới hạn body để chứa ảnh base64 (Vercel max body ~4.5MB)
app.use(express.json({ limit: '6mb' }));

// Khi chạy local thì serve static từ public/ luôn cho tiện
// (trên Vercel, /public được CDN serve tự động qua vercel.json)
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);

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
