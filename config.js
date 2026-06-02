// Cấu hình hệ thống - đọc từ environment variables (Vercel + local .env)
// Khi chạy local: load .env qua dotenv (trong server.js)
// Khi chạy Vercel: env vars được set trong Vercel Project Settings

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-doi-thanh-cua-may-trong-env',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

  // Khung giờ check-in (24h)
  CHECKIN_START_HOUR: parseInt(process.env.CHECKIN_START_HOUR || '5', 10),  // 5:00
  CHECKIN_END_HOUR: parseInt(process.env.CHECKIN_END_HOUR || '6', 10),      // 6:00

  // Khoá đăng nhập
  MAX_LOGIN_ATTEMPTS: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10),
  LOCKOUT_SECONDS: parseInt(process.env.LOCKOUT_SECONDS || '60', 10),

  // Domain công ty được chấp nhận cho email (ngoài @gmail.com)
  COMPANY_DOMAIN: process.env.COMPANY_DOMAIN || 'company',

  // Múi giờ server (quan trọng cho check-in ở Vercel - mặc định Vercel chạy UTC)
  // Để Asia/Ho_Chi_Minh thì check-in dựa theo giờ Việt Nam dù server ở đâu
  TIMEZONE: process.env.TIMEZONE || 'Asia/Ho_Chi_Minh',

  // SMTP
  SMTP: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '5AM Check-in <noreply@5am.local>'
  }
};
