# Claude Code Web Chat — 产品需求文档

> 版本：v2.0（保持 UI 不变版）
> 日期：2026-04-27
> 作者：AI 产品思维实验室

---

## 一、产品背景

### 1.1 现状分析

当前系统架构：
- `backend/server.js` → 通过 Minimax API 调用大模型（HTTP SSE）
- `Kimi_Agent_Deployment_v11/` → React 前端（已打包，无法修改源码）
- `agent-ws-bridge/bridge.js` → HTTP API 网关（不稳定）

**存在的主要问题**：

| 问题 | 影响 |
|------|------|
| API 网关不稳定 | bridge 层频繁断开 |
| 回答质量不够专业 | 通用的 API 模式无法提供足够深度的专业回答 |
| 无法利用 Claude Code 的工具能力 | 文件操作、代码执行等能力无法使用 |
| 人格切换依赖 System Prompt | 切换不够灵活 |

### 1.2 用户痛点

- 现有 UI 样式已经很美观，不想改变
- 希望对话回复由 Claude Code 生成（更专业）
- 左侧人格切换要能正常工作
- 连接要稳定

### 1.3 目标

**保持现有 UI 完全不变**，只替换后端对话引擎：
- 后端新增 Claude Code WebSocket 服务（端口 3011）
- `backend/server.js` 的 `/api/chat` 路由改为调用 Claude Code
- 前端配置指向新的 Claude Code 服务
- 零网关方案，直连本地 Claude Code 进程

---

## 一、核心原则

### 1. UI 样式零改动
- 所有 CSS 样式保持不变
- 所有 React 组件保持不变
- 只修改数据流和 API 调用

### 2. 配置驱动
- 前端 `index.html` 中配置 API 地址
- 后端服务地址统一为 `ws://localhost:3011`

### 3. 向后兼容
- 保留 Minimax API 模式作为降级方案
- 通过环境变量切换

---

## 二、技术方案（保持 UI 不变）

### 2.1 系统架构

```
┌────────────────────────────────────────────────────────────────────┐
│              Kimi_Agent_Deployment_v11 (现有 React 前端)          │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  index.html (配置 API 地址)                                 │  │
│  │  React 组件 (已打包，保持不变)                               │  │
│  │  - 人格切换侧边栏                                           │  │
│  │  - 对话区域 (Markdown 渲染)                                 │  │
│  │  - 消息输入框                                               │  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬───────────────────────────────────────┘
                              │ HTTP POST /api/chat (SSE)
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│                    backend/server.js (修改)                         │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  /api/chat 路由 → 改为调用 Claude Code                      │  │
│  │  /api/personas 路由 → 返回人格列表                          │  │
│  │  /api/config 路由 → 返回配置                                │  │
│  │                                                              │  │
│  │  ┌────────────────┐  ┌────────────────┐  ┌─────────────┐ │  │
│  │  │ Claude Process │  │  Skill Loader  │  │ Persona Mgr │ │  │
│  │  │  子进程管理    │  │  人格框架加载   │  │  思考模式   │ │  │
│  │  └────────────────┘  └────────────────┘  └─────────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬───────────────────────────────────────┘
                              │ spawn claude --print
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│                      Claude Code CLI (本地)                        │
│                                                              │  │
│  claude --print --output-format stream-json \                  │  │
│          --system-prompt-file <temp_file> \                   │  │
│          "<用户消息>"                                          │  │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 改动清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `backend/server.js` | 修改 | `/api/chat` 路由改为调用 Claude Code |
| `backend/personas.js` | 新增 | 人格配置（Skill 路径映射） |
| `backend/claude-process.js` | 新增 | Claude Code 进程管理 |
| `Kimi_Agent_Deployment_v11/index.html` | 配置修改 | API_BASE_URL 改为新后端地址 |

### 2.3 前端配置修改

**修改 `index.html` 第 13 行**：
```javascript
// 修改前
const API_BASE_URL = window.API_CONFIG_BASE_URL || (...);

