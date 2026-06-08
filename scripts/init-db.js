// Chạy 1 lần để tạo schema trên DB
// Usage: node scripts/init-db.js
require('dotenv').config();
const { initSchema, pool } = require('../lib/db');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL chưa được set trong .env');
    process.exit(1);
  }
  console.log('Đang tạo schema + index...');
  try {
    await initSchema();
    console.log('✓ Tạo schema thành công!');
    console.log('  Bảng: users(admin), members, member_checkins, payments, archive_data,');
    console.log('        app_config, audit_log, rate_limits, login_attempts, reset_codes');
    console.log('  Đã thêm: cột period/amount_received/detected_amount + token_version,');
    console.log('           unique SĐT, FK payments.member_id, các index báo cáo.');
  } catch (err) {
    console.error('✗ Lỗi:', err.message);
    process.exit(1);
  }
  await pool.end();
  process.exit(0);
})();
