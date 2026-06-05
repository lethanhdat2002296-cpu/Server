const express = require('express');
const { query, pool } = require('../lib/db');
const config = require('../config');
const { adminRequired } = require('../middleware/auth');
const { sendPaymentConfirmed, sendPaymentRejected } = require('../utils/email');
const { nowInTimezone, addDays, daysBetween } = require('../utils/time');

const router = express.Router();

// Ghi audit log (best-effort)
async function logAudit(admin, action, target, note) {
  try {
    await query(
      'INSERT INTO audit_log (admin_id, admin_name, action, target, note) VALUES ($1, $2, $3, $4, $5)',
      [admin.id, admin.username || admin.full_name || 'admin', action, target || '', note || '']
    );
  } catch (e) {
    console.error('Lỗi ghi audit_log:', e.message);
  }
}

function validateDateParam(input, fallback) {
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return fallback;
  if (input < '2024-01-01' || input > fallback) return fallback;
  return input;
}

// Đọc dữ liệu lưu trữ cộng dồn (archive). Trả object an toàn kể cả khi rỗng.
// by_phone chuẩn hóa: { phone: { count, last_date, tail_streak } }
async function loadArchive() {
  try {
    const r = await query('SELECT payload FROM archive_data WHERE id = 1');
    const p = (r.rows[0] && r.rows[0].payload) || {};
    const by_phone = {};
    for (const [phone, v] of Object.entries(p.by_phone || {})) {
      if (typeof v === 'number') by_phone[phone] = { count: v, last_date: null, tail_streak: 0 };
      else by_phone[phone] = { count: v.count || 0, last_date: v.last_date || null, tail_streak: v.tail_streak || 0 };
    }
    return {
      total: p.total || 0,
      by_phone,
      by_date: p.by_date || {},     // { 'YYYY-MM-DD': count } - cho biểu đồ
      updated_at: p.updated_at || null,
      cutoff: p.cutoff || null
    };
  } catch (e) {
    return { total: 0, by_phone: {}, by_date: {}, updated_at: null, cutoff: null };
  }
}

// ============================================================
//  THANH TOÁN (admin duyệt)
// ============================================================

// LIST payments: status + search + pagination
router.get('/payments', adminRequired, async (req, res, next) => {
  try {
    const status = req.query.status || 'pending';
    const search = (req.query.search || '').trim().toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

    const conds = [];
    const params = [];
    let i = 1;
    if (status !== 'all') { conds.push(`p.status = $${i++}`); params.push(status); }
    if (search) {
      conds.push(`(LOWER(p.full_name) LIKE $${i} OR LOWER(p.email) LIKE $${i} OR p.phone LIKE $${i})`);
      params.push(`%${search}%`); i++;
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const sql = `
      SELECT p.*, admin.username AS confirmed_by_username
      FROM payments p
      LEFT JOIN users admin ON admin.id = p.confirmed_by
      ${where}
      ORDER BY p.created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `;
    params.push(limit, offset);
    const r = await query(sql, params);

    const totalRes = await query(
      `SELECT COUNT(*)::int AS c FROM payments p ${where}`,
      params.slice(0, params.length - 2)
    );
    const countRes = await query(`SELECT status, COUNT(*)::int AS c FROM payments GROUP BY status`);
    const counts = { pending: 0, confirmed: 0, rejected: 0 };
    for (const row of countRes.rows) counts[row.status] = row.c;

    res.json({ payments: r.rows, counts, total: totalRes.rows[0].c, limit, offset });
  } catch (err) { next(err); }
});

router.post('/payments/:id/confirm', adminRequired, async (req, res, next) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const adminNote = String((req.body && req.body.note) || '').slice(0, 500);

    const r = await query('SELECT * FROM payments WHERE id = $1', [paymentId]);
    const payment = r.rows[0];
    if (!payment) return res.status(404).json({ error: 'Không tìm thấy thanh toán' });
    if (payment.status === 'confirmed') return res.status(400).json({ error: 'Đã xác nhận trước đó' });

    await query(`UPDATE payments SET status='confirmed', confirmed_at=NOW(), confirmed_by=$1, admin_note=$2 WHERE id=$3`,
      [req.user.id, adminNote, paymentId]);

    let emailResult = { ok: false };
    try {
      emailResult = await sendPaymentConfirmed({
        toEmail: payment.email, full_name: payment.full_name, phone: payment.phone,
        payment_id: payment.id, created_at: payment.created_at,
        admin_note: adminNote, detected_banks: payment.detected_banks
      });
    } catch (e) { emailResult = { ok: false, err: e.message }; }

    await query('UPDATE payments SET email_sent=$1, email_error=$2, email_attempts=email_attempts+1 WHERE id=$3',
      [emailResult.ok, emailResult.ok ? null : (emailResult.err || 'Lỗi gửi mail'), paymentId]);
    await logAudit(req.user, 'confirm_payment', `payment#${paymentId}`, adminNote);

    res.json({ ok: true, message: 'Đã xác nhận', payment_id: paymentId,
      email_sent: emailResult.ok, email_dev_mode: emailResult.dev || false,
      email_error: emailResult.ok ? null : (emailResult.err || 'Lỗi gửi mail') });
  } catch (err) { next(err); }
});