// 修改后
const API_BASE_URL = window.API_CONFIG_BASE_URL || 'http://localhost:3011';
```

---

## 三、后端实现

### 3.1 项目结构

```
backend/
├── server.js           # 修改：/api/chat 改为调用 Claude Code
├── personas.js         # 新增：人格配置
├── claude-process.js   # 新增：Claude Code 进程管理
├── auth.js             # 保持不变
└── .env               # 配置
```

### 3.2 Claude Code 进程管理

**核心逻辑**：
```javascript
// claude-process.js
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const CLAUDE_CMD = process.env.CLAUDE_COMMAND || 'claude';
const PROCESS_TIMEOUT = 120000; // 120秒超时

export async function* streamClaudeResponse(systemPrompt, userMessage) {
  const requestId = `req_${Date.now()}`;
  const tmpFile = join(tmpdir(), `claude-sys-${requestId}.txt`);

  // 写入临时 system prompt 文件
  writeFileSync(tmpFile, systemPrompt, 'utf-8');

  const proc = spawn(CLAUDE_CMD, [
    '--print',
    '--output-format', 'stream-json',
    '--system-prompt-file', tmpFile,
    '--dangerously-skip-permissions',
    '--no-input',
    userMessage
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' }
  });

  let buffer = '';
  let errorBuffer = '';

  // stdout: JSON 流
  proc.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = '';

    for (const line of lines) {
      if (!line.trim()) continue;
      if (line.startsWith('data: ')) {
        try {
          const json = JSON.parse(line.slice(6));
          if (json.type === 'content_block_delta' && json.delta?.text) {
            yield { type: 'chunk', content: json.delta.text };
          }
        } catch {}
      }
    }
  });

  // stderr: 错误信息
  proc.stderr.on('data', (data) => {
    errorBuffer += data.toString();
  });

  // 进程结束
  const exitCode = await new Promise((resolve) => {
    proc.on('close', resolve);
    setTimeout(() => {
      proc.kill('SIGTERM');
      resolve(-1);
    }, PROCESS_TIMEOUT);
  });

  // 清理临时文件
  try { unlinkSync(tmpFile); } catch {}

  if (exitCode !== 0) {
    yield { type: 'error', error: errorBuffer || 'Claude Code 执行失败' };
  } else {
    yield { type: 'done' };
  }
}
```

### 3.3 人格配置

```javascript
// personas.js
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const SKILL_BASE = process.env.SKILL_BASE_PATH || 'D:/ai产品经理';

export const PERSONA_CONFIG = {
  yujun: {
    name: '俞军',
    title: '中国产品经理教父',
    avatar: '俞',
    color: '#0D5B4A',
    skillPath: resolve(SKILL_BASE, 'yu-jun-perspective-skill', 'SKILL.md')
  },
  jobs: {
    name: '乔布斯',
    title: '交互与美学偏执者',
    avatar: '乔',
    color: '#C41E3A',
    skillPath: resolve(SKILL_BASE, 'steve-jobs-perspective', 'SKILL.md')
  },
  musk: {
    name: '马斯克',
    title: '第一性原理践行者',
    avatar: '马',
    color: '#1E90FF',
    skillPath: resolve(SKILL_BASE, 'elon-musk-perspective', 'SKILL.md')
  },
  ma: {
    name: '马化腾',
    title: '社交产品之王',
    avatar: '化',
    color: '#2E6BE6',
    skillPath: resolve(SKILL_BASE, 'pony-ma-pm', 'SKILL.md')
  },
  zhang: {
    name: '张一鸣',
    title: '推荐算法极致者',
    avatar: '鸣',
    color: '#E67E22',
    skillPath: resolve(SKILL_BASE, 'zhang-yiming-perspective', 'SKILL.md')
  },
  jiaoyuan: {
    name: '毛泽东（教员）',
    title: '战略思维大师',
    avatar: '毛',
    color: '#B22234',
    skillPath: resolve(SKILL_BASE, 'mao-ze-dong-pm', 'SKILL.md')
  }
};

const THINKING_MODES = {
  quick: '【Quick 快速回答】最低思考深度，直击要点。',
  pro: '【Pro 深度推理】中等思考深度，完整逻辑闭环。',
  deep: '【Deep 链式思考】最高思考深度，穷尽分析。'
};

