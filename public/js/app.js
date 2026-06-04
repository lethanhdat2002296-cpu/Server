// ============ DASHBOARD ADMIN ============
const token = localStorage.getItem('token');
if (!token) window.location.href = '/';
const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
const cachedUser = JSON.parse(localStorage.getItem('user') || '{}');

if (cachedUser.role !== 'admin') {
  // Không phải admin → đá về trang đăng nhập
  localStorage.clear();
  window.location.href = '/';
}

// ============ HELPERS ============
async function api(method, url, body) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401) { localStorage.clear(); window.location.href = '/'; return; }
  return { ok: res.ok, status: res.status, data };
}
function pad(n) { return String(n).padStart(2, '0'); }
function escapeText(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function formatDateVi(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const days = ['Chủ Nhật','Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy'];
  const date = new Date(+y, +m - 1, +d);
  return `${days[date.getDay()]}, ${d}/${m}/${y}`;
}
function todayDateString() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function showMsg(elId, type, text) {
  const el = document.getElementById(elId); if (!el) return;
  el.className = `message show ${type}`; el.textContent = text;
  if (type === 'success') setTimeout(() => { el.className = 'message'; }, 4000);
}
function showFieldError(input, msg) {
  const wrap = input.closest('.form-group'); if (!wrap) return;
  const e = wrap.querySelector('.field-error');
  if (msg) { input.classList.add('error'); if (e) e.textContent = msg; }
  else { input.classList.remove('error'); if (e) e.textContent = ''; }
}
function showToast(type, title, body) {
  const c = document.getElementById('toast-container'); if (!c) return;
  const el = document.createElement('div');
  el.className = `toast ${type || ''}`;
  el.innerHTML = `<div class="toast-title">${escapeText(title)}</div>${body ? `<div class="toast-body">${escapeText(body)}</div>` : ''}`;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 5000);
}
function renderPagination(containerId, total, page, pageSize, onGo) {
  const el = document.getElementById(containerId); if (!el) return;
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <button class="page-btn" ${page<=0?'disabled':''} data-go="${page-1}">← Trước</button>
    <span style="font-size:13px;color:#7f8c8d;">Trang ${page+1}/${totalPages} • ${total} bản ghi</span>
    <button class="page-btn" ${page>=totalPages-1?'disabled':''} data-go="${page+1}">Sau →</button>`;
  el.querySelectorAll('button[data-go]').forEach(b => b.addEventListener('click', () => { if (!b.disabled) onGo(parseInt(b.dataset.go,10)); }));
}

// Lazy loaders
let sheetJSPromise = null;
function loadSheetJS() {
  if (sheetJSPromise) return sheetJSPromise;
  sheetJSPromise = new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX); s.onerror = () => reject(new Error('Không tải được SheetJS'));
    document.head.appendChild(s);
  });
  return sheetJSPromise;
}
let chartJSPromise = null;
function loadChartJS() {
  if (chartJSPromise) return chartJSPromise;
  chartJSPromise = new Promise((resolve, reject) => {
    if (window.Chart) return resolve(window.Chart);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
    s.onload = () => resolve(window.Chart); s.onerror = () => reject(new Error('Không tải được Chart.js'));
    document.head.appendChild(s);
  });
  return chartJSPromise;
}
async function exportToExcel(rows, sheetName, fileName, headers) {
  if (!rows || !rows.length) return alert('Không có dữ liệu để xuất');
  const XLSX = await loadSheetJS();
  const aoa = [headers.map(h => h.label)];
  rows.forEach((r, i) => {
    const row = [i + 1];
    headers.slice(1).forEach(h => row.push(typeof h.value === 'function' ? h.value(r) : r[h.key]));
    aoa.push(row);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map(h => ({ wch: h.width || 15 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, fileName);
}

// ============ TOPBAR + NAV ============
document.getElementById('topbar-username').textContent = cachedUser.full_name || cachedUser.username || '';
document.getElementById('btn-logout').addEventListener('click', () => { localStorage.clear(); window.location.href = '/'; });

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.page;
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${target}`));
    if (target === 'checkin') loadCheckinToday();
    if (target === 'members') { initMembersTab(); loadMembers(); }
    if (target === 'payments') { initPaymentsTab(); loadPayments(); }
    if (target === 'reports') initReportsTab();
    if (target === 'settings') { initSettingsTab(); loadProfile(); }
  });
});

