'use strict';

// ============================================================================
//  renderer.js —— 界面逻辑（跑在窗口里）
//  职责：画对话、把消息发给主进程、接收流式增量做「打字机」效果、存历史。
// ============================================================================

const api = window.barbara;

const $ = (id) => document.getElementById(id);

const el = {
  convoList: $('convo-list'),
  convoTitle: $('convo-title'),
  convoMeta: $('convo-meta'),
  messages: $('messages'),
  input: $('input'),
  hintText: $('hint-text'),
  usageText: $('usage-text'),
  btnNew: $('btn-new'),
  btnSend: $('btn-send'),
  btnStop: $('btn-stop'),
  btnClear: $('btn-clear'),
  btnCopyAll: $('btn-copy-all'),
  btnSettings: $('btn-settings'),
  btnFolder: $('btn-folder'),
  btnChars: $('btn-chars'),
  btnTheme: $('btn-theme'),
  modal: $('settings-modal'),
  btnCloseSettings: $('btn-close-settings'),
  btnSaveSettings: $('btn-save-settings'),
  btnTest: $('btn-test'),
  btnFetchModels: $('btn-fetch-models'),
  btnAddProvider: $('btn-add-provider'),
  btnDelProvider: $('btn-del-provider'),
  providerTabs: $('provider-tabs'),
  providerPresets: $('provider-presets'),
  modelSwitch: $('model-switch'),
  characterSwitch: $('character-switch'),
  confirmModal: $('confirm-modal'),
  confirmTitle: $('confirm-title'),
  confirmMessage: $('confirm-message'),
  confirmOk: $('confirm-ok'),
  confirmCancel: $('confirm-cancel'),
  toast: $('toast'),
  // 角色库
  charsModal: $('chars-modal'),
  btnCloseChars: $('btn-close-chars'),
  btnImportCard: $('btn-import-card'),
  btnNewChar: $('btn-new-char'),
  btnDelChar: $('btn-del-char'),
  btnSaveChar: $('btn-save-char'),
  charList: $('char-list'),
  charEmpty: $('char-empty'),
  charForm: $('char-form'),
  charAvatar: $('char-avatar'),
  btnClearAvatar: $('btn-clear-avatar'),
  charFootHint: $('char-foot-hint'),
  c: {
    name: $('c-name'),
    tags: $('c-tags'),
    desc: $('c-desc'),
    personality: $('c-personality'),
    scenario: $('c-scenario'),
    first: $('c-first'),
    example: $('c-example'),
    system: $('c-system'),
    post: $('c-post'),
    notes: $('c-notes')
  },
  s: {
    temp: $('s-temp'),
    maxTokens: $('s-maxtokens'),
    userName: $('s-username'),
    maxTurns: $('s-maxturns'),
    system: $('s-system'),
    sendOnEnter: $('s-sendonenter'),
    showDate: $('s-showdate'),
    showUsage: $('s-showusage')
  },
  p: {
    name: $('p-name'),
    baseUrl: $('p-baseurl'),
    apiKey: $('p-apikey'),
    models: $('p-models')
  }
};

const state = {
  settings: null,
  presets: [],
  conversations: [],
  characters: [],
  activeId: null,
  streaming: false,
  requestId: null,
  usage: null
};

let saveTimer = null;
let toastTimer = null;
let editingProviderId = null; // 设置弹窗里当前正在编辑的服务商
let editingCharacterId = null; // 角色库里当前正在编辑的角色
let charDraftAvatar = ''; // 正在编辑的角色头像（dataURL）

// ---------------------------------------------------------------------------
//  常量配置
// ---------------------------------------------------------------------------

const CONFIG = {
  MAX_TURNS: 20,           // 最多带入 API 的对话轮数（settings.maxTurns 的兜底值）
  SAVE_DEBOUNCE_MS: 350,   // 保存防抖延迟
  MAX_INPUT_HEIGHT: 190,   // 输入框最大高度
  SCROLL_BOTTOM_THRESHOLD: 40, // 滚动到底部的判定阈值
  TOAST_DURATION_MS: 3200  // 提示消息显示时长
};

// ---------------------------------------------------------------------------
//  工具
// ---------------------------------------------------------------------------

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return Date.now();
}

function activeConvo() {
  return state.conversations.find((c) => c.id === state.activeId) || null;
}

// ---------------------------------------------------------------------------
//  多模型：服务商（provider）+ 模型（model）
//  一个服务商 = 一套「接口地址 + API Key + 模型列表」。
//  每个会话会记住自己用的是哪个服务商的哪个模型。
// ---------------------------------------------------------------------------

function providers() {
  const s = state.settings || {};
  return Array.isArray(s.providers) ? s.providers : [];
}

function providerById(id) {
  return providers().find((p) => p.id === id) || null;
}

/** 把会话绑定的服务商/模型补全（老会话没有这两个字段） */
function ensureConvoEndpoint(convo) {
  if (!convo) return null;
  const list = providers();
  if (!list.length) return null;

  const s = state.settings || {};
  let provider = providerById(convo.providerId);

  if (!provider) {
    provider = providerById(s.activeProviderId) || list[0];
    convo.providerId = provider.id;
    convo.model = s.activeModel || provider.models[0] || '';
  }
  if (!convo.model) {
    convo.model = provider.models[0] || s.activeModel || '';
  }
  // 模型可能被用户从列表里删掉了，临时补回去，免得下拉框里找不到当前值
  if (convo.model && !provider.models.includes(convo.model)) {
    provider.models = [convo.model, ...provider.models];
  }

  return { provider, model: convo.model };
}

/** 当前会话实际会用的服务商 + 模型 */
function currentEndpoint() {
  const convo = activeConvo();
  if (convo) return ensureConvoEndpoint(convo);

  const s = state.settings || {};
  const provider = providerById(s.activeProviderId) || providers()[0] || null;
  return provider ? { provider, model: s.activeModel || provider.models[0] || '' } : null;
}

// ---------------------------------------------------------------------------
//  角色（角色扮演）
//  一张角色卡 = 角色名 + 设定 + 开场白 + 示例对话。
//  会话可以绑定一个角色；绑了角色的会话不再使用「设置」里的全局人设。
// ---------------------------------------------------------------------------

function characters() {
  return Array.isArray(state.characters) ? state.characters : [];
}

function characterById(id) {
  if (!id) return null;
  return characters().find((c) => c.id === id) || null;
}

/** 当前会话绑定的角色（没绑就是 null，走通用助手） */
function characterForConvo(convo) {
  return convo ? characterById(convo.characterId) : null;
}

/** {{user}} 的替换值 */
function userName() {
  const name = (state.settings && state.settings.userName) || '';
  return String(name).trim() || '你';
}

/**
 * 替换角色卡里的占位符。
 * {{char}} / <BOT> 是角色自己，{{user}} / <USER> 是你。
 * 只在「发给模型」和「插入开场白」时替换，原始文本保持不动，
 * 这样以后改了名字，旧消息不会莫名其妙跟着变。
 */
function applyMacros(text, character, name) {
  const charName = (character && character.name) || 'Barbara';
  const me = name || userName();

  // 用函数式替换：字符串形式的替换参数会把 $&、$1 之类的序列当特殊写法，
  // 角色名里万一有 $ 就会替换错乱。
  return String(text == null ? '' : text)
    .replace(/\{\{char\}\}/gi, () => charName)
    .replace(/\{\{user\}\}/gi, () => me)
    .replace(/<BOT>/gi, () => charName)
    .replace(/<USER>/gi, () => me);
}

/**
 * 把角色卡的「示例对话」拆成真正的 user / assistant 消息。
 * 格式是每行以 {{user}}: 或 {{char}}: 开头，多组之间用 <START> 分隔。
 * 解析不出来就返回空数组，不会影响正常对话。
 */