export function loadSkill(personaId) {
  const config = PERSONA_CONFIG[personaId];
  if (!config?.skillPath) return null;
  if (!existsSync(config.skillPath)) return null;
  return readFileSync(config.skillPath, 'utf-8');
}

export function buildSystemPrompt(personaId, mode) {
  const config = PERSONA_CONFIG[personaId] || PERSONA_CONFIG.yujun;
  const skill = loadSkill(personaId);
  const thinking = THINKING_MODES[mode] || THINKING_MODES.pro;

  return [
    thinking,
    '',
    `═══════════════════════════════════════════════════════`,
    `【人格激活】你是：${config.name}`,
    `═══════════════════════════════════════════════════════`,
    '',
    skill || '',
    '',
    `═══════════════════════════════════════════════════════`,
    `【重要规则】`,
    `1. 直接以${config.name}的身份回应，不要说"作为AI"`,
    `2. 保持${config.name}的说话风格和思维方式`,
    `3. 遇到产品决策问题，先用该人格的框架分析，再给结论`,
    `═══════════════════════════════════════════════════════`
  ].join('\n');
}
```

### 3.4 Server.js 改造

```javascript
// 在 backend/server.js 中修改 /api/chat 路由

// 引入新模块
import { buildSystemPrompt, PERSONA_CONFIG } from './personas.js';
import { streamClaudeResponse } from './claude-process.js';

// 修改 /api/chat 路由
app.post('/api/chat', async (req, res) => {
  const { message, persona_id = 'yujun', mode = 'pro', history = [] } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  // 设置 SSE headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // 构建 system prompt
  const systemPrompt = buildSystemPrompt(persona_id, mode);

  // 流式输出
  try {
    for await (const event of streamClaudeResponse(systemPrompt, message)) {
      if (event.type === 'chunk') {
        res.write(`data: ${JSON.stringify({ content: event.content })}\n\n`);
      } else if (event.type === 'error') {
        res.write(`data: ${JSON.stringify({ error: event.error })}\n\n`);
        break;
      } else if (event.type === 'done') {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        break;
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }

  res.end();
});

// 修改 /api/personas 路由
app.get('/api/personas', (req, res) => {
  res.json(Object.entries(PERSONA_CONFIG).map(([id, config]) => ({
    id,
    name: config.name,
    avatar: config.avatar,
    color: config.color,
    title: config.title
  })));
});

// 修改 /api/config 路由
app.get('/api/config', (req, res) => {
  res.json({
    wsURL: `ws://localhost:${PORT}`,
    useClaudeCode: true,
    defaultMode: 'pro',
    defaultPersona: 'yujun'
  });
});
```

---

## 四、部署

### 4.1 环境要求

- Node.js 18+
- Claude Code CLI 已安装并配置（`claude --version` 可用）
- 端口 3011 未被占用

### 4.2 启动

```bash
cd D:/ai产品经理/cyber-pm-create/backend
node server.js
```

### 4.3 前端配置

修改 `Kimi_Agent_Deployment_v11/index.html` 第 13 行：
```javascript
const API_BASE_URL = 'http://localhost:3011';
```

### 4.4 环境变量

```bash
# backend/.env
SKILL_BASE_PATH=D:/ai产品经理
CLAUDE_COMMAND=claude
PROCESS_TIMEOUT=120000
PORT=3011
```

---

## 五、风险与应对

| 风险 | 概率 | 影响 | 应对措施 |
|------|------|------|----------|
| Claude Code 响应格式变化 | 低 | 高 | 预留解析容错，捕获原始输出 |
| 子进程僵死 | 中 | 中 | 超时杀死 + 自动重启 |
| Claude CLI 未安装 | 低 | 高 | 启动时检查，提供安装指引 |

---

## 六、实现清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/personas.js` | 新建 | 人格配置和 Skill 加载 |
| `backend/claude-process.js` | 新建 | Claude Code 进程管理 |
| `backend/server.js` | 修改 | `/api/chat` 改为调用 Claude Code |
| `Kimi_Agent_Deployment_v11/index.html` | 修改 | API_BASE_URL 配置 |
| `backend/.env` | 新建 | 环境变量配置 |

---

*PRD v2.0 - 保持 UI 不变版*
