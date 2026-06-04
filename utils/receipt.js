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

function analyzeReceiptText(text) {
  if (!text || typeof text !== 'string') {
    return { is_receipt: false, matched_keywords: [], detected_banks: [] };
  }
  const upper = text.toUpperCase();
  const matched = BANK_KEYWORDS.filter(k => upper.includes(k));
  const detectedBanks = matched.filter(k => !GENERIC.includes(k));
  return { is_receipt: matched.length >= 2, matched_keywords: matched, detected_banks: detectedBanks };
}

module.exports = { BANK_KEYWORDS, analyzeReceiptText };
