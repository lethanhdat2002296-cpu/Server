// Express app - được share giữa local dev (server.js) và Vercel function (api/index.js)
const express = require('express');
const path = require('path');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const checkinRoutes = require('./routes/checkin');
const settingsRoutes = require('./routes/settings');

const app = express();

app.use(cors());
app.use(express.json());

// Khi chạy local thì serve static từ public/ luôn cho tiện
// (trên Vercel, /public được CDN serve tự động qua vercel.json)
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/settings', settingsRoutes);

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