function parseExampleDialogue(text, charName, me) {
  const out = [];
  const raw = String(text || '');
  if (!raw.trim()) return out;

  // 注意：这里的 reEsc 是「正则转义」，和上面转义 HTML 的 esc() 不是一回事，
  // 刻意换个名字，免得以后改错。
  const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 名字为空时不能把「空字符串」也当成一种匹配，否则任意行都会被吃掉
  const alternatives = (name, kind, extraTags) => {
    const list = [`\\{\\{${kind}\\}\\}`, ...extraTags];
    if (name && String(name).trim()) list.push(reEsc(String(name).trim()));
    return list.join('|');
  };

  const markers = [
    {
      re: new RegExp(`^\\s*(?:${alternatives(me, 'user', ['<USER>'])})\\s*[:：]\\s*(.*)$`, 'i'),
      role: 'user'
    },
    {
      re: new RegExp(
        `^\\s*(?:${alternatives(charName, 'char', ['<CHAR>', '<BOT>', '<BOT_NAME>'])})\\s*[:：]\\s*(.*)$`,
        'i'
      ),
      role: 'assistant'
    }
  ];

  let pending = null;

  const flush = () => {
    if (pending) {
      const content = pending.lines.join('\n').trim();
      if (content) out.push({ role: pending.role, content });
      pending = null;
    }
  };

  for (const line of raw.split(/\r?\n/)) {
    // <START> 表示一组新的示例，只是分割线
    if (/^\s*<START>\s*$/i.test(line)) {
      flush();
      continue;
    }

    let matched = false;
    for (const marker of markers) {
      const m = line.match(marker.re);
      if (m) {
        flush();
        pending = { role: marker.role, lines: [m[1]] };
        matched = true;
        break;
      }
    }
    // 没匹配到前缀就当作上一句的续行（角色说了好几行的情况很常见）
    if (!matched && pending) pending.lines.push(line);
  }

  flush();
  return out;
}

// 用户自己往上翻看历史时，不要被流式输出拽回底部
let userReadingHistory = false;

function scrollToBottom(force) {
  if (force) userReadingHistory = false;
  if (userReadingHistory) return;

  // 直接给一个远大于最大值的数，浏览器会自动夹到最底部。
  // 不读 scrollHeight 是故意的：读它会强制一次同步布局（reflow），
  // 而流式输出时这里每 50ms 就跑一次，长对话下这个开销很明显。
  // 写 scrollTop 则可以让浏览器把布局推迟到下一个渲染帧。
  el.messages.scrollTop = 1e9;
}

function showToast(message, kind) {
  el.toast.textContent = message;
  el.toast.className = `toast${kind ? ` ${kind}` : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), CONFIG.TOAST_DURATION_MS);
}

// ---------------------------------------------------------------------------
//  白天 / 夜间模式
//  主题只体现在 <html> 的 data-theme 上，具体配色全在 style.css 的变量里。
// ---------------------------------------------------------------------------

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);

  if (el.btnTheme) {
    const isDark = next === 'dark';
    const label = isDark ? '切换为白天模式' : '切换为夜间模式';
    el.btnTheme.title = label;
    el.btnTheme.setAttribute('aria-label', label);
    el.btnTheme.setAttribute('aria-pressed', isDark ? 'true' : 'false');
  }
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);

  if (state.settings) state.settings.theme = next;

  // 主题是设置的一部分，跟着 config.json 一起存，下次启动还是这个模式
  api.saveSettings({ theme: next }).catch((err) => {
    console.error('保存主题失败', err);
    showToast('主题没能保存，重启后会回到原来的模式', 'error');
  });
}

/**
 * 应用内的确认弹窗（替代 window.confirm）。
 * 用系统原生 confirm 会有一个副作用：关掉它的那一下点击会被吞掉，
 * 之后点输入框要点两次才能聚焦，看起来就像「输入框点不动」。
 * 返回 Promise<boolean>。
 */
function confirmDialog(options) {
  const opts = options || {};

  el.confirmTitle.textContent = opts.title || '确认';
  el.confirmMessage.textContent = opts.message || '';
  el.confirmOk.textContent = opts.confirmText || '确定';
  el.confirmOk.className = `btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`;

  el.confirmModal.classList.remove('hidden');
  el.confirmCancel.focus();

  return new Promise((resolve) => {
    function cleanup(result) {
      el.confirmOk.removeEventListener('click', onOk);
      el.confirmCancel.removeEventListener('click', onCancel);
      el.confirmModal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      el.confirmModal.classList.add('hidden');
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onBackdrop(event) {
      if (event.target === el.confirmModal) cleanup(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cleanup(false);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        cleanup(true);
      }
    }

    el.confirmOk.addEventListener('click', onOk);
    el.confirmCancel.addEventListener('click', onCancel);
    el.confirmModal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}

/** 保存历史会话（防抖，避免每敲一个字都写磁盘） */
function persistConversations(delay) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api
      .saveConversations({ conversations: state.conversations, activeId: state.activeId })
      .then(() => {
        // 保存成功，静默
      })
      .catch((err) => {
        console.error('保存会话失败', err);
        showToast('保存会话失败，请检查磁盘空间', 'error');
      });
  }, typeof delay === 'number' ? delay : 350);
}

// ---------------------------------------------------------------------------
//  流式文字的重绘
//  这里是「文字一顿一顿往外冒」的关键，三件事：
//    1. 不设时间节流，用 requestAnimationFrame 每帧都画。
//       之前限成 50ms（每秒 20 次），而模型每秒吐 20~60 个 token，
//       于是每次重绘都攒下好几个字一起蹦出来 —— 就是「几个字几个字」的来源。
//       每帧画（最多 60 次/秒）后，每个 token 到达后最多一帧就显示出来。
//    2. 记住上次渲染出的 HTML，内容没变就完全不碰 DOM。
//       rAF 在没有新 token 时也会继续触发，靠这个判断避免空转重排。
//    3. 只有真的重绘了才去滚动（见 scrollToBottom 的注释）。
//  注：innerHTML 是整棵子树重建，但实测代价很小（几千字也就 1~2ms），
//      60 次/秒完全撑得住；真正贵的是读 scrollHeight 触发的强制同步布局。
// ---------------------------------------------------------------------------

const streamPainter = (() => {
  let rafId = null;
  let node = null;
  let text = null;
  let lastHtml = null;

  function schedule() {
    if (rafId === null) rafId = requestAnimationFrame(paint);
  }

  function paint() {
    rafId = null;
    if (!node || text === null) return;

    const html = renderMarkdown(text, { streaming: true });
    if (html === lastHtml) return; // 没有新内容，不做任何 DOM 操作

    lastHtml = html;
    node.innerHTML = html;
    scrollToBottom(false);
  }

  return {
    push(target, value) {
      if (target !== node) {
        // 换了目标节点，缓存作废
        node = target;
        lastHtml = null;
      }
      text = value;
      schedule();
    },
    stop() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      node = null;
      text = null;
      lastHtml = null;
    }
  };
})();

// ---------------------------------------------------------------------------
//  极简 Markdown 渲染
//  先整体转义 HTML，再按块级/行内规则替换，所以内容是安全的。
// ---------------------------------------------------------------------------

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(text) {
  let out = text;

  // 行内代码 `code` —— 先抽出来占位，避免里面的符号被当成格式
  const codes = [];
  out = out.replace(/`([^`\n]+)`/g, (_m, code) => {
    codes.push(code);
    return `\u0000C${codes.length - 1}\u0000`;
  });

  out = out.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // 链接：只放行 http/https，其他一律当普通文字
  const links = [];
  out = out
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, href) => {
      links.push(`<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`);
      return `\u0000L${links.length - 1}\u0000`;
    })
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, pre, href) => {
      links.push(`<a href="${href}" target="_blank" rel="noreferrer">${href}</a>`);
      return `${pre}\u0000L${links.length - 1}\u0000`;
    });

  out = out.replace(/\u0000C(\d+)\u0000/g, (_m, i) => `<code>${codes[Number(i)]}</code>`);
  out = out.replace(/\u0000L(\d+)\u0000/g, (_m, i) => links[Number(i)]);
  return out;
}