// ============================================================
//  ĐIỂM DANH
// ============================================================
let ciInitialized = false;
let ciSearch = '';
let ciWindowOpen = false;

function ciUpdateClock() {
  const now = new Date();
  document.getElementById('ci-clock').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  document.getElementById('ci-date').textContent = formatDateVi(todayDateString());
}
setInterval(ciUpdateClock, 1000); ciUpdateClock();

async function loadCheckinToday() {
  if (!ciInitialized) {
    ciInitialized = true;
    let t = null;
    document.getElementById('ci-search').addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { ciSearch = e.target.value.trim(); loadCheckinToday(); }, 350);
    });
    document.getElementById('ci-refresh').addEventListener('click', loadCheckinToday);
  }
  const listEl = document.getElementById('ci-list');
  const r = await api('GET', `/api/checkin/today?search=${encodeURIComponent(ciSearch)}`);
  if (!r || !r.ok) { listEl.innerHTML = `<div class="empty-state"><div>${r?.data?.error||'Lỗi'}</div></div>`; return; }

  ciWindowOpen = r.data.window_open;
  document.getElementById('ci-window-label').textContent = r.data.window_label;
  document.getElementById('ci-window-badge').innerHTML = r.data.window_open
    ? '<span class="badge confirmed" style="font-size:13px;padding:6px 14px;">🟢 ĐANG MỞ ĐIỂM DANH</span>'
    : '<span class="badge pending" style="font-size:13px;padding:6px 14px;">⏸ NGOÀI GIỜ ĐIỂM DANH</span>';
  document.getElementById('ci-summary').innerHTML =
    `Tổng <b>${r.data.total}</b> thành viên • ✅ Đã điểm danh <b style="color:#00b894;">${r.data.checked}</b> • ⬜ Chưa <b style="color:#d63031;">${r.data.total - r.data.checked}</b>`;

  const members = r.data.members || [];
  if (members.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><div class="ico">👥</div><div>${ciSearch ? 'Không tìm thấy' : 'Chưa có thành viên. Hãy import ở tab Thành viên.'}</div></div>`;
    return;
  }
  if (!r.data.window_open) {
    listEl.insertAdjacentHTML && (document.getElementById('ci-summary').innerHTML += '<br><span style="color:#d63031;">⚠ Hiện không trong khung giờ - chỉ xem, không tích được.</span>');
  }

  listEl.innerHTML = members.map(m => `
    <label class="user-row" style="cursor:${ciWindowOpen?'pointer':'default'};">
      <input type="checkbox" data-id="${m.id}" ${m.checked_in?'checked':''} ${ciWindowOpen?'':'disabled'}
             style="width:22px;height:22px;flex:none;accent-color:#00b894;">
      <div class="user-row-info">
        <div class="user-row-name">${escapeText(m.full_name)}</div>
        ${m.checked_in ? `<div class="user-row-sub" style="color:#00b894;">✓ Điểm danh lúc ${m.check_time}</div>` : '<div class="user-row-sub">Chưa điểm danh</div>'}
      </div>
    </label>
  `).join('');

  listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const id = cb.dataset.id;
      const present = cb.checked;
      cb.disabled = true;
      const rr = await api('POST', '/api/checkin/toggle', { member_id: id, present });
      cb.disabled = !ciWindowOpen ? true : false;
      if (rr && rr.ok) {
        loadCheckinToday();
      } else {
        cb.checked = !present; // revert
        showToast('error', 'Không điểm danh được', rr?.data?.error || 'Lỗi');
        if (rr?.data?.window_open === false) loadCheckinToday();
      }
    });
  });
}

// ============================================================
//  THÀNH VIÊN (import Excel)
// ============================================================
let membersInitialized = false;
let memSearch = '';
let memPage = 0;
const MEM_PAGE = 20;

function initMembersTab() {
  if (membersInitialized) return;
  membersInitialized = true;

  document.getElementById('mem-file').addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) importMembersFile(e.target.files[0]);
  });
  const drop = document.getElementById('mem-drop');
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('dragover'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files?.[0]; if (f) importMembersFile(f); });

  document.getElementById('mem-template').addEventListener('click', downloadTemplate);
  document.getElementById('mem-clear-all').addEventListener('click', async () => {
    if (!confirm('Xóa TOÀN BỘ thành viên? Không thể hoàn tác.')) return;
    const r = await api('DELETE', '/api/members');
    if (r && r.ok) { showToast('success', 'Đã xóa', r.data.message); memPage = 0; loadMembers(); }
    else showToast('error', 'Lỗi', r?.data?.error || '');
  });

  let t = null;
  document.getElementById('mem-search').addEventListener('input', e => {
    clearTimeout(t); t = setTimeout(() => { memSearch = e.target.value.trim(); memPage = 0; loadMembers(); }, 350);
  });
  document.getElementById('mem-refresh').addEventListener('click', () => { memPage = 0; loadMembers(); });
}

// Map tên cột Excel (linh hoạt tiếng Việt/Anh) → field
function normalizeKey(k) {
  return String(k).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // bỏ dấu (sắc/huyền/...)
    .replace(/đ/g, 'd')                                 // đ → d (NFD không tách được)
    .replace(/[^a-z0-9]/g, '');                         // bỏ khoảng trắng/ký tự khác
}
function pickField(row, keys) {
  for (const k of Object.keys(row)) {
    const norm = normalizeKey(k);
    for (const want of keys) if (norm.includes(want)) return row[k];
  }
  return '';
}

async function importMembersFile(file) {
  const statusEl = document.getElementById('mem-import-status');
  statusEl.innerHTML = '<div class="ocr-status processing"><span class="spinner"></span><span>Đang đọc file...</span></div>';
  try {
    const XLSX = await loadSheetJS();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!json.length) { statusEl.innerHTML = '<div class="ocr-status warning">⚠ File trống</div>'; return; }

    const rows = json.map(r => ({
      full_name: String(pickField(r, ['hoten','hovaten','ten','name','fullname'])).trim(),
      phone: String(pickField(r, ['sodienthoai','sdt','dienthoai','phone','zalo','sodt'])).trim(),
      email: String(pickField(r, ['email','mail'])).trim(),
      address: String(pickField(r, ['diachi','address','dia'])).trim()
    })).filter(r => r.full_name);

    if (!rows.length) {
      statusEl.innerHTML = '<div class="ocr-status warning">⚠ Không tìm thấy cột "Họ tên". Kiểm tra tiêu đề cột.</div>';
      return;
    }

    statusEl.innerHTML = `<div class="ocr-status processing"><span class="spinner"></span><span>Đang import ${rows.length} dòng...</span></div>`;
    const r = await api('POST', '/api/members/import', { rows });
    if (r && r.ok) {
      statusEl.innerHTML = `<div class="ocr-status success">✓ Xong: thêm mới <b>${r.data.inserted}</b>, cập nhật <b>${r.data.updated}</b>, bỏ qua ${r.data.skipped}</div>`;
      memPage = 0; loadMembers();
    } else {
      statusEl.innerHTML = `<div class="ocr-status warning">⚠ ${r?.data?.error || 'Lỗi import'}</div>`;
    }
  } catch (e) {
    console.error(e);
    statusEl.innerHTML = `<div class="ocr-status warning">⚠ Lỗi đọc file: ${e.message}</div>`;
  }
  document.getElementById('mem-file').value = '';
}

async function downloadTemplate() {
  const XLSX = await loadSheetJS();
  const aoa = [
    ['Họ và tên', 'Số điện thoại', 'Email', 'Địa chỉ'],
    ['Nguyễn Văn A', '0901234567', 'nguyenvana@gmail.com', '123 Lê Lợi, Q1, HCM'],
    ['Trần Thị B', '0907654321', 'tranthib@gmail.com', '456 Hai Bà Trưng, Q3, HCM']
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 28 }, { wch: 32 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mau');
  XLSX.writeFile(wb, 'mau-danh-sach-thanh-vien.xlsx');
}

async function loadMembers() {
  const tbody = document.querySelector('#mem-table tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:#95a5a6;">Đang tải...</td></tr>';
  const qs = `search=${encodeURIComponent(memSearch)}&limit=${MEM_PAGE}&offset=${memPage*MEM_PAGE}`;
  const r = await api('GET', `/api/members?${qs}`);
  if (!r || !r.ok) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#e74c3c;padding:20px;">${r?.data?.error||'Lỗi'}</td></tr>`; return; }
  const members = r.data.members || [];
  if (members.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:#95a5a6;">${memSearch?'Không tìm thấy':'Chưa có thành viên - hãy import file Excel'}</td></tr>`;
    renderPagination('mem-pagination', r.data.total||0, memPage, MEM_PAGE, p => { memPage=p; loadMembers(); });
    return;
  }
  tbody.innerHTML = members.map((m, i) => `
    <tr>
      <td class="num">${memPage*MEM_PAGE + i + 1}</td>
      <td>${escapeText(m.full_name)}</td>
      <td>${escapeText(m.phone||'—')}</td>
      <td>${escapeText(m.email||'—')}</td>
      <td>${escapeText(m.address||'—')}</td>
      <td><button class="btn-reject" data-del="${m.id}" data-name="${escapeText(m.full_name)}" style="padding:5px 10px;border-radius:6px;font-size:12px;">🗑</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('button[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(`Xóa thành viên "${b.dataset.name}"?`)) return;
    const rr = await api('DELETE', `/api/members/${b.dataset.del}`);
    if (rr && rr.ok) { showToast('success', 'Đã xóa', rr.data.message); loadMembers(); }
    else showToast('error', 'Lỗi', rr?.data?.error || '');
  }));
  renderPagination('mem-pagination', r.data.total||0, memPage, MEM_PAGE, p => { memPage=p; loadMembers(); });
}

// ============================================================
//  THANH TOÁN (admin duyệt)
// ============================================================
let paymentsInitialized = false;
let payFilter = 'pending';
let paySearch = '';
let payPage = 0;
const PAY_PAGE = 20;

function initPaymentsTab() {
  if (paymentsInitialized) return;
  paymentsInitialized = true;
  document.querySelectorAll('#page-payments .filter-btn[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#page-payments .filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); payFilter = btn.dataset.filter; payPage = 0; loadPayments();
    });
  });
  let t = null;
  document.getElementById('pay-search').addEventListener('input', e => {
    clearTimeout(t); t = setTimeout(() => { paySearch = e.target.value.trim(); payPage = 0; loadPayments(); }, 400);
  });
  document.getElementById('pay-refresh').addEventListener('click', () => { payPage = 0; loadPayments(); });
  document.getElementById('pay-modal-cancel').addEventListener('click', () => document.getElementById('pay-modal').classList.remove('show'));
  document.getElementById('pay-modal-confirm').addEventListener('click', submitPayAction);
  document.getElementById('pay-modal').addEventListener('click', e => { if (e.target.id === 'pay-modal') document.getElementById('pay-modal').classList.remove('show'); });
}

async function loadPayments() {
  const listEl = document.getElementById('pay-list');
  listEl.innerHTML = '<div class="empty-state"><div class="ico">⏳</div><div>Đang tải...</div></div>';
  const qs = `status=${payFilter}&search=${encodeURIComponent(paySearch)}&limit=${PAY_PAGE}&offset=${payPage*PAY_PAGE}`;
  const r = await api('GET', `/api/admin/payments?${qs}`);
  if (!r || !r.ok) { listEl.innerHTML = `<div class="empty-state"><div>${r?.data?.error||'Lỗi'}</div></div>`; return; }
  const counts = r.data.counts || {};
  document.getElementById('cnt-pending').textContent = counts.pending || 0;
  document.getElementById('cnt-confirmed').textContent = counts.confirmed || 0;
  document.getElementById('cnt-rejected').textContent = counts.rejected || 0;
  const items = r.data.payments || [];
  if (items.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><div class="ico">📋</div><div>${paySearch?'Không tìm thấy':'Không có thanh toán'}</div></div>`;
    renderPagination('pay-pagination', r.data.total||0, payPage, PAY_PAGE, p => { payPage=p; loadPayments(); });
    return;
  }
  listEl.innerHTML = items.map(p => {
    const date = new Date(p.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const isPending = p.status === 'pending';
    let badge = isPending ? '<span class="badge pending">⏳ Chờ</span>'
      : p.status === 'confirmed' ? '<span class="badge confirmed">✓ Đã duyệt</span>'
      : '<span class="badge rejected">✗ Từ chối</span>';
    const ocr = p.is_receipt ? '<span class="badge sent">🤖 OCR pass</span>' : '';
    const emailFail = (!isPending && p.email_sent === false) ? '<span class="badge rejected">📧 Email lỗi</span>' : '';
    const note = p.admin_note ? `<div class="adm-pay-sub" style="font-style:italic;">💬 ${escapeText(p.admin_note)}</div>` : '';
    return `<div class="adm-pay-item">
      <div class="adm-pay-info">
        <div class="adm-pay-name">#${p.id} - ${escapeText(p.full_name)} ${badge} ${ocr} ${emailFail}</div>
        <div class="adm-pay-sub">📞 ${escapeText(p.phone)} • 📧 ${escapeText(p.email)}</div>
        <div class="adm-pay-sub">🕐 ${date}${p.detected_banks?` • 🏦 ${escapeText(p.detected_banks)}`:''}</div>
        ${note}
      </div>
      <div class="adm-pay-actions">
        ${isPending ? `<button class="btn-confirm" data-act="confirm" data-id="${p.id}" data-name="${escapeText(p.full_name)}">✓ Duyệt</button>
          <button class="btn-reject" data-act="reject" data-id="${p.id}" data-name="${escapeText(p.full_name)}">✗ Từ chối</button>` : ''}
        ${(!isPending && p.email_sent === false) ? `<button class="btn-reject" data-act="resend" data-id="${p.id}">📧 Gửi lại</button>` : ''}
      </div>
    </div>`;
  }).join('');
  listEl.querySelectorAll('button[data-act="confirm"],button[data-act="reject"]').forEach(b =>
    b.addEventListener('click', () => openPayModal(b.dataset.act, b.dataset.id, b.dataset.name)));
  listEl.querySelectorAll('button[data-act="resend"]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = '...';
    const rr = await api('POST', `/api/admin/payments/${b.dataset.id}/resend-email`);
    if (rr && rr.ok && rr.data.email_sent) { showToast('success', 'Đã gửi lại email', ''); loadPayments(); }
    else { showToast('error', 'Gửi lỗi', rr?.data?.email_error || ''); b.disabled = false; b.textContent = '📧 Gửi lại'; }
  }));
  renderPagination('pay-pagination', r.data.total||0, payPage, PAY_PAGE, p => { payPage=p; loadPayments(); });
}

