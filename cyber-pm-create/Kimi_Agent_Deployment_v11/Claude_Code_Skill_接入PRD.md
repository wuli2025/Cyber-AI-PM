# Claude Code + Skill 接入 PRD

## 一、背景与问题

### 1.1 现状

当前系统是**前后端分离架构**：

```
前端 (index.html)
   ├─ 从 /api/config 获取配置 (wsURL, wsToken, useClaudeCode, useSkillMode, personaToSkill)
   ├─ ClaudeWS 已实现基础 WebSocket 单例连接 + 重连
   └─ ChatAPI 仍然走 → HTTP POST → backend/server.js → Minimax API ❌

后端 (backend/server.js)
   ├─ Minimax API（需要 API Key，有费用）
   └─ System Prompt 方式注入人格（效果弱，无工具能力）

agent-ws (端口 9999)
   ├─ 已修复 buildSystemPromptFile ✅（避免 Windows 8191 字符限制）
   ├─ 已部署到 ~/.claude/skills/ ✅
   ├─ Mode: unrestricted（允许工具调用）
   └─ 但前端 ChatAPI 没有调用它
```

**核心问题**：前端虽然有 ClaudeWS 和 config 框架，但 ChatAPI 实际走的仍是 Minimax HTTP API，没有真正连上 Claude Code。

### 1.2 为什么需要 Claude Code

| 维度 | Minimax API | Claude Code |
|------|------------|-------------|
| 工具能力 | ❌ 无 | ✅ WebSearch / 文件读写 / MCP |
| Skill 机制 | ❌ 用 system prompt 模拟 | ✅ 原生 `/<skill-name>` 触发 |
| 联网搜索 | ❌ 无 | ✅ 真正搜索竞品/市场数据 |
| 成本 | 按 token 计费 | 用本地 Claude Code（用户账号） |
| 写 PRD | 靠预训练知识 | 能实时搜最新竞品 |

---

## 二、目标

**前端直接通过 WebSocket 长连接调用 Claude Code，每人格对应一个 Skill，真正具备工具调用和联网能力。**

### 非目标

- 不改后端 MiniMax API（保留作为备用/降级方案）
- 不改 agent-ws（已就绪）
- 不改现有 React 前端组件（只改 index.html 中的 ChatAPI）

---

## 三、产品功能

### 3.1 人格 ↔ Skill 映射

| 人格 ID | 人格名称 | Skill Name | 文件路径 |
|--------|---------|-----------|---------|
| yujun | 俞军 | `/yu-jun-pm` | `~/.claude/skills/yu-jun-pm/SKILL.md` |
| jobs | 乔布斯 | `/steve-jobs-perspective` | `~/.claude/skills/steve-jobs-perspective/SKILL.md` |
| musk | 马斯克 | `/elon-musk-perspective` | `~/.claude/skills/elon-musk-perspective/SKILL.md` |
| ma | 马化腾 | `/pony-ma-pm` | `~/.claude/skills/pony-ma-pm/SKILL.md` |
| zhang | 张一鸣 | `/openclaw-product-blueprint` | `~/.claude/skills/openclaw-product-blueprint/SKILL.md` |
| jiaoyuan | 教员 | `/mao-ze-dong-pm` | `~/.claude/skills/mao-ze-dong-pm/SKILL.md` |

**触发方式**：在用户消息前拼接 `/<skill-name>`，Claude Code 自动识别并加载对应 Skill。

### 3.2 交互流程

```
用户点击人格按钮（如"乔布斯"）
   ↓
前端切换 _selectedPersona = 'jobs'
   ↓
用户发送消息（如"帮我做一个AI会议助手的产品规划"）
   ↓
ChatAPI 查询 PERSONA_TO_SKILL['jobs'] → 'steve-jobs-perspective'
   ↓
构造 finalPrompt = "/steve-jobs-perspective 帮我做一个AI会议助手的产品规划"
   ↓
ClaudeWS.sendPrompt({ prompt: finalPrompt, projectId: 'jobs' })
   ↓
WebSocket → agent-ws → Claude Code CLI
   ↓
Claude Code 识别 /steve-jobs-perspective → 加载 skill
   ↓
Skill 触发自动行为（竞品扫描、PRD 生成）
   ↓
流式输出回答
```