router.post('/payments/:id/reject', adminRequired, async (req, res, next) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const adminNote = String((req.body && req.body.note) || '').slice(0, 500);

    const r = await query('SELECT * FROM payments WHERE id = $1', [paymentId]);
    const payment = r.rows[0];
    if (!payment) return res.status(404).json({ error: 'Không tìm thấy thanh toán' });

    await query(`UPDATE payments SET status='rejected', confirmed_at=NOW(), confirmed_by=$1, admin_note=$2 WHERE id=$3`,
      [req.user.id, adminNote, paymentId]);

    let emailResult = { ok: false };
    try {
      emailResult = await sendPaymentRejected({
        toEmail: payment.email, full_name: payment.full_name, phone: payment.phone,
        payment_id: payment.id, created_at: payment.created_at, admin_note: adminNote
      });
    } catch (e) { emailResult = { ok: false, err: e.message }; }

    await query('UPDATE payments SET email_sent=$1, email_error=$2, email_attempts=email_attempts+1 WHERE id=$3',
      [emailResult.ok, emailResult.ok ? null : (emailResult.err || 'Lỗi gửi mail'), paymentId]);
    await logAudit(req.user, 'reject_payment', `payment#${paymentId}`, adminNote);

    res.json({ ok: true, message: 'Đã từ chối', payment_id: paymentId,
      email_sent: emailResult.ok, email_error: emailResult.ok ? null : (emailResult.err || 'Lỗi gửi mail') });
  } catch (err) { next(err); }
});

router.post('/payments/:id/resend-email', adminRequired, async (req, res, next) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const r = await query('SELECT * FROM payments WHERE id = $1', [paymentId]);
    const payment = r.rows[0];
    if (!payment) return res.status(404).json({ error: 'Không tìm thấy thanh toán' });
    if (payment.status === 'pending') return res.status(400).json({ error: 'Chưa xử lý, chưa có email kết quả' });

    let emailResult = { ok: false };
    try {
      if (payment.status === 'confirmed') {
        emailResult = await sendPaymentConfirmed({
          toEmail: payment.email, full_name: payment.full_name, phone: payment.phone,
          payment_id: payment.id, created_at: payment.created_at,
          admin_note: payment.admin_note, detected_banks: payment.detected_banks
        });
      } else {
        emailResult = await sendPaymentRejected({
          toEmail: payment.email, full_name: payment.full_name, phone: payment.phone,
          payment_id: payment.id, created_at: payment.created_at, admin_note: payment.admin_note
        });
      }
    } catch (e) { emailResult = { ok: false, err: e.message }; }

    await query('UPDATE payments SET email_sent=$1, email_error=$2, email_attempts=email_attempts+1 WHERE id=$3',
      [emailResult.ok, emailResult.ok ? null : (emailResult.err || 'Lỗi gửi mail'), paymentId]);
    await logAudit(req.user, 'resend_email', `payment#${paymentId}`, '');

    res.json({ ok: true, email_sent: emailResult.ok, email_error: emailResult.ok ? null : (emailResult.err || 'Lỗi gửi mail') });
  } catch (err) { next(err); }
});

