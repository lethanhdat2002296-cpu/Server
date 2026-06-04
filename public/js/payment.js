// Trang thanh toán CÔNG KHAI: trái = lịch sử, phải = gửi biên lai

const form = document.getElementById('pay-form');
const nameInput = document.getElementById('name-input');
let imageBase64 = null, imageMime = null, ocrText = '', isReceipt = false, selectedMemberId = null;

function fieldErr(input, msg) {
  const wrap = input.closest('.form-group'); if (!wrap) return;
  const e = wrap.querySelector('.field-error');
  if (msg) { input.classList.add('error'); if (e) e.textContent = msg; }
  else { input.classList.remove('error'); if (e) e.textContent = ''; }
}
function msg(type, text) {
  const el = document.getElementById('pay-message');
  el.className = `message show ${type}`; el.textContent = text;
}
function escapeText(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function fmtDate(s) { try { return new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }); } catch (e) { return s; } }

// ============ VALIDATORS ============
const V = {
  phone: v => /^0\d{9}$/.test(v) ? null : 'SĐT phải 10 số, bắt đầu bằng 0',
  email: v => /^[a-zA-Z0-9_%+-]+(\.[a-zA-Z0-9_%+-]+)*@(gmail\.com|company\.com)$/.test(v) ? null : 'Email phải @gmail.com hoặc @company.com',
  name: v => (v && v.trim().length >= 2) ? null : 'Vui lòng nhập họ tên'
};

// ============ AUTOCOMPLETE TÊN ============
const suggestBox = document.getElementById('name-suggest');
let suggestTimer = null;

nameInput.addEventListener('input', () => {
  selectedMemberId = null;
  const q = nameInput.value.trim();
  clearTimeout(suggestTimer);
  if (q.length < 1) { suggestBox.classList.remove('show'); return; }
  suggestTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/public/members/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      const members = data.members || [];
      if (!members.length) { suggestBox.classList.remove('show'); return; }
      suggestBox.innerHTML = members.map(m => {
        const hints = [m.phone_hint, m.email_hint].filter(Boolean).map(escapeText).join(' • ');
        return `<div class="suggest-item" data-id="${m.id}" data-name="${escapeText(m.full_name)}">
           <div class="si-name">${escapeText(m.full_name)}</div>
           ${hints ? `<div class="si-hint">${hints}</div>` : ''}
         </div>`;
      }).join('');
      suggestBox.classList.add('show');
      suggestBox.querySelectorAll('.suggest-item').forEach(it => it.addEventListener('click', () => selectMember(it.dataset.id, it.dataset.name)));
    } catch (e) { suggestBox.classList.remove('show'); }
  }, 250);
});

document.addEventListener('click', e => {
  if (!suggestBox.contains(e.target) && e.target !== nameInput) suggestBox.classList.remove('show');
});

async function selectMember(id, name) {
  selectedMemberId = id;
  nameInput.value = name;
  suggestBox.classList.remove('show');
  fieldErr(nameInput, null);
  // Autofill thông tin
  try {
    const res = await fetch(`/api/public/members/${id}`);
    const data = await res.json();
    if (res.ok && data.member) {
      form.phone.value = data.member.phone || '';
      form.email.value = data.member.email || '';
      fieldErr(form.phone, null); fieldErr(form.email, null);
      msg('success', '✓ Đã tìm thấy thông tin của bạn. Xem lịch sử bên trái hoặc gửi biên lai mới bên phải.');
    }
  } catch (e) {}
  // Tải lịch sử
  loadHistory();
}

// Phone: chỉ số
form.phone.addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10); });

