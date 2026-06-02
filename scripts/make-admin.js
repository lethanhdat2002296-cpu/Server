// Promote 1 user thành admin
// Usage: npm run make-admin <username>
require('dotenv').config();
const { pool, query } = require('../lib/db');

(async () => {
  const username = process.argv[2];
  if (!username) {
    console.error('✗ Thiếu username. Cách dùng: npm run make-admin <username>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL chưa set');
    process.exit(1);
  }
  try {
    const r = await query(
      `UPDATE users SET role = 'admin' WHERE username = $1 RETURNING id, username, full_name, role`,
      [username.toLowerCase()]
    );
    if (r.rows.length === 0) {
      console.error(`✗ Không tìm thấy user "${username}"`);
      process.exit(1);
    }
    const u = r.rows[0];
    console.log(`✓ Đã promote user "${u.username}" (${u.full_name}) thành admin`);
    console.log(`  User ID: ${u.id}`);
    console.log(`  Role: ${u.role}`);
    console.log(`\nUser cần ĐĂNG XUẤT và ĐĂNG NHẬP LẠI để JWT có role mới`);
  } catch (err) {
    console.error('✗ Lỗi:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
