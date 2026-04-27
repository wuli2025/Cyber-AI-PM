/**
 * Claude Code Web Chat - 前端应用
 * 适配新的 SSE API 格式
 */

const PERSONAS = [
  { id: 'yujun', name: '俞军', avatar: '俞', color: '#0D5B4A', desc: '中国产品经理教父' },
  { id: 'jobs', name: '乔布斯', avatar: '乔', color: '#C41E3A', desc: '交互与美学偏执者' },
  { id: 'musk', name: '马斯克', avatar: '马', color: '#1E90FF', desc: '第一性原理践行者' },
  { id: 'ma', name: '马化腾', avatar: '化', color: '#2E6BE6', desc: '社交产品之王' },
  { id: 'zhang', name: '张一鸣', avatar: '鸣', color: '#E67E22', desc: '推荐算法极致者' },
  { id: 'jiaoyuan', name: '毛主席', avatar: '毛', color: '#B22234', desc: '战略思维大师' }
];

const API_BASE_URL = 'http://localhost:3011';
let currentPersona = 'yujun';
let currentMode = 'pro';
let isGenerating = false;
let currentResponseEl = null;

// DOM 元素
const messagesEl = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const statusEl = document.getElementById('status');
const personaListEl = document.getElementById('personaList');
const modeSelect = document.getElementById('modeSelect');

// 初始化
function init() {
  renderPersonas();
  setupEventListeners();
  updateStatus('connected');
}

// 渲染人格列表
function renderPersonas() {
  personaListEl.innerHTML = PERSONAS.map(p => `
    <div class="persona-card ${p.id === currentPersona ? 'active' : ''}" data-id="${p.id}">
      <div class="persona-avatar" style="background: ${p.color}">${p.avatar}</div>
      <div class="persona-info">
        <div class="persona-name">${p.name}</div>
        <div class="persona-desc">${p.desc}</div>
      </div>
    </div>
  `).join('');

  personaListEl.querySelectorAll('.persona-card').forEach(card => {
    card.addEventListener('click', () => {
      currentPersona = card.dataset.id;
      renderPersonas();
    });
  });
}

// 设置事件监听
function setupEventListeners() {
  sendBtn.addEventListener('click', sendMessage);

  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    sendBtn.disabled = !messageInput.value.trim() || isGenerating;
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  modeSelect.addEventListener('change', () => {
    currentMode = modeSelect.value;
  });
}

// 更新连接状态
function updateStatus(status) {
  const dot = statusEl.querySelector('.status-dot');
  const text = statusEl.querySelector('.status-text');

  dot.className = 'status-dot ' + status;

  switch (status) {
    case 'connected':
      text.textContent = '已连接';
      break;
    case 'connecting':
      text.textContent = '连接中...';
      break;
    case 'disconnected':
      text.textContent = '未连接';
      break;
  }
}

// 发送消息
async function sendMessage() {
  const message = messageInput.value.trim();
  if (!message || isGenerating) return;

  addUserMessage(message);
  messageInput.value = '';
  messageInput.style.height = 'auto';

  isGenerating = true;
  sendBtn.disabled = true;

  startResponse();

  try {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        persona_id: currentPersona,
        mode: currentMode,
        history: []
      })
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));

            if (data.thinking) {
              console.log('[思考]', data.thinking.slice(0, 100));
            }

            if (data.content) {
              appendToResponse(data.content);
            }

            if (data.error) {
              appendError(data.error);
            }

            if (data.done) {
              finishResponse();
            }
          } catch (e) {
            console.error('Parse error:', e);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error:', error);
    appendError(error.message);
    finishResponse();
  }

  isGenerating = false;
  sendBtn.disabled = !messageInput.value.trim();
}

// 添加用户消息
function addUserMessage(message) {
  const msgEl = document.createElement('div');
  msgEl.className = 'message message-user';
  msgEl.innerHTML = `<div class="bubble">${escapeHtml(message)}</div>`;
  messagesEl.appendChild(msgEl);
  scrollToBottom();
}

// 开始 AI 响应
function startResponse() {
  const persona = PERSONAS.find(p => p.id === currentPersona);

  const msgEl = document.createElement('div');
  msgEl.className = 'message message-ai';
  msgEl.innerHTML = `
    <span class="persona-tag" style="background: ${persona.color}20; color: ${persona.color}">
      ${persona.name} 视角
    </span>
    <div class="bubble">
      <span class="loading"></span>思考中...
    </div>
  `;

  messagesEl.appendChild(msgEl);
  currentResponseEl = msgEl;
  scrollToBottom();
}

// 追加到响应内容
function appendToResponse(content) {
  if (!currentResponseEl) return;

  const bubble = currentResponseEl.querySelector('.bubble');

  if (bubble.querySelector('.loading')) {
    bubble.innerHTML = '';
  }

  const html = renderMarkdown(content);
  bubble.innerHTML += html;
  scrollToBottom();
}

// 添加错误
function appendError(error) {
  if (!currentResponseEl) return;

  const bubble = currentResponseEl.querySelector('.bubble');
  if (bubble.querySelector('.loading')) {
    bubble.innerHTML = '';
  }
  bubble.innerHTML += `<p style="color: red;">错误: ${escapeHtml(error)}</p>`;
  scrollToBottom();
}

// 完成响应
function finishResponse() {
  if (!currentResponseEl) return;

  const timeEl = document.createElement('div');
  timeEl.className = 'message-time';
  timeEl.textContent = new Date().toLocaleTimeString('zh-CN');
  currentResponseEl.appendChild(timeEl);

  currentResponseEl = null;
  scrollToBottom();
}

// Markdown 渲染
function renderMarkdown(text) {
  let html = text
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  if (!html.startsWith('<')) {
    html = '<p>' + html + '</p>';
  }

  return html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

init();
