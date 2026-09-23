'use strict';

// ============================================================================
//  main.js —— 界面逻辑的入口（跑在窗口里）
//  职责：画对话、把消息发给主进程、接收流式增量做「打字机」效果、存历史。
//
//  这里还在往 ES module 拆，分层是：
//    core/   底层：常量、状态、DOM 引用、preload 桥、工具函数
//    ui/     通用界面件：提示条、确认框、主题、Markdown
//    data/   纯逻辑：服务商/模型、角色库、面板、叙述规则、摘要、持久化、导入重发 id
//    views/  一个功能一块（refresh.js 刷新总线、header.js 对话头部、
//            perspectiveUi.js 视角设置、panelUi.js 状态面板、
//            player.js 玩家角色弹窗、memoryUi.js 记忆管理 + 存档点、
//            worldbookList.js 世界书列表页）
//  这个文件暂时还装着绝大部分功能，下面会一块一块搬出去。
//
//  拆的时候有两条约束，别踩：
//    · 依赖方向只能向下：core ← ui ← data ← views ← 入口
//    · 别让两个功能模块互相 import（防的是**循环**）。刷新总线已经就位
//      （views/refresh.js）：renderAll 不再挨个点名视图，谁想被重绘就在
//      registerRefreshListeners 里登记一次，拆 views 时把登记语句跟着搬进各自模块。
//      **要重绘用 refreshAll()，不要为了重绘去 import 别的视图模块。**
//      单向 import 一个「只依赖 core/data、不认识任何视图」的展示层是允许的
//      （例如 worldbookList 借 player 的弹窗）；视图需要入口层的动作时用注入
//      —— initXxx({ theAction })，由入口层把函数传进来。
// ============================================================================

import { CONFIG } from './core/config.js';
import { api } from './core/api.js';
import { state } from './core/state.js';
import { el } from './core/dom.js';
import { uid, now, activeConvo } from './core/util.js';
// 面板字段的类型/范围/变化规则。主进程 require('../../main/panel-fields.js')
// 加载的是同一个文件，所以「范围怎么夹」两边跑的是同一份代码。
// 那套「读 window.PanelFields」的桥在 core/panel-fields.js 里。
import {
  clampFieldValue,
  normalizePanelField,
  groupPanelFields,
  fieldProgress,
  describePanelField,
  parseNumericValue,
  trimNumber
} from './core/panel-fields.js';

import { showToast } from './ui/toast.js';
import { confirmDialog } from './ui/confirm.js';
import { applyTheme, toggleTheme } from './ui/theme.js';
import { esc, renderMarkdown } from './ui/markdown.js';
import { h, button, card, clear, renderListPage } from './ui/build.js';

import { persistConversations } from './data/persist.js';
import { reissueImportedIds } from './data/library-reissue.js';
import { providers, providerById, ensureConvoEndpoint, currentEndpoint } from './data/providers.js';
import {
  characters,
  characterById,
  characterForConvo,
  characterAttrs,
  worldbooks,
  worldbookById,
  worldbookCharacters,
  convoWorldbookIds
} from './data/library.js';
import {
  cleanAssistantText,
  convoPanel,
  convoPanelDefs,
  convoPanelFields,
  formatPanelForPrompt,
  normalizePanelDefs,
  panelFieldAllowed,
  seedIdentity,
  seedPanelFromCharacters,
  stripPanelLines,
  syncConvoPanel,
  syncPlayerNameFromPanel,
  OPTIONS_LABEL,
  OPTIONS_LINE_RE,
  MAX_PANEL_FIELDS
} from './data/panel.js';
import {
  DEFAULT_NARRATION_MODE,
  DEFAULT_PACE_MODE,
  gmRuleText,
  isGmMode,
  narrationInstruction,
  roleplayRuleText
} from './data/narration.js';
import {
  SUMMARY_TRIGGER_MESSAGES,
  SUMMARY_MIN_MESSAGES,
  MAX_SUMMARY_FAILURES,
  SUMMARY_RETRY_COOLDOWN_MS,
  convoSummaries,
  summarizedCount,
  nextSegmentTitle,
  formatSummaryForPrompt,
  buildTranscript,
  pendingSummaryRange,
  generateSummary,
  summarizingConvos,
  summaryFailures,
  charNameForSummary
} from './data/memory.js';
import { onRefresh, refreshAll } from './views/refresh.js';
import { renderHeader, initHeader } from './views/header.js';
import { initPerspectiveUi } from './views/perspectiveUi.js';
import {
  openPlayerModal,
  closePlayerModal,
  applyPlayerCharChoice,
  getPlayingBook
} from './views/player.js';
import { initMemoryUi, renderMemoryModal } from './views/memoryUi.js';
import { initPanelUi, renderPanel } from './views/panelUi.js';
import { initWorldbookList, renderWorldbookPage } from './views/worldbookList.js';

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
// 正在编辑的角色「自带世界书」开关。跟头像一样是草稿：改动先留在这里，
// 保存时才写回角色卡 —— 这样切换开关能立刻反映到界面上。
let charDraftWbEnabled = true;
// 「新建角色」做出来的草稿：它先只活在编辑器里，不进任何列表、也不写磁盘，
// 点了「保存角色」才真正被创建。关掉编辑器就等于放弃这次新建。
let charDraft = null; // { character, scope, bookId }
let editingWorldbookId = null; // 世界书弹窗里当前选中的世界书
let editingEntryId = null; // 当前正在编辑的条目

// ---------------------------------------------------------------------------
//  角色（角色扮演）
//  一张角色卡 = 角色名 + 设定 + 开场白 + 示例对话。
//  会话可以绑定一个角色；绑了角色的会话不再使用「设置」里的全局人设。
// ---------------------------------------------------------------------------

// 导入时重发 id 用的自增序号：同一毫秒里连导几次也不会撞车
let importSeq = 0;

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
  // 新建的草稿还没进任何列表，但编辑表单照样得能读写它
  if (charDraft && charDraft.character.id === id) return charDraft.character;
  return editorCharacterList().find((c) => c.id === id) || null;
}

/** 编辑器里现在放着的是一个还没保存的新角色吗？ */
function isCharDraft() {
  return !!charDraft && editingCharacterId === charDraft.character.id;
}

// --- 世界书 ---

/**
 * 扫一遍近期消息，把命中的世界书条目拼成注入块。
 * 匹配逻辑在主进程（那里才有书和角色数据），渲染层只负责拿结果。
 */
const WORLDBOOK_SCAN_DEPTH = 6;

/** 递归扫描最多连锁几层（设置里调，0 = 关掉递归） */
function recursiveDepthSetting() {
  const value = Number((state.settings || {}).worldbookRecursiveDepth);
  return Number.isFinite(value) && value >= 0 && value <= 5 ? Math.floor(value) : 3;
}

/**
 * 这次请求实际要注入哪些世界书。
 *
 * 规则（会话优先，且不合并）：
 *   · 会话绑了世界书（含「进入世界」）→ 只用会话的，角色自带的一律不带入。
 *     一条会话只有一个世界观，不会出现两套设定互相打架。
 *   · 会话没绑 → 才用角色自带的那几本（前提是这张卡的开关是开的）。
 *
 * 角色的开关（worldbookEnabled）关掉后，两种情况都不带入 ——
 * 这样无论单独聊天、还是被绑进某个世界当角色，这张卡都是干净的。
 */
function effectiveWorldbookIds(convo) {
  const convoIds = convoWorldbookIds(convo);
  if (convoIds.length) return convoIds;

  const character = characterForConvo(convo);
  if (!character) return [];
  if (character.worldbookEnabled === false) return [];

  return Array.isArray(character.worldbookIds) ? character.worldbookIds : [];
}

/**
 * 导入进来的东西要重新发一批 id（并改写角色 → 世界书的指向）。
 * 实现搬到了 data/library-reissue.js —— 那段逻辑以前在两个导入函数里各有一份，
 * 而且夹在弹窗和落盘之间，测不到；「绑定指到不存在的书」这个 bug 就是这么漏掉的。
 */
function reissueImported(books, chars) {
  importSeq += 1;
  return reissueImportedIds(books, chars, `${Date.now().toString(36)}-${importSeq}`);
}

