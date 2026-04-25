# Bridge 进程崩溃自愈系统 — PRD 文档

> 版本：v1.0
> 日期：2026-04-25
> 作者：AI 产品思维实验室

---

## 一、产品背景

### 1.1 现状痛点

当前 `agent-ws-bridge` 进程以裸进程方式运行，存在以下问题：

| 问题 | 影响 | 频率 |
|------|------|------|
| 进程崩溃后无自动恢复 | 服务完全不可用，需人工重启 | 偶发 |
| 崩溃原因不明 | 排查困难，修复周期长 | 每次 |
| 无健康监控 | 无法及时发现服务异常 | 持续 |
| 日志分散 | 排查时需手动收集多个日志文件 | 每次 |

### 1.2 故障案例

```
[2026-04-24 23:15] bridge.js 因未定义变量 AGENT_WS_URL 崩溃
[2026-04-24 23:19] 用户发现服务不可用，手动重启
[2026-04-24 23:27] 再次因 systemPrompt 重复声明导致语法错误
```

### 1.3 目标

实现 **"检测-报警-自愈-复盘"** 全链路闭环，将 MTTR（平均修复时间）从小时级降至秒级。

---

## 二、产品目标

### 2.1 核心指标

| 指标 | 当前值 | 目标值 |
|------|--------|--------|
| 故障发现时间 | 用户投诉后 | < 30 秒 |
| 自动恢复时间 | 人工重启（~5分钟） | < 10 秒 |
| 故障定位时间 | 查看多个日志文件 | < 1 分钟 |
| 服务可用性 | ~99% | 99.9% |

### 2.2 用户价值

- **开发者**：无需 7x24 值守，崩溃自动恢复
- **运维**：标准化故障处理流程，降低人肉运维成本
- **用户**：服务持续可用，体验不中断

---

## 三、需求范围

### 3.1 In-Scope（本期实现）

1. **进程守护**：PM2 进程管理 + 自动重启
2. **健康探针**：HTTP /health 端点轮询检测
3. **崩溃日志**：统一收集到文件 + 控制台
4. **故障报警**：进程崩溃时发送通知

### 3.2 Out-of-Scope（后续迭代）

1. 分布式多实例部署
2. 链路追踪（OpenTelemetry）
3. 智能根因分析（AI 诊断）
4. 灰度发布与回滚

---

## 四、产品方案

### 4.1 系统架构

```
┌─────────────┐     监控/报警      ┌─────────────┐
│  用户/开发者  │ ◄──────────────── │  报警通道    │
│             │                   │ (日志/通知)  │
└─────────────┘                   └──────┬──────┘
                                         │
┌────────────────────────────────────────┼─────────────────┐
│                                        │                 │
│  ┌─────────────┐   健康检查   ┌────────┴────────┐       │
│  │   PM2 守护   │ ◄───────── │  Health Monitor │       │
│  │  (进程管理)  │            │  (每30秒轮询)    │       │
│  └──────┬──────┘            └─────────────────┘       │
│         │                                              │
│  ┌──────┴──────┐                                      │
│  │ 自动重启策略 │                                      │
│  │ - max_restarts: 10                                 │
│  │ - min_uptime: 10s                                  │
│  │ - exp_backoff_restart_delay: 100ms                 │
│  └──────┬──────┘                                      │
│         │                                              │
│  ┌──────┴──────────────────────────────────┐          │
│  │           agent-ws-bridge 进程           │          │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  │          │
│  │  │ HTTP API │  │  WS桥接 │  │ 日志输出 │  │          │
│  │  │ :3011   │  │         │  │         │  │          │
│  │  └─────────┘  └─────────┘  └─────────┘  │          │
│  └──────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────┘
```

### 4.2 核心模块设计

#### 4.2.1 进程守护层（PM2）

**配置文件** `bridge.ecosystem.config.js`：

```javascript
module.exports = {
  apps: [{
    name: 'agent-ws-bridge',
    script: './bridge.js',
    instances: 1,
    exec_mode: 'fork',
    
    // 自动重启策略
    max_restarts: 10,
    min_uptime: '10s',
    exp_backoff_restart_delay: 100,
    
    // 环境变量
    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info'
    },
    
    // 日志配置
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // 内存限制
    max_memory_restart: '500M',
    
    // 优雅退出
    kill_timeout: 5000,
    listen_timeout: 10000,
    
    // 监控
    monitoring: true,
    pmx: true
  }]
};
```

**PM2 常用命令**：

