const pty = require('node-pty');
const WebSocket = require('ws');
const http = require('http');
const AnsiToHtml = require('ansi-to-html');

const PORT = 9999;
const HOST = 'localhost';

// Claude Code CLI 路径（Windows 用正斜杠避免转义问题）
const CLAUDE_EXE = 'C:/Users/Lenovo/AppData/Roaming/npm/claude.cmd';

// ═══════════════════════════════════════════════════
// ANSI → HTML 转换器（用于聊天模式）
// ═══════════════════════════════════════════════════
const ansiConverter = new AnsiToHtml({
  fg: '#cccccc',
  bg: '#0c0c0c',
  newline: true,
  escapeXML: true,
  stream: true
});

// ═══════════════════════════════════════════════════
// 前端页面（终端模式，内嵌）
// ═══════════════════════════════════════════════════
const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Terminal</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0c0c0c; height: 100vh; width: 100vw; overflow: hidden; }
    #terminal { width: 100%; height: 100%; padding: 8px; }
  </style>
</head>
<body>
  <div id="terminal"></div>
  <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js"></script>
  <script>
    const term = new Terminal({
      cursorBlink: true, fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: { background: '#0c0c0c', foreground: '#cccccc' },
      scrollback: 10000
    });
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal'));
    fitAddon.fit();

    const ws = new WebSocket('ws://' + location.host);
    ws.onopen = () => {
      term.writeln('\r\n\x1b[32m[Connected]\x1b[0m\r\n');
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }, 300);
    };
    ws.onmessage = (ev) => term.write(ev.data);
    ws.onclose = () => term.writeln('\r\n\x1b[31m[Disconnected]\x1b[0m');
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    });
    window.addEventListener('resize', () => { fitAddon.fit(); ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows })); });
  </script>