function openPayModal(action, id, name) {
  const modal = document.getElementById('pay-modal');
  modal.dataset.action = action; modal.dataset.id = id;
  document.getElementById('pay-modal-msg').className = 'message';
  document.getElementById('pay-modal-note').value = '';
  if (action === 'confirm') {
    document.getElementById('pay-modal-title').textContent = `✓ Xác nhận thanh toán #${id}`;
    document.getElementById('pay-modal-desc').textContent = `Email xác nhận sẽ gửi đến "${name}".`;
    document.getElementById('pay-modal-confirm').textContent = 'Xác nhận';
  } else {
    document.getElementById('pay-modal-title').textContent = `✗ Từ chối thanh toán #${id}`;
    document.getElementById('pay-modal-desc').textContent = `"${name}" sẽ nhận email lý do từ chối.`;
    document.getElementById('pay-modal-confirm').textContent = 'Từ chối';
  }
  modal.classList.add('show');
}

async function submitPayAction() {
  const modal = document.getElementById('pay-modal');
  const action = modal.dataset.action, id = modal.dataset.id;
  const note = document.getElementById('pay-modal-note').value.trim();
  const btn = document.getElementById('pay-modal-confirm');
  const msg = document.getElementById('pay-modal-msg');
  btn.disabled = true; btn.textContent = 'Đang xử lý...';
  const r = await api('POST', `/api/admin/payments/${id}/${action}`, { note });
  if (r && r.ok) {
    msg.className = 'message show success';
    msg.textContent = r.data.email_sent ? '✓ Đã xử lý + gửi email' : '⚠ Đã xử lý, email lỗi: ' + (r.data.email_error||'');
    setTimeout(() => { modal.classList.remove('show'); loadPayments(); }, 1400);
  } else {
    msg.className = 'message show error'; msg.textContent = r?.data?.error || 'Lỗi';
  }
  btn.disabled = false; btn.textContent = action === 'confirm' ? 'Xác nhận' : 'Từ chối';
}