// ============================================================
//  BÁO CÁO (theo members + member_checkins)
// ============================================================

// Tổng quan
router.get('/reports/overview', adminRequired, async (req, res, next) => {
  try {
    const t = nowInTimezone();
    const [membersRes, todayRes, totalRes, payRes] = await Promise.all([
      query('SELECT COUNT(*)::int AS c FROM members'),
      query('SELECT COUNT(*)::int AS c FROM member_checkins WHERE check_date = $1', [t.date]),
      query('SELECT COUNT(*)::int AS c FROM member_checkins'),
      query('SELECT status, COUNT(*)::int AS c FROM payments GROUP BY status')
    ]);
    const payments = { pending: 0, confirmed: 0, rejected: 0 };
    for (const row of payRes.rows) payments[row.status] = row.c;
    const total = membersRes.rows[0].c;
    const checked = todayRes.rows[0].c;
    const archive = await loadArchive();
    res.json({
      date: t.date,
      server_time: `${t.date} ${t.time}`,
      total_members: total,
      checked_in_today: checked,
      not_checked_today: Math.max(0, total - checked),
      // TỔNG = live + lưu trữ (cộng dồn)
      total_checkins_all_time: totalRes.rows[0].c + archive.total,
      total_checkins_live: totalRes.rows[0].c,
      total_checkins_archived: archive.total,
      payments
    });
  } catch (err) { next(err); }
});

// Báo cáo nhanh trong ngày: họ tên / sđt / check-in
router.get('/reports/daily', adminRequired, async (req, res, next) => {
  try {
    const today = nowInTimezone().date;
    const date = validateDateParam(req.query.date, today);
    const [r, archive] = await Promise.all([
      query(`
        SELECT m.full_name, m.phone, m.email, c.check_time
        FROM members m
        LEFT JOIN member_checkins c ON c.member_id = m.id AND c.check_date = $1
        ORDER BY (c.check_time IS NULL), m.full_name
      `, [date]),
      loadArchive()
    ]);
    const rows = r.rows.map(m => ({
      full_name: m.full_name, phone: m.phone, email: m.email,
      checked_in: !!m.check_time,
      check_time: m.check_time ? m.check_time.slice(0, 5) : null
    }));
    const checked = rows.filter(x => x.checked_in).length;
    // Ngày này đã bị dọn vào lưu trữ → chi tiết từng người không còn (chỉ còn tổng)
    const archived_date = !!(archive.cutoff && date < archive.cutoff);
    res.json({
      date, total: rows.length, checked, not_checked: rows.length - checked, rows,
      archived_date,
      archived_total: archived_date ? (archive.by_date[date] || 0) : null
    });
  } catch (err) { next(err); }
});

