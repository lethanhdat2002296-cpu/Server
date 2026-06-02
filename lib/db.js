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
    // ============ INDEXES tối ưu khi tải cao ============
    // check_ins: query theo user_id (COUNT, history, stats)
    `CREATE INDEX IF NOT EXISTS idx_checkins_user_id ON check_ins(user_id)`,
    // check_ins: query history theo user_id + thứ tự ngày DESC
    `CREATE INDEX IF NOT EXISTS idx_checkins_user_date_desc ON check_ins(user_id, check_date DESC)`,
    // reset_codes: tìm mã hợp lệ theo user_id và used flag
    `CREATE INDEX IF NOT EXISTS idx_resetcodes_user_used ON reset_codes(user_id, used)`
  ];
  for (const stmt of ddl) {
    await pool.query(stmt);
  }
}

module.exports = { pool, query, initSchema, ensureSchema: initSchema };
