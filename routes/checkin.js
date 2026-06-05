// Điểm danh do ADMIN thực hiện (tích từng thành viên)
// Giữ rule: chỉ điểm danh được từ 5:00 đến 5:59 sáng
const express = require('express');
const { query } = require('../lib/db');
const config = require('../config');
const { adminRequired } = require('../middleware/auth');
const { nowInTimezone } = require('../utils/time');

const router = express.Router();

// Cửa sổ điểm danh có đang mở không (hour === CHECKIN_START_HOUR, vd 5h)
function isWindowOpen(t) {
  return t.hour === config.CHECKIN_START_HOUR;
}

// ============== DANH SÁCH ĐIỂM DANH HÔM NAY ==============
// Trả members + trạng thái đã điểm danh, + cửa sổ đang mở hay đóng
router.get('/today', adminRequired, async (req, res, next) => {
  try {
    const t = nowInTimezone();
    const search = (req.query.search || '').trim().toLowerCase();

    const conds = [];
    const params = [t.date];
    let i = 2;
    if (search) {
      conds.push(`LOWER(m.full_name) LIKE $${i++}`);
      params.push(`%${search}%`);
    }
    const whereClause = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const r = await query(`
      SELECT m.id, m.full_name,
             c.check_time
      FROM members m
      LEFT JOIN member_checkins c ON c.member_id = m.id AND c.check_date = $1
      ${whereClause}
      ORDER BY m.full_name
    `, params);

    const members = r.rows.map(m => ({
      id: m.id,
      full_name: m.full_name,
      checked_in: !!m.check_time,
      check_time: m.check_time ? m.check_time.slice(0, 5) : null
    }));
    const checkedCount = members.filter(m => m.checked_in).length;

    res.json({
      date: t.date,
      server_time: `${t.date} ${t.time}`,
      window_open: isWindowOpen(t),
      window_label: `${config.CHECKIN_START_HOUR}:00 - ${config.CHECKIN_START_HOUR}:59`,
      total: members.length,
      checked: checkedCount,
      members
    });
  } catch (err) { next(err); }
});

// ============== TÍCH / BỎ TÍCH ĐIỂM DANH ==============
// body: { member_id, present: true|false }
router.post('/toggle', adminRequired, async (req, res, next) => {
  try {
    const t = nowInTimezone();
    if (!isWindowOpen(t)) {
      return res.status(400).json({
        error: `Chỉ điểm danh được từ ${config.CHECKIN_START_HOUR}:00 đến ${config.CHECKIN_START_HOUR}:59 sáng`,
        window_open: false
      });
    }

    const memberId = parseInt((req.body && req.body.member_id), 10);
    const present = !!(req.body && req.body.present);
    if (!memberId) return res.status(400).json({ error: 'Thiếu member_id' });

    const m = await query('SELECT id FROM members WHERE id = $1', [memberId]);
    if (!m.rows.length) return res.status(404).json({ error: 'Không tìm thấy thành viên' });

    if (present) {
      await query(`
        INSERT INTO member_checkins (member_id, check_date, check_time)
        VALUES ($1, $2, $3)
        ON CONFLICT (member_id, check_date) DO NOTHING
      `, [memberId, t.date, t.time]);
      return res.json({ ok: true, member_id: memberId, checked_in: true, check_time: t.time.slice(0, 5) });
    } else {
      await query('DELETE FROM member_checkins WHERE member_id = $1 AND check_date = $2', [memberId, t.date]);
      return res.json({ ok: true, member_id: memberId, checked_in: false });
    }
  } catch (err) { next(err); }
});

// ============== TÍCH / BỎ TÍCH TẤT CẢ ==============
// body: { present: true|false, search?: string } - chỉ trong khung giờ
// Nếu có search: chỉ áp dụng cho thành viên khớp tìm kiếm (tránh xóa nhầm toàn bộ)
router.post('/bulk', adminRequired, async (req, res, next) => {
  try {
    const t = nowInTimezone();
    if (!isWindowOpen(t)) {
      return res.status(400).json({
        error: `Chỉ điểm danh được từ ${config.CHECKIN_START_HOUR}:00 đến ${config.CHECKIN_START_HOUR}:59 sáng`,
        window_open: false
      });
    }
    const present = !!(req.body && req.body.present);
    const search = ((req.body && req.body.search) || '').trim().toLowerCase();
    // Điều kiện lọc theo tên (nếu có)
    const filterSql = search ? 'WHERE LOWER(full_name) LIKE $3' : '';
    const idSubquery = `SELECT id FROM members ${search ? 'WHERE LOWER(full_name) LIKE $2' : ''}`;

    let affected = 0;
    if (present) {
      const params = search ? [t.date, t.time, `%${search}%`] : [t.date, t.time];
      const r = await query(`
        INSERT INTO member_checkins (member_id, check_date, check_time)
        SELECT id, $1, $2 FROM members ${filterSql}
        ON CONFLICT (member_id, check_date) DO NOTHING
      `, params);
      affected = r.rowCount;
    } else {
      const params = search ? [t.date, `%${search}%`] : [t.date];
      const r = await query(
        `DELETE FROM member_checkins WHERE check_date = $1 AND member_id IN (${idSubquery})`,
        params
      );
      affected = r.rowCount;
    }
    res.json({ ok: true, present, affected, filtered: !!search });
  } catch (err) { next(err); }
});

module.exports = router;