// Helper: tính số liệu per-member (streak nối archive + tổng đã + tổng chưa)
// Dùng chung cho /reports/detailed, /reports/leaderboard, /members/:id/detail
async function computeMemberStats(date) {
  const t = nowInTimezone();
  const windowEnded = t.hour >= config.CHECKIN_END_HOUR; // qua 6h sáng = hôm nay đã đóng
  const [r, archive] = await Promise.all([
    query(`
      SELECT m.id, m.full_name, m.phone, m.email, m.created_at,
             COALESCE(ARRAY_AGG(c.check_date ORDER BY c.check_date DESC)
                      FILTER (WHERE c.check_date IS NOT NULL), '{}'::text[]) AS dates
      FROM members m
      LEFT JOIN member_checkins c ON c.member_id = m.id
      GROUP BY m.id
      ORDER BY m.full_name
    `),
    loadArchive()
  ]);

  return r.rows.map(m => {
    const dates = m.dates || [];
    const set = new Set(dates);
    const checkedToday = set.has(date);

    // Dữ liệu đã lưu trữ của người này (theo SĐT): { count, last_date, tail_streak }
    const arch = (m.phone && archive.by_phone[m.phone]) || { count: 0, last_date: null, tail_streak: 0 };

    // isChecked: 1 ngày đã điểm danh nếu có trong live HOẶC nằm trong "đuôi liên tiếp" đã lưu trữ
    // → streak nối liền xuyên qua mốc backup. Đuôi archive = [last_date - (tail_streak-1) .. last_date]
    const archTailStart = arch.last_date ? addDays(arch.last_date, -(arch.tail_streak - 1)) : null;
    const isChecked = (d) => set.has(d) || (arch.last_date && archTailStart && d <= arch.last_date && d >= archTailStart);

    let cursor;
    if (isChecked(date)) cursor = date;
    else if (!windowEnded) cursor = addDays(date, -1);
    else cursor = null;
    let streak = 0;
    while (cursor && isChecked(cursor)) { streak++; cursor = addDays(cursor, -1); }

    const totalChecked = dates.length + (arch.count || 0);

    const created = m.created_at ? m.created_at.toISOString().slice(0, 10) : date;
    const firstDay = created > date ? date : created;
    const lastEnded = windowEnded ? t.date : addDays(t.date, -1);
    let totalMissed = 0;
    if (firstDay <= lastEnded) {
      const eligible = daysBetween(firstDay, lastEnded);
      totalMissed = Math.max(0, eligible - totalChecked);
    }

    return {
      id: m.id, full_name: m.full_name, phone: m.phone, email: m.email,
      checked_today: checkedToday, streak,
      total_checked: totalChecked, total_missed: totalMissed
    };
  });
}

// Báo cáo chi tiết: streak / tổng đã / tổng chưa
router.get('/reports/detailed', adminRequired, async (req, res, next) => {
  try {
    const t = nowInTimezone();
    const date = validateDateParam(req.query.date, t.date);
    const rows = await computeMemberStats(date);
    const checked = rows.filter(x => x.checked_today).length;
    res.json({ date, total: rows.length, checked, not_checked: rows.length - checked, rows });
  } catch (err) { next(err); }
});

// Bảng xếp hạng: top streak + top tổng ngày dậy (cộng dồn archive)
router.get('/reports/leaderboard', adminRequired, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const stats = await computeMemberStats(nowInTimezone().date);
    const by_streak = [...stats].sort((a, b) => b.streak - a.streak || b.total_checked - a.total_checked).slice(0, limit);
    const by_total = [...stats].sort((a, b) => b.total_checked - a.total_checked || b.streak - a.streak).slice(0, limit);
    res.json({ by_streak, by_total });
  } catch (err) { next(err); }
});

// Chi tiết 1 thành viên: thông tin + ngày điểm danh gần đây + thanh toán + số liệu
router.get('/members/:id/detail', adminRequired, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: 'Không tìm thấy thành viên' });
    const t = nowInTimezone();
    const [memberRes, datesRes, paysRes, archive, stats] = await Promise.all([
      query('SELECT id, full_name, phone, email, address, created_at FROM members WHERE id = $1', [id]),
      query('SELECT check_date, check_time FROM member_checkins WHERE member_id = $1 ORDER BY check_date DESC LIMIT 60', [id]),
      query('SELECT id, status, detected_banks, admin_note, created_at, confirmed_at FROM payments WHERE member_id = $1 ORDER BY created_at DESC LIMIT 30', [id]),
      loadArchive(),
      computeMemberStats(nowInTimezone().date)
    ]);
    const member = memberRes.rows[0];
    if (!member) return res.status(404).json({ error: 'Không tìm thấy thành viên' });
    const stat = stats.find(s => s.id === id) || { streak: 0, total_checked: 0, total_missed: 0 };
    const arch = (member.phone && archive.by_phone[member.phone]) || { count: 0 };
    res.json({
      member,
      recent_dates: datesRes.rows,           // ngày điểm danh live gần đây (60)
      archived_count: arch.count || 0,        // số đã lưu trữ (không còn chi tiết ngày)
      payments: paysRes.rows,
      streak: stat.streak,
      total_checked: stat.total_checked,
      total_missed: stat.total_missed
    });
  } catch (err) { next(err); }
});

