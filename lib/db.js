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

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Schema được tạo lazy 1 lần khi request đầu tiên đến (cold start)
let schemaPromise = null;
function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        full_name     TEXT NOT NULL,
        phone         TEXT NOT NULL UNIQUE,
        email         TEXT NOT NULL UNIQUE,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS check_ins (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        check_date  TEXT NOT NULL,
        check_time  TEXT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, check_date)
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        username      TEXT PRIMARY KEY,
        failed_count  INTEGER DEFAULT 0,
        locked_until  BIGINT DEFAULT 0
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reset_codes (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code        TEXT NOT NULL,
        expires_at  BIGINT NOT NULL,
        used        INTEGER DEFAULT 0
      );
    `);
  })().catch(err => {
    schemaPromise = null; // cho phép thử lại lần sau
    throw err;
  });
  return schemaPromise;
}

// Helper: chạy query, đảm bảo schema đã tạo
async function query(sql, params = []) {
  await ensureSchema();
  return pool.query(sql, params);
}

module.exports = { pool, query, ensureSchema };
