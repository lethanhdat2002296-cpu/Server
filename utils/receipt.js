// Nhận diện biên lai chuyển khoản từ text OCR - dùng chung client/server
const BANK_KEYWORDS = [
  'VIETCOMBANK', 'VCB', 'TECHCOMBANK', 'TCB', 'VIETINBANK', 'VTB', 'CTG', 'BIDV',
  'AGRIBANK', 'VBA', 'MB BANK', 'MBBANK', 'MILITARY BANK', 'ACB', 'A CHAU',
  'VPBANK', 'VP BANK', 'SACOMBANK', 'STB', 'TPBANK', 'TP BANK', 'HDBANK', 'HD BANK',
  'EXIMBANK', 'SHB', 'OCB', 'MSB', 'MARITIME BANK', 'NCB', 'SEABANK', 'PVCOMBANK',
  'MOMO', 'MO MO', 'ZALOPAY', 'ZALO PAY', 'VNPAY', 'VN PAY', 'SHOPEEPAY', 'SHOPEE PAY',
  'VIETTELPAY', 'VIETTEL MONEY',
  'CHUYEN KHOAN', 'CHUYỂN KHOẢN', 'CHUYEN TIEN', 'CHUYỂN TIỀN',
  'GIAO DICH', 'GIAO DỊCH', 'TRANSACTION', 'TRANSFER',
  'BIEN LAI', 'BIÊN LAI', 'HOA DON', 'HÓA ĐƠN',
  'THANH TOAN', 'THANH TOÁN', 'SO TIEN', 'SỐ TIỀN',
  'NOI DUNG', 'NỘI DUNG', 'NGUOI NHAN', 'NGƯỜI NHẬN', 'NGUOI GUI', 'NGƯỜI GỬI',
  'STK', 'TAI KHOAN', 'TÀI KHOẢN', 'THANH CONG', 'THÀNH CÔNG',
  'SUCCESS', 'SUCCESSFUL', 'VND', 'DONG', 'ĐỒNG'
];

const GENERIC = ['VND', 'DONG', 'ĐỒNG', 'STK', 'SUCCESS', 'SUCCESSFUL', 'THANH CONG', 'THÀNH CÔNG'];

// Trích SỐ TIỀN lớn nhất hợp lý từ text OCR (để đối soát với mức phí cấu hình).
// Nhận cụm có phân tách (500.000 / 1,500,000) hoặc số dài >=4 chữ số. Trả null nếu không có.
function extractAmount(text) {
  if (!text || typeof text !== 'string') return null;
  // Ưu tiên số có phân tách hàng nghìn (đặc trưng số tiền: 500.000 / 1,500,000).
  let pool = text.match(/\d{1,3}(?:[.,]\d{3})+/g) || [];
  // Fallback: số nguyên 4-9 chữ số ĐỨNG RIÊNG (tránh nuốt nhầm số tài khoản dài 10+ chữ số).
  if (!pool.length) pool = text.match(/\b\d{4,9}\b/g) || [];
  let max = 0;
  for (const m of pool) {
    const n = parseInt(m.replace(/[.,]/g, ''), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max >= 1000 ? max : null;
}

function analyzeReceiptText(text) {
  if (!text || typeof text !== 'string') {
    return { is_receipt: false, matched_keywords: [], detected_banks: [], detected_amount: null };
  }
  const upper = text.toUpperCase();
  const matched = BANK_KEYWORDS.filter(k => upper.includes(k));
  const detectedBanks = matched.filter(k => !GENERIC.includes(k));
  // is_receipt: cần >=1 từ khóa KHÔNG generic + tổng >=2 → giảm dương tính giả (vd chỉ "VND DONG")
  const is_receipt = detectedBanks.length >= 1 && matched.length >= 2;
  return { is_receipt, matched_keywords: matched, detected_banks: detectedBanks, detected_amount: extractAmount(text) };
}

module.exports = { BANK_KEYWORDS, analyzeReceiptText, extractAmount };
