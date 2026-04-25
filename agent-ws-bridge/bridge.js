/**
 * agent-ws-bridge: HTTP API - Backend Bridge
 * Supports persona switching
 */

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const HTTP_PORT = 3011;
const BACKEND_API = process.env.BACKEND_API || 'http://localhost:3001';
const SKILL_BASE_PATH = process.env.SKILL_BASE_PATH || 'D:/ai产品经理';

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
    'yujun': 'yu-jun-perspective-skill',
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

async function handleChatRequest(body, res) {
  const requestId = `req_${Date.now()}`;

  try {
    const { message, persona_id, mode, history } = JSON.parse(body);
    console.log(`[Chat ${requestId}] persona=${persona_id}, mode=${mode}`);

    // 只传用户消息和 persona_id，让 backend 负责构建 system prompt
    const response = await fetch(BACKEND_API + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, persona_id, mode, history })
    });

    if (!response.ok) throw new Error(`Backend error: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      for (const line of text.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.content) res.write(`data: ${JSON.stringify({content: data.content})}\n\n`);
            if (data.done) { res.write(`data: ${JSON.stringify({done: true})}\n\n`); res.end(); return; }
            if (data.error) { res.write(`data: ${JSON.stringify({error: data.error})}\n\n`); res.end(); return; }
          } catch (e) {}
        }
      }
    }
    res.end();
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
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  res.writeHead(404); res.end('Not Found');
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    req.setEncoding('utf8');
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

server.listen(HTTP_PORT, () => {
  console.log(`\n=== agent-ws-bridge started ===`);
  console.log(`HTTP API: http://localhost:${HTTP_PORT}`);
  console.log(`Backend:  ${BACKEND_API}\n`);
  ['jobs', 'musk', 'ma', 'zhang', 'yujun', 'jiaoyuan'].forEach(loadSkill);
});

process.on('SIGINT', () => { console.log('\n[Bridge] Shutting down...'); server.close(() => process.exit(0)); });