// Báo cáo theo khoảng (tuần/tháng) + dữ liệu biểu đồ
router.get('/reports/range', adminRequired, async (req, res, next) => {
  try {
    const today = nowInTimezone().date;
    let from = validateDateParam(req.query.from, today);
    let to = validateDateParam(req.query.to, today);
    if (from > to) { const tmp = from; from = to; to = tmp; }
    if (daysBetween(from, to) > 92) from = addDays(to, -91);

    const [dailyRes, perMemberRes, totalRes, archive] = await Promise.all([
      query(`SELECT check_date, COUNT(*)::int AS c FROM member_checkins
             WHERE check_date BETWEEN $1 AND $2 GROUP BY check_date ORDER BY check_date`, [from, to]),
      query(`SELECT m.full_name, m.phone, m.email, COUNT(c.id)::int AS checked_days
             FROM members m
             LEFT JOIN member_checkins c ON c.member_id = m.id AND c.check_date BETWEEN $1 AND $2
             GROUP BY m.id ORDER BY checked_days DESC, m.full_name`, [from, to]),
      query('SELECT COUNT(*)::int AS c FROM members'),
      loadArchive()
    ]);

    const countMap = {};
    for (const row of dailyRes.rows) countMap[row.check_date] = row.c;
    const totalDays = daysBetween(from, to);
    const daily = [];
    let cursor = from;
    for (let d = 0; d < totalDays; d++) {
      // Cộng dồn số liệu đã lưu trữ vào biểu đồ theo ngày
      const archived = archive.by_date[cursor] || 0;
      daily.push({ date: cursor, count: (countMap[cursor] || 0) + archived });
      cursor = addDays(cursor, 1);
    }

    res.json({
      from, to, total_days: totalDays,
      total_members: totalRes.rows[0].c,
      total_checkins: daily.reduce((s, d) => s + d.count, 0),
      daily, per_member: perMemberRes.rows
    });
  } catch (err) { next(err); }
});

// ============================================================
//  AUDIT LOG
// ============================================================
router.get('/audit-log', adminRequired, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
    const r = await query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1', [limit]);
    res.json({ logs: r.rows });
  } catch (err) { next(err); }
});

// ============================================================
//  SAO LƯU & LƯU TRỮ (archive overlay)
// ============================================================

// Tải toàn bộ dữ liệu ra JSON (bản sao lưu đầy đủ để giữ ngoài)
router.get('/backup', adminRequired, async (req, res, next) => {
  try {
    const [members, checkins, payments, audit, archive] = await Promise.all([
      query('SELECT * FROM members ORDER BY id'),
      query('SELECT mc.*, m.phone AS member_phone FROM member_checkins mc JOIN members m ON m.id = mc.member_id ORDER BY mc.check_date'),
      query('SELECT * FROM payments ORDER BY id'),
      query('SELECT * FROM audit_log ORDER BY id'),
      query('SELECT payload FROM archive_data WHERE id = 1')
    ]);
    res.json({
      version: 1,
      exported_at: new Date().toISOString(),
      counts: {
        members: members.rows.length,
        member_checkins: checkins.rows.length,
        payments: payments.rows.length
      },
      members: members.rows,
      member_checkins: checkins.rows,
      payments: payments.rows,
      audit_log: audit.rows,
      archive: (archive.rows[0] && archive.rows[0].payload) || {}
    });
  } catch (err) { next(err); }
});

