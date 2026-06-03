// Dashboard chính - tối ưu: 1 API call, cache localStorage, render từ state

const token = localStorage.getItem('token');
if (!token) window.location.href = '/';
const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

// ============ STATE ============
let appState = {
  user: null,
  stats: null,
  checkin: null,
  history: null,
  server_time: null,
  fetched_at: 0
};
const CACHE_KEY = 'app_state_v1';
const CACHE_TTL_MS = 60_000;     // refresh ngầm sau 60s
const REFRESH_JITTER_MS = 30_000; // +0-30s random để tránh 100 user refresh đồng loạt
const MIN_REFRESH_AGE_MS = 10_000; // không refresh nếu data mới fetch < 10s

// ============ API HELPER ============
async function api(method, url, body) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem(CACHE_KEY);
    window.location.href = '/';
    return;
  }
  return { ok: res.ok, status: res.status, data };
}

// ============ COMMON ============
function showMsg(elId, type, text) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.className = `message show ${type}`;
  el.textContent = text;
  if (type === 'success') setTimeout(() => { el.className = 'message'; }, 4000);
}
function showFieldError(input, msg) {
  const wrap = input.closest('.form-group');
  if (!wrap) return;
  const errEl = wrap.querySelector('.field-error');
  if (msg) { input.classList.add('error'); if (errEl) errEl.textContent = msg; }
  else { input.classList.remove('error'); if (errEl) errEl.textContent = ''; }
}
function formatDateVi(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const date = new Date(+y, +m - 1, +d);
  const days = ['Chủ Nhật','Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy'];
  return `${days[date.getDay()]}, ${d}/${m}/${y}`;
}
function pad(n) { return String(n).padStart(2, '0'); }

// ============ TOPBAR ============
const cachedUser = JSON.parse(localStorage.getItem('user') || '{}');
document.getElementById('topbar-username').textContent = cachedUser.full_name || cachedUser.username || '';

// Hiện tab Quản trị + Báo cáo nếu là admin
if (cachedUser.role === 'admin') {
  document.getElementById('nav-admin').style.display = '';
  document.getElementById('nav-reports').style.display = '';
}
document.getElementById('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem(CACHE_KEY);
  window.location.href = '/';
});

