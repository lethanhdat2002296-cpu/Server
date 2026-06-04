// Postgres connection - Neon serverless driver
// Hoạt động cả local Node.js và Vercel serverless functions
const { Pool, neonConfig } = require('@neondatabase/serverless');

// Node 22+ có native WebSocket, các version cũ cần fallback
if (typeof globalThis.WebSocket === 'undefined') {
  try {
    neonConfig.webSocketConstructor = require('ws');
  } catch (e) {
    console.warn('Node version < 22 và chưa cài ws. Cài thêm: npm i ws');
  }
}

if (!process.env.DATABASE_URL) {
  console.error('⚠ DATABASE_URL chưa được set trong env. App sẽ không kết nối được DB.');
}

// Pool: tái sử dụng connection trong cùng instance Vercel (warm)
// Mỗi cold start tạo pool mới, mỗi request lấy 1 connection từ pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Vercel function thường ngắn (~vài giây), pool nhỏ là đủ
  // Pooler endpoint của Neon đã handle multiplexing rồi
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

// ============ QUERY HELPER ============
// Không await schema check ở đây - schema phải được tạo trước bằng `npm run init-db`
// Tránh lock contention khi 100 cold start cùng chạy CREATE TABLE IF NOT EXISTS
async function query(sql, params = []) {
  return pool.query(sql, params);
}

// ============ SCHEMA INIT - chỉ chạy từ scripts/init-db.js ============
// Bao gồm cả index để tối ưu query khi tải cao
async function initSchema() {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      full_name     TEXT NOT NULL,
      phone         TEXT NOT NULL UNIQUE,
      email         TEXT NOT NULL UNIQUE,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS check_ins (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      check_date  TEXT NOT NULL,
      check_time  TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, check_date)
    )`,
    `CREATE TABLE IF NOT EXISTS login_attempts (
      username      TEXT PRIMARY KEY,
      failed_count  INTEGER DEFAULT 0,
      locked_until  BIGINT DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS reset_codes (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code        TEXT NOT NULL,
      expires_at  BIGINT NOT NULL,
      used        INTEGER DEFAULT 0
    )`,
    // payments: KHÔNG lưu ảnh (image_data) để tiết kiệm DB space
    // Ảnh được gửi qua email rồi GC ngay, không persist
    `CREATE TABLE IF NOT EXISTS payments (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      full_name     TEXT NOT NULL,
      phone         TEXT NOT NULL,
      email         TEXT NOT NULL,
      ocr_text      TEXT,
      is_receipt    BOOLEAN DEFAULT FALSE,
      detected_banks TEXT,
      email_sent    BOOLEAN DEFAULT FALSE,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )`,
    // Migrate DB cũ (nếu có): drop image columns
    `ALTER TABLE payments DROP COLUMN IF EXISTS image_data`,
    `ALTER TABLE payments DROP COLUMN IF EXISTS image_mime`,
    // Workflow trạng thái payment + admin xác nhận
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS confirmed_by INTEGER REFERENCES users(id)`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS admin_note TEXT`,
    `UPDATE payments SET status = 'pending' WHERE status IS NULL`,
    // Phân quyền: role user/admin
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'`,
    `UPDATE users SET role = 'user' WHERE role IS NULL`,
    // Soft delete user (giữ audit trail, query active luôn filter deleted_at IS NULL)
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
    // Email retry tracking cho payment
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS email_error TEXT`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS email_attempts INTEGER DEFAULT 0`,
    // Rate limit đăng ký theo IP
    `CREATE TABLE IF NOT EXISTS register_attempts (
      ip            TEXT PRIMARY KEY,
      count         INTEGER DEFAULT 0,
      window_start  BIGINT DEFAULT 0
    )`,
    // Audit log: track hành động admin
    `CREATE TABLE IF NOT EXISTS audit_log (
      id          SERIAL PRIMARY KEY,
      admin_id    INTEGER,
      admin_name  TEXT,
      action      TEXT NOT NULL,
      target      TEXT,
      note        TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )`,
    // ============ HỆ THỐNG MỚI: MEMBERS (danh sách admin import) ============
    // Thành viên KHÔNG có tài khoản đăng nhập - admin import từ Excel
    `CREATE TABLE IF NOT EXISTS members (
      id          SERIAL PRIMARY KEY,
      full_name   TEXT NOT NULL,
      phone       TEXT,
      email       TEXT,
      address     TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )`,
    // Điểm danh: admin tích từng thành viên (giữ rule 5:00-5:59)
    `CREATE TABLE IF NOT EXISTS member_checkins (
      id          SERIAL PRIMARY KEY,
      member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      check_date  TEXT NOT NULL,
      check_time  TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (member_id, check_date)
    )`,
    // payments: chuyển sang tham chiếu member (user_id không còn bắt buộc)
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS member_id INTEGER`,
    `ALTER TABLE payments ALTER COLUMN user_id DROP NOT NULL`,
    // ============ INDEXES tối ưu khi tải cao ============
    // check_ins: query theo user_id (COUNT, history, stats)
    `CREATE INDEX IF NOT EXISTS idx_checkins_user_id ON check_ins(user_id)`,
    // check_ins: query history theo user_id + thứ tự ngày DESC
    `CREATE INDEX IF NOT EXISTS idx_checkins_user_date_desc ON check_ins(user_id, check_date DESC)`,
    // reset_codes: tìm mã hợp lệ theo user_id và used flag
    `CREATE INDEX IF NOT EXISTS idx_resetcodes_user_used ON reset_codes(user_id, used)`,
    // payments: query lịch sử theo user
    `CREATE INDEX IF NOT EXISTS idx_payments_user_created ON payments(user_id, created_at DESC)`,
    // payments: admin filter theo status
    `CREATE INDEX IF NOT EXISTS idx_payments_status_created ON payments(status, created_at DESC)`,
    // audit_log: xem theo thời gian
    `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC)`,
    // members: autocomplete theo tên + dedupe theo phone
    `CREATE INDEX IF NOT EXISTS idx_members_name ON members(LOWER(full_name))`,
    `CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone)`,
    // member_checkins: query theo ngày + theo member
    `CREATE INDEX IF NOT EXISTS idx_mcheckins_date ON member_checkins(check_date)`,
    `CREATE INDEX IF NOT EXISTS idx_mcheckins_member ON member_checkins(member_id, check_date DESC)`
  ];
  for (const stmt of ddl) {
    await pool.query(stmt);
  }
}

module.exports = { pool, query, initSchema, ensureSchema: initSchema };
