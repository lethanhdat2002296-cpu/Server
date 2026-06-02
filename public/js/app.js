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
    const verifiedBadge = item.is_receipt
      ? '<span class="badge verified">✓ Đã xác minh</span>'
      : '<span class="badge pending">⏳ Chờ xác minh</span>';
    const sentBadge = item.email_sent ? '<span class="badge sent">📧 Đã gửi mail</span>' : '';
    const date = new Date(item.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    return `<li class="history-item">
      <div>
        <div class="history-date">#${item.id} - ${item.full_name}${verifiedBadge}${sentBadge}</div>
        <div class="history-date-sub">${date} • ${item.email} • ${item.phone}</div>
        ${item.detected_banks ? `<div class="history-date-sub">Phát hiện: ${item.detected_banks}</div>` : ''}
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

// ============ INIT ============
bootstrap();
