/**
 * agent-ws-bridge: HTTP API - Backend Bridge
 * Supports persona switching and WebSocket connection to agent-ws
 */

import http from 'node:http';
import { WebSocket } from 'ws';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const HTTP_PORT = 3011;
const AGENT_WS_URL = process.env.AGENT_WS_URL || 'ws://localhost:9999';
const SKILL_BASE_PATH = process.env.SKILL_BASE_PATH || 'D:/ai产品经理/cyber-pm-create/skills';

// 人格 → Skill 映射
const PERSONA_TO_SKILL = {
  'yujun': 'yu-jun-pm',
  'jobs': 'steve-jobs-perspective',
  'musk': 'elon-musk-perspective',
  'ma': 'pony-ma-pm',
  'zhang': 'openclaw-product-blueprint',
  'jiaoyuan': 'mao-ze-dong-pm'
};

// thinkingTokens 配置
const THINKING_TOKENS = {
  quick: 0,
  pro: 8000,
  deep: 32000
};

const THINKING_PROMPTS = {
  quick: `【Quick 快速回答模式】
最低思考深度，极简处理问题，跳过多余内部推演。
回答极度精简、直击要点、拒绝长篇铺垫与额外拓展。`,

  pro: `【Pro 深度推理模式】
中等标准思考深度，完整逻辑闭环推导，严谨稳妥、兼顾效率与质量。`,

  deep: `【Deep 链式思考模式】
最高满格思考深度，强制全程思维链CoT深度拆解，层层递进分析。极致严谨穷尽推理。`
};

const PERSONA_NAMES = {
  'jobs': '乔布斯',
  'musk': '马斯克',
  'ma': '马化腾',
  'zhang': '张一鸣',
  'yujun': '俞军',
  'jiaoyuan': '毛泽东（教员）',
  'default': null
};

const skillCache = new Map();

function loadSkill(personaId) {
  if (skillCache.has(personaId)) return skillCache.get(personaId);

  const personaMap = {
    'jobs': '乔布斯', 'musk': '马斯克', 'ma': '马化腾',
    'zhang': '张一鸣', 'yujun': 'yu-jun-perspective-skill',
    'jiaoyuan': 'mao-ze-dong-skill',
    'steve-jobs': '乔布斯', 'elon-musk': '马斯克',
    'pony': '马化腾', 'ma-huateng': '马化腾',
    'yiming': '张一鸣', 'zhang-yiming': '张一鸣',
    'yu-jun': 'yu-jun-perspective-skill',
    'mao': 'mao-ze-dong-skill', 'mao-zedong': 'mao-ze-dong-skill',
    'default': null
  };

  const specialPaths = {
    'yujun': '俞军',
    'jiaoyuan': 'mao-ze-dong-skill',
    'mao': 'mao-ze-dong-skill'
  };

  let skillPath;
  if (specialPaths[personaId]) {
    skillPath = resolve(SKILL_BASE_PATH, specialPaths[personaId], 'SKILL.md');
  } else {
    const dirName = personaMap[personaId] || personaId;
    if (!dirName) return null;
    skillPath = resolve(SKILL_BASE_PATH, dirName, 'SKILL.md');
  }

  if (!existsSync(skillPath)) {
    console.log(`[Skill] Not found: ${skillPath}`);
    return null;
  }

  try {
    const content = readFileSync(skillPath, 'utf-8');
    const lines = content.split('\n');
    const startIdx = lines.findIndex(l => l.startsWith('# '));
    const endIdx = lines.findIndex(l => l.startsWith('## 诚实边界') || l.startsWith('## 附录'));
    let skillContent;
    if (startIdx >= 0 && endIdx > startIdx) {
      skillContent = lines.slice(startIdx, endIdx).join('\n');
    } else if (startIdx >= 0) {
      skillContent = lines.slice(startIdx, startIdx + 150).join('\n');
    } else {
      skillContent = content.slice(0, 8000);
    }
    skillCache.set(personaId, skillContent);
    console.log(`[Skill] Loaded: ${personaId} (${skillContent.length} chars)`);
    return skillContent;
  } catch (e) {
    console.error(`[Skill] Error:`, e.message);
    return null;
  }
}

function buildSystemPrompt(personaId, mode) {
  const parts = [];
  const thinkingPrompt = THINKING_PROMPTS[mode] || THINKING_PROMPTS.pro;
  parts.push(thinkingPrompt);

  const personaName = PERSONA_NAMES[personaId] || personaId;

  if (personaName && personaId !== 'default') {
    parts.push(`\n\n【人格切换】\n你现在是：${personaName}。\n请完全以${personaName}的视角、思维方式、表达风格来回应。`);
  }

  const skill = loadSkill(personaId);
  if (skill) {
    parts.push('\n\n【Skill参考】\n' + skill);
  }

  parts.push(`\n---\n\n【规则】\n1. 你现在是${personaName || '默认模式'}。\n2. 直接以该人格身份回应，不要说"作为AI"。\n3. 保持${personaName || '当前'}的说话风格。`);

  return parts.join('\n');
}

// WebSocket connection to agent-ws
let agentWs = null;
let wsConnected = false;

