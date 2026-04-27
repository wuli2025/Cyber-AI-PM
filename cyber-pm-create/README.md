# AI 产品思维实验室

一个基于多角色 AI 思维的系统，用户可以与不同领域的产品大师对话，获取专业视角的产品洞察。

## 项目架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户浏览器                                │
│                    http://localhost:3000                         │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Kimi_Agent_Deployment_v11                      │
│                       前端 (静态服务)                             │
│                         端口: 3000                               │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP POST /api/chat
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     agent-ws-bridge                              │
│                    HTTP → WebSocket 网桥                          │
│                         端口: 3011                               │
│  功能: 加载人格 Skill / 思考深度模式 / 人格映射                    │
└────────────────────────────┬────────────────────────────────────┘
                             │ WebSocket
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                        agent-ws                                  │
│                   Claude Code WebSocket 桥接                      │
│                         端口: 9999                               │
│  功能: 每连接启动独立 Claude Code 进程 / 流式输出                  │
└────────────────────────────┬────────────────────────────────────┘
                             │ stdio
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Claude Code CLI                             │
│                    (本地 AI Agent)                               │
└─────────────────────────────────────────────────────────────────┘
```

## 目录结构

```
D:\ai产品经理\
├── agent-ws/                    # WebSocket 网关服务
│   ├── src/                     # TypeScript 源码
│   ├── dist/                    # 编译输出
│   └── agent-ws.log             # 运行日志
│
├── agent-ws-bridge/             # HTTP → WebSocket 桥接
│   ├── bridge.js                 # 核心逻辑
│   └── bridge.log               # 运行日志
│
├── backend/                     # Claude API 后端 (备用)
│   ├── server.js                # Express 服务
│   └── .env                     # 环境配置
│
├── Kimi_Agent_Deployment_v11/   # 前端项目
│   ├── index.html               # 入口页面
│   ├── frontend.log             # 服务日志
│   └── assets/                  # 静态资源 (JS/CSS)
│
├── 乔布斯/                      # 乔布斯人格 Skill
├── 马斯克/                      # 马斯克人格 Skill
├── 马化腾/                      # 马化腾人格 Skill
├── 张一鸣/                      # 张一鸣人格 Skill
├── 俞军/                        # 俞军人格 Skill
├── 俞军资料/                    # 俞军相关资料
├── yu-jun-perspective-skill/    # 俞军视角 Skill (扩展版)
├── mao-ze-dong-pm-skill/        # 毛泽东 PM 思维 Skill
├── mao-ze-dong-skill/           # 毛泽东技能
├── 产品人思维/                   # 产品思维相关
└── README.md                    # 本文件
```

## 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| 前端 | 3000 | 用户访问地址 |
| 后端 | 3001 | Claude API (备用) |
| 网桥 | 3011 | HTTP → WebSocket 转换 |
| agent-ws | 9999 | Claude Code WebSocket 桥接 |

## 人格系统

系统内置多种产品大师人格，通过 Skill 文件加载：

| 人格 ID | 名称 | 领域 |
|---------|------|------|
| jobs | 乔布斯 | 产品、设计、战略 |
| musk | 马斯克 | 工程、第一性原理 |
| ma | 马化腾 | 产品战略、灰度法则 |
| zhang | 张一鸣 | 创业、算法思维 |
| yujun | 俞军 | 产品方法论、用户价值 |
| jiaoyuan | 教员 | PM 思维、战略 |

### 思考深度模式

| 模式 | 说明 |
|------|------|
| quick | 快速回答，直击要点 |
| pro | 深度推理，兼顾效率与质量 |
| deep | 链式思考，极致严谨 |

## 启动方法

### 1. 启动前端

```bash
cd D:/ai产品经理/Kimi_Agent_Deployment_v11
npx serve -l 3000 -s .
```

### 2. 启动网桥服务

```bash
cd D:/ai产品经理/agent-ws-bridge
node bridge.js
```

### 3. 启动 agent-ws

```bash
cd D:/ai产品经理/agent-ws
node dist/index.js
```

### 4. 启动后端 (可选，备用)

```bash
cd D:/ai产品经理/backend
node server.js
```

## 访问地址

- 前端页面: http://localhost:3000
- API 地址: http://localhost:3011

## API 接口

### 聊天接口

```
POST http://localhost:3011/api/chat
Content-Type: application/json

