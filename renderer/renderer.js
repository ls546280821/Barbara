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
  btnWorldbooks: $('btn-worldbooks'),
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
  // 状态面板
  panelBox: $('panel-box'),
  panelFields: $('panel-fields'),
  panelHint: $('panel-hint'),
  btnPanelToggle: $('btn-panel-toggle'),
  btnPanelClose: $('btn-panel-close'),
  btnPanelReset: $('btn-panel-reset'),
  // 视角设置
  btnPerspective: $('btn-perspective'),
  perspectiveModal: $('perspective-modal'),
  btnClosePerspective: $('btn-close-perspective'),
  btnClosePerspective2: $('btn-close-perspective-2'),
  pNarration: $('p-narration'),
  pGm: $('p-gm'),
  // 记忆
  btnMemory: $('btn-memory'),
  memoryCount: $('memory-count'),
  memoryModal: $('memory-modal'),
  btnCloseMemory: $('btn-close-memory'),
  btnCloseMemory2: $('btn-close-memory-2'),
  memorySummaryLine: $('memory-summary-line'),
  memoryPendingLine: $('memory-pending-line'),
  memoryList: $('memory-list'),
  btnSummarizeNow: $('btn-summarize-now'),
  btnMemoryClear: $('btn-memory-clear'),
  memoryFootHint: $('memory-foot-hint'),
  confirmModal: $('confirm-modal'),
  confirmTitle: $('confirm-title'),
  confirmMessage: $('confirm-message'),
  confirmOk: $('confirm-ok'),
  confirmCancel: $('confirm-cancel'),
  toast: $('toast'),
  // 角色库
  charsModal: $('chars-modal'),
  charsTitle: $('chars-title'),
  charsSub: $('chars-sub'),
  // 主区域的三个视图：聊天 / 角色列表页 / 世界书列表页
  viewChat: $('view-chat'),
  viewChars: $('view-chars'),
  viewWorldbooks: $('view-worldbooks'),
  charsPageSub: $('chars-page-sub'),
  charPageGrid: $('char-page-grid'),
  charPageEmpty: $('char-page-empty'),
  wbPageSub: $('wb-page-sub'),
  wbPageGrid: $('wb-page-grid'),
  wbPageEmpty: $('wb-page-empty'),
  // 进入世界前先创建玩家自己的角色
  playerModal: $('player-modal'),
  playerTitle: $('player-title'),
  playerSub: $('player-sub'),
  playerName: $('player-name'),
  playerProfile: $('player-profile'),
  btnClosePlayer: $('btn-close-player'),
  btnCancelPlayer: $('btn-cancel-player'),
  btnStartPlay: $('btn-start-play'),
  btnCloseChars: $('btn-close-chars'),
  btnImportCard: $('btn-import-card'),
  btnNewChar: $('btn-new-char'),
  btnDelChar: $('btn-del-char'),
  btnSaveChar: $('btn-save-char'),
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
  },
  // 世界书
  wb: {
    modal: $('worldbooks-modal'),
    btnClose: $('btn-close-worldbooks'),
    btnClose2: $('btn-close-worldbooks-2'),
    btnImport: $('btn-import-lorebook'),
    btnNew: $('btn-new-worldbook'),
    entriesEmpty: $('wb-entries-empty'),
    entriesWrap: $('wb-entries-wrap'),
    name: $('wb-name'),
    opening: $('wb-opening'),
    entryCount: $('wb-entry-count'),
    entryList: $('wb-entry-list'),
    btnPreview: $('btn-preview-wb'),
    btnNewEntry: $('btn-new-entry'),
    btnDelBook: $('btn-del-worldbook'),
    charList: $('wb-char-list'),
    btnAddChars: $('btn-add-wb-chars'),
    btnNewChar: $('btn-new-wb-char'),
    formEmpty: $('wb-form-empty'),
    form: $('wb-form'),
    footHint: $('wb-foot-hint'),
    e: {
      title: $('wb-e-title'),
      keys: $('wb-e-keys'),
      content: $('wb-e-content'),
      order: $('wb-e-order'),
      prob: $('wb-e-prob'),
      keys2: $('wb-e-keys2'),
      logic: $('wb-e-logic'),
      constant: $('wb-e-constant'),
      enabled: $('wb-e-enabled')
    },
    btnDelEntry: $('btn-del-entry'),
    btnSaveEntry: $('btn-save-entry')
  },
  // 从角色库多选加入世界书
  wbPicker: {
    modal: $('wb-char-picker'),
    list: $('wb-char-picker-list'),
    hint: $('wb-char-picker-hint'),
    btnClose: $('btn-close-wb-char-picker'),
    btnCancel: $('btn-cancel-wb-char-picker'),
    btnConfirm: $('btn-confirm-wb-char-picker')
  }
};

const state = {
  settings: null,
  presets: [],
  conversations: [],
  characters: [],
  worldbooks: [],
  activeId: null,
  streaming: false,
  requestId: null,
  usage: null
};

let saveTimer = null;
let toastTimer = null;
// 世界书有没有成功从磁盘读进来。
// 读失败时绝不能把内存里的空列表当成「用户把书删光了」写回去 ——
// 角色和世界书是同一次请求落盘的（saveCharacters 一次写两个文件），
// 所以只要存一次角色，就会顺手把 worldbooks.json 抹掉。
let worldbooksLoaded = false;
let editingProviderId = null; // 设置弹窗里当前正在编辑的服务商
let editingCharacterId = null; // 角色库里当前正在编辑的角色
// 角色编辑器的作用域：'library' = 角色库；'worldbook' = 当前世界书里的角色副本。
// 同一个编辑器两处复用 —— 从世界书里点「编辑」改的是书里那份副本，不动角色库。
let charEditorScope = 'library';
let charDraftAvatar = ''; // 正在编辑的角色头像（dataURL）
let editingWorldbookId = null; // 世界书弹窗里当前选中的世界书
let editingEntryId = null; // 当前正在编辑的条目

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

/**
 * 角色编辑器当前能看到的角色列表：角色库，或者某本世界书里的角色副本。
 * 编辑器里所有读写都走这两个函数，副本才能被同一套表单编辑。
 */
function editorCharacterList() {
  if (charEditorScope === 'worldbook') return worldbookCharacters(currentWorldbook());
  return characters();
}

function editorCharacterById(id) {
  if (!id) return null;
  return editorCharacterList().find((c) => c.id === id) || null;
}

function characterById(id) {
  if (!id) return null;
  return characters().find((c) => c.id === id) || null;
}

/** 当前会话绑定的角色（没绑就是 null，走通用助手） */
function characterForConvo(convo) {
  return convo ? characterById(convo.characterId) : null;
}

// --- 世界书 ---

function worldbooks() {
  return Array.isArray(state.worldbooks) ? state.worldbooks : [];
}

function worldbookById(id) {
  if (!id) return null;
  return worldbooks().find((w) => w.id === id) || null;
}

/** 会话绑定了哪些世界书（id 列表，容错老数据） */
function convoWorldbookIds(convo) {
  return convo && Array.isArray(convo.worldbookIds) ? convo.worldbookIds : [];
}

/**
 * 扫一遍近期消息，把命中的世界书条目拼成注入块。
 * 匹配逻辑在主进程（那里才有书和角色数据），渲染层只负责拿结果。
 */
const WORLDBOOK_SCAN_DEPTH = 6;

async function matchWorldbookSection(convo) {
  // 世界书词条只由「会话绑定了哪本书」决定。
  // 角色库里的角色单独聊天时不注入任何世界书，避免两个上下文串味。
  const allIds = [...new Set(convoWorldbookIds(convo))];
  if (!allIds.length) return '';

  const history = convo.messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim()
  );

  try {
    const result = await api.previewWorldbook({
      worldbookIds: allIds,
      scanDepth: WORLDBOOK_SCAN_DEPTH,
      messages: history.slice(-WORLDBOOK_SCAN_DEPTH).map((m) => ({ role: m.role, content: m.content }))
    });
    return (result && result.section) || '';
  } catch (err) {
    // 世界书匹配失败不该拦住正常聊天
    console.error('世界书匹配失败', err);
    return '';
  }
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
  const charName = (character && character.name) || '昔涟';
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

    // 心理描写：以标记开头的整段单独成块，渲染成弱化的旁白样式。
    // 标记本身不显示 —— 有样式就不需要文字标记占位了。
    // 只认「段落以标记开头」，所以正文里提到「【心理】」这三个字不会被误伤；
    // 流式生成时半截标记（「【心」）也匹配不上，不会闪。
    const inner = trimmed.match(/^【(心理|内心|心声)】\s*(.*)$/);
    if (inner) {
      out.push(`<p class="msg-inner">${renderInline(inner[2])}</p>`);
      continue;
    }

    const aside = trimmed.match(/^【(旁白|上帝视角|全知)】\s*(.*)$/);
    if (aside) {
      out.push(`<p class="msg-aside">${renderInline(aside[2])}</p>`);
      continue;
    }

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

  // 进了世界的会话：把世界名写在顶部，一眼知道自己在哪个世界
  const convoBooks = convoWorldbookIds(convo)
    .map((id) => worldbookById(id))
    .filter(Boolean);
  if (convoBooks.length) {
    el.convoMeta.textContent += ` · 世界：${convoBooks.map((b) => b.name).join('、')}`;
  }

  // 视角：只在偏离默认（标准 + 非 GM）时提示，平时不占位置
  const viewTags = [];
  if (isGmMode(convo)) viewTags.push('GM 模式');
  const narrationMode = convoNarrationMode(convo);
  if (narrationMode !== DEFAULT_NARRATION_MODE) viewTags.push(NARRATION_MODES[narrationMode].label);
  if (viewTags.length) el.convoMeta.textContent += ` · ${viewTags.join(' + ')}`;

  // 记忆：正在压缩时给个提示，压缩完显示覆盖了多少条
  const segCount = convoSummaries(convo).length;
  if (convo && convo.summaryBusy) el.convoMeta.textContent += ' · 正在整理记忆…';
  else if (segCount) el.convoMeta.textContent += ` · 记忆 ${segCount} 段`;

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

/** 顶部的角色下拉框已经去掉：角色改成在角色列表页用卡片上的「聊天」按钮选 */
async function applyCharacterChoice(characterId) {
  const convo = activeConvo();
  if (!convo) return;

  const next = characterId ? characterById(characterId) : null;
  if (!next) return;

  const previous = characterById(convo.characterId); // 用来判断标题是不是自动生成的

  // 自动插入的开场白会带 greeting 标记。
  // 只有「会话里一条消息都没有」时才插 —— 调用方（角色列表页的「聊天」）
  // 给的都是刚建好的空会话，所以这里不用担心覆盖掉真实对话。
  const untouched = !convo.messages.length;

  convo.characterId = next.id;
  convo.updatedAt = now();

  if (next.firstMes && untouched) {
    // 空对话绑上带开场白的角色时，自动把开场白放进去，省得每次手动开个头
    convo.messages = [
      {
        role: 'assistant',
        content: applyMacros(next.firstMes, next, userName()),
        at: now(),
        greeting: true
      }
    ];
  }

  // 标题是跟着角色自动起的话，换角色时一起换掉
  const autoTitle = !convo.title || convo.title === '新对话' || (previous && convo.title === previous.name);
  if (autoTitle) convo.title = next.name;

  renderAll({ forceScroll: true });
  persistConversations(0);
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

function messageNode(message, index, character, labels) {
  const isUser = message.role === 'user';
  const isError = message.role === 'error';
  // 角色只用来标识助手那一侧。用户消息和错误提示绝不能套角色的头像和名字，
  // 否则你自己的气泡上会顶着角色的脸。
  const speaker = isUser || isError ? null : character;

  // 说话人显示名：助手那侧，绑了角色卡就是角色名，进了世界就是世界名，
  // 通用助手用全局人设那个名字；你自己那侧用玩家角色名（世界会话里填的那个）。
  const userLabel = (labels && labels.user) || userName();
  const assistantLabel = speaker ? speaker.name : (labels && labels.assistant) || 'AI';

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
    avatar.textContent = isError ? '!' : isUser ? '我' : assistantLabel.slice(0, 1);
  }

  const body = document.createElement('div');
  body.className = 'msg-body';

  const role = document.createElement('div');
  role.className = 'msg-role';
  role.textContent = isError ? '出错了' : isUser ? userLabel : assistantLabel;

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

    const book = convo
      ? convoWorldbookIds(convo).map((id) => worldbookById(id)).find(Boolean)
      : null;
    const player = convoPlayer(convo);

    if (book) {
      // 进了世界的空会话：主角是你自己，AI 是这个世界
      const busy = convo && openingBusyId === convo.id;
      empty.innerHTML = busy
        ? `
      <h2>正在生成开局…</h2>
      <p class="hint">AI 正在按「${esc(book.name)}」的设定写开场场景，稍等一下。</p>
    `
        : `
      <h2>进入「${esc(book.name)}」</h2>
      <p>你是「${esc((player && player.name) || '旅行者')}」。在下面输入框里说点什么，然后按 Enter。</p>
      <p class="hint">这个世界由 GM 叙述：环境、NPC、剧情走向都归它写。</p>
      <p class="hint">想调整叙述方式，点右上角「视角」。</p>
    `;
    } else if (character) {
      empty.innerHTML = `
      <h2>开始和${esc(character.name)}聊天吧～</h2>
      <p>在下面输入框里说点什么，然后按 Enter。</p>
      <p class="hint">当前扮演的是「${esc(character.name)}」。想换角色，去左下角「角色库」点另一张卡上的「聊天」。</p>
    `;
    } else {
      empty.innerHTML = `
      <h2>开始和昔涟聊天吧～</h2>
      <p>在下面输入框里说点什么，然后按 Enter。</p>
      <p class="hint">第一次使用请先点左下角「设置」，填入接口地址和 API Key。</p>
      <p class="hint">想玩角色扮演？点左下角「角色库」导入角色卡，再点卡片上的「聊天」。</p>
    `;
    }

    el.messages.appendChild(empty);
    scrollToBottom(true);
    return;
  }

  convo.messages.forEach((message, index) => {
    el.messages.appendChild(
      messageNode(message, index, character, {
        user: convoUserName(convo),
        assistant: speakerName(convo)
      })
    );
  });

  scrollToBottom(!!opts.forceScroll);
}