function connectAgentWs() {
  return new Promise((resolve, reject) => {
    console.log(`[Bridge] Connecting to agent-ws: ${AGENT_WS_URL}`);
    agentWs = new WebSocket(AGENT_WS_URL);

    agentWs.on('open', () => {
      console.log('[Bridge] Connected to agent-ws');
      wsConnected = true;
      resolve();
    });

    agentWs.on('close', () => {
      console.log('[Bridge] Disconnected from agent-ws');
      wsConnected = false;
      // 3秒后重连
      setTimeout(() => connectAgentWs(), 3000);
    });

    agentWs.on('error', (err) => {
      console.error('[Bridge] WebSocket error:', err.message);
      if (!wsConnected) reject(err);
    });
  });
}

// 启动时连接 agent-ws
connectAgentWs().catch(err => {
  console.error('[Bridge] Failed to connect to agent-ws:', err.message);
});

async function handleChatRequest(body, res) {
  const requestId = `req_${Date.now()}`;

  try {
    const { message, persona_id, mode, history } = JSON.parse(body);
    console.log(`[Chat ${requestId}] persona=${persona_id}, mode=${mode}, message=${message}`);

    if (!wsConnected || !agentWs) {
      throw new Error('agent-ws not connected');
    }

    // Skill 模式：获取对应的 skill 名称
    const skillName = PERSONA_TO_SKILL[persona_id] || null;

    // 构建完整消息：使用 /<skill-name> 前缀触发 Skill
    let fullMessage = '';
    if (skillName) {
      fullMessage = `/${skillName}\n\n用户: ${message}`;
    } else {
      fullMessage = `用户: ${message}`;
    }

    console.log(`[Chat ${requestId}] Using skill: ${skillName || 'none'}`);

    // 通过 WebSocket 发送请求
    return new Promise((resolve, reject) => {
      agentWs.send(JSON.stringify({
        type: 'start',
        message: fullMessage,
        skillName: skillName,
        requestId: requestId
      }));

      // 接收响应
      const onMessage = (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'chunk' && msg.content) {
            res.write(`data: ${JSON.stringify({content: msg.content, requestId})}\n\n`);
          } else if (msg.type === 'thinking' && msg.content) {
            // 思考过程单独发送
            res.write(`data: ${JSON.stringify({thinking: msg.content, requestId})}\n\n`);
          } else if (msg.type === 'error') {
            res.write(`data: ${JSON.stringify({error: msg.content, requestId})}\n\n`);
            res.end();
            agentWs.removeListener('message', onMessage);
            resolve();
          } else if (msg.type === 'done') {
            res.write(`data: ${JSON.stringify({done: true, requestId})}\n\n`);
            res.end();
            agentWs.removeListener('message', onMessage);
            resolve();
          }
        } catch (e) {
          // 忽略解析错误
        }
      };

      agentWs.on('message', onMessage);

      // 超时处理
      setTimeout(() => {
        agentWs.removeListener('message', onMessage);
        res.write(`data: ${JSON.stringify({error: 'Timeout', requestId})}\n\n`);
        res.end();
        resolve();
      }, 120000);
    });

  } catch (err) {
    console.error(`[Chat ${requestId}] Error:`, err.message);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({error: err.message})}\n\n`);
      res.end();
    }
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);
  console.log(`[HTTP] ${req.method} ${url.pathname}`);

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    const body = await readBody(req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    await handleChatRequest(body, res);
    return;
  }

  if (url.pathname === '/api/personas' && req.method === 'GET') {
    const personas = [
      { id: 'default', name: '默认模式', description: '标准 Claude 响应' },
      { id: 'jobs', name: '乔布斯', description: '产品/设计视角' },
      { id: 'musk', name: '马斯克', description: '工程/成本视角' },
      { id: 'ma', name: '马化腾', description: '灰度/管理视角' },
      { id: 'zhang', name: '张一鸣', description: '产品/组织视角' },
      { id: 'yujun', name: '俞军', description: '产品方法论' },
      { id: 'jiaoyuan', name: '毛泽东', description: '战略/决策视角' }
    ];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(personas));
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', wsConnected }));
    return;
  }

  // Claude Code 配置接口
  if (url.pathname === '/api/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      wsURL: 'ws://localhost:3011',
      wsToken: '',
      useClaudeCode: true,
      useSkillMode: true,
      defaultMode: 'pro',
      defaultPersona: 'yujun',
      thinkingTokens: {
        quick: 0,
        pro: 8000,
        deep: 32000
      },
      personaToSkill: {
        'yujun': 'yu-jun-pm',
        'jobs': 'steve-jobs-perspective',
        'musk': 'elon-musk-perspective',
        'ma': 'pony-ma-pm',
        'zhang': 'openclaw-product-blueprint',
        'jiaoyuan': 'mao-ze-dong-pm'
      }
    }));
    return;
  }

  res.writeHead(404); res.end('Not Found');
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
    });
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      resolve(buffer.toString('utf8'));
    });
    req.on('error', reject);
  });
}

server.listen(HTTP_PORT, () => {
  console.log(`\n=== agent-ws-bridge started ===`);
  console.log(`HTTP API: http://localhost:${HTTP_PORT}`);
  console.log(`Agent WS: ${AGENT_WS_URL}\n`);
  ['jobs', 'musk', 'ma', 'zhang', 'yujun', 'jiaoyuan'].forEach(loadSkill);
});

process.on('SIGINT', () => { console.log('\n[Bridge] Shutting down...'); server.close(() => process.exit(0)); });