// ============ NAV ============
// Chuyển tab chỉ đổi section, KHÔNG gọi API (dùng state đã cache)
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.page;
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${target}`));

    // Settings không nằm trong dashboard cache, vẫn load form khi vào
    if (target === 'settings') loadProfileForm();
    // History full: render lại từ state (không gọi API)
    if (target === 'history') renderHistory(false);
    if (target === 'checkin') renderCheckinTab();
    if (target === 'payment') initPaymentTab();
    if (target === 'admin') initAdminTab();
    if (target === 'reports') initReportsTab();
  });
});

// ============ RENDER FROM STATE ============
function renderHome() {
  if (!appState.user || !appState.stats) return;
  document.getElementById('home-fullname').textContent = appState.user.full_name;
  document.getElementById('stat-checked').textContent = appState.stats.checked_this_month;
  document.getElementById('stat-missed').textContent = appState.stats.missed_this_month;
  document.getElementById('stat-total').textContent = appState.stats.total_all_time;
  document.getElementById('info-fullname').value = appState.user.full_name;
  document.getElementById('info-email').value = appState.user.email;
  document.getElementById('info-phone').value = appState.user.phone;
  document.getElementById('info-username').value = appState.user.username;
}

function renderCheckinTab() {
  if (!appState.checkin) return;
  applyCheckinStatus(appState.checkin.status, appState.checkin.check_time);
  renderHistory(true); // recent only
}

function renderHistory(recentOnly) {
  if (!appState.history) return;
  const listEl = document.getElementById(recentOnly ? 'checkin-recent-list' : 'history-list');
  if (!listEl) return;

  if (appState.history.length === 0) {
    listEl.innerHTML = `<li class="empty-state">
      <div class="ico">📅</div>
      <div>Chưa có check-in nào</div>
    </li>`;
    return;
  }

  const slice = recentOnly ? appState.history.slice(0, 5) : appState.history;
  listEl.innerHTML = slice.map(item => `
    <li class="history-item">
      <div>
        <div class="history-date">${formatDateVi(item.check_date)}</div>
        <div class="history-date-sub">${item.check_date}</div>
      </div>
      <div class="history-time">⏰ ${item.check_time.slice(0,5)}</div>
    </li>
  `).join('');
}

function renderAll() {
  renderHome();
  renderCheckinTab();
  renderHistory(false);
}

// ============ SKELETON / LOADING UI ============
function showSkeleton() {
  // Hiển thị placeholder khi chưa có data
  const skel = '<span class="skeleton" style="display:inline-block;width:30px;height:24px;background:#ecf0f1;border-radius:4px;"></span>';
  ['stat-checked', 'stat-missed', 'stat-total'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.textContent === '0') el.innerHTML = skel;
  });
  document.getElementById('home-fullname').innerHTML = skel;
}

// ============ CHECK-IN BUTTON & CLOCK ============
function updateClock() {
  const now = new Date();
  document.getElementById('checkin-clock').textContent =
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  document.getElementById('checkin-date').textContent =
    formatDateVi(`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`);
}
setInterval(updateClock, 1000);
updateClock();

function applyCheckinStatus(status, checkTime) {
  const btn = document.getElementById('checkin-btn');
  const icon = document.getElementById('checkin-icon');
  const label = document.getElementById('checkin-label');
  const msg = document.getElementById('checkin-msg');
  btn.classList.remove('active', 'done', 'missed', 'disabled');

  if (status === 'active') {
    btn.classList.add('active');
    btn.disabled = false;
    icon.textContent = '🌅';
    label.textContent = 'CHECK-IN';
    msg.textContent = 'Đang trong giờ vàng - hãy check-in ngay!';
  } else if (status === 'done') {
    btn.classList.add('done');
    btn.disabled = true;
    icon.textContent = '✓';
    label.textContent = 'ĐÃ CHECK-IN';
    msg.textContent = checkTime
      ? `Bạn đã check-in lúc ${checkTime.slice(0,5)} hôm nay. Chúc một ngày tuyệt vời!`
      : 'Đã check-in hôm nay';
  } else if (status === 'missed') {
    btn.classList.add('missed');
    btn.disabled = true;
    icon.textContent = '⏱';
    label.textContent = 'QUÊN CHECK-IN';
    msg.textContent = 'Đã quá 6:00 sáng. Hẹn gặp lại bạn vào ngày mai!';
  } else {
    btn.classList.add('disabled');
    btn.disabled = true;
    icon.textContent = '⏰';
    label.textContent = 'NGOÀI GIỜ';
    msg.textContent = 'Check-in chỉ hoạt động từ 5:00 - 6:00 sáng';
  }
}

document.getElementById('checkin-btn').addEventListener('click', async () => {
  if (!appState.checkin || appState.checkin.status !== 'active') return;
  const btn = document.getElementById('checkin-btn');
  btn.disabled = true;
  const r = await api('POST', '/api/checkin/check-in');
  if (r && r.ok) {
    // Update state ngay - không cần gọi lại dashboard
    appState.checkin = { status: 'done', check_time: r.data.check_time };
    appState.history.unshift({ check_date: r.data.check_date, check_time: r.data.check_time });
    appState.stats.checked_this_month++;
    appState.stats.total_all_time++;
    saveCache();
    renderAll();
  } else {
    alert(r?.data?.error || 'Check-in thất bại');
    btn.disabled = false;
  }
});

// ============ BOOTSTRAP - tải data 1 lần ============
function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ...appState,
      fetched_at: Date.now()
    }));
  } catch (e) {}
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    Object.assign(appState, parsed);
    return true;
  } catch (e) { return false; }
}

// Tránh nhiều request fetch đồng thời (debounce)
let inFlightFetch = null;
async function fetchDashboard(silent = false) {
  // Nếu đang có request đang chạy thì dùng chung
  if (inFlightFetch) return inFlightFetch;

  // Bỏ qua nếu data mới fetch quá gần đây
  if (silent && appState.fetched_at && (Date.now() - appState.fetched_at < MIN_REFRESH_AGE_MS)) {
    return true;
  }

  inFlightFetch = (async () => {
    try {
      const r = await api('GET', '/api/checkin/dashboard');
      if (!r || !r.ok) {
        if (!silent) console.warn('Không tải được dashboard', r);
        return false;
      }
      Object.assign(appState, r.data, { fetched_at: Date.now() });
      saveCache();
      renderAll();
      return true;
    } finally {
      inFlightFetch = null;
    }
  })();
  return inFlightFetch;
}

async function bootstrap() {
  // 1. Render từ cache localStorage NGAY (nếu có) → feel instant
  const hadCache = loadCache();
  if (hadCache) {
    renderAll();
  } else {
    showSkeleton();
  }

  // 2. Fetch fresh data (background nếu đã có cache)
  await fetchDashboard(hadCache);
}

// Auto refresh background với JITTER (60-90s random)
// → 100 user refresh dải trên 30s thay vì spike đồng loạt
function scheduleNextRefresh() {
  const delay = CACHE_TTL_MS + Math.random() * REFRESH_JITTER_MS;
  setTimeout(async () => {
    if (document.visibilityState === 'visible') {
      await fetchDashboard(true);
    }
    scheduleNextRefresh();
  }, delay);
}
scheduleNextRefresh();

// Refresh khi user quay lại tab (chỉ nếu cache cũ > 30s)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const age = Date.now() - (appState.fetched_at || 0);
    if (age > 30_000) fetchDashboard(true);
  }
});

// ============ SETTINGS - PROFILE ============
async function loadProfileForm() {
  // Đầu tiên fill từ state (instant)
  const form = document.getElementById('profile-form');
  if (appState.user) {
    form.full_name.value = appState.user.full_name;
    form.email.value = appState.user.email;
  }
  // Sau đó refresh từ /me (background) - đảm bảo data mới nhất
  const r = await api('GET', '/api/settings/me');
  if (r && r.ok) {
    form.full_name.value = r.data.user.full_name;
    form.email.value = r.data.user.email;
  }
}

document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  form.querySelectorAll('input').forEach(i => showFieldError(i, null));

  const data = {
    full_name: form.full_name.value.trim(),
    email: form.email.value.trim().toLowerCase()
  };

  const r = await api('PUT', '/api/settings/profile', data);
  if (r && r.ok) {
    showMsg('profile-msg', 'success', '✓ Cập nhật thành công');
    // Update state + cache
    if (appState.user) {
      appState.user.full_name = data.full_name;
      appState.user.email = data.email;
      saveCache();
    }
    cachedUser.full_name = data.full_name;
    cachedUser.email = data.email;
    localStorage.setItem('user', JSON.stringify(cachedUser));
    document.getElementById('topbar-username').textContent = data.full_name;
    renderHome();
  } else {
    if (r?.data?.fields) {
      Object.entries(r.data.fields).forEach(([k, v]) => {
        if (form[k]) showFieldError(form[k], v);
      });
    }
    showMsg('profile-msg', 'error', r?.data?.error || 'Cập nhật thất bại');
  }
});

// ============ SETTINGS - PASSWORD ============
document.getElementById('btn-request-code').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  btn.textContent = 'Đang gửi...';
  const r = await api('POST', '/api/settings/password/request-code');
  if (r && r.ok) {
    document.getElementById('password-form').style.display = 'block';
    showMsg('password-msg', 'success', '✓ ' + r.data.message + (r.data.dev_mode ? ' (DEV mode - xem console server)' : ''));
    btn.textContent = 'Gửi lại mã';
  } else {
    showMsg('password-msg', 'error', r?.data?.error || 'Không gửi được mã');
    btn.textContent = 'Gửi mã xác nhận đến email';
  }
  btn.disabled = false;
});

document.querySelectorAll('.toggle-pwd').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = btn.previousElementSibling;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
});

document.getElementById('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  form.querySelectorAll('input').forEach(i => showFieldError(i, null));

  const data = {
    code: form.code.value.trim(),
    new_password: form.new_password.value,
    confirm_password: form.confirm_password.value
  };

  if (!data.code) return showFieldError(form.code, 'Vui lòng nhập mã');
  if (data.new_password.length < 8) return showFieldError(form.new_password, 'Tối thiểu 8 ký tự');
  if (data.new_password !== data.confirm_password) {
    return showFieldError(form.confirm_password, 'Mật khẩu nhập lại không khớp');
  }

  const r = await api('POST', '/api/settings/password/change', data);
  if (r && r.ok) {
    showMsg('password-msg', 'success', '✓ Đổi mật khẩu thành công!');
    form.reset();
    document.getElementById('password-form').style.display = 'none';
    document.getElementById('btn-request-code').textContent = 'Gửi mã xác nhận đến email';
  } else {
    if (r?.data?.fields) {
      Object.entries(r.data.fields).forEach(([k, v]) => {
        if (form[k]) showFieldError(form[k], v);
      });
    }
    showMsg('password-msg', 'error', r?.data?.error || 'Đổi mật khẩu thất bại');
  }
});

// ============ PAYMENT TAB ============
let paymentTabInitialized = false;
let paymentImageBase64 = null;
let paymentImageMime = null;
let paymentOcrText = '';
let paymentIsReceipt = false;
let tesseractPromise = null;

// Lazy load Tesseract.js từ CDN (~2MB), chỉ tải khi user click tab Thanh toán
function loadTesseract() {
  if (tesseractPromise) return tesseractPromise;
  tesseractPromise = new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error('Không tải được Tesseract.js'));
    document.head.appendChild(s);
  });
  return tesseractPromise;
}

// Resize ảnh xuống max width 1200px, JPEG quality 0.85
async function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1200;
        const ratio = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({ dataUrl, mime: 'image/jpeg', width: w, height: h });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Keyword detect (giống logic server)
const RECEIPT_KEYWORDS = [
  'VIETCOMBANK','VCB','TECHCOMBANK','TCB','VIETINBANK','VTB','CTG','BIDV',
  'AGRIBANK','VBA','MB BANK','MBBANK','MILITARY BANK','ACB','A CHAU',
  'VPBANK','VP BANK','SACOMBANK','STB','TPBANK','TP BANK','HDBANK','HD BANK',
  'EXIMBANK','SHB','OCB','MSB','MARITIME BANK','NCB','SEABANK','PVCOMBANK',
  'MOMO','MO MO','ZALOPAY','ZALO PAY','VNPAY','VN PAY','SHOPEEPAY','SHOPEE PAY',
  'VIETTELPAY','VIETTEL MONEY',
  'CHUYEN KHOAN','CHUYỂN KHOẢN','CHUYEN TIEN','CHUYỂN TIỀN',
  'GIAO DICH','GIAO DỊCH','TRANSACTION','TRANSFER',
  'BIEN LAI','BIÊN LAI','HOA DON','HÓA ĐƠN',
  'THANH TOAN','THANH TOÁN','SO TIEN','SỐ TIỀN',
  'NOI DUNG','NỘI DUNG','NGUOI NHAN','NGƯỜI NHẬN','NGUOI GUI','NGƯỜI GỬI',
  'STK','TAI KHOAN','TÀI KHOẢN','THANH CONG','THÀNH CÔNG',
  'SUCCESS','SUCCESSFUL','VND','DONG','ĐỒNG'
];
function analyzeText(text) {
  if (!text) return { is_receipt: false, matched: [] };
  const up = text.toUpperCase();
  const matched = RECEIPT_KEYWORDS.filter(k => up.includes(k));
  return { is_receipt: matched.length >= 2, matched };
}

function setOcrStatus(type, message) {
  const el = document.getElementById('payment-ocr-status');
  if (!el) return;
  if (!message) { el.innerHTML = ''; return; }
  const cls = type === 'processing' ? 'ocr-status processing'
            : type === 'success'    ? 'ocr-status success'
            :                          'ocr-status warning';
  const ico = type === 'processing' ? '<span class="spinner"></span>'
            : type === 'success'    ? '✓'
            :                          '⚠';
  el.innerHTML = `<div class="${cls}">${ico}<span>${message}</span></div>`;
}

async function processPaymentImage(file) {
  if (!file) return;
  setOcrStatus('processing', 'Đang xử lý ảnh...');
  document.getElementById('payment-submit').disabled = true;

  // Resize trước
  let resized;
  try {
    resized = await resizeImage(file);
  } catch (e) {
    setOcrStatus('warning', 'Không đọc được file ảnh');
    return;
  }
  paymentImageBase64 = resized.dataUrl;
  paymentImageMime = resized.mime;
  document.getElementById('payment-preview').src = resized.dataUrl;
  document.getElementById('payment-preview-wrap').style.display = 'block';
  document.getElementById('payment-drop').style.display = 'none';

  // OCR
  setOcrStatus('processing', 'Đang tải bộ nhận diện ký tự (lần đầu mất ~10s)...');
  let Tesseract;
  try {
    Tesseract = await loadTesseract();
  } catch (e) {
    setOcrStatus('warning', 'Không tải được công cụ OCR. Bạn vẫn có thể gửi - hệ thống sẽ xác minh thủ công.');
    paymentOcrText = '';
    paymentIsReceipt = false;
    document.getElementById('payment-submit').disabled = false;
    return;
  }

  setOcrStatus('processing', 'Đang đọc nội dung ảnh...');
  try {
    const result = await Tesseract.recognize(resized.dataUrl, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          setOcrStatus('processing', `Đang đọc nội dung ảnh... ${Math.round(m.progress * 100)}%`);
        }
      }
    });
    paymentOcrText = result.data.text || '';
    const analysis = analyzeText(paymentOcrText);
    paymentIsReceipt = analysis.is_receipt;

    if (analysis.is_receipt) {
      const banks = analysis.matched
        .filter(k => !['VND','DONG','ĐỒNG','STK','SUCCESS','SUCCESSFUL','THANH CONG','THÀNH CÔNG'].includes(k))
        .slice(0, 3);
      setOcrStatus('success', `Đã xác nhận là biên lai chuyển khoản${banks.length ? ' (' + banks.join(', ') + ')' : ''}`);
    } else {
      setOcrStatus('warning', 'Ảnh này có vẻ KHÔNG phải biên lai chuyển khoản ngân hàng/Momo. Bạn vẫn có thể gửi nhưng sẽ chờ xác minh thủ công.');
    }
    document.getElementById('payment-submit').disabled = false;
  } catch (e) {
    console.error('OCR error', e);
    setOcrStatus('warning', 'Không xử lý được ảnh. Bạn vẫn có thể gửi để xác minh thủ công.');
    paymentOcrText = '';
    paymentIsReceipt = false;
    document.getElementById('payment-submit').disabled = false;
  }
}

function clearPaymentImage() {
  paymentImageBase64 = null;
  paymentImageMime = null;
  paymentOcrText = '';
  paymentIsReceipt = false;
  document.getElementById('payment-image').value = '';
  document.getElementById('payment-preview').src = '';
  document.getElementById('payment-preview-wrap').style.display = 'none';
  document.getElementById('payment-drop').style.display = 'block';
  document.getElementById('payment-submit').disabled = true;
  setOcrStatus(null);
}

async function loadPaymentHistory() {
  const r = await api('GET', '/api/payment/history');
  const listEl = document.getElementById('payment-history-list');
  if (!r || !r.ok || !listEl) return;
  const items = r.data.history || [];
  if (items.length === 0) {
    listEl.innerHTML = `<li class="empty-state"><div class="ico">💳</div><div>Chưa có thanh toán nào</div></li>`;
    return;
  }
  listEl.innerHTML = items.map(item => {
    let statusBadge;
    if (item.status === 'confirmed') statusBadge = '<span class="badge confirmed">✓ Đã xác nhận</span>';
    else if (item.status === 'rejected') statusBadge = '<span class="badge rejected">✗ Bị từ chối</span>';
    else statusBadge = '<span class="badge pending">⏳ Chờ xác nhận</span>';
    const sentBadge = item.email_sent ? '<span class="badge sent">📧 Đã gửi mail</span>' : '';
    const date = new Date(item.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const noteHtml = item.admin_note
      ? `<div class="history-date-sub" style="margin-top:4px;font-style:italic;">💬 Admin: ${escapeText(item.admin_note)}</div>`
      : '';
    return `<li class="history-item">
      <div style="width:100%;">
        <div class="history-date">#${item.id} - ${escapeText(item.full_name)} ${statusBadge}${sentBadge}</div>
        <div class="history-date-sub">${date} • ${escapeText(item.email)} • ${escapeText(item.phone)}</div>
        ${item.detected_banks ? `<div class="history-date-sub">Phát hiện: ${escapeText(item.detected_banks)}</div>` : ''}
        ${noteHtml}
      </div>
    </li>`;
  }).join('');
}

function initPaymentTab() {
  if (paymentTabInitialized) {
    loadPaymentHistory();
    return;
  }
  paymentTabInitialized = true;

  const form = document.getElementById('payment-form');

  // Auto-fill từ appState
  if (appState.user) {
    form.full_name.value = appState.user.full_name || '';
    form.phone.value = appState.user.phone || '';
    form.email.value = appState.user.email || '';
  }

  // Phone: chỉ cho nhập số
  form.phone.addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
  });

  // File picker
  document.getElementById('payment-image').addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) processPaymentImage(e.target.files[0]);
  });

  // Drag & drop
  const drop = document.getElementById('payment-drop');
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation();
    drop.classList.add('dragover');
  }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation();
    drop.classList.remove('dragover');
  }));
  drop.addEventListener('drop', e => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) processPaymentImage(f);
  });

  // Clear
  document.getElementById('payment-clear').addEventListener('click', clearPaymentImage);

  // Submit
  form.addEventListener('submit', async e => {
    e.preventDefault();
    form.querySelectorAll('input').forEach(i => showFieldError(i, null));

    const data = {
      full_name: form.full_name.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim().toLowerCase(),
      image_data: paymentImageBase64,
      image_mime: paymentImageMime,
      ocr_text: paymentOcrText
    };

    if (!data.image_data) {
      showMsg('payment-msg', 'error', 'Vui lòng đính kèm ảnh biên lai');
      return;
    }

    // Cảnh báo nếu OCR không phát hiện biên lai
    if (paymentOcrText && !paymentIsReceipt) {
      if (!confirm('Hệ thống chưa xác minh được đây là biên lai chuyển khoản. Bạn có chắc muốn gửi?')) {
        return;
      }
    }

    const btn = document.getElementById('payment-submit');
    btn.disabled = true;
    btn.textContent = 'Đang gửi...';
    showMsg('payment-msg', 'info', 'Đang gửi biên lai và email xác nhận...');

    const r = await api('POST', '/api/payment/submit', data);

    if (r && r.ok) {
      const msg = r.data.email_sent
        ? `✓ Đã gửi thành công! Email xác nhận đã được gửi đến ${data.email}.`
        : r.data.email_dev_mode
          ? '✓ Đã ghi nhận. Email DEV mode (xem console server).'
          : `✓ Đã ghi nhận biên lai. ⚠ Không gửi được email (${r.data.email_error || 'Lỗi SMTP'}).`;
      showMsg('payment-msg', 'success', msg);
      // Reset form
      clearPaymentImage();
      loadPaymentHistory();
    } else {
      if (r?.data?.fields) {
        Object.entries(r.data.fields).forEach(([k, v]) => {
          if (form[k]) showFieldError(form[k], v);
        });
      }
      showMsg('payment-msg', 'error', r?.data?.error || 'Gửi thất bại');
    }
    btn.disabled = !paymentImageBase64;
    btn.textContent = 'Gửi biên lai';
  });

  // Load history
  loadPaymentHistory();
}

// ============ ADMIN TAB ============
let adminTabInitialized = false;
let adminFilter = 'pending';
let adminSearch = '';
let adminPage = 0;
const ADMIN_PAGE_SIZE = 20;

function escapeText(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

async function loadAdminPayments() {
  const listEl = document.getElementById('admin-payments-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="empty-state"><div class="ico">⏳</div><div>Đang tải...</div></div>';

  const offset = adminPage * ADMIN_PAGE_SIZE;
  const qs = `status=${adminFilter}&search=${encodeURIComponent(adminSearch)}&limit=${ADMIN_PAGE_SIZE}&offset=${offset}`;
  const r = await api('GET', `/api/admin/payments?${qs}`);
  if (!r || !r.ok) {
    listEl.innerHTML = `<div class="empty-state"><div class="ico">⚠</div><div>${r?.data?.error || 'Không tải được'}</div></div>`;
    return;
  }

  const counts = r.data.counts || {};
  document.getElementById('cnt-pending').textContent = counts.pending || 0;
  document.getElementById('cnt-confirmed').textContent = counts.confirmed || 0;
  document.getElementById('cnt-rejected').textContent = counts.rejected || 0;

  const items = r.data.payments || [];
  if (items.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><div class="ico">📋</div><div>${adminSearch ? 'Không tìm thấy kết quả' : 'Không có thanh toán nào'}</div></div>`;
    renderPagination('admin-pagination', r.data.total || 0, adminPage, ADMIN_PAGE_SIZE, p => { adminPage = p; loadAdminPayments(); });
    return;
  }

  listEl.innerHTML = items.map(p => {
    const date = new Date(p.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const isPending = p.status === 'pending';
    let statusBadge;
    if (p.status === 'confirmed') statusBadge = '<span class="badge confirmed">✓ Đã xác nhận</span>';
    else if (p.status === 'rejected') statusBadge = '<span class="badge rejected">✗ Từ chối</span>';
    else statusBadge = '<span class="badge pending">⏳ Chờ xác nhận</span>';
    const verifiedBadge = p.is_receipt ? '<span class="badge sent">🤖 OCR pass</span>' : '';
    // Badge email lỗi + nút gửi lại (cho payment đã xử lý mà email chưa gửi được)
    const emailFailBadge = (!isPending && p.email_sent === false)
      ? '<span class="badge rejected">📧 Email lỗi</span>' : '';
    const confirmedInfo = p.confirmed_at
      ? `<div class="adm-pay-sub">✓ ${new Date(p.confirmed_at).toLocaleString('vi-VN', {timeZone:'Asia/Ho_Chi_Minh'})} bởi ${escapeText(p.confirmed_by_username || 'admin')}</div>`
      : '';
    const noteInfo = p.admin_note ? `<div class="adm-pay-sub" style="font-style:italic;">💬 ${escapeText(p.admin_note)}</div>` : '';

    return `
      <div class="adm-pay-item" data-payment-id="${p.id}">
        <div class="adm-pay-info">
          <div class="adm-pay-name">
            #${p.id} - ${escapeText(p.full_name)} ${statusBadge} ${verifiedBadge} ${emailFailBadge}
          </div>
          <div class="adm-pay-sub">👤 User: ${escapeText(p.username)} (${escapeText(p.user_full_name)})</div>
          <div class="adm-pay-sub">📞 ${escapeText(p.phone)} • 📧 ${escapeText(p.email)}</div>
          <div class="adm-pay-sub">🕐 ${date}${p.detected_banks ? ` • 🏦 ${escapeText(p.detected_banks)}` : ''}</div>
          ${confirmedInfo}
          ${noteInfo}
        </div>
        <div class="adm-pay-actions">
          ${isPending ? `
            <button class="btn-confirm" data-action="confirm" data-id="${p.id}" data-name="${escapeText(p.full_name)}">✓ Xác nhận</button>
            <button class="btn-reject" data-action="reject" data-id="${p.id}" data-name="${escapeText(p.full_name)}">✗ Từ chối</button>
          ` : ''}
          ${(!isPending && p.email_sent === false) ? `
            <button class="btn-reject" data-action="resend" data-id="${p.id}">📧 Gửi lại email</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Bind confirm/reject buttons
  listEl.querySelectorAll('button[data-action="confirm"], button[data-action="reject"]').forEach(btn => {
    btn.addEventListener('click', () => openAdminModal(btn.dataset.action, btn.dataset.id, btn.dataset.name));
  });
  // Bind resend buttons
  listEl.querySelectorAll('button[data-action="resend"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'Đang gửi...';
      const rr = await api('POST', `/api/admin/payments/${btn.dataset.id}/resend-email`);
      if (rr && rr.ok && rr.data.email_sent) {
        showToast('success', 'Gửi lại email', 'Email đã gửi thành công');
        loadAdminPayments();
      } else {
        showToast('error', 'Gửi email thất bại', rr?.data?.email_error || 'Lỗi SMTP');
        btn.disabled = false; btn.textContent = '📧 Gửi lại email';
      }
    });
  });

  renderPagination('admin-pagination', r.data.total || 0, adminPage, ADMIN_PAGE_SIZE, p => { adminPage = p; loadAdminPayments(); });
}

