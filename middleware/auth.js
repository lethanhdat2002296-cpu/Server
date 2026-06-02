const jwt = require('jsonwebtoken');
const config = require('../config');

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try {
    req.user = jwt.verify(token, config.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn' });
  }
}

module.exports = { authRequired };