async function matchWorldbookSection(convo) {
  const allIds = [...new Set(effectiveWorldbookIds(convo))];
  if (!allIds.length) return '';

  const history = convo.messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim()
  );

  try {
    const result = await api.previewWorldbook({
      worldbookIds: allIds,
      scanDepth: WORLDBOOK_SCAN_DEPTH,
      recursiveDepth: recursiveDepthSetting(),
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

/**
 * 应用内的确认弹窗（替代 window.confirm）。
 * 用系统原生 confirm 会有一个副作用：关掉它的那一下点击会被吞掉，
 * 之后点输入框要点两次才能聚焦，看起来就像「输入框点不动」。
 * 返回 Promise<boolean>。
 */

/** 保存历史会话（防抖，避免每敲一个字都写磁盘） */

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
//  渲染：会话列表、标题、消息
// ---------------------------------------------------------------------------

function renderConvoList() {
  clear(el.convoList);

  if (!state.conversations.length) {
    // 这两条内联样式是「空状态」专属的，没有别的用处（真要认真做该进样式表）
    const empty = h('div', { class: 'convo-title', text: '（还没有会话）' });
    empty.style.padding = '8px 9px';
    empty.style.color = 'var(--text-faint)';
    el.convoList.appendChild(empty);
    return;
  }

  for (const convo of state.conversations) {
    const label = convo.title || '新对话';

    el.convoList.appendChild(
      h(
        'div',
        {
          class: ['convo-item', convo.id === state.activeId && 'active'],
          role: 'listitem',
          onclick: () => switchConvo(convo.id)
        },
        h('span', { class: 'convo-title', text: label, title: label }),
        button({
          class: 'convo-del',
          text: '×',
          title: '删除这个会话',
          ariaLabel: `删除会话：${label}`,
          onClick: (event) => {
            event.stopPropagation();
            removeConvo(convo.id);
          }
        })
      )
    );
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

  // 角色卡上声明过「属性」和「身份四项」就种进状态面板 —— AI 第一轮就知道
  // 这个角色是谁、要维护哪些字段，不用等它自己碰巧输出一个「【金币】：100」
  // （漏了身份那四项时，模型不知道年龄，会把 16 岁写成 21 岁）
  seedIdentity(convo, next.name, next);
  seedPanelFromCharacters(convo, [next]);

  // 剧情选项：角色卡上开了就跟着这个会话生效。用的是**复制**而不是引用 ——
  // 之后改角色卡不该悄悄改掉正在进行的这一局。
  convo.optionsSpec = next.optionsSpec ? { ...next.optionsSpec } : null;
  if (!convo.optionsSpec) convo.options = [];

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

  // 候选切换（重新生成过才会有多个版本）。
  // 放在角色行而不是操作栏：操作栏是悬停才浮出的，那样就**看不出这条有几个版本**了。
  const variants = Array.isArray(message.variants) ? message.variants : null;
  if (!isUser && !isError && variants && variants.length > 1) {
    const at = Number.isFinite(message.variantIndex) ? message.variantIndex : 0;
    role.appendChild(
      h(
        'span',
        { class: 'variant-nav' },
        button({
          class: 'variant-btn',
          text: '‹',
          title: '上一条候选',
          ariaLabel: '上一条候选',
          onClick: () => switchVariant(index, -1)
        }),
        h('span', { class: 'variant-count', text: `${at + 1}/${variants.length}` }),
        button({
          class: 'variant-btn',
          text: '›',
          title: '下一条候选',
          ariaLabel: '下一条候选',
          onClick: () => switchVariant(index, 1)
        })
      )
    );
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
    // 气泡里也要剥掉「状态栏行」和「剧情选项行」：
    //   · 状态值已经由面板权威持有并在顶部常驻显示，正文里再来一份是重复的；
    //   · 选项已经变成可点的按钮了，原文留着只会吵。
    // （换候选时靠面板里的输入框看当前值，不靠正文。）
    content.innerHTML = renderMarkdown(
      cleanAssistantText(message.content, convoPanelFields(activeConvo()))
    );
  }

  // 图片放在文字上面 —— 先看图再看说话，跟聊天软件的习惯一致
  const imageBlock = buildMessageImages(message);
  if (imageBlock) bubble.appendChild(imageBlock);
  // 只带图没打字的，就不要留一个空段落了
  if (String(message.content || '').trim() || !imageBlock) bubble.appendChild(content);

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

    const edit = document.createElement('button');
    edit.className = 'mini-btn';
    edit.textContent = '编辑';
    edit.title = '直接改这条消息的内容';
    edit.setAttribute('aria-label', '编辑这条消息');
    edit.addEventListener('click', () => editMessage(index));
    actions.appendChild(edit);
  }

  if (!isUser) {
    const regen = document.createElement('button');
    regen.className = 'mini-btn';
    regen.textContent = isError ? '重试' : '重新生成';
    regen.title = isError ? '重新发送上一条消息' : '重新生成这条回复';
    regen.setAttribute('aria-label', isError ? '重新发送上一条消息' : '重新生成这条回复');
    regen.addEventListener('click', () => regenerateFrom(index));
    actions.appendChild(regen);

    // 「继续」只对最后一条有意义 —— 中间的回复后面早就接上别的话了
    const convo = activeConvo();
    const isLast = !!convo && index === convo.messages.length - 1;
    if (isLast && String(message.content || '').trim()) {
      const cont = document.createElement('button');
      cont.className = 'mini-btn';
      cont.textContent = '继续';
      cont.title = '让 AI 接着这条往下写（回复被截断时用）';
      cont.setAttribute('aria-label', '继续生成');
      cont.addEventListener('click', continueLastMessage);
      actions.appendChild(cont);
    }

    // 配图：只有配了生图才显示，免得点了才知道没配
    if (String(message.content || '').trim() && (state.settings || {}).imageProviderId) {
      const draw = document.createElement('button');
      draw.className = 'mini-btn';
      draw.textContent = '配图';
      draw.title = '用生图模型给这段配一张插画';
      draw.setAttribute('aria-label', '给这条回复配图');
      draw.addEventListener('click', () => illustrateMessage(index));
      actions.appendChild(draw);
    }

    // 帮我想想：卡住不知道说什么时，让 AI 给几个下一步让你挑
    if (isLast && String(message.content || '').trim()) {
      const suggest = document.createElement('button');
      suggest.className = 'mini-btn';
      suggest.textContent = '帮我想想';
      suggest.title = '让 AI 给几个下一步，点一下就直接发出去';
      suggest.setAttribute('aria-label', '让 AI 帮我想下一步');
      suggest.addEventListener('click', () => suggestNextActions(suggest));
      actions.appendChild(suggest);
    }
  }

  // 删除这一条消息（会先弹确认框）
  const del = document.createElement('button');
  del.className = 'mini-btn danger';
  del.textContent = '删除';
  del.title = '删除这条消息';
  del.setAttribute('aria-label', '删除这条消息');
  del.addEventListener('click', () => removeMessage(index));
  actions.appendChild(del);

  // 从这条分出一条新线：不动当前会话，另外复制一个出来
  if (!isError) {
    const branch = document.createElement('button');
    branch.className = 'mini-btn';
    branch.textContent = '分支';
    branch.title = '从这条起另开一个会话（当前这条线原样保留）';
    branch.setAttribute('aria-label', '从这条消息分支');
    branch.addEventListener('click', () => branchFromMessage(index));
    actions.appendChild(branch);
  }

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

/**
 * 全量重绘。这里**不再挨个点名视图** —— 具体画哪些由 views/refresh.js 的
 * 登记表决定（见 registerRefreshListeners）。以前这份名单焊死在这里，
 * 于是 renderAll 认识所有视图、谁改完数据都得认识它，
 * 那是「19 对分区互相调用」里最主要的来源。
 */
function renderAll(options) {
  // 建议是「针对某个会话的当前局面」给的 —— 换了会话就不该继续挂着
  const convoNow = activeConvo();
  if (suggestionsConvoId && suggestionsConvoId !== (convoNow ? convoNow.id : null)) {
    hideSuggestions();
  }

  refreshAll(options);
}

/** 停在图书区那两个列表页时也要跟着刷新（改名、删除、导入都会走到这里） */
function refreshLibraryPage() {
  if (currentView === 'chars') renderCharacterPage();
  else if (currentView === 'worldbooks') renderWorldbookPage();
}

/**
 * 登记「谁需要被重绘」。顺序 = 绘制顺序，和以前 renderAll 里的调用顺序一致。
 *
 * 这里是 views/ 拆分的接线板：功能搬进自己的文件之后，登记语句跟着搬过去 ——
 * 由那个模块导出的 initXxx() 在原位登记（下面带 → 注释的两行就是）。
 * 保持原位是为了绘制顺序和以前一致；各视图只写自己的 DOM 区域，
 * 顺序其实不影响结果，但没必要改。
 */
function registerRefreshListeners() {
  onRefresh(renderConvoList);
  initHeader(); // → onRefresh(renderHeader)
  onRefresh(renderModelSwitch);
  // 面板要「点选项 = 发一条消息」这个动作，而它属于入口层的编排
  // （动输入框、建议条、发送流程），所以由这里注入进去。
  initPanelUi({ pickOption }); // → onRefresh(syncPanelVisibilityForConvo) + onRefresh(renderPanel)
  initMemoryUi(); // → onRefresh(renderMemoryIndicator)
  onRefresh(renderMessages);
  onRefresh(refreshLibraryPage);
  // 世界书列表页要「点编辑 = 打开世界书编辑器」，而编辑器开关属于入口层的编排
  // （要设 editingWorldbookId，那是编辑器弹窗的状态）。所以注入进去。
  // 它自己不登记重绘 —— 列表页的重绘由上面的 refreshLibraryPage 按当前视图分发。
  initWorldbookList({ openEditor: editWorldbookFromPage });
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
    // 会话自己绑的世界书（「进入世界」走这里）。
    // 另有「角色自带的世界书」——那条路走 character.worldbookIds，
    // 两者由 effectiveWorldbookIds 决定用谁：会话绑了就只用会话的。
    worldbookIds: [],
    // 状态面板：fields 是出现过的字段顺序，panel 是当前值。
    // panelDefs 是字段的类型/范围/变化规则（可选，老会话没有这个键也照常工作）。
    // 世界模型开局通常是空的，第一条带面板的回复会自动填上。
    panel: {},
    panelFields: [],
    panelDefs: {},
    // 剧情选项：options 是这一轮模型给的可点选项（点完就清），
    // optionsSpec 是「每轮给几个 + 额外要求」，null = 这个会话不开剧情选项。
    options: [],
    optionsSpec: null,
    // 视角设置：叙述模式（标准/内心描写/上帝视角）、推进节奏、GM 模式
    narrationMode: DEFAULT_NARRATION_MODE,
    // 默认「一步一步」：不这样的话模型会一口气把整场戏演完，玩家只剩看的份
    paceMode: DEFAULT_PACE_MODE,
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

// 摘要的参数、纯逻辑、以及「运行态」（summarizingConvos / summaryFailures）
// 都在 data/memory.js 里；这里只留后台调度。
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
//  存档点 / 分支
//
//  两个都是「想走另一条剧情线」的手段，区别在**代价**：
//    · 分支：从某条消息另开一个会话，这个会话原样留着 —— 什么都不丢
//    · 存档点：在当前会话里存一份快照，读档 = 整个退回去 —— 存完之后聊的会没
//  所以界面上必须把这点说清楚，不然用户会以为读档也能反悔。
// ---------------------------------------------------------------------------

/**
 * 从某条消息分出一条新线。
 *
 * 做法是**另开一个会话，把前 N 条原样复制过去** —— 当前会话一个字节都不动。
 * 所以走岔了随时切回来，两边还能并排对比（侧栏里就是两条会话）。
 * 比真做消息树简单得多，也不会因为一次误操作丢掉整条线。
 */
function branchFromMessage(index) {
  const convo = activeConvo();
  if (!convo) return;
  if (state.streaming) {
    showToast('正在生成，等它写完再分支');
    return;
  }

  const cut = Math.max(0, Math.min(index, convo.messages.length - 1)) + 1;
  const id = uid();

  const branch = {
    id,
    title: `${convo.title || '新对话'}（分支）`,
    createdAt: now(),
    updatedAt: now(),
    // 戏本身的东西照搬：绑的角色、世界书、玩家、状态面板、视角设置
    characterId: convo.characterId || null,
    worldbookIds: [...convoWorldbookIds(convo)],
    gmMode: convo.gmMode === true,
    player: convo.player ? { ...convo.player } : null,
    panelFields: [...convoPanelFields(convo)],
    panel: { ...convoPanel(convo) },
    // 字段的范围/hint 也要跟着分叉走，否则新线的数值从此不再受约束
    panelDefs: JSON.parse(JSON.stringify(convoPanelDefs(convo))),
    // 剧情选项配置跟着走；这一轮的选项本身不搬（新线还没生成过）
    optionsSpec: convo.optionsSpec ? { ...convo.optionsSpec } : null,
    options: [],
    messages: JSON.parse(JSON.stringify(convo.messages.slice(0, cut))),
    // 摘要不搬：它压缩的是「最早那批消息」，而新会话里这批消息是原样留着的，
    // 搬过去等于同一段内容被记两遍。新线从零开始攒记忆。
    summaries: [],
    checkpoints: []
  };

  state.conversations.unshift(branch);
  state.activeId = id;
  persistConversations(0);
  renderAll({ forceScroll: true });
  showToast(`已分出一条新线（前 ${cut} 条照搬，原来那条没动）`, 'ok');
}

// ---------------------------------------------------------------------------
//  对话窗口外观（字号 / 加粗颜色 / 背景图）
//
//  这三样只影响「怎么显示」，一个字都不会进提示词。
//  实现上都是往 <html> 上写 CSS 变量，样式表里用 var() 取 ——
//  这样换主题、换背景都不用重写一套规则。
// ---------------------------------------------------------------------------

const CHAT_FONT_MIN = 12;
const CHAT_FONT_MAX = 22;
const CHAT_FONT_DEFAULT = 14;
// 没设自定义颜色时，色盘控件显示的主题色（只是给色盘一个初始值，不是生效值）
const BOLD_COLOR_FALLBACK = '#409eff';

/** 把当前设置里的外观写到 CSS 变量上（值空就删掉变量，退回样式表里的默认） */
function applyChatAppearance() {
  const s = state.settings || {};
  const root = document.documentElement;

  const size = Number(s.chatFontSize);
  const px = Number.isFinite(size) && size >= CHAT_FONT_MIN && size <= CHAT_FONT_MAX ? size : CHAT_FONT_DEFAULT;
  root.style.setProperty('--chat-font-size', `${px}px`);

  if (s.chatBoldColor) root.style.setProperty('--chat-bold-color', s.chatBoldColor);
  else root.style.removeProperty('--chat-bold-color');

  // dataURL 里不会出现引号，包一层更保险
  if (s.chatBackground) root.style.setProperty('--chat-bg-image', `url("${s.chatBackground}")`);
  else root.style.removeProperty('--chat-bg-image');
}

/** 滑块的「已选比例」是 CSS 渐变画的，所以值一变就得把 --range-fill 同步过去 */
function syncRangeFill() {
  const input = el.appearanceFontSize;
  if (!input) return;

  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const value = Number(input.value);
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  input.style.setProperty('--range-fill', `${pct}%`);
}

/** 外观面板里各控件的当前值（从内存里的设置读，不读 DOM —— 打开时要用它回填） */
function renderAppearanceForm() {
  const s = state.settings || {};

  const size = Number(s.chatFontSize);
  const px = Number.isFinite(size) && size >= CHAT_FONT_MIN && size <= CHAT_FONT_MAX ? Math.round(size) : CHAT_FONT_DEFAULT;
  el.appearanceFontSize.value = String(px);
  el.appearanceFontSizeValue.textContent = `${px}px`;
  syncRangeFill();

  el.appearanceBoldColorText.value = s.chatBoldColor || '';
  el.appearanceBoldColor.value = s.chatBoldColor || BOLD_COLOR_FALLBACK;

  const bg = s.chatBackground || '';
  el.appearanceBgPreview.innerHTML = '';
  if (bg) {
    const img = document.createElement('img');
    img.src = bg;
    img.alt = '';
    el.appearanceBgPreview.appendChild(img);
  }
  el.appearanceBgPreview.classList.toggle('hidden', !bg);
  el.btnClearBg.disabled = !bg;
}

/** 改一项外观：立刻生效 + 落盘 */
async function persistAppearance(patch) {
  state.settings = { ...(state.settings || {}), ...patch };
  applyChatAppearance();
  renderAppearanceForm();

  try {
    // 主进程会把不合法/超限的值洗掉，所以用它的返回值覆盖本地
    state.settings = await api.saveSettings(patch);
  } catch (err) {
    console.error('保存外观设置失败', err);
    showToast('外观没能保存到磁盘', 'error');
    return;
  }
  applyChatAppearance();
  renderAppearanceForm();
}

/**
 * 背景图先压到最长边 1920 再存。
 * 头像那套是「居中裁成正方形」，背景不能裁 —— 裁了就变形，所以只等比缩。
 */
function shrinkBackground(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      try {
        const max = 1920;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);

        // 背景图不需要透明，webp 有透明通道也不亏；压到 0.82 体积和观感比较平衡
        const out = canvas.toDataURL('image/webp', 0.82);
        resolve(out.startsWith('data:image/') ? out : dataUrl);
      } catch (err) {
        resolve(dataUrl);
      }
    };

    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function pickChatBackground() {
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

  showToast('正在压缩背景图…');
  const shrunk = await shrinkBackground(result.dataUrl);
  await persistAppearance({ chatBackground: shrunk });
  showToast('背景图已换上', 'ok');
}

/**
 * 文本框里可能是 #abc / #aabbcc / #aabbccdd，也可能带不带 #。
 * 认不出来就返回 null（调用方提示一下，不要静默丢掉）。
 */
function normalizeHexColor(text) {
  let t = String(text || '').trim();
  if (!t) return '';
  if (!t.startsWith('#')) t = `#${t}`;
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(t) ? t.toLowerCase() : null;
}

function openAppearanceModal() {
  renderAppearanceForm();
  el.appearanceModal.classList.remove('hidden');
}

function closeAppearanceModal() {
  el.appearanceModal.classList.add('hidden');
  el.input.focus();
}

// ---------------------------------------------------------------------------
//  导出
//
//  三种：角色卡（PNG / JSON）、世界书（JSON）、当前会话（Markdown）。
//  格式都对齐「导入」那条链路能读的形状，所以导出的东西能再导回来，
//  酒馆那边也认（角色卡是 v2 规范，世界书是 lorebook 规范）。
// ---------------------------------------------------------------------------

/** 文件名里不能出现的字符（Windows 最严），换成下划线 */
function safeFileName(name) {
  const base = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_');
  return base.slice(0, 60) || 'export';
}

/**
 * UTF-8 文本 → base64。
 * 不能用裸 btoa：它只吃 Latin-1，中文会直接抛错；先按 UTF-8 取字节再 base64。
 */
function base64Utf8(text) {
  const bytes = new TextEncoder().encode(String(text));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * 导出用的角色卡（酒馆 v2 规范）。
 * 自家多出来的字段（年龄/性别/种族/属性）塞进 extensions.barbara ——
 * 规范里 extensions 就是给各家放私有数据的，酒馆会原样保留，我们自己也能读回来。
 *
 * character_book：这张卡绑定的世界书（导入时自动绑上的那本）。
 * 导出时一起带走，别人拿到这张卡就能直接用上它的背景设定 ——
 * 酒馆也认这个字段，会当成「角色绑定的世界书」。
 */
function characterCardPayload(character) {
  // 只带第一本：v2 规范里 character_book 是单本（酒馆同样只导出主世界书）
  const boundId = Array.isArray(character.worldbookIds) ? character.worldbookIds[0] : null;
  const boundBook = boundId ? worldbookById(boundId) : null;

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: character.name || '',
      description: character.description || '',
      personality: character.personality || '',
      scenario: character.scenario || '',
      first_mes: character.firstMes || '',
      mes_example: character.mesExample || '',
      creator_notes: character.creatorNotes || '',
      system_prompt: character.systemPrompt || '',
      post_history_instructions: character.postHistoryInstructions || '',
      tags: Array.isArray(character.tags) ? character.tags : [],
      alternate_greetings: [],
      character_book: boundBook ? worldbookPayload(boundBook) : null,
      creator: '',
      character_version: '',
      extensions: {
        barbara: {
          age: character.age || '',
          gender: character.gender || '',
          race: character.race || '',
          attributes: characterAttrs(character),
          // 开关也带上：别人导入后拿到的状态跟你这边一致
          worldbookEnabled: character.worldbookEnabled !== false
        }
      }
    }
  };
}

/** 世界书导出成酒馆 lorebook 的形状（导入那边认的就是这个） */
function worldbookPayload(book) {
  const entries = {};
  (book.entries || []).forEach((entry, index) => {
    entries[String(index)] = {
      uid: index,
      comment: entry.title || '',
      key: Array.isArray(entry.keys) ? entry.keys : [],
      keysecondary: Array.isArray(entry.secondaryKeys) ? entry.secondaryKeys : [],
      content: entry.content || '',
      constant: entry.constant === true,
      selective: Array.isArray(entry.secondaryKeys) && entry.secondaryKeys.length > 0,
      selectiveLogic: entry.selectiveLogic || 'AND_ANY',
      order: Number.isFinite(entry.order) ? entry.order : 100,
      probability: Number.isFinite(entry.probability) ? entry.probability : 100,
      disable: entry.enabled === false,
      // 递归：写法两边都给 —— 酒馆认 excludeRecursion（true = 不参与递归），
      // 我们自己认 recursive。这样导出的书酒馆能用，我们自己再导回来也不丢这个开关。
      excludeRecursion: entry.recursive !== true,
      recursive: entry.recursive === true,
      matchWholeWords: entry.matchWholeWords === true,
      caseSensitive: entry.caseSensitive === true
    };
  });

  return { name: book.name || '未命名世界', description: book.description || '', entries };
}

/** 当前会话导出成 Markdown */
function conversationMarkdown(convo) {
  const lines = [];
  const character = characterForConvo(convo);
  const player = convoPlayer(convo);

  lines.push(`# ${convo.title || '对话'}`);
  lines.push('');
  const meta = [];
  if (character) meta.push(`角色：${character.name}`);
  if (player && player.name) meta.push(`我：${player.name}`);
  const book = convoWorldbookIds(convo)
    .map((id) => worldbookById(id))
    .find(Boolean);
  if (book) meta.push(`世界：${book.name}`);
  meta.push(`导出时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push(`> ${meta.join(' · ')}`);
  lines.push('');

  // 状态面板单独列一段：正文里那几行注入时会被剥掉，导出的快照留着更有用
  const panelFields = convoPanelFields(convo);
  const panel = convoPanel(convo);
  const filled = panelFields.filter((n) => String(panel[n] || '').trim());
  if (filled.length) {
    lines.push('## 当前状态');
    lines.push('');
    for (const name of filled) lines.push(`- ${name}：${panel[name]}`);
    lines.push('');
  }

  lines.push('## 对话');
  lines.push('');
  for (const message of convo.messages || []) {
    const content = String(message.content || '').trim();
    if (!content) continue;
    if (message.role === 'user') lines.push(`**${player && player.name ? player.name : userName()}：**`);
    else if (message.role === 'error') lines.push('**（出错了）**');
    else lines.push(`**${character ? character.name : speakerName(convo)}：**`);
    lines.push('');
    lines.push(content);
    lines.push('');
  }

  return lines.join('\n');
}

/** 角色头像 → PNG 数据（没有头像就画一张带首字母的占位图） */
function avatarPngDataUrl(character) {
  return new Promise((resolve) => {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const placeholder = () => {
      ctx.fillStyle = '#4a86e8';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 ${Math.round(size * 0.42)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((character.name || '?').slice(0, 1), size / 2, size / 2 + 8);
      resolve(canvas.toDataURL('image/png'));
    };

    if (!character.avatar) {
      placeholder();
      return;
    }

    const img = new Image();
    img.onload = () => {
      try {
        const side = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        const out = canvas.toDataURL('image/png');
        if (out.startsWith('data:image/png')) resolve(out);
        else placeholder();
      } catch (err) {
        placeholder();
      }
    };
    img.onerror = placeholder;
    img.src = character.avatar;
  });
}

/** 统一的导出收尾：调保存框、报结果 */
async function saveExport(payload) {
  let result;
  try {
    result = await api.saveFile(payload);
  } catch (err) {
    showToast((err && err.message) || '导出失败', 'error');
    return;
  }

  if (!result || result.canceled) return;
  if (result.error) {
    showToast(`没能写出文件：${result.error}`, 'error');
    return;
  }
  showToast('已导出到磁盘', 'ok');
}

/** 导出当前编辑的角色卡：存 .png 就是带数据的酒馆卡，存 .json 就是纯数据 */
async function exportCharacter() {
  const character = editorCharacterById(editingCharacterId);
  if (!character) return;

  const name = safeFileName(character.name);
  const json = JSON.stringify(characterCardPayload(character), null, 2);
  const png = await avatarPngDataUrl(character);

  await saveExport({
    title: '导出角色卡',
    fileName: `${name}.png`,
    filters: [
      { name: 'PNG 角色卡（带数据，酒馆可直接导入）', extensions: ['png'] },
      { name: 'JSON 角色卡（纯数据，方便改）', extensions: ['json'] }
    ],
    text: json,
    base64: String(png).split(',')[1] || '',
    pngText: { keyword: 'chara', text: base64Utf8(json) }
  });
}

/** 导出当前编辑的世界书 */
async function exportWorldbook() {
  const book = currentWorldbook();
  if (!book) return;

  await saveExport({
    title: '导出世界书',
    fileName: `${safeFileName(book.name)}.json`,
    filters: [{ name: '世界书 JSON（酒馆可直接导入）', extensions: ['json'] }],
    text: JSON.stringify(worldbookPayload(book), null, 2)
  });
}

/** 导出当前会话为 Markdown */
async function exportConversation() {
  const convo = activeConvo();
  if (!convo || !(convo.messages || []).length) {
    showToast('当前会话还是空的', 'error');
    return;
  }

  await saveExport({
    title: '导出对话',
    fileName: `${safeFileName(convo.title || '对话')}.md`,
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: '纯文本', extensions: ['txt'] }
    ],
    text: conversationMarkdown(convo)
  });
}

// ---------------------------------------------------------------------------
//  给 AI 看图
//
//  图片跟着**用户消息**走：message.images = [dataURL, ...]。
//  发请求时把这条消息的 content 从字符串换成多模态数组
//   （[{type:'text'},{type:'image_url'}...]），这是 OpenAI 那套的通用写法。
//
//  模型得**自己支持视觉**才行 —— 这不需要另外接一个模型，但文本模型收到图会报错。
//  所以这里不做拦截（拦了用户会莫名其妙找不到按钮），而是失败了再给一句明确提示。
// ---------------------------------------------------------------------------

// 一张图最长边压到多少再发。视觉模型内部一般也就缩到这个量级，
// 传原图只是白烧 token 和流量
const CHAT_IMAGE_MAX_EDGE = 1024;
// 单张压完之后的体积上限（base64 字符数）。超了就再压一档
const CHAT_IMAGE_MAX_CHARS = 1600000;
// 一条消息最多带几张
const CHAT_IMAGE_MAX_COUNT = 6;

// 输入框里待发送的图片
let pendingImages = [];

/**
 * 聊天图片压缩：等比缩到最长边 1024，再转 webp。
 * 和背景图那套一样只缩不裁（裁了内容就变了）。
 */
function shrinkChatImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      try {
        const scale = Math.min(1, CHAT_IMAGE_MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);

        // 先按 0.82 压；还是太大就降到 0.6 —— 宁可糊一点也别把请求撑爆
        let out = canvas.toDataURL('image/webp', 0.82);
        if (!out.startsWith('data:image/')) {
          out = canvas.toDataURL('image/jpeg', 0.85);
        }
        if (out.length > CHAT_IMAGE_MAX_CHARS && out.startsWith('data:image/webp')) {
          out = canvas.toDataURL('image/webp', 0.6);
        }
        resolve(out.startsWith('data:image/') ? out : dataUrl);
      } catch (err) {
        resolve(dataUrl);
      }
    };

    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** 收下一张图：压缩 → 进待发列表 → 重画 */
async function addPendingImage(dataUrl) {
  if (!dataUrl) return;

  if (pendingImages.length >= CHAT_IMAGE_MAX_COUNT) {
    showToast(`一条消息最多带 ${CHAT_IMAGE_MAX_COUNT} 张图`, 'error');
    return;
  }

  const shrunk = await shrinkChatImage(dataUrl);
  pendingImages.push(shrunk);
  renderAttachStrip();
}

/** 点「加图」：走主进程的文件选择框 */
async function pickChatImages() {
  let result;
  try {
    result = await api.pickImage({ title: '选择要发给 AI 的图片' });
  } catch (err) {
    showToast((err && err.message) || '选择图片失败', 'error');
    return;
  }

  if (!result || result.canceled) return;
  if (!result.dataUrl) {
    showToast(result.error || '这张图用不了', 'error');
    return;
  }
  await addPendingImage(result.dataUrl);
}

/** 把剪贴板 / 拖进来的一批文件变成图片收下 */
async function addImageFiles(files) {
  const images = Array.from(files || []).filter((f) => f && String(f.type || '').startsWith('image/'));
  if (!images.length) return false;

  for (const file of images) {
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
    await addPendingImage(dataUrl);
  }
  return true;
}

function renderAttachStrip() {
  clear(el.attachStrip);
  el.attachStrip.classList.toggle('hidden', !pendingImages.length);

  pendingImages.forEach((src, index) => {
    const thumb = h('div', { class: 'attach-item' }, h('img', { src, alt: '' }));
    thumb.appendChild(
      button({
        class: 'attach-del',
        text: '×',
        title: '不发了',
        ariaLabel: `移除第 ${index + 1} 张图`,
        onClick: () => {
          pendingImages.splice(index, 1);
          renderAttachStrip();
        }
      })
    );
    el.attachStrip.appendChild(thumb);
  });
}

/** 消息气泡里的图（用户发的 + 以后 AI 生成的都走这里） */
function messageImages(message) {
  return Array.isArray(message.images) ? message.images.filter((s) => typeof s === 'string' && s) : [];
}

function buildMessageImages(message) {
  const images = messageImages(message);
  if (!images.length) return null;

  const wrap = h('div', { class: 'bubble-images' });
  for (const src of images) {
    // 点开看大图：直接 window.open 会被 CSP 拦，交给主进程弹一个窗口
    wrap.appendChild(
      h('img', {
        class: 'bubble-image',
        src,
        alt: '图片',
        title: '点开看大图',
        onclick: () => api.openImage(src).catch(() => showToast('打不开这张图', 'error'))
      })
    );
  }
  return wrap;
}

/**
 * 给某条 AI 回复配一张插画。
 *
 * 用的是**生图那一组独立配置**（服务商 + 模型），和聊天模型无关 ——
 * 换生图模型不会影响这段对话的风格。
 *
 * 提示词直接取这条回复的正文（剥掉状态栏那几行），截一段给模型。
 */
async function illustrateMessage(index) {
  const convo = activeConvo();
  if (!convo) return;
  if (state.streaming) {
    showToast('正在生成，等它写完再配图');
    return;
  }

  const message = convo.messages[index];
  if (!message || message.role !== 'assistant') return;

  const settings = state.settings || {};
  if (!settings.imageProviderId) {
    showToast('还没有配置生图，请到「设置 → 生图」里选一个服务商', 'error');
    openSettings();
    return;
  }

  const panelFields = convoPanelFields(convo);
  const raw = cleanAssistantText(String(message.content || ''), panelFields);
  // 去掉 markdown 标记和括号里的旁白符号，让提示词更像一句画面描述
  const prompt = raw
    .replace(/\*\*|==|~~|[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800);

  if (!prompt) {
    showToast('这条回复没有可用来配图的文字', 'error');
    return;
  }

  const node = el.messages.querySelector(`.msg[data-index="${index}"]`);
  if (node) node.classList.add('illustrating');

  showToast('正在画…（可能要等十几秒）');

  try {
    const result = await api.generateImage({
      providerId: settings.imageProviderId,
      model: settings.imageModel,
      size: settings.imageSize,
      prompt
    });

    if (!result || result.ok !== true) {
      throw new Error((result && result.error) || '生图失败');
    }

    // 生成的图（PNG 通常一两 MB）先压一档再存进会话，
    // 不然几张图就能把 conversations.json 撑到几十 MB
    const shrunk = await shrinkChatImage(result.dataUrl);
    if (!Array.isArray(message.images)) message.images = [];
    message.images.push(shrunk);
    message.imageModel = result.model || settings.imageModel;

    convo.updatedAt = now();
    persistConversations(0);
    renderAll({ forceScroll: false });
    showToast('画好了', 'ok');
  } catch (err) {
    showToast((err && err.message) || '生图失败', 'error');
  } finally {
    if (node) node.classList.remove('illustrating');
  }
}

// ---------------------------------------------------------------------------
//  语义检索（RAG）
//
//  关键词匹配的死角：你写了「十二泰坦」的设定，但对话里说的是「那些神」——
//  那条设定就永远出不来。语义检索按「意思」把相关的旧内容和设定捞回来。
//
//  配置是独立的一组（服务商 + 模型，走 /embeddings），和聊天、生图都不相干。
// ---------------------------------------------------------------------------

// 一次最多带几条进来。多了会挤掉真正最近的内容，而且 token 哗哗涨
const RAG_TOP_K = 4;
// 相似度门槛。语义检索最怕「硬凑」——不管相不相关都塞几条进来，
// 上下文被污染了还不如不检索
const RAG_MIN_SCORE = 0.32;
// 拿最近几条拼查询。只用最后一条太窄（比如「嗯」这种），太多又会把主题冲淡
const RAG_QUERY_TURNS = 3;

/** 把捞回来的东西拼成注入块 */
function formatRagSection(items, character, me) {
  if (!items || !items.length) return '';

  const lines = items.map((item) => {
    if (item.kind === 'worldbook') {
      return `【设定 · ${item.title || '未命名'}】\n${applyMacros(item.text, character, me)}`;
    }
    const who = item.role === 'user' ? me : (character && character.name) || '对方';
    return `【早先 · ${who}】\n${applyMacros(item.text, character, me)}`;
  });

  return (
    '[可能相关的往事]\n' +
    '下面这些是更早的内容或设定，和现在聊的有关，可以用来保持前后一致。' +
    '自然地用，不要直接复述：\n\n' +
    lines.join('\n\n')
  );
}

/** 跑一次检索，拿到可以注入的那一段（失败就返回空字符串，绝不拦着聊天） */
async function recallSection(convo) {
  const settings = state.settings || {};
  if (settings.ragEnabled !== true || !settings.embeddingProviderId) return '';

  const history = (convo.messages || []).filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim()
  );
  if (history.length < 2) return '';

  const recent = history.slice(-RAG_QUERY_TURNS);
  const query = recent.map((m) => String(m.content)).join('\n');

  try {
    const result = await api.ragRecall({
      providerId: settings.embeddingProviderId,
      model: settings.embeddingModel,
      convoId: convo.id,
      // 和关键词注入用同一套规则，否则两处会给出不一致的世界书范围
      worldbookIds: effectiveWorldbookIds(convo),
      // 最近这些本来就会进上下文，别捞回来占位置
      recentCount: RAG_QUERY_TURNS * 2,
      query,
      topK: RAG_TOP_K,
      minScore: RAG_MIN_SCORE
    });

    if (!result || result.ok !== true) {
      console.error('语义检索失败', result && result.error);
      return '';
    }
    return formatRagSection(result.items, characterForConvo(convo), convoUserName(convo));
  } catch (err) {
    console.error('语义检索失败', err);
    return '';
  }
}

// ---------------------------------------------------------------------------
//  帮我想想：给玩家几个下一步让他挑
//
//  卡住不知道说什么，是长对话里最常见的体验问题。这里让模型基于当前局面
//  给几个「玩家可以怎么接」的具体选项，点一下就当玩家的话发出去。
//
//  提示词刻意保持中性：只要求「贴当前局面、彼此不同、是玩家视角的动作或话」，
//  不涉及内容尺度 —— 写成什么样由模型自己决定。
// ---------------------------------------------------------------------------

// 一次给几个选项
const SUGGEST_COUNT = 4;
// 单个选项的字数上限，免得点下去变成一大段
const MAX_SUGGEST_CHARS = 120;
// 当前建议属于哪个会话 —— 切走时要清掉
let suggestionsConvoId = null;

function suggestInstruction() {
  return (
    '请基于上面这段对话，替「玩家」想几个接下来可以怎么做 / 怎么说的选项。\n' +
    '\n' +
    '要求：\n' +
    `1. 给 ${SUGGEST_COUNT} 个，每一个都要贴着当前局面，不要泛泛而谈。\n` +
    '2. 每个选项要明显不同 —— 可以是不同的态度、不同的做法、或者不同的对象，\n' +
    '   不要四个都是同一件事的不同说法。\n' +
    '3. 用玩家第一人称，写他实际会说的话或会做的动作，\n' +
    `   每条控制在一句话内（不超过 ${MAX_SUGGEST_CHARS} 字），不要写成小作文。\n` +
    '4. 直接输出选项本身，不要序号、不要引号、不要解释、不要标题。\n' +
    '5. 每行一个。'
  );
}

/** 从模型回复里解析出选项：一行一个，容忍它带了序号或引号 */
function parseSuggestions(text) {
  const lines = String(text || '').split('\n');
  const out = [];

  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;

    // 容忍「1. 」「1、」「- 」「• 」这类前缀
    line = line.replace(/^[-*•·]\s*/, '').replace(/^\d+\s*[.、)）:：]\s*/, '');
    // 容忍整行被引号包起来
    line = line.replace(/^[「『"'“”‘’]+/, '').replace(/[」』"'“”‘’]+$/, '').trim();

    if (!line) continue;
    if (line.length > MAX_SUGGEST_CHARS) line = `${line.slice(0, MAX_SUGGEST_CHARS)}…`;

    if (!out.includes(line)) out.push(line);
    if (out.length >= SUGGEST_COUNT) break;
  }

  return out;
}

function hideSuggestions() {
  el.suggestStrip.classList.add('hidden');
  el.suggestList.innerHTML = '';
  suggestionsConvoId = null;
}

// ---------------------------------------------------------------------------
//  剧情选项（每轮由模型给出、玩家点一下就当作回复发出去）
//
//  和上面「帮我想想」的区别：
//    · 帮我想想 是**额外发一次请求**，一次性给几个建议，不算常驻功能；
//    · 剧情选项 是**面板的一部分** —— 跟状态栏一起在正文里输出，不用多发请求，
//      每轮都更新，选项常驻在面板里。
//
//  选项为什么不做成普通面板字段（【剧情选项】：A / B / C）：
//  面板字段的值是「一个字符串」，而选项是**可变长的列表**，还要逐个变成按钮。
//  塞进字段里就得再切一次、还得处理玩家手改这种字段的边界情况，不如单独一条
//  指令 + 单独的解析（下面这段），语义清楚也不互相干扰。
// ---------------------------------------------------------------------------

// 选项行的标记（OPTIONS_LABEL / OPTIONS_LINE_RE）在 data/panel.js 里 ——
// 「剥掉选项行」和「剥掉状态栏行」是同一件事，两边的解析放在一起。
// 一条选项最多多少字 —— 点下去要当消息发出去，不能变成小作文
const MAX_OPTION_CHARS = 120;
// 一屏最多几个（模型给多了会挤爆面板）
const MAX_OPTIONS = 6;

/** 当前会话要不要每轮出剧情选项（存在会话上，跟面板走） */
function convoOptionsSpec(convo) {
  const spec = convo && convo.optionsSpec;
  if (!spec || typeof spec !== 'object') return null;
  const count = Math.max(1, Math.min(MAX_OPTIONS, Math.round(Number(spec.count) || 3)));
  return { count, hint: String(spec.hint || '').trim().slice(0, 200) };
}

/**
 * 从模型回复里抽选项。
 * 只认**最后一段**「【剧情选项】：」—— 模型有时会先说一遍再重写，
 * 取最后的才是最终答案。返回空数组表示这轮没给（那就保持上一轮的）。
 */
function extractOptionsFromText(text) {
  const lines = String(text || '').split('\n');
  let tail = null;

  for (const raw of lines) {
    const m = raw.trim().match(OPTIONS_LINE_RE);
    if (m) tail = m[1];
  }
  if (tail === null) return [];

  const out = [];
  // 只认「/」「｜」这类**明确的分隔符**。
  // 不能拿顿号/逗号来切 —— 选项本身就是中文句子，里面天然带「，」，
  // 一切就把「我想先喝一杯，压压惊」拆成两条没头没尾的碎片（实测踩过）。
  for (const piece of tail.split(/[\/｜|]/)) {
    let item = piece.trim();
    if (!item) continue;
    // 容忍「1. 」「① 」「- 」这类前缀和包在引号里
    item = item.replace(/^[-*•·]\s*/, '').replace(/^\d+\s*[.、)）:：]\s*/, '').replace(/^[①-⑳]\s*/, '');
    item = item.replace(/^[「『"'“”‘’]+/, '').replace(/[」』"'“”‘’]+$/, '').trim();
    if (!item) continue;
    if (item.length > MAX_OPTION_CHARS) item = `${item.slice(0, MAX_OPTION_CHARS)}…`;
    if (!out.includes(item)) out.push(item);
    if (out.length >= MAX_OPTIONS) break;
  }

  return out;
}

/** 注入给模型的选项指令（有配置时才注入） */
function optionsInstruction(convo) {
  const spec = convoOptionsSpec(convo);
  if (!spec) return '';

  const lines = [
    '【剧情选项】',
    `在正文和状态栏之后，另起一行，用「${OPTIONS_LABEL}：A / B / C」的格式给出 ${spec.count} 个选项，` +
      '每个选项之间用「 / 」隔开（就这一行，不要编号、不要再分多行）。',
    '每个选项是玩家接下来可以**直接说出口或做出来**的动作/台词，用玩家第一人称，' +
      `每条一句话以内（不超过 ${MAX_OPTION_CHARS} 字）。`,
    '选项之间要明显不同（不同的态度、做法或对象），不要是同一件事的不同说法。'
  ];
  if (spec.hint) lines.push(`额外要求：${spec.hint}`);
  return lines.join('\n');
}

/**
 * 把最近一条带选项的回复里的选项同步到会话上。
 *
 * 规则：
 *   · 找到**最近**一条提到选项的助手消息就用它 —— 和状态栏一样「最新一轮说了算」；
 *   · 一条都没有就清空（这轮没给，就别把上一轮的旧选项留在面板上误导玩家）；
 *   · 没开剧情选项的会话直接清空并返回。
 * 返回是否发生了变化。
 */
function syncConvoOptions(convo) {
  if (!convo || !Array.isArray(convo.messages)) return false;

  const before = JSON.stringify(convo.options || []);
  let found = null;

  if (convoOptionsSpec(convo)) {
    for (let i = convo.messages.length - 1; i >= 0; i -= 1) {
      const msg = convo.messages[i];
      if (!msg || msg.role !== 'assistant') continue;
      const content = String(msg.content || '');
      if (!content.includes(OPTIONS_LABEL)) continue;
      const items = extractOptionsFromText(content);
      if (items.length) {
        found = items;
        break;
      }
    }
  }

  convo.options = found || [];
  return before !== JSON.stringify(convo.options);
}

/** 玩家点了某个剧情选项：当作他说了这句话发出去 */
function pickOption(convo, text) {
  if (!convo || !text) return;
  if (state.streaming) {
    showToast('正在生成，等它写完再选');
    return;
  }
  // 用过就清掉 —— 它是「这一轮的选项」，点完就该消失，不能留着重复点
  convo.options = [];
  hideSuggestions();
  renderPanel();
  el.input.value = text;
  autoGrowInput();
  sendMessage(text);
}

function renderSuggestions(options) {
  el.suggestList.innerHTML = '';

  if (!options || !options.length) {
    hideSuggestions();
    return;
  }

  const convo = activeConvo();
  suggestionsConvoId = convo ? convo.id : null;

  options.forEach((text) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'suggest-btn';
    btn.textContent = text;
    btn.title = '点一下，就当你说这句话发出去';
    btn.addEventListener('click', () => {
      if (state.streaming) {
        showToast('正在生成，等它写完再用');
        return;
      }
      hideSuggestions();
      el.input.value = text;
      autoGrowInput();
      sendMessage(text);
    });
    el.suggestList.appendChild(btn);
  });

  el.suggestStrip.classList.remove('hidden');
}

/** 点「帮我想想」：要几个选项，渲染成按钮 */
async function suggestNextActions(trigger) {
  const convo = activeConvo();
  if (!convo) return;

  if (state.streaming) {
    showToast('正在生成，等它写完再想');
    return;
  }

  const endpoint = ensureConvoEndpoint(convo);
  if (!endpoint) {
    showToast('还没有配置模型服务', 'error');
    return;
  }

  const history = convo.messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim()
  );
  if (!history.length) {
    showToast('还没有对话内容，先聊两句', 'error');
    return;
  }

  const label = trigger || null;
  const originalText = label ? label.textContent : '';
  if (label) {
    label.disabled = true;
    label.textContent = '在想…';
  }

  try {
    // 只带最近几轮，够模型判断局面就行，不用把整段历史塞进去
    const recent = history.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    recent.push({ role: 'user', content: suggestInstruction() });

    const response = await api.sendChat({
      requestId: `suggest-${uid()}`,
      providerId: endpoint.provider.id,
      model: endpoint.model,
      messages: recent
    });

    if (!response || response.ok !== true) {
      throw new Error((response && response.error) || '想不出来');
    }

    const options = parseSuggestions(response.content);
    if (!options.length) {
      showToast('这次没想出可用的选项，再点一次试试', 'error');
      return;
    }

    renderSuggestions(options);
  } catch (err) {
    showToast((err && err.message) || '想不出来，稍后再试', 'error');
  } finally {
    if (label) {
      label.disabled = false;
      label.textContent = originalText || '帮我想想';
    }
  }
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
function buildApiMessages(convo, worldbookSection, ragSection) {
  const settings = state.settings || {};
  const character = characterForConvo(convo);
  // 进了世界的会话用玩家自己创建的角色名，其它会话用设置里的名字
  const me = convoUserName(convo);
  const charName = (character && character.name) || '昔涟';
  const gmMode = isGmMode(convo);

  // 注意：调用时对话末尾通常刚 push 了一条空的 assistant 占位消息（用来填空），
  // 必须把它过滤掉，否则会发给接口一条 content 为空的消息，严格的接口会直接报 400。
  // 但**只带图不打字**的用户消息要留下 —— 它没有文字却是有内容的。
  const history = convo.messages.filter(
    (m) =>
      (m.role === 'user' || m.role === 'assistant') &&
      (String(m.content || '').trim() || messageImages(m).length)
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
    // 身份：年龄/性别/种族是「这个人是谁」的一部分，一开始就得说清楚。
    // 光靠状态面板不够 —— 面板可能被重置、老会话也没有这些字段，
    // 模型不知道就只能自己编（实测：16 岁的角色被回复成 21 岁）。
    const identity = [];
    if (character.age) identity.push(`年龄 ${character.age}`);
    if (character.gender) identity.push(`性别 ${character.gender}`);
    if (character.race) identity.push(`种族 ${character.race}`);
    if (identity.length) parts.push(`【${charName}的基本信息】\n${identity.join('，')}`);

    if (character.description) parts.push(`【${charName}的设定】\n${applyMacros(character.description, character, me)}`);
    if (character.personality) parts.push(`【${charName}的性格】\n${applyMacros(character.personality, character, me)}`);
    if (character.scenario) parts.push(`【当前场景】\n${applyMacros(character.scenario, character, me)}`);
  }

  // GM 模式换掉那段「不要跳出角色」：世界模型必须能写第三人称、切多个 NPC 视角，
  // 被「始终以第一人称」捆着会一轮缩回单角色腔调。
  // 两种规则里都带上了「推进节奏」—— 否则模型会一口气把整场戏演完，玩家只剩看的份。
  const ruleText = gmMode ? gmRuleText(charName, me, convo) : roleplayRuleText(charName, me, convo);
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

  // ---- 2.2 语义检索捞回来的往事 / 设定 ----
  // 紧跟在世界书后面：都是「参考背景」，而且都是可选的（捞不到就什么都不加）
  if (String(ragSection || '').trim()) {
    messages.push({ role: 'system', content: String(ragSection).trim() });
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
    const raw = applyMacros(m.content, character, me);
    const text = m.role === 'assistant' ? cleanAssistantText(raw, panelFields) : raw;
    const images = messageImages(m);

    // 带图的用户消息要发成多模态数组 —— 这是 OpenAI 那套的通用写法，
    // 别的家（Claude / Gemini 的兼容层）一般也认。
    if (images.length && m.role === 'user') {
      const parts = [];
      // 有的接口不接受空 text 段，所以只有真有字才加
      if (String(text).trim()) parts.push({ type: 'text', text });
      for (const url of images) parts.push({ type: 'image_url', image_url: { url } });
      messages.push({ role: 'user', content: parts });
      continue;
    }

    messages.push({ role: m.role, content: text });
  }

  // ---- 5. 面板状态：紧贴对话历史之后，权重很高 ----
  // 放在这里而不是塞进历史，是因为历史会被 maxTurns 截断 ——
  // 面板一旦被截出去，模型就开始凭感觉编数值。
  const panelText = formatPanelForPrompt(convo);
  if (panelText) messages.push({ role: 'system', content: panelText });

  // ---- 5b. 剧情选项：和面板同一批（都是「这轮要维护的状态」）----
  // 只在这张卡/这个会话开了剧情选项时才注入。
  const optionsText = optionsInstruction(convo);
  if (optionsText) messages.push({ role: 'system', content: optionsText });

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
  // 只带图不写字也算一条消息 —— 问「这是什么」不一定非要打字
  const images = pendingImages.slice();
  if (!content && !images.length) return;

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
    convo.title = content.slice(0, 24) || (images.length ? '（图片）' : '新对话');
  }

  const message = { role: 'user', content, at: now() };
  if (images.length) message.images = images;
  convo.messages.push(message);

  // 图发出去了就清掉，免得下一条又带上
  pendingImages = [];
  renderAttachStrip();

  convo.updatedAt = now();
  state.usage = null;
  renderAll({ forceScroll: true });
  persistConversations();

  await requestCompletion(convo);
}

/**
 * 就地编辑一条消息：把气泡内容换成 textarea，保存/取消。
 *
 * 以前改个错字只能「删除 → 重发」，而重发会换一整条新回复。
 * 这里直接改原文，改完接着聊，历史也就跟着变了（发出去的是改后的版本）。
 */
function editMessage(index) {
  const convo = activeConvo();
  if (!convo || state.streaming) return;

  const message = convo.messages[index];
  if (!message || message.role === 'error') return;

  const node = el.messages.querySelector(`.msg[data-index="${index}"] .msg-content`);
  const bubble = node ? node.parentElement : null;
  if (!node || !bubble) return;

  const original = String(message.content || '');

  const textarea = h('textarea', {
    class: 'msg-edit-box',
    spellcheck: 'false',
    'aria-label': '编辑消息内容'
  });
  textarea.value = original;

  const finish = (save) => {
    if (save) {
      const next = textarea.value;
      if (!next.trim()) {
        showToast('内容不能为空 —— 想删掉这条就用「删除」', 'error');
        textarea.focus();
        return;
      }
      message.content = next;
      // 这条要是正好是「某一条候选」，改动要落回它那个槽里，
      // 否则切走再切回来就变回老样子了
      if (Array.isArray(message.variants) && Number.isFinite(message.variantIndex)) {
        message.variants[message.variantIndex] = next;
      }
      convo.updatedAt = now();
      // 助手消息里可能写着状态栏，改完要重新扫一遍面板
      if (message.role === 'assistant') syncConvoPanel(convo);
      if (message.role === 'assistant') syncConvoOptions(convo);
      if (message.role === 'assistant') syncPlayerNameFromPanel(convo);
      persistConversations(0);
      showToast('已保存', 'ok');
    }
    // 保存或取消都靠重绘来收拾现场
    renderAll({ forceScroll: false });
  };

  const save = button({ class: 'btn btn-primary btn-sm', text: '保存', onClick: () => finish(true) });
  const cancel = button({ class: 'btn btn-ghost btn-sm', text: '取消', onClick: () => finish(false) });

  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      finish(true);
    }
  });

  clear(node);
  node.appendChild(textarea);
  node.appendChild(h('div', { class: 'msg-edit-actions' }, save, cancel));

  textarea.focus();
  // 光标放到末尾，接着改最顺手
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  // 编辑框比原来的气泡高，展开后可能把「保存 / 取消」顶到视口外面去。
  // 注意要滚**整个内容块**（node）：只滚 textarea 的话，它自己已经完整可见了，
  // scrollIntoView 按规范就该什么都不做 —— 被切掉的其实是它下面那行按钮。
  node.scrollIntoView({ block: 'nearest' });
}

/** 「继续」时追加在提示词末尾的引导。只进这一次请求，不存进会话 */
const CONTINUE_NUDGE = '（接着你上一条回复继续往下写。不要重复已经写过的内容，也不要重新开头。）';

/**
 * 「继续」：让模型接着最后一条回复往下写（回复被 maxTokens 截断时用）。
 *
 * 省事的地方在于**不新建消息**：流式分片本来就是「把增量加到 messages 里最后一条、
 * 再画到它的节点上」，所以只要不加新消息，它自然就续写在原文后面了。
 */
async function continueLastMessage() {
  const convo = activeConvo();
  if (!convo) return;
  if (state.streaming) {
    showToast('正在生成，等它写完再继续');
    return;
  }

  const last = convo.messages[convo.messages.length - 1];
  if (!last || last.role !== 'assistant' || !String(last.content || '').trim()) {
    showToast('只能在 AI 的回复后面接着写', 'error');
    return;
  }

  const endpoint = ensureConvoEndpoint(convo);
  if (!endpoint) {
    showToast('还没有配置模型服务', 'error');
    return;
  }

  const worldbookSection = await matchWorldbookSection(convo);
  const ragSection = await recallSection(convo);
  const requestId = uid();
  state.requestId = requestId;

  const messages = buildApiMessages(convo, worldbookSection, ragSection);
  messages.push({ role: 'user', content: CONTINUE_NUDGE });

  const index = convo.messages.length - 1;
  const bubble = el.messages.querySelector(`.msg[data-index="${index}"] .bubble`);
  if (bubble) bubble.classList.add('streaming');

  const before = String(last.content || '');
  setStreaming(true);

  try {
    const response = await api.sendChat({
      requestId,
      providerId: endpoint.provider.id,
      model: endpoint.model,
      messages
    });

    if (!response || response.ok !== true) {
      throw new Error((response && response.error) || '调用失败');
    }
    if (response.usage) state.usage = response.usage;

    // 有的服务商不推流式分片，直接给全文 —— 那种情况分片处理器一次都没跑过，
    // 这里补一次追加（正文没变就说明没收到过分片）
    if (String(last.content || '') === before && String(response.content || '').trim()) {
      last.content = before + response.content;
    }
  } catch (err) {
    showToast((err && err.message) || '继续失败', 'error');
  } finally {
    streamPainter.stop();
    setStreaming(false);
    state.requestId = null;
    convo.updatedAt = now();
    // 续写改了正文，同样要落回当前那个候选槽
    if (Array.isArray(last.variants) && Number.isFinite(last.variantIndex)) {
      last.variants[last.variantIndex] = last.content;
    }
    syncConvoPanel(convo);
    syncConvoOptions(convo);
    renderAll({ forceScroll: true });
    persistConversations();
    el.input.focus();
  }
}

/**
 * 调一次模型，把回复流式写进界面。
 *
 * options.variants：已有的候选列表。传了就是「重新生成」——
 * 新生成的那条会作为一个**新候选**接在后面，老的留着可以左右翻，
 * 而不是把老的直接扔掉。
 */
async function requestCompletion(convo, options) {
  const endpoint = ensureConvoEndpoint(convo);
  if (!endpoint) {
    showToast('还没有配置模型服务', 'error');
    return;
  }

  // 世界书在渲染层匹配（和 buildApiMessages 同一个进程，省一次往返）。
  // 之前这里要求「消息数 ≥ 3」才匹配，但那会让世界模型的第一个回合拿不到设定 ——
  // 而开场引导往往正是最需要世界书的时候。匹配本身是本地纯计算，不省这一下。
  const worldbookSection = await matchWorldbookSection(convo);
  const ragSection = await recallSection(convo);

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

  // 重新生成：把老候选接在前面，新的那条占一个空位先显示「正在思考」。
  // 先占位是为了让「2/3」这种计数在流式过程中就是对的。
  const seeded = options && Array.isArray(options.variants) ? options.variants.filter((v) => String(v || '').trim()) : null;
  if (seeded && seeded.length) {
    assistant.variants = [...seeded, ''];
    assistant.variantIndex = assistant.variants.length - 1;
  }

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
      messages: buildApiMessages(convo, worldbookSection, ragSection)
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

    // 定稿：把这一轮的结果写回它那个候选槽
    if (Array.isArray(assistant.variants)) {
      assistant.variants[assistant.variantIndex] = assistant.content;
    }
  } catch (err) {
    const message = (err && err.message) || '未知错误';
    const stopped = /已停止生成/.test(message);

    // 没生成出东西，那个占位的空候选要撤掉，不然会留下一条空白候选
    if (Array.isArray(assistant.variants)) {
      assistant.variants.pop();
      if (!assistant.variants.length) delete assistant.variants;
      else assistant.variantIndex = assistant.variants.length - 1;
    }

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
    syncConvoOptions(convo);
    // 剧情要是把你的名字改了，消息标签和 {{user}} 也得跟着改
    syncPlayerNameFromPanel(convo);
    renderAll({ forceScroll: true });
    persistConversations();
    el.input.focus();

    // 攒够未压缩的对话就后台压一段摘要。
    // 放在最后、不 await：压缩要额外调一次模型，不该让你等它。
    maybeSummarize(convo).catch((err) => console.error('后台摘要失败', err));
  }
}

/** 删除某条助手消息之后的全部内容，重新问一次 */
/**
 * 重新生成：删掉这条之后的全部内容，再问一次。
 *
 * 和以前不同的是**老的那条不扔** —— 它作为一个候选留着，生成完可以用
 * 「‹ 2/3 ›」翻回去。写了一大段舍不得删、只想再抽一次的时候很有用。
 */
function regenerateFrom(index) {
  const convo = activeConvo();
  if (!convo || state.streaming) return;

  // 这一轮已有的候选。第一次重新生成时，当前正文就是第一个候选。
  const target = convo.messages[index];
  let existing = null;
  if (target && target.role === 'assistant' && String(target.content || '').trim()) {
    existing = Array.isArray(target.variants) ? target.variants.slice() : [String(target.content)];
  }

  let cut = Math.min(index, convo.messages.length - 1);
  while (cut >= 0 && convo.messages[cut].role !== 'user') cut -= 1;

  if (cut < 0) {
    showToast('找不到对应的提问，无法重新生成', 'error');
    return;
  }

  convo.messages = convo.messages.slice(0, cut + 1);
  state.usage = null;
  persistConversations(0);
  requestCompletion(convo, existing ? { variants: existing } : undefined);
}

/**
 * 换一条候选（swipe）。
 * content 是「当前显示的那条」，改它就等于换了一条 —— 历史、复制、导出
 * 读的都是 content，所以其它地方一行都不用动。
 */
function switchVariant(index, delta) {
  const convo = activeConvo();
  if (!convo || state.streaming) return;

  const message = convo.messages[index];
  const list = message && Array.isArray(message.variants) ? message.variants : null;
  if (!list || list.length < 2) return;

  const current = Number.isFinite(message.variantIndex) ? message.variantIndex : 0;
  const next = (current + delta + list.length) % list.length;
  if (next === current) return;

  message.variantIndex = next;
  message.content = list[next];
  convo.updatedAt = now();

  // 不同候选里写的状态栏可能不一样，换完重新扫一遍
  syncConvoPanel(convo);
  syncConvoOptions(convo);
  renderAll({ forceScroll: false });
  persistConversations(0);
}

async function stopGenerating() {
  await api.stopChat();
}

// ---------------------------------------------------------------------------
//  设置弹窗
// ---------------------------------------------------------------------------

/**
 * 填一个「模型」下拉。
 *
 * 模型从哪来？就是对应服务商的「可用模型」那一份列表 —— 所以**选了服务商才知道有哪些能选**，
 * 换服务商得跟着重填。这也是聊天那边模型下拉的同一份数据。
 *
 * keepMissing：保存过的模型不在列表里时怎么办。
 *   · 打开设置时 true —— 补一个选项摆在那儿，免得一打开就被静默改掉
 *     （换了服务商、或者列表被人删过，都会出现这种情况）
 *   · 用户主动换服务商时 false —— 老服务商的模型名在新服务商这儿没有意义，直接选第一个
 */
/**
 * 给模型下拉填选项。
 *
 * catalogModels：可选，把内置目录里的模型也并进来（标注「内置」）。
 * 生图那一组用得上 —— 服务商的模型列表里通常只有文本模型，
 * 不并进来的话用户根本选不到 glm-image 这种生图模型。
 * 只在界面上多给几个选项，不会去改用户的服务商配置。
 */
function fillModelSelect(select, providerId, current, emptyHint, keepMissing = true, catalogModels = null) {
  clear(select);

  const provider = providerById(providerId);
  const models = provider && Array.isArray(provider.models) ? provider.models.filter(Boolean) : [];
  const extra = (Array.isArray(catalogModels) ? catalogModels : []).filter((m) => m && !models.includes(m));
  const all = [...models, ...extra];
  const value = String(current || '').trim();

  if (!all.length) {
    select.appendChild(h('option', { value: '', text: emptyHint }));
    select.disabled = true;
    return;
  }

  select.disabled = false;

  // 存过的值不在列表里（既不在服务商配置、也不在目录）也保留，别让用户的选择凭空消失
  if (keepMissing && value && !all.includes(value)) {
    select.appendChild(h('option', { value, text: `${value}（不在列表里）` }));
  }

  for (const model of models) {
    select.appendChild(h('option', { value: model, text: model }));
  }
  for (const model of extra) {
    select.appendChild(h('option', { value: model, text: `${model}（内置）` }));
  }

  // 有保存过的就用它；没有就挑第一个，别让下拉是空的
  select.value = value || all[0];
}

function fillSettingsForm(settings) {
  el.s.temp.value = settings.temperature ?? 0.7;
  el.s.maxTokens.value = settings.maxTokens ?? 2048;
  el.s.userName.value = settings.userName || '你';
  el.s.maxTurns.value = settings.maxTurns ?? CONFIG.MAX_TURNS;
  el.s.system.value = settings.systemPrompt || '';
  el.s.sendOnEnter.checked = settings.sendOnEnter !== false;
  el.s.showDate.checked = settings.showDate !== false;
  el.s.showUsage.checked = settings.showUsage !== false;
  el.s.wbDepth.value = String(
    Number.isFinite(Number(settings.worldbookRecursiveDepth)) ? Number(settings.worldbookRecursiveDepth) : 3
  );
  el.s.commonAttrs.value = (Array.isArray(settings.commonAttributes) ? settings.commonAttributes : []).join(', ');

  // 生图：下拉里放一个「不启用」+ 所有服务商
  clear(el.s.imageProvider);
  el.s.imageProvider.appendChild(h('option', { value: '', text: '（不启用生图）' }));
  for (const provider of providers()) {
    el.s.imageProvider.appendChild(h('option', { value: provider.id, text: provider.name }));
  }
  el.s.imageProvider.value = providers().some((p) => p.id === settings.imageProviderId)
    ? settings.imageProviderId
    : '';
  el.s.imageModel.value = settings.imageModel || '';
  // 生图模型下拉要并上内置目录 —— 服务商的模型列表里通常只有文本模型，
  // 不并的话用户根本选不到 glm-image 这种生图模型
  fillModelSelect(
    el.s.imageModel,
    el.s.imageProvider.value,
    settings.imageModel,
    '（先在左边选一个服务商）',
    true,
    imageCatalogModels(el.s.imageProvider.value)
  );
  // 尺寸的可选项跟着生图模型走，且会纠正该模型不支持的旧值
  fillImageSizeOptions(el.s.imageModel.value, settings.imageSize);

  // 语义检索：同样是一个「不启用」+ 全部服务商
  el.s.ragEnabled.checked = settings.ragEnabled === true;
  clear(el.s.embeddingProvider);
  el.s.embeddingProvider.appendChild(h('option', { value: '', text: '（不选）' }));
  for (const provider of providers()) {
    el.s.embeddingProvider.appendChild(h('option', { value: provider.id, text: provider.name }));
  }
  el.s.embeddingProvider.value = providers().some((p) => p.id === settings.embeddingProviderId)
    ? settings.embeddingProviderId
    : '';
  fillModelSelect(el.s.embeddingModel, el.s.embeddingProvider.value, settings.embeddingModel, '（先在上面选一个服务商）');
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
    showUsage: el.s.showUsage.checked,
    worldbookRecursiveDepth: (() => {
      const depth = Number(el.s.wbDepth.value);
      return Number.isFinite(depth) ? Math.max(0, Math.min(5, Math.floor(depth))) : 3;
    })(),
    imageProviderId: el.s.imageProvider.value || '',
    imageModel: el.s.imageModel.value.trim(),
    imageSize: el.s.imageSize.value || '',
    ragEnabled: el.s.ragEnabled.checked,
    embeddingProviderId: el.s.embeddingProvider.value || '',
    embeddingModel: el.s.embeddingModel.value.trim(),
    // 和「服务商模型列表」一样是「分隔符拆开的字符串列表」，直接复用那个解析
    commonAttributes: parseModels(el.s.commonAttrs.value).slice(0, 40)
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

  // 消息里有些东西是**跟着设置走的**：日期分隔（showDate）、
  // 以及「配图」按钮要不要出现（配了生图才有）。
  // 不重绘的话会出现「配好了生图但消息上没有按钮」，非得切个会话才出来。
  renderMessages({ forceScroll: false });

  return state.settings;
}

/**
 * 各服务商的已知模型目录。
 *
 * 用途：「拉取可用模型」走的是 OpenAI 那套 GET /models，但不少国内服务商
 * 根本没有这个接口（智谱就是），请求会被网关拒掉（常见 406）。
 * 这种情况下不能让用户卡死在一个看不懂的错误码上，所以给一份内置目录兜底。
 *
 * 按接口地址里的域名匹配，而不是按服务商名字 —— 名字用户可以随便改。
 *
 * imageModels 是「生图」那一组能用的模型。文本模型不能拿来生图，
 * 选错了接口会报 404 —— 这个坑很容易踩，所以单独列出来。
 */
const MODEL_CATALOG = [
  {
    match: /bigmodel\.cn/i,
    name: '智谱 GLM',
    note: '智谱没有「模型列表」接口，请从下面挑一个填进去',
    models: ['glm-5.3-flash', 'glm-5.3', 'glm-5.3-flashx', 'glm-5.2'],
    imageModels: ['glm-image', 'cogview-4-250304', 'cogview-4', 'cogview-3-flash']
  },
  {
    match: /dashscope\.aliyuncs\.com/i,
    name: '通义千问',
    note: '通义的 OpenAI 兼容模式对部分 Key 不返回模型列表，可先手填',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long'],
    imageModels: ['wanx2.1-t2i-turbo', 'wanx2.1-t2i-plus', 'wanx-v1']
  },
  {
    match: /moonshot\.cn/i,
    name: 'Kimi',
    note: 'Moonshot 支持模型列表；若拉取失败可从下面挑',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    imageModels: []
  },
  {
    match: /deepseek\.com/i,
    name: 'DeepSeek',
    note: 'DeepSeek 支持模型列表；若拉取失败可从下面挑',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    // DeepSeek 目前没有生图模型
    imageModels: []
  },
  {
    match: /openai\.com/i,
    name: 'OpenAI',
    note: 'OpenAI 支持模型列表；若拉取失败可从下面挑',
    models: ['gpt-4o-mini', 'gpt-4o'],
    imageModels: ['gpt-image-1', 'dall-e-3']
  }
];

function catalogForBaseUrl(baseUrl) {
  const url = String(baseUrl || '');
  return MODEL_CATALOG.find((c) => c.match.test(url)) || null;
}

/** 某个服务商的内置生图模型（用来并进生图模型下拉） */
function imageCatalogModels(providerId) {
  const provider = providerById(providerId);
  if (!provider) return [];
  const catalog = catalogForBaseUrl(provider.baseUrl);
  return catalog && Array.isArray(catalog.imageModels) ? catalog.imageModels : [];
}

/**
 * 各生图模型支持的图片尺寸。
 *
 * 这个必须按模型区分：智谱 glm-image 只认固定的 7 个尺寸（默认 1280x1280），
 * 而 Barbara 过去一律发 1024x1024，于是被接口拒掉（智谱错误码 1210「参数有误」）。
 * 参数来自智谱官方 OpenAPI 的 CreateImageRequest.size 说明。
 */
const IMAGE_SIZE_RULES = [
  {
    match: /^glm-image$/i,
    label: 'GLM-Image',
    sizes: ['1280x1280', '1568x1056', '1056x1568', '1472x1088', '1088x1472', '1728x960', '960x1728'],
    custom: { min: 1024, max: 2048, step: 32 },
    note: '默认 1280x1280。自定义需在 1024-2048 之间、且是 32 的整数倍'
  },
  {
    match: /^cogview/i,
    label: 'CogView',
    sizes: ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440'],
    custom: { min: 512, max: 2048, step: 16 },
    note: '默认 1024x1024。自定义需在 512-2048 之间、且是 16 的整数倍'
  }
];

const DEFAULT_IMAGE_SIZES = ['1024x1024', '1024x1792', '1792x1024', '512x512'];

function imageSizeRule(model) {
  const name = String(model || '').trim();
  return IMAGE_SIZE_RULES.find((r) => r.match.test(name)) || null;
}

/** 某个生图模型可选的尺寸列表 */
function sizesForImageModel(model) {
  const rule = imageSizeRule(model);
  return rule ? rule.sizes : DEFAULT_IMAGE_SIZES;
}

/** 尺寸是否合法：已知模型按规则校验，未知模型只做基本格式检查 */
function isValidImageSize(model, size) {
  const value = String(size || '').trim().toLowerCase();
  if (!/^\d{2,4}x\d{2,4}$/.test(value)) return false;

  const rule = imageSizeRule(model);
  if (!rule) return true;

  if (rule.sizes.includes(value)) return true;

  // 不在推荐列表里也可能合法（自定义尺寸），按规则体检
  if (!rule.custom) return false;
  const [w, h] = value.split('x').map(Number);
  const { min, max, step } = rule.custom;
  const inRange = (n) => n >= min && n <= max && n % step === 0;
  return inRange(w) && inRange(h);
}

/**
 * 生图模型优先选对的。
 *
 * 坑：provider.models 里通常全是文本模型，生图那一组下拉如果直接沿用，
 * 就会把 glm-5.3 这种文本模型发给 /images/generations，接口报 404。
 * 所以有内置生图目录时，主动切过去并说明原因；
 * 用户自己指定了生图模型（模型名看着像生图模型）就不抢。
 */
function preferImageModel(provider) {
  if (!provider) return;

  const imageModels = imageCatalogModels(provider.id);
  if (!imageModels.length) return;

  const available = Array.isArray(provider.models) ? provider.models.filter(Boolean) : [];
  const current = String(el.s.imageModel.value || '').trim();

  // 当前已经是这家已知的生图模型 —— 不用动
  if (current && imageModels.includes(current)) return;
  // 用户自己在模型列表里放了生图模型并选中了它 —— 尊重用户
  if (current && current !== available[0] && /image|cogview|dall-e|wanx|flux|sd|stable/i.test(current)) return;

  const target = imageModels[0];
  if (target === current) return;

  const option = Array.from(el.s.imageModel.options || []).find((o) => o.value === target);
  if (option) {
    el.s.imageModel.value = target;
  } else {
    el.s.imageModel.appendChild(h('option', { value: target, text: `${target}（内置）` }));
    el.s.imageModel.value = target;
  }

  showToast(
    `这家服务商的生图模型是 ${imageModels.join(' / ')}，` +
      `已从「${current || '文本模型'}」切到「${target}」——` +
      '文本模型不能用来生图，选错会报 404',
    'ok'
  );
}

/**
 * 按当前生图模型重建尺寸下拉，并尽量保留用户原来的选择。
 * 模型不认识时用通用尺寸，不拦着用户。
 */
function fillImageSizeOptions(model, current) {
  const select = el.s.imageSize;
  if (!select) return;

  const sizes = sizesForImageModel(model);
  const wanted = String(current || '').trim();

  clear(select);
  for (const size of sizes) {
    select.appendChild(h('option', { value: size, text: size }));
  }

  // 已保存的尺寸不在这个模型的列表里：要么直接纠正，要么明确标出来
  if (wanted && !sizes.includes(wanted)) {
    if (isValidImageSize(model, wanted)) {
      // 是合法自定义尺寸，保留
      select.appendChild(h('option', { value: wanted, text: `${wanted}（自定义）` }));
      select.value = wanted;
    } else {
      // 非法（比如 glm-image 配 1024x1024）——直接切到默认值，别让它再撞一次
      const rule = imageSizeRule(model);
      const fallback = sizes[0];
      select.value = fallback;
      if (rule) {
        showToast(
          `${rule.label} 不支持 ${wanted}，已改成 ${fallback}` +
            (rule.note ? `（${rule.note}）` : ''),
          'ok'
        );
      }
    }
    return;
  }

  select.value = wanted && sizes.includes(wanted) ? wanted : sizes[0];
}

/** 拉取失败时，判断是不是「这个服务商压根没有模型列表接口」 */
function looksLikeUnsupportedModelList(message) {
  const text = String(message || '');
  return (
    /\b(406|404|405|501)\b/.test(text) ||
    /不被接受|找不到接口|不支持|Not Acceptable|Method Not Allowed/i.test(text)
  );
}

/**
 * 把内置目录里的模型填进模型输入框。
 * replace=false 时只补空缺，不动用户已经写好的内容。
 */
function applyCatalogModels(catalog, replace) {
  if (!catalog) return 0;

  const existing = String(el.p.models.value || '')
    .split(/[\n,，]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const next = replace ? [...catalog.models] : [...existing];
  if (!replace) {
    for (const m of catalog.models) {
      if (!next.includes(m)) next.push(m);
    }
  }

  el.p.models.value = next.join('\n');
  stashProviderForm();
  renderModelSwitch();
  return next.length;
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

    // 模型列表变了，生图 / 向量那两组下拉也要跟着刷新 ——
    // 刚拉到的列表里可能正好有你要的画图模型
    fillModelSelect(
      el.s.imageModel,
      el.s.imageProvider.value,
      el.s.imageModel.value,
      '（先在左边选一个服务商）',
      true,
      imageCatalogModels(el.s.imageProvider.value)
    );
    fillModelSelect(el.s.embeddingModel, el.s.embeddingProvider.value, el.s.embeddingModel.value, '（先在上面选一个服务商）');

    showToast(
      models.length > capped.length
        ? `拿到 ${models.length} 个模型，已填入前 ${capped.length} 个`
        : `拿到 ${models.length} 个模型，已填入列表`,
      'ok'
    );
  } catch (err) {
    const message = (err && err.message) || '获取模型列表失败';

    // 该服务商没有模型列表接口时（智谱就是），不要只丢一个 HTTP 错误码给用户，
    // 直接把已知模型填上，让流程能继续走下去。
    const catalog = catalogForBaseUrl(provider.baseUrl);
    if (catalog && looksLikeUnsupportedModelList(message)) {
      const hasExisting = String(el.p.models.value || '').trim().length > 0;
      const count = applyCatalogModels(catalog, !hasExisting);
      showToast(
        `${catalog.name}不支持「拉取模型列表」，已${hasExisting ? '补充' : '填入'} ${count} 个已知模型，可直接保存`,
        'ok'
      );
    } else {
      showToast(message, 'error');
    }
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
  entry.recursive = el.wb.e.recursive.checked;
  entry.enabled = el.wb.e.enabled.checked;
}

function renderEntryList() {
  el.wb.entryList.innerHTML = '';

  const book = currentWorldbook();
  if (!book) return;

  const entries = book.entries || [];
  if (!entries.length) {
    el.wb.entryList.appendChild(
      h('div', { class: 'wb-list-empty', text: '这本书还没有条目，点「＋ 条目」加一条' })
    );
    return;
  }

  for (const entry of entries) {
    el.wb.entryList.appendChild(
      h(
        'div',
        {
          class: ['wb-entry', entry.id === editingEntryId && 'active', entry.enabled === false && 'disabled'],
          title: entry.title,
          onclick: () => selectEntry(entry.id)
        },
        h(
          'div',
          { class: 'wb-entry-title' },
          h('span', { text: entry.title }),
          entry.constant && h('span', { class: 'wb-badge', text: '常驻' }),
          entry.enabled === false && h('span', { class: 'wb-badge', text: '停用' })
        ),
        h('div', { class: 'wb-entry-keys', text: (entry.keys || []).join(' / ') || '（无关键词）' })
      )
    );
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
  el.wb.e.recursive.checked = entry.recursive === true;
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

/** 副本的 id 单独一个前缀，和角色库、会话的 id 不会看混 */
function newWorldbookCharId() {
  return `wc${uid()}`;
}

/** 画「本书角色」那一排 */
function renderWorldbookChars() {
  const host = el.wb.charList;
  if (!host) return;
  clear(host);

  const book = currentWorldbook();
  if (!book) return;

  for (const c of worldbookCharacters(book)) {
    host.appendChild(
      h(
        'div',
        { class: 'wb-char-chip', title: c.name },
        h(
          'div',
          { class: 'wb-char-chip-avatar' },
          c.avatar ? h('img', { src: c.avatar, alt: '' }) : c.name.slice(0, 1)
        ),
        h('span', { class: 'wb-char-chip-name', text: c.name }),
        button({
          class: 'wb-char-chip-btn',
          text: '编辑',
          title: '编辑这个副本的设定',
          onClick: () => editWorldbookCharacter(c.id)
        }),
        button({
          class: 'wb-char-chip-btn',
          text: '移除',
          title: '从本书移除（角色库里的不受影响）',
          onClick: () => removeWorldbookCharacter(c.id)
        })
      )
    );
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

/**
 * 在本书里新建一个角色副本。
 * 和角色库那边一样：先只做成草稿给用户填，点「保存角色」之后才真的加进这本书 ——
 * 免得点一下就在书里多出一个空的「新角色」。
 */
function newWorldbookCharacter() {
  if (!currentWorldbook()) return;
  charEditorScope = 'worldbook';
  startCharDraft();
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

/**
 * 打开编辑器去编辑某一本。这是列表页「编辑」按钮的动作，由入口层注入给列表页。
 *
 * 它留在这儿而不是跟着列表页走：要设 editingWorldbookId —— 那是**编辑器弹窗**
 * 的状态，只有这一区在读（currentWorldbook / selectWorldbook / openWorldbooksModal）。
 * 列表页不需要知道有「当前选中的是哪本」这回事。
 */
function editWorldbookFromPage(id) {
  const book = worldbookById(id);
  if (!book) return;
  editingWorldbookId = id;
  openWorldbooksModal();
}

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
      recursiveDepth: recursiveDepthSetting(),
      messages: history.slice(-WORLDBOOK_SCAN_DEPTH).map((m) => ({ role: m.role, content: m.content }))
    });

    const hits = (result && result.hits) || [];
    if (!hits.length) {
      showToast(`扫了最近 ${result.scanDepth} 条消息，${result.total} 条条目一条都没命中`, 'error');
      return;
    }

    const names = hits.map((h) => h.title).join('、');
    // 递归带进来的单独说一声 —— 不然用户只会觉得「怎么突然多塞了这么多设定」
    const viaChain = Number(result && result.recursiveCount) || 0;
    const tail = viaChain ? `（其中 ${viaChain} 条是递归带进来的）` : '';
    showToast(`「${book.name}」命中 ${hits.length} 条：${names}${tail}`);
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

  // --- 给 AI 看图 ---
  el.btnAttach.addEventListener('click', pickChatImages);

  // 粘贴：截图之后 Ctrl+V 直接贴进来，比存文件再选快得多
  el.input.addEventListener('paste', (event) => {
    const files = event.clipboardData && event.clipboardData.files;
    if (!files || !files.length) return;
    event.preventDefault();
    addImageFiles(files).then((took) => {
      if (took) showToast('图片已贴在输入框上方', 'ok');
    });
  });

  // 拖拽：把图片拖到输入区就能加
  const composer = el.input.closest('.composer');
  if (composer) {
    composer.addEventListener('dragover', (event) => {
      if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
      event.preventDefault();
      composer.classList.add('drop-target');
    });
    composer.addEventListener('dragleave', () => composer.classList.remove('drop-target'));
    composer.addEventListener('drop', (event) => {
      composer.classList.remove('drop-target');
      const files = event.dataTransfer && event.dataTransfer.files;
      if (!files || !files.length) return;
      event.preventDefault();
      addImageFiles(files).then((took) => {
        if (took) showToast('图片已加进待发列表', 'ok');
      });
    });
  }

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

  // 换服务商 → 模型下拉跟着换（新服务商的列表里没有老模型，所以从第一个开始）
  el.s.imageProvider.addEventListener('change', () => {
    const provider = providerById(el.s.imageProvider.value);
    // 并上内置生图模型：服务商的模型列表里往往只有文本模型，
    // 不并的话用户在下拉里找不到 glm-image 这种能生图的模型
    fillModelSelect(
      el.s.imageModel,
      el.s.imageProvider.value,
      '',
      '（先在左边选一个服务商）',
      false,
      imageCatalogModels(el.s.imageProvider.value)
    );
    preferImageModel(provider);
    // 换了模型，尺寸的可选项也要跟着换
    fillImageSizeOptions(el.s.imageModel.value, el.s.imageSize.value);
  });

  // 换生图模型 → 尺寸可选项跟着换（不同模型支持的尺寸不一样）
  el.s.imageModel.addEventListener('change', () => {
    fillImageSizeOptions(el.s.imageModel.value, el.s.imageSize.value);
  });

  el.s.embeddingProvider.addEventListener('change', () => {
    fillModelSelect(el.s.embeddingModel, el.s.embeddingProvider.value, '', '（先在上面选一个服务商）', false);
  });

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
  // 加点属性：按钮和回车都能加
  el.btnAddAttr.addEventListener('click', () => {
    addCharAttr(el.c.attrNew.value);
    el.c.attrNew.value = '';
    el.c.attrNew.focus();
  });

  el.c.attrNew.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addCharAttr(el.c.attrNew.value);
    el.c.attrNew.value = '';
  });

  // 批量粘贴：一行一项，省得一条条手打
  el.c.btnAttrPaste.addEventListener('click', () => toggleAttrPaste());

  // 自带世界书的开关：先更新草稿，再按草稿刷新说明文字。
  // 注意不能直接读 editorCharacterById —— 那时角色卡上还是旧值（还没保存），
  // 结果就是「点了开关但说明没变」。
  el.c.wbEnabled.addEventListener('change', () => {
    charDraftWbEnabled = el.c.wbEnabled.checked;
    const character = editorCharacterById(editingCharacterId);
    if (character) {
      updateCharWorldbookHint({ ...character, worldbookEnabled: charDraftWbEnabled });
    }
  });

  // 「＋ 绑定」：挑一本世界书加到这个角色上
  el.c.wbAddBtn.addEventListener('click', openWorldbookPicker);
  el.c.btnAttrPasteApply.addEventListener('click', applyAttrPaste);

  // 剧情选项的开关：只切配置区的显示，值在保存时才写回角色卡
  if (el.c.optionsOn) el.c.optionsOn.addEventListener('change', renderOptionsConfig);

  el.btnDelChar.addEventListener('click', deleteCharacter);
  el.btnExportChar.addEventListener('click', exportCharacter);
  el.btnExportConvo.addEventListener('click', exportConversation);
  el.wb.btnExport.addEventListener('click', exportWorldbook);
  el.btnImportCard.addEventListener('click', importCards);

  // 点头像换图 / 清除头像
  el.charAvatar.addEventListener('click', pickAvatar);
  el.btnClearAvatar.addEventListener('click', clearAvatar);

  // 状态面板的绑定（展开 / 收起 / 清空）在 views/panelUi.js 的 initPanelUi() 里。

  // 记忆管理：弹窗本体（开关 / 摘要增删改 / 存档点）在 views/memoryUi.js 里绑定。
  // 这里只留「手动压一段」—— 它要改头部的「正在整理记忆…」提示，
  // 等 header 独立成模块之后再让它归位。
  el.btnSummarizeNow.addEventListener('click', summarizeNow);

  // 建议条：点 ✕ 收起
  el.btnSuggestClose.addEventListener('click', hideSuggestions);

  // 对话窗口外观：改完立即生效 + 落盘，所以没有「保存」按钮
  el.btnAppearance.addEventListener('click', openAppearanceModal);
  el.btnCloseAppearance.addEventListener('click', closeAppearanceModal);
  el.btnCloseAppearance2.addEventListener('click', closeAppearanceModal);
  el.appearanceModal.addEventListener('click', (event) => {
    if (event.target === el.appearanceModal) closeAppearanceModal();
  });

  // 字号：拖动时实时预览，松手才落盘 —— 不然拖一次要写几十遍配置文件
  el.appearanceFontSize.addEventListener('input', () => {
    const px = Number(el.appearanceFontSize.value);
    el.appearanceFontSizeValue.textContent = `${px}px`;
    syncRangeFill();
    state.settings = { ...(state.settings || {}), chatFontSize: px };
    applyChatAppearance();
  });
  el.appearanceFontSize.addEventListener('change', () => {
    persistAppearance({ chatFontSize: Number(el.appearanceFontSize.value) });
  });

  // 加粗颜色：色盘选的直接生效；手填的等回车/失焦再认
  el.appearanceBoldColor.addEventListener('input', () => {
    persistAppearance({ chatBoldColor: el.appearanceBoldColor.value });
  });
  el.appearanceBoldColorText.addEventListener('change', () => {
    const hex = normalizeHexColor(el.appearanceBoldColorText.value);
    if (hex === null) {
      showToast('颜色要写成 #rgb 或 #rrggbb，比如 #e06c75', 'error');
      renderAppearanceForm();
      return;
    }
    persistAppearance({ chatBoldColor: hex });
  });
  el.btnBoldColorReset.addEventListener('click', () => persistAppearance({ chatBoldColor: '' }));

  el.btnPickBg.addEventListener('click', pickChatBackground);
  el.btnClearBg.addEventListener('click', () => persistAppearance({ chatBackground: '' }));

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
  el.playerChar.addEventListener('change', applyPlayerCharChoice);
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
      return;
    }
    if (!el.appearanceModal.classList.contains('hidden')) {
      closeAppearanceModal();
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
  // 编辑器的入口指向了别的角色，说明「新建」那个草稿已经被放弃了，顺手清掉。
  if (charDraft && editingCharacterId !== charDraft.character.id) discardCharDraft();

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
  const creating = isCharDraft();

  if (el.charsTitle) {
    if (creating) el.charsTitle.textContent = inBook ? '新建本书角色' : '新建角色';
    else el.charsTitle.textContent = inBook ? '编辑本书角色' : '编辑角色';
  }
  if (el.charsSub) {
    if (creating) {
      // 说清楚「现在还没这个东西」，免得用户以为点一下就已经建好了
      el.charsSub.textContent = inBook
        ? `填好内容点「保存角色」才会加进这本书${book ? ` · ${book.name}` : ''}`
        : '填好内容点「保存角色」，保存后才会出现在角色库里';
    } else {
      el.charsSub.textContent = inBook
        ? `这本书里的独立副本，改它不影响角色库${book ? ` · ${book.name}` : ''}`
        : '改完记得点右下角「保存角色」';
    }
  }
}

async function closeCharsModal() {
  // 新建的角色还没保存：关掉就等于放弃，先问一句，免得辛苦填的设定白写
  if (isCharDraft()) {
    const typed = el.c.name.value.trim();
    const ok = await confirmDialog({
      title: '放弃新建',
      message: `「${typed || '新角色'}」还没保存，关掉就不会创建这个角色。`,
      confirmText: '放弃',
      danger: true
    });
    if (!ok) return;
  }

  // 草稿从没进过任何列表，丢掉它不用刷新界面
  discardCharDraft();
  el.charsModal.classList.add('hidden');
  el.input.focus();
}

/** 底部提示：跟着编辑器作用域变，免得不知道改的是哪一份 */
function charFootHintText(character) {
  // 还没保存的新角色没什么来源好说的，先提醒它还不存在
  if (isCharDraft()) return '还没保存 · 点右下角「保存角色」才会创建这个角色';
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
  // 新建的新角色还没保存，没有可删的东西
  el.btnDelChar.disabled = !show || isCharDraft();
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
//  进入世界：开始游玩（编排）

//  弹窗本身（填名字 / 挑一张角色卡当自己）搬去了 views/player.js。
//  这里留着「按下开始之后」的事：建会话、种状态面板、切到对话视图、必要时生成开局。
//  它跨了会话管理 / 状态面板 / 视图切换好几个分区，所以暂时留在入口层 ——
//  等 createConvo 进 data/conversations.js、seed* 进 data/panel.js 之后再一起搬。
// ---------------------------------------------------------------------------

/**
 * 「开始游玩」：建一个会话，把这个世界装上，并存下玩家自己的角色。
 * 世界模型本来就应该由 GM 叙述，所以顺手把 GM 模式打开。
 */
function startWorldPlay() {
  const book = getPlayingBook();
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
  convo.gmMode = true;
  convo.title = book.name;
  convo.updatedAt = now();

  // 你在这个世界里的身份。选了角色卡就记住是哪张（名字/设定仍以输入框为准，
  // 因为选完还能改）。
  const pickedCard = characterById(el.playerChar.value);
  convo.player = { name, profile, characterId: pickedCard ? pickedCard.id : null };

  // 状态面板：先种「你自己」的身份和属性（主角的数值优先），再种本书角色的。
  // 同名以先出现的为准，所以自己卡上的「金币」不会被书里的盖掉。
  seedIdentity(convo, name, pickedCard);
  if (pickedCard) seedPanelFromCharacters(convo, [pickedCard]);
  seedPanelFromCharacters(convo, worldbookCharacters(book));

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
    const parts = [gmRuleText('', me, convo)];
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
    // 身份用括号缀在名字后面：GM 不知道 NPC 几岁、什么族，照样会瞎编
    const who = [c.age && `${c.age}岁`, c.gender, c.race].filter(Boolean).join('·');
    const bits = [c.description, c.personality]
      .map((s) => String(s || '').trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .join(' ');
    const head = who ? `${c.name}（${who}）` : c.name;
    const line = `- ${head}：${bits.slice(0, MAX_CAST_PER_NPC) || '（没写设定）'}`;

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
  const list = characters();
  renderListPage({
    grid: el.charPageGrid,
    empty: el.charPageEmpty,
    sub: el.charsPageSub,
    subText: list.length
      ? `共 ${list.length} 个角色 · 点「聊天」直接开一个新会话`
      : '导入酒馆角色卡，或自己写一个',
    items: list,
    card: characterCard
  });
}

/** 一张角色卡：头像 + 名字 + 来源 + 编辑/聊天，右上角悬停浮出删除 */
function characterCard(c) {
  // 来源 + 分类标签挤在同一行：卡片高度不变，标签也不会把卡片撑得参差不齐。
  // 标签是「这张卡属于什么类型」（作品/风格/用途），只显示前几个，多了省略。
  const subBits = [c.source === 'png' ? '酒馆角色卡' : c.source === 'json' ? 'JSON 角色卡' : '手写'];
  for (const tag of (Array.isArray(c.tags) ? c.tags : []).slice(0, 3)) {
    if (String(tag).trim()) subBits.push(String(tag).trim());
  }
  const subText = subBits.join(' · ');

  return card({
    title: c.name,
    sub: subText,
    avatar: c.avatar,
    avatarText: c.name.slice(0, 1),
    // 删除：静止时是透明的，鼠标移上来才浮出来 —— 跟左侧会话列表的 × 同一套。
    // 这样卡片平时还是干净的「编辑 / 聊天」两个按钮，不至于误点。
    extra: button({
      class: 'char-card-del',
      text: '×',
      title: '删除这个角色',
      ariaLabel: `删除角色：${c.name}`,
      onClick: (event) => {
        event.stopPropagation();
        deleteCharacterById(c.id, 'library');
      }
    }),
    actions: [
      button({ class: 'btn btn-ghost btn-sm', text: '编辑', onClick: () => editCharacterFromPage(c.id) }),
      button({ class: 'btn btn-primary btn-sm', text: '聊天', onClick: () => chatWithCharacter(c.id) })
    ]
  });
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
  // 用编辑器那套查找：正在新建的草稿不在角色库里，但一样要能传头像
  if (!editorCharacterById(editingCharacterId)) return;

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
  el.c.age.value = character.age || '';
  el.c.gender.value = GENDERS.includes(character.gender) ? character.gender : '';
  el.c.race.value = character.race || '';

  charDraftAvatar = character.avatar || '';
  renderCharAvatar();

  // 开关的草稿要从这张卡的当前值起算（老数据没这个字段 = 开）
  charDraftWbEnabled = character.worldbookEnabled !== false;

  // 角色自带的世界书：清单 + 绑定按钮 + 开关
  renderCharWorldbookBox(character);

  // 属性：复制一份当草稿，保存时才写回角色卡
  charAttrs = characterAttrs(character);
  renderCharAttrs();

  // 剧情选项：这张卡开没开、给几个、有什么额外要求
  const optSpec = character.optionsSpec && typeof character.optionsSpec === 'object' ? character.optionsSpec : null;
  el.c.optionsOn.checked = !!optSpec;
  el.c.optionsCount.value = String(optSpec ? optSpec.count || 3 : 3);
  el.c.optionsHint.value = optSpec ? optSpec.hint || '' : '';
  renderOptionsConfig();

  el.charFootHint.textContent = charFootHintText(character);

  showCharForm(true);
}

/** 剧情选项的配置区：开关关着就整块收起来（省得看着以为在生效） */
function renderOptionsConfig() {
  if (!el.c.optionsConfig) return;
  el.c.optionsConfig.classList.toggle('hidden', !el.c.optionsOn.checked);
}

/** 角色自带世界书那一块：没有绑书就整块藏起来 */
// 角色编辑器里「给角色绑世界书」那个浮层（自己起一个，不复用世界书页的选择器）
let worldbookPickerEl = null;

/**
 * 角色自带世界书那一块。
 *
 * 这块**始终显示**（以前是「有绑定才显示」，结果没绑定过的角色
 * 根本找不到入口加书）。没绑定时列出空状态提示，开关和说明照常给。
 */
function renderCharWorldbookBox(character) {
  if (!character) return;

  const ids = character && Array.isArray(character.worldbookIds) ? character.worldbookIds : [];
  const books = ids.map((id) => worldbookById(id)).filter(Boolean);
  // 开关的当前值以草稿为准（用户可能刚切过还没保存）
  const enabled = charDraftWbEnabled;

  // --- 已绑的清单 ---
  el.c.wbList.innerHTML = '';

  if (!books.length) {
    const empty = document.createElement('p');
    empty.className = 'field-help cwb-empty';
    empty.textContent =
      '还没有绑定。点「＋ 绑定」从世界书库里挑一本 —— 单独跟这个角色聊天时会带上它。';
    el.c.wbList.appendChild(empty);
  } else {
    for (const book of books) {
      const row = document.createElement('div');
      row.className = 'cwb-row';

      const name = document.createElement('span');
      name.className = 'cwb-row-name';
      name.textContent = book.name;
      name.title = book.name;

      const count = document.createElement('span');
      count.className = 'cwb-row-count';
      const n = Array.isArray(book.entries) ? book.entries.length : 0;
      count.textContent = `${n} 条`;

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'cwb-row-del';
      del.title = '解绑（不会删掉世界书本身）';
      del.setAttribute('aria-label', `解绑 ${book.name}`);
      del.textContent = '✕';
      del.addEventListener('click', () => unbindWorldbookFromCharacter(book.id));

      row.append(name, count, del);
      el.c.wbList.appendChild(row);
    }
  }

  // --- 开关：没有绑定时藏起来（开着也没意义）---
  const hasBooks = books.length > 0;
  el.c.wbSwitch.classList.toggle('hidden', !hasBooks);
  el.c.wbEnabled.checked = enabled;

  if (!hasBooks) {
    el.c.wbDesc.textContent = '';
    el.c.wbHint.textContent =
      '绑定之后，这张卡单独聊天会带上这本书的设定；被绑进某个世界当角色时不生效（那条会话有自己的世界观）。';
    return;
  }

  const names = books.map((b) => b.name).join('、');
  const total = books.reduce((sum, b) => sum + (Array.isArray(b.entries) ? b.entries.length : 0), 0);
  el.c.wbDesc.textContent = `已绑 ${books.length} 本（共 ${total} 条）：${names}`;

  el.c.wbHint.textContent = enabled
    ? '现在生效。单独跟它聊天时会带上这些设定；但绑进某个世界当角色时不生效 —— 那条会话已经有自己的世界观了。'
    : '已停用。无论单独聊天、还是绑进某个世界当角色，都不会带入这几本书 —— 这张卡保持干净（绑定关系留着，随时能再打开）。';
}

/** 只刷新开关下面的说明文字（切换开关时用，不动清单） */
function updateCharWorldbookHint(character) {
  const books = (character && Array.isArray(character.worldbookIds) ? character.worldbookIds : [])
    .map((id) => worldbookById(id))
    .filter(Boolean);
  if (!books.length) return;

  const enabled = character.worldbookEnabled !== false;
  const names = books.map((b) => b.name).join('、');
  const total = books.reduce((sum, b) => sum + (Array.isArray(b.entries) ? b.entries.length : 0), 0);
  el.c.wbDesc.textContent = `已绑 ${books.length} 本（共 ${total} 条）：${names}`;

  el.c.wbHint.textContent = enabled
    ? '现在生效。单独跟它聊天时会带上这些设定；但绑进某个世界当角色时不生效 —— 那条会话已经有自己的世界观了。'
    : '已停用。无论单独聊天、还是绑进某个世界当角色，都不会带入这几本书 —— 这张卡保持干净（绑定关系留着，随时能再打开）。';
}
async function bindWorldbookToCharacter(bookId) {
  const character = editorCharacterById(editingCharacterId);
  if (!character) return;

  const ids = Array.isArray(character.worldbookIds) ? [...character.worldbookIds] : [];
  if (ids.includes(bookId)) {
    showToast('这本已经绑上了');
    return;
  }

  ids.push(bookId);
  character.worldbookIds = ids;
  // 刚绑上就默认启用 —— 绑了却因为开关关着不生效，会让人以为是 bug
  if (character.worldbookEnabled === false && ids.length === 1) {
    character.worldbookEnabled = true;
  }
  character.updatedAt = now();

  renderCharWorldbookBox(character);
  await persistLibrary();
  showToast('已绑定世界书');
}

/** 解绑（不删世界书本身） */
async function unbindWorldbookFromCharacter(bookId) {
  const character = editorCharacterById(editingCharacterId);
  if (!character) return;

  const book = worldbookById(bookId);
  character.worldbookIds = (character.worldbookIds || []).filter((id) => id !== bookId);
  character.updatedAt = now();

  renderCharWorldbookBox(character);
  await persistLibrary();
  showToast(book ? `已解绑「${book.name}」（世界书还在库里）` : '已解绑');
}

/**
 * 点「＋ 绑定」：列出还没绑的世界书让用户挑。
 *
 * 自己起一个轻量浮层，而不是复用世界书页那个角色选择器 ——
 * 那个是「角色 → 加进世界书」，方向相反，而且绑了一堆模块级状态，
 * 硬套进来会互相干扰。
 */
function openWorldbookPicker() {
  const character = editorCharacterById(editingCharacterId);
  if (!character) return;

  const bound = new Set(Array.isArray(character.worldbookIds) ? character.worldbookIds : []);
  const all = worldbooks();
  const candidates = all.filter((b) => !bound.has(b.id));

  if (!all.length) {
    showToast('世界书库还是空的 —— 先去「世界书」页新建或导入一本', 'error');
    return;
  }
  if (!candidates.length) {
    showToast('所有世界书都已经绑上了');
    return;
  }

  closeWorldbookPicker();

  const overlay = document.createElement('div');
  overlay.className = 'cwb-picker';

  const card = document.createElement('div');
  card.className = 'cwb-picker-card';

  const head = document.createElement('div');
  head.className = 'cwb-picker-head';
  const title = document.createElement('span');
  title.className = 'cwb-picker-title';
  title.textContent = `给「${character.name}」绑定世界书`;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-btn icon-btn-sm';
  close.title = '关闭';
  close.setAttribute('aria-label', '关闭');
  close.textContent = '✕';
  close.addEventListener('click', closeWorldbookPicker);
  head.append(title, close);

  const list = document.createElement('div');
  list.className = 'cwb-picker-list';

  for (const book of candidates) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'cwb-picker-row';

    const name = document.createElement('span');
    name.className = 'cwb-picker-name';
    name.textContent = book.name;

    const meta = document.createElement('span');
    meta.className = 'cwb-picker-meta';
    const n = Array.isArray(book.entries) ? book.entries.length : 0;
    const chars = Array.isArray(book.characters) ? book.characters.length : 0;
    meta.textContent = chars ? `${n} 条 · ${chars} 个角色` : `${n} 条`;

    row.append(name, meta);
    row.addEventListener('click', () => {
      closeWorldbookPicker();
      bindWorldbookToCharacter(book.id);
    });
    list.appendChild(row);
  }

  card.append(head, list);
  overlay.appendChild(card);

  // 点浮层空白处关掉
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeWorldbookPicker();
  });

  document.body.appendChild(overlay);
  worldbookPickerEl = overlay;
}

function closeWorldbookPicker() {
  if (worldbookPickerEl) {
    worldbookPickerEl.remove();
    worldbookPickerEl = null;
  }
}

// ---------------------------------------------------------------------------
//  角色属性（状态面板的字段模板）
//
//  玩法：在角色卡上先声明「这个角色有哪些属性」（金币/上衣/下衣…），
//  绑定时把它们种进会话的状态面板 —— 于是 AI 第一轮就知道该维护哪些字段，
//  不用等它自己碰巧输出一个【金币】：100。
//
//  这里填的是**初始值（模板）**；进游戏之后在面板里改的是**那一局的当前值**。
//  两者分开存，改角色卡不会影响正在进行的游戏。
// ---------------------------------------------------------------------------

// 编辑器打开期间的属性草稿，点「保存角色」才写回角色卡（和 charDraftAvatar 一个套路）
let charAttrs = [];

// 性别是选择框，只认这几个值（导入的卡会在主进程先归一化过来）
const GENDERS = ['男', '女', '其他'];

/** 编辑器里的字段类型选择框（文本 / 数值 / 列表） */
const ATTR_TYPES = [
  { value: 'text', label: '文本' },
  { value: 'meter', label: '数值' },
  { value: 'list', label: '列表' }
];

/**
 * 重画编辑器的属性区：上面的快捷候选词 + 下面已加的属性行。
 *
 * 每行是「名字 + 初始值 + 类型 + 更多」。范围/变化规则收在「更多」里，
 * 平时只露出名字和值 —— 大多数属性就是个文本，不该被一排输入框淹掉。
 */
function renderCharAttrs() {
  if (!el.c.attrList) return;

  // 快捷候选词：已经在属性里的就不再显示，免得点了个寂寞
  const used = new Set(charAttrs.map((a) => a.name));
  const quick = (state.settings && state.settings.commonAttributes) || [];
  clear(el.c.attrQuick);
  for (const name of quick) {
    if (used.has(name)) continue;
    el.c.attrQuick.appendChild(
      button({ class: 'attr-quick-btn', text: `＋ ${name}`, onClick: () => addCharAttr(name) })
    );
  }
  el.c.attrQuick.classList.toggle('hidden', !el.c.attrQuick.childElementCount);

  // 已加的属性。输入框里改值只更新草稿，不重画 —— 一重画光标就跳走了。
  clear(el.c.attrList);

  // 分组建议：这张卡里已经用过的分组名。datalist 只是「可下拉选」，
  // 不限制你写新名字（想新建一组直接打字）。
  const groupSuggest = el.c.attrList.parentElement && el.c.attrList.parentElement.querySelector('#attr-group-suggest');
  if (groupSuggest) {
    clear(groupSuggest);
    const names = [...new Set(charAttrs.map((a) => (a.group || '').trim()).filter(Boolean))];
    for (const g of names) groupSuggest.appendChild(h('option', { value: g }));
  }

  charAttrs.forEach((attr, index) => {
    const valueInput = h('input', {
      type: 'text',
      class: 'attr-value',
      value: attr.value,
      spellcheck: 'false',
      placeholder: '初始值（可以留空）',
      'aria-label': `${attr.name} 的初始值`,
      oninput: () => {
        attr.value = valueInput.value;
      }
    });

    const typeSelect = h(
      'select',
      {
        class: 'attr-type',
        'aria-label': `${attr.name} 的类型`,
        title: '字段类型：数值可以设范围，超出范围时程序会拉回来',
        onchange: () => {
          const next = typeSelect.value;
          // 切到「数值」时自动把「更多」展开 —— 否则用户选了类型还得再点一次
          // 才能看到范围输入框，很容易以为这个功能不存在。
          if (next === 'meter' && attr.type !== 'meter') attr._moreOpen = true;
          attr.type = next;
          renderCharAttrs();
        }
      },
      ATTR_TYPES.map((t) => h('option', { value: t.value, text: t.label, selected: (attr.type || 'text') === t.value }))
    );

    // 「更多」：默认展开条件是「已经有范围或规则」，但用户手动收起/展开过
    // 就以手动状态为准（_moreOpen 是 true/false/undefined 三态）——
    // 只看 hasMore 的话，一旦设过范围就再也收不起来了。
    const hasMore = typeof attr.min === 'number' || typeof attr.max === 'number' || !!attr.hint || !!attr.group;
    const moreOpen = attr._moreOpen === undefined ? hasMore : attr._moreOpen === true;

    const moreBtn = button({
      class: 'attr-more-btn',
      text: moreOpen ? '收起' : '更多',
      title: '范围与变化规则',
      onClick: () => {
        attr._moreOpen = !moreOpen;
        renderCharAttrs();
      }
    });

    const row = h(
      'div',
      { class: 'attr-row' },
      h('span', { class: 'attr-name', text: attr.name, title: attr.name }),
      valueInput,
      typeSelect,
      moreBtn,
      button({
        class: 'panel-del',
        text: '✕',
        title: '删掉这个属性',
        onClick: () => {
          charAttrs.splice(index, 1);
          renderCharAttrs();
        }
      })
    );

    const wrap = h('div', { class: 'attr-item' }, row);

    if (moreOpen) {
      // 范围输入框（只在「数值」类型下有意义）
      const numInput = (key, placeholder, label) =>
        h('input', {
          type: 'number',
          class: 'attr-num',
          value: typeof attr[key] === 'number' ? String(attr[key]) : '',
          placeholder,
          spellcheck: 'false',
          'aria-label': `${attr.name} 的${label}`,
          oninput: (event) => {
            const raw = String(event.target.value || '').trim();
            if (raw === '' || !isFinite(Number(raw))) delete attr[key];
            else attr[key] = Number(raw);
          }
        });

      const minInput = numInput('min', '下限', '最小值');
      const maxInput = numInput('max', '上限', '最大值');

      const hintInput = h('input', {
        type: 'text',
        class: 'attr-hint',
        value: attr.hint || '',
        spellcheck: 'false',
        placeholder: '变化规则（给模型看，比如「示好时每轮最多加 10」）',
        'aria-label': `${attr.name} 的变化规则`,
        oninput: () => {
          const text = hintInput.value;
          if (text.trim()) attr.hint = text;
          else delete attr.hint;
        }
      });

      // 分组：填同一个名字的字段在状态面板里归到一组（留空 = 不分组）
      const groupInput = h('input', {
        type: 'text',
        class: 'attr-group',
        value: attr.group || '',
        spellcheck: 'false',
        list: 'attr-group-suggest',
        placeholder: '分组（可留空，比如「关系」）',
        'aria-label': `${attr.name} 的分组`,
        oninput: () => {
          const text = groupInput.value.trim();
          if (text) attr.group = text;
          else delete attr.group;
        }
      });

      const more = h('div', { class: 'attr-more' });
      if ((attr.type || 'text') === 'meter') {
        more.appendChild(
          h('div', { class: 'attr-range' }, h('span', { class: 'attr-range-label', text: '数值范围' }), minInput, h('span', { class: 'attr-range-sep', text: '~' }), maxInput)
        );
      }
      more.appendChild(hintInput);
      more.appendChild(groupInput);
      wrap.appendChild(more);
    }

    el.c.attrList.appendChild(wrap);
  });
}

/**
 * 把粘贴进来的一段文本解析成属性。
 *
 * 一行一项，认这几种写法：
 *   【金币】：9900      金币：9900      金币:9900
 *   金币	9900          金币 9900
 * 冒号后面留空也算（就是「有这个名字、值先空着」）。
 *
 * 认不出来的行**直接跳过**，不报错 —— 粘贴过来的文本经常带标题、空行、说明文字，
 * 为了几行杂音打断整次粘贴不值得。跳过了多少行会告诉用户。
 */
function parseAttributesFromText(text) {
  const pairs = [];
  const seen = new Set();
  let skipped = 0;

  for (const rawLine of String(text || '').split('\n')) {
    // 去掉列表符号（- * + •）和首尾空白
    const line = rawLine.trim().replace(/^[-*+•]\s*/, '').trim();
    if (!line) continue;

    // 【名字】：值 —— 先试这个，否则下面的通用规则会把「【金币】」连括号一起当名字
    let m = line.match(/^【([^】\n]{1,24})】\s*[：:]\s*(.*)$/);
    // 名字：值 / 名字:值
    if (!m) m = line.match(/^([^：:\n]{1,24}?)\s*[：:]\s*(.*)$/);
    // 名字 + 空格/Tab + 值
    if (!m) m = line.match(/^([^\s：:]{1,24})[\s\u3000]+(.+)$/);

    if (!m) {
      skipped++;
      continue;
    }

    const name = m[1].trim();
    const value = String(m[2] || '').trim().slice(0, 200);
    if (!name || seen.has(name)) continue;
    if (!panelFieldAllowed(name)) {
      skipped++;
      continue;
    }

    seen.add(name);
    pairs.push({ name: name.slice(0, 24), value });
  }

  return { pairs, skipped };
}

/** 把解析出来的属性并进草稿：新的追加，同名的覆盖值 */
function applyParsedAttributes(pairs) {
  let added = 0;
  let updated = 0;

  for (const item of pairs) {
    const existing = charAttrs.find((a) => a.name === item.name);
    if (existing) {
      if (existing.value !== item.value) {
        existing.value = item.value;
        updated++;
      }
      continue;
    }
    if (charAttrs.length >= MAX_PANEL_FIELDS) break;
    charAttrs.push({ name: item.name, value: item.value });
    added++;
  }

  renderCharAttrs();
  return { added, updated };
}

function toggleAttrPaste(show) {
  const next = typeof show === 'boolean' ? show : el.c.attrPaste.classList.contains('hidden');
  el.c.attrPaste.classList.toggle('hidden', !next);
  if (next) el.c.attrPasteText.focus();
}

/** 点「解析并加入」：解析 + 合并 + 告诉用户结果 */
function applyAttrPaste() {
  const text = el.c.attrPasteText.value;
  if (!String(text).trim()) {
    showToast('先把文本粘进来', 'error');
    el.c.attrPasteText.focus();
    return;
  }

  const { pairs, skipped } = parseAttributesFromText(text);
  if (!pairs.length) {
    showToast('没认出任何属性，检查一下格式（一行一项，比如「金币：9900」）', 'error');
    return;
  }

  const { added, updated } = applyParsedAttributes(pairs);
  el.c.attrPasteText.value = '';
  toggleAttrPaste(false);

  const bits = [];
  if (added) bits.push(`新增 ${added} 项`);
  if (updated) bits.push(`更新 ${updated} 项`);
  if (skipped) bits.push(`跳过 ${skipped} 行`);
  showToast(`已解析：${bits.join('，')}`, 'ok');
}

/** 加一个属性：保留字拦下，重名跳过 */
function addCharAttr(rawName) {
  const name = String(rawName || '').trim().slice(0, 24);
  if (!name) return;

  if (!panelFieldAllowed(name)) {
    showToast(`「${name}」是状态栏的保留字段名，换一个吧`, 'error');
    return;
  }
  if (charAttrs.some((a) => a.name === name)) {
    showToast(`已经有「${name}」了`);
    return;
  }
  if (charAttrs.length >= MAX_PANEL_FIELDS) return;

  charAttrs.push({ name, value: '' });
  renderCharAttrs();
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
  // 身份三项：年龄和种族是自由文本（「不详」「精灵」都合法），性别用选择框
  character.age = el.c.age.value.trim().slice(0, 40);
  character.gender = GENDERS.includes(el.c.gender.value) ? el.c.gender.value : '';
  character.race = el.c.race.value.trim().slice(0, 40);
  // 属性是编辑期间的草稿（charAttrs），保存时才写回角色卡。
  // ⚠️ 这里以前是个只搬 name/value 的白名单映射 —— 于是 type/min/max/hint
  // 会被静默丢掉（和当初「attributes 整个丢过」是同一个坑）。
  // 现在只摘掉界面自己的临时状态（_moreOpen），其余字段原样带走。
  character.attributes = charAttrs
    .filter((a) => a && typeof a.name === 'string' && a.name.trim())
    .map((a) => {
      const out = { ...a, name: a.name.trim().slice(0, 24), value: String(a.value == null ? '' : a.value).slice(0, 500) };
      delete out._moreOpen;
      return out;
    })
    .slice(0, MAX_PANEL_FIELDS);
  character.avatar = charDraftAvatar;
  // 剧情选项：开关关掉就写 null（不是 false/空对象）—— 一眼能看出「这个会话不开」。
  // 数量夹在 1~6，和注入时用的上限保持一致。
  if (el.c.optionsOn.checked) {
    const raw = Number(el.c.optionsCount.value);
    const count = isFinite(raw) ? Math.max(1, Math.min(6, Math.round(raw))) : 3;
    character.optionsSpec = { count, hint: el.c.optionsHint.value.trim().slice(0, 200) };
  } else {
    character.optionsSpec = null;
  }
  // 角色自带世界书的开关（草稿）。没有绑书时不写这个字段，
  // 免得给没有书的角色平白加一个属性。
  if ((character.worldbookIds || []).length) {
    character.worldbookEnabled = charDraftWbEnabled;
  }
  character.updatedAt = now();
}

/**
 * 角色列表页的「＋ 新建角色」。
 * 先把作用域钉死在角色库 —— 上一次可能是在世界书里编辑副本，作用域还留着。
 */
function newCharacter() {
  charEditorScope = 'library';
  startCharDraft();
}

/**
 * 新建角色：只做一个「草稿」塞进编辑器给用户填。
 * 保存之前它不进角色库 / 世界书，也不写磁盘；关掉编辑器就当没建过。
 */
function startCharDraft() {
  // 上一个角色的表单里可能还有没保存的改动，先收进内存（和以前一样），
  // 再把上一份没保存完的草稿丢掉，免得留下一个永远不会被创建的幽灵角色。
  stashCharForm();
  discardCharDraft();

  const scope = charEditorScope;
  const book = scope === 'worldbook' ? currentWorldbook() : null;
  if (scope === 'worldbook' && !book) return;

  const character = {
    id: scope === 'worldbook' ? newWorldbookCharId() : uid(),
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
    attributes: [],
    age: '',
    gender: '',
    race: '人类', // 新建的角色默认就是人类，省得每次打
    source: 'manual',
    createdAt: now(),
    updatedAt: now()
  };

  charDraft = { character, scope, bookId: book ? book.id : null };
  editingCharacterId = character.id;

  fillCharForm(character);
  updateCharEditorScopeUi();
  el.charsModal.classList.remove('hidden');

  el.c.name.focus();
  el.c.name.select();
}

/**
 * 把新建的草稿真正写进角色库 / 世界书。
 * 只有点「保存角色」会走到这里 —— 这就是「保存后才生成」那一步。
 */
function commitCharDraft() {
  if (!charDraft) return true;

  const { character, scope, bookId } = charDraft;

  if (scope === 'worldbook') {
    const book = worldbookById(bookId);
    // 书在编辑期间被删掉了，这个草稿就没有落脚的地方
    if (!book) return false;
    book.characters = worldbookCharacters(book);
    book.characters.push(character);
    book.updatedAt = now();
  } else {
    state.characters = [...characters(), character];
  }

  charDraft = null;
  return true;
}

/** 丢掉没保存的草稿：它从来没进过任何列表，忘掉就行 */
function discardCharDraft() {
  if (!charDraft) return;
  if (editingCharacterId === charDraft.character.id) editingCharacterId = null;
  charDraft = null;
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

  // 这一下到底是「新建」还是「改已有的」，要在落盘前记下来：
  // 草稿一提交 charDraft 就清空了，后面就分不出来了。
  const creating = isCharDraft();
  const scope = creating ? charDraft.scope : charEditorScope;

  stashCharForm();

  // 新建的角色到这一刻才真正被创建（进角色库 / 进这本书）
  if (creating && !commitCharDraft()) {
    showToast('这本书已经不在了，角色没能创建', 'error');
    return;
  }

  // 名字可能被规整过，重新填一遍保证界面和数据一致
  renderCharacterPage();
  fillCharForm(character);
  // 新建的那一行提示语要从「还没保存」换成正常的
  updateCharEditorScopeUi();
  renderAll();

  // 改的是书里的副本，书名旁边那排和左栏计数都要跟着刷新
  if (scope === 'worldbook') {
    renderWorldbookChars();
    renderWorldbookPage();
  }

  await persistCharacters();
  showToast(creating ? `角色「${character.name}」已创建` : `角色「${character.name}」已保存`, 'ok');
}

/**
 * 删除一个角色。
 * scope：'library' = 从角色库删掉（默认）；'worldbook' = 只从当前这本书里移除副本。
 *
 * 两个入口共用这一份逻辑：角色卡右上角的 ×，和编辑弹窗底部的「删除角色」。
 * 以前它俩是「谁打开编辑器谁负责」，所以在卡片上删不了 —— 得先点进编辑。
 */
async function deleteCharacterById(id, scope) {
  const inBook = scope === 'worldbook';

  const character = inBook
    ? worldbookCharacters(currentWorldbook()).find((c) => c.id === id)
    : characters().find((c) => c.id === id);
  if (!character) return;

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

  // 编辑器如果正开在这个角色上，就没有可编辑的对象了 —— 关掉它。
  // （从卡片删的时候编辑器根本没开，这一段会跳过。）
  if (editingCharacterId === character.id) {
    editingCharacterId = null;
    if (!el.charsModal.classList.contains('hidden')) closeCharsModal();
  }

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

/** 编辑弹窗底部的「删除角色」：删的就是编辑器里正在编辑的这个 */
async function deleteCharacter() {
  // 还没保存的新角色没有任何东西可删（按钮也是禁用的，这里只是兜底）
  if (isCharDraft()) return;

  const character = editorCharacterById(editingCharacterId);
  if (!character) return;

  await deleteCharacterById(character.id, charEditorScope);
}

/**
 * 「导入角色卡」和「导入世界书」共用的前半程：弹文件框 → 解析 → 重发一批 id。
 *
 * 两个入口只有三处不同 —— 点的是哪个按钮、忙时写什么字、以及导进来之后往哪儿落 ——
 * 所以那三处交给参数和调用方，中间这一段（含「出错 / 取消 / 没内容」的兜底）
 * 只留这一份实现。以前是两份几乎逐行重复的代码，还各自跑偏过一次：
 * 只有角色卡那边会在忙时改按钮文字。
 *
 * @returns {Promise<{freshBooks: object[], freshChars: object[], errors: string[]}|null>}
 *          null = 用户取消 / 出错 / 文件里什么都没有，调用方直接 return 即可。
 */
async function pickImportFiles({ before, button, busyText, idleText } = {}) {
  if (before) before();

  let result = null;
  try {
    if (button) {
      button.disabled = true;
      if (busyText) button.textContent = busyText;
    }
    result = await api.importCard();
  } catch (err) {
    showToast((err && err.message) || '导入失败', 'error');
    return null;
  } finally {
    if (button) {
      button.disabled = false;
      if (idleText) button.textContent = idleText;
    }
  }

  if (!result || result.canceled) return null;

  const added = Array.isArray(result.characters) ? result.characters : [];
  const addedBooks = Array.isArray(result.worldbooks) ? result.worldbooks : [];
  const errors = Array.isArray(result.errors) ? result.errors : [];

  if (!added.length && !addedBooks.length) {
    showToast(errors.length ? errors[0] : '没有导入任何内容', 'error');
    return null;
  }

  // 重新发一批 id（并把角色→世界书的指向一起改写，见 data/library-reissue.js）
  const { books: freshBooks, chars: freshChars } = reissueImported(addedBooks, added);
  return { freshBooks, freshChars, errors };
}

/** 个别文件导入失败：主提示之后隔一会儿再补一条，不然会被前一条盖掉 */
function warnImportErrors(errors) {
  if (!errors.length) return;
  console.warn('部分内容导入失败：', errors);
  setTimeout(
    () => showToast(`${errors.length} 个文件没能导入：${errors[0]}`, 'error'),
    CONFIG.TOAST_DURATION_MS + 300
  );
}

async function importCards() {
  const picked = await pickImportFiles({
    before: () => stashCharForm(),
    button: el.btnImportCard,
    busyText: '导入中…',
    idleText: '导入角色卡',
  });
  if (!picked) return;

  const { freshBooks, freshChars, errors } = picked;

  state.worldbooks = [...worldbooks(), ...freshBooks];
  state.characters = [...characters(), ...freshChars];
  if (freshChars.length) editingCharacterId = freshChars[0].id;

  renderCharacterPage();
  if (freshChars.length) {
    // 直接打开刚导入的第一个角色，方便马上核对设定对不对
    charEditorScope = 'library';
    openCharsModal();
  }
  await persistCharacters();

  const parts = [];
  if (freshChars.length) parts.push(`${freshChars.length} 个角色：${freshChars.map((c) => c.name).join('、')}`);
  if (freshBooks.length) parts.push(`${freshBooks.length} 个世界书`);
  showToast(`已导入 ${parts.join('，')}`, 'ok');

  warnImportErrors(errors);
}

/**
 * 在世界书弹窗里「导入世界书」。
 * 复用角色的导入通道（同一个文件框），只是落点不同：
 * 角色照样进角色库，世界书则挂到当前选中的这本书所在的位置。
 */
async function importWorldbooks() {
  const picked = await pickImportFiles({
    before: () => {
      stashWorldbookName();
      stashEntryForm();
    },
    button: el.wb.btnImport,
    busyText: '导入中…',
    idleText: '导入世界书',
  });
  if (!picked) return;

  const { freshBooks, freshChars, errors } = picked;

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

  warnImportErrors(errors);
}

// ---------------------------------------------------------------------------
//  启动
// ---------------------------------------------------------------------------

async function init() {
  bindEvents();
  // 必须在第一次 renderAll 之前登记 —— 否则首屏一个视图都不会画。
  // 各功能模块的事件绑定也在这一步完成（它们的 init 里带着自己的登记）。
  registerRefreshListeners();
  // 只绑事件、不参与整体重绘的模块
  initPerspectiveUi();

  const config = await api.getSettings();
  state.settings = config.settings;
  state.presets = Array.isArray(config.presets) ? config.presets : [];
  editingProviderId = state.settings.activeProviderId;

  // 主题以设置里的值为准（preload 已经按启动参数先打过一次，这里只是对齐）
  applyTheme(state.settings.theme);
  applyChatAppearance();

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

  // 读盘进来的字段定义不可信（手改过 JSON、老版本写的），过一遍归一化。
  // 只在真有坏数据时才重写这个键，免得给所有老会话平白加上一个空对象。
  for (const convo of state.conversations) {
    if (!convo || typeof convo !== 'object') continue;
    if (convo.panelDefs !== undefined) convo.panelDefs = normalizePanelDefs(convo.panelDefs);
    // 选项是程序写进去的，读盘时只要保证形状对（不是数组就当没有）
    if (!Array.isArray(convo.options)) convo.options = [];
    if (convo.optionsSpec && typeof convo.optionsSpec !== 'object') convo.optionsSpec = null;
  }

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
