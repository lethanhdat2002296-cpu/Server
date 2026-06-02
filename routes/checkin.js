const express = require('express');
const { query } = require('../lib/db');
const config = require('../config');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// ============ TIMEZONE HELPER ============
// Vercel chạy UTC mặc định, cần lấy giờ theo TIMEZONE config
function nowInTimezone() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const obj = {};
  for (const p of parts) obj[p.type] = p.value;
  // obj.hour có thể là '24' lúc nửa đêm trong vài locale - chuẩn hoá về '00'
  const hour = obj.hour === '24' ? '00' : obj.hour;
  return {
    date: `${obj.year}-${obj.month}-${obj.day}`,
    time: `${hour}:${obj.minute}:${obj.second}`,
    hour: parseInt(hour, 10),
    minute: parseInt(obj.minute, 10)
  };
}

// Cộng/trừ ngày dạng YYYY-MM-DD (dùng UTC noon để tránh DST shift)
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Đếm số ngày giữa 2 ngày (inclusive)
function daysBetween(startDate, endDate) {
  const s = new Date(`${startDate}T12:00:00Z`);
  const e = new Date(`${endDate}T12:00:00Z`);
  return Math.round((e - s) / 86400000) + 1;
}

// Đổi 1 timestamp về ngày + giờ trong timezone
function toLocalDateHour(timestamp) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false
  }).formatToParts(new Date(timestamp));
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  const hour = o.hour === '24' ? '00' : o.hour;
  return {
    date: `${o.year}-${o.month}-${o.day}`,
    hour: parseInt(hour, 10)
  };
}

function getCheckinStatusFromTime(t, hasCheckedIn, checkTime) {
  const inWindow = t.hour === config.CHECKIN_START_HOUR;   // 5:00 - 5:59
  const afterWindow = t.hour >= config.CHECKIN_END_HOUR;   // >= 6:00

  if (hasCheckedIn) return { status: 'done', check_time: checkTime, server_time: `${t.date} ${t.time}` };
  if (inWindow) return { status: 'active', server_time: `${t.date} ${t.time}` };
  if (afterWindow) return { status: 'missed', server_time: `${t.date} ${t.time}` };
  return { status: 'disabled', server_time: `${t.date} ${t.time}` };
}

// ============== GET STATUS ==============
router.get('/status', authRequired, async (req, res, next) => {
  try {
    const t = nowInTimezone();
    const r = await query(
      'SELECT check_time FROM check_ins WHERE user_id = $1 AND check_date = $2',
      [req.user.id, t.date]
    );
    const row = r.rows[0];
    res.json(getCheckinStatusFromTime(t, !!row, row?.check_time));
  } catch (err) { next(err); }
});

// ============== POST CHECK-IN ==============
router.post('/check-in', authRequired, async (req, res, next) => {
  try {
    const t = nowInTimezone();
    if (t.hour !== config.CHECKIN_START_HOUR) {
      return res.status(400).json({
        error: `Chỉ có thể check-in từ ${config.CHECKIN_START_HOUR}:00 đến ${config.CHECKIN_END_HOUR}:00 sáng`
      });
    }
    // Đã check chưa
    const exist = await query(
      'SELECT id FROM check_ins WHERE user_id = $1 AND check_date = $2',
      [req.user.id, t.date]
    );
    if (exist.rows.length) {
      return res.status(409).json({ error: 'Bạn đã check-in hôm nay' });
    }
    await query(
      'INSERT INTO check_ins (user_id, check_date, check_time) VALUES ($1, $2, $3)',
      [req.user.id, t.date, t.time]
    );
    res.json({
      ok: true,
      message: 'Check-in thành công!',
      check_date: t.date,
      check_time: t.time
    });
  } catch (err) { next(err); }
});

// ============== LỊCH SỬ ==============
router.get('/history', authRequired, async (req, res, next) => {
  try {
    const r = await query(`
      SELECT check_date, check_time
      FROM check_ins
      WHERE user_id = $1
      ORDER BY check_date DESC, check_time DESC
    `, [req.user.id]);
    res.json({ history: r.rows });
  } catch (err) { next(err); }
});

// ============== THỐNG KÊ ==============
router.get('/stats', authRequired, async (req, res, next) => {
  try {
    const t = nowInTimezone();
    const monthStr = t.date.slice(0, 7); // YYYY-MM
    const monthStart = `${monthStr}-01`;

    // Lấy thông tin user kèm ngày đăng ký
    const userRes = await query(
      'SELECT full_name, email, phone, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userRes.rows[0];

    // === Tính khoảng ngày có thể bị "quên check-in" ===
    // Quy tắc: 1 ngày D chỉ bị tính "quên" nếu user đã tồn tại TRƯỚC khung check-in của ngày đó (trước 5:00 ngày D)
    // - Nếu user đăng ký TRƯỚC 5:00 ngày X → ngày X bắt đầu tính
    // - Nếu user đăng ký TỪ 5:00 trở đi ngày X → bỏ qua ngày X, tính từ ngày X+1
    const createdLocal = toLocalDateHour(user.created_at);
    const firstMissable = createdLocal.hour < config.CHECKIN_START_HOUR
      ? createdLocal.date
      : addDays(createdLocal.date, 1);

    // Ngày cuối cùng mà khung check-in đã kết thúc
    // - Nếu giờ hiện tại >= 6:00 → hôm nay đã kết thúc
    // - Ngược lại → chỉ tính đến hôm qua
    const lastEnded = t.hour >= config.CHECKIN_END_HOUR ? t.date : addDays(t.date, -1);

    // Giao với tháng hiện tại
    const startDate = firstMissable > monthStart ? firstMissable : monthStart;
    const endDate = lastEnded;

    // Đã check-in trong tháng (tính tất cả, kể cả những ngày user chưa eligible — vì check-in thật vẫn tính công)
    const checkedRes = await query(`
      SELECT COUNT(*)::int AS c FROM check_ins
      WHERE user_id = $1 AND check_date LIKE $2
    `, [req.user.id, `${monthStr}-%`]);
    const checkedThisMonth = checkedRes.rows[0].c;

    // Quên check-in trong tháng = số ngày eligible - số ngày đã check trong khoảng eligible
    let missedThisMonth = 0;
    if (startDate <= endDate) {
      const daysEligible = daysBetween(startDate, endDate);
      const r = await query(`
        SELECT COUNT(*)::int AS c FROM check_ins
        WHERE user_id = $1 AND check_date BETWEEN $2 AND $3
      `, [req.user.id, startDate, endDate]);
      const checkedInRange = r.rows[0].c;
      missedThisMonth = Math.max(0, daysEligible - checkedInRange);
    }

    // Tổng từ trước đến nay
    const totalRes = await query(
      'SELECT COUNT(*)::int AS c FROM check_ins WHERE user_id = $1',
      [req.user.id]
    );

    res.json({
      user: { full_name: user.full_name, email: user.email, phone: user.phone },
      month: monthStr,
      checked_this_month: checkedThisMonth,
      missed_this_month: missedThisMonth,
      total_all_time: totalRes.rows[0].c
    });
  } catch (err) { next(err); }
});

module.exports = router;