// Pagination generic: container, total, currentPage(0-based), pageSize, onGo(page)
function renderPagination(containerId, total, page, pageSize, onGo) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <button class="page-btn" ${page <= 0 ? 'disabled' : ''} data-go="${page - 1}">← Trước</button>
    <span style="font-size:13px;color:#7f8c8d;">Trang ${page + 1}/${totalPages} • ${total} bản ghi</span>
    <button class="page-btn" ${page >= totalPages - 1 ? 'disabled' : ''} data-go="${page + 1}">Sau →</button>
  `;
  el.querySelectorAll('button[data-go]').forEach(b => {
    b.addEventListener('click', () => { if (!b.disabled) onGo(parseInt(b.dataset.go, 10)); });
  });
}

function openAdminModal(action, paymentId, name) {
  const modal = document.getElementById('admin-modal');
  const title = document.getElementById('admin-modal-title');
  const desc = document.getElementById('admin-modal-desc');
  const note = document.getElementById('admin-modal-note');
  const confirmBtn = document.getElementById('admin-modal-confirm');
  const msg = document.getElementById('admin-modal-msg');

  msg.className = 'message';
  note.value = '';
  modal.dataset.action = action;
  modal.dataset.paymentId = paymentId;

  if (action === 'confirm') {
    title.textContent = `✓ Xác nhận thanh toán #${paymentId}`;
    desc.textContent = `Email xác nhận sẽ được gửi đến user "${name}".`;
    confirmBtn.textContent = 'Xác nhận';
    confirmBtn.className = 'btn-primary';
    note.placeholder = 'Vd: Đã đối chiếu với sao kê NH. Cảm ơn bạn!';
  } else {
    title.textContent = `✗ Từ chối thanh toán #${paymentId}`;
    desc.textContent = `User "${name}" sẽ nhận email với lý do từ chối.`;
    confirmBtn.textContent = 'Từ chối';
    confirmBtn.className = 'btn-primary';
    note.placeholder = 'Vd: Số tiền không khớp / Biên lai mờ / Chưa nhận được tiền';
  }

  modal.classList.add('show');
}

