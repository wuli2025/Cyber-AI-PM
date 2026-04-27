/**
 * 测试邮件发送
 */
require('dotenv').config();

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.qq.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const testEmail = process.argv[2] || '1799820934@qq.com';
const testCode = Math.random().toString().slice(2, 8);

console.log(`发送测试邮件到: ${testEmail}`);
console.log(`验证码: ${testCode}`);

transporter.sendMail({
  from: `"AI产品实验室" <${process.env.SMTP_USER}>`,
  to: testEmail,
  subject: '【AI产品实验室】测试邮件',
  html: `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">AI产品思维实验室</h1>
      </div>
      <div style="background: #fff; padding: 40px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
        <h2 style="color: #333; margin-top: 0;">测试邮件</h2>
        <p style="color: #666; font-size: 16px;">这是一封测试邮件，用于验证邮件发送功能是否正常。</p>
        <p style="color: #666; font-size: 16px;">验证码是：</p>
        <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
          <span style="font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 8px;">${testCode}</span>
        </div>
      </div>
    </div>
  `
}).then(() => {
  console.log('✅ 邮件发送成功！');
  process.exit(0);
}).catch((err) => {
  console.error('❌ 邮件发送失败:', err.message);
  process.exit(1);
});