function renderAll(options) {
  renderConvoList();
  renderHeader();
  renderModelSwitch();
  syncPanelVisibilityForConvo(activeConvo());
  renderPanel();
  renderMemoryIndicator();
  renderMessages(options);
  // 停在列表页时也要跟着刷新（改名、删除、导入都会走到这里）
  if (currentView === 'chars') renderCharacterPage();
  else if (currentView === 'worldbooks') renderWorldbookPage();
}

// ---------------------------------------------------------------------------
//  会话管理
// ---------------------------------------------------------------------------

function createConvo(activate) {
  // 不再继承上一个会话的角色：现在「＋ 新对话」会先带你去角色列表页挑一个，
  // 角色由 applyCharacterChoice 在选完之后绑上。
  // 这里建出来的是「还没选角色」的会话（删光会话后的兜底也走这里）。
  const convo = {
    id: uid(),
    title: '新对话',
    createdAt: now(),
    updatedAt: now(),
    messages: [],
    characterId: null,
    // 会话自己绑的世界书。这是世界书词条唯一的生效途径 ——
    // 角色库里的角色单独聊天时不会注入任何世界书。
    worldbookIds: [],
    // 状态面板：fields 是出现过的字段顺序，panel 是当前值。
    // 世界模型开局通常是空的，第一条带面板的回复会自动填上。
    panel: {},
    panelFields: [],
    // 视角设置：叙述模式（标准/内心描写/上帝视角）和 GM 模式
    narrationMode: DEFAULT_NARRATION_MODE,
    gmMode: false,
    // 分段记忆摘要：每段 { id, title, text, start, end, at }
    summaries: []
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
  showView('chat');
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
//  状态面板（世界模型的状态栏）
//
//  模型每轮输出一段固定格式的状态栏，比如：
//      【金币】：100
//      【时间】：早上
//      【健康状态】：健康
//  把它交给模型自己「抄上一轮」是靠不住的 —— 历史会被 maxTurns 截断，
//  一旦截出去模型就开始编数值。所以这里把它解析出来存到会话上，
//  每轮由程序权威注入，数值就不会漂了。
// ---------------------------------------------------------------------------

// 字段行：全角/半角冒号都认。字段名限制在 24 字内，避免把长句子误当成字段。
const PANEL_LINE_RE = /^【([^】\n]{1,24})】[：:]\s*(.*)$/;
// 单行最长长度：面板行都是「字段：短值」，超长的更像正文
const PANEL_LINE_MAX = 200;
// 还没有已知字段时，值超过这个长度就不认为是面板（首次扫描的兜底判断）
const PANEL_GUESS_VALUE_MAX = 60;

// 明确不当面板的字段名：这些是我们自己注入的提示词段落，或消息渲染用的标记
const PANEL_RESERVED = new Set([
  '心理', '内心', '心声', '旁白', '上帝视角', '全知',
  '扮演规则', '主持规则', '当前场景', '世界设定', '参考信息', '叙述要求'
]);

const DEFAULT_NARRATION_MODE = 'standard';
const MAX_PANEL_FIELDS = 120;

function panelFieldAllowed(name) {
  return !PANEL_RESERVED.has(name) && !name.includes('的设定') && !name.includes('的性格');
}

/**
 * 从一段文本里抽出面板字段（保持出现顺序）。
 *
 * knownFields：已经确立的字段名。给了它就以它为准 —— 正文里出现的
 * 「【某某】：……」不会被误收。只有第一次扫（还没有已知字段）时才靠
 * 形态猜测，这时候用「值很短」这个条件兜一下，避免把整段正文当面板。
 */
function extractPanelFromText(text, knownFields) {
  const known = knownFields && knownFields.length ? new Set(knownFields) : null;
  const found = new Map();

  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim().replace(/^[-*+]\s+/, '');
    if (line.length > PANEL_LINE_MAX) continue;

    const m = line.match(PANEL_LINE_RE);
    if (!m) continue;

    const name = m[1].trim();
    if (!name || !panelFieldAllowed(name)) continue;

    const value = m[2].trim();

    // 已知字段直接收；未知字段只在首次扫描时按形态判断
    if (!known && value.length > PANEL_GUESS_VALUE_MAX) continue;
    if (known && !known.has(name) && value.length > PANEL_GUESS_VALUE_MAX) continue;

    found.set(name, value.slice(0, 500));
    if (found.size >= MAX_PANEL_FIELDS) break;
  }

  return found;
}

/**
 * 从一段文本里剥掉面板行。
 * 面板由程序权威注入，历史里再留一份只会白烧 token，还可能和注入值冲突。
 * 传了 knownFields 就只剥那些字段（正文里提到同名字样不会被误删）。
 */
function stripPanelLines(text, knownFields) {
  const source = String(text || '');
  if (!source.trim()) return source;

  const known = knownFields && knownFields.length ? new Set(knownFields) : null;

  const out = source
    .split('\n')
    .filter((rawLine) => {
      const line = rawLine.trim().replace(/^[-*+]\s+/, '');
      if (line.length > PANEL_LINE_MAX) return true;

      const m = line.match(PANEL_LINE_RE);
      if (!m) return true;

      const name = m[1].trim();
      if (!name || !panelFieldAllowed(name)) return true;

      if (known) return !known.has(name);

      // 没有已知字段（首轮）时保守一点：只剥「短值」的面板行
      return m[2].trim().length > PANEL_GUESS_VALUE_MAX;
    });

  return collapseBlankLines(out.join('\n')).trim();
}

/** 连续空行压成一个，去掉首尾空白（剥面板后容易留下空格） */
function collapseBlankLines(text) {
  return String(text || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function convoPanelFields(convo) {
  return convo && Array.isArray(convo.panelFields) ? convo.panelFields : [];
}

function convoPanel(convo) {
  return convo && convo.panel && typeof convo.panel === 'object' ? convo.panel : {};
}

/**
 * 把会话历史里出现过的面板字段同步到 convo.panel。
 * 取「最近一条提到该字段的助手消息」的值，所以手动改过的旧轮次会被更新的值覆盖。
 * 返回是否发生了变化 —— 调用方据此决定要不要重绘面板。
 */
function syncConvoPanel(convo) {
  if (!convo || !Array.isArray(convo.messages)) return false;

  const beforeFields = convoPanelFields(convo).join('\u0001');
  const beforePanel = JSON.stringify(convoPanel(convo));

  // 先按出现顺序收集字段名：从最早的消息往后扫，后面的同名不重复加。
  // 每扫到新字段就并进 known —— 这样后期扫描不再依赖形态猜测，
  // 正文里的「【某某】：长句」不会被误收。
  const order = [];
  const latest = new Map();
  const known = new Set();

  for (const msg of convo.messages) {
    if (!msg || msg.role !== 'assistant') continue;
    const content = String(msg.content || '');
    if (!content.includes('【')) continue;

    const found = extractPanelFromText(content, [...known]);
    for (const [name, value] of found) {
      if (!order.includes(name)) {
        order.push(name);
        known.add(name);
      }
      latest.set(name, value);
    }
  }

  if (order.length > MAX_PANEL_FIELDS) order.length = MAX_PANEL_FIELDS;

  const panel = {};
  for (const name of order) {
    const value = latest.get(name);
    if (value !== undefined) panel[name] = value;
  }

  convo.panelFields = order;
  convo.panel = panel;

  return beforeFields !== order.join('\u0001') || beforePanel !== JSON.stringify(panel);
}

/** 手动改一个字段的值（面板 UI 里直接编辑） */
function setPanelField(convo, name, value) {
  if (!convo) return;
  const fields = [...convoPanelFields(convo)];
  if (!fields.includes(name)) fields.push(name);
  convo.panelFields = fields.slice(0, MAX_PANEL_FIELDS);
  convo.panel = { ...convoPanel(convo), [name]: String(value || '').slice(0, 500) };
  convo.updatedAt = now();
  persistConversations(0);
}

/** 面板拼成注入块；没有面板就返回空串 */
function formatPanelForPrompt(convo) {
  const fields = convoPanelFields(convo);
  if (!fields.length) return '';

  const panel = convoPanel(convo);
  const lines = [];
  for (const name of fields) {
    const value = panel[name];
    if (value === undefined || value === '') continue;
    lines.push(`【${name}】：${value}`);
  }
  if (!lines.length) return '';

  return (
    '[当前状态]\n' +
    '这是本局当前的权威状态，请以它为准，不要自行改动历史数值。\n' +
    '每次回复末尾按同样的格式输出更新后的完整状态栏；没有变化的字段照抄。\n\n' +
    lines.join('\n')
  );
}

// ---------------------------------------------------------------------------
//  叙述模式 / GM 模式
//  两者都是「改变模型看这个世界的视角」，所以放一起。
// ---------------------------------------------------------------------------

const NARRATION_MODES = {
  standard: {
    label: '标准',
    hint: '只写对话和动作',
    text: ''
  },
  inner: {
    label: '内心描写',
    hint: '每轮附上角色的真实心理',
    // 和 god 用同一套编号结构，只是去掉旁白那一条。
    // 之前这里是散文体（「在正文之外，单独起一段」），模型会当成建议、经常整段不写；
    // 而同一套编号措辞在「上帝视角」下一直很听话 —— 差别就在写法上。
    text:
      '【叙述要求】\n' +
      '每次回复包含两部分，各自单独成段：\n' +
      '1. 正文：角色的对话与动作。\n' +
      '2. 以「【心理】」开头：该角色此刻真实的内心活动，包括没说出口的部分。\n' +
      '「【心理】」是给读者看的，角色本人看不到，不要让角色对【心理】的内容作出反应。'
  },
  god: {
    label: '上帝视角',
    hint: '正文 + 心理 + 旁白',
    text:
      '【叙述要求】\n' +
      '每次回复包含三部分，各自单独成段：\n' +
      '1. 正文：角色的对话与动作。\n' +
      '2. 以「【心理】」开头：该角色此刻真实的内心活动，包括没说出口的部分。\n' +
      '3. 以「【旁白】」开头：以全知视角补充环境细节、在场其他人的反应或后续走向。\n' +
      '「【心理】」和「【旁白】」都是给读者看的，角色本人看不到，不要让角色对它们作出反应。'
  }
};

function convoNarrationMode(convo) {
  const mode = convo && convo.narrationMode;
  return Object.prototype.hasOwnProperty.call(NARRATION_MODES, mode) ? mode : DEFAULT_NARRATION_MODE;
}

function narrationInstruction(convo) {
  return NARRATION_MODES[convoNarrationMode(convo)].text;
}

function isGmMode(convo) {
  return !!(convo && convo.gmMode === true);
}

function roleplayRuleText(charName, me) {
  return (
    `【扮演规则】\n` +
    `你现在要扮演「${charName}」。请始终以第一人称，用 ${charName} 的语气、性格和说话习惯回应，` +
    `保持人设前后一致，不要跳出角色，也不要提到自己是 AI、语言模型或助手。` +
    `把对方称作「${me}」。用动作或神态描写时放在括号里。`
  );
}

/**
 * GM（主持人）规则。
 * 世界模型里模型扮演的是「整个世界和所有 NPC」，主角是玩家。
 * 所以必须明确允许第三人称、多 NPC 视角 —— 这正是角色扮演规则里禁止的事。
 */
function gmRuleText(charName, me) {
  return (
    `【主持规则】\n` +
    `你是这个世界的叙述者，负责描写环境、推进情节，并扮演其中的所有 NPC。\n` +
    `把「${me}」当作故事的主角，用第二人称称呼对方。\n` +
    `用第三人称描写环境和 NPC；不同 NPC 要有各自的语气和立场，不要让所有人用同一种腔调说话。\n` +
    `每次回复都要给出具体的情景与可选择的行动方向，让故事能继续推进。\n` +
    `不要提到自己是 AI、语言模型或助手。`
  );
}

// ---------------------------------------------------------------------------
//  状态面板 UI
// ---------------------------------------------------------------------------

let panelVisible = false; // 面板展开状态（当前会话）
let panelVisibilityConvoId = null; // 上面这个状态属于哪个会话
let panelFieldCountSeen = 0; // 上次同步时面板有几个字段

/**
 * 面板展开状态的同步规则：
 *   · 切到别的会话 —— 有面板就展开，没面板就收起
 *   · 同一会话里面板第一次出现（比如第一轮回复才带出状态栏）—— 自动展开一次
 *   · 其余情况一律不动，尊重用户手动收起
 *
 * 不能每次重绘都按「有没有面板」重算：流式输出期间 renderAll 会被频繁调用，
 * 那样会把用户手动收起的面板又弹开。
 */
function syncPanelVisibilityForConvo(convo) {
  const id = convo ? convo.id : null;
  const count = convoPanelFields(convo).length;

  if (id !== panelVisibilityConvoId) {
    panelVisibilityConvoId = id;
    panelFieldCountSeen = count;
    panelVisible = count > 0;
    return;
  }

  // 切会话已经处理过；这里只管「面板从无到有」这一个转换
  if (count > 0 && panelFieldCountSeen === 0) {
    panelVisible = true;
  }
  panelFieldCountSeen = count;
}

function currentPanelTextarea() {
  const active = document.activeElement;
  if (active && active.classList && active.classList.contains('panel-value')) {
    return { name: active.dataset.field, node: active };
  }
  return null;
}

/** 面板行的值改成单行输入框，边打字边存（防抖） */
function attachPanelEditor(convo, name, input) {
  input.addEventListener('input', () => {
    clearTimeout(input._panelTimer);
    input._panelTimer = setTimeout(() => {
      setPanelField(convo, name, input.value);
      renderHeader();
    }, 400);
  });
  // 失焦立即落盘，避免切换会话时丢掉最后几个字
  input.addEventListener('blur', () => {
    clearTimeout(input._panelTimer);
    setPanelField(convo, name, input.value);
  });
}

function renderPanel() {
  const convo = activeConvo();
  const fields = convo ? convoPanelFields(convo) : [];
  const hasPanel = fields.length > 0;

  el.btnPanelToggle.classList.toggle('hidden', !hasPanel);
  el.panelBox.classList.toggle('hidden', !hasPanel || !panelVisible);

  if (!hasPanel) {
    el.panelFields.innerHTML = '';
    el.btnPanelToggle.setAttribute('aria-expanded', 'false');
    return;
  }

  el.btnPanelToggle.setAttribute('aria-expanded', panelVisible ? 'true' : 'false');

  const panel = convoPanel(convo);
  const filled = fields.filter((n) => String(panel[n] || '').trim()).length;
  el.panelHint.textContent = `${filled}/${fields.length} 项已填`;

  // 面板里某个输入框正在编辑时不要重建 DOM，否则光标和输入内容会被打断
  const editing = currentPanelTextarea();
  if (editing && el.panelFields.querySelector(`[data-field="${CSS.escape(editing.name)}"]`)) return;

  el.panelFields.innerHTML = '';

  for (const name of fields) {
    const row = document.createElement('div');
    row.className = 'panel-row';

    const label = document.createElement('span');
    label.className = 'panel-name';
    label.textContent = name;
    label.title = name;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'panel-value';
    input.dataset.field = name;
    input.value = panel[name] || '';
    input.spellcheck = false;
    input.setAttribute('aria-label', name);
    attachPanelEditor(convo, name, input);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'panel-del';
    del.title = '从面板里移除这个字段';
    del.textContent = '✕';
    del.addEventListener('click', () => removePanelField(convo, name));

    row.append(label, input, del);
    el.panelFields.appendChild(row);
  }
}

function removePanelField(convo, name) {
  if (!convo) return;
  convo.panelFields = convoPanelFields(convo).filter((n) => n !== name);
  const panel = { ...convoPanel(convo) };
  delete panel[name];
  convo.panel = panel;
  convo.updatedAt = now();
  renderAll();
  persistConversations(0);
}

function togglePanel() {
  panelVisible = !panelVisible;
  renderPanel();
}

function resetPanel() {
  const convo = activeConvo();
  if (!convo) return;

  convo.panel = {};
  convo.panelFields = [];
  convo.updatedAt = now();
  // 让「面板从无到有」的判定立刻成立：下次再出现状态栏时会自动展开
  panelFieldCountSeen = 0;
  renderAll();
  persistConversations(0);
  showToast('面板已清空，下一条带状态栏的回复会重新建立');
}

// ---------------------------------------------------------------------------
//  视角设置 UI（叙述模式 + GM 模式）
// ---------------------------------------------------------------------------

function openPerspectiveModal() {
  const convo = activeConvo();
  if (!convo) {
    showToast('当前没有会话', 'error');
    return;
  }

  el.pNarration.value = convoNarrationMode(convo);
  el.pGm.checked = isGmMode(convo);

  el.perspectiveModal.classList.remove('hidden');
}

function closePerspectiveModal() {
  el.perspectiveModal.classList.add('hidden');
  el.input.focus();
}

/** 把面板里的设置写回会话；即时生效、即时保存 */
function applyPerspectiveFromForm() {
  const convo = activeConvo();
  if (!convo) return;

  const mode = el.pNarration.value;
  convo.narrationMode = Object.prototype.hasOwnProperty.call(NARRATION_MODES, mode) ? mode : DEFAULT_NARRATION_MODE;
  convo.gmMode = el.pGm.checked;
  convo.updatedAt = now();

  renderHeader();
  persistConversations(0);
}

// ---------------------------------------------------------------------------
//  分段记忆摘要
//
//  问题：只把最近 maxTurns 轮发给模型，超出去的历史模型完全看不见。
//  调大轮数就烧 token，调小就忘事 —— 这是个死结。
//
//  做法：把较早的对话按段压缩成摘要，摘要常驻上下文、原文丢弃。
//  这样几十轮前的剧情还在，但 token 占用小得多。
//
//  摘要由程序管理（和状态面板同一个思路：记忆不能交给模型自己维持），
//  生成时机是每轮回复之后、后台静默进行，不阻塞聊天。
// ---------------------------------------------------------------------------

// 未覆盖的消息达到这个数就压一段。一轮 = 一问一答 = 2 条，
// 也就是大约每 12 轮压一段。
const SUMMARY_TRIGGER_MESSAGES = 24;
// 少于这个数不值得单独压一段
const SUMMARY_MIN_MESSAGES = 12;
// 单段摘要的长度上限
const MAX_SUMMARY_CHARS = 4000;
// 一次送给模型压缩的原文长度上限，超了就从最早的开始截
const MAX_SUMMARY_INPUT_CHARS = 24000;
// 连续失败这么多次就暂停自动摘要，避免每轮都白烧一次请求
const MAX_SUMMARY_FAILURES = 3;
// 失败后至少隔这么久再试（毫秒）
const SUMMARY_RETRY_COOLDOWN_MS = 60000;

// 正在压缩的会话 id，防止同一会话并发触发
const summarizingConvos = new Set();
// 会话 id -> 连续失败次数
const summaryFailures = new Map();

/** 真正会进入上下文的消息（和 buildApiMessages 的口径保持一致） */
function convoContextMessages(convo) {
  if (!convo || !Array.isArray(convo.messages)) return [];
  return convo.messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim()
  );
}

function convoSummaries(convo) {
  return convo && Array.isArray(convo.summaries) ? convo.summaries : [];
}

/** 摘要覆盖到了第几条（未压缩的历史从这里开始） */
function summarizedCount(convo) {
  const list = convoSummaries(convo);
  if (!list.length) return 0;
  let max = 0;
  for (const seg of list) {
    const end = Number(seg.end) || 0;
    if (end > max) max = end;
  }
  return max;
}

function nextSegmentTitle(convo) {
  return `第 ${convoSummaries(convo).length + 1} 段`;
}

/** 摘要拼成注入块；没有摘要就返回空串 */
function formatSummaryForPrompt(convo) {
  const list = convoSummaries(convo);
  if (!list.length) return '';

  const parts = [];
  for (const seg of list) {
    const text = String(seg.text || '').trim();
    if (!text) continue;
    parts.push(`【${seg.title || '对话摘要'}】\n${text}`);
  }
  if (!parts.length) return '';

  return (
    '[前面的剧情]\n' +
    '以下是本次对话较早部分的摘要，作为已经发生过的剧情参考，' +
    '保持人物、地点和事件前后一致；不要向对方复述这份摘要。\n\n' +
    parts.join('\n\n')
  );
}

/**
 * 摘要生成用的提示词。
 * 明确要求「只记事实、不要文学化」，因为摘要会一直占用上下文，
 * 写成抒情散文既费 token 又容易让模型把摘要当成剧情来续写。
 */
function buildSummaryPrompt(previousSummary, transcriptText) {
  const parts = [
    '你在帮一个长篇角色扮演对话做剧情摘要。',
    '下面是一段已经发生过的对话原文，请把它压缩成简洁的剧情摘要。',
    '',
    '要求：',
    '1. 只记录事实：发生了什么、到了哪里、见了谁、关系或状态有什么变化、答应过什么、埋了什么伏笔。',
    '2. 不要文学化描写，不要复述对话原文，不要加入评论。',
    '3. 按时间顺序写，用短句或分条，控制在 300 字以内。',
    '4. 直接输出摘要正文，不要任何前言、标题或「摘要：」之类的字样。'
  ];

  if (previousSummary) {
    parts.push(
      '',
      '此前已有的更早剧情摘要（只作为背景，不要重复它的内容）：',
      previousSummary
    );
  }

  parts.push('', '需要压缩的对话原文：', transcriptText);
  return parts.join('\n');
}

/** 把消息列表拼成压缩用的原文；超长就从最早的开始截掉 */
function buildTranscript(messages, charName) {
  const lines = [];
  let total = 0;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    const who = m.role === 'user' ? '对方' : charName || '角色';
    // 摘要不需要状态栏，剥掉省 token
    const text = String(m.content || '').trim();
    const line = `${who}：${m.role === 'assistant' ? stripPanelLines(text) : text}`;

    if (total + line.length > MAX_SUMMARY_INPUT_CHARS && lines.length) break;
    total += line.length;
    lines.unshift(line);
  }

  return lines.join('\n\n');
}

/**
 * 需要压缩的消息区间。
 * 用「当前消息总数 - 已覆盖数」来算，而不是用固定下标 ——
 * 用户删掉中间某条消息后，消息数组会整体前移，固定下标会错位。
 */
function pendingSummaryRange(convo) {
  const messages = convoContextMessages(convo);
  const covered = summarizedCount(convo);
  const start = Math.min(covered, messages.length);
  const pending = messages.slice(start);
  return { messages, start, pending, covered };
}

/** 调一次模型生成摘要；失败或返回异常时返回 null */
async function generateSummary(convo, transcript, previousSummary) {
  const endpoint = ensureConvoEndpoint(convo);
  if (!endpoint) return null;

  const summaryMessages = [
    { role: 'system', content: buildSummaryPrompt(previousSummary, transcript) }
  ];

  const response = await api.sendChat({
    requestId: `summary-${uid()}`,
    providerId: endpoint.provider.id,
    model: endpoint.model,
    messages: summaryMessages
  });

  if (!response || response.ok !== true) {
    throw new Error((response && response.error) || '摘要请求失败');
  }

  let text = String(response.content || '').trim();
  if (!text) throw new Error('摘要返回为空');

  // 有些模型会固执地加个前缀，剥掉
  text = text.replace(/^(剧情)?摘要[：:]\s*/, '').trim();

  if (text.length > MAX_SUMMARY_CHARS) {
    text = `${text.slice(0, MAX_SUMMARY_CHARS)}…`;
  }

  return text;
}

/**
 * 达到阈值就在后台压一段。
 * 返回是否真的压了新的一段。
 */
async function maybeSummarize(convo) {
  if (!convo || summarizingConvos.has(convo.id)) return false;

  const failures = summaryFailures.get(convo.id) || 0;
  if (failures >= MAX_SUMMARY_FAILURES) {
    const lastAttempt = Number(convo.summaryLastAttempt) || 0;
    if (Date.now() - lastAttempt < SUMMARY_RETRY_COOLDOWN_MS) return false;
  }

  const { start, pending } = pendingSummaryRange(convo);
  if (pending.length < SUMMARY_TRIGGER_MESSAGES) return false;

  // 压缩到「留下最近几轮原文」为止，避免把刚聊完的内容也压掉
  const keepNewest = SUMMARY_MIN_MESSAGES;
  const slice = pending.slice(0, Math.max(SUMMARY_MIN_MESSAGES, pending.length - keepNewest));
  if (slice.length < SUMMARY_MIN_MESSAGES) return false;

  summarizingConvos.add(convo.id);
  convo.summaryBusy = true;
  convo.summaryLastAttempt = Date.now();
  renderHeader();

  try {
    const transcript = buildTranscript(slice, charNameForSummary(convo));
    const previous = convoSummaries(convo).map((s) => String(s.text || '')).join('\n\n');

    const text = await generateSummary(convo, transcript, previous);
    if (!text) return false;

    // 关键：这里必须以 convo.summaries 的当前值重新取，不能用闭包里的旧引用
    const list = convoSummaries(convo);
    list.push({
      id: `s${uid()}`,
      title: nextSegmentTitle(convo),
      text,
      start,
      end: start + slice.length,
      at: now()
    });
    convo.summaries = list;
    convo.summaryBusy = false;
    convo.updatedAt = now();

    summaryFailures.delete(convo.id);
    persistConversations(0);
    renderHeader();
    showToast(`已把较早的 ${slice.length} 条对话压缩成「${list[list.length - 1].title}」`, 'ok');
    return true;
  } catch (err) {
    console.error('生成摘要失败', err);
    convo.summaryBusy = false;
    const next = (summaryFailures.get(convo.id) || 0) + 1;
    summaryFailures.set(convo.id, next);
    if (next >= MAX_SUMMARY_FAILURES) {
      showToast('摘要连续失败，已暂停自动摘要（可在记忆面板手动重试）', 'error');
    }
    renderHeader();
    return false;
  } finally {
    summarizingConvos.delete(convo.id);
  }
}

function charNameForSummary(convo) {
  const character = characterForConvo(convo);
  return character ? character.name : '你';
}

/** 重新生成某一段（用它的原始消息区间） */
async function regenerateSummary(convo, segmentId) {
  const list = convoSummaries(convo);
  const index = list.findIndex((s) => s.id === segmentId);
  if (index < 0) return false;

  const seg = list[index];
  const messages = convoContextMessages(convo);
  const slice = messages.slice(seg.start, seg.end);
  if (!slice.length) {
    showToast('这段对应的原文已经不在了，无法重新生成', 'error');
    return false;
  }

  if (summarizingConvos.has(convo.id)) {
    showToast('正在压缩中，稍等一下', 'error');
    return false;
  }

  summarizingConvos.add(convo.id);
  try {
    const transcript = buildTranscript(slice, charNameForSummary(convo));
    // 用「这段之前」的摘要当背景
    const previous = list
      .slice(0, index)
      .map((s) => String(s.text || ''))
      .join('\n\n');

    const text = await generateSummary(convo, transcript, previous);
    if (!text) return false;

    const fresh = convoSummaries(convo);
    const target = fresh.find((s) => s.id === segmentId);
    if (!target) return false;
    target.text = text;
    target.at = now();
    convo.updatedAt = now();

    summaryFailures.delete(convo.id);
    persistConversations(0);
    return true;
  } catch (err) {
    console.error('重新生成摘要失败', err);
    showToast((err && err.message) || '重新生成失败', 'error');
    return false;
  } finally {
    summarizingConvos.delete(convo.id);
  }
}

/** 手动压一段（记忆面板里的按钮） */
async function summarizeNow() {
  const convo = activeConvo();
  if (!convo) return;

  const { pending } = pendingSummaryRange(convo);
  if (pending.length < SUMMARY_MIN_MESSAGES) {
    showToast(`还没压缩的对话只有 ${pending.length} 条，太少，攒到 ${SUMMARY_MIN_MESSAGES} 条再压`, 'error');
    return;
  }

  // 手动触发时绕过阈值判断，直接压
  summarizingConvos.delete(convo.id);
  const { start, pending: nowPending } = pendingSummaryRange(convo);
  const keepNewest = SUMMARY_MIN_MESSAGES;
  const slice = nowPending.slice(0, Math.max(SUMMARY_MIN_MESSAGES, nowPending.length - keepNewest));
  if (slice.length < SUMMARY_MIN_MESSAGES) {
    showToast('可压缩的内容太少', 'error');
    return;
  }

  summarizingConvos.add(convo.id);
  convo.summaryBusy = true;
  renderHeader();
  renderMemoryModal();

  try {
    const transcript = buildTranscript(slice, charNameForSummary(convo));
    const previous = convoSummaries(convo).map((s) => String(s.text || '')).join('\n\n');
    const text = await generateSummary(convo, transcript, previous);
    if (!text) {
      showToast('摘要返回为空', 'error');
      return;
    }

    const list = convoSummaries(convo);
    list.push({
      id: `s${uid()}`,
      title: nextSegmentTitle(convo),
      text,
      start,
      end: start + slice.length,
      at: now()
    });
    convo.summaries = list;
    convo.updatedAt = now();
    summaryFailures.delete(convo.id);
    persistConversations(0);
    showToast(`已压缩 ${slice.length} 条对话`, 'ok');
  } catch (err) {
    console.error('压缩失败', err);
    showToast((err && err.message) || '压缩失败', 'error');
  } finally {
    convo.summaryBusy = false;
    summarizingConvos.delete(convo.id);
    renderHeader();
    renderMemoryModal();
  }
}

// ---------------------------------------------------------------------------
//  记忆管理 UI
// ---------------------------------------------------------------------------

let memoryEditingId = null; // 正在编辑的摘要段

function renderMemoryIndicator() {
  const convo = activeConvo();
  const count = convo ? convoSummaries(convo).length : 0;

  el.memoryCount.classList.toggle('hidden', count === 0);
  el.memoryCount.textContent = String(count);
  el.btnMemory.title = count
    ? `已压缩 ${count} 段早期剧情`
    : '较早的对话会自动压成摘要';
}

function openMemoryModal() {
  const convo = activeConvo();
  if (!convo) {
    showToast('当前没有会话', 'error');
    return;
  }

  memoryEditingId = null;
  renderMemoryModal();
  el.memoryModal.classList.remove('hidden');
}

function closeMemoryModal() {
  el.memoryModal.classList.add('hidden');
  el.input.focus();
}

function renderMemoryModal() {
  const convo = activeConvo();
  if (!convo) return;

  const { messages, pending, covered } = pendingSummaryRange(convo);
  const list = convoSummaries(convo);

  el.memorySummaryLine.textContent = list.length
    ? `已压缩 ${list.length} 段，覆盖前 ${covered} / ${messages.length} 条消息`
    : '还没有摘要';
  el.memoryPendingLine.textContent = convo.summaryBusy
    ? '正在压缩…'
    : `未压缩 ${pending.length} 条（达到 ${SUMMARY_TRIGGER_MESSAGES} 条会自动压缩）`;

  el.btnSummarizeNow.disabled = pending.length < SUMMARY_MIN_MESSAGES || !!convo.summaryBusy;
  el.btnMemoryClear.disabled = list.length === 0;
  el.memoryFootHint.textContent = `「${convo.title || '新对话'}」的摘要只保存在你自己电脑上`;

  el.memoryList.innerHTML = '';

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'memory-empty';
    empty.textContent =
      `还没有摘要。聊到 ${SUMMARY_TRIGGER_MESSAGES} 条未压缩消息时会自动压一段，` +
      '也可以点上面的按钮手动压。';
    el.memoryList.appendChild(empty);
    return;
  }

  list.forEach((seg, index) => {
    el.memoryList.appendChild(buildMemoryCard(convo, seg, index, list.length));
  });
}