// ============ LỊCH SỬ THANH TOÁN ============
function statusBadge(st) {
  if (st === 'confirmed') return '<span class="badge confirmed">✓ Đã xác nhận</span>';
  if (st === 'rejected') return '<span class="badge rejected">✗ Bị từ chối</span>';
  return '<span class="badge pending">⏳ Chờ xác nhận</span>';
}
async function loadHistory() {
  const listEl = document.getElementById('hist-list');
  const refreshBtn = document.getElementById('hist-refresh');
  if (!selectedMemberId) {
    refreshBtn.disabled = true;
    listEl.innerHTML = '<div class="empty-state" style="padding:30px 10px;"><div class="ico">🔎</div><div>Chọn tên của bạn ở trên để xem lịch sử thanh toán và trạng thái.</div></div>';
    return;
  }
  refreshBtn.disabled = false;
  listEl.innerHTML = '<div class="empty-state" style="padding:20px;"><div class="ico">⏳</div><div>Đang tải...</div></div>';
  try {
    const res = await fetch(`/api/public/payments?member_id=${selectedMemberId}`);
    const data = await res.json();
    const items = data.payments || [];
    if (!items.length) {
      listEl.innerHTML = '<div class="empty-state" style="padding:30px 10px;"><div class="ico">🧾</div><div>Chưa có biên lai nào. Hãy gửi biên lai ở bên phải.</div></div>';
      return;
    }
    listEl.innerHTML = items.map(p => `
      <div class="hist-item">
        <div class="hist-top">
          <span class="hist-id">#${p.id}</span>
          ${statusBadge(p.status)}
        </div>
        <div class="hist-date">🕐 ${fmtDate(p.created_at)}${p.detected_banks ? ` • 🏦 ${escapeText(p.detected_banks)}` : ''}</div>
        ${p.confirmed_at ? `<div class="hist-date">✓ Xử lý: ${fmtDate(p.confirmed_at)}</div>` : ''}
        ${p.admin_note ? `<div class="hist-note">💬 ${escapeText(p.admin_note)}</div>` : ''}
      </div>`).join('');
  } catch (e) {
    listEl.innerHTML = '<div class="empty-state" style="padding:20px;"><div>Lỗi tải lịch sử</div></div>';
  }
}
document.getElementById('hist-refresh').addEventListener('click', loadHistory);

// ============ ẢNH + OCR ============
let tesseractPromise = null;
function loadTesseract() {
  if (tesseractPromise) return tesseractPromise;
  tesseractPromise = new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = () => resolve(window.Tesseract); s.onerror = () => reject(new Error('no tesseract'));
    document.head.appendChild(s);
  });
  return tesseractPromise;
}
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, 1200 / img.width);
        const w = Math.round(img.width * ratio), h = Math.round(img.height * ratio);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject; img.src = e.target.result;
    };
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}
const RECEIPT_KW = ['VIETCOMBANK','VCB','TECHCOMBANK','TCB','VIETINBANK','BIDV','AGRIBANK','MB BANK','MBBANK','ACB','VPBANK','SACOMBANK','TPBANK','HDBANK','EXIMBANK','SHB','OCB','MSB','MOMO','ZALOPAY','VNPAY','SHOPEEPAY','VIETTELPAY','CHUYEN KHOAN','CHUYỂN KHOẢN','CHUYEN TIEN','GIAO DICH','GIAO DỊCH','TRANSACTION','TRANSFER','BIEN LAI','THANH TOAN','SO TIEN','SỐ TIỀN','THANH CONG','THÀNH CÔNG','SUCCESS','VND','STK','TAI KHOAN'];
function analyze(t) { if (!t) return false; const u = t.toUpperCase(); return RECEIPT_KW.filter(k => u.includes(k)).length >= 2; }

function setOcr(type, text) {
  const el = document.getElementById('pay-ocr-status');
  if (!text) { el.innerHTML = ''; return; }
  const cls = type === 'processing' ? 'ocr-status processing' : type === 'success' ? 'ocr-status success' : 'ocr-status warning';
  const ico = type === 'processing' ? '<span class="spinner"></span>' : type === 'success' ? '✓' : '⚠';
  el.innerHTML = `<div class="${cls}">${ico}<span>${text}</span></div>`;
}

async function processImage(file) {
  if (!file) return;
  document.getElementById('pay-submit').disabled = true;
  setOcr('processing', 'Đang xử lý ảnh...');
  let dataUrl;
  try { dataUrl = await resizeImage(file); } catch (e) { setOcr('warning', 'Không đọc được ảnh'); return; }
  imageBase64 = dataUrl; imageMime = 'image/jpeg';
  document.getElementById('pay-preview').src = dataUrl;
  document.getElementById('pay-preview-wrap').style.display = 'block';
  document.getElementById('pay-drop').style.display = 'none';

  setOcr('processing', 'Đang tải bộ đọc ảnh (lần đầu ~10s)...');
  let Tesseract;
  try { Tesseract = await loadTesseract(); }
  catch (e) { setOcr('warning', 'Không tải được OCR. Vẫn có thể gửi - admin xác minh thủ công.'); ocrText=''; isReceipt=false; document.getElementById('pay-submit').disabled = false; return; }

  setOcr('processing', 'Đang đọc nội dung...');
  try {
    const result = await Tesseract.recognize(dataUrl, 'eng', {
      logger: m => { if (m.status === 'recognizing text') setOcr('processing', `Đang đọc... ${Math.round(m.progress*100)}%`); }
    });
    ocrText = result.data.text || '';
    isReceipt = analyze(ocrText);
    setOcr(isReceipt ? 'success' : 'warning', isReceipt ? 'Đã xác nhận là biên lai chuyển khoản' : 'Ảnh có vẻ KHÔNG phải biên lai. Vẫn gửi được nhưng sẽ chờ admin xác minh.');
  } catch (e) { setOcr('warning', 'Không xử lý được ảnh. Vẫn gửi được.'); ocrText=''; isReceipt=false; }
  document.getElementById('pay-submit').disabled = false;
}