async function submitAdminAction() {
  const modal = document.getElementById('admin-modal');
  const action = modal.dataset.action;
  const paymentId = modal.dataset.paymentId;
  const note = document.getElementById('admin-modal-note').value.trim();
  const confirmBtn = document.getElementById('admin-modal-confirm');
  const msgEl = document.getElementById('admin-modal-msg');

  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Đang xử lý...';
  msgEl.className = 'message';

  const r = await api('POST', `/api/admin/payments/${paymentId}/${action}`, { note });
  if (r && r.ok) {
    const sentMsg = r.data.email_sent
      ? '✓ Email đã gửi thành công đến user'
      : '⚠ Đã cập nhật nhưng KHÔNG gửi được email: ' + (r.data.email_error || '');
    msgEl.className = 'message show success';
    msgEl.textContent = sentMsg;
    setTimeout(() => {
      modal.classList.remove('show');
      loadAdminPayments();
    }, 1500);
  } else {
    msgEl.className = 'message show error';
    msgEl.textContent = r?.data?.error || 'Lỗi không xác định';
  }
  confirmBtn.disabled = false;
  confirmBtn.textContent = action === 'confirm' ? 'Xác nhận' : 'Từ chối';
}

// ===== USER MANAGEMENT =====
let usersSearch = '';
let usersPage = 0;
const USERS_PAGE_SIZE = 20;

