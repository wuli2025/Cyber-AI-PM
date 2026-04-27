/**
 * Claude Code 进程管理
 * 通过子进程调用本地 Claude CLI，流式返回响应
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Windows 上需要完整路径或 .cmd 后缀
const CLAUDE_CMD = process.env.CLAUDE_COMMAND ||
  (process.platform === 'win32'
    ? 'claude.cmd'
    : 'claude');
const PROCESS_TIMEOUT = parseInt(process.env.PROCESS_TIMEOUT || '120000');

function writeTempSystemPrompt(systemPrompt, requestId) {
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, `claude-sys-${requestId}.txt`);
  fs.writeFileSync(filePath, systemPrompt, 'utf-8');
  return filePath;
}

function cleanupTempFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.warn(`[Claude] Cleanup failed: ${e.message}`);
  }
}

/**
 * 流式调用 Claude Code
 * @param {string} systemPrompt - 系统提示词
 * @param {string} userMessage - 用户消息
 * @param {object} handlers - 回调处理函数
 * @param {function} handlers.onChunk - 收到内容块回调 (text: string) => void
 * @param {function} handlers.onDone - 完成回调 () => void
 * @param {function} handlers.onError - 错误回调 (error: string) => void
 * @returns {function} 停止函数，调用后可终止进程
 */
function streamClaude(systemPrompt, userMessage, handlers) {
  const { onChunk, onDone, onError } = handlers;
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const promptFile = writeTempSystemPrompt(systemPrompt, requestId);

  console.log(`[Claude] Starting: ${requestId}`);

  // Windows 上使用 shell 执行
  const isWindows = process.platform === 'win32';
  const args = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--system-prompt-file', promptFile,
    '--dangerously-skip-permissions',
    '--permission-mode', 'bypassPermissions',
    userMessage
  ];

  let proc;
  if (isWindows) {
    // Windows: 使用 cmd /c 执行完整命令
    const cmd = `claude ${args.map(a => `"${a}"`).join(' ')}`;
    proc = spawn('cmd', ['/c', cmd], {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' }
    });
  } else {
    proc = spawn(CLAUDE_CMD, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' }
    });
  }

  let buffer = '';
  let errorBuffer = '';
  let completed = false;

  // stdout: JSON 流
  proc.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = '';

    for (const line of lines) {
      if (!line.trim()) continue;

      // 解析 stream-json 格式
      // 格式可能是 {"type":"...","..."} 或 data: {"type":"...",...} 或 {"type":"...","event":{...}}
      let json = null;
      try {
        const raw = line.startsWith('data: ') ? line.slice(6) : line;
        json = JSON.parse(raw);
      } catch (e) {
        continue;
      }

      if (!json || !json.type) continue;

      // stream_event: 真正的流式输出
      if (json.type === 'stream_event' && json.event) {
        const event = json.event;

        // content_block_delta: 文本内容块
        if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            if (onChunk && !completed) {
              onChunk(delta.text);
            }
          }
        }
        continue;
      }

      // content_block_delta: 文本内容块（部分模型）
      if (json.type === 'content_block_delta' && json.delta?.text) {
        if (onChunk && !completed) {
          onChunk(json.delta.text);
        }
      }

      // partial-message: 部分消息（流式输出）
      if (json.type === 'partial-message' && json.message?.content) {
        const content = json.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              if (onChunk && !completed) {
                onChunk(block.text);
              }
            }
          }
        }
      }

      // assistant 消息: 包含完整 content（只有当没有 stream_event 时才处理，避免重复）
      // 注意：assistant 消息包含完整内容，与 stream_event 重复，所以跳过
      // 我们只依赖 stream_event 来进行真正的流式输出

      // result: 最终结果（跳过，避免重复）
      // stream_event 已经提供了流式输出，result 可能包含重复内容
    }
  });

  // stderr: 错误信息
  proc.stderr.on('data', (data) => {
    errorBuffer += data.toString();
  });

  // 进程结束
  proc.on('close', (code) => {
    cleanupTempFile(promptFile);

    console.log(`[Claude] Exit: ${requestId}, code: ${code}`);

    if (completed) return;
    completed = true;

    if (code !== 0) {
      const errorMsg = errorBuffer.trim() || 'Claude Code 执行失败';
      if (onError) onError(errorMsg);
    } else {
      if (onDone) onDone();
    }
  });

  // 超时处理
  const timeout = setTimeout(() => {
    if (completed) return;
    completed = true;
    console.warn(`[Claude] Timeout: ${requestId}`);
    proc.kill('SIGTERM');
    cleanupTempFile(promptFile);
    if (onError) onError('处理超时，请重试');
  }, PROCESS_TIMEOUT);

  // 返回停止函数
  return function stop() {
    if (completed) return;
    completed = true;
    clearTimeout(timeout);
    proc.kill('SIGTERM');
    cleanupTempFile(promptFile);
    console.log(`[Claude] Stopped: ${requestId}`);
  };
}

function checkClaudeAvailable() {
  return new Promise((resolve) => {
    // Windows 上使用 shell 执行
    const isWindows = process.platform === 'win32';
    const proc = spawn(isWindows ? 'cmd' : CLAUDE_CMD,
      isWindows ? ['/c', 'claude --version'] : ['--version'], {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

    let output = '';
    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && output.trim()) {
        console.log(`[Claude] Version: ${output.trim()}`);
        resolve(true);
      } else {
        console.error('[Claude] Not found or not working');
        resolve(false);
      }
    });

    proc.on('error', (e) => {
      console.error('[Claude] Error:', e.message);
      resolve(false);
    });

    // 5秒超时
    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 5000);
  });
}

module.exports = {
  streamClaude,
  checkClaudeAvailable,
  PROCESS_TIMEOUT
};