```bash
pm2 start bridge.ecosystem.config.js    # 启动
pm2 reload agent-ws-bridge              # 热重载
pm2 logs agent-ws-bridge                # 查看日志
pm2 monit                               # 实时监控
pm2 save && pm2 startup                 # 开机自启
```

#### 4.2.2 健康探针

**探针实现** `health-check.js`：

```javascript
const http = require('http');

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3011/health';
const CHECK_INTERVAL = 30000; // 30秒
const ALERT_THRESHOLD = 3;    // 连续3次失败报警

let failCount = 0;

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(BRIDGE_URL, (res) => {
      if (res.statusCode === 200) {
        failCount = 0;
        resolve(true);
      } else {
        failCount++;
        resolve(false);
      }
    });
    
    req.on('error', () => {
      failCount++;
      resolve(false);
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      failCount++;
      resolve(false);
    });
  });
}

async function monitor() {
  const isHealthy = await checkHealth();
  
  if (!isHealthy) {
    console.error(`[HealthCheck] 服务异常，连续失败 ${failCount} 次`);
    
    if (failCount >= ALERT_THRESHOLD) {
      sendAlert(`Bridge 服务连续 ${failCount} 次健康检查失败`);
    }
  }
}

function sendAlert(message) {
  // 可接入企业微信/钉钉/飞书
  console.error(`[ALERT] ${new Date().toISOString()} ${message}`);
}

setInterval(monitor, CHECK_INTERVAL);
```

#### 4.2.3 日志标准化

**日志格式**：

```
[2026-04-25 10:30:15 +0800] [INFO]  [Bridge] 服务启动成功，端口 3011
[2026-04-25 10:35:22 +0800] [ERROR] [Bridge] 连接 WebSocket 失败: ECONNREFUSED
[2026-04-25 10:35:23 +0800] [WARN]  [Health] 健康检查失败 (1/3)
[2026-04-25 10:35:24 +0800] [FATAL] [Process] 未捕获异常，进程即将退出
[2026-04-25 10:35:25 +0800] [INFO]  [PM2]   进程自动重启，尝试 1/10
```

**日志级别定义**：

| 级别 | 使用场景 | 示例 |
|------|----------|------|
| DEBUG | 开发调试 | 详细的请求/响应数据 |
| INFO  | 正常运行 | 服务启动、请求处理 |
| WARN  | 需要注意 | 配置缺失、性能降级 |
| ERROR | 功能异常 | API 调用失败、连接超时 |
| FATAL | 服务崩溃 | 未捕获异常、进程退出 |

### 4.3 故障处理流程

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  故障发生  │───▶│  故障检测  │───▶│  故障自愈  │───▶│  故障复盘  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
      │               │               │               │
      ▼               ▼               ▼               ▼
  未捕获异常       PM2 检测到      自动重启进程       收集日志
  连接超时        健康检查失败      记录重启次数       分析根因
  内存溢出        进程退出码非0     通知开发者        更新代码
```

#### 4.3.1 自愈策略决策树

```
崩溃发生
    │
    ├── 崩溃次数 < 3 ──▶ 立即自动重启
    │
    ├── 崩溃次数 3~5 ──▶ 指数退避重启（延迟 1s, 2s, 4s...）
    │                         └── 同时发送报警通知
    │
    └── 崩溃次数 >= 10 ──▶ 停止自动重启
                              └── 发送紧急报警
                              └── 等待人工介入
```

### 4.4 报警通知

**报警规则**：

| 条件 | 级别 | 通知方式 | 接收人 |
|------|------|----------|--------|
| 进程重启 1 次 | INFO | 日志记录 | - |
| 连续重启 3 次 | WARN | 控制台 + 日志 | 开发者 |
| 连续重启 5 次 | ERROR | 控制台 + 日志 + 通知 | 开发者 |
| 重启 10 次/1小时 | FATAL | 所有通道 + 电话 | 团队 |

**通知模板**：

```
【Bridge 服务告警】

级别：ERROR
时间：2026-04-25 10:35:24
服务：agent-ws-bridge (PID: 12345)

故障：进程连续 5 次异常退出
原因：未捕获异常 - ReferenceError: AGENT_WS_URL is not defined

最近日志：
  [10:35:22] 连接 WebSocket 失败
  [10:35:23] 健康检查失败
  [10:35:24] 未捕获异常，进程退出

自愈：已尝试自动重启 5 次，请尽快人工介入排查。

查看详情：pm2 logs agent-ws-bridge
```

---

## 五、接口设计

### 5.1 健康检查接口（已有）

```
GET /health

Response:
{
  "status": "ok",
  "uptime": 3600,
  "timestamp": "2026-04-25T10:30:00Z"
}
```

### 5.2 新增：详细状态接口

```
GET /status