async function loadAdminUsers() {
  const listEl = document.getElementById('admin-users-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="empty-state"><div class="ico">⏳</div><div>Đang tải...</div></div>';

  const offset = usersPage * USERS_PAGE_SIZE;
  const qs = `search=${encodeURIComponent(usersSearch)}&limit=${USERS_PAGE_SIZE}&offset=${offset}`;
  const r = await api('GET', `/api/admin/users?${qs}`);
  if (!r || !r.ok) {
    listEl.innerHTML = `<div class="empty-state"><div class="ico">⚠</div><div>${r?.data?.error || 'Lỗi'}</div></div>`;
    return;
  }
  const users = r.data.users || [];
  if (users.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><div class="ico">👥</div><div>${usersSearch ? 'Không tìm thấy' : 'Chưa có user'}</div></div>`;
    renderPagination('users-pagination', r.data.total || 0, usersPage, USERS_PAGE_SIZE, p => { usersPage = p; loadAdminUsers(); });
    return;
  }
  listEl.innerHTML = users.map(u => {
    const created = new Date(u.created_at).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const rolePill = u.role === 'admin'
      ? '<span class="role-pill admin">ADMIN</span>'
      : '<span class="role-pill user">USER</span>';
    const isSelf = u.id === cachedUser.id;
    return `
      <div class="user-row">
        <div class="user-row-info">
          <div class="user-row-name">${escapeText(u.full_name)} ${rolePill} ${isSelf ? '<span style="font-size:11px;color:#e17055;">(bạn)</span>' : ''}</div>
          <div class="user-row-sub">@${escapeText(u.username)} • 📞 ${escapeText(u.phone)} • 📧 ${escapeText(u.email)}</div>
          <div class="user-row-sub">📅 Tham gia ${created} • ✓ ${u.total_checkins} check-in${u.last_checkin ? ` • Gần nhất: ${u.last_checkin}` : ''}</div>
        </div>
        <div class="user-row-actions">
          <button class="btn-secondary" data-uaction="view" data-id="${u.id}">👁 Xem</button>
          ${!isSelf ? (u.role === 'admin'
            ? `<button class="btn-secondary" data-uaction="demote" data-id="${u.id}" data-name="${escapeText(u.full_name)}">⬇ Gỡ admin</button>`
            : `<button class="btn-secondary" data-uaction="promote" data-id="${u.id}" data-name="${escapeText(u.full_name)}">⬆ Cấp admin</button>`) : ''}
          ${!isSelf ? `<button class="btn-reject" data-uaction="delete" data-id="${u.id}" data-name="${escapeText(u.full_name)}">🗑 Xóa</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('button[data-uaction]').forEach(btn => {
    btn.addEventListener('click', () => handleUserAction(btn.dataset.uaction, btn.dataset.id, btn.dataset.name));
  });
  renderPagination('users-pagination', r.data.total || 0, usersPage, USERS_PAGE_SIZE, p => { usersPage = p; loadAdminUsers(); });
}

async function handleUserAction(action, userId, name) {
  if (action === 'view') {
    const r = await api('GET', `/api/admin/users/${userId}/checkins`);
    if (!r || !r.ok) return showToast('error', 'Lỗi', r?.data?.error || '');
    const u = r.data.user;
    const checks = r.data.checkins || [];
    const list = checks.length
      ? checks.map(c => `${c.check_date} (${c.check_time.slice(0,5)})`).join('<br>')
      : 'Chưa có check-in nào';
    openInfoModal(`Check-in của ${escapeText(u.full_name)}`,
      `<div style="font-size:13px;color:#7f8c8d;margin-bottom:10px;">@${escapeText(u.username)} • ${escapeText(u.phone)} • Tổng ${checks.length} check-in</div>
       <div style="max-height:300px;overflow-y:auto;font-size:13px;line-height:1.8;">${list}</div>`);
    return;
  }
  if (action === 'promote' || action === 'demote') {
    const role = action === 'promote' ? 'admin' : 'user';
    if (!confirm(`${action === 'promote' ? 'Cấp quyền admin cho' : 'Gỡ quyền admin của'} "${name}"?`)) return;
    const r = await api('POST', `/api/admin/users/${userId}/role`, { role });
    if (r && r.ok) { showToast('success', 'Đổi quyền', r.data.message); loadAdminUsers(); }
    else showToast('error', 'Lỗi', r?.data?.error || '');
    return;
  }
  if (action === 'delete') {
    if (!confirm(`Xóa user "${name}"? Toàn bộ check-in/thanh toán của họ sẽ ẩn khỏi báo cáo.`)) return;
    const r = await api('DELETE', `/api/admin/users/${userId}`);
    if (r && r.ok) { showToast('success', 'Đã xóa', r.data.message); loadAdminUsers(); }
    else showToast('error', 'Lỗi', r?.data?.error || '');
    return;
  }
}

// ===== AUDIT LOG =====
async function loadAuditLog() {
  const listEl = document.getElementById('admin-audit-list');
  if (!listEl) return;
  const r = await api('GET', '/api/admin/audit-log');
  if (!r || !r.ok) { listEl.innerHTML = '<li class="empty-state"><div>Lỗi tải nhật ký</div></li>'; return; }
  const logs = r.data.logs || [];
  if (logs.length === 0) { listEl.innerHTML = '<li class="empty-state"><div class="ico">📜</div><div>Chưa có hoạt động</div></li>'; return; }
  const actionLabel = {
    confirm_payment: '✓ Xác nhận TT', reject_payment: '✗ Từ chối TT',
    resend_email: '📧 Gửi lại email', change_role: '🔑 Đổi quyền', delete_user: '🗑 Xóa user'
  };
  listEl.innerHTML = logs.map(l => {
    const t = new Date(l.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    return `<li class="history-item">
      <div>
        <div class="history-date">${actionLabel[l.action] || escapeText(l.action)} • ${escapeText(l.target || '')}</div>
        <div class="history-date-sub">${escapeText(l.admin_name)} • ${t}${l.note ? ' • ' + escapeText(l.note) : ''}</div>
      </div>
    </li>`;
  }).join('');
}

// Info modal đơn giản (tái dùng admin-modal markup không tiện → tạo modal động)
function openInfoModal(title, bodyHtml) {
  let modal = document.getElementById('info-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'info-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `<div class="modal"><div class="modal-title" id="info-modal-title"></div>
      <div id="info-modal-body" style="margin:12px 0;"></div>
      <div class="modal-actions"><button class="btn-primary" id="info-modal-close">Đóng</button></div></div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target.id === 'info-modal') modal.classList.remove('show'); });
    modal.querySelector('#info-modal-close').addEventListener('click', () => modal.classList.remove('show'));
  }
  modal.querySelector('#info-modal-title').textContent = title;
  modal.querySelector('#info-modal-body').innerHTML = bodyHtml;
  modal.classList.add('show');
}

