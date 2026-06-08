// Dùng chung cho client: sinh URL ảnh VietQR (đồng bộ với server utils/appconfig.js).
// Include TRƯỚC payment.js / app.js. Dùng encodeURIComponent để dấu cách → %20 (không thành '+').
window.buildVietQrUrl = function (cfg) {
  cfg = cfg || {};
  const base = 'https://img.vietqr.io/image/'
    + encodeURIComponent(cfg.bank_id) + '-'
    + encodeURIComponent(cfg.account_no) + '-'
    + encodeURIComponent(cfg.template || 'print') + '.png';
  const q = 'amount=' + encodeURIComponent(cfg.amount || 0)
    + '&addInfo=' + encodeURIComponent(cfg.description || '')
    + '&accountName=' + encodeURIComponent(cfg.account_name || '');
  return base + '?' + q;
};
