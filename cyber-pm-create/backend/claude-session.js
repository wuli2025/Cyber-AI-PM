/**
 * Claude Code 长连接会话管理器 v3
 * 使用 PTY (node-pty) 实现真正的交互式长连接
 */

const pty = require('node-pty');
const os = require('os');
const path = require('path');
const fs = require('fs');

const PROCESS_TIMEOUT = parseInt(process.env.PROCESS_TIMEOUT || '120000');

/**
 * Claude 交互式会话
 * 使用 PTY 启动 Claude Code interactive 模式
 */
class ClaudePtySession {
  constructor(sessionId, systemPrompt, handlers) {
    this.id = sessionId;
    this.systemPrompt = systemPrompt;
    this.handlers = handlers;
    this.pty = null;
    this.buffer = '';
    this.completed = false;
    this.lastActivity = Date.now();

    this.startPty();
  }

  startPty() {
    const isWindows = os.platform() === 'win32';
    const shell = isWindows ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
    const claudeCmd = 'claude';

    console.log(`[Session ${this.id}] Starting PTY with Claude`);

    this.pty = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: process.cwd(),
      env: {
        ...process.env,
        NO_COLOR: '1',
        CLAUDE_API_KEY: process.env.ANTHROPIC_API_KEY || 'skip'
      }
    });

    this.pty.onData((data) => {
      this.lastActivity = Date.now();
      this.buffer += data;
      this.processBuffer();
    });

    this.pty.onExit(({ exitCode }) => {
      console.log(`[Session ${this.id}] PTY exited: ${exitCode}`);
      if (!this.completed) {
        this.completed = true;
        this.handlers.onClose?.();
      }
    });

    this.pty.onError((err) => {
      console.error(`[Session ${this.id}] PTY Error:`, err.message);
      this.handlers.onError?.(err.message);
    });

    // 等待启动完成，然后发送初始命令
    setTimeout(() => {
      this.initialize();
    }, 1000);
  }

  initialize() {
    // 构建初始化命令
    // 使用 --print 模式，但通过 PTY 交互
    const promptFile = path.join(os.tmpdir(), `claude-sys-${this.id}.txt`);
    fs.writeFileSync(promptFile, this.systemPrompt, 'utf-8');

    const cmd = `claude --print --verbose --output-format stream-json --system-prompt-file "${promptFile}" --dangerously-skip-permissions --permission-mode bypassPermissions --no-session-persistence\r`;
    this.pty.write(cmd);

    console.log(`[Session ${this.id}] Initialized with system prompt`);
  }

  processBuffer() {
    // 检测内容块输出
    // Claude stream-json 输出格式：{"type":"stream_event","event":{...}}

    let lines = this.buffer.split('\n');
    this.buffer = '';

    for (const line of lines) {
      if (!line.trim() || !line.startsWith('{')) continue;

      try {
        const json = JSON.parse(line);

        if (json.type === 'stream_event' && json.event) {
          const event = json.event;

          if (event.type === 'content_block_delta') {
            const delta = event.delta;
            if (delta?.type === 'text_delta' && delta.text) {
              this.handlers.onChunk?.(delta.text);
            }
          }

          if (event.type === 'message_delta') {
            this.handlers.onDone?.();
          }
        }

        // result
        if (json.type === 'result') {
          this.handlers.onDone?.();
        }
      } catch (e) {
        // 不是 JSON，可能是纯文本输出
      }
    }
  }

  sendMessage(message) {
    if (!this.pty || this.pty.exitCode !== undefined) {
      // 进程已退出，重启
      this.startPty();
      return false;
    }

    this.lastActivity = Date.now();

    // 写入消息
    console.log(`[Session ${this.id}] Sending: ${message.slice(0, 50)}...`);
    this.pty.write(message + '\r');

    return true;
  }

  resize(cols, rows) {
    if (this.pty) {
      this.pty.resize(cols, rows);
    }
  }

  close() {
    if (this.completed) return;
    this.completed = true;

    if (this.pty) {
      this.pty.kill();
      this.pty = null;
    }

    console.log(`[Session ${this.id}] Closed`);
  }
}

// 会话管理器
const sessionManager = {
  sessions: new Map(),

  create(sessionId, systemPrompt, handlers) {
    // 关闭旧的同名会话
    if (this.sessions.has(sessionId)) {
      this.close(sessionId);
    }

    const session = new ClaudePtySession(sessionId, systemPrompt, handlers);
    this.sessions.set(sessionId, session);
    return session;
  },

  get(sessionId) {
    return this.sessions.get(sessionId);
  },

  close(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.close();
      this.sessions.delete(sessionId);
    }
  },

  closeAll() {
    for (const [id, session] of this.sessions) {
      session.close();
    }
    this.sessions.clear();
  },

  get size() {
    return this.sessions.size;
  }
};

module.exports = sessionManager;