function initAdminTab() {
  if (cachedUser.role !== 'admin') {
    document.getElementById('admin-payments-list').innerHTML =
      '<div class="empty-state"><div class="ico">🚫</div><div>Bạn không có quyền truy cập trang này</div></div>';
    return;
  }
  if (adminTabInitialized) {
    loadAdminPayments();
    return;
  }
  adminTabInitialized = true;

  // Sub-tab switching
  document.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.subtab;
      document.querySelectorAll('.subtab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.subtab-panel').forEach(p => p.classList.toggle('active', p.id === `subtab-${target}`));
      if (target === 'users') loadAdminUsers();
      if (target === 'audit') loadAuditLog();
      if (target === 'payments') loadAdminPayments();
    });
  });

  // Payment filter buttons
  document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      adminFilter = btn.dataset.filter;
      adminPage = 0;
      loadAdminPayments();
    });
  });

  // Payment search (debounce)
  let searchTimer = null;
  document.getElementById('admin-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { adminSearch = e.target.value.trim(); adminPage = 0; loadAdminPayments(); }, 400);
  });
  document.getElementById('admin-refresh').addEventListener('click', () => { adminPage = 0; loadAdminPayments(); });

  // Users search
  let usersTimer = null;
  document.getElementById('users-search').addEventListener('input', e => {
    clearTimeout(usersTimer);
    usersTimer = setTimeout(() => { usersSearch = e.target.value.trim(); usersPage = 0; loadAdminUsers(); }, 400);
  });
  document.getElementById('users-refresh').addEventListener('click', () => { usersPage = 0; loadAdminUsers(); });

  // Modal confirm/reject
  document.getElementById('admin-modal-cancel').addEventListener('click', () => {
    document.getElementById('admin-modal').classList.remove('show');
  });
  document.getElementById('admin-modal-confirm').addEventListener('click', submitAdminAction);
  document.getElementById('admin-modal').addEventListener('click', e => {
    if (e.target.id === 'admin-modal') document.getElementById('admin-modal').classList.remove('show');
  });

  loadAdminPayments();
}

