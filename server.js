// LOCAL DEV ONLY - Vercel không dùng file này
require('dotenv').config();

const app = require('./app');
const config = require('./config');

app.listen(config.PORT, () => {
  console.log(`\n🚀 5AM Check-in chạy tại http://localhost:${config.PORT}`);
  console.log(`   Timezone: ${config.TIMEZONE}`);
  console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? '✓ đã set' : '✗ CHƯA SET'}\n`);
});