Response:
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 3600,
  "pid": 12345,
  "memory": {
    "rss": 52428800,
    "heapTotal": 32505856,
    "heapUsed": 24117248
  },
  "connections": {
    "active_ws": 5,
    "total_requests": 1024
  },
  "last_restart": "2026-04-25T10:00:00Z",
  "restart_count": 2
}
```

---

## 六、部署方案

### 6.1 目录结构

```
agent-ws-bridge/
├── bridge.js                  # 主程序
├── bridge.ecosystem.config.js # PM2 配置
├── health-check.js            # 健康探针
├── package.json
├── logs/                      # 日志目录
│   ├── combined.log           # 合并日志
│   ├── out.log               # stdout
│   ├── error.log             # stderr
│   └── crash/                # 崩溃日志
│       ├── crash-2026-04-25-103524.log
│       └── ...
└── scripts/
    ├── start.sh              # 启动脚本
    ├── stop.sh               # 停止脚本
    └── monitor.sh            # 监控脚本
```

### 6.2 启动脚本

```bash
#!/bin/bash
# scripts/start.sh

set -e

echo "[Start] 启动 Bridge 服务..."

# 创建日志目录
mkdir -p logs/crash

# 检查 PM2
if ! command -v pm2 &> /dev/null; then
    echo "[Error] PM2 未安装，请先安装: npm install -g pm2"
    exit 1
fi

# 启动服务
pm2 start bridge.ecosystem.config.js

# 保存配置（开机自启）
pm2 save

echo "[Start] 服务启动完成"
echo "[Start] 查看状态: pm2 status"
echo "[Start] 查看日志: pm2 logs agent-ws-bridge"
```

### 6.3 监控脚本

```bash
#!/bin/bash
# scripts/monitor.sh

echo "=== Bridge 服务监控 ==="
echo ""

# PM2 状态
echo "[PM2 进程状态]"
pm2 status agent-ws-bridge

echo ""
echo "[资源使用]"
pm2 monit --no-daemon &
sleep 3
kill $! 2>/dev/null

echo ""
echo "[最近日志]"
pm2 logs agent-ws-bridge --lines 20

echo ""
echo "[健康检查]"
curl -s http://localhost:3011/health | jq .
```

---

## 七、验收标准

### 7.1 功能验收

| 验收项 | 测试步骤 | 预期结果 |
|--------|----------|----------|
| 进程自动重启 | kill -9 <pid> | PM2 自动重启进程，<10秒恢复 |
| 健康检查 | 停止 bridge 服务 | 30秒内检测到故障，记录日志 |
| 崩溃日志 | 制造一个未捕获异常 | 日志文件记录完整堆栈信息 |
| 报警通知 | 连续崩溃 5 次 | 收到报警通知（控制台/日志） |
| 内存限制 | 内存使用超过 500M | PM2 自动重启进程 |

### 7.2 性能验收

| 验收项 | 指标 |
|--------|------|
| 故障发现时间 | < 30 秒 |
| 自动恢复时间 | < 10 秒 |
| 健康检查开销 | < 1% CPU |
| 日志写入延迟 | < 10ms |

---

## 八、风险与应对

| 风险 | 概率 | 影响 | 应对措施 |
|------|------|------|----------|
| PM2 本身故障 | 低 | 高 | 使用 systemd 作为兜底守护 |
| 频繁重启耗尽资源 | 中 | 高 | 指数退避 + 重启次数上限 |
| 日志磁盘占满 | 中 | 中 | 配置 logrotate 自动轮转 |
| 健康检查误报 | 低 | 中 | 连续 N 次失败才触发 |

---

## 九、附录

### 9.1 相关文件

| 文件 | 路径 | 说明 |
|------|------|------|
| bridge.js | agent-ws-bridge/bridge.js | 主程序 |
| server.js | backend/server.js | 后端服务 |
| index.html | Kimi_Agent_Deployment_v11/index.html | 前端入口 |

### 9.2 参考资料

- PM2 文档：https://pm2.keymetrics.io/docs/usage/process-management/
- Node.js 进程最佳实践
- 12-Factor App 日志规范

---

## 十、里程碑

| 阶段 | 时间 | 交付物 |
|------|------|--------|
| M1 | 1天 | PM2 配置 + 启动脚本 |
| M2 | 1天 | 健康探针 + 报警通知 |
| M3 | 1天 | 日志标准化 + 监控面板 |
| M4 | 1天 | 验收测试 + 文档完善 |

---

*本 PRD 为初稿，欢迎反馈和迭代。*