function buildMemoryCard(convo, seg, index, total) {
  const card = document.createElement('div');
  card.className = 'memory-card';

  const head = document.createElement('div');
  head.className = 'memory-card-head';

  const title = document.createElement('span');
  title.className = 'memory-card-title';
  title.textContent = seg.title || `第 ${index + 1} 段`;

  const meta = document.createElement('span');
  meta.className = 'memory-card-meta';
  const when = seg.at ? new Date(seg.at).toLocaleString('zh-CN', { hour12: false }) : '';
  meta.textContent = `第 ${seg.start + 1}–${seg.end} 条 · ${String(seg.text || '').length} 字${when ? ' · ' + when : ''}`;

  head.append(title, meta);

  const actions = document.createElement('div');
  actions.className = 'memory-card-actions';

  const isEditing = memoryEditingId === seg.id;

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = `btn btn-ghost btn-sm${isEditing ? ' active' : ''}`;
  editBtn.textContent = isEditing ? '取消编辑' : '编辑';
  editBtn.addEventListener('click', () => {
    memoryEditingId = isEditing ? null : seg.id;
    renderMemoryModal();
  });

  const regenBtn = document.createElement('button');
  regenBtn.type = 'button';
  regenBtn.className = 'btn btn-ghost btn-sm';
  regenBtn.textContent = '重新生成';
  regenBtn.title = '用这段对应的原文重新压一次';
  regenBtn.disabled = !!convo.summaryBusy;
  regenBtn.addEventListener('click', async () => {
    regenBtn.disabled = true;
    regenBtn.textContent = '生成中…';
    const ok = await regenerateSummary(convo, seg.id);
    renderMemoryModal();
    if (ok) showToast('已重新生成', 'ok');
  });

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-danger btn-sm';
  delBtn.textContent = '删除';
  delBtn.title = '删掉这段摘要，对应的原文会重新进入上下文';
  delBtn.addEventListener('click', () => deleteSummarySegment(convo, seg.id));

  actions.append(editBtn, regenBtn, delBtn);

  const body = document.createElement('div');
  body.className = 'memory-card-body';

  if (isEditing) {
    const box = document.createElement('textarea');
    box.className = 'memory-edit-box';
    box.value = String(seg.text || '');
    box.spellcheck = false;

    const editActions = document.createElement('div');
    editActions.className = 'memory-card-actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-primary btn-sm';
    saveBtn.textContent = '保存';
    saveBtn.addEventListener('click', async () => {
      const target = convoSummaries(convo).find((s) => s.id === seg.id);
      if (!target) return;
      let text = box.value.trim();
      if (text.length > MAX_SUMMARY_CHARS) text = `${text.slice(0, MAX_SUMMARY_CHARS)}…`;
      if (!text) {
        showToast('摘要不能为空，要删就点「删除」', 'error');
        return;
      }
      target.text = text;
      target.at = now();
      convo.updatedAt = now();
      memoryEditingId = null;
      persistConversations(0);
      renderMemoryModal();
      showToast('摘要已保存', 'ok');
    });

    editActions.appendChild(saveBtn);
    body.append(box, editActions);
  } else {
    const text = document.createElement('div');
    text.className = 'memory-card-text';
    text.textContent = seg.text || '';
    body.appendChild(text);
  }

  card.append(head, actions, body);
  return card;
}