### 3.3 模式切换

支持两种模式：

| 模式 | useSkillMode | 行为 | 适用场景 |
|------|------------|------|---------|
| Skill 模式 | `true` | 消息前加 `/<skill-name>` | **主要场景**，需要人格方法论 + 工具 |
| System Prompt 模式 | `false` | 通过 `--system-prompt-file` 传人格描述 | 备用，不需要 skill 能力 |

### 3.4 思考深度（thinkingTokens）

| 前端 Mode | thinkingTokens | Claude Code 行为 |
|-----------|-------------|----------------|
| quick | 0 | 不启用 thinking，直接回答 |
| pro | 8000 | 适中思考预算 |
| deep | 32000 | 满血思考，深度分析 |

---

## 四、技术方案

### 4.1 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    前端 (index.html)                       │
│                                                             │
│  ┌─────────────┐     ┌──────────────────┐              │
│  │ ChatAPI     │────▶│ ClaudeWS         │              │
│  │ (改造点)    │     │ (已就绪)         │              │
│  └─────────────┘     └────────┬─────────┘              │
│                                │ WebSocket              │
│  ┌─────────────┐              │                       │
│  │ 人格选择    │──────────────▶│ (prompt 前加 /skill) │
│  └─────────────┘              │                       │
└────────────────────────────────┼──────────────────────┘
                                 │
                    ws://localhost:9999
                                 ↓
┌─────────────────────────────────────────────────────────────┐
│              agent-ws (端口 9999)                          │
│  Mode: unrestricted                                       │
│  spawn → Claude Code CLI                                  │
│    ├── --print --verbose --output-format stream-json       │
│    ├── --system-prompt-file <临时文件> (备用)             │
│    └── --dangerously-skip-permissions                       │
└────────────────────────────────┼─────────────────────────┘
                                 │
                    Claude Code CLI (本地)
                                 ↓
