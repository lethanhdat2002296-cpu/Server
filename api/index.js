// Vercel serverless function entry
// Mọi request đến /api/* sẽ chạy file này (qua vercel.json rewrite)
const app = require('../app');
module.exports = app;
