// ESLint flat config (v9). Lưới chặn lỗi tĩnh tối thiểu, không quá ngặt.
const js = require('@eslint/js');

const nodeGlobals = {
  process: 'readonly', console: 'readonly', Buffer: 'readonly', __dirname: 'readonly',
  module: 'writable', require: 'readonly', exports: 'writable', globalThis: 'readonly',
  fetch: 'readonly', URL: 'readonly',
  setTimeout: 'readonly', setInterval: 'readonly', clearTimeout: 'readonly', clearInterval: 'readonly'
};

const browserGlobals = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', localStorage: 'readonly', location: 'readonly',
  fetch: 'readonly', alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
  FileReader: 'readonly', Image: 'readonly', Blob: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
  FormData: 'readonly', Event: 'readonly', console: 'readonly',
  setTimeout: 'readonly', setInterval: 'readonly', clearTimeout: 'readonly', clearInterval: 'readonly',
  // CDN libs nạp động + helper dùng chung qua <script>
  Chart: 'readonly', XLSX: 'readonly', Tesseract: 'readonly', buildVietQrUrl: 'readonly'
};

module.exports = [
  { ignores: ['node_modules/**'] },
  js.configs.recommended,

  // Mã server (CommonJS)
  {
    files: ['**/*.js'],
    ignores: ['public/**', 'tests/**'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: nodeGlobals },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_|^next$', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-undef': 'error',
      'eqeqeq': ['warn', 'smart']
    }
  },

  // Mã trình duyệt
  {
    files: ['public/js/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: browserGlobals },
    rules: {
      'no-unused-vars': ['warn', { caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-undef': 'warn'
    }
  },

  // Test (ESM, vitest import tường minh)
  {
    files: ['tests/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: nodeGlobals },
    rules: {
      'no-unused-vars': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];
