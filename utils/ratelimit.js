// Rate limit theo key, lưu DB (dùng cho serverless - không có bộ nhớ chung)
const { query } = require('../lib/db');

// Lấy IP client (Vercel đặt qua x-forwarded-for)
function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Trả { allowed, retryAfterSec }. Cửa sổ trượt đơn giản theo window_start.
async function checkRateLimit(key, max, windowMs) {
  const now = Date.now();
  try {
    const r = await query('SELECT count, window_start FROM rate_limits WHERE key = $1', [key]);
    const row = r.rows[0];
    if (!row || now - Number(row.window_start) > windowMs) {
      await query(`
        INSERT INTO rate_limits (key, count, window_start) VALUES ($1, 1, $2)
        ON CONFLICT (key) DO UPDATE SET count = 1, window_start = $2
      `, [key, now]);
      return { allowed: true };
    }
    if (row.count >= max) {
      const retryAfterSec = Math.ceil((windowMs - (now - Number(row.window_start))) / 1000);
      return { allowed: false, retryAfterSec };
    }
    await query('UPDATE rate_limits SET count = count + 1 WHERE key = $1', [key]);
    return { allowed: true };
  } catch (e) {
    // Nếu lỗi rate-limit DB thì cho qua (không chặn dịch vụ)
    console.error('Lỗi rate limit:', e.message);
    return { allowed: true };
  }
}

// Chỉ ĐỌC (không tăng): kiểm tra key đã bị khóa chưa (count >= max trong cửa sổ).
async function peekRateLimit(key, max, windowMs) {
  const now = Date.now();
  try {
    const r = await query('SELECT count, window_start FROM rate_limits WHERE key = $1', [key]);
    const row = r.rows[0];
    if (!row || now - Number(row.window_start) > windowMs) return { locked: false };
    if (row.count >= max) {
      return { locked: true, retryAfterSec: Math.ceil((windowMs - (now - Number(row.window_start))) / 1000) };
    }
    return { locked: false };
  } catch (e) { return { locked: false }; }
}

// Chỉ TĂNG đếm (ghi nhận 1 lần thất bại). Mở cửa sổ mới nếu hết hạn.
async function incrementKey(key, windowMs) {
  const now = Date.now();
  try {
    const r = await query('SELECT window_start FROM rate_limits WHERE key = $1', [key]);
    const row = r.rows[0];
    if (!row || now - Number(row.window_start) > windowMs) {
      await query(`INSERT INTO rate_limits (key, count, window_start) VALUES ($1, 1, $2)
                   ON CONFLICT (key) DO UPDATE SET count = 1, window_start = $2`, [key, now]);
    } else {
      await query('UPDATE rate_limits SET count = count + 1 WHERE key = $1', [key]);
    }
  } catch (e) { console.error('Lỗi increment rate limit:', e.message); }
}

// Xóa key (vd reset bộ đếm sai khi xác minh thành công).
async function clearKey(key) {
  try { await query('DELETE FROM rate_limits WHERE key = $1', [key]); } catch (e) {}
}

module.exports = { getClientIp, checkRateLimit, peekRateLimit, incrementKey, clearKey };
