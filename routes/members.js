const express = require('express');
const { query } = require('../lib/db');
const { adminRequired } = require('../middleware/auth');

const router = express.Router();

function clean(v) {
  return (v == null ? '' : String(v)).trim();
}
function normPhone(v) {
  return clean(v).replace(/[^\d]/g, '');
}

// ============== IMPORT (từ Excel đã parse ở client thành JSON) ==============
// body: { rows: [{ full_name, phone, email, address }] }
// Upsert theo phone (nếu có) → email → insert mới
router.post('/import', adminRequired, async (req, res, next) => {
  try {
    const rows = (req.body && req.body.rows) || [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'File không có dữ liệu' });
    }
    if (rows.length > 5000) {
      return res.status(400).json({ error: 'Tối đa 5000 dòng mỗi lần import' });
    }

    let inserted = 0, updated = 0, skipped = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const full_name = clean(r.full_name);
      const phone = normPhone(r.phone);
      const email = clean(r.email).toLowerCase();
      const address = clean(r.address);

      if (!full_name) { skipped++; errors.push(`Dòng ${i + 1}: thiếu họ tên`); continue; }

      try {
        let existing = null;
        if (phone) {
          existing = (await query('SELECT id FROM members WHERE phone = $1 LIMIT 1', [phone])).rows[0];
        }
        if (!existing && email) {
          existing = (await query('SELECT id FROM members WHERE email = $1 LIMIT 1', [email])).rows[0];
        }
        if (existing) {
          await query(
            'UPDATE members SET full_name = $1, phone = $2, email = $3, address = $4 WHERE id = $5',
            [full_name, phone, email, address, existing.id]
          );
          updated++;
        } else {
          await query(
            'INSERT INTO members (full_name, phone, email, address) VALUES ($1, $2, $3, $4)',
            [full_name, phone, email, address]
          );
          inserted++;
        }
      } catch (e) {
        skipped++;
        errors.push(`Dòng ${i + 1}: ${e.message}`);
      }
    }

    res.json({
      ok: true,
      inserted, updated, skipped,
      total: rows.length,
      errors: errors.slice(0, 20)
    });
  } catch (err) { next(err); }
});

// ============== LIST (search + pagination) ==============
router.get('/', adminRequired, async (req, res, next) => {
  try {
    const search = clean(req.query.search).toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

    const conds = [];
    const params = [];
    let i = 1;
    if (search) {
      conds.push(`(LOWER(full_name) LIKE $${i} OR phone LIKE $${i} OR LOWER(email) LIKE $${i})`);
      params.push(`%${search}%`);
      i++;
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const sql = `
      SELECT id, full_name, phone, email, address, created_at
      FROM members ${where}
      ORDER BY full_name
      LIMIT $${i++} OFFSET $${i++}
    `;
    params.push(limit, offset);
    const r = await query(sql, params);

    const totalRes = await query(`SELECT COUNT(*)::int AS c FROM members ${where}`, params.slice(0, params.length - 2));
    res.json({ members: r.rows, total: totalRes.rows[0].c, limit, offset });
  } catch (err) { next(err); }
});

// ============== UPDATE 1 member ==============
router.put('/:id', adminRequired, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const full_name = clean(req.body.full_name);
    if (!full_name) return res.status(400).json({ error: 'Thiếu họ tên' });
    const phone = normPhone(req.body.phone);
    const email = clean(req.body.email).toLowerCase();
    const address = clean(req.body.address);
    const r = await query(
      'UPDATE members SET full_name=$1, phone=$2, email=$3, address=$4 WHERE id=$5 RETURNING id',
      [full_name, phone, email, address, id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Không tìm thấy thành viên' });
    res.json({ ok: true, message: 'Đã cập nhật' });
  } catch (err) { next(err); }
});

// ============== DELETE 1 member ==============
router.delete('/:id', adminRequired, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const r = await query('DELETE FROM members WHERE id = $1 RETURNING full_name', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Không tìm thấy thành viên' });
    res.json({ ok: true, message: `Đã xóa ${r.rows[0].full_name}` });
  } catch (err) { next(err); }
});

// ============== DELETE ALL (xóa toàn bộ để import lại) ==============
router.delete('/', adminRequired, async (req, res, next) => {
  try {
    const c = (await query('SELECT COUNT(*)::int AS c FROM members')).rows[0].c;
    await query('DELETE FROM members');
    res.json({ ok: true, message: `Đã xóa toàn bộ ${c} thành viên` });
  } catch (err) { next(err); }
});

module.exports = router;