// ============ REPORTS TAB (admin only) ============
let reportsTabInitialized = false;
let lastDailyReport = null;
let lastDetailedReport = null;

// Lazy load SheetJS từ CDN khi cần
let sheetJSPromise = null;
function loadSheetJS() {
  if (sheetJSPromise) return sheetJSPromise;
  sheetJSPromise = new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Không tải được SheetJS'));
    document.head.appendChild(s);
  });
  return sheetJSPromise;
}

async function exportToExcel(rows, sheetName, fileName, headers) {
  if (!rows || !rows.length) {
    alert('Không có dữ liệu để xuất');
    return;
  }
  try {
    const XLSX = await loadSheetJS();
    // Tạo array of arrays với header tiếng Việt
    const aoa = [headers.map(h => h.label)];
    rows.forEach((r, i) => {
      const row = [i + 1];
      headers.slice(1).forEach(h => {
        row.push(typeof h.value === 'function' ? h.value(r) : r[h.key]);
      });
      aoa.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Auto width cho từng cột
    ws['!cols'] = headers.map(h => ({ wch: h.width || 15 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, fileName);
  } catch (err) {
    console.error(err);
    alert('Lỗi xuất Excel: ' + err.message);
  }
}

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

async function loadReportOverview() {
  const r = await api('GET', '/api/admin/reports/overview');
  if (!r || !r.ok) return;
  document.getElementById('rep-total-users').textContent = r.data.total_users;
  document.getElementById('rep-checked-today').textContent = r.data.checked_in_today;
  document.getElementById('rep-not-checked-today').textContent = r.data.not_checked_today;
  document.getElementById('rep-total-checkins').textContent = r.data.total_checkins_all_time;
}

async function loadReportDaily(date) {
  const tbody = document.querySelector('#rep-daily-table tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#95a5a6;">Đang tải...</td></tr>';
  const r = await api('GET', `/api/admin/reports/daily?date=${date}`);
  if (!r || !r.ok) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;color:#e74c3c;">${r?.data?.error || 'Lỗi'}</td></tr>`;
    return;
  }
  lastDailyReport = r.data;
  document.getElementById('rep-daily-summary').textContent =
    `Ngày ${r.data.date} • ${r.data.total} user • ✓ ${r.data.checked} đã check-in • ✗ ${r.data.not_checked} chưa`;

  if (r.data.rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#95a5a6;">Không có user nào</td></tr>';
    return;
  }
  tbody.innerHTML = r.data.rows.map((row, i) => `
    <tr>
      <td class="num">${i+1}</td>
      <td>${escapeText(row.full_name)}</td>
      <td>${escapeText(row.phone)}</td>
      <td>${escapeText(row.email)}</td>
      <td class="${row.checked_in ? 'checked-yes' : 'checked-no'}">${row.checked_in ? '✓ Đã check-in' : '✗ Chưa'}</td>
      <td class="num">${row.check_time || '—'}</td>
    </tr>
  `).join('');
}

async function loadReportDetailed(date) {
  const tbody = document.querySelector('#rep-detailed-table tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#95a5a6;">Đang tải...</td></tr>';
  const r = await api('GET', `/api/admin/reports/detailed?date=${date}`);
  if (!r || !r.ok) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:#e74c3c;">${r?.data?.error || 'Lỗi'}</td></tr>`;
    return;
  }
  lastDetailedReport = r.data;
  if (r.data.rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#95a5a6;">Không có user nào</td></tr>';
    return;
  }
  tbody.innerHTML = r.data.rows.map((row, i) => `
    <tr>
      <td class="num">${i+1}</td>
      <td>${escapeText(row.full_name)}</td>
      <td>${escapeText(row.phone)}</td>
      <td class="${row.checked_today ? 'checked-yes' : 'checked-no'}">${row.checked_today ? '✓' : '✗'}</td>
      <td class="num">${row.streak} ngày</td>
      <td class="num">${row.total_checked}</td>
      <td class="num">${row.total_missed}</td>
    </tr>
  `).join('');
}

async function reloadAllReports() {
  const date = validateReportDate(document.getElementById('rep-date').value);
  await Promise.all([
    loadReportOverview(),
    loadReportDaily(date),
    loadReportDetailed(date)
  ]);
}

// Validate date string YYYY-MM-DD trong khoảng hợp lệ (2024-01-01 đến hôm nay)
function validateReportDate(v) {
  const today = todayDateString();
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return today;
  if (v < '2024-01-01' || v > today) return today;
  return v;
}

function initReportsTab() {
  if (cachedUser.role !== 'admin') return;
  if (reportsTabInitialized) {
    reloadAllReports();
    return;
  }
  reportsTabInitialized = true;

  const dateInput = document.getElementById('rep-date');
  const today = todayDateString();

  // Set date mặc định = hôm nay, max = hôm nay (không cho chọn tương lai)
  dateInput.value = today;
  dateInput.max = today;

  // Validate khi đổi ngày: nếu năm bị typo (vd 0025) → snap về hôm nay
  dateInput.addEventListener('change', () => {
    const normalized = validateReportDate(dateInput.value);
    if (normalized !== dateInput.value) {
      dateInput.value = normalized;
      alert('Ngày không hợp lệ. Đã chuyển về hôm nay.');
    }
    reloadAllReports();
  });

  // Quick buttons: Hôm nay / Hôm qua
  document.querySelectorAll('button[data-quick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = new Date();
      if (btn.dataset.quick === 'yesterday') t.setDate(t.getDate() - 1);
      dateInput.value = `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`;
      reloadAllReports();
    });
  });

  document.getElementById('rep-reload').addEventListener('click', reloadAllReports);

  // Export Excel - báo cáo nhanh
  document.getElementById('rep-daily-export').addEventListener('click', () => {
    if (!lastDailyReport) return alert('Chưa có dữ liệu');
    exportToExcel(
      lastDailyReport.rows,
      `Bao cao nhanh ${lastDailyReport.date}`,
      `bao-cao-nhanh-${lastDailyReport.date}.xlsx`,
      [
        { key: '_', label: 'STT', width: 6 },
        { key: 'full_name', label: 'Họ và tên', width: 28 },
        { key: 'phone', label: 'Số điện thoại', width: 16 },
        { key: 'email', label: 'Email', width: 30 },
        { key: 'checked_in', label: 'Check-in', value: r => r.checked_in ? 'Đã check-in' : 'Chưa', width: 14 },
        { key: 'check_time', label: 'Giờ', value: r => r.check_time || '', width: 10 }
      ]
    );
  });

  // Export Excel - báo cáo chi tiết
  document.getElementById('rep-detailed-export').addEventListener('click', () => {
    if (!lastDetailedReport) return alert('Chưa có dữ liệu');
    exportToExcel(
      lastDetailedReport.rows,
      `Bao cao chi tiet ${lastDetailedReport.date}`,
      `bao-cao-chi-tiet-${lastDetailedReport.date}.xlsx`,
      [
        { key: '_', label: 'STT', width: 6 },
        { key: 'full_name', label: 'Họ và tên', width: 28 },
        { key: 'phone', label: 'Số điện thoại', width: 16 },
        { key: 'checked_today', label: 'Check-in hôm nay', value: r => r.checked_today ? 'Đã check-in' : 'Chưa', width: 18 },
        { key: 'streak', label: 'Số ngày liên tiếp', width: 18 },
        { key: 'total_checked', label: 'Tổng đã check-in', width: 18 },
        { key: 'total_missed', label: 'Tổng chưa check-in', width: 20 }
      ]
    );
  });

  // ===== Range report (tuần/tháng) + biểu đồ =====
  document.querySelectorAll('.range-quick').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range-quick').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const r = computeRange(btn.dataset.range);
      document.getElementById('rep-range-from').value = r.from;
      document.getElementById('rep-range-to').value = r.to;
      loadRangeReport(r.from, r.to);
    });
  });
  document.getElementById('rep-range-apply').addEventListener('click', () => {
    document.querySelectorAll('.range-quick').forEach(b => b.classList.remove('active'));
    const from = validateReportDate(document.getElementById('rep-range-from').value);
    const to = validateReportDate(document.getElementById('rep-range-to').value);
    loadRangeReport(from, to);
  });
  document.getElementById('rep-range-export').addEventListener('click', () => {
    if (!lastRangeReport) return alert('Chưa có dữ liệu');
    exportToExcel(
      lastRangeReport.per_user,
      `Xu huong ${lastRangeReport.from} ${lastRangeReport.to}`,
      `xu-huong-${lastRangeReport.from}_${lastRangeReport.to}.xlsx`,
      [
        { key: '_', label: 'STT', width: 6 },
        { key: 'full_name', label: 'Họ và tên', width: 28 },
        { key: 'phone', label: 'Số điện thoại', width: 16 },
        { key: 'email', label: 'Email', width: 30 },
        { key: 'checked_days', label: `Số ngày check-in (${lastRangeReport.total_days} ngày)`, width: 26 }
      ]
    );
  });

  // Mặc định load 7 ngày
  const wk = computeRange('week');
  document.getElementById('rep-range-from').value = wk.from;
  document.getElementById('rep-range-to').value = wk.to;
  document.getElementById('rep-range-from').max = todayDateString();
  document.getElementById('rep-range-to').max = todayDateString();

  reloadAllReports();
  loadRangeReport(wk.from, wk.to);
}

