/**
 * 认证模块 - JWT + SQLite + Nodemailer
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// ============ 配置 ============

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'; // 7天过期

// 验证码有效期（分钟）
const VERIFY_CODE_EXPIRES = 10;

// 数据库路径
const DB_PATH = path.join(__dirname, 'data', 'users.db');

// 确保数据目录存在
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ============ 数据库初始化 ============

const db = new Database(DB_PATH);

// 用户表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    email_verified INTEGER DEFAULT 0
  )
`);

// 验证码表
db.exec(`
  CREATE TABLE IF NOT EXISTS verify_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    type TEXT NOT NULL,  -- 'register' | 'login' | 'reset_password'
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ============ Nodemailer 配置 ============

// QQ邮箱SMTP配置（延迟初始化，避免启动时阻塞）
let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.qq.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      connectionTimeout: 10000,  // 10秒连接超时
      greetingTimeout: 10000,    // 10秒问候超时
      socketTimeout: 15000       // 15秒 socket 超时
    });
  }
  return transporter;
}

// 发送验证码邮件
async function sendVerifyCode(email, code, type = 'register') {
  const subject = type === 'register' ? '【AI产品实验室】注册验证码' :
                 type === 'login' ? '【AI产品实验室】登录验证码' :
                 '【AI产品实验室】重置密码验证码';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">AI产品思维实验室</h1>
      </div>
      <div style="background: #fff; padding: 40px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
        <h2 style="color: #333; margin-top: 0;">验证码</h2>
        <p style="color: #666; font-size: 16px;">您好，</p>
        <p style="color: #666; font-size: 16px;">您的验证码是：</p>
        <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
          <span style="font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 8px;">${code}</span>
        </div>
        <p style="color: #999; font-size: 14px;">验证码将在 ${VERIFY_CODE_EXPIRES} 分钟后失效，请尽快使用。</p>
        <p style="color: #999; font-size: 14px;">如果您没有发起此请求，请忽略此邮件。</p>
      </div>
    </div>
  `;

  try {
    await getTransporter().sendMail({
      from: `"AI产品实验室" <${process.env.SMTP_USER}>`,
      to: email,
      subject: subject,
      html: html
    });
    console.log(`[Auth] 邮件发送成功: ${email}`);
    return true;
  } catch (error) {
    console.error('[Auth] Email send error:', error.message);
    return false;
  }
}

// ============ 辅助函数 ============

function generateCode() {
  return Math.random().toString().slice(2, 8).padStart(6, '0');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ============ API 路由 ============

// 1. 发送注册验证码
router.post('/send-register-code', async (req, res) => {
  const { email } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: '请提供有效的邮箱地址' });
  }

  // 检查邮箱是否已注册
  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingUser) {
    return res.status(400).json({ error: '该邮箱已注册，请直接登录' });
  }

  // 生成验证码
  const code = generateCode();
  const expiresAt = new Date(Date.now() + VERIFY_CODE_EXPIRES * 60 * 1000).toISOString();

  // 保存验证码
  const stmt = db.prepare(`
    INSERT INTO verify_codes (id, email, code, type, expires_at)
    VALUES (?, ?, ?, 'register', ?)
  `);
  stmt.run(uuidv4(), email, code, expiresAt);

  // 发送邮件
  const sent = await sendVerifyCode(email, code, 'register');
  if (!sent) {
    return res.status(500).json({ error: '邮件发送失败，请检查邮箱地址或稍后重试' });
  }

  res.json({ message: '验证码已发送到您的邮箱' });
});

// 2. 注册
router.post('/register', (req, res) => {
  const { email, password, code } = req.body;

  if (!email || !password || !code) {
    return res.status(400).json({ error: '请填写完整信息' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: '密码长度至少6位' });
  }

  // 验证验证码
  const verifyRecord = db.prepare(`
    SELECT * FROM verify_codes
    WHERE email = ? AND code = ? AND type = 'register' AND used = 0 AND expires_at > datetime('now')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(email, code);

  if (!verifyRecord) {
    return res.status(400).json({ error: '验证码无效或已过期' });
  }

  // 标记验证码已使用
  db.prepare('UPDATE verify_codes SET used = 1 WHERE id = ?').run(verifyRecord.id);

  // 检查邮箱是否已注册（双重检查）
  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingUser) {
    return res.status(400).json({ error: '该邮箱已注册' });
  }

  // 创建用户
  const userId = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, email_verified)
    VALUES (?, ?, ?, 1)
  `).run(userId, email, passwordHash);

  // 生成JWT
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  console.log(`[Auth] New user registered: ${email}`);

  res.json({
    message: '注册成功',
    token,
    user: { id: userId, email }
  });
});

// 3. 发送登录验证码
router.post('/send-login-code', async (req, res) => {
  const { email } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: '请提供有效的邮箱地址' });
  }

  // 检查用户是否存在
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) {
    // 安全考虑：不暴露用户是否存在
    return res.json({ message: '如果邮箱已注册，验证码已发送' });
  }

  // 生成验证码
  const code = generateCode();
  const expiresAt = new Date(Date.now() + VERIFY_CODE_EXPIRES * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO verify_codes (id, email, code, type, expires_at)
    VALUES (?, ?, ?, 'login', ?)
  `).run(uuidv4(), email, code, expiresAt);

  const sent = await sendVerifyCode(email, code, 'login');
  if (!sent) {
    return res.status(500).json({ error: '邮件发送失败' });
  }

  res.json({ message: '验证码已发送到您的邮箱' });
});

// 4. 验证码登录
router.post('/login-with-code', (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ error: '请填写完整信息' });
  }

  // 验证验证码
  const verifyRecord = db.prepare(`
    SELECT * FROM verify_codes
    WHERE email = ? AND code = ? AND type = 'login' AND used = 0 AND expires_at > datetime('now')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(email, code);

  if (!verifyRecord) {
    return res.status(400).json({ error: '验证码无效或已过期' });
  }

  db.prepare('UPDATE verify_codes SET used = 1 WHERE id = ?').run(verifyRecord.id);

  // 获取用户
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    return res.status(400).json({ error: '用户不存在' });
  }

  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  console.log(`[Auth] User logged in: ${email}`);

  res.json({
    message: '登录成功',
    token,
    user: { id: user.id, email: user.email }
  });
});

// 5. 密码登录
router.post('/login-with-password', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: '请填写邮箱和密码' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }

  const validPassword = bcrypt.compareSync(password, user.password_hash);
  if (!validPassword) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }

  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  console.log(`[Auth] User logged in with password: ${email}`);

  res.json({
    message: '登录成功',
    token,
    user: { id: user.id, email: user.email }
  });
});

// 6. JWT验证中间件
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '登录已过期，请重新登录' });
    }
    return res.status(401).json({ error: '无效的登录凭证' });
  }
}

// 7. 获取当前用户信息
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// 8. 发送重置密码验证码
router.post('/send-reset-code', async (req, res) => {
  const { email } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: '请提供有效的邮箱地址' });
  }

  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) {
    return res.json({ message: '如果邮箱已注册，验证码已发送' });
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + VERIFY_CODE_EXPIRES * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO verify_codes (id, email, code, type, expires_at)
    VALUES (?, ?, ?, 'reset_password', ?)
  `).run(uuidv4(), email, code, expiresAt);

  const sent = await sendVerifyCode(email, code, 'reset_password');
  if (!sent) {
    return res.status(500).json({ error: '邮件发送失败' });
  }

  res.json({ message: '验证码已发送到您的邮箱' });
});

// 9. 重置密码
router.post('/reset-password', (req, res) => {
  const { email, code, newPassword } = req.body;

  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: '请填写完整信息' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: '密码长度至少6位' });
  }

  const verifyRecord = db.prepare(`
    SELECT * FROM verify_codes
    WHERE email = ? AND code = ? AND type = 'reset_password' AND used = 0 AND expires_at > datetime('now')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(email, code);

  if (!verifyRecord) {
    return res.status(400).json({ error: '验证码无效或已过期' });
  }

  db.prepare('UPDATE verify_codes SET used = 1 WHERE id = ?').run(verifyRecord.id);

  const passwordHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(passwordHash, email);

  console.log(`[Auth] Password reset: ${email}`);

  res.json({ message: '密码重置成功，请使用新密码登录' });
});

module.exports = router;
module.exports.authMiddleware = authMiddleware;
