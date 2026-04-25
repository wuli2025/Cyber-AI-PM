/**
 * AI产品思维实验室 - Claude API 后端
 * 使用 @anthropic-ai/sdk
 * 支持 SKILL.md 人格切换
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Claude SDK 配置
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
});

app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:8080', 'http://localhost:5173'],
  credentials: true,
}));

app.use(express.json());

// ============ SKILL 加载 ============

const SKILL_BASE_PATH = process.env.SKILL_BASE_PATH || 'D:/ai产品经理';

// 人格 ID 到目录的映射
const PERSONA_MAP = {
  'yujun': 'yu-jun-perspective-skill',
  'jobs': '乔布斯',
  'musk': '马斯克',
  'ma': '马化腾',
  'zhang': '张一鸣',
  'jiaoyuan': 'mao-ze-dong-skill'
};

const PERSONA_NAMES = {
  'yujun': '俞军',
  'jobs': '乔布斯',
  'musk': '马斯克',
  'ma': '马化腾',
  'zhang': '张一鸣',
  'jiaoyuan': '毛泽东（教员）'
};

// SKILL 缓存
const skillCache = new Map();

function loadSkill(personaId) {
  if (skillCache.has(personaId)) {
    return skillCache.get(personaId);
  }

  const dirName = PERSONA_MAP[personaId] || personaId;
  if (!dirName) return null;

  const skillPath = path.join(SKILL_BASE_PATH, dirName, 'SKILL.md');

  if (!fs.existsSync(skillPath)) {
    console.log(`[Skill] Not found: ${skillPath}`);
    return null;
  }

  try {
    const content = fs.readFileSync(skillPath, 'utf-8');
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

function buildSystemPrompt(personaId) {
  const skill = loadSkill(personaId);
  if (skill) {
    return skill;
  }
  const personaName = PERSONA_NAMES[personaId] || personaId;
  return `你是${personaName}，直接以该身份回应。`;
}

// 预加载所有 SKILL
console.log('[Server] 预加载 SKILL...');
Object.keys(PERSONA_MAP).forEach(id => loadSkill(id));

// ============ API ============

app.get('/api/personas', (req, res) => {
  res.json([
    { id: 'yujun', name: '俞军', avatar: '俞', color: '#0D5B4A', title: '中国产品经理教父' },
    { id: 'jobs', name: '乔布斯', avatar: '乔', color: '#C41E3A', title: '交互与美学偏执者' },
    { id: 'musk', name: '马斯克', avatar: '马', color: '#1E90FF', title: '第一性原理践行者' },
    { id: 'ma', name: '马化腾', avatar: '化', color: '#2E6BE6', title: '社交产品之王' },
    { id: 'zhang', name: '张一鸣', avatar: '鸣', color: '#E67E22', title: '推荐算法极致者' },
    { id: 'jiaoyuan', name: '教员', avatar: '教', color: '#B22234', title: '战略思维大师' }
  ]);
});

app.post('/api/chat', async (req, res) => {
  const { message, persona_id = 'yujun', history = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  console.log(`[Chat] persona=${persona_id}, message=${message.slice(0, 50)}...`);

  // 构建包含 SKILL 的系统提示
  const systemPrompt = buildSystemPrompt(persona_id);
  console.log(`[Chat] System prompt length: ${systemPrompt.length} chars`);

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    // 构建消息
    const messages = [
      { role: 'user', content: systemPrompt + '\n\n用户说：' + message }
    ];

    const stream = await anthropic.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta' && event.delta.text) {
          res.write('data: ' + JSON.stringify({ content: event.delta.text }) + '\n\n');
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    res.write('data: ' + JSON.stringify({ done: true }) + '\n\n');
    res.end();

  } catch (error) {
    console.error('[Claude Error]', error.message);
    res.write('data: ' + JSON.stringify({ error: error.message }) + '\n\n');
    res.end();
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', engine: 'anthropic-sdk' });
});

// ============ 启动 ============

app.listen(PORT, () => {
  console.log('[Server] http://localhost:' + PORT);
  console.log('[SDK] @anthropic-ai/sdk');
});