async function deleteSummarySegment(convo, segmentId) {
  const seg = convoSummaries(convo).find((s) => s.id === segmentId);
  if (!seg) return;

  const ok = await confirmDialog({
    title: '删除摘要',
    message: `删除「${seg.title}」？对应的原文会重新进入上下文，占用更多 token。`,
    confirmText: '删除',
    danger: true
  });
  if (!ok) return;

  convo.summaries = convoSummaries(convo).filter((s) => s.id !== segmentId);
  // 删掉中间某段后，后面各段的覆盖范围就断了 —— 把范围重新编号，
  // 否则 buildApiMessages 会从错误的覆盖点往后取历史。
  renumberSummaries(convo);
  convo.updatedAt = now();
  persistConversations(0);
  renderMemoryModal();
  renderMemoryIndicator();
  showToast('摘要已删除，原文重新进入上下文');
}

/**
 * 删除某段后，把各段的 start/end 重新串起来。
 * 摘要内容不重写 —— 只是让覆盖范围保持连续。
 */
function renumberSummaries(convo) {
  const list = convoSummaries(convo);
  const messages = convoContextMessages(convo);
  let cursor = 0;

  for (const seg of list) {
    const span = Math.max(0, (Number(seg.end) || 0) - (Number(seg.start) || 0));
    seg.start = cursor;
    seg.end = Math.min(messages.length, cursor + span);
    cursor = seg.end;
  }

  // 只保留真正覆盖了内容的段
  convo.summaries = list.filter((s) => s.end > s.start);
}

async function clearAllSummaries() {
  const convo = activeConvo();
  if (!convo) return;

  const list = convoSummaries(convo);
  if (!list.length) return;

  const ok = await confirmDialog({
    title: '清空全部摘要',
    message: `删除全部 ${list.length} 段摘要？对应的原文会重新进入上下文，token 占用会明显上升。`,
    confirmText: '清空',
    danger: true
  });
  if (!ok) return;

  convo.summaries = [];
  memoryEditingId = null;
  convo.updatedAt = now();
  summaryFailures.delete(convo.id);
  persistConversations(0);
  renderMemoryModal();
  renderMemoryIndicator();
  showToast('摘要已清空');
}

// ---------------------------------------------------------------------------
//  发送与流式接收
// ---------------------------------------------------------------------------

/**
 * 组装真正发给模型的消息数组。
 *
 * 顺序（和酒馆的思路一致）：
 *   1. system：人设 + 扮演规则/GM 规则 + 角色设定/性格/场景 + 叙述模式 + 日期
 *   2. 世界书命中的设定
 *   3. 角色卡里的示例对话（当成已经发生过的对话塞进去）
 *   4. 最近 N 轮真实对话（面板行已剥掉）
 *   5. 面板状态（当前权威值）
 *   6. 角色卡里的「对话后指令」，放最后最管用
 *
 * 绑定了角色卡时不再使用「设置」里的全局人设 —— 否则你扮演雷电将军，
 * 系统提示词却在说「你是昔涟」，模型会精神分裂。
 */
