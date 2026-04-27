/**
 * AI产品思维实验室 - Claude Code 后端
 * 使用 Claude Code CLI 作为对话引擎
 * 支持 SYSTEM PROMPT 人格切换 + 流式响应
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');

// WebSocket 支持
const { WebSocketServer } = require('ws');

// node-pty 支持（交互式终端）
let pty;
try {
  pty = require('node-pty');
  console.log('[PTY] node-pty loaded');
} catch (e) {
  console.warn('[PTY] node-pty not available, terminal mode disabled');
}

// 引入认证模块
const authRouter = require('./auth');
const { authMiddleware } = require('./auth');

// 引入 Claude Code 模块
const { streamClaude, checkClaudeAvailable } = require('./claude-process');
const { buildSystemPrompt, getPersonaList, preloadAllSkills, preloadAllSystemPrompts } = require('./personas');

const app = express();
const PORT = process.env.PORT || 3011;

// SSE 心跳间隔 (毫秒)
const HEARTBEAT_INTERVAL = 25000;

// Claude Code 模式开关
const USE_CLAUDE_CODE = process.env.USE_CLAUDE_CODE !== 'false';

// 强制从 .env 读取
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim();
      if (value) {
        process.env[key] = value;
      }
    }
  });
}

// 启动时检查 Claude Code
async function initBackend() {
  if (USE_CLAUDE_CODE) {
    const available = await checkClaudeAvailable();
    if (available) {
      console.log('[Backend] Mode: Claude Code ✅');
      preloadAllSkills();
      preloadAllSystemPrompts(); // 预构建所有 System Prompt
    } else {
      console.warn('[Backend] Mode: Claude Code ❌ (Not available)');
    }
  } else {
    console.log('[Backend] Mode: Minimax API');
  }
}

// ============ 前端静态文件（放在 API 路由之前）============
const FRONTEND_PATH = process.env.FRONTEND_PATH || path.join(__dirname, '..', 'Kimi_Agent_Deployment_v11');
if (fs.existsSync(FRONTEND_PATH)) {
  app.use(express.static(FRONTEND_PATH));
  console.log(`[Server] 前端静态文件: ${FRONTEND_PATH}`);
} else {
  console.warn(`[Server] 前端目录不存在: ${FRONTEND_PATH}`);
}

// ============ 认证路由 ============
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:8080', 'http://localhost:5173', 'http://localhost:3010', 'http://localhost:3001', 'http://localhost:3011'],
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// 登录页面路由
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.use('/api/auth', authRouter);

// ============ SSE 辅助函数 ============

function setupSSEHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function sendSSEMessage(res, data) {
  if (res.writableEnded) return false;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch (e) {
    console.error('[SSE] Write error:', e.message);
    return false;
  }
}

function sendHeartbeat(res) {
  if (res.writableEnded) return false;
  try {
    res.write(': heartbeat\n\n');
    return true;
  } catch (e) {
    return false;
  }
}

// ============ API ============

// Claude Code 配置文件
app.get('/api/config', (req, res) => {
  res.json({
    wsURL: 'ws://localhost:3011',
    wsToken: '',
    useClaudeCode: true,
    useSkillMode: true,
    defaultMode: 'pro',
    defaultPersona: 'yujun',
    personaToSkill: {
      'yujun': 'yu-jun-pm',
      'jobs': 'steve-jobs-perspective',
      'musk': 'elon-musk-perspective',
      'ma': 'pony-ma-pm',
      'zhang': 'openclaw-product-blueprint',
      'jiaoyuan': 'mao-ze-dong-pm'
    }
  });
});

app.get('/api/personas', (req, res) => {
  res.json(getPersonaList());
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    engine: 'claude-code',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Chat 接口
app.post('/api/chat', async (req, res) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { message, persona_id = 'yujun', mode = 'pro', history = [] } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  console.log(`[${requestId}] Chat: persona=${persona_id}, mode=${mode}`);

  setupSSEHeaders(res);
  sendSSEMessage(res, { type: 'connected', requestId });

  const heartbeatTimer = setInterval(() => {
    if (!sendHeartbeat(res)) {
      clearInterval(heartbeatTimer);
    }
  }, HEARTBEAT_INTERVAL);

  res.on('close', () => {
    console.log(`[${requestId}] Connection closed`);
    clearInterval(heartbeatTimer);
  });

  try {
    const systemPrompt = buildSystemPrompt(persona_id, mode);
    console.log(`[${requestId}] System prompt: ${systemPrompt.length} chars`);

    let stopFn = null;
    let finished = false;

    stopFn = streamClaude(systemPrompt, message, {
      onChunk: (text) => {
        if (!finished && !res.writableEnded) {
          sendSSEMessage(res, { type: 'chunk', content: text, requestId });
        }
      },
      onDone: () => {
        if (!finished) {
          finished = true;
          clearInterval(heartbeatTimer);
          sendSSEMessage(res, { type: 'done', requestId });
          if (!res.writableEnded) res.end();
          console.log(`[${requestId}] Chat complete`);
        }
      },
      onError: (error) => {
        if (!finished) {
          finished = true;
          clearInterval(heartbeatTimer);
          sendSSEMessage(res, { type: 'error', error, requestId });
          if (!res.writableEnded) res.end();
          console.error(`[${requestId}] Error:`, error);
        }
      }
    });

    res.on('close', () => {
      if (!finished && stopFn) {
        finished = true;
        stopFn();
      }
    });

  } catch (error) {
    console.error(`[${requestId}] Error:`, error.message);
    sendSSEMessage(res, { type: 'error', error: error.message, requestId });
    clearInterval(heartbeatTimer);
    if (!res.writableEnded) res.end();
  }
});

// ============ WebSocket 服务器 ============

const connectedClients = new Map();

function initWebSocket(server) {
  const wss = new WebSocketServer({ server });

  console.log('[WS] WebSocket Server initialized');

  wss.on('connection', (ws, req) => {
    const clientId = `term_${Date.now()}`;
    connectedClients.set(clientId, { ws, processStop: null });

    console.log(`[WS] Terminal connected: ${clientId}`);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleWSMessage(clientId, msg);
      } catch (e) {}
    });

    ws.on('close', () => {
      console.log(`[WS] Terminal disconnected: ${clientId}`);
      const client = connectedClients.get(clientId);
      if (client?.processStop) {
        client.processStop();
      }
      connectedClients.delete(clientId);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Terminal error:`, err.message);
    });
  });

  // 心跳检测
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => clearInterval(heartbeat));
}

function handleWSMessage(clientId, msg) {
  const client = connectedClients.get(clientId);
  if (!client) return;

  switch (msg.type) {
    case 'chat':
      handleWSChat(clientId, msg);
      break;
    case 'start':
      // 启动交互式 Claude 终端会话
      handleWSStartTerminal(clientId, msg);
      break;
    case 'input':
      // 终端输入（发送给 Claude 进程）
      handleWSTerminalInput(clientId, msg);
      break;
    case 'stop':
      if (client.processStop) {
        client.processStop();
        client.processStop = null;
      }
      // 终止 PTY 进程
      if (client.pty) {
        client.pty.kill();
        client.pty = null;
      }
      break;
    case 'resize':
      // 终端 resize
      if (client.pty && msg.cols && msg.rows) {
        client.pty.resize(msg.cols, msg.rows);
      }
      break;
  }
}

// 启动交互式终端会话
function handleWSStartTerminal(clientId, msg) {
  const client = connectedClients.get(clientId);
  if (!client) return;

  // 终止之前的 PTY 会话
  if (client.pty) {
    client.pty.kill();
    client.pty = null;
  }

  if (!pty) {
    client.ws.send('[ERROR] Terminal mode not available (node-pty not installed)\r\n');
    return;
  }

  console.log(`[PTY] Starting interactive Claude terminal for ${clientId}`);

  // Windows 上使用 cmd.exe
  const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
  const args = process.platform === 'win32' ? [] : ['--login'];

  try {
    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: msg.cols || 80,
      rows: msg.rows || 24,
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLAUDE: 'true',
        FORCE_COLOR: '1',
        TERM: 'xterm-256color'
      }
    });

    client.pty = ptyProcess;

    // 发送 PTY 输出到 WebSocket
    ptyProcess.onData((data) => {
      if (client.ws.readyState === 1) {
        try {
          client.ws.send(data);
        } catch (e) {
          console.log('[PTY] Send error:', e.message);
        }
      }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(`[PTY] Terminal exited for ${clientId}, code: ${exitCode}, signal: ${signal}`);
      client.pty = null;
      if (client.ws.readyState === 1) {
        try {
          client.ws.send(`\r\n\r\n[Process exited - Claude Code closed]\r\n`);
          client.ws.send('[SYSTEM] Press any key to restart Claude Code\r\n');
        } catch (e) {}
      }
    });

    // 自动启动 Claude CLI
    setTimeout(() => {
      if (client.pty) {
        const claudeCmd = process.platform === 'win32' ? 'claude.cmd' : 'claude';
        console.log(`[PTY] Auto-starting Claude: ${claudeCmd}`);
        ptyProcess.write(`${claudeCmd}\r`);
      }
    }, 1500);

    client.ws.send('\r\n[SYSTEM] Starting Claude Code...\r\n');

  } catch (err) {
    console.error('[PTY] Failed to start terminal:', err.message);
    client.ws.send(`[ERROR] Failed to start terminal: ${err.message}\r\n`);
  }
}

// 处理终端输入
function handleWSTerminalInput(clientId, msg) {
  const client = connectedClients.get(clientId);
  if (!client) return;

  // 如果 PTY 不存在但收到输入，自动重启终端
  if (!client.pty) {
    if (msg.data && msg.data.length === 1) {
      // 单字符输入，可能是按键，重启 Claude
      console.log('[PTY] Restarting Claude on user input');
      handleWSStartTerminal(clientId, { cols: msg.cols || 80, rows: msg.rows || 24 });
    }
    return;
  }

  // 将输入写入 PTY
  if (msg.data) {
    client.pty.write(msg.data);
  }
}

function handleWSChat(clientId, msg) {
  const client = connectedClients.get(clientId);
  if (!client) return;

  const { prompt, persona_id = 'yujun', mode = 'pro' } = msg;

  if (client.processStop) {
    client.processStop();
  }

  const systemPrompt = buildSystemPrompt(persona_id, mode);

  console.log(`[WS] Starting Claude for ${clientId}: ${persona_id}`);

  client.processStop = streamClaude(systemPrompt, prompt, {
    onChunk: (text) => {
      if (client.ws.readyState === 1) {
        client.ws.send(text);
      }
    },
    onDone: () => {
      client.processStop = null;
      if (client.ws.readyState === 1) {
        client.ws.send('[DONE]');
      }
    },
    onError: (error) => {
      client.processStop = null;
      if (client.ws.readyState === 1) {
        client.ws.send(`[ERROR] ${error}\n`);
      }
    }
  });
}

// SPA 路由回退
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(FRONTEND_PATH, 'index.html'));
  } else {
    res.status(404).json({ error: 'API not found' });
  }
});

// ============ 启动 ============

initBackend().then(() => {
  const httpServer = http.createServer(app);
  initWebSocket(httpServer);

  httpServer.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════╗
║         Backend Server Started                 ║
╠════════════════════════════════════════════════╣
║  HTTP API:     http://localhost:${PORT}            ║
║  WebSocket:   ws://localhost:${PORT}              ║
║  Health:       http://localhost:${PORT}/api/health  ║
║  Chat SSE:     POST http://localhost:${PORT}/api/chat ║
╠════════════════════════════════════════════════╣
║  Mode:         Claude Code                    ║
╚════════════════════════════════════════════════╝
    `);
  });
});

// 全局错误处理
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled rejection at:', promise, 'reason:', reason);
});
