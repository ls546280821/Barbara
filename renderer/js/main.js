'use strict';

// ============================================================================
//  main.js —— 界面逻辑的入口（跑在窗口里）
//  职责：画对话、把消息发给主进程、接收流式增量做「打字机」效果、存历史。
//
//  这里还在往 ES module 拆，分层是：
//    core/   底层：常量、状态、DOM 引用、preload 桥、工具函数
//    ui/     通用界面件：提示条、确认框、主题、Markdown
//    data/   纯逻辑：服务商/模型、角色库、面板、叙述规则、摘要、持久化、导入重发 id、导出收尾、
//            「谁在说话」（cast）、提示词组装（messages）、世界书召回（rag）、建议与剧情选项（suggestions）
//    views/  一个功能一块（refresh.js 刷新总线、header.js 对话头部、
//            perspectiveUi.js 视角设置、panelUi.js 状态面板、
//            player.js 玩家角色弹窗、memoryUi.js 记忆管理 + 存档点、
//            settings.js 设置弹窗、appearance.js 外观弹窗、
//            stream.js 流式绘制 + 自动跟随、chatImages.js 图片消息、
//            suggestionsUi.js 建议条 + 剧情选项、
//            viewSwitch.js 视图切换、characterList.js 角色列表页、
//            charAttributes.js 角色属性编辑器、characterEditor.js 角色编辑器弹窗、
//            characterImport.js 导入角色卡通道、
//            worldbookList.js 世界书列表页、worldbook.js 世界书编辑器）
//  这个文件现在只装「聊天」这一大块（消息渲染 / 会话管理 / 发送与流式 / 摘要 / 导出）
//  和入口层的编排，剩下的也会继续一块一块搬出去。
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
  seedIdentity,
  seedPanelFromCharacters,
  stripPanelLines,
  syncConvoPanel,
  syncPlayerNameFromPanel
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
  stashWorldbookForm
} from './views/worldbook.js';
import {
  initCharacterEditor,
  openCharacterEditor,
  closeCharsModal,
  startCharacterDraftInBook,
  releaseEditorScope,
  currentEditorCharacter,
  stashCharacterForm,
  deleteCharacterById
} from './views/characterEditor.js';
import { initCharacterImport, pickImportFiles, warnImportErrors } from './views/characterImport.js';

// 「设置弹窗里当前正在编辑的服务商」随设置弹窗一起搬到了 views/settings.js ——
// 入口层只在启动时把当前服务商带过去（setEditingProvider）。
// 「世界书弹窗里当前选中哪本书 / 哪条条目」随世界书编辑器一起搬到了
// views/worldbook.js —— 那是编辑器自己的状态，别处不需要知道。

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
  // 「当前编辑的角色」由角色编辑器持有 —— 这里只问一声（从它那儿取）
  const character = currentEditorCharacter();
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

  el.btnExportChar.addEventListener('click', exportCharacter);
  el.btnExportConvo.addEventListener('click', exportConversation);
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
    edit: (id) => openCharacterEditor(id, 'library'),
    chat: chatWithCharacter,
    remove: deleteCharacterById
  });
  // 角色编辑器自己绑弹窗里的按钮；它保存 / 删除之后要全量重绘，那是入口层的编排。
  initCharacterEditor({ rerender: () => renderAll() });
  // 导入通道：导完打开第一个新角色（那是编辑器的事），导入前先收一回编辑器里填的内容。
  initCharacterImport({
    openEditor: (id) => openCharacterEditor(id, 'library'),
    stashForm: () => stashCharacterForm()
  });
  // 世界书编辑器同理。它要切「角色编辑器作用域」再打开角色编辑器弹窗 ——
  // 那是跨视图编排，所以那几个动作由这里注入进去（视图不向上 import）。
  initWorldbook({
    importBooks: importWorldbooks,
    stashDraft: () => stashWorldbookForm(),
    openInBook: (id) => openCharacterEditor(id, 'worldbook'),
    draftInBook: () => startCharacterDraftInBook(),
    releaseScope: () => releaseEditorScope()
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
