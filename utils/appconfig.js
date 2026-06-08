// Cấu hình QR thanh toán (VietQR) - admin chỉnh, lưu 1 dòng trong app_config
const { query } = require('../lib/db');

// Giá trị mặc định (theo cấu hình ban đầu của nhóm)
const DEFAULT_QR = {
  bank_id: 'Techcombank',
  account_no: '19036020562019',
  account_name: 'HOANG LIEN',
  amount: 500000,
  description: '5AM Club',
  template: 'print'  // compact | compact2 | qr_only | print
};

const TEMPLATES = ['compact', 'compact2', 'qr_only', 'print'];

async function getQrConfig() {
  try {
    const r = await query('SELECT payload FROM app_config WHERE id = 1');
    const stored = (r.rows[0] && r.rows[0].payload && r.rows[0].payload.qr) || {};
    return { ...DEFAULT_QR, ...stored };
  } catch (e) {
    return { ...DEFAULT_QR };
  }
}

// Làm sạch + validate input từ admin
function sanitizeQrConfig(cfg) {
  cfg = cfg || {};
  const amount = parseInt(cfg.amount, 10);
  const template = String(cfg.template || '').toLowerCase();
  return {
    bank_id: (String(cfg.bank_id || '').trim()) || DEFAULT_QR.bank_id,
    account_no: (String(cfg.account_no || '').replace(/\s+/g, '').trim()) || DEFAULT_QR.account_no,
    account_name: (String(cfg.account_name || '').trim()) || DEFAULT_QR.account_name,
    amount: Number.isFinite(amount) && amount >= 0 ? amount : DEFAULT_QR.amount,
    description: (String(cfg.description || '').trim().slice(0, 100)) || DEFAULT_QR.description,
    template: TEMPLATES.includes(template) ? template : DEFAULT_QR.template
  };
}

async function saveQrConfig(cfg) {
  const clean = sanitizeQrConfig(cfg);
  await query(`
    INSERT INTO app_config (id, payload, updated_at) VALUES (1, $1::jsonb, NOW())
    ON CONFLICT (id) DO UPDATE SET payload = $1::jsonb, updated_at = NOW()
  `, [JSON.stringify({ qr: clean })]);
  return clean;
}

module.exports = { getQrConfig, saveQrConfig, DEFAULT_QR, TEMPLATES };