function renderMarkdown(source, options) {
  let text = String(source == null ? '' : source).replace(/\r\n/g, '\n');

  // 流式生成中，代码块可能只来了一半：临时补个结尾，免得显示成乱码
  if (options && options.streaming) {
    const fences = (text.match(/```/g) || []).length;
    if (fences % 2 === 1) text += '\n```';
  }

  // 1. 先把 ``` 代码块抽出来，避免块内内容被解析
  const blocks = [];
  const withoutFences = text.replace(/```([\w+#.-]*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
    const cls = lang ? ` class="language-${esc(lang.toLowerCase())}"` : '';
    blocks.push(`<pre><code${cls}>${esc(code.replace(/\n$/, ''))}</code></pre>`);
    return `\n\u0000B${blocks.length - 1}\u0000\n`;
  });

  // 2. 逐行处理块级元素
  const lines = esc(withoutFences).split('\n');
  const out = [];
  let listType = null;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^\u0000B\d+\u0000$/.test(trimmed)) {
      closeList();
      out.push(trimmed);
      continue;
    }

    if (!trimmed) {
      closeList();
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeList();
      out.push('<hr />');
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = Math.min(3, heading[1].length);
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const quote = trimmed.match(/^&gt;\s?(.*)$/);
    if (quote) {
      closeList();
      out.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      if (listType !== 'ul') {
        closeList();
        out.push('<ul>');
        listType = 'ul';
      }
      out.push(`<li>${renderInline(bullet[1])}</li>`);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) {
      if (listType !== 'ol') {
        closeList();
        out.push('<ol>');
        listType = 'ol';
      }
      out.push(`<li>${renderInline(ordered[1])}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${renderInline(trimmed)}</p>`);
  }
  closeList();

  let html = out.join('\n');

  // 3. 还原代码块
  html = html.replace(/\u0000B(\d+)\u0000/g, (_m, i) => blocks[Number(i)]);
  return html;
}

// ---------------------------------------------------------------------------
//  渲染：会话列表、标题、消息
// ---------------------------------------------------------------------------

function renderConvoList() {
  el.convoList.innerHTML = '';

  if (!state.conversations.length) {
    const empty = document.createElement('div');
    empty.className = 'convo-title';
    empty.style.padding = '8px 9px';
    empty.style.color = 'var(--text-faint)';
    empty.textContent = '（还没有会话）';
    el.convoList.appendChild(empty);
    return;
  }

  for (const convo of state.conversations) {
    const item = document.createElement('div');
    item.className = `convo-item${convo.id === state.activeId ? ' active' : ''}`;
    item.setAttribute('role', 'listitem');

    const title = document.createElement('span');
    title.className = 'convo-title';
    title.textContent = convo.title || '新对话';
    title.title = convo.title || '新对话';

    const del = document.createElement('button');
    del.className = 'convo-del';
    del.textContent = '×';
    del.title = '删除这个会话';
    del.setAttribute('aria-label', `删除会话：${convo.title || '新对话'}`);

    item.appendChild(title);
    item.appendChild(del);

    item.addEventListener('click', () => switchConvo(convo.id));
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      removeConvo(convo.id);
    });

    el.convoList.appendChild(item);
  }
}

function renderHeader() {
  const convo = activeConvo();
  const settings = state.settings || {};
  el.convoTitle.textContent = (convo && convo.title) || '新对话';

  const endpoint = currentEndpoint();
  const character = characterForConvo(convo);
  const prefix = character ? `${character.name} · ` : '';

  if (!endpoint) {
    el.convoMeta.textContent = '还没有配置模型服务 —— 点左下角「设置」';
  } else if (!endpoint.provider.apiKey) {
    el.convoMeta.textContent = `${prefix}还没有填「${endpoint.provider.name}」的 API Key —— 点左下角「设置」`;
  } else {
    el.convoMeta.textContent = `${prefix}${endpoint.provider.name} · ${endpoint.model || '未选模型'}`;
  }

  el.hintText.textContent = settings.sendOnEnter === false
    ? 'Ctrl + Enter 发送 · Enter 换行'
    : 'Enter 发送 · Shift + Enter 换行';

  if (state.usage && settings.showUsage !== false) {
    const u = state.usage;
    el.usageText.textContent = `本次用量：输入 ${u.prompt_tokens ?? '-'} / 输出 ${u.completion_tokens ?? '-'} tokens`;
  } else {
    el.usageText.textContent = '';
  }
}

/** 右上角的模型下拉框：按服务商分组，列出所有可用模型 */
function renderModelSwitch() {
  const select = el.modelSwitch;
  if (!select) return;

  const list = providers();
  const endpoint = currentEndpoint();

  select.innerHTML = '';

  if (!list.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '未配置模型';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  for (const p of list) {
    const group = document.createElement('optgroup');
    group.label = p.apiKey ? p.name : `${p.name}（未填 Key）`;

    if (!p.models || !p.models.length) {
      const opt = document.createElement('option');
      opt.value = `${p.id}::`;
      opt.textContent = '（还没有模型）';
      opt.disabled = true;
      group.appendChild(opt);
    } else {
      for (const m of p.models) {
        const opt = document.createElement('option');
        opt.value = `${p.id}::${m}`;
        opt.textContent = m;
        group.appendChild(opt);
      }
    }
    select.appendChild(group);
  }

  if (endpoint && endpoint.provider && endpoint.model) {
    select.value = `${endpoint.provider.id}::${endpoint.model}`;
  }
  select.disabled = false;
}

/** 顶部的角色下拉框：当前会话扮演谁 */
function renderCharacterSwitch() {
  const select = el.characterSwitch;
  if (!select) return;

  const convo = activeConvo();
  const list = characters();

  select.innerHTML = '';

  const none = document.createElement('option');
  none.value = '';
  none.textContent = list.length ? '无角色（通用助手）' : '还没有角色';
  select.appendChild(none);

  for (const c of list) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    select.appendChild(opt);
  }

  const bound = convo && characterById(convo.characterId);
  select.value = bound ? bound.id : '';
  select.classList.toggle('has-char', Boolean(bound));
}

/** 切换当前会话绑定的角色 */
async function applyCharacterChoice(characterId) {
  const convo = activeConvo();
  if (!convo) return;

  if (state.streaming) {
    showToast('正在生成回答，先点「停止生成」再切换角色');
    renderCharacterSwitch();
    return;
  }

  const next = characterId ? characterById(characterId) : null;
  if (characterId && !next) {
    renderCharacterSwitch();
    return;
  }

  const previous = characterById(convo.characterId); // 用来判断标题是不是自动生成的

  // 自动插入的开场白会带 greeting 标记。
  // 只有「会话里只剩这一条开场白、你还没开口」时才允许被替换 ——
  // 不能用「只有一条 assistant 消息」来判断，否则你删掉自己的提问之后
  // 留下的那条真实回复，会被当成开场白悄悄丢掉。
  const staleGreeting = convo.messages.length === 1 && convo.messages[0].greeting === true;
  const untouched = !convo.messages.length || staleGreeting;

  convo.characterId = next ? next.id : null;
  convo.updatedAt = now();

  if (next && next.firstMes && untouched) {
    // 空对话绑上带开场白的角色时，自动把开场白放进去，省得每次手动开个头
    convo.messages = [
      {
        role: 'assistant',
        content: applyMacros(next.firstMes, next, userName()),
        at: now(),
        greeting: true
      }
    ];
  } else if (!next && staleGreeting) {
    // 切回「无角色」时，把还没动过的开场白也撤掉，不留上一个角色的招呼语
    convo.messages = [];
  }

  // 标题是跟着角色自动起的话，换角色时一起换掉
  const autoTitle = !convo.title || convo.title === '新对话' || (previous && convo.title === previous.name);
  if (autoTitle) convo.title = next ? next.name : '新对话';

  renderAll({ forceScroll: true });
  persistConversations(0);

  if (next) {
    showToast(`已切换角色：${next.name}`, 'ok');
  } else {
    showToast('已切换为通用助手（使用设置里的人设）');
  }
}

/** 切换当前会话用的模型，同时记成「新会话」的默认模型 */
function applyModelChoice(value) {
  const raw = String(value || '');
  const sep = raw.indexOf('::');
  if (sep < 0) return;

  const providerId = raw.slice(0, sep);
  const model = raw.slice(sep + 2);
  const provider = providerById(providerId);

  if (!provider || !model) {
    renderModelSwitch();
    return;
  }

  if (state.streaming) {
    showToast('正在生成回答，先点「停止生成」再切换模型');
    renderModelSwitch();
    return;
  }

  const convo = activeConvo();
  if (convo) {
    convo.providerId = providerId;
    convo.model = model;
    convo.updatedAt = now();
  }

  // 顺便设为新会话的默认值
  state.settings.activeProviderId = providerId;
  state.settings.activeModel = model;

  renderHeader();
  persistConversations(0);

  api
    .saveSettings({
      // 连 providers 一起存：这样刚添加、还没点「保存」的服务商不会被丢掉
      providers: providers(),
      activeProviderId: providerId,
      activeModel: model
    })
    .catch((err) => {
      console.error('保存模型选择失败', err);
      showToast('模型选择没能写入配置，重启后会回到默认值', 'error');
    });

  showToast(`已切换为 ${provider.name} · ${model}`, 'ok');
}

function messageNode(message, index, character) {
  const isUser = message.role === 'user';
  const isError = message.role === 'error';
  // 角色只用来标识助手那一侧。用户消息和错误提示绝不能套角色的头像和名字，
  // 否则你自己的气泡上会顶着角色的脸。
  const speaker = isUser || isError ? null : character;

  const wrap = document.createElement('div');
  wrap.className = `msg ${isError ? 'error' : isUser ? 'user' : 'assistant'}`;
  wrap.dataset.index = String(index);

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';

  if (speaker && speaker.avatar) {
    const img = document.createElement('img');
    img.src = speaker.avatar;
    img.alt = speaker.name;
    avatar.appendChild(img);
    avatar.classList.add('has-image');
    avatar.title = speaker.name;
  } else {
    avatar.textContent = isError ? '!' : isUser ? '我' : speaker ? speaker.name.slice(0, 1) : 'AI';
  }

  const body = document.createElement('div');
  body.className = 'msg-body';

  const role = document.createElement('div');
  role.className = 'msg-role';
  role.textContent = isError ? '出错了' : isUser ? userName() : speaker ? speaker.name : 'Barbara';

  // 助手消息上标出是哪个模型答的，方便对比多个模型
  if (!isUser && !isError && message.model) {
    const tag = document.createElement('span');
    tag.className = 'msg-model';
    tag.textContent = message.model;
    role.appendChild(tag);
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (message.reasoning) {
    const details = document.createElement('details');
    details.className = 'reasoning';
    const summary = document.createElement('summary');
    summary.textContent = '思考过程';
    const pre = document.createElement('div');
    pre.className = 'reasoning-text';
    pre.textContent = message.reasoning;
    details.appendChild(summary);
    details.appendChild(pre);
    bubble.appendChild(details);
  }

  const content = document.createElement('div');
  content.className = 'msg-content';
  if (isUser || isError) {
    content.textContent = message.content;
  } else {
    content.innerHTML = renderMarkdown(message.content);
  }
  bubble.appendChild(content);

  body.appendChild(role);
  body.appendChild(bubble);

  // 操作按钮
  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  if (!isError && message.content) {
    const copy = document.createElement('button');
    copy.className = 'mini-btn';
    copy.textContent = '复制';
    copy.title = '复制这条消息';
    copy.setAttribute('aria-label', '复制这条消息');
    copy.addEventListener('click', () => {
      api.copyText(message.content);
      showToast('已复制到剪贴板', 'ok');
    });
    actions.appendChild(copy);
  }

  if (!isUser) {
    const regen = document.createElement('button');
    regen.className = 'mini-btn';
    regen.textContent = isError ? '重试' : '重新生成';
    regen.title = isError ? '重新发送上一条消息' : '重新生成这条回复';
    regen.setAttribute('aria-label', isError ? '重新发送上一条消息' : '重新生成这条回复');
    regen.addEventListener('click', () => regenerateFrom(index));
    actions.appendChild(regen);
  }

  // 删除这一条消息（会先弹确认框）
  const del = document.createElement('button');
  del.className = 'mini-btn danger';
  del.textContent = '删除';
  del.title = '删除这条消息';
  del.setAttribute('aria-label', '删除这条消息');
  del.addEventListener('click', () => removeMessage(index));
  actions.appendChild(del);

  body.appendChild(actions);

  wrap.appendChild(avatar);
  wrap.appendChild(body);
  return wrap;
}

function renderMessages(options) {
  const opts = options || {};
  const convo = activeConvo();
  const character = characterForConvo(convo);
  el.messages.innerHTML = '';

  if (!convo || !convo.messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = character
      ? `
      <h2>开始和${esc(character.name)}聊天吧～</h2>
      <p>在下面输入框里说点什么，然后按 Enter。</p>
      <p class="hint">当前扮演的是「${esc(character.name)}」，在窗口顶部可以随时换角色。</p>
    `
      : `
      <h2>开始和芭芭拉聊天吧～</h2>
      <p>在下面输入框里说点什么，然后按 Enter。</p>
      <p class="hint">第一次使用请先点左下角「设置」，填入接口地址和 API Key。</p>
      <p class="hint">想玩角色扮演？点左下角「角色库」，导入一张酒馆角色卡试试。</p>
    `;
    el.messages.appendChild(empty);
    scrollToBottom(true);
    return;
  }

  convo.messages.forEach((message, index) => {
    el.messages.appendChild(messageNode(message, index, character));
  });

  scrollToBottom(!!opts.forceScroll);
}

function renderAll(options) {
  renderConvoList();
  renderHeader();
  renderCharacterSwitch();
  renderModelSwitch();
  renderMessages(options);
}

// ---------------------------------------------------------------------------
//  会话管理
// ---------------------------------------------------------------------------

function createConvo(activate) {
  // 新对话继承当前（或最近一个）会话绑定的角色，这样连着同一个角色聊不用反复选
  const source = activeConvo() || state.conversations[0] || null;

  const convo = {
    id: uid(),
    title: '新对话',
    createdAt: now(),
    updatedAt: now(),
    messages: [],
    characterId: source ? source.characterId || null : null
  };
  state.conversations.unshift(convo);
  if (activate !== false) state.activeId = convo.id;
  persistConversations(0);
  return convo;
}

function switchConvo(id) {
  if (state.streaming) {
    showToast('正在生成回答，先点「停止生成」再切换会话');
    return;
  }
  state.activeId = id;
  state.usage = null;
  renderAll({ forceScroll: true });
  persistConversations(0);
}

async function removeConvo(id) {
  const convo = state.conversations.find((c) => c.id === id);
  if (!convo) return;

  const ok = await confirmDialog({
    title: '删除会话',
    message: `删除会话「${convo.title || '新对话'}」？此操作无法撤销。`,
    confirmText: '删除',
    danger: true
  });
  if (!ok) return;

  state.conversations = state.conversations.filter((c) => c.id !== id);
  if (state.activeId === id) {
    state.activeId = state.conversations.length ? state.conversations[0].id : null;
  }
  if (!state.conversations.length) createConvo(true);
  state.usage = null;
  renderAll({ forceScroll: true });
  persistConversations(0);
  el.input.focus();
}

async function clearConvo() {
  const convo = activeConvo();
  if (!convo || !convo.messages.length) {
    showToast('当前会话已经是空的');
    return;
  }

  const ok = await confirmDialog({
    title: '清空对话',
    message: '清空当前会话的所有消息？此操作无法撤销。',
    confirmText: '清空',
    danger: true
  });
  // 不管确定还是取消，都把光标放回输入框：
  // 弹窗关掉后焦点会留在弹窗里，不主动交还的话输入框点起来像是「没反应」。
  if (!ok) {
    el.input.focus();
    return;
  }

  convo.messages = [];
  convo.title = '新对话';
  state.usage = null;
  renderAll({ forceScroll: true });
  persistConversations(0);
  el.input.focus();
  showToast('已清空当前对话', 'ok');
}

/** 删除单独一条消息 */
async function removeMessage(index) {
  const convo = activeConvo();
  if (!convo) return;

  if (state.streaming) {
    showToast('正在生成回答，先点「停止生成」再删除消息');
    return;
  }

  const message = convo.messages[index];
  if (!message) return;

  const label =
    message.role === 'user' ? '你发的这条' : message.role === 'error' ? '这条错误提示' : '这条回答';

  const ok = await confirmDialog({
    title: '删除消息',
    message: `删除${label}？此操作无法撤销。`,
    confirmText: '删除',
    danger: true
  });
  if (!ok) return;

  convo.messages.splice(index, 1);
  convo.updatedAt = now();
  state.usage = null;
  renderAll({ forceScroll: false });
  persistConversations(0);
  showToast('已删除这条消息', 'ok');
}

// ---------------------------------------------------------------------------
//  发送与流式接收
// ---------------------------------------------------------------------------

/**
 * 组装真正发给模型的消息数组。
 *
 * 顺序（和酒馆的思路一致）：
 *   1. system：人设 + 扮演规则 + 角色设定/性格/场景 + 日期
 *   2. 角色卡里的示例对话（当成已经发生过的对话塞进去）
 *   3. 最近 N 轮真实对话
 *   4. 角色卡里的「对话后指令」，放最后最管用
 *
 * 绑定了角色卡时不再使用「设置」里的全局人设 —— 否则你扮演雷电将军，
 * 系统提示词却在说「你是芭芭拉」，模型会精神分裂。
 */
function buildApiMessages(convo) {
  const settings = state.settings || {};
  const character = characterForConvo(convo);
  const me = userName();
  const charName = (character && character.name) || 'Barbara';

  // 注意：调用时对话末尾通常刚 push 了一条空的 assistant 占位消息（用来流式填空），
  // 必须把它过滤掉，否则会发给接口一条 content 为空的消息，严格的接口会直接报 400。
  const history = convo.messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim()
  );

  const turns = Math.max(1, Number(settings.maxTurns) || CONFIG.MAX_TURNS);
  const recent = history.slice(-turns * 2);

  const messages = [];

  // ---- 1. 系统提示词 ----
  const parts = [];
  const base = character ? character.systemPrompt || '' : settings.systemPrompt || '';
  if (String(base).trim()) parts.push(applyMacros(base, character, me).trim());

  if (character) {
    if (character.description) parts.push(`【${charName}的设定】\n${applyMacros(character.description, character, me)}`);
    if (character.personality) parts.push(`【${charName}的性格】\n${applyMacros(character.personality, character, me)}`);
    if (character.scenario) parts.push(`【当前场景】\n${applyMacros(character.scenario, character, me)}`);

    parts.push(
      `【扮演规则】\n` +
        `你现在要扮演「${charName}」。请始终以第一人称，用 ${charName} 的语气、性格和说话习惯回应，` +
        `保持人设前后一致，不要跳出角色，也不要提到自己是 AI、语言模型或助手。` +
        `把对方称作「${me}」。用动作或神态描写时放在括号里。`
    );
  }

  if (settings.showDate !== false) {
    const today = new Date().toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });
    parts.push(`[参考信息] 今天是 ${today}。`);
  }

  if (parts.length) messages.push({ role: 'system', content: parts.join('\n\n') });

  // ---- 2. 示例对话 ----
  // 注意：parseExampleDialogue 只剥掉了行首的「{{user}}:」前缀，
  // 正文里的宏还得自己替换一遍，否则模型会读到字面的 {{user}}。
  if (character) {
    for (const example of parseExampleDialogue(character.mesExample, charName, me)) {
      messages.push({
        role: example.role,
        content: applyMacros(example.content, character, me)
      });
    }
  }

  // ---- 3. 真实对话历史 ----
  for (const m of recent) {
    messages.push({ role: m.role, content: applyMacros(m.content, character, me) });
  }

  // ---- 4. 对话后指令 ----
  if (character && String(character.postHistoryInstructions || '').trim()) {
    messages.push({
      role: 'system',
      content: applyMacros(character.postHistoryInstructions, character, me).trim()
    });
  }

  return messages;
}

function setStreaming(on) {
  state.streaming = on;
  el.btnStop.classList.toggle('hidden', !on);
  el.btnSend.disabled = on;
}

async function sendMessage(text) {
  const content = String(text || '').trim();
  if (!content) return;

  if (state.streaming) {
    showToast('正在生成中，请稍候或先停止');
    return;
  }

  let convo = activeConvo();
  if (!convo) convo = createConvo(true);

  // 用当前会话绑定的服务商 + 模型；没绑过就用全局默认
  const endpoint = ensureConvoEndpoint(convo);
  if (!endpoint) {
    showToast('还没有配置模型服务，请先在设置里添加', 'error');
    openSettings();
    return;
  }
  if (!endpoint.provider.apiKey) {
    showToast(`请先填写「${endpoint.provider.name}」的 API Key`, 'error');
    openSettings();
    return;
  }

  if (convo.messages.length === 0) {
    convo.title = content.slice(0, 24) || '新对话';
  }

  convo.messages.push({ role: 'user', content, at: now() });
  convo.updatedAt = now();
  state.usage = null;
  renderAll({ forceScroll: true });
  persistConversations();

  await requestCompletion(convo);
}

/** 调一次模型，把回复流式写进界面 */
async function requestCompletion(convo) {
  const endpoint = ensureConvoEndpoint(convo);
  if (!endpoint) {
    showToast('还没有配置模型服务', 'error');
    return;
  }

  const requestId = uid();
  state.requestId = requestId;

  // 先插入一个空的助手消息，边收边填
  const assistant = {
    role: 'assistant',
    content: '',
    reasoning: '',
    at: now(),
    model: endpoint.model,
    providerId: endpoint.provider.id
  };
  convo.messages.push(assistant);

  const index = convo.messages.length - 1;
  renderAll({ forceScroll: true });

  const node = el.messages.querySelector(`.msg[data-index="${index}"] .msg-content`);
  const bubble = node ? node.parentElement : null;

  if (bubble) bubble.classList.add('streaming');

  if (node) {
    const wait = document.createElement('div');
    wait.className = 'waiting';
    wait.textContent = '正在思考';
    node.innerHTML = '';
    node.appendChild(wait);
  }

  setStreaming(true);

  try {
    const response = await api.sendChat({
      requestId,
      providerId: endpoint.provider.id,
      model: endpoint.model,
      messages: buildApiMessages(convo)
    });

    if (!response || response.ok !== true) {
      throw new Error((response && response.error) || '调用失败');
    }

    if (response.usage) state.usage = response.usage;
    // 主进程可能会把模型名规范化，以它返回的为准
    if (response.model) assistant.model = response.model;

    assistant.content = response.content || assistant.content;
    assistant.reasoning = response.reasoning || assistant.reasoning;

    if (!assistant.content && !assistant.reasoning) {
      throw new Error('接口没有返回任何内容。可能是模型名不对，或该模型不支持流式输出。');
    }
  } catch (err) {
    const message = (err && err.message) || '未知错误';
    const stopped = /已停止生成/.test(message);

    if (stopped) {
      if (!assistant.content) {
        convo.messages.splice(index, 1);
      }
      showToast('已停止生成');
    } else {
      // 把失败的那条助手消息换成错误提示，并留一个「重试」按钮
      convo.messages.splice(index, 1);
      convo.messages.push({ role: 'error', content: message, at: now(), retryable: true });
    }
  } finally {
    streamPainter.stop();
    setStreaming(false);
    state.requestId = null;
    convo.updatedAt = now();
    renderAll({ forceScroll: true });
    persistConversations();
    el.input.focus();
  }
}

/** 删除某条助手消息之后的全部内容，重新问一次 */
function regenerateFrom(index) {
  const convo = activeConvo();
  if (!convo || state.streaming) return;

  let cut = Math.min(index, convo.messages.length - 1);
  while (cut >= 0 && convo.messages[cut].role !== 'user') cut -= 1;

  if (cut < 0) {
    showToast('找不到对应的提问，无法重新生成', 'error');
    return;
  }

  convo.messages = convo.messages.slice(0, cut + 1);
  state.usage = null;
  persistConversations(0);
  requestCompletion(convo);
}

async function stopGenerating() {
  await api.stopChat();
}

// ---------------------------------------------------------------------------
//  设置弹窗
// ---------------------------------------------------------------------------

function fillSettingsForm(settings) {
  el.s.temp.value = settings.temperature ?? 0.7;
  el.s.maxTokens.value = settings.maxTokens ?? 2048;
  el.s.userName.value = settings.userName || '你';
  el.s.maxTurns.value = settings.maxTurns ?? CONFIG.MAX_TURNS;
  el.s.system.value = settings.systemPrompt || '';
  el.s.sendOnEnter.checked = settings.sendOnEnter !== false;
  el.s.showDate.checked = settings.showDate !== false;
  el.s.showUsage.checked = settings.showUsage !== false;
}

// ------------------------------ 服务商编辑 ------------------------------

function parseModels(text) {
  return [...new Set(String(text || '').split(/[\n,，]/).map((m) => m.trim()).filter(Boolean))];
}

/** 把表单里当前编辑的服务商写回内存（还没落盘） */
function stashProviderForm() {
  const p = providerById(editingProviderId);
  if (!p) return;
  p.name = el.p.name.value.trim() || p.name || '未命名服务商';
  p.baseUrl = el.p.baseUrl.value.trim() || p.baseUrl;
  p.apiKey = el.p.apiKey.value.trim();
  p.models = parseModels(el.p.models.value);
}

/** 把内存里的服务商填进表单 */
function fillProviderForm() {
  const p = providerById(editingProviderId);
  el.p.name.value = p ? p.name || '' : '';
  el.p.baseUrl.value = p ? p.baseUrl || '' : '';
  el.p.apiKey.value = p ? p.apiKey || '' : '';
  el.p.models.value = p ? (p.models || []).join('\n') : '';
  el.btnDelProvider.disabled = providers().length <= 1;
}

function renderProviderTabs() {
  el.providerTabs.innerHTML = '';

  for (const p of providers()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `provider-tab${p.id === editingProviderId ? ' active' : ''}`;
    btn.textContent = p.name || '未命名';
    btn.title = p.apiKey ? `${p.name}（已填 Key）` : `${p.name}（还没有填 API Key）`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', p.id === editingProviderId ? 'true' : 'false');

    btn.addEventListener('click', () => {
      if (p.id === editingProviderId) return;
      stashProviderForm();
      editingProviderId = p.id;
      renderProviderTabs();
      fillProviderForm();
    });

    el.providerTabs.appendChild(btn);
  }
}

function renderPresets() {
  el.providerPresets.innerHTML = '';

  for (const preset of state.presets || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-chip';
    btn.textContent = preset.name;
    btn.title = preset.baseUrl ? preset.baseUrl : '自己填写接口地址';
    btn.addEventListener('click', () => addProvider(preset));
    el.providerPresets.appendChild(btn);
  }
}

function addProvider(preset) {
  stashProviderForm();

  const provider = {
    id: `p${Date.now().toString(36)}${Math.floor(Math.random() * 900 + 100)}`,
    name: preset.name || '新服务商',
    baseUrl: preset.baseUrl || '',
    apiKey: '',
    models: [...(preset.models || [])]
  };

  state.settings.providers = [...providers(), provider];
  editingProviderId = provider.id;

  el.providerPresets.classList.add('hidden');
  el.btnAddProvider.setAttribute('aria-expanded', 'false');

  renderProviderTabs();
  fillProviderForm();

  showToast(`已添加「${provider.name}」，填入 API Key 后点保存`, 'ok');
  el.p.apiKey.focus();
}

async function removeProvider() {
  const provider = providerById(editingProviderId);
  if (!provider) return;

  if (providers().length <= 1) {
    showToast('至少要保留一个服务商', 'error');
    return;
  }
  const ok = await confirmDialog({
    title: '删除服务商',
    message: `删除「${provider.name}」？它的 API Key 和模型列表会一起删掉。`,
    confirmText: '删除',
    danger: true
  });
  if (!ok) return;

  state.settings.providers = providers().filter((p) => p.id !== provider.id);
  const next = state.settings.providers[0];
  editingProviderId = next.id;

  // 删掉的正好是当前用的服务商，就切到剩下的第一个
  if (state.settings.activeProviderId === provider.id) {
    state.settings.activeProviderId = next.id;
    state.settings.activeModel = next.models[0] || '';
  }

  // 关键：先把表单切到下一个服务商。
  // 否则紧接着的 saveSettings → stashProviderForm 会拿被删服务商的旧表单值
  // 覆盖掉幸存服务商的名称 / 地址 / API Key。
  renderProviderTabs();
  fillProviderForm();

  await saveSettings(true);
  showToast(`已删除「${provider.name}」`);
}

// ------------------------------ 保存 ------------------------------

function readSettingsForm() {
  stashProviderForm();

  const temp = Number(el.s.temp.value);
  const maxTokens = Number(el.s.maxTokens.value);
  const maxTurns = Number(el.s.maxTurns.value);
  const name = el.s.userName.value.trim();

  return {
    providers: providers(),
    activeProviderId: (state.settings || {}).activeProviderId,
    activeModel: (state.settings || {}).activeModel,
    temperature: isNaN(temp) ? 0.7 : Math.max(0, Math.min(2, temp)),
    maxTokens: isNaN(maxTokens) ? 2048 : Math.max(64, Math.min(32000, maxTokens)),
    userName: name || '你',
    maxTurns: isNaN(maxTurns) ? CONFIG.MAX_TURNS : Math.max(1, Math.min(200, Math.round(maxTurns))),
    systemPrompt: el.s.system.value,
    sendOnEnter: el.s.sendOnEnter.checked,
    showDate: el.s.showDate.checked,
    showUsage: el.s.showUsage.checked
  };
}

function openSettings() {
  if (!editingProviderId || !providerById(editingProviderId)) {
    editingProviderId = (state.settings || {}).activeProviderId || (providers()[0] || {}).id;
  }

  fillSettingsForm(state.settings || {});
  renderProviderTabs();
  fillProviderForm();
  renderPresets();
  el.providerPresets.classList.add('hidden');
  el.btnAddProvider.setAttribute('aria-expanded', 'false');

  el.modal.classList.remove('hidden');

  const current = providerById(editingProviderId);
  if (current && current.apiKey) {
    el.s.temp.focus();
  } else {
    el.p.baseUrl.focus();
  }
}

function closeSettings() {
  el.modal.classList.add('hidden');
}

async function saveSettings(silent) {
  const patch = readSettingsForm();

  try {
    state.settings = await api.saveSettings(patch);
  } catch (err) {
    showToast((err && err.message) || '保存失败', 'error');
    return state.settings;
  }

  // 主进程可能重新整理了服务商，这里同步回界面
  if (!providerById(editingProviderId)) {
    editingProviderId = state.settings.activeProviderId;
  } else {
    editingProviderId = providerById(editingProviderId).id;
  }
  renderProviderTabs();
  fillProviderForm();

  if (!silent) {
    showToast('设置已保存', 'ok');
    closeSettings();
  }

  renderHeader();
  renderModelSwitch();
  return state.settings;
}

async function testConnection() {
  stashProviderForm();
  const provider = providerById(editingProviderId);
  if (!provider) return;

  el.btnTest.disabled = true;
  el.btnTest.textContent = '测试中…';
  try {
    const result = await api.testConnection({ provider });
    showToast(result.message || '连接成功', 'ok');
  } catch (err) {
    showToast((err && err.message) || '连接失败', 'error');
  } finally {
    el.btnTest.disabled = false;
    el.btnTest.textContent = '测试当前服务商';
  }
}

async function fetchModels() {
  stashProviderForm();
  const provider = providerById(editingProviderId);
  if (!provider) return;

  el.btnFetchModels.disabled = true;
  el.btnFetchModels.textContent = '获取中…';
  try {
    const models = await api.listModels({ provider });

    // 模型可能上百个，填太多反而难挑，只取前 120 个
    const capped = models.slice(0, 120);
    el.p.models.value = capped.join('\n');
    stashProviderForm();
    renderModelSwitch();

    showToast(
      models.length > capped.length
        ? `拿到 ${models.length} 个模型，已填入前 ${capped.length} 个`
        : `拿到 ${models.length} 个模型，已填入列表`,
      'ok'
    );
  } catch (err) {
    showToast((err && err.message) || '获取模型列表失败', 'error');
  } finally {
    el.btnFetchModels.disabled = false;
    el.btnFetchModels.textContent = '拉取可用模型';
  }
}

// ---------------------------------------------------------------------------
//  事件绑定
// ---------------------------------------------------------------------------

function autoGrowInput() {
  el.input.style.height = 'auto';
  el.input.style.height = `${Math.min(el.input.scrollHeight, CONFIG.MAX_INPUT_HEIGHT)}px`;
}

function bindEvents() {
  el.btnNew.addEventListener('click', () => {
    if (state.streaming) {
      showToast('正在生成回答，先停止再新建会话');
      return;
    }
    createConvo(true);
    state.usage = null;
    renderAll({ forceScroll: true });
    el.input.focus();
  });

  el.btnSend.addEventListener('click', () => {
    const text = el.input.value;
    el.input.value = '';
    autoGrowInput();
    sendMessage(text);
  });

  el.btnStop.addEventListener('click', stopGenerating);
  el.btnClear.addEventListener('click', clearConvo);

  el.btnCopyAll.addEventListener('click', () => {
    const convo = activeConvo();
    if (!convo || !convo.messages.length) {
      showToast('当前会话是空的');
      return;
    }
    const text = convo.messages
      .map((m) => `${m.role === 'user' ? '我' : m.role === 'error' ? '错误' : 'Barbara'}：${m.content}`)
      .join('\n\n');
    api.copyText(text);
    showToast('已复制整段对话', 'ok');
  });

  el.btnSettings.addEventListener('click', openSettings);
  el.btnCloseSettings.addEventListener('click', closeSettings);
  el.btnSaveSettings.addEventListener('click', () => saveSettings(false));
  el.btnTest.addEventListener('click', testConnection);
  el.btnFetchModels.addEventListener('click', fetchModels);

  // 「＋ 添加服务商」展开预设列表
  el.btnAddProvider.addEventListener('click', () => {
    const hidden = el.providerPresets.classList.toggle('hidden');
    el.btnAddProvider.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  });

  el.btnDelProvider.addEventListener('click', removeProvider);

  // 右上角切换模型
  el.modelSwitch.addEventListener('change', () => applyModelChoice(el.modelSwitch.value));

  // 右上角切换角色
  el.characterSwitch.addEventListener('change', () =>
    applyCharacterChoice(el.characterSwitch.value)
  );

  // 角色库
  el.btnChars.addEventListener('click', openCharsModal);
  el.btnCloseChars.addEventListener('click', closeCharsModal);
  el.btnNewChar.addEventListener('click', newCharacter);
  el.btnSaveChar.addEventListener('click', saveCharacter);
  el.btnDelChar.addEventListener('click', deleteCharacter);
  el.btnImportCard.addEventListener('click', importCards);

  // 点头像换图 / 清除头像
  el.charAvatar.addEventListener('click', pickAvatar);
  el.btnClearAvatar.addEventListener('click', clearAvatar);

  // 左上角的昼夜切换
  el.btnTheme.addEventListener('click', toggleTheme);

  el.charsModal.addEventListener('click', (event) => {
    if (event.target === el.charsModal) closeCharsModal();
  });

  el.btnFolder.addEventListener('click', () => {
    api.openDataFolder('config').catch(() => {});
  });

  el.modal.addEventListener('click', (event) => {
    if (event.target === el.modal) closeSettings();
  });

  el.input.addEventListener('input', autoGrowInput);

  // 滚轮往上滑 = 用户在读历史，暂停自动跟随
  el.messages.addEventListener(
    'wheel',
    (event) => {
      if (event.deltaY < 0) {
        userReadingHistory = true;
      } else {
        const box = el.messages;
        const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < CONFIG.SCROLL_BOTTOM_THRESHOLD;
        if (atBottom) userReadingHistory = false;
      }
    },
    { passive: true }
  );

  el.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const wantSend = state.settings && state.settings.sendOnEnter !== false;
    const withModifier = event.ctrlKey || event.metaKey;

    if (event.shiftKey) return; // Shift+Enter 永远换行

    if (wantSend && !event.altKey) {
      event.preventDefault();
      const text = el.input.value;
      el.input.value = '';
      autoGrowInput();
      sendMessage(text);
      return;
    }

    if (!wantSend && withModifier) {
      event.preventDefault();
      const text = el.input.value;
      el.input.value = '';
      autoGrowInput();
      sendMessage(text);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // 确认弹窗开着的时候，Esc 只关确认框，不要把手底下的弹窗一起关掉
    if (!el.confirmModal.classList.contains('hidden')) return;
    if (!el.charsModal.classList.contains('hidden')) {
      closeCharsModal();
      return;
    }
    if (!el.modal.classList.contains('hidden')) {
      closeSettings();
    }
  });

  // 主进程推来的流式增量
  // chunkTarget 缓存「这次流式输出该往哪个节点里写」，按 requestId 判断是否失效
  let chunkTarget = { requestId: null, node: null };

  api.onChunk(({ requestId, text }) => {
    if (requestId !== state.requestId) return;
    const convo = activeConvo();
    if (!convo) return;
    const assistant = convo.messages[convo.messages.length - 1];
    if (!assistant || assistant.role !== 'assistant') return;

    assistant.content += text;

    // 一次流式过程中目标节点不会变，缓存起来 —— 否则每个 token 都要
    // 在消息列表里查一次 DOM，长对话下这些查询加起来也不少。
    if (chunkTarget.requestId !== requestId) {
      const index = convo.messages.length - 1;
      chunkTarget = {
        requestId,
        node: el.messages.querySelector(`.msg[data-index="${index}"] .msg-content`)
      };
    }

    streamPainter.push(chunkTarget.node, assistant.content);
  });

  api.onReasoning(({ requestId, text }) => {
    if (requestId !== state.requestId) return;
    const convo = activeConvo();
    if (!convo) return;
    const assistant = convo.messages[convo.messages.length - 1];
    if (!assistant || assistant.role !== 'assistant') return;
    assistant.reasoning = (assistant.reasoning || '') + text;
  });

  window.addEventListener('beforeunload', () => {
    api.saveConversationsNow({ conversations: state.conversations, activeId: state.activeId });
    api.saveCharactersNow({ characters: characters() });
  });
}

// ---------------------------------------------------------------------------
//  角色库
// ---------------------------------------------------------------------------

function persistCharacters(immediate) {
  const payload = { characters: characters() };

  if (immediate) {
    api.saveCharactersNow(payload);
    return Promise.resolve(payload);
  }

  return api.saveCharacters(payload).catch((err) => {
    console.error('保存角色失败', err);
    showToast('角色没能保存到磁盘，请检查磁盘空间', 'error');
  });
}

function openCharsModal() {
  if (!editingCharacterId || !characterById(editingCharacterId)) {
    editingCharacterId = characters().length ? characters()[0].id : null;
  }

  renderCharList();

  const current = characterById(editingCharacterId);
  if (current) {
    fillCharForm(current);
  } else {
    showCharForm(false);
  }

  el.charsModal.classList.remove('hidden');
}

function closeCharsModal() {
  el.charsModal.classList.add('hidden');
  el.input.focus();
}

/** 有角色时显示右边的编辑表单，没有就显示空状态 */
function showCharForm(show) {
  el.charForm.classList.toggle('hidden', !show);
  el.charEmpty.classList.toggle('hidden', !!show);
  el.btnDelChar.disabled = !show;
  el.btnSaveChar.disabled = !show;
  if (!show) el.charFootHint.textContent = '角色卡只保存在你自己电脑上';
}

function renderCharList() {
  el.charList.innerHTML = '';

  const list = characters();
  if (!list.length) {
    const tip = document.createElement('div');
    tip.className = 'char-list-empty';
    tip.textContent = '还没有角色';
    el.charList.appendChild(tip);
    return;
  }

  for (const c of list) {
    const item = document.createElement('div');
    item.className = `char-item${c.id === editingCharacterId ? ' active' : ''}`;
    item.setAttribute('role', 'listitem');
    item.title = c.name;

    const av = document.createElement('div');
    av.className = 'char-item-avatar';
    if (c.avatar) {
      const img = document.createElement('img');
      img.src = c.avatar;
      img.alt = '';
      av.appendChild(img);
    } else {
      av.textContent = c.name.slice(0, 1);
    }

    const info = document.createElement('div');
    info.className = 'char-item-info';

    const name = document.createElement('div');
    name.className = 'char-item-name';
    name.textContent = c.name;

    const sub = document.createElement('div');
    sub.className = 'char-item-sub';
    sub.textContent =
      c.source === 'png' ? '酒馆角色卡' : c.source === 'json' ? 'JSON 角色卡' : '手写';

    info.appendChild(name);
    info.appendChild(sub);

    item.appendChild(av);
    item.appendChild(info);

    item.addEventListener('click', () => selectCharacter(c.id));
    el.charList.appendChild(item);
  }
}

function selectCharacter(id) {
  if (id === editingCharacterId) return;
  stashCharForm();
  editingCharacterId = id;

  const character = characterById(id);
  renderCharList();

  if (character) {
    fillCharForm(character);
  } else {
    showCharForm(false);
  }
}

function renderCharAvatar() {
  el.charAvatar.innerHTML = '';

  if (charDraftAvatar) {
    const img = document.createElement('img');
    img.src = charDraftAvatar;
    img.alt = '';
    el.charAvatar.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.className = 'char-avatar-empty';
    span.textContent = '点击上传';
    el.charAvatar.appendChild(span);
  }

  // 没有头像就没有可清除的东西
  el.btnClearAvatar.classList.toggle('hidden', !charDraftAvatar);
}

/**
 * 头像统一缩成 256×256 再存。
 * 直接存原图的话，一张手机照片就能把 characters.json 撑到几十 MB，
 * 而且每次保存设置都要重写整个文件。
 * 只用 canvas 的标准 API，不引入任何依赖。
 */
function shrinkAvatar(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      try {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext('2d');
        // 从原图居中裁出一个正方形再缩放，避免变形
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

        // webp 体积小又支持透明；浏览器不支持时会自动退回 png
        const out = canvas.toDataURL('image/webp', 0.9);
        resolve(out.startsWith('data:image/') ? out : dataUrl);
      } catch (err) {
        // 压缩失败就用原图，不能因为优化把功能搞坏
        resolve(dataUrl);
      }
    };

    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function pickAvatar() {
  if (!characterById(editingCharacterId)) return;

  let result;
  try {
    result = await api.pickImage();
  } catch (err) {
    showToast((err && err.message) || '选择图片失败', 'error');
    return;
  }

  if (!result || result.canceled) return;

  if (!result.dataUrl) {
    showToast(result.error || '这张图片用不了', 'error');
    return;
  }

  charDraftAvatar = await shrinkAvatar(result.dataUrl);
  renderCharAvatar();
  showToast('头像已更换，记得点「保存角色」', 'ok');
}

function clearAvatar() {
  if (!charDraftAvatar) return;
  charDraftAvatar = '';
  renderCharAvatar();
  showToast('头像已清除，记得点「保存角色」');
}

function fillCharForm(character) {
  if (!character) {
    showCharForm(false);
    return;
  }

  el.c.name.value = character.name || '';
  el.c.tags.value = (character.tags || []).join(', ');
  el.c.desc.value = character.description || '';
  el.c.personality.value = character.personality || '';
  el.c.scenario.value = character.scenario || '';
  el.c.first.value = character.firstMes || '';
  el.c.example.value = character.mesExample || '';
  el.c.system.value = character.systemPrompt || '';
  el.c.post.value = character.postHistoryInstructions || '';
  el.c.notes.value = character.creatorNotes || '';

  charDraftAvatar = character.avatar || '';
  renderCharAvatar();

  el.charFootHint.textContent =
    character.source === 'png'
      ? '来自酒馆 PNG 角色卡'
      : character.source === 'json'
        ? '来自 JSON 角色卡'
        : '这是你自己写的角色';

  showCharForm(true);
}

/** 把表单里的内容写回内存里的角色对象（切走或保存前调用） */
function stashCharForm() {
  const character = characterById(editingCharacterId);
  if (!character || el.charForm.classList.contains('hidden')) return;

  character.name = el.c.name.value.trim() || '未命名角色';
  character.tags = el.c.tags.value
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
  character.description = el.c.desc.value;
  character.personality = el.c.personality.value;
  character.scenario = el.c.scenario.value;
  character.firstMes = el.c.first.value;
  character.mesExample = el.c.example.value;
  character.systemPrompt = el.c.system.value;
  character.postHistoryInstructions = el.c.post.value;
  character.creatorNotes = el.c.notes.value;
  character.avatar = charDraftAvatar;
  character.updatedAt = now();
}

function newCharacter() {
  stashCharForm();

  const character = {
    id: uid(),
    name: '新角色',
    avatar: '',
    description: '',
    personality: '',
    scenario: '',
    firstMes: '',
    mesExample: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    creatorNotes: '',
    tags: [],
    source: 'manual',
    createdAt: now(),
    updatedAt: now()
  };

  state.characters = [...characters(), character];
  editingCharacterId = character.id;

  renderCharList();
  fillCharForm(character);

  el.c.name.focus();
  el.c.name.select();
}

async function saveCharacter() {
  if (!editingCharacterId) return;

  const character = characterById(editingCharacterId);
  if (!character) return;

  // 必须先校验再落内存：stashCharForm 会把空名字写成「未命名角色」，
  // 放在它后面校验就晚了 —— 弹了提示，内存却已经被改名，列表也没重绘。
  if (!el.c.name.value.trim()) {
    showToast('给角色起个名字吧', 'error');
    el.c.name.focus();
    return;
  }

  stashCharForm();

  // 名字可能被规整过，重新填一遍保证界面和数据一致
  renderCharList();
  fillCharForm(character);
  renderAll();

  await persistCharacters();
  showToast(`角色「${character.name}」已保存`, 'ok');
}

async function deleteCharacter() {
  const character = characterById(editingCharacterId);
  if (!character) return;

  const ok = await confirmDialog({
    title: '删除角色',
    message: `删除角色「${character.name}」？用到它的会话会变回通用助手。`,
    confirmText: '删除',
    danger: true
  });
  if (!ok) return;

  state.characters = characters().filter((c) => c.id !== character.id);

  // 把绑定了这个角色的会话解绑，免得留下一个指向空气的 id
  for (const convo of state.conversations) {
    if (convo.characterId === character.id) convo.characterId = null;
  }

  editingCharacterId = characters().length ? characters()[0].id : null;

  renderCharList();
  const next = characterById(editingCharacterId);
  if (next) {
    fillCharForm(next);
  } else {
    showCharForm(false);
  }

  renderAll();
  persistConversations(0);
  await persistCharacters();

  showToast(`已删除「${character.name}」`);
}

async function importCards() {
  stashCharForm();

  let result;
  try {
    el.btnImportCard.disabled = true;
    el.btnImportCard.textContent = '导入中…';
    result = await api.importCard();
  } catch (err) {
    showToast((err && err.message) || '导入失败', 'error');
    return;
  } finally {
    el.btnImportCard.disabled = false;
    el.btnImportCard.textContent = '导入角色卡';
  }

  if (!result || result.canceled) return;

  const added = Array.isArray(result.characters) ? result.characters : [];
  const errors = Array.isArray(result.errors) ? result.errors : [];

  if (!added.length) {
    showToast(errors.length ? errors[0] : '没有导入任何角色', 'error');
    return;
  }

  // 重新发一批 id：主进程是同一毫秒里生成的，撞车的概率不能忽略
  const stamp = Date.now().toString(36);
  const fresh = added.map((c, i) => ({ ...c, id: `c${stamp}-${i}` }));

  state.characters = [...characters(), ...fresh];
  editingCharacterId = fresh[0].id;

  renderCharList();
  fillCharForm(characterById(editingCharacterId));
  await persistCharacters();

  showToast(`已导入 ${fresh.length} 个角色：${fresh.map((c) => c.name).join('、')}`, 'ok');

  if (errors.length) {
    console.warn('部分角色卡导入失败：', errors);
    setTimeout(
      () => showToast(`${errors.length} 个文件没能导入：${errors[0]}`, 'error'),
      CONFIG.TOAST_DURATION_MS + 300
    );
  }
}

// ---------------------------------------------------------------------------
//  启动
// ---------------------------------------------------------------------------

async function init() {
  bindEvents();

  const config = await api.getSettings();
  state.settings = config.settings;
  state.presets = Array.isArray(config.presets) ? config.presets : [];
  editingProviderId = state.settings.activeProviderId;

  // 主题以设置里的值为准（preload 已经按启动参数先打过一次，这里只是对齐）
  applyTheme(state.settings.theme);

  const storedChars = await api.getCharacters();
  state.characters = Array.isArray(storedChars && storedChars.characters) ? storedChars.characters : [];

  const stored = await api.getConversations();
  state.conversations = Array.isArray(stored.conversations) ? stored.conversations : [];
  state.activeId = stored.activeId || null;

  if (!state.conversations.length) {
    createConvo(true);
  } else if (!state.conversations.some((c) => c.id === state.activeId)) {
    state.activeId = state.conversations[0].id;
  }

  renderAll({ forceScroll: true });
  el.input.focus();

  const endpoint = currentEndpoint();
  if (!endpoint || !endpoint.provider.apiKey) {
    setTimeout(() => showToast('先点左下角「设置」填入 API Key 就能聊了'), 500);
  }
}

init().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<div style="padding:40px;font-family:monospace;color:#ff9a9a">
    启动失败：${esc((err && err.message) || err)}
  </div>`;
});
