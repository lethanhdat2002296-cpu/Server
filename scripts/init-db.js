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
    console.log('✓ Tạo thành công!');
    console.log('  Bảng: users, check_ins, login_attempts, reset_codes');
    console.log('  Index: idx_checkins_user_id, idx_checkins_user_date_desc, idx_resetcodes_user_used');
  } catch (err) {
    console.error('✗ Lỗi:', err.message);
    process.exit(1);
  }
  await pool.end();
  process.exit(0);
})();
