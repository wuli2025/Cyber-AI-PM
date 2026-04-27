/**
 * Claude Code WebSocket 服务器
 * 支持右下角嵌入式终端直连 Claude Code CLI
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const { streamClaude } = require('./claude-process');
const { buildSystemPrompt, preloadAllSkills } = require('./personas');

const WS_PORT = parseInt(process.env.WS_PORT || '3011');
const HEARTBEAT_INTERVAL = 25000;

// 创建 HTTP 服务器（用于 WebSocket 升级）
const server = http.createServer();

// WebSocket 服务器
const wss = new WebSocketServer({ server });

// 连接的客户端
const clients = new Map();

console.log(`[WS] WebSocket Server starting on port ${WS_PORT}...`);

// 预处理所有人格
preloadAllSkills();

wss.on('connection', (ws, req) => {
  const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  clients.set(clientId, { ws, currentProcess: null });

  console.log(`[WS] Client connected: ${clientId}`);

  // 发送连接成功消息
  ws.send(JSON.stringify({ type: 'connected', clientId }));

  // 设置心跳
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleMessage(clientId, msg);
    } catch (e) {
      console.error(`[WS] Parse error:`, e.message);
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Client disconnected: ${clientId}`);
    const client = clients.get(clientId);
    if (client?.currentProcess) {
      client.currentProcess();
    }
    clients.delete(clientId);
  });

  ws.on('error', (err) => {
    console.error(`[WS] Client error:`, err.message);
  });
});

// 心跳检测
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// 处理消息
function handleMessage(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;

  console.log(`[WS] Message from ${clientId}:`, msg.type);

  switch (msg.type) {
    case 'chat':
      handleChat(clientId, msg);
      break;
    case 'input':
      // input 类型：用户终端输入，转为 chat 处理
      handleChat(clientId, { prompt: msg.data || '', persona_id: 'yujun', mode: 'quick' });
      break;
    case 'resize':
      // 终端 resize 事件（暂时忽略）
      break;
    case 'stop':
      // 停止当前进程
      if (client.currentProcess) {
        client.currentProcess();
        client.currentProcess = null;
        client.ws.send(JSON.stringify({ type: 'stopped' }));
      }
      break;
    default:
      console.log(`[WS] Unknown message type:`, msg.type);
  }
}

// 处理聊天消息
function handleChat(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;

  // 支持 prompt 或 data 字段
  const { prompt, persona_id = 'yujun', mode = 'pro' } = msg;
  const userMessage = prompt || msg.data || '';

  if (!userMessage.trim()) return;

  // 停止之前的进程
  if (client.currentProcess) {
    client.currentProcess();
  }

  // 构建 system prompt
  const systemPrompt = buildSystemPrompt(persona_id, mode);

  console.log(`[WS] Starting Claude process for ${clientId}: persona=${persona_id}, mode=${mode}`);

  // 启动 Claude 进程
  client.currentProcess = streamClaude(systemPrompt, userMessage, {
    onChunk: (text) => {
      if (client.ws.readyState === 1) { // OPEN
        client.ws.send(text); // 直接发送原始文本
      }
    },
    onDone: () => {
      client.currentProcess = null;
      if (client.ws.readyState === 1) {
        client.ws.send('[DONE]');
      }
    },
    onError: (error) => {
      client.currentProcess = null;
      if (client.ws.readyState === 1) {
        client.ws.send('[ERROR] ' + error);
      }
    }
  });
}

// 启动服务器
server.listen(WS_PORT, () => {
  console.log(`[WS] WebSocket Server started on ws://localhost:${WS_PORT}`);
  console.log(`[WS] Ready for terminal connections`);
});

module.exports = { server, wss };
