#!/usr/bin/env node
/**
 * agent-ws 启动脚本
 * 处理 Windows 上 Node.js execFileSync 无法直接运行 .cmd 文件的问题
 */

const { spawn } = require('child_process');
const path = require('path');

// claude.bat 的路径（相对于项目根目录）
const claudeBatPath = path.join(__dirname, 'claude.bat');

// 启动 agent-ws
const agentWsPath = require.resolve('agent-ws/dist/cli.js');
const args = ['--port', '9999', '--host', 'localhost', '--claude-path', claudeBatPath];

console.log('[agent-ws-launcher] Starting agent-ws with args:', args);

const child = spawn('node', [agentWsPath, ...args], {
  stdio: 'inherit',
  shell: false
});

child.on('exit', (code) => {
  console.log(`[agent-ws-launcher] agent-ws exited with code ${code}`);
  if (code !== 0) {
    process.exit(code);
  }
});
