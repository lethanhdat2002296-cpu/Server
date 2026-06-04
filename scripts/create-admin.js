// Tạo tài khoản admin mới (vì không còn đăng ký công khai)
// Usage: node scripts/create-admin.js <username> <password> [full_name] [email] [phone]
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool, query } = require('../lib/db');

(async () => {
  const [, , username, password, fullName, email, phone] = process.argv;
  if (!username || !password) {
    console.error('Cách dùng: node scripts/create-admin.js <username> <password> [full_name] [email] [phone]');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) { console.error('✗ DATABASE_URL chưa set'); process.exit(1); }

  try {
    const uname = username.toLowerCase();
    const hash = await bcrypt.hash(password, 10);
    const fn = fullName || 'Quản Trị Viên';
    const em = (email || `${uname}@admin.local`).toLowerCase();
    const ph = phone || '0000000000';

    const existing = await query('SELECT id FROM users WHERE username = $1', [uname]);
    if (existing.rows.length) {
      await query("UPDATE users SET password_hash = $1, role = 'admin', full_name = $2 WHERE username = $3",
        [hash, fn, uname]);
      console.log(`✓ Đã cập nhật admin "${uname}" (reset mật khẩu + role=admin)`);
    } else {
      await query(`INSERT INTO users (full_name, phone, email, username, password_hash, role)
                   VALUES ($1, $2, $3, $4, $5, 'admin')`, [fn, ph, em, uname, hash]);
      console.log(`✓ Đã tạo admin mới "${uname}"`);
    }
    console.log(`  Username: ${uname}`);
    console.log(`  Password: ${password}`);
  } catch (err) {
    console.error('✗ Lỗi:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
