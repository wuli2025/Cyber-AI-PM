/**
 * Claude Code Web Chat - 前端应用
 */

const WS_URL = `ws://${window.location.hostname}:3011`;
const PERSONAS = [
  { id: 'yujun', name: '俞军', avatar: '俞', color: '#0D5B4A', desc: '中国产品经理教父' },
  { id: 'jobs', name: '乔布斯', avatar: '乔', color: '#C41E3A', desc: '交互与美学偏执者' },
  { id: 'musk', name: '马斯克', avatar: '马', color: '#1E90FF', desc: '第一性原理践行者' },
  { id: 'ma', name: '马化腾', avatar: '化', color: '#2E6BE6', desc: '社交产品之王' },
  { id: 'zhang', name: '张一鸣', avatar: '鸣', color: '#E67E22', desc: '推荐算法极致者' },
  { id: 'jiaoyuan', name: '毛主席', avatar: '毛', color: '#B22234', desc: '战略思维大师' }
];

let ws = null;
let currentPersona = 'yujun';
let currentMode = 'pro';
let isConnected = false;
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
  connect();
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

  // 绑定点击事件
  personaListEl.querySelectorAll('.persona-card').forEach(card => {
    card.addEventListener('click', () => {
      currentPersona = card.dataset.id;
      renderPersonas();
    });
  });
}

// 设置事件监听
function setupEventListeners() {
  // 发送按钮
  sendBtn.addEventListener('click', sendMessage);

  // 输入框 - 自动调整高度
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    sendBtn.disabled = !messageInput.value.trim() || !isConnected || isGenerating;
  });

  // 回车发送（Shift+Enter 换行）
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // 思考模式切换
  modeSelect.addEventListener('change', () => {
    currentMode = modeSelect.value;
  });

  // Ctrl+数字键快速切换人格
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key >= '1' && e.key <= '6') {
      const index = parseInt(e.key) - 1;
      if (PERSONAS[index]) {
        currentPersona = PERSONAS[index].id;
        renderPersonas();
      }
    }
  });
}

// WebSocket 连接
function connect() {
  updateStatus('connecting');

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    isConnected = true;
    updateStatus('connected');
    sendBtn.disabled = !messageInput.value.trim();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (e) {
      console.error('Parse error:', e);
    }
  };

  ws.onclose = () => {
    isConnected = false;
    isGenerating = false;
    updateStatus('disconnected');
    sendBtn.disabled = true;
    console.log('Disconnected, reconnecting in 3s...');
    setTimeout(connect, 3000);
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
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

// 处理消息
function handleMessage(msg) {
  if (msg.type === 'chunk') {
    appendToResponse(msg.payload.content);

  } else if (msg.type === 'done') {
    finishResponse();
    isGenerating = false;
    sendBtn.disabled = !messageInput.value.trim();

  } else if (msg.type === 'error') {
    console.error('Error:', msg.payload.error);
    if (currentResponseEl) {
      currentResponseEl.querySelector('.bubble').innerHTML +=
        `<p style="color: red;">错误: ${msg.payload.error}</p>`;
    }
    finishResponse();
    isGenerating = false;
  }
}

// 发送消息
function sendMessage() {
  const message = messageInput.value.trim();
  if (!message || !isConnected || isGenerating) return;

  // 添加用户消息
  addUserMessage(message);

  // 清空输入框
  messageInput.value = '';
  messageInput.style.height = 'auto';

  // 开始生成
  isGenerating = true;
  sendBtn.disabled = true;

  // 创建 AI 消息占位
  startResponse();

  // 发送请求
  ws.send(JSON.stringify({
    type: 'chat',
    payload: {
      message,
      persona_id: currentPersona,
      mode: currentMode
    }
  }));
}

// 添加用户消息
function addUserMessage(message) {
  const msgEl = document.createElement('div');
  msgEl.className = 'message message-user';
  msgEl.innerHTML = `
    <div class="bubble">${escapeHtml(message)}</div>
  `;
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

  // 第一次追加，清除加载动画
  if (bubble.querySelector('.loading')) {
    bubble.innerHTML = '';
  }

  // Markdown 渲染
  const html = renderMarkdown(content);
  bubble.innerHTML += html;

  scrollToBottom();
}

// 完成响应
function finishResponse() {
  if (!currentResponseEl) return;

  const bubble = currentResponseEl.querySelector('.bubble');

  // 应用代码高亮
  bubble.querySelectorAll('pre code').forEach(block => {
    hljs.highlightElement(block);
  });

  // 添加时间戳
  const timeEl = document.createElement('div');
  timeEl.className = 'message-time';
  timeEl.textContent = new Date().toLocaleTimeString('zh-CN');
  currentResponseEl.appendChild(timeEl);

  currentResponseEl = null;
  scrollToBottom();
}

// Markdown 渲染
function renderMarkdown(text) {
  marked.setOptions({
    breaks: true,
    gfm: true
  });

  let html = marked.parse(text);

  // 移除最外层的 p 标签（如果是单独段落）
  if (html.startsWith('<p>') && html.endsWith('</p>')) {
    const inner = html.slice(3, -4);
    if (!inner.includes('<p>')) {
      html = inner;
    }
  }

  return html;
}

// 工具函数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// 启动
init();
