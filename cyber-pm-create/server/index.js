/**
 * Claude Code Web Chat - HTTP API 版本
 * 通过 HTTP API 调用 Claude Code，支持 WebSearch 和人格 Skill
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const http = require('http');
const { exec } = require('child_process');

// ============ 配置 ============
const PORT = process.env.PORT || 3011;
const CLAUDE_SETTINGS_PATH = process.env.CLAUDE_SETTINGS_PATH || path.join(__dirname, '../config/claude-settings.json');
const SKILL_BASE_PATH = process.env.SKILL_BASE_PATH || path.join(__dirname, '../skills');
const PUBLIC_PATH = path.join(__dirname, '../public');
const ASSETS_PATH = path.join(__dirname, '../Kimi_Agent_Deployment_v11');

// ============ 人格配置（包含 Skill 路径）============
const PERSONAS = {
  'yujun': { name: '俞军', color: '#0D5B4A', skillFile: '俞军junSKILL.md' },
  'jobs': { name: '乔布斯', color: '#C41E3A', skillFile: '乔布斯SKILL.md' },
  'musk': { name: '马斯克', color: '#1E90FF', skillFile: '马斯克SKILL.md' },
  'ma': { name: '马化腾', color: '#2E6BE6', skillFile: '马化腾SKILL-PM.md' },
  'zhang': { name: '张一鸣', color: '#E67E22', skillFile: '张一鸣SKILL.md' },
  'jiaoyuan': { name: '毛主席', color: '#B22234', skillFile: '教员SKILL.md' },
  'default': { name: '默认', color: '#666666', skillFile: null }
};

// ============ Skill 加载 ============
function loadSkill(personaId) {
  const persona = PERSONAS[personaId];
  if (!persona || !persona.skillFile) return null;

  const skillPath = path.join(SKILL_BASE_PATH, persona.skillFile);
  if (!fs.existsSync(skillPath)) {
    console.log(`[Skill] Not found: ${skillPath}`);
    return null;
  }

  try {
    const content = fs.readFileSync(skillPath, 'utf-8');
    console.log(`[Skill] Loaded: ${personaId} from ${persona.skillFile} (${content.length} chars)`);
    return content;
  } catch (e) {
    console.error(`[Skill] Error:`, e.message);
    return null;
  }
}

// ============ System Prompt 构建 ============
// 上下文窗口限制（字节），留空间给用户消息和响应
const MAX_CONTEXT_CHARS = 15000;

function buildSystemPrompt(personaId, mode) {
  const persona = PERSONAS[personaId] || PERSONAS['default'];

  const thinkingModes = {
    quick: '【Quick 快速回答模式】最低思考深度，直击要点，简洁有力。',
    pro: '【Pro 深度推理模式】中等思考深度，完整逻辑闭环，严谨稳妥。',
    deep: '【Deep 链式思考模式】最高思考深度，穷尽推理，层层递进。'
  };

  const thinking = thinkingModes[mode] || thinkingModes.pro;
  let skill = loadSkill(personaId);

  // 截断过长的 SKILL
  if (skill && skill.length > MAX_CONTEXT_CHARS - 2000) {
    skill = skill.substring(0, MAX_CONTEXT_CHARS - 2000) + '\n\n[SKILL 内容已截断...]';
    console.log(`[Skill] Truncated to ${MAX_CONTEXT_CHARS - 2000} chars`);
  }

  const parts = [
    thinking,
    '',
    `═══════════════════════════════════════════════════════`,
    `【人格激活】你是：${persona.name}`,
    `═══════════════════════════════════════════════════════`,
    '',
    skill || '',
    '',
    `═══════════════════════════════════════════════════════`,
    `【重要规则】`,
    `1. 直接以${persona.name}的身份回应，不要说"作为AI"或"作为一个语言模型"`,
    `2. 保持${persona.name}的说话风格和思维方式`,
    `3. 遇到产品决策问题，先用该人格的框架分析，再给结论`,
    `═══════════════════════════════════════════════════════`
  ];

  return parts.join('\n');
}

// ============ Claude Code 执行 ============
let currentProcess = null;

function killCurrentProcess() {
  if (currentProcess) {
    try { currentProcess.kill(); } catch (e) {}
    currentProcess = null;
  }
}

function runClaude(systemPrompt, userMessage, onData, onError, onClose) {
  killCurrentProcess();

  // 使用临时文件传递 system prompt，避免命令行参数过长
  const { writeFileSync, unlinkSync, existsSync } = require('fs');
  const { tmpdir } = require('os');
  const { join } = require('path');

  const requestId = `req_${Date.now()}`;
  // Windows: 使用正斜杠避免转义问题
  const tmpFile = join(tmpdir(), `claude-sys-${requestId}.txt`).replace(/\\/g, '/');

  // 写入 system prompt 到临时文件
  writeFileSync(tmpFile, systemPrompt, 'utf-8');

  // 使用命令行参数传递用户消息，文件传递 system prompt
  const args = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--system-prompt-file', `"${tmpFile}"`,
    `"${userMessage}"`
  ];

  const cmdPath = 'C:/Users/Lenovo/AppData/Roaming/npm/claude.cmd';
  const command = `${cmdPath} ${args.join(' ')}`;

  console.log('[Claude] 执行命令...');

  currentProcess = exec(command, {
    cwd: 'D:/ai产品经理/cyber-pm-create',
    windowsHide: true
  }, (error) => {
    // 清理临时文件
    try { unlinkSync(tmpFile); } catch (e) {}

    if (error) {
      console.error('[Claude] Error:', error.message);
      onError(error.message);
    }
  });

  currentProcess.stdout.on('data', (chunk) => {
    onData(chunk.toString());
  });

  currentProcess.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text && !text.includes('[的系统')) {
      console.log('[Claude stderr]:', text.substring(0, 100));
    }
  });

  currentProcess.on('close', (code) => {
    console.log('[Claude] 关闭, code:', code);
    onClose();
    currentProcess = null;
  });

  currentProcess.on('error', (err) => {
    console.error('[Claude] 进程错误:', err.message);
    onError(err.message);
    currentProcess = null;
  });
}

// ============ HTTP 服务器 ============
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // API 路由
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', engine: 'claude-code', uptime: process.uptime() }));
    return;
  }

  if (pathname === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      wsURL: `ws://localhost:${PORT}`,
      wsToken: '',
      useClaudeCode: true,
      useSkillMode: true,
      defaultMode: 'pro',
      defaultPersona: 'yujun',
      personaToSkill: {}
    }));
    return;
  }

  if (pathname === '/api/personas') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(Object.entries(PERSONAS).map(([id, p]) => ({ id, name: p.name, color: p.color }))));
    return;
  }

  // POST /api/chat - SSE 流式响应
  if (pathname === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let resEnded = false;
      let heartbeatTimer = null;

      function safeWrite(data) {
        if (!resEnded && res.writable) {
          try { res.write(data); } catch (e) { resEnded = true; }
        }
      }

      function safeEnd() {
        if (!resEnded && res.writable) {
          try { res.end(); } catch (e) {}
          resEnded = true;
        }
      }

      try {
        const { message, persona_id = 'default', mode = 'pro' } = JSON.parse(body);

        console.log(`[Chat] persona=${persona_id}, mode=${mode}`);

        // 使用 buildSystemPrompt 构建包含 Skill 的提示词
        const systemPrompt = buildSystemPrompt(persona_id, mode);
        console.log(`[Chat] System prompt length: ${systemPrompt.length} chars`);

        // 设置 SSE headers
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        let buffer = '';

        runClaude(
          systemPrompt,
          message,
          // onData
          (text) => {
            buffer += text;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                if (parsed.type === 'assistant' && parsed.message?.content) {
                  for (const item of parsed.message.content) {
                    if (item.type === 'text' && item.text) {
                      safeWrite(`data: ${JSON.stringify({ type: 'chunk', payload: { content: item.text } })}\n\n`);
                    }
                  }
                }
              } catch (e) {}
            }
          },
          // onError
          (error) => {
            safeWrite(`data: ${JSON.stringify({ type: 'error', payload: { error } })}\n\n`);
            safeEnd();
          },
          // onClose
          () => {
            safeWrite(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            safeEnd();
          }
        );

        // 心跳
        heartbeatTimer = setInterval(() => {
          safeWrite(': heartbeat\n\n');
        }, 25000);

        req.on('close', () => {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          killCurrentProcess();
        });

      } catch (e) {
        console.error('[Chat Error]:', e.message);
        if (!resEnded) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      }
    });
    return;
  }

  // 静态文件
  let filePath = path.join(PUBLIC_PATH, pathname === '/' ? 'index.html' : pathname);

  if (!fs.existsSync(filePath) && pathname.startsWith('/assets/')) {
    filePath = path.join(ASSETS_PATH, pathname);
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(ASSETS_PATH, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

// ============ WebSocket 服务 ============
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ server });

console.log(`
╔════════════════════════════════════════════════╗
║         Claude Code Web Chat Server            ║
╠════════════════════════════════════════════════╣
║  HTTP/WS:   http://localhost:${PORT}            ║
║  Engine:     Claude Code + WebSearch + Skill ║
╚════════════════════════════════════════════════╝
`);

wss.on('connection', (ws) => {
  const clientId = `client_${Date.now()}`;
  console.log(`[${clientId}] WebSocket 连接`);

  ws.send(JSON.stringify({ type: 'connected', payload: { session_id: clientId } }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'chat') {
        const { message, persona_id = 'default', mode = 'pro' } = msg.payload;

        console.log(`[WS Chat] persona=${persona_id}, mode=${mode}`);

        const systemPrompt = buildSystemPrompt(persona_id, mode);

        let buffer = '';

        runClaude(
          systemPrompt,
          message,
          (text) => {
            buffer += text;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                if (parsed.type === 'assistant' && parsed.message?.content) {
                  for (const item of parsed.message.content) {
                    if (item.type === 'text' && item.text) {
                      ws.send(JSON.stringify({ type: 'chunk', payload: { content: item.text } }));
                    }
                  }
                }
              } catch (e) {}
            }
          },
          (error) => {
            ws.send(JSON.stringify({ type: 'error', payload: { error } }));
          },
          () => {
            ws.send(JSON.stringify({ type: 'done' }));
          }
        );

      } else if (msg.type === 'stop') {
        killCurrentProcess();
        ws.send(JSON.stringify({ type: 'done' }));
      }
    } catch (e) {
      console.error(`[${clientId}] Error:`, e.message);
    }
  });

  ws.on('close', () => {
    console.log(`[${clientId}] 断开`);
    killCurrentProcess();
  });
});

server.listen(PORT, () => {
  console.log(`[Server] http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  console.log('\n[Server] 关闭中...');
  killCurrentProcess();
  wss.close();
  server.close();
  process.exit(0);
});