┌─────────────────────────────────────────────────────────────┐
│  ~/.claude/skills/                                      │
│  ├── yu-jun-pm/SKILL.md         (俞军产品方法论)        │
│  ├── steve-jobs-perspective/    (乔布斯思维框架)          │
│  ├── elon-musk-perspective/    (马斯克第一性原理)         │
│  ├── pony-ma-pm/SKILL.md       (马化腾灰度法则)          │
│  ├── openclaw-product-blueprint/(张一鸣产品规划)         │
│  └── mao-ze-dong-pm/          (毛泽东战略思维)          │
│                                                             │
│  每个 SKILL.md 包含：                                    │
│    - 前置描述（触发条件、描述）                          │
│    - 身份卡（第一人称）                                │
│    - 核心心智模型（框架、示例）                         │
│    - 决策启发式                                         │
│    - 表达 DNA（语气、句式、高频词）                    │
│    - 价值观与反模式                                     │
│    - PRD 写作模板（自动触发时生成完整 PRD）              │
└─────────────────────────────────────────────────────────┘
```

### 4.2 后端 /api/config 接口

新增后端接口，为前端提供 Claude Code 接入配置：

```javascript
// backend/server.js 新增接口
app.get('/api/config', (req, res) => {
  res.json({
    wsURL: 'ws://localhost:9999',
    wsToken: '',                    // agent-ws --no-auth 模式下不需要 token
    useClaudeCode: true,            // 启用 Claude Code 模式
    useSkillMode: true,            // 使用 /<skill-name> 触发模式
    defaultMode: 'pro',            // 默认思考深度
    defaultPersona: 'yujun',      // 默认人格
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
```

### 4.3 前端 ClaudeWS 改造

**现状**（line 80-129）：已有单例连接 + 重连，但缺少 `sendPrompt`

**需要新增**：

```javascript
window.ClaudeWS = {
  // ... 现有 connect() ...

  sendPrompt({ prompt, requestId, projectId, thinkingTokens, onChunk, onDone, onError }) {
    // 1. 确保已连接
    // 2. 注册 pendingRequests[requestId]
    // 3. ws.send(JSON.stringify({ type: 'prompt', ... }))
  },

  cancelRequest(requestId) {
    // ws.send(JSON.stringify({ type: 'cancel', requestId }))
  }
};
```

### 4.4 前端 ChatAPI 改造

**现状**（line 131-182）：走 HTTP POST → Minimax API

**改为**：

```javascript
window.ChatAPI = {
  async sendMessage(message, persona_id, mode, history) {
    // 1. 解析 persona_id
    // 2. 查询 PERSONA_TO_SKILL[persona_id]
    // 3. 构造 finalPrompt = `/<skill-name> ${message}`
    // 4. 调用 ClaudeWS.sendPrompt(...)
    // 5. 返回 ReadableStream（兼容 React 组件）
  }
};
```

### 4.5 agent-ws 配置

**启动命令**（已验证可工作）：

```bash
node dist/cli.js \
  --port 9999 \
  --host localhost \
  --no-auth \
  --mode unrestricted \
  --claude-path "C:\\Users\\Lenovo\\AppData\\Roaming\\npm\\claude.cmd"
```

**参数说明**：
- `--no-auth`：不需要 token，简化本地开发
- `--mode unrestricted`：允许 Claude Code 执行所有工具（WebSearch、文件读写等）
- 已在之前修复 `--system-prompt-file` 避免 Windows 8191 字符限制

---

## 五、数据流详解

### 5.1 单次对话完整流程

```
1. 用户在 React 前端点击人格"乔布斯"按钮
   → 前端 DOM 监听捕获点击，更新 _selectedPersona = 'jobs'
   → UI 高亮乔布斯按钮

2. 用户输入消息："帮我做一个AI会议助手的产品规划"
   → React 组件调用 window.ChatAPI.sendMessage(message, 'jobs', 'pro', [])

3. ChatAPI.sendMessage() 执行：
   → skillName = PERSONA_TO_SKILL['jobs'] = 'steve-jobs-perspective'
   → finalPrompt = '/steve-jobs-perspective 帮我做一个AI会议助手的产品规划'
   → thinkingTokens = 8000 (pro 模式)
   → requestId = `req_${Date.now()}_${random}`

4. ClaudeWS.sendPrompt() 执行：
   → 确保 ws 已连接（若未连接则等待）
   → ws.send({ type: 'prompt', prompt: finalPrompt, requestId, projectId: 'jobs', thinkingTokens })

5. agent-ws 接收请求：
   → 记录请求日志
   → spawn Claude Code CLI 进程

6. Claude Code CLI 执行：
   → 识别 `/steve-jobs-perspective` → 加载 skill
   → Skill 触发"自动扫描竞品"行为
   → 流式输出到 stdout

7. agent-ws 解析 stdout 流：
   → { type: 'content_block_delta', delta: { type: 'text_delta', text: '...' } }
   → → WebSocket 推送给前端

8. 前端 ClaudeWS 接收消息：
   → parse JSON
   → pendingRequests[requestId].onChunk(content)
   → → React ReadableStream controller.enqueue

9. React 组件处理流：
   → 渲染到聊天界面
   → 用户实时看到 AI 输出

10. AI 调用工具（WebSearch）：
    → Claude Code 自动执行搜索
    → 结果流式回传
    → 最终输出完整 PRD
```

### 5.2 思考过程处理

Claude Code 在启用 thinkingTokens 时会输出 `<thinking>` 标签内容（`thinking: true`）。

**处理方式**：前端将 thinking 内容以不同样式渲染（如灰色/折叠），用户可选择是否显示。

---

## 六、消息协议

### 6.1 agent-ws WebSocket 协议（已有）

**Client → Server**：
```typescript
{
  type: 'prompt',
  prompt: string,
  requestId: string,
  provider: 'claude',  // | 'codex'
  systemPrompt?: string,  // 备用
  projectId?: string,
  thinkingTokens?: number
}
```

**Server → Client**：
```typescript
{ type: 'connected', version: string, agent: string }
{ type: 'chunk', content: string, requestId: string, thinking?: boolean }
{ type: 'complete', requestId: string }
{ type: 'error', message: string, requestId?: string }
```

---

## 七、异常处理

| 场景 | 处理方式 |
|------|---------|
| Claude Code CLI 未安装 | 提示用户安装 Claude Code |
| agent-ws 未启动 | 前端显示"连接中..."，自动重试 |
| WebSocket 断线 | 指数退避重连（最多5次），请求缓存 |
| 工具执行超时 | Claude Code 内置超时，AI 会重试或跳过 |
| Skill 不存在 | Claude Code 回退到默认行为 |
| 需要权限确认 | unrestricted 模式跳过所有确认 |

---

## 八、部署与运维

### 8.1 服务启动顺序

```bash
# 1. 启动 agent-ws（一次性）
cd /d/ai产品经理/agent-ws
node dist/cli.js --port 9999 --host localhost --no-auth --mode unrestricted \
  --claude-path "C:\\Users\\Lenovo\\AppData\\Roaming\\npm\\claude.cmd" &

# 2. 启动后端（保留，/api/config 仍需要）
cd /d/ai产品经理/backend
node server.js &

# 3. 启动前端
cd /d/ai产品经理/Kimi_Agent_Deployment_v11
npx serve .
```

### 8.2 Skill 更新

更新人格 Skill 时，只需修改对应文件：

```bash
# 例如更新乔布斯 skill
# 编辑 ~/.claude/skills/steve-jobs-perspective/SKILL.md
# 重启前端即可生效（agent-ws 每次请求 spawn 新进程，会自动读最新文件）
```

### 8.3 降级方案

当 Claude Code 不可用时，可切回 Minimax API：

```javascript
// 前端临时切换回 Minimax
_appConfig.useClaudeCode = false;
// ChatAPI 会自动走 HTTP → backend → Minimax
```

---

## 九、实施计划

### Phase 1：核心链路（优先）

| 任务 | 工作量 | 说明 |
|------|--------|------|
| 后端新增 `/api/config` 接口 | 30min | 返回 WS 地址和人格映射 |
| 前端 ClaudeWS 增加 `sendPrompt` | 1h | 完成 WebSocket 完整通信 |
| 前端 ChatAPI 改用 ClaudeWS | 1h | 替换 HTTP 为 WebSocket |
| 测试完整对话流程 | 1h | 端到端验证 |
| **预计** | **~3h** | |

### Phase 2：体验优化

| 任务 | 工作量 | 说明 |
|------|--------|------|
| thinking 内容隔离渲染 | 1h | 灰色/折叠显示思考过程 |
| 工具调用可视化 | 2h | 显示"正在搜索..."等状态 |
| 连接状态指示器 | 30min | 前端显示 WS 连接状态 |
| **预计** | **~3.5h** | |

---

## 十、风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| Windows 命令行长度限制 | 大 system prompt 被截断 | 已用 `--system-prompt-file` 修复 |
| Claude Code 认证失效 | 无法调用 | 提示用户重新 `claude login` |
| 工具调用超时 | 回答卡住 | unrestricted 模式有内置超时 |
| 多标签页并发 | 多个 Claude 进程 | agent-ws 每个连接 spawn 一个进程，可接受 |
| Skill 触发失败 | 回退默认行为 | Claude Code 会静默回退 |

---

## 十一、验收标准

### Phase 1 完成条件

- [ ] 点击"乔布斯" → 发消息 → AI 加载 `/steve-jobs-perspective` skill
- [ ] AI 真正调用 WebSearch 搜索竞品（不是假装的）
- [ ] 流式输出完整 PRD（包含市场分析、竞品表格、功能规划）
- [ ] 切换到"俞军" → 发消息 → AI 加载 `/yu-jun-pm` skill
- [ ] 人格回复风格符合对应人物方法论（乔布斯聚焦、俞军价值公式等）
- [ ] 无需刷新页面，连续对话保持会话上下文