{
  "message": "用户输入",
  "persona_id": "jobs",     // 人格 ID
  "mode": "pro",            // 思考深度
  "history": []             // 对话历史
}
```

### 获取人格列表

```
GET http://localhost:3011/api/personas
```

## 技术栈

- **前端**: React + TypeScript + Vite
- **网桥**: Node.js + WebSocket (ws)
- **Agent**: Claude Code CLI + agent-ws
- **AI**: Claude Opus/Sonnet 模型

## 环境要求

- Node.js 20+
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- 支持的浏览器: Chrome/Firefox/Edge/Safari

## 配置文件

### agent-ws-bridge 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| AGENT_WS_URL | ws://localhost:9999 | agent-ws 地址 |
| AGENT_WS_TOKEN | (空) | WebSocket 认证 Token |
| SKILL_BASE_PATH | D:/ai产品经理 | Skill 文件根目录 |

### backend 环境变量

| 变量 | 说明 |
|------|------|
| ANTHROPIC_API_KEY | Anthropic API Key |
| ANTHROPIC_BASE_URL | API 地址 (默认 api.anthropic.com) |

## 故障排查

### 端口被占用

```bash
# Windows 查看端口占用
netstat -ano | findstr "3000"
netstat -ano | findstr "3011"
netstat -ano | findstr "9999"

# 结束占用进程
taskkill /PID <进程ID> /F
```

### Claude Code 未安装

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

### 前端黑屏

1. 强制刷新: `Ctrl + Shift + R`
2. 清除浏览器缓存
3. 检查浏览器控制台 (F12) 是否有错误

### 前端空白但 API 正常

**问题现象**：浏览器打开页面后发送消息无响应，但通过 curl 测试 API 正常。

**排查步骤**：
1. 打开浏览器控制台 (F12)
2. 查看是否有 `[ChatAPI] 发送请求` 日志出现多次
3. 如果看到两次发送请求，说明 `index.html` 中的 ChatAPI 和 `index-BmnAfbU3.js` 中的代码发生冲突

**解决方案**：确保 `index.html` 中的 ChatAPI 只返回 `response.body`，不包含额外的拦截器逻辑。

### 前端发送消息后无响应

**可能原因**：
1. `index.html` 中 ChatAPI 未返回 `response.body`
2. `index-BmnAfbU3.js` 中调用 `stream.getReader()` 失败
3. SSE 响应格式不正确

**排查方法**：
```bash
# 测试 API 是否正常返回 SSE 格式
curl -s -N -X POST http://localhost:3011/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"test","persona_id":"jobs"}'
```

正常响应应为：
```
data: {"content":"..."}

data: {"done":true}
```

### 人格切换不生效

**问题现象**：切换人格后，AI 回答风格没有变化。

**排查步骤**：
1. 检查 `agent-ws-bridge/bridge.js` 中的 `PERSONA_NAMES` 配置
2. 确认 `loadSkill()` 函数能正确加载对应人格的 Skill 文件
3. 查看日志中 `[Skill] Loaded:` 是否显示正确

**已知问题**：
- `mao-ze-dong-pm-skill/SKILL.md` 可能不存在，需要检查路径

### agent-ws 无法启动 (Windows)

**问题现象**：`agent-ws` 提示 "Claude CLI not found"。

**原因**：Windows 上 `claude` 命令不在 Node.js 的 PATH 中。

**解决方案**：
1. 使用完整路径启动：`node dist/cli.js --claude-path "C:/Users/用户名/AppData/Roaming/npm/claude.cmd"`
2. 或使用 backend 服务作为替代方案（bridge.js 已配置为调用 backend）

### agent-ws-bridge 连接超时

**问题现象**：`[Chat] 错误: WebSocket 连接超时`

**可能原因**：
1. `agent-ws` 服务未运行
2. 端口 9999 被占用
3. Windows 防火墙阻止连接

**解决方案**：确保 agent-ws 运行在 9999 端口，或配置 bridge.js 直接调用 backend 服务。

## 问题记录

### 2026-04-24 已知问题

| 问题 | 状态 | 解决方案 |
|------|------|----------|
| 前端 ChatAPI 双次调用导致无响应 | ✅ 已修复 | 简化 index.html 中的 ChatAPI 代码 |
| 前端人格切换使用固定 persona_id | ✅ 已修复 | 修改为使用当前选中人格 r.id |
| agent-ws 在 Windows 上找不到 claude | ⚠️ 部分解决 | 改用 backend 服务替代 agent-ws |
| mao-ze-dong-pm-skill/SKILL.md 缺失 | ❌ 待处理 | 需要确认文件路径 |

### 技术债务

1. **前端源码缺失**：Kimi_Agent_Deployment_v11 只有压缩后的 JS/CSS，源码丢失
2. **agent-ws Windows 兼容性问题**：claude 命令路径检测有问题
3. **毛泽东 PM Skill 文件缺失**：需要确认 mao-ze-dong-pm-skill 目录下的文件

## 许可证

MIT
