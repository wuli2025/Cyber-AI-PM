/**
 * 启动所有服务
 * 1. Backend (3011) - HTTP API + 静态文件 + WebSocket
 * 2. agent-ws (9999) - Claude Code WebSocket 桥接
 */

const { spawn, exec } = require('child_process');
const path = require('path');

const scriptsDir = __dirname;
const projectRoot = path.dirname(scriptsDir);

console.log('==========================================');
console.log('  AI产品思维实验室 - 启动脚本');
console.log('==========================================\n');

// 检查端口是否被占用
function checkPort(port) {
  return new Promise((resolve) => {
    exec(`netstat -ano | grep ":${port}" | grep LISTEN`, (err, stdout) => {
      if (stdout && stdout.includes('LISTENING')) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

// 终止占用端口的进程
async function killPort(port) {
  return new Promise((resolve) => {
    exec(`netstat -ano | grep ":${port}" | grep LISTEN`, (err, stdout) => {
      if (stdout) {
        const match = stdout.match(/LISTENING\s+(\d+)/);
        if (match) {
          const pid = match[1];
          console.log(`  终止占用 ${port} 端口的进程 ${pid}...`);
          exec(`taskkill /F /PID ${pid}`, () => resolve());
          return;
        }
      }
      resolve();
    });
  });
}

// 启动服务
function startService(name, command, args, cwd) {
  return new Promise((resolve, reject) => {
    console.log(`启动 ${name}...`);

    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: true
    });

    child.on('error', (err) => {
      console.error(`${name} 启动失败:`, err.message);
      reject(err);
    });

    setTimeout(() => {
      console.log(`${name} 已启动`);
      resolve(child);
    }, 1000);
  });
}

async function main() {
  // 检查并清理端口
  console.log('检查端口占用...\n');

  const ports = [3011, 9999];
  for (const port of ports) {
    if (await checkPort(port)) {
      console.log(`端口 ${port} 已被占用，正在终止...`);
      await killPort(port);
      console.log('');
    }
  }

  // 启动 Backend
  console.log('-------------------------------------------');
  console.log('启动 Backend (3011 端口)...');
  console.log('-------------------------------------------');
  const backend = spawn('node', ['server.js'], {
    cwd: path.join(projectRoot, 'backend'),
    stdio: 'inherit',
    shell: true
  });

  // 等待 backend 启动
  await new Promise(r => setTimeout(r, 3000));

  // 检查 Backend 是否成功启动
  if (await checkPort(3011)) {
    console.log('Backend 启动成功 ✅\n');
  } else {
    console.error('Backend 启动失败 ❌\n');
    process.exit(1);
  }

  // 提示 agent-ws 状态
  console.log('-------------------------------------------');
  console.log('agent-ws (9999 端口) 状态:');
  console.log('-------------------------------------------');
  console.log('注意: agent-ws npm 包在 Windows 上有兼容性问题');
  console.log('如果需要使用 agent-ws，请手动启动:');
  console.log('  node scripts/start-agent-ws.js');
  console.log('');

  console.log('==========================================');
  console.log('  启动完成！');
  console.log('==========================================');
  console.log('');
  console.log('  前端页面: http://localhost:3011');
  console.log('  后端 API: http://localhost:3011/api/health');
  console.log('');
  console.log('  关闭方法: 关闭此窗口或按 Ctrl+C');
  console.log('==========================================\n');

  // 保持进程运行
  process.on('SIGINT', () => {
    console.log('\n正在关闭...');
    backend.kill();
    process.exit(0);
  });
}

main().catch(console.error);