// Trạng thái lưu trữ hiện tại
router.get('/archive', adminRequired, async (req, res, next) => {
  try {
    const archive = await loadArchive();
    const liveRes = await query('SELECT COUNT(*)::int AS c FROM member_checkins');
    res.json({
      archived_total: archive.total,
      archived_members: Object.keys(archive.by_phone).length,
      archived_dates: Object.keys(archive.by_date).length,
      updated_at: archive.updated_at,
      cutoff: archive.cutoff,
      live_checkins: liveRes.rows[0].c
    });
  } catch (err) { next(err); }
});

// LƯU TRỮ & DỌN: gộp điểm danh CŨ (trước hôm nay) vào archive, xóa khỏi DB
// Giữ lại điểm danh hôm nay (live). Cộng dồn vào payload cũ.
router.post('/archive', adminRequired, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const t = nowInTimezone();
    const cutoff = t.date; // archive tất cả check_date < hôm nay

    // TRANSACTION: đọc-gộp-ghi-xóa nguyên tử (chống bấm 2 lần cộng dồn trùng)
    await client.query('BEGIN');

    const [rowsRes, byDateRes, totalRes, oldRes] = await Promise.all([
      client.query(`SELECT m.phone, mc.check_date
             FROM member_checkins mc JOIN members m ON m.id = mc.member_id
             WHERE mc.check_date < $1 AND m.phone <> ''
             ORDER BY m.phone, mc.check_date`, [cutoff]),
      client.query(`SELECT check_date, COUNT(*)::int AS c FROM member_checkins
             WHERE check_date < $1 GROUP BY check_date`, [cutoff]),
      client.query('SELECT COUNT(*)::int AS c FROM member_checkins WHERE check_date < $1', [cutoff]),
      client.query('SELECT payload FROM archive_data WHERE id = 1')
    ]);
    const toArchive = totalRes.rows[0].c;
    if (toArchive === 0) {
      await client.query('ROLLBACK');
      return res.json({ ok: true, archived_now: 0, message: 'Không có dữ liệu cũ để lưu trữ (chỉ có dữ liệu hôm nay).' });
    }

    // Chuẩn hóa archive cũ (trong transaction)
    const pOld = (oldRes.rows[0] && oldRes.rows[0].payload) || {};
    const old = { total: pOld.total || 0, by_phone: {}, by_date: pOld.by_date || {} };
    for (const [ph, v] of Object.entries(pOld.by_phone || {})) {
      old.by_phone[ph] = typeof v === 'number' ? { count: v, last_date: null, tail_streak: 0 }
        : { count: v.count || 0, last_date: v.last_date || null, tail_streak: v.tail_streak || 0 };
    }

    // Gom ngày theo SĐT
    const newByPhone = {};
    for (const row of rowsRes.rows) {
      (newByPhone[row.phone] = newByPhone[row.phone] || []).push(row.check_date);
    }

    const by_phone = { ...old.by_phone };
    for (const [phone, rawDates] of Object.entries(newByPhone)) {
      const dates = [...new Set(rawDates)].sort();
      const newCount = dates.length;
      const newMax = dates[dates.length - 1];
      let run = 1, i = dates.length - 1;
      while (i > 0 && dates[i - 1] === addDays(dates[i], -1)) { run++; i--; }
      const newTailStart = dates[i];
      const oldE = by_phone[phone] || { count: 0, last_date: null, tail_streak: 0 };
      let tail = run;
      if (oldE.last_date && newTailStart === addDays(oldE.last_date, 1)) tail = run + oldE.tail_streak;
      by_phone[phone] = { count: oldE.count + newCount, last_date: newMax, tail_streak: tail };
    }

    const by_date = { ...old.by_date };
    for (const row of byDateRes.rows) by_date[row.check_date] = (by_date[row.check_date] || 0) + row.c;

    const payload = {
      total: old.total + toArchive,
      by_phone, by_date,
      cutoff,
      updated_at: new Date().toISOString()
    };

    await client.query(`
      INSERT INTO archive_data (id, payload, updated_at) VALUES (1, $1::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE SET payload = $1::jsonb, updated_at = NOW()
    `, [JSON.stringify(payload)]);
    await client.query('DELETE FROM member_checkins WHERE check_date < $1', [cutoff]);
    await client.query('COMMIT');

    await logAudit(req.user, 'archive', `${toArchive} điểm danh`, `cutoff ${cutoff}`);
    res.json({
      ok: true,
      archived_now: toArchive,
      archived_total: payload.total,
      message: `Đã lưu trữ & dọn ${toArchive} lượt điểm danh cũ. Tổng số liệu vẫn hiển thị đầy đủ.`
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    next(err);
  } finally {
    client.release();
  }
});

