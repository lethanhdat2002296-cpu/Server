// Chạy 1 lần để tạo schema trên DB
// Usage: node scripts/init-db.js
require('dotenv').config();
const { ensureSchema, pool } = require('../lib/db');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL chưa được set trong .env');
    process.exit(1);
  }
  console.log('Đang tạo schema...');
  try {
    await ensureSchema();
    console.log('✓ Tạo schema thành công!');
    console.log('  - users');
    console.log('  - check_ins');
    console.log('  - login_attempts');
    console.log('  - reset_codes');
  } catch (err) {
    console.error('✗ Lỗi:', err.message);
    process.exit(1);
  }
  await pool.end();
  process.exit(0);
})();