// Tính khoảng ngày cho quick buttons
function computeRange(type) {
  const d = new Date();
  const to = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  let from;
  if (type === 'month') {
    from = `${d.getFullYear()}-${pad(d.getMonth()+1)}-01`;
  } else if (type === '30days') {
    const s = new Date(d); s.setDate(s.getDate() - 29);
    from = `${s.getFullYear()}-${pad(s.getMonth()+1)}-${pad(s.getDate())}`;
  } else { // week = 7 ngày
    const s = new Date(d); s.setDate(s.getDate() - 6);
    from = `${s.getFullYear()}-${pad(s.getMonth()+1)}-${pad(s.getDate())}`;
  }
  return { from, to };
}

let lastRangeReport = null;
let chartInstance = null;
let chartJSPromise = null;
function loadChartJS() {
  if (chartJSPromise) return chartJSPromise;
  chartJSPromise = new Promise((resolve, reject) => {
    if (window.Chart) return resolve(window.Chart);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
    s.onload = () => resolve(window.Chart);
    s.onerror = () => reject(new Error('Không tải được Chart.js'));
    document.head.appendChild(s);
  });
  return chartJSPromise;
}

async function loadRangeReport(from, to) {
  const r = await api('GET', `/api/admin/reports/range?from=${from}&to=${to}`);
  if (!r || !r.ok) { showToast('error', 'Lỗi', r?.data?.error || 'Không tải được'); return; }
  lastRangeReport = r.data;
  document.getElementById('rep-range-summary').textContent =
    `${r.data.from} → ${r.data.to} • ${r.data.total_days} ngày • ${r.data.total_checkins} lượt check-in • ${r.data.total_users} user`;

  try {
    const Chart = await loadChartJS();
    const labels = r.data.daily.map(d => d.date.slice(5)); // MM-DD
    const data = r.data.daily.map(d => d.count);
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(document.getElementById('rep-chart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Số lượt check-in',
          data,
          backgroundColor: 'rgba(225,112,85,0.7)',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  } catch (e) {
    console.error(e);
  }
}

// ============ TOAST ============
function showToast(type, title, body) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type || ''}`;
  el.innerHTML = `<div class="toast-title">${escapeText(title)}</div>${body ? `<div class="toast-body">${escapeText(body)}</div>` : ''}`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 5000);
}

// ============ POLLING: thông báo khi payment đổi trạng thái ============
// So sánh trạng thái payment với snapshot trước, toast nếu admin vừa xác nhận/từ chối
let paymentStatusSnapshot = null;
async function pollPaymentStatus() {
  if (cachedUser.role === 'admin') return; // admin không cần
  const r = await api('GET', '/api/payment/history');
  if (!r || !r.ok) return;
  const items = r.data.history || [];
  const current = {};
  items.forEach(p => { current[p.id] = p.status; });

  if (paymentStatusSnapshot) {
    items.forEach(p => {
      const prev = paymentStatusSnapshot[p.id];
      if (prev && prev !== p.status && p.status !== 'pending') {
        if (p.status === 'confirmed') {
          showToast('success', '✓ Thanh toán đã được xác nhận', `Biên lai #${p.id} của bạn đã được duyệt!`);
        } else if (p.status === 'rejected') {
          showToast('error', '✗ Thanh toán bị từ chối', `Biên lai #${p.id}: ${p.admin_note || 'Liên hệ admin'}`);
        }
        // Cập nhật tab payment nếu đang mở
        if (typeof loadPaymentHistory === 'function') loadPaymentHistory();
      }
    });
  }
  paymentStatusSnapshot = current;
}
// Poll mỗi 45s khi tab visible (jitter nhẹ)
setInterval(() => {
  if (document.visibilityState === 'visible') pollPaymentStatus();
}, 45000 + Math.random() * 10000);

// ============ INIT ============
bootstrap();
// Khởi tạo snapshot payment sau 3s (đợi bootstrap xong)
setTimeout(() => { if (cachedUser.role !== 'admin') pollPaymentStatus(); }, 3000);