// KHÔI PHỤC từ file backup JSON (cho kịch bản DB đầy → DB mới trống)
// body = nội dung file backup (định dạng /backup). Mặc định GHI ĐÈ toàn bộ.
router.post('/restore', adminRequired, async (req, res, next) => {
  const data = req.body || {};
  if (data.version !== 1 || !Array.isArray(data.members)) {
    return res.status(400).json({ error: 'File backup không hợp lệ (thiếu version/members).' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Ghi đè: xóa sạch trước khi nạp
    await client.query('DELETE FROM member_checkins');
    await client.query('DELETE FROM payments');
    await client.query('DELETE FROM members');
    await client.query('DELETE FROM archive_data');

    // Nạp members → map phone → id mới
    const phoneToId = {};
    let memberCount = 0;
    for (const m of data.members) {
      if (!m || !m.full_name) continue;
      const r = await client.query(
        'INSERT INTO members (full_name, phone, email, address, created_at) VALUES ($1,$2,$3,$4,COALESCE($5::timestamptz, NOW())) RETURNING id',
        [m.full_name, m.phone || '', m.email || '', m.address || '', m.created_at || null]
      );
      if (m.phone) phoneToId[m.phone] = r.rows[0].id;
      memberCount++;
    }

    // Nạp điểm danh (map theo member_phone)
    let checkinCount = 0;
    for (const c of (data.member_checkins || [])) {
      const mid = phoneToId[c.member_phone];
      if (!mid || !c.check_date) continue;
      await client.query(
        'INSERT INTO member_checkins (member_id, check_date, check_time, created_at) VALUES ($1,$2,$3,COALESCE($4::timestamptz, NOW())) ON CONFLICT (member_id, check_date) DO NOTHING',
        [mid, c.check_date, c.check_time || '05:00:00', c.created_at || null]
      );
      checkinCount++;
    }

    // Nạp thanh toán (re-link member_id theo phone, giữ snapshot)
    let payCount = 0;
    for (const p of (data.payments || [])) {
      if (!p) continue;
      await client.query(
        `INSERT INTO payments (member_id, full_name, phone, email, ocr_text, is_receipt, detected_banks, status, admin_note, email_sent, created_at, confirmed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz, NOW()),$12::timestamptz)`,
        [phoneToId[p.phone] || null, p.full_name || '', p.phone || '', p.email || '', p.ocr_text || '',
         !!p.is_receipt, p.detected_banks || '', p.status || 'pending', p.admin_note || null,
         !!p.email_sent, p.created_at || null, p.confirmed_at || null]
      );
      payCount++;
    }

    // Nạp lại kho lưu trữ (archive_data) - giữ nguyên (keyed theo phone)
    if (data.archive && Object.keys(data.archive).length) {
      await client.query(
        `INSERT INTO archive_data (id, payload, updated_at) VALUES (1, $1::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET payload = $1::jsonb, updated_at = NOW()`,
        [JSON.stringify(data.archive)]
      );
    }

    await client.query('COMMIT');
    await logAudit(req.user, 'restore', `${memberCount} thành viên`, `${checkinCount} điểm danh, ${payCount} thanh toán`);
    res.json({
      ok: true, members: memberCount, checkins: checkinCount, payments: payCount,
      message: `Khôi phục thành công: ${memberCount} thành viên, ${checkinCount} điểm danh, ${payCount} thanh toán.`
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
