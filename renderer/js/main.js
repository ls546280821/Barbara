'use strict';

// ============================================================================
//  main.js —— 界面逻辑的入口（跑在窗口里）
//  职责：画对话、把消息发给主进程、接收流式增量做「打字机」效果、存历史。
//
//  这里还在往 ES module 拆，分层是：
//    core/   底层：常量、状态、DOM 引用、preload 桥、工具函数
//    ui/     通用界面件：提示条、确认框、主题、Markdown
//    data/   纯逻辑：服务商/模型、角色库、面板、叙述规则、摘要、持久化、导入重发 id、导出收尾
//    views/  一个功能一块（refresh.js 刷新总线、header.js 对话头部、
//            perspectiveUi.js 视角设置、panelUi.js 状态面板、
//            player.js 玩家角色弹窗、memoryUi.js 记忆管理 + 存档点、
//            worldbookList.js 世界书列表页、worldbook.js 世界书编辑器）
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
import { uid, now, activeConvo, safeFileName } from './core/util.js';
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

import { persistConversations, persistLibrary, persistCharacters, markWorldbooksLoaded } from './data/persist.js';
import { saveExport } from './data/export.js';
import { reissueImportedIds } from './data/library-reissue.js';
import { providers, providerById, ensureConvoEndpoint, currentEndpoint } from './data/providers.js';
import {
  userName,
  convoPlayer,
  convoUserName,
  speakerName,
  worldbookCast,
  matchWorldbookSection
} from './data/cast.js';
import { applyMacros, messageImages, buildApiMessages } from './data/messages.js';
import { recallSection } from './data/rag.js';
import {
  suggestInstruction,
  parseSuggestions,
  syncConvoOptions
} from './data/suggestions.js';
import {
  characters,
  characterById,
  characterForConvo,
  characterAttrs,
  worldbooks,
  worldbookById,
  worldbookCharacters,
  newWorldbookCharId,
  convoWorldbookIds,
  worldbookPayload,
  WORLDBOOK_SCAN_DEPTH,
  recursiveDepthSetting
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
import { initSettings, setEditingProvider, openSettings, closeSettings } from './views/settings.js';
import { initAppearance, applyChatAppearance, closeAppearanceModal } from './views/appearance.js';
import { scrollToBottom, streamPainter, initStreamFollow } from './views/stream.js';
import {
  initChatImages,
  addImageFiles,
  buildMessageImages,
  illustrateMessage,
  getPendingImages,
  clearPendingImages
} from './views/chatImages.js';
import { initSuggestionsUi, pickOption, dropSuggestionsIfConvoChanged, suggestNextActions } from './views/suggestionsUi.js';
import { showView, refreshLibraryPage, initViewSwitch } from './views/viewSwitch.js';
import { initCharacterList, renderCharacterPage } from './views/characterList.js';
import {
  initWorldbook,
  editWorldbookFromPage,
  openWorldbookEditor,
  renderWorldbookChars,
  closeWorldbookCharPicker,
  stashWorldbookForm,
  currentWorldbook
} from './views/worldbook.js';

// 「设置弹窗里当前正在编辑的服务商」随设置弹窗一起搬到了 views/settings.js ——
// 入口层只在启动时把当前服务商带过去（setEditingProvider）。
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
// 「世界书弹窗里当前选中哪本书 / 哪条条目」随世界书编辑器一起搬到了
// views/worldbook.js —— 那是编辑器自己的状态，别处不需要知道。

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

/**
 * 导入进来的东西要重新发一批 id（并改写角色 → 世界书的指向）。
 * 实现搬到了 data/library-reissue.js —— 那段逻辑以前在两个导入函数里各有一份，
 * 而且夹在弹窗和落盘之间，测不到；「绑定指到不存在的书」这个 bug 就是这么漏掉的。
 */
function reissueImported(books, chars) {
  importSeq += 1;
  return reissueImportedIds(books, chars, `${Date.now().toString(36)}-${importSeq}`);
}

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
  // 建议是「针对某个会话的当前局面」给的 —— 换了会话就不该继续挂着。
  // 判断「挂的是不是当前会话」这件事只有建议条自己知道，所以交给它。
  dropSuggestionsIfConvoChanged();

  refreshAll(options);
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
//  导出
//
//  三种：角色卡（PNG / JSON）、世界书（JSON）、当前会话（Markdown）。
//  格式都对齐「导入」那条链路能读的形状，所以导出的东西能再导回来，
//  酒馆那边也认（角色卡是 v2 规范，世界书是 lorebook 规范）。
// ---------------------------------------------------------------------------

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
//  发送与流式接收
// ---------------------------------------------------------------------------

function setStreaming(on) {
  state.streaming = on;
  el.btnStop.classList.toggle('hidden', !on);
  el.btnSend.disabled = on;
}

async function sendMessage(text) {
  const content = String(text || '').trim();
  // 只带图不写字也算一条消息 —— 问「这是什么」不一定非要打字
  const images = getPendingImages();
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
  clearPendingImages();

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

  // 右上角切换模型
  el.modelSwitch.addEventListener('change', () => applyModelChoice(el.modelSwitch.value));

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
  el.btnImportCard.addEventListener('click', importCards);

  // 点头像换图 / 清除头像
  el.charAvatar.addEventListener('click', pickAvatar);
  el.btnClearAvatar.addEventListener('click', clearAvatar);

  // 状态面板的绑定（展开 / 收起 / 清空）在 views/panelUi.js 的 initPanelUi() 里。

  // 记忆管理：弹窗本体（开关 / 摘要增删改 / 存档点）在 views/memoryUi.js 里绑定。
  // 这里只留「手动压一段」—— 它要改头部的「正在整理记忆…」提示，
  // 等 header 独立成模块之后再让它归位。
  el.btnSummarizeNow.addEventListener('click', summarizeNow);

  // 进入世界前创建玩家角色
  el.btnClosePlayer.addEventListener('click', closePlayerModal);
  el.btnCancelPlayer.addEventListener('click', closePlayerModal);
  el.btnStartPlay.addEventListener('click', startWorldPlay);
  el.playerChar.addEventListener('change', applyPlayerCharChoice);
  el.playerModal.addEventListener('click', (event) => {
    if (event.target === el.playerModal) closePlayerModal();
  });

  // 左上角的昼夜切换
  el.btnTheme.addEventListener('click', toggleTheme);

  el.charsModal.addEventListener('click', (event) => {
    if (event.target === el.charsModal) closeCharsModal();
  });

  el.btnFolder.addEventListener('click', () => {
    api.openDataFolder('config').catch(() => {});
  });

  el.input.addEventListener('input', autoGrowInput);

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
 *
 * 刻意留在入口层：它要同时动角色库、世界书列表页、角色列表页 ——
 * 属于跨视图编排。世界书弹窗里的「导入」按钮由 initWorldbook 注入到这个函数。
 */
async function importWorldbooks() {
  const picked = await pickImportFiles({
    before: () => stashWorldbookForm(),
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
    openWorldbookEditor(freshBooks[freshBooks.length - 1].id);
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
  // 外观弹窗同理：改完即时生效 + 落盘，没有需要整体重绘的 DOM。
  initAppearance();
  // 「用户在看历史就别自动跟随」挂在消息区上，自己绑自己。
  initStreamFollow();
  // 加图按钮自己绑；配图成功后要重绘对话区、没配生图要弹设置 —— 都是入口层的动作。
  initChatImages({
    rerender: (opts) => renderAll(opts),
    openSettings
  });
  // 建议条自己绑关闭按钮；点建议 / 点剧情选项 = 发一条消息，那也是入口层的编排
  // （填输入框、让它长高、走发送流程）。
  initSuggestionsUi({
    send: sendMessage,
    growInput: autoGrowInput
  });
  // 侧边栏的「角色库 / 世界书」两个入口自己绑（切屏是 viewSwitch 自己的事）。
  initViewSwitch();
  // 角色卡上的三个按钮都跨分区（编辑要开编辑器、聊天要建会话并切屏、删除要解绑会话），
  // 所以由这里把动作交给列表页。
  initCharacterList({
    edit: editCharacterFromPage,
    chat: chatWithCharacter,
    remove: deleteCharacterById
  });
  // 世界书编辑器同理。它要切「角色编辑器作用域」再打开角色编辑器弹窗 ——
  // 那是跨视图编排，所以那几个动作由这里注入进去（视图不向上 import）。
  initWorldbook({
    importBooks: importWorldbooks,
    stashDraft: () => stashCharForm(),
    openInBook: (id) => {
      charEditorScope = 'worldbook';
      editingCharacterId = id;
      openCharsModal();
    },
    draftInBook: () => {
      charEditorScope = 'worldbook';
      startCharDraft();
    },
    releaseScope: () => {
      if (charEditorScope === 'worldbook') charEditorScope = 'library';
    }
  });
  // 设置弹窗同样只绑事件。它保存后要重绘「右上角切换器」和消息列表，
  // 那两样属于入口层（前者读会话状态、后者是聊天区），所以注入进去。
  initSettings({
    refreshModelSwitch: () => renderModelSwitch(),
    afterSettingsSave: () => {
      renderModelSwitch();
      renderMessages({ forceScroll: false });
    }
  });

  const config = await api.getSettings();
  state.settings = config.settings;
  state.presets = Array.isArray(config.presets) ? config.presets : [];
  setEditingProvider(state.settings.activeProviderId);

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
    markWorldbooksLoaded();
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
