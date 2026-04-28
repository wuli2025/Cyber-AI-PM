/**
 * 人格配置和 Skill 加载器
 * 支持切换不同产品大佬视角进行对话
 */

const fs = require('fs');
const path = require('path');

const SKILL_BASE = process.env.SKILL_BASE_PATH || 'D:/ai产品经理/temp-clone';

const PERSONA_CONFIG = {
  yujun: {
    name: '俞军',
    title: '中国产品经理教父',
    avatar: '俞',
    color: '#0D5B4A',
    skillPath: path.join(SKILL_BASE, '俞军', 'SKILL.md')
  },
  jobs: {
    name: '乔布斯',
    title: '交互与美学偏执者',
    avatar: '乔',
    color: '#C41E3A',
    skillPath: path.join(SKILL_BASE, '乔布斯', 'SKILL.md')
  },
  musk: {
    name: '马斯克',
    title: '第一性原理践行者',
    avatar: '马',
    color: '#1E90FF',
    skillPath: path.join(SKILL_BASE, '马斯克', 'SKILL.md')
  },
  ma: {
    name: '马化腾',
    title: '社交产品之王',
    avatar: '化',
    color: '#2E6BE6',
    skillPath: path.join(SKILL_BASE, '马化腾', 'SKILL.md')
  },
  zhang: {
    name: '张一鸣',
    title: '推荐算法极致者',
    avatar: '鸣',
    color: '#E67E22',
    skillPath: path.join(SKILL_BASE, '张一鸣', 'SKILL.md')
  },
  jiaoyuan: {
    name: '毛泽东（教员）',
    title: '战略思维大师',
    avatar: '毛',
    color: '#B22234',
    skillPath: path.join(SKILL_BASE, '教员', 'SKILL.md')
  },
  default: {
    name: '默认模式',
    title: '标准 Claude 响应',
    avatar: '默',
    color: '#666666',
    skillPath: null
  }
};

const THINKING_MODES = {
  quick: '【Quick 快速回答】最低思考深度，直击要点，极简处理问题，跳过多余内部推演。回答极度精简、直击要点、拒绝长篇铺垫与额外拓展。',
  pro: '【Pro 深度推理】中等思考深度，完整逻辑闭环推导，严谨稳妥、兼顾效率与质量。必须包含：市场分析、用户需求、产品规划。',
  deep: '【Deep 链式思考】最高满格思考深度，强制全程思维链CoT深度拆解，层层递进分析。极致严谨穷尽推理。必须包含：行业趋势、竞品对比、风险评估、完整文档。'
};

const skillCache = new Map();

function loadSkill(personaId) {
  if (skillCache.has(personaId)) {
    return skillCache.get(personaId);
  }

  const config = PERSONA_CONFIG[personaId] || PERSONA_CONFIG.yujun;
  if (!config.skillPath) {
    return null;
  }

  if (!fs.existsSync(config.skillPath)) {
    console.warn(`[Persona] Skill not found: ${config.skillPath}`);
    return null;
  }

  try {
    const content = fs.readFileSync(config.skillPath, 'utf-8');
    // 提取核心内容（去掉附录和诚实边界）
    const lines = content.split('\n');
    const startIdx = lines.findIndex(l => l.startsWith('# '));
    const endIdx = lines.findIndex(l =>
      l.startsWith('## 诚实边界') ||
      l.startsWith('## 附录') ||
      l.startsWith('## 使用说明')
    );

    let skillContent;
    if (startIdx >= 0 && endIdx > startIdx) {
      skillContent = lines.slice(startIdx, endIdx).join('\n');
    } else if (startIdx >= 0) {
      skillContent = lines.slice(startIdx, startIdx + 150).join('\n');
    } else {
      skillContent = content.slice(0, 12000);
    }

    skillCache.set(personaId, skillContent);
    console.log(`[Persona] Loaded: ${personaId} (${skillContent.length} chars)`);
    return skillContent;
  } catch (e) {
    console.error(`[Persona] Load error:`, e.message);
    return null;
  }
}

// System Prompt 缓存（预构建）
const systemPromptCache = new Map();

function buildSystemPrompt(personaId, mode) {
  const cacheKey = `${personaId}:${mode}`;

  // 检查缓存
  if (systemPromptCache.has(cacheKey)) {
    return systemPromptCache.get(cacheKey);
  }

  const config = PERSONA_CONFIG[personaId] || PERSONA_CONFIG.yujun;
  const skill = loadSkill(personaId);
  const thinking = THINKING_MODES[mode] || THINKING_MODES.pro;

  const parts = [];

  // 思考模式
  parts.push(thinking);

  // 人格激活
  parts.push('');
  parts.push('═══════════════════════════════════════════════════════');
  parts.push(`【人格激活】你是：${config.name}`);
  parts.push('═══════════════════════════════════════════════════════');
  parts.push('');

  // Skill 内容
  if (skill) {
    parts.push('═══════════════════════════════════════════════════════');
    parts.push(`【${config.name}方法论】`);
    parts.push(skill);
    parts.push('═══════════════════════════════════════════════════════');
    parts.push('');
  }

  // 输出规则
  parts.push('═══════════════════════════════════════════════════════');
  parts.push('【重要规则】');
  parts.push(`1. 直接以${config.name}的身份回应，不要说"作为AI"、"作为一个语言模型"等`);
  parts.push(`2. 保持${config.name}的说话风格和思维方式`);
  parts.push('3. 遇到产品决策问题，先用该人格的框架分析，再给结论');
  parts.push('4. 【关键】当前环境没有 WebSearch、search、工具调用等任何外部工具。绝对不要输出 [TOOL_CALL]、<invoke>、<function_calls> 之类的工具调用代码。所有分析必须基于你已有的知识和该人格的方法论框架，直接给出完整答案');
  parts.push('5. 用户要求写 PRD 时，直接基于已知信息和人格框架，输出完整内容，不要说"正在搜索"、"扫描中"');
  parts.push('6. 必须输出完整回答，不要中途停下来等待工具结果');
  parts.push('═══════════════════════════════════════════════════════');

  const result = parts.join('\n');
  systemPromptCache.set(cacheKey, result);
  return result;
}

// 预构建所有 System Prompt
function preloadAllSystemPrompts() {
  console.log('[Persona] 预构建所有 System Prompt...');
  const modes = ['quick', 'pro', 'deep'];
  for (const personaId of Object.keys(PERSONA_CONFIG)) {
    for (const mode of modes) {
      const prompt = buildSystemPrompt(personaId, mode);
      console.log(`[Persona] Cached: ${personaId}/${mode} (${prompt.length} chars)`);
    }
  }
}

function getPersonaList() {
  return Object.entries(PERSONA_CONFIG).map(([id, config]) => ({
    id,
    name: config.name,
    avatar: config.avatar,
    color: config.color,
    title: config.title
  }));
}

// 预加载所有 Skill
function preloadAllSkills() {
  console.log('[Persona] 预加载所有 Skill...');
  for (const id of Object.keys(PERSONA_CONFIG)) {
    loadSkill(id);
  }
}

module.exports = {
  PERSONA_CONFIG,
  THINKING_MODES,
  loadSkill,
  buildSystemPrompt,
  getPersonaList,
  preloadAllSkills,
  preloadAllSystemPrompts
};