document.getElementById('pay-image').addEventListener('change', e => { if (e.target.files?.[0]) processImage(e.target.files[0]); });
const drop = document.getElementById('pay-drop');
['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('dragover'); }));
['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('dragover'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files?.[0]; if (f) processImage(f); });
document.getElementById('pay-clear').addEventListener('click', () => {
  imageBase64 = null; ocrText = ''; isReceipt = false;
  document.getElementById('pay-image').value = '';
  document.getElementById('pay-preview-wrap').style.display = 'none';
  document.getElementById('pay-drop').style.display = 'block';
  document.getElementById('pay-submit').disabled = true;
  setOcr(null);
});

// ============ SUBMIT ============
form.addEventListener('submit', async e => {
  e.preventDefault();
  [nameInput, form.phone, form.email].forEach(i => fieldErr(i, null));
  const data = {
    member_id: selectedMemberId,
    full_name: nameInput.value.trim(),
    phone: form.phone.value.trim(),
    email: form.email.value.trim().toLowerCase(),
    image_data: imageBase64, image_mime: imageMime, ocr_text: ocrText
  };
  let bad = false;
  if (!selectedMemberId) {
    fieldErr(nameInput, 'Vui lòng chọn đúng tên của bạn từ danh sách gợi ý');
    msg('error', 'Bạn chưa chọn tên từ danh sách gợi ý. Gõ tên rồi chọn đúng tên của bạn. Nếu chưa có tên, liên hệ admin để được thêm vào danh sách.');
    bad = true;
  }
  const ne = V.name(data.full_name); if (ne) { fieldErr(nameInput, ne); bad = true; }
  const pe = V.phone(data.phone); if (pe) { fieldErr(form.phone, pe); bad = true; }
  const ee = V.email(data.email); if (ee) { fieldErr(form.email, ee); bad = true; }
  if (!data.image_data) { msg('error', 'Vui lòng đính kèm ảnh biên lai'); bad = true; }
  if (bad) return;

  if (ocrText && !isReceipt && !confirm('Hệ thống chưa xác minh được là biên lai. Bạn vẫn muốn gửi?')) return;

  const btn = document.getElementById('pay-submit');
  btn.disabled = true; btn.textContent = 'Đang gửi...';
  msg('info', 'Đang gửi biên lai và email xác nhận...');
  try {
    const res = await fetch('/api/public/payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    const body = await res.json();
    if (res.ok) {
      form.style.display = 'none';
      document.getElementById('pay-success').style.display = 'block';
      document.getElementById('pay-success-msg').innerHTML = body.email_sent
        ? `Mã giao dịch <b>#${body.payment_id}</b>. Email xác nhận đã gửi đến <b>${escapeText(data.email)}</b>.<br>Theo dõi trạng thái ở mục Lịch sử bên trái.`
        : `Mã giao dịch <b>#${body.payment_id}</b> — vui lòng <b>ghi nhớ mã này</b>.<br>${body.email_dev_mode ? '(DEV - email log ở console)' : '⚠ Chưa gửi được email xác nhận. Biên lai vẫn được ghi nhận, theo dõi trạng thái ở mục Lịch sử bên trái hoặc liên hệ admin.'}`;
      loadHistory(); // cập nhật lịch sử ngay
    } else {
      if (body.fields) Object.entries(body.fields).forEach(([k, v]) => {
        const target = k === 'full_name' ? nameInput : form[k];
        if (target) fieldErr(target, v);
      });
      msg('error', body.error || 'Gửi thất bại');
    }
  } catch (err) {
    msg('error', 'Không thể kết nối máy chủ');
  } finally {
    btn.disabled = false; btn.textContent = 'Gửi biên lai';
  }
});

document.getElementById('pay-again').addEventListener('click', () => {
  // Quay lại form, giữ nguyên tên đã chọn + lịch sử
  document.getElementById('pay-success').style.display = 'none';
  form.style.display = 'block';
  document.getElementById('pay-clear').click();
  msg('', '');
  document.getElementById('pay-message').className = 'message';
  loadHistory();
});