</body>
</html>`;

// ═══════════════════════════════════════════════════
// HTTP 服务器
// ═══════════════════════════════════════════════════
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  } else {
    res.writeHead(404); res.end('Not Found');
  }
});

// ═══════════════════════════════════════════════════
// WebSocket 服务器
// ═══════════════════════════════════════════════════
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const mode = url.searchParams.get('mode') || 'terminal';

  console.log(`[${new Date().toLocaleTimeString()}] Client ${clientIp} connected (mode: ${mode})`);

  if (mode === 'chat') {
    handleChatMode(ws);
  } else {
    handleTerminalMode(ws);
  }
});

// ═══════════════════════════════════════════════════
// 终端模式：原始 ANSI 透传（用于 xterm.js）
// ═══════════════════════════════════════════════════
function handleTerminalMode(ws) {
  const fs = require('fs');
  if (!fs.existsSync(CLAUDE_EXE)) {
    ws.send('\r\n\x1b[31mError: Claude CLI not found\x1b[0m\r\n');
    ws.close(); return;
  }

  const ptyProcess = pty.spawn(CLAUDE_EXE, [], {
    name: 'xterm-256color', cols: 120, rows: 40,
    cwd: process.cwd(), env: process.env,
    useConpty: true
  });

  console.log(`[Terminal] Claude spawned (PID: ${ptyProcess.pid})`);

  ptyProcess.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });

  ptyProcess.onExit(({ exitCode }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(`\r\n\x1b[31m[Claude exited: ${exitCode}]\x1b[0m\r\n`);
      ws.close();
    }
  });

  ws.on('message', (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());
      if (msg.type === 'input' && msg.data) ptyProcess.write(msg.data);
      else if (msg.type === 'resize') ptyProcess.resize(msg.cols, msg.rows);
    } catch {
      ptyProcess.write(rawData.toString());
    }
  });

  ws.on('close', () => { try { ptyProcess.kill(); } catch {} });
}

// ═══════════════════════════════════════════════════
// 聊天模式：ANSI → HTML 转换（用于前端对话框）
// ═══════════════════════════════════════════════════
function handleChatMode(ws) {
  const fs = require('fs');
  if (!fs.existsSync(CLAUDE_EXE)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Claude CLI not found' }));
    ws.close(); return;
  }

  let activePty = null;
  let activeTimeout = null;
  let outputBuffer = '';
  let htmlBuffer = '';
  let lastActivity = Date.now();
  let idleCheckInterval = null;
  let currentRequestId = null;
  let isProcessing = false;

  // 发送 HTML chunk 给前端
  function flushHtml(force = false) {
    if (!currentRequestId || htmlBuffer === '') return;

    // 只在有显著内容变化或强制刷新时发送
    const now = Date.now();
    if (force || now - lastActivity > 200) {
      // content 字段包含被转义的 HTML（React 会将其作为纯文本显示）
      // MutationObserver 会检测并反转义为 innerHTML
      const escapedHtml = htmlBuffer
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      ws.send(JSON.stringify({
        type: 'chunk',
        content: `[[HTML]]${escapedHtml}[[/HTML]]`,
        html: htmlBuffer,
        requestId: currentRequestId
      }));
      htmlBuffer = '';
    }
  }

  // 空闲检测：当输出停止时发送 complete
  function startIdleCheck() {
    if (idleCheckInterval) clearInterval(idleCheckInterval);
    idleCheckInterval = setInterval(() => {
      const idle = Date.now() - lastActivity;
      if (isProcessing && idle > 2000) {
        // 2秒无输出，认为回复结束
        flushHtml(true);
        ws.send(JSON.stringify({ type: 'complete', requestId: currentRequestId }));
        isProcessing = false;
        if (activePty) { try { activePty.kill(); } catch {} activePty = null; }
        clearInterval(idleCheckInterval);
        idleCheckInterval = null;
      }
    }, 500);
  }

  // 处理用户 prompt
  async function handlePrompt(msg) {
    const { prompt, requestId, systemPrompt } = msg;
    currentRequestId = requestId;
    outputBuffer = '';
    htmlBuffer = '';
    isProcessing = true;
    lastActivity = Date.now();

    // 杀掉旧进程
    if (activePty) { try { activePty.kill(); } catch {} activePty = null; }
    if (activeTimeout) { clearTimeout(activeTimeout); activeTimeout = null; }
    if (idleCheckInterval) { clearInterval(idleCheckInterval); idleCheckInterval = null; }

    // 为每个 prompt 创建新的 Claude 进程
    // skill 模式检测：prompt 以 / 开头表示 skill 触发
    const useSkillMode = prompt && prompt.trim().startsWith('/');
    const args = [];
    if (!useSkillMode) args.push('--bare'); // skill 模式去掉 --bare 让 Claude 正常解析 slash command
    if (systemPrompt) args.push('--system-prompt', systemPrompt);
    if (useSkillMode) console.log(`[Chat] 🎯 Skill 模式: "${prompt.slice(0, 60)}..."`);
    else console.log(`[Chat] 普通模式: "${prompt.slice(0, 60)}..."`);

    activePty = pty.spawn(CLAUDE_EXE, args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: process.cwd(),
      env: process.env,
      useConpty: true
    });

    console.log(`[Chat] New Claude PTY spawned (PID: ${activePty.pid}) for request ${requestId}`);

    // 创建新的转换器实例（每个会话独立）
    const converter = new AnsiToHtml({
      fg: '#cccccc',
      bg: '#0c0c0c',
      newline: true,
      escapeXML: true,
      stream: true
    });

    // 收集输出的定时器
    let collectTimer = null;
    let pendingData = '';

    function processData(data) {
      pendingData += data;
      lastActivity = Date.now();

      // 防抖：100ms 后统一处理
      clearTimeout(collectTimer);
      collectTimer = setTimeout(() => {
        if (pendingData === '') return;

        outputBuffer += pendingData;

        // 过滤掉不想要的 ANSI 序列
        // 1. OSC 标题序列
        pendingData = pendingData.replace(/\x1b\][0-9]+;[^\x07]*\x07/g, '');
        // 2. 光标显示/隐藏
        pendingData = pendingData.replace(/\x1b\[\?25[lh]/g, '');
        // 3. 2004h/l (bracketed paste)
        pendingData = pendingData.replace(/\x1b\[\?2004[hl]/g, '');
        // 4. 1004h/l (focus events)
        pendingData = pendingData.replace(/\x1b\[\?1004[hl]/g, '');
        // 5. 2031h/l
        pendingData = pendingData.replace(/\x1b\[\?2031[hl]/g, '');
        // 6. 2026h/l (synchronized output)
        pendingData = pendingData.replace(/\x1b\[\?2026[hl]/g, '');
        // 7. 清除行尾
        pendingData = pendingData.replace(/\x1b\[0?K/g, '');
        // 8. 清屏和光标归位（只在开头时保留，否则忽略）
        // 保留内容，但去掉控制序列

        // 转换为 HTML
        const html = converter.toHtml(pendingData);
        htmlBuffer += html;
        pendingData = '';

        // 实时推送
        flushHtml();
      }, 100);
    }

    activePty.onData(processData);

    activePty.onExit(({ exitCode }) => {
      console.log(`[Chat] Claude exited (code: ${exitCode}) for request ${requestId}`);
      isProcessing = false;
      clearTimeout(collectTimer);
      flushHtml(true);
      ws.send(JSON.stringify({ type: 'complete', requestId }));
      if (idleCheckInterval) { clearInterval(idleCheckInterval); idleCheckInterval = null; }
      activePty = null;
    });

    // 等待进程初始化后写入 prompt
    setTimeout(() => {
      if (activePty) {
        activePty.write(prompt + '\r');
        startIdleCheck();
      }
    }, 800);

    // 安全超时：60秒后强制结束
    activeTimeout = setTimeout(() => {
      if (activePty && isProcessing) {
        console.log(`[Chat] Timeout for request ${requestId}`);
        flushHtml(true);
        ws.send(JSON.stringify({ type: 'complete', requestId }));
        try { activePty.kill(); } catch {}
        activePty = null;
        isProcessing = false;
      }
    }, 60000);
  }

  ws.on('message', async (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());

      if (msg.type === 'prompt' && msg.prompt) {
        await handlePrompt(msg);
      }
      else if (msg.type === 'cancel' && msg.requestId) {
        if (activePty) {
          try { activePty.kill(); } catch {}
          activePty = null;
        }
        if (activeTimeout) { clearTimeout(activeTimeout); activeTimeout = null; }
        if (idleCheckInterval) { clearInterval(idleCheckInterval); idleCheckInterval = null; }
        isProcessing = false;
        ws.send(JSON.stringify({ type: 'complete', requestId: msg.requestId }));
      }
    } catch (e) {
      console.error('[Chat] Message error:', e);
    }
  });

  ws.on('close', () => {
    if (activePty) { try { activePty.kill(); } catch {} }
    if (activeTimeout) clearTimeout(activeTimeout);
    if (idleCheckInterval) clearInterval(idleCheckInterval);
  });
}

// ═══════════════════════════════════════════════════
// 启动
// ═══════════════════════════════════════════════════
server.listen(PORT, HOST, () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║         Claude Terminal Gateway                   ║
╠═══════════════════════════════════════════════════╣
║  Terminal:  http://${HOST}:${PORT}                     ║
║  Chat WS:   ws://${HOST}:${PORT}?mode=chat              ║
╠═══════════════════════════════════════════════════╣
║  Claude:    ${CLAUDE_EXE.split('/').pop().padEnd(35)}║
╚═══════════════════════════════════════════════════╝
`);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  wss.clients.forEach(ws => ws.close());
  server.close(() => process.exit(0));
});