// ============================================================
//  BÁO CÁO
// ============================================================
let reportsInitialized = false;
let lastDaily = null, lastDetailed = null, lastRange = null, chartInstance = null;

function validateReportDate(v) {
  const today = todayDateString();
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return today;
  if (v < '2024-01-01' || v > today) return today;
  return v;
}
function computeRange(type) {
  const d = new Date();
  const to = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  let from;
  if (type === 'month') from = `${d.getFullYear()}-${pad(d.getMonth()+1)}-01`;
  else if (type === '30days') { const s = new Date(d); s.setDate(s.getDate()-29); from = `${s.getFullYear()}-${pad(s.getMonth()+1)}-${pad(s.getDate())}`; }
  else { const s = new Date(d); s.setDate(s.getDate()-6); from = `${s.getFullYear()}-${pad(s.getMonth()+1)}-${pad(s.getDate())}`; }
  return { from, to };
}

async function loadReportOverview() {
  const r = await api('GET', '/api/admin/reports/overview');
  if (!r || !r.ok) return;
  document.getElementById('rep-total-users').textContent = r.data.total_members;
  document.getElementById('rep-checked-today').textContent = r.data.checked_in_today;
  document.getElementById('rep-not-checked-today').textContent = r.data.not_checked_today;
  document.getElementById('rep-total-checkins').textContent = r.data.total_checkins_all_time;
}
async function loadReportDaily(date) {
  const tbody = document.querySelector('#rep-daily-table tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:#95a5a6;">Đang tải...</td></tr>';
  const r = await api('GET', `/api/admin/reports/daily?date=${date}`);
  if (!r || !r.ok) return;
  lastDaily = r.data;
  document.getElementById('rep-daily-summary').textContent = `Ngày ${r.data.date} • ${r.data.total} người • ✓ ${r.data.checked} • ✗ ${r.data.not_checked}`;
  if (!r.data.rows.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#95a5a6;">Chưa có thành viên</td></tr>'; return; }
  tbody.innerHTML = r.data.rows.map((row, i) => `
    <tr><td class="num">${i+1}</td><td>${escapeText(row.full_name)}</td><td>${escapeText(row.phone||'—')}</td><td>${escapeText(row.email||'—')}</td>
    <td class="${row.checked_in?'checked-yes':'checked-no'}">${row.checked_in?'✓ Đã':'✗ Chưa'}</td><td class="num">${row.check_time||'—'}</td></tr>`).join('');
}
async function loadReportDetailed(date) {
  const tbody = document.querySelector('#rep-detailed-table tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:#95a5a6;">Đang tải...</td></tr>';
  const r = await api('GET', `/api/admin/reports/detailed?date=${date}`);
  if (!r || !r.ok) return;
  lastDetailed = r.data;
  if (!r.data.rows.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#95a5a6;">Chưa có thành viên</td></tr>'; return; }
  tbody.innerHTML = r.data.rows.map((row, i) => `
    <tr><td class="num">${i+1}</td><td>${escapeText(row.full_name)}</td><td>${escapeText(row.phone||'—')}</td>
    <td class="${row.checked_today?'checked-yes':'checked-no'}">${row.checked_today?'✓':'✗'}</td>
    <td class="num">${row.streak} ngày</td><td class="num">${row.total_checked}</td><td class="num">${row.total_missed}</td></tr>`).join('');
}
async function loadRangeReport(from, to) {
  const r = await api('GET', `/api/admin/reports/range?from=${from}&to=${to}`);
  if (!r || !r.ok) { showToast('error', 'Lỗi', r?.data?.error || ''); return; }
  lastRange = r.data;
  document.getElementById('rep-range-summary').textContent = `${r.data.from} → ${r.data.to} • ${r.data.total_days} ngày • ${r.data.total_checkins} lượt • ${r.data.total_members} người`;
  try {
    const Chart = await loadChartJS();
    const labels = r.data.daily.map(d => d.date.slice(5));
    const data = r.data.daily.map(d => d.count);
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(document.getElementById('rep-chart'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Lượt điểm danh', data, backgroundColor: 'rgba(225,112,85,0.7)', borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  } catch (e) { console.error(e); }
}
async function reloadAllReports() {
  const date = validateReportDate(document.getElementById('rep-date').value);
  await Promise.all([loadReportOverview(), loadReportDaily(date), loadReportDetailed(date)]);
}

function initReportsTab() {
  if (reportsInitialized) { reloadAllReports(); return; }
  reportsInitialized = true;
  const dateInput = document.getElementById('rep-date');
  const today = todayDateString();
  dateInput.value = today; dateInput.max = today;
  dateInput.addEventListener('change', () => {
    const n = validateReportDate(dateInput.value);
    if (n !== dateInput.value) { dateInput.value = n; alert('Ngày không hợp lệ. Đã chuyển về hôm nay.'); }
    reloadAllReports();
  });
  document.querySelectorAll('button[data-quick]').forEach(btn => btn.addEventListener('click', () => {
    const t = new Date(); if (btn.dataset.quick === 'yesterday') t.setDate(t.getDate()-1);
    dateInput.value = `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`; reloadAllReports();
  }));
  document.getElementById('rep-reload').addEventListener('click', reloadAllReports);

  document.getElementById('rep-daily-export').addEventListener('click', () => {
    if (!lastDaily) return alert('Chưa có dữ liệu');
    exportToExcel(lastDaily.rows, `Bao cao nhanh ${lastDaily.date}`, `bao-cao-nhanh-${lastDaily.date}.xlsx`, [
      { key:'_', label:'STT', width:6 }, { key:'full_name', label:'Họ và tên', width:28 },
      { key:'phone', label:'Số điện thoại', width:16 }, { key:'email', label:'Email', width:30 },
      { key:'checked_in', label:'Check-in', value:r=>r.checked_in?'Đã check-in':'Chưa', width:14 },
      { key:'check_time', label:'Giờ', value:r=>r.check_time||'', width:10 }]);
  });
  document.getElementById('rep-detailed-export').addEventListener('click', () => {
    if (!lastDetailed) return alert('Chưa có dữ liệu');
    exportToExcel(lastDetailed.rows, `Bao cao chi tiet ${lastDetailed.date}`, `bao-cao-chi-tiet-${lastDetailed.date}.xlsx`, [
      { key:'_', label:'STT', width:6 }, { key:'full_name', label:'Họ và tên', width:28 },
      { key:'phone', label:'Số điện thoại', width:16 },
      { key:'checked_today', label:'Check-in hôm nay', value:r=>r.checked_today?'Đã':'Chưa', width:18 },
      { key:'streak', label:'Số ngày liên tiếp', width:18 },
      { key:'total_checked', label:'Tổng đã check-in', width:18 },
      { key:'total_missed', label:'Tổng chưa check-in', width:20 }]);
  });

  document.querySelectorAll('.range-quick').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.range-quick').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const rg = computeRange(btn.dataset.range);
    document.getElementById('rep-range-from').value = rg.from;
    document.getElementById('rep-range-to').value = rg.to;
    loadRangeReport(rg.from, rg.to);
  }));
  document.getElementById('rep-range-apply').addEventListener('click', () => {
    document.querySelectorAll('.range-quick').forEach(b => b.classList.remove('active'));
    loadRangeReport(validateReportDate(document.getElementById('rep-range-from').value), validateReportDate(document.getElementById('rep-range-to').value));
  });
  document.getElementById('rep-range-export').addEventListener('click', () => {
    if (!lastRange) return alert('Chưa có dữ liệu');
    exportToExcel(lastRange.per_member, `Xu huong ${lastRange.from} ${lastRange.to}`, `xu-huong-${lastRange.from}_${lastRange.to}.xlsx`, [
      { key:'_', label:'STT', width:6 }, { key:'full_name', label:'Họ và tên', width:28 },
      { key:'phone', label:'Số điện thoại', width:16 }, { key:'email', label:'Email', width:30 },
      { key:'checked_days', label:`Số ngày điểm danh (${lastRange.total_days} ngày)`, width:26 }]);
  });

  const wk = computeRange('week');
  document.getElementById('rep-range-from').value = wk.from;
  document.getElementById('rep-range-to').value = wk.to;
  document.getElementById('rep-range-from').max = today;
  document.getElementById('rep-range-to').max = today;

  reloadAllReports();
  loadRangeReport(wk.from, wk.to);
}

// ============================================================
//  CÀI ĐẶT (admin profile + password)
// ============================================================
let settingsInitialized = false;
function initSettingsTab() {
  if (settingsInitialized) return;
  settingsInitialized = true;

  document.querySelectorAll('#page-settings .toggle-pwd').forEach(btn => btn.addEventListener('click', () => {
    const input = btn.previousElementSibling; input.type = input.type === 'password' ? 'text' : 'password';
  }));

  document.getElementById('profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    form.querySelectorAll('input').forEach(i => showFieldError(i, null));
    const data = { full_name: form.full_name.value.trim(), email: form.email.value.trim().toLowerCase() };
    const r = await api('PUT', '/api/settings/profile', data);
    if (r && r.ok) {
      showMsg('profile-msg', 'success', '✓ Cập nhật thành công');
      cachedUser.full_name = data.full_name; localStorage.setItem('user', JSON.stringify(cachedUser));
      document.getElementById('topbar-username').textContent = data.full_name;
    } else {
      if (r?.data?.fields) Object.entries(r.data.fields).forEach(([k,v]) => { if (form[k]) showFieldError(form[k], v); });
      showMsg('profile-msg', 'error', r?.data?.error || 'Lỗi');
    }
  });

  document.getElementById('btn-request-code').addEventListener('click', async e => {
    const btn = e.target; btn.disabled = true; btn.textContent = 'Đang gửi...';
    const r = await api('POST', '/api/settings/password/request-code');
    if (r && r.ok) {
      document.getElementById('password-form').style.display = 'block';
      showMsg('password-msg', 'success', '✓ ' + r.data.message + (r.data.dev_mode ? ' (DEV - xem console)' : ''));
      btn.textContent = 'Gửi lại mã';
    } else { showMsg('password-msg', 'error', r?.data?.error || 'Lỗi'); btn.textContent = 'Gửi mã xác nhận đến email'; }
    btn.disabled = false;
  });

  document.getElementById('password-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    form.querySelectorAll('input').forEach(i => showFieldError(i, null));
    const data = { code: form.code.value.trim(), new_password: form.new_password.value, confirm_password: form.confirm_password.value };
    if (!data.code) return showFieldError(form.code, 'Vui lòng nhập mã');
    if (data.new_password.length < 8) return showFieldError(form.new_password, 'Tối thiểu 8 ký tự');
    if (data.new_password !== data.confirm_password) return showFieldError(form.confirm_password, 'Mật khẩu nhập lại không khớp');
    const r = await api('POST', '/api/settings/password/change', data);
    if (r && r.ok) {
      showMsg('password-msg', 'success', '✓ Đổi mật khẩu thành công!');
      form.reset(); document.getElementById('password-form').style.display = 'none';
      document.getElementById('btn-request-code').textContent = 'Gửi mã xác nhận đến email';
    } else {
      if (r?.data?.fields) Object.entries(r.data.fields).forEach(([k,v]) => { if (form[k]) showFieldError(form[k], v); });
      showMsg('password-msg', 'error', r?.data?.error || 'Lỗi');
    }
  });
}
async function loadProfile() {
  const r = await api('GET', '/api/settings/me');
  if (!r || !r.ok) return;
  const form = document.getElementById('profile-form');
  form.full_name.value = r.data.user.full_name;
  form.email.value = r.data.user.email;
}

// ============ INIT ============
loadCheckinToday();
