/**
 * 测试发送注册验证码
 */
require('dotenv').config();

const http = require('http');

const testEmail = '1799820934@qq.com';

const postData = JSON.stringify({
  email: testEmail
});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/auth/send-register-code',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log(`测试发送注册验证码到: ${testEmail}`);

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log(`状态码: ${res.statusCode}`);
    console.log(`响应: ${data}`);
  });
});

req.on('error', (e) => {
  console.error(`请求错误: ${e.message}`);
});

req.write(postData);
req.end();