function buildApiMessages(convo, worldbookSection) {
  const settings = state.settings || {};
  const character = characterForConvo(convo);
  // 进了世界的会话用玩家自己创建的角色名，其它会话用设置里的名字
  const me = convoUserName(convo);
  const charName = (character && character.name) || '昔涟';
  const gmMode = isGmMode(convo);

  // 注意：调用时对话末尾通常刚 push 了一条空的 assistant 占位消息（用来填空），
  // 必须把它过滤掉，否则会发给接口一条 content 为空的消息，严格的接口会直接报 400。
  const history = convo.messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim()
  );

  const turns = Math.max(1, Number(settings.maxTurns) || CONFIG.MAX_TURNS);
  // 从摘要覆盖点开始取「最近 N 轮」。
  // 如果还按 slice(-turns*2) 取，会出现「摘要写到第 30 条，原文只发第 70 条起」的断层 ——
  // 中间那段模型两边都看不到。从覆盖点往后、按轮数取，上下文才是连续的。
  const covered = summarizedCount(convo);
  const uncovered = covered > 0 ? history.slice(covered) : history;
  const recent = uncovered.slice(-turns * 2);

  const messages = [];

  // ---- 1. 系统提示词 ----
  const parts = [];

  // 全局人设只在「通用助手」时才用：
  //   · 绑了角色卡 → 用卡自己的 systemPrompt
  //   · GM 模式（从世界书列表页进来的会话）→ 叙述者不该顶着某个人的人设。
  //     以前这里无条件用全局人设，于是提示词里同时有「你是昔涟」和
  //     「你是这个世界的叙述者」，模型会去扮演昔涟 —— 世界就这么被一个人盖住了。
  const globalPersona = !character && !gmMode ? settings.systemPrompt || '' : '';
  const base = character ? character.systemPrompt || '' : globalPersona;
  if (String(base).trim()) parts.push(applyMacros(base, character, me).trim());

  if (character) {
    if (character.description) parts.push(`【${charName}的设定】\n${applyMacros(character.description, character, me)}`);
    if (character.personality) parts.push(`【${charName}的性格】\n${applyMacros(character.personality, character, me)}`);
    if (character.scenario) parts.push(`【当前场景】\n${applyMacros(character.scenario, character, me)}`);
  }

  // GM 模式换掉那段「不要跳出角色」：世界模型必须能写第三人称、切多个 NPC 视角，
  // 被「始终以第一人称」捆着会一轮缩回单角色腔调。
  const ruleText = gmMode ? gmRuleText(charName, me) : roleplayRuleText(charName, me);
  if (character || gmMode) parts.push(ruleText);

  // 玩家角色：从世界书列表页「游玩」进来的会话才有这段。
  // 只有名字的话上面那句规则已经交代了，所以这里只在写了设定时才注入。
  const player = convoPlayer(convo);
  if (player && player.profile) {
    parts.push(`【玩家角色：${player.name || me}】\n${player.profile}`);
  }

  // 这个世界有哪些 NPC：不列出来 GM 就只能现编
  const cast = worldbookCast(convo);
  if (cast) parts.push(cast);

  // 叙述模式：决定要不要写心理 / 旁白，以及用什么标记（标记对上渲染样式）
  const narration = narrationInstruction(convo);
  if (narration) parts.push(narration);

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

  // ---- 2. 世界书：命中的设定紧跟人设之后 ----
  // 放在角色定义后面（酒馆叫 After Char Defs）——比角色本身靠前会稀释人设，
  // 比对话历史靠后又容易被忽略，这里是比较稳的位置。
  if (String(worldbookSection || '').trim()) {
    messages.push({ role: 'system', content: String(worldbookSection).trim() });
  }

  // ---- 2.5 前面的剧情：较早对话的摘要 ----
  // 放在对话历史之前、示例对话之后的位置，让模型先读背景再读最近对话。
  const summaryText = formatSummaryForPrompt(convo);
  if (summaryText) messages.push({ role: 'system', content: summaryText });

  // ---- 3. 示例对话 ----
  // 注意：parseExampleDialogue 只剥掉了行首的「{{user}}:」前缀，
  // 正文里的宏还得自己替换一遍，否则模型会读到字面的 {{user}}。
  // GM 模式不注入示例对话：那是「某个角色怎么说话」的样本，
  // 而这里要的是主持人腔调，塞进去反而把模型的视角拉回单角色。
  if (character && !gmMode) {
    for (const example of parseExampleDialogue(character.mesExample, charName, me)) {
      messages.push({
        role: example.role,
        content: applyMacros(example.content, character, me)
      });
    }
  }

  // ---- 4. 真实对话历史（剥掉面板行，面板由程序权威注入）----
  // 用本会话的已知字段名来剥：正文里提到同名字样不会被误删。
  const panelFields = convoPanelFields(convo);
  for (const m of recent) {
    const content = applyMacros(m.content, character, me);
    messages.push({
      role: m.role,
      content: m.role === 'assistant' ? stripPanelLines(content, panelFields) : content
    });
  }

  // ---- 5. 面板状态：紧贴对话历史之后，权重很高 ----
  // 放在这里而不是塞进历史，是因为历史会被 maxTurns 截断 ——
  // 面板一旦被截出去，模型就开始凭感觉编数值。
  const panelText = formatPanelForPrompt(convo);
  if (panelText) messages.push({ role: 'system', content: panelText });

  // ---- 6. 对话后指令 ----
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

  // 世界书在渲染层匹配（和 buildApiMessages 同一个进程，省一次往返）。
  // 之前这里要求「消息数 ≥ 3」才匹配，但那会让世界模型的第一个回合拿不到设定 ——
  // 而开场引导往往正是最需要世界书的时候。匹配本身是本地纯计算，不省这一下。
  const worldbookSection = await matchWorldbookSection(convo);

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
      messages: buildApiMessages(convo, worldbookSection)
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
    // 回复写完了，从里面抽出状态栏存到会话上 —— 下一轮由程序权威注入，
    // 不再依赖模型去抄历史（历史会被 maxTurns 截断）。
    syncConvoPanel(convo);
    renderAll({ forceScroll: true });
    persistConversations();
    el.input.focus();

    // 攒够未压缩的对话就后台压一段摘要。
    // 放在最后、不 await：压缩要额外调一次模型，不该让你等它。
    maybeSummarize(convo).catch((err) => console.error('后台摘要失败', err));
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
//  世界书（World Info / Lorebook）
//  左栏选书，中栏列条目，右栏编辑。数据在主进程的 worldbooks.json。
//  词条只由「会话绑定了哪本书」生效；每本书还能装若干角色副本（独立个体）。
// ---------------------------------------------------------------------------

const WB_NEW_ENTRY_DEFAULTS = {
  order: 100,
  probability: 100,
  selectiveLogic: 'AND_ANY',
  constant: false,
  enabled: true
};

/** 世界书的条目数展示 */
function wbEntryCountText(book) {
  if (!book) return '';
  const total = (book.entries || []).length;
  const on = (book.entries || []).filter((e) => e.enabled !== false).length;
  return on === total ? `${total} 条条目` : `${total} 条条目 · ${on} 条启用`;
}

function currentWorldbook() {
  return worldbookById(editingWorldbookId);
}

function currentEntry() {
  const book = currentWorldbook();
  if (!book) return null;
  return (book.entries || []).find((e) => e.id === editingEntryId) || null;
}

/** 把世界书表单里的内容写回内存（书名 + 开场白） */
function stashWorldbookName() {
  const book = currentWorldbook();
  if (!book || el.wb.entriesWrap.classList.contains('hidden')) return;
  const name = el.wb.name.value.trim() || '未命名世界书';
  book.name = name.slice(0, 120);
  book.opening = el.wb.opening.value.slice(0, 4000);
  book.updatedAt = now();
}

/** 把条目表单里的内容写回内存 */
function stashEntryForm() {
  const entry = currentEntry();
  if (!entry || el.wb.form.classList.contains('hidden')) return;

  const parseKeys = (value) =>
    String(value || '')
      .split(/[,，]/)
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, 200);

  entry.title = el.wb.e.title.value.trim().slice(0, 200) || parseKeys(el.wb.e.keys.value)[0] || '未命名条目';
  entry.keys = parseKeys(el.wb.e.keys.value);
  entry.secondaryKeys = parseKeys(el.wb.e.keys2.value);
  entry.selectiveLogic = el.wb.e.logic.value;
  entry.content = el.wb.e.content.value.slice(0, 20000);

  const order = Number(el.wb.e.order.value);
  entry.order = isFinite(order) ? Math.max(0, Math.min(9999, Math.floor(order))) : WB_NEW_ENTRY_DEFAULTS.order;

  const prob = Number(el.wb.e.prob.value);
  entry.probability = isFinite(prob) ? Math.max(0, Math.min(100, Math.floor(prob))) : 100;

  entry.constant = el.wb.e.constant.checked;
  entry.enabled = el.wb.e.enabled.checked;
}

function renderEntryList() {
  el.wb.entryList.innerHTML = '';

  const book = currentWorldbook();
  if (!book) return;

  const entries = book.entries || [];
  if (!entries.length) {
    const tip = document.createElement('div');
    tip.className = 'wb-list-empty';
    tip.textContent = '这本书还没有条目，点「＋ 条目」加一条';
    el.wb.entryList.appendChild(tip);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = `wb-entry${entry.id === editingEntryId ? ' active' : ''}${
      entry.enabled === false ? ' disabled' : ''
    }`;
    item.title = entry.title;
    item.addEventListener('click', () => selectEntry(entry.id));

    const title = document.createElement('div');
    title.className = 'wb-entry-title';

    const label = document.createElement('span');
    label.textContent = entry.title;
    title.appendChild(label);

    if (entry.constant) {
      const badge = document.createElement('span');
      badge.className = 'wb-badge';
      badge.textContent = '常驻';
      title.appendChild(badge);
    }
    if (entry.enabled === false) {
      const badge = document.createElement('span');
      badge.className = 'wb-badge';
      badge.textContent = '停用';
      title.appendChild(badge);
    }

    const keys = document.createElement('div');
    keys.className = 'wb-entry-keys';
    keys.textContent = (entry.keys || []).join(' / ') || '（无关键词）';

    item.append(title, keys);
    el.wb.entryList.appendChild(item);
  }
}

function showEntryForm(show) {
  el.wb.form.classList.toggle('hidden', !show);
  el.wb.formEmpty.classList.toggle('hidden', !!show);
}

function fillEntryForm(entry) {
  if (!entry) {
    showEntryForm(false);
    return;
  }

  el.wb.e.title.value = entry.title || '';
  el.wb.e.keys.value = (entry.keys || []).join(', ');
  el.wb.e.content.value = entry.content || '';
  el.wb.e.order.value = String(entry.order ?? WB_NEW_ENTRY_DEFAULTS.order);
  el.wb.e.prob.value = String(entry.probability ?? 100);
  el.wb.e.keys2.value = (entry.secondaryKeys || []).join(', ');
  el.wb.e.logic.value = entry.selectiveLogic || 'AND_ANY';
  el.wb.e.constant.checked = entry.constant === true;
  el.wb.e.enabled.checked = entry.enabled !== false;

  showEntryForm(true);
}

/** 选中一本世界书 */
function selectWorldbook(id) {
  stashWorldbookName();
  stashEntryForm();

  editingWorldbookId = id;
  const book = currentWorldbook();

  el.wb.entriesEmpty.classList.toggle('hidden', !!book);
  el.wb.entriesWrap.classList.toggle('hidden', !book);

  if (!book) {
    editingEntryId = null;
    showEntryForm(false);
    renderWorldbookChars();
    return;
  }

  el.wb.name.value = book.name;
  el.wb.opening.value = book.opening || '';
  el.wb.entryCount.textContent = wbEntryCountText(book);
  el.wb.footHint.textContent = `「${book.name}」只保存在你自己电脑上`;

  // 上一本书选中的条目在新书里不存在，自动落到第一条
  if (!currentEntry()) {
    editingEntryId = (book.entries || []).length ? book.entries[0].id : null;
  }

  renderEntryList();
  fillEntryForm(currentEntry());
  renderWorldbookChars();
}

function selectEntry(id) {
  stashEntryForm();
  editingEntryId = id;
  renderEntryList();
  fillEntryForm(currentEntry());
}

// ---------------------------------------------------------------------------
//  本书角色：从角色库复制进来的独立副本
//  和角色库里的那个角色互相独立 —— 改这边不影响那边，反之亦然。
// ---------------------------------------------------------------------------

function worldbookCharacters(book) {
  return book && Array.isArray(book.characters) ? book.characters : [];
}

/** 副本的 id 单独一个前缀，和角色库、会话的 id 不会看混 */
function newWorldbookCharId() {
  return `wc${uid()}`;
}

/** 画「本书角色」那一排 */
function renderWorldbookChars() {
  const host = el.wb.charList;
  if (!host) return;
  host.innerHTML = '';

  const book = currentWorldbook();
  if (!book) return;

  for (const c of worldbookCharacters(book)) {
    const chip = document.createElement('div');
    chip.className = 'wb-char-chip';
    chip.title = c.name;

    const av = document.createElement('div');
    av.className = 'wb-char-chip-avatar';
    if (c.avatar) {
      const img = document.createElement('img');
      img.src = c.avatar;
      img.alt = '';
      av.appendChild(img);
    } else {
      av.textContent = c.name.slice(0, 1);
    }

    const name = document.createElement('span');
    name.className = 'wb-char-chip-name';
    name.textContent = c.name;

    const btnEdit = document.createElement('button');
    btnEdit.type = 'button';
    btnEdit.className = 'wb-char-chip-btn';
    btnEdit.textContent = '编辑';
    btnEdit.title = '编辑这个副本的设定';
    btnEdit.addEventListener('click', () => editWorldbookCharacter(c.id));

    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'wb-char-chip-btn';
    btnDel.textContent = '移除';
    btnDel.title = '从本书移除（角色库里的不受影响）';
    btnDel.addEventListener('click', () => removeWorldbookCharacter(c.id));

    chip.append(av, name, btnEdit, btnDel);
    host.appendChild(chip);
  }
}

/** 把选中的角色库角色复制进本书：深拷贝一份，id 另发，两边从此互不相干 */
async function addWorldbookCharacters(ids) {
  const book = currentWorldbook();
  if (!book) return;

  const wanted = new Set(ids);
  const picked = characters().filter((c) => wanted.has(c.id));
  if (!picked.length) return;

  book.characters = worldbookCharacters(book);
  for (const src of picked) {
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = newWorldbookCharId();
    copy.createdAt = now();
    copy.updatedAt = now();
    book.characters.push(copy);
  }
  book.updatedAt = now();

  renderWorldbookChars();
  renderWorldbookPage();

  const ok = await persistLibrary();
  showToast(ok ? `已加入 ${picked.length} 个角色副本` : '加入失败，没能写入磁盘', ok ? 'ok' : 'error');
}

/** 在本书里新建一个空白角色副本，然后直接进编辑器 */
async function newWorldbookCharacter() {
  const book = currentWorldbook();
  if (!book) return;

  book.characters = worldbookCharacters(book);
  const character = {
    id: newWorldbookCharId(),
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
  book.characters.push(character);
  book.updatedAt = now();

  renderWorldbookChars();
  renderWorldbookPage();
  await persistLibrary();

  editWorldbookCharacter(character.id);
}

/** 从本书移除一个角色副本（角色库里的角色不动） */
async function removeWorldbookCharacter(id) {
  const book = currentWorldbook();
  if (!book) return;

  const target = worldbookCharacters(book).find((c) => c.id === id);
  if (!target) return;

  const ok = await confirmDialog({
    title: '移除角色',
    message: `把「${target.name}」从这本书里移除？角色库里的那个角色不受影响。`,
    confirmText: '移除',
    danger: true
  });
  if (!ok) return;

  book.characters = worldbookCharacters(book).filter((c) => c.id !== id);
  book.updatedAt = now();

  renderWorldbookChars();
  renderWorldbookPage();
  await persistLibrary();
  showToast('已移除', 'ok');
}

/** 打开角色编辑器，但作用域切到这本书的角色副本 */
function editWorldbookCharacter(id) {
  const book = currentWorldbook();
  if (!book) return;

  charEditorScope = 'worldbook';
  editingCharacterId = id;
  openCharsModal();
}

// --- 从角色库多选加入 ---

let wbPickerChars = [];
const wbPickerPicked = new Set();

function openWorldbookCharPicker() {
  const list = characters();
  if (!list.length) {
    showToast('角色库里还没有角色，先建一个吧', 'error');
    return;
  }

  wbPickerChars = list;
  wbPickerPicked.clear();
  renderWorldbookCharPicker();
  el.wbPicker.modal.classList.remove('hidden');
}

function closeWorldbookCharPicker() {
  el.wbPicker.modal.classList.add('hidden');
  wbPickerChars = [];
  wbPickerPicked.clear();
}

function renderWorldbookCharPicker() {
  const host = el.wbPicker.list;
  host.innerHTML = '';

  if (!wbPickerChars.length) {
    const tip = document.createElement('div');
    tip.className = 'wb-picker-empty';
    tip.textContent = '角色库是空的';
    host.appendChild(tip);
    return;
  }

  for (const c of wbPickerChars) {
    const row = document.createElement('label');
    row.className = `wb-picker-row${wbPickerPicked.has(c.id) ? ' picked' : ''}`;

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = wbPickerPicked.has(c.id);
    box.addEventListener('change', () => {
      if (box.checked) wbPickerPicked.add(c.id);
      else wbPickerPicked.delete(c.id);
      row.classList.toggle('picked', box.checked);
      updateWorldbookCharPickerHint();
    });

    const av = document.createElement('div');
    av.className = 'wb-picker-avatar';
    if (c.avatar) {
      const img = document.createElement('img');
      img.src = c.avatar;
      img.alt = '';
      av.appendChild(img);
    } else {
      av.textContent = c.name.slice(0, 1);
    }

    const name = document.createElement('span');
    name.className = 'wb-picker-name';
    name.textContent = c.name;

    row.append(box, av, name);
    host.appendChild(row);
  }

  updateWorldbookCharPickerHint();
}

function updateWorldbookCharPickerHint() {
  if (!el.wbPicker.hint) return;
  el.wbPicker.hint.textContent = wbPickerPicked.size
    ? `已选 ${wbPickerPicked.size} 个`
    : '加入的是副本，之后两边各改各的';
}

async function confirmWorldbookCharPicker() {
  const ids = [...wbPickerPicked];
  if (!ids.length) {
    showToast('先勾选要加入的角色', 'error');
    return;
  }
  closeWorldbookCharPicker();
  await addWorldbookCharacters(ids);
}

/**
 * 把当前角色的世界书绑定关系同步到磁盘。
 * 角色卡和世界书是两个文件，主进程允许一次写入同时带上两者。
 * 返回是否成功 —— 绑定这类操作失败时界面要回滚，不能假装成功。
 */
async function persistLibrary() {
  // 世界书没读进来就什么都别写：写下去等于把文件清空
  if (!worldbooksLoaded) {
    showToast('世界书上次没能读出来，先别改它 —— 重启应用再试', 'error');
    return false;
  }

  try {
    await api.saveCharacters({ characters: characters(), worldbooks: worldbooks() });
    return true;
  } catch (err) {
    console.error('保存世界书失败', err);
    showToast('世界书没能保存到磁盘', 'error');
    return false;
  }
}

// ---------------------------------------------------------------------------
//  世界书编辑器
//  只负责编辑「当前这一本」：选书、新建、游玩、导入都在世界书列表页那边。
//  「绑定到会话」整套已经拿掉 —— 世界书是一个世界，从列表页点「游玩」进入，
//  不再往已经开始的对话上挂。
// ---------------------------------------------------------------------------

function openWorldbooksModal() {
  // 角色库可能没开着（侧边栏可以直接进世界书），stashCharForm 内部会自己判断
  stashCharForm();

  if (!editingWorldbookId || !currentWorldbook()) {
    editingWorldbookId = worldbooks().length ? worldbooks()[0].id : null;
  }

  selectWorldbook(editingWorldbookId);
  renderWorldbookChars();

  el.wb.modal.classList.remove('hidden');
}

function closeWorldbooksModal() {
  stashWorldbookName();
  stashEntryForm();

  el.wb.modal.classList.add('hidden');
  renderWorldbookChars();
  persistLibrary();
  // 列表页可能还开着（编辑完回来看得到最新状态）
  renderWorldbookPage();
}

/** 新建一本世界书，并直接进编辑器 */
function newWorldbook() {
  stashWorldbookName();
  stashEntryForm();

  const book = {
    id: `w${uid()}`,
    name: '新世界书',
    entries: [],
    characters: [],
    createdAt: now(),
    updatedAt: now()
  };

  state.worldbooks = [...worldbooks(), book];
  editingWorldbookId = book.id;
  renderWorldbookPage();

  openWorldbooksModal();
  el.wb.name.focus();
  el.wb.name.select();
}

function newEntry() {
  const book = currentWorldbook();
  if (!book) return;

  stashEntryForm();

  const entry = {
    id: `e${Date.now().toString(36)}${Math.floor(Math.random() * 9000 + 1000)}`,
    title: '新条目',
    keys: [],
    secondaryKeys: [],
    selectiveLogic: WB_NEW_ENTRY_DEFAULTS.selectiveLogic,
    content: '',
    order: WB_NEW_ENTRY_DEFAULTS.order,
    constant: false,
    matchWholeWords: false,
    caseSensitive: false,
    probability: WB_NEW_ENTRY_DEFAULTS.probability,
    enabled: true
  };

  book.entries = [...(book.entries || []), entry];
  book.updatedAt = now();

  el.wb.entryCount.textContent = wbEntryCountText(book);
  renderEntryList();
  selectEntry(entry.id);

  el.wb.e.title.focus();
  el.wb.e.title.select();
}

async function saveEntry() {
  const entry = currentEntry();
  const book = currentWorldbook();
  if (!entry || !book) return;

  stashEntryForm();

  // 没关键词又不是常驻的条目永远不会触发，提醒一下（但不阻止保存）
  if (!entry.constant && !entry.keys.length) {
    showToast('这条既没有关键词、也不是常驻，永远不会被注入', 'error');
  }

  book.updatedAt = now();
  el.wb.entryCount.textContent = wbEntryCountText(book);
  renderEntryList();
  fillEntryForm(entry);

  await persistLibrary();
  showToast('条目已保存', 'ok');
}

async function deleteEntry() {
  const entry = currentEntry();
  const book = currentWorldbook();
  if (!entry || !book) return;

  stashEntryForm();

  const ok = await confirmDialog({
    title: '删除条目',
    message: `删除条目「${entry.title}」？`,
    confirmText: '删除',
    danger: true
  });
  if (!ok) return;

  book.entries = (book.entries || []).filter((e) => e.id !== entry.id);
  book.updatedAt = now();

  editingEntryId = book.entries.length ? book.entries[0].id : null;
  el.wb.entryCount.textContent = wbEntryCountText(book);
  renderEntryList();
  fillEntryForm(currentEntry());

  await persistLibrary();
  showToast('条目已删除');
}

async function deleteWorldbook() {
  const book = currentWorldbook();
  if (!book) return;

  stashWorldbookName();

  const charCount = worldbookCharacters(book).length;
  const usedByConvo = state.conversations.filter((c) => convoWorldbookIds(c).includes(book.id)).length;
  const bits = [`${(book.entries || []).length} 条条目`];
  if (charCount) bits.push(`${charCount} 个角色副本`);
  const tail = usedByConvo ? `；它还在 ${usedByConvo} 个会话里生效，删掉后那些会话会失去它的设定` : '';

  const ok = await confirmDialog({
    title: '删除世界书',
    message: `删除「${book.name}」？这本书里的 ${bits.join('、')}会一起删掉${tail}。`,
    confirmText: '删除',
    danger: true
  });
  if (!ok) return;

  state.worldbooks = worldbooks().filter((w) => w.id !== book.id);

  // 会话上还绑着这本书的要一起摘掉，别留下指向空气的 id
  for (const convo of state.conversations) {
    const ids = convoWorldbookIds(convo);
    if (ids.includes(book.id)) {
      convo.worldbookIds = ids.filter((id) => id !== book.id);
      convo.updatedAt = now();
    }
  }

  // 角色编辑器可能正开在这本书的副本上，退回角色库
  if (charEditorScope === 'worldbook') charEditorScope = 'library';

  editingWorldbookId = worldbooks().length ? worldbooks()[0].id : null;
  renderWorldbookPage();

  persistConversations(0);
  await persistLibrary();
  showToast('世界书已删除');
}

/**
 * 预览「正在编辑的这本书」会在当前会话里命中哪些条目。
 * 用的就是真实请求时的扫描逻辑，方便排查关键词写没写对。
 * 以前是预览「会话绑定的那些书」，绑定那套拿掉之后改成预览当前编辑的这本。
 */
async function previewWorldbook() {
  const book = currentWorldbook();
  if (!book) {
    showToast('先选一本书', 'error');
    return;
  }

  const convo = activeConvo();

  if (!convo) {
    showToast('当前没有会话', 'error');
    return;
  }

  const history = convo.messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim()
  );

  if (!history.length) {
    showToast('这个会话还没有消息，先聊两句再看预览', 'error');
    return;
  }

  try {
    const result = await api.previewWorldbook({
      worldbookIds: [book.id],
      scanDepth: WORLDBOOK_SCAN_DEPTH,
      messages: history.slice(-WORLDBOOK_SCAN_DEPTH).map((m) => ({ role: m.role, content: m.content }))
    });

    const hits = (result && result.hits) || [];
    if (!hits.length) {
      showToast(`扫了最近 ${result.scanDepth} 条消息，${result.total} 条条目一条都没命中`, 'error');
      return;
    }

    const names = hits.map((h) => h.title).join('、');
    showToast(`「${book.name}」命中 ${hits.length} 条：${names}`);
  } catch (err) {
    console.error('预览失败', err);
    showToast('预览失败', 'error');
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
  // 「＋ 新对话」= 带你去角色列表页挑一个角色，
  // 点那张卡上的「聊天」才算真正把会话建出来。
  el.btnNew.addEventListener('click', () => {
    if (state.streaming) {
      showToast('正在生成回答，先停止再新建会话');
      return;
    }
    showView('chars');
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
    // 导出时用和界面一致的称呼：你 = 玩家角色名，对方 = 角色名 / 世界名
    const assistantLabel = speakerName(convo);
    const meLabel = convoUserName(convo);
    const text = convo.messages
      .map((m) => `${m.role === 'user' ? meLabel : m.role === 'error' ? '错误' : assistantLabel}：${m.content}`)
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

  // 角色库 → 切到角色列表页
  el.btnChars.addEventListener('click', () => showView('chars'));
  el.btnCloseChars.addEventListener('click', closeCharsModal);
  el.btnNewChar.addEventListener('click', newCharacter);
  el.btnSaveChar.addEventListener('click', saveCharacter);
  el.btnDelChar.addEventListener('click', deleteCharacter);
  el.btnImportCard.addEventListener('click', importCards);

  // 点头像换图 / 清除头像
  el.charAvatar.addEventListener('click', pickAvatar);
  el.btnClearAvatar.addEventListener('click', clearAvatar);

  // 状态面板
  el.btnPanelToggle.addEventListener('click', togglePanel);
  el.btnPanelClose.addEventListener('click', togglePanel);
  el.btnPanelReset.addEventListener('click', resetPanel);

  // 记忆管理
  el.btnMemory.addEventListener('click', openMemoryModal);
  el.btnCloseMemory.addEventListener('click', closeMemoryModal);
  el.btnCloseMemory2.addEventListener('click', closeMemoryModal);
  el.btnSummarizeNow.addEventListener('click', summarizeNow);
  el.btnMemoryClear.addEventListener('click', clearAllSummaries);
  el.memoryModal.addEventListener('click', (event) => {
    if (event.target === el.memoryModal) closeMemoryModal();
  });

  // 视角设置（叙述模式 + GM 模式），改动即时生效
  el.btnPerspective.addEventListener('click', openPerspectiveModal);
  el.btnClosePerspective.addEventListener('click', closePerspectiveModal);
  el.btnClosePerspective2.addEventListener('click', closePerspectiveModal);
  el.pNarration.addEventListener('change', applyPerspectiveFromForm);
  el.pGm.addEventListener('change', applyPerspectiveFromForm);
  el.perspectiveModal.addEventListener('click', (event) => {
    if (event.target === el.perspectiveModal) closePerspectiveModal();
  });

  // 世界书 → 切到世界书列表页
  el.btnWorldbooks.addEventListener('click', () => showView('worldbooks'));

  el.wb.btnClose.addEventListener('click', closeWorldbooksModal);
  el.wb.btnClose2.addEventListener('click', closeWorldbooksModal);
  el.wb.btnImport.addEventListener('click', importWorldbooks);
  el.wb.btnNew.addEventListener('click', newWorldbook);
  el.wb.btnNewEntry.addEventListener('click', newEntry);
  el.wb.btnDelBook.addEventListener('click', deleteWorldbook);
  el.wb.btnDelEntry.addEventListener('click', deleteEntry);
  el.wb.btnSaveEntry.addEventListener('click', saveEntry);
  el.wb.btnPreview.addEventListener('click', previewWorldbook);
  el.wb.btnAddChars.addEventListener('click', openWorldbookCharPicker);
  el.wb.btnNewChar.addEventListener('click', newWorldbookCharacter);

  // 从角色库多选加入
  el.wbPicker.btnClose.addEventListener('click', closeWorldbookCharPicker);
  el.wbPicker.btnCancel.addEventListener('click', closeWorldbookCharPicker);
  el.wbPicker.btnConfirm.addEventListener('click', confirmWorldbookCharPicker);
  el.wbPicker.modal.addEventListener('click', (event) => {
    if (event.target === el.wbPicker.modal) closeWorldbookCharPicker();
  });

  // 进入世界前创建玩家角色
  el.btnClosePlayer.addEventListener('click', closePlayerModal);
  el.btnCancelPlayer.addEventListener('click', closePlayerModal);
  el.btnStartPlay.addEventListener('click', startWorldPlay);
  el.playerModal.addEventListener('click', (event) => {
    if (event.target === el.playerModal) closePlayerModal();
  });

  // 世界书名称和条目内容都是边打字边留在内存里，关闭弹窗时统一落盘
  el.wb.name.addEventListener('input', () => {
    const book = currentWorldbook();
    if (!book) return;
    book.name = el.wb.name.value.trim() || '未命名世界书';
    renderWorldbookPage();
    renderWorldbookChars();
  });

  el.wb.opening.addEventListener('input', () => {
    const book = currentWorldbook();
    if (!book) return;
    book.opening = el.wb.opening.value.slice(0, 4000);
  });

  el.wb.modal.addEventListener('click', (event) => {
    if (event.target === el.wb.modal) closeWorldbooksModal();
  });

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
    if (!el.playerModal.classList.contains('hidden')) {
      closePlayerModal();
      return;
    }
    if (!el.wbPicker.modal.classList.contains('hidden')) {
      closeWorldbookCharPicker();
      return;
    }
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
    // 世界书必须跟着角色一起写：主进程收到 worldbooks 才会更新那个文件。
    // 漏掉的话，刷新/关闭时角色绑定关系会指向一本已经不在磁盘上的书。
    api.saveCharactersNow({ characters: characters(), worldbooks: worldbooks() });
  });
}

// ---------------------------------------------------------------------------
//  角色库
// ---------------------------------------------------------------------------

function persistCharacters(immediate) {
  // 角色和世界书分开存两个文件，主进程允许一次请求同时带上 worldbooks；
  // 但只在世界书确实读进来了时才带 —— 否则「存一次角色」会把 worldbooks.json 写空。
  const payload = { characters: characters() };
  if (worldbooksLoaded) payload.worldbooks = worldbooks();

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
  // 弹窗现在只是「编辑某一个角色」的表单，没有列表了。
  // 谁打开它谁负责先设好 editingCharacterId / charEditorScope。
  let current = editorCharacterById(editingCharacterId);

  if (!current) {
    // 兜底：没指定就退回作用域里的第一个（世界书副本也走这里）
    const list = editorCharacterList();
    editingCharacterId = list.length ? list[0].id : null;
    current = editorCharacterById(editingCharacterId);
  }

  if (current) {
    fillCharForm(current);
  } else {
    showCharForm(false);
  }

  updateCharEditorScopeUi();
  el.charsModal.classList.remove('hidden');
}

/** 弹窗标题跟着作用域变，免得改半天不知道改的是哪一份 */
function updateCharEditorScopeUi() {
  const inBook = charEditorScope === 'worldbook';
  const book = inBook ? currentWorldbook() : null;

  if (el.charsTitle) {
    el.charsTitle.textContent = inBook ? '编辑本书角色' : '编辑角色';
  }
  if (el.charsSub) {
    el.charsSub.textContent = inBook
      ? `这本书里的独立副本，改它不影响角色库${book ? ` · ${book.name}` : ''}`
      : '改完记得点右下角「保存角色」';
  }
}

function closeCharsModal() {
  el.charsModal.classList.add('hidden');
  el.input.focus();
}

/** 底部提示：跟着编辑器作用域变，免得不知道改的是哪一份 */
function charFootHintText(character) {
  if (charEditorScope === 'worldbook') return '改的是世界书里的副本，角色库里的那个角色不受影响';
  if (!character) return '角色卡只保存在你自己电脑上';
  if (character.source === 'png') return '来自酒馆 PNG 角色卡';
  if (character.source === 'json') return '来自 JSON 角色卡';
  return '这是你自己写的角色';
}

/** 有角色时显示右边的编辑表单，没有就显示空状态 */
function showCharForm(show) {
  el.charForm.classList.toggle('hidden', !show);
  el.charEmpty.classList.toggle('hidden', !!show);
  el.btnDelChar.disabled = !show;
  el.btnSaveChar.disabled = !show;
  if (!show) el.charFootHint.textContent = charFootHintText(null);
}

// ---------------------------------------------------------------------------
//  主区域的视图切换
//  以前整个 main 只有聊天一屏，所有功能都靠弹窗盖在上面；
//  角色库变成页面之后就需要这一层了。
// ---------------------------------------------------------------------------

/** 当前主区域显示的是哪个视图：'chat' 聊天 / 'chars' 角色列表 / 'worldbooks' 世界书列表 */
let currentView = 'chat';

const VIEWS = ['chat', 'chars', 'worldbooks'];

function showView(name) {
  if (!VIEWS.includes(name)) return;
  currentView = name;

  el.viewChat.classList.toggle('hidden', name !== 'chat');
  el.viewChars.classList.toggle('hidden', name !== 'chars');
  el.viewWorldbooks.classList.toggle('hidden', name !== 'worldbooks');
  // 侧边栏那一项高亮，让人知道自己在哪个页面
  el.btnChars.classList.toggle('active', name === 'chars');
  el.btnWorldbooks.classList.toggle('active', name === 'worldbooks');

  if (name === 'chars') renderCharacterPage();
  else if (name === 'worldbooks') renderWorldbookPage();
  else el.input.focus();
}

// ---------------------------------------------------------------------------
//  世界书列表页
//  世界书是「一个世界」：从这里点「游玩」进入，进去前先创建你自己的角色。
//  它不再是「给某个对话挂上去的设定」—— 绑到已经开始的对话上那套已经拿掉了。
// ---------------------------------------------------------------------------

function renderWorldbookPage() {
  const grid = el.wbPageGrid;
  if (!grid) return;
  grid.innerHTML = '';

  const list = worldbooks();
  el.wbPageEmpty.classList.toggle('hidden', !!list.length);

  if (el.wbPageSub) {
    el.wbPageSub.textContent = list.length
      ? `共 ${list.length} 个世界 · 点「游玩」进入，进去前先创建你自己的角色`
      : '导入酒馆的 lorebook，或自己写一个世界';
  }

  for (const book of list) grid.appendChild(worldbookCard(book));
}

/** 一张世界书卡片：世界名 + 设定条数 / 角色数 + 编辑/游玩 */
function worldbookCard(book) {
  const card = document.createElement('div');
  card.className = 'char-card';
  card.setAttribute('role', 'listitem');
  card.title = book.name;

  const av = document.createElement('div');
  av.className = 'char-card-avatar worldbook-avatar';
  av.textContent = '世';

  const name = document.createElement('div');
  name.className = 'char-card-name';
  name.textContent = book.name;

  const charCount = worldbookCharacters(book).length;
  const sub = document.createElement('div');
  sub.className = 'char-card-sub';
  sub.textContent = charCount
    ? `${book.entries.length} 条设定 · ${charCount} 个角色`
    : `${book.entries.length} 条设定`;

  const actions = document.createElement('div');
  actions.className = 'char-card-actions';

  const btnEdit = document.createElement('button');
  btnEdit.type = 'button';
  btnEdit.className = 'btn btn-ghost btn-sm';
  btnEdit.textContent = '编辑';
  btnEdit.addEventListener('click', () => editWorldbookFromPage(book.id));

  const btnPlay = document.createElement('button');
  btnPlay.type = 'button';
  btnPlay.className = 'btn btn-primary btn-sm';
  btnPlay.textContent = '游玩';
  btnPlay.addEventListener('click', () => openPlayerModal(book.id));

  actions.append(btnEdit, btnPlay);
  card.append(av, name, sub, actions);
  return card;
}

/** 点「编辑」：打开世界书编辑器（它现在只编辑这一本） */
function editWorldbookFromPage(id) {
  const book = worldbookById(id);
  if (!book) return;
  editingWorldbookId = id;
  openWorldbooksModal();
}

// ---------------------------------------------------------------------------
//  进入世界：先创建玩家自己的角色
// ---------------------------------------------------------------------------

let playingBookId = null;

function openPlayerModal(bookId) {
  const book = worldbookById(bookId);
  if (!book) return;

  playingBookId = bookId;

  if (el.playerTitle) el.playerTitle.textContent = `进入「${book.name}」`;
  if (el.playerSub) {
    el.playerSub.textContent = '先给这个世界里的自己一个身份，然后就可以开始了';
  }
  // 名字预填设置里的「你的名字」，省得每次重打
  el.playerName.value = (state.settings && state.settings.userName) || '';
  el.playerProfile.value = '';

  el.playerModal.classList.remove('hidden');
  el.playerName.focus();
  el.playerName.select();
}

function closePlayerModal() {
  el.playerModal.classList.add('hidden');
  playingBookId = null;
}

/**
 * 「开始游玩」：建一个会话，把这个世界装上，并存下玩家自己的角色。
 * 世界模型本来就应该由 GM 叙述，所以顺手把 GM 模式打开。
 */
function startWorldPlay() {
  const book = worldbookById(playingBookId);
  if (!book) return;

  const name = el.playerName.value.trim();
  const profile = el.playerProfile.value.trim();

  if (!name) {
    showToast('给你的角色起个名字吧', 'error');
    el.playerName.focus();
    return;
  }

  const convo = createConvo(true);
  convo.worldbookIds = [book.id];
  convo.player = { name, profile };
  convo.gmMode = true;
  convo.title = book.name;
  convo.updatedAt = now();

  // 开场：书里写了就用书里的；没写就让模型按设定现生成一段
  const opening = String(book.opening || '').trim();
  if (opening) {
    convo.messages = [
      {
        role: 'assistant',
        content: applyMacros(opening, null, name),
        at: now(),
        greeting: true
      }
    ];
  }

  closePlayerModal();
  showView('chat');
  renderAll({ forceScroll: true });
  persistConversations(0);

  showToast(`进入「${book.name}」—— 你是「${name}」`, 'ok');
  el.input.focus();

  // 没写开场白就去生成一段。失败也不影响玩，只是开局空着
  if (!opening) generateWorldOpening(convo, book);
}

/** 正在生成开局的那个会话 id；同一时间只允许一个 */
let openingBusyId = null;

/**
 * 让模型按世界设定写一段开局场景，然后作为第一条消息放进会话。
 *
 * 用独立的 requestId 调接口，所以流式分片不会被聊天窗口的监听器接住 ——
 * 生成过程不会闪在界面里，写完才一次性落进去。
 */
async function generateWorldOpening(convo, book) {
  const endpoint = ensureConvoEndpoint(convo);
  if (!endpoint || !endpoint.provider.apiKey) {
    // 还没配好模型，就别硬来了 —— 用户配好之后可以自己开个头
    return;
  }

  openingBusyId = convo.id;
  renderMessages({ forceScroll: true });

  try {
    const me = convoUserName(convo);
    const parts = [gmRuleText('', me)];
    const player = convoPlayer(convo);
    if (player && player.profile) parts.push(`【玩家角色：${player.name || me}】\n${player.profile}`);
    const cast = worldbookCast(convo);
    if (cast) parts.push(cast);
    // 开局这段不按关键词，把这本书的设定尽量都带上，免得开局世界是空的
    const lore = book.entries
      .filter((e) => e.enabled !== false && String(e.content || '').trim())
      .slice(0, 40)
      .map((e) => `【${e.title}】\n${String(e.content).trim()}`)
      .join('\n\n');
    if (lore) parts.push(`[世界设定]\n${lore.slice(0, 12000)}`);

    const response = await api.sendChat({
      requestId: `opening-${uid()}`,
      providerId: endpoint.provider.id,
      model: endpoint.model,
      messages: [
        { role: 'system', content: parts.join('\n\n') },
        {
          role: 'user',
          content: `（开场）故事开始了。请用一段具体的场景开场：交代「${player && player.name ? player.name : me}」此刻在哪里、正遇到什么，并留下可以行动的方向。不要替玩家做决定。`
        }
      ]
    });

    if (!response || response.ok !== true) throw new Error((response && response.error) || '调用失败');

    const text = String(response.content || '').trim();
    if (!text) return;

    // 生成期间用户可能已经自己说了话，那就别把开局硬插到后面
    if (activeConvo() !== convo || convo.messages.length) return;

    convo.messages = [{ role: 'assistant', content: text, at: now(), greeting: true }];
    convo.updatedAt = now();
    persistConversations(0);
    if (activeConvo() === convo) renderAll({ forceScroll: true });
  } catch (err) {
    console.error('生成开局失败', err);
    if (activeConvo() === convo) showToast('开局没生成出来，直接开始也行', 'error');
  } finally {
    openingBusyId = null;
    if (activeConvo() === convo) renderMessages({ forceScroll: true });
  }
}

/** 玩家在这个世界里的角色（老的会话没有这个字段） */
function convoPlayer(convo) {
  const p = convo && convo.player;
  if (!p || typeof p !== 'object') return null;
  const name = String(p.name || '').trim();
  const profile = String(p.profile || '').trim();
  if (!name && !profile) return null;
  return { name, profile };
}

/** {{user}} 的替换值：进了世界的会话用玩家角色的名字，其它会话用设置里的名字 */
function convoUserName(convo) {
  const player = convoPlayer(convo);
  return player && player.name ? player.name : userName();
}

/**
 * 助手那一侧显示成谁：
 *   · 绑了角色卡 → 角色名
 *   · 进了世界 → 世界名（那个世界里的所有 NPC 都算它说的）
 *   · 都没有 → 通用助手，用全局人设那个名字
 */
function speakerName(convo) {
  const character = characterForConvo(convo);
  if (character) return character.name;

  const book = convoWorldbookIds(convo)
    .map((id) => worldbookById(id))
    .find(Boolean);
  if (book) return book.name;

  return '昔涟';
}

// 名单太长会吃掉上下文，给个总预算；单个 NPC 的描述也截一下
const MAX_CAST_CHARS = 3000;
const MAX_CAST_PER_NPC = 160;

/**
 * 「这个世界的人」：把书里的角色副本列给 GM。
 *
 * 不列的话 GM 根本不知道这个世界有哪些 NPC —— 之前就是这样，它只能现编人物，
 * 或者等你主动提到名字。名单每轮都注入，所以做了长度上限。
 */
function worldbookCast(convo) {
  const books = convoWorldbookIds(convo)
    .map((id) => worldbookById(id))
    .filter(Boolean);
  const cast = books.flatMap((b) => worldbookCharacters(b));
  if (!cast.length) return '';

  const lines = [];
  let total = 0;

  for (const c of cast) {
    const bits = [c.description, c.personality]
      .map((s) => String(s || '').trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .join(' ');
    const line = `- ${c.name}：${bits.slice(0, MAX_CAST_PER_NPC) || '（没写设定）'}`;

    if (total + line.length > MAX_CAST_CHARS) {
      lines.push(`- （还有 ${cast.length - lines.length} 人没列出）`);
      break;
    }
    lines.push(line);
    total += line.length;
  }

  return `【这个世界的人】\n以下角色由你扮演，各自有各自的立场、语气和说话习惯。\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
//  角色列表页
//  这份列表以前塞在编辑弹窗的左栏里，弹窗一关就看不见角色有哪些。
//  现在它是主区域里的一个独立页面，每张卡直接给「编辑」和「聊天」两个入口。
// ---------------------------------------------------------------------------

function renderCharacterPage() {
  const grid = el.charPageGrid;
  if (!grid) return;
  grid.innerHTML = '';

  const list = characters();
  el.charPageEmpty.classList.toggle('hidden', !!list.length);

  if (el.charsPageSub) {
    el.charsPageSub.textContent = list.length
      ? `共 ${list.length} 个角色 · 点「聊天」直接开一个新会话`
      : '导入酒馆角色卡，或自己写一个';
  }

  for (const c of list) grid.appendChild(characterCard(c));
}

/** 一张角色卡：头像 + 名字 + 来源 + 编辑/聊天 */
function characterCard(c) {
  const card = document.createElement('div');
  card.className = 'char-card';
  card.setAttribute('role', 'listitem');
  card.title = c.name;

  const av = document.createElement('div');
  av.className = 'char-card-avatar';
  if (c.avatar) {
    const img = document.createElement('img');
    img.src = c.avatar;
    img.alt = '';
    av.appendChild(img);
  } else {
    av.textContent = c.name.slice(0, 1);
  }

  const name = document.createElement('div');
  name.className = 'char-card-name';
  name.textContent = c.name;

  const sub = document.createElement('div');
  sub.className = 'char-card-sub';
  sub.textContent = c.source === 'png' ? '酒馆角色卡' : c.source === 'json' ? 'JSON 角色卡' : '手写';

  const actions = document.createElement('div');
  actions.className = 'char-card-actions';

  const btnEdit = document.createElement('button');
  btnEdit.type = 'button';
  btnEdit.className = 'btn btn-ghost btn-sm';
  btnEdit.textContent = '编辑';
  btnEdit.addEventListener('click', () => editCharacterFromPage(c.id));

  const btnChat = document.createElement('button');
  btnChat.type = 'button';
  btnChat.className = 'btn btn-primary btn-sm';
  btnChat.textContent = '聊天';
  btnChat.addEventListener('click', () => chatWithCharacter(c.id));

  actions.append(btnEdit, btnChat);
  card.append(av, name, sub, actions);
  return card;
}

/** 点「编辑」：用编辑弹窗打开这个角色（弹窗现在只是表单） */
function editCharacterFromPage(id) {
  charEditorScope = 'library';
  editingCharacterId = id;
  openCharsModal();
}

/** 点「聊天」：新建一个会话并绑上这个角色，然后切回聊天视图 */
function chatWithCharacter(id) {
  const character = characterById(id);
  if (!character) return;

  if (state.streaming) {
    showToast('正在生成回答，先点「停止生成」再开新会话');
    return;
  }

  createConvo(true);
  // 复用「绑定角色」那套逻辑：自动插入开场白、自动把会话标题起成角色名
  applyCharacterChoice(id);

  showView('chat');
  showToast(`开始和「${character.name}」聊天`, 'ok');
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

  el.charFootHint.textContent = charFootHintText(character);

  showCharForm(true);
}

/** 把表单里的内容写回内存里的角色对象（切走或保存前调用） */
function stashCharForm() {
  const character = editorCharacterById(editingCharacterId);
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
    id: charEditorScope === 'worldbook' ? newWorldbookCharId() : uid(),
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

  if (charEditorScope === 'worldbook') {
    const book = currentWorldbook();
    if (!book) return;
    book.characters = worldbookCharacters(book);
    book.characters.push(character);
    book.updatedAt = now();
  } else {
    state.characters = [...characters(), character];
  }

  editingCharacterId = character.id;

  renderCharacterPage();
  fillCharForm(character);

  el.c.name.focus();
  el.c.name.select();
}

async function saveCharacter() {
  if (!editingCharacterId) return;

  const character = editorCharacterById(editingCharacterId);
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
  renderCharacterPage();
  fillCharForm(character);
  renderAll();

  // 改的是书里的副本，书名旁边那排和左栏计数都要跟着刷新
  if (charEditorScope === 'worldbook') {
    renderWorldbookChars();
    renderWorldbookPage();
  }

  await persistCharacters();
  showToast(`角色「${character.name}」已保存`, 'ok');
}

async function deleteCharacter() {
  const character = editorCharacterById(editingCharacterId);
  if (!character) return;

  const inBook = charEditorScope === 'worldbook';

  const ok = await confirmDialog({
    title: inBook ? '移除角色' : '删除角色',
    message: inBook
      ? `把「${character.name}」从这本书里移除？角色库里的那个角色不受影响。`
      : `删除角色「${character.name}」？用到它的会话会变回通用助手。`,
    confirmText: inBook ? '移除' : '删除',
    danger: true
  });
  if (!ok) return;

  if (inBook) {
    const book = currentWorldbook();
    if (book) {
      book.characters = worldbookCharacters(book).filter((c) => c.id !== character.id);
      book.updatedAt = now();
    }
  } else {
    state.characters = characters().filter((c) => c.id !== character.id);

    // 把绑定了这个角色的会话解绑，免得留下一个指向空气的 id
    for (const convo of state.conversations) {
      if (convo.characterId === character.id) convo.characterId = null;
    }
  }

  // 弹窗现在只是「编辑这一个角色」的表单，角色没了就没有可编辑的对象 —— 直接关掉。
  // 列表页 / 世界书的副本条会在下面刷新，入口都还在原处。
  editingCharacterId = null;
  closeCharsModal();

  if (inBook) {
    // 书里的副本不受会话影响，只需要刷新书那边的界面
    renderWorldbookChars();
    renderWorldbookPage();
  } else {
    renderAll();
    persistConversations(0);
  }
  await persistCharacters();

  showToast(inBook ? `已移除「${character.name}」` : `已删除「${character.name}」`);
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
  const addedBooks = Array.isArray(result.worldbooks) ? result.worldbooks : [];
  const errors = Array.isArray(result.errors) ? result.errors : [];

  if (!added.length && !addedBooks.length) {
    showToast(errors.length ? errors[0] : '没有导入任何内容', 'error');
    return;
  }

  // 重新发一批 id：主进程是同一毫秒里生成的，撞车的概率不能忽略
  const stamp = Date.now().toString(36);
  const fresh = added.map((c, i) => ({ ...c, id: `c${stamp}-${i}` }));

  // 世界书要换 id；书里内嵌的角色副本也一起换，免得两次导入撞上同一个 id
  const freshBooks = addedBooks.map((w, i) => {
    const book = { ...w, id: `w${stamp}-${i}` };
    if (Array.isArray(book.characters)) {
      book.characters = book.characters.map((c, j) => ({ ...c, id: `wc${stamp}-${i}-${j}` }));
    }
    return book;
  });

  state.worldbooks = [...worldbooks(), ...freshBooks];
  state.characters = [...characters(), ...fresh];
  if (fresh.length) editingCharacterId = fresh[0].id;

  renderCharacterPage();
  if (fresh.length) {
    // 直接打开刚导入的第一个角色，方便马上核对设定对不对
    charEditorScope = 'library';
    openCharsModal();
  }
  await persistCharacters();

  const parts = [];
  if (fresh.length) parts.push(`${fresh.length} 个角色：${fresh.map((c) => c.name).join('、')}`);
  if (freshBooks.length) parts.push(`${freshBooks.length} 个世界书`);

  showToast(`已导入 ${parts.join('，')}`, 'ok');

  if (errors.length) {
    console.warn('部分内容导入失败：', errors);
    setTimeout(
      () => showToast(`${errors.length} 个文件没能导入：${errors[0]}`, 'error'),
      CONFIG.TOAST_DURATION_MS + 300
    );
  }
}

/**
 * 在世界书弹窗里「导入世界书」。
 * 复用角色的导入通道（同一个文件框），只是落点不同：
 * 角色照样进角色库，世界书则挂到当前选中的这本书所在的位置。
 */
async function importWorldbooks() {
  stashWorldbookName();
  stashEntryForm();

  let result = null;
  try {
    el.wb.btnImport.disabled = true;
    result = await api.importCard();
  } catch (err) {
    showToast((err && err.message) || '导入失败', 'error');
    return;
  } finally {
    el.wb.btnImport.disabled = false;
  }

  if (!result || result.canceled) return;

  const added = Array.isArray(result.characters) ? result.characters : [];
  const addedBooks = Array.isArray(result.worldbooks) ? result.worldbooks : [];
  const errors = Array.isArray(result.errors) ? result.errors : [];

  if (!addedBooks.length && !added.length) {
    showToast(errors.length ? errors[0] : '没有导入任何内容', 'error');
    return;
  }

  // 主进程可能同一毫秒里生成多个 id，这里统一重发一批，避免撞车
  const stamp = Date.now().toString(36);
  const freshBooks = addedBooks.map((w, i) => {
    const book = { ...w, id: `w${stamp}-${i}` };
    if (Array.isArray(book.characters)) {
      book.characters = book.characters.map((c, j) => ({ ...c, id: `wc${stamp}-${i}-${j}` }));
    }
    return book;
  });
  const freshChars = added.map((c, i) => ({ ...c, id: `c${stamp}-${i}` }));

  state.worldbooks = [...worldbooks(), ...freshBooks];
  if (freshChars.length) state.characters = [...characters(), ...freshChars];

  if (freshBooks.length) {
    // 直接打开刚导入的那本，方便马上核对设定对不对
    editingWorldbookId = freshBooks[freshBooks.length - 1].id;
    renderWorldbookPage();
    openWorldbooksModal();
  } else {
    renderWorldbookPage();
  }

  renderCharacterPage();
  renderWorldbookChars();
  await persistLibrary();

  const parts = [];
  if (freshBooks.length) parts.push(`${freshBooks.length} 本世界书`);
  if (freshChars.length) parts.push(`${freshChars.length} 个角色`);
  showToast(`已导入 ${parts.join('，')}`, 'ok');

  if (errors.length) {
    console.warn('部分内容导入失败：', errors);
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

  // 世界书读不到不该拦住启动，但**必须记住没读到** ——
  // 否则之后随便存一次角色，就会把 worldbooks.json 覆盖成空文件。
  try {
    const storedBooks = await api.getWorldbooks();
    state.worldbooks = Array.isArray(storedBooks && storedBooks.worldbooks) ? storedBooks.worldbooks : [];
    worldbooksLoaded = true;
  } catch (err) {
    console.error('读取世界书失败', err);
    showToast('世界书没能读出来，本次不会写回它（重启试试）', 'error');
  }

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
