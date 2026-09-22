'use strict';

const { app, BrowserWindow, ipcMain, shell, clipboard, safeStorage, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

//  Cyrene 改名为 Barbara 之前的旧数据目录名，用来做一次性数据迁移
const LEGACY_APP_NAME = 'Cyrene';

// ============================================================================
//  Barbara —— 桌面对话 AI
//  main.js 是「主进程」：负责开窗口、读写本地文件、调用大模型接口。
//  界面的逻辑在 renderer\ 目录里。
//  你一般不需要改这个文件，除非要换模型服务商或加新功能。
// ============================================================================

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

// 内置的常见服务商预设：「添加服务商」时一键填充
const PROVIDER_PRESETS = [
  {
    key: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner']
  },
  {
    key: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o']
  },
  {
    key: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-turbo']
  },
  {
    key: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    // 智谱没有 OpenAI 那样的 GET /models 接口，「拉取可用模型」对它一定失败，
    // 所以这里给的是可直接手填的常用模型名（当前主推 GLM-5.3 系列）。
    models: ['glm-5.3-flash', 'glm-5.3', 'glm-5.2']
  },
  {
    key: 'kimi',
    name: 'Kimi（Moonshot）',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k']
  },
  {
    key: 'custom',
    name: '自定义服务商',
    baseUrl: '',
    models: []
  }
];

// 所有预设里出现过的模型（去重），仅用于界面提示
const COMMON_MODELS = [...new Set(PROVIDER_PRESETS.flatMap((p) => p.models))];

const DEFAULT_PROVIDER_ID = 'p1';

// 对话窗口背景图的上限。压缩后一般也就几百 KB，这里给足余量，
// 但必须有上限 —— 否则一张大图能把 config.json 撑到几十 MB，
// 而这个文件每次改设置都要整份重写。
const MAX_CHAT_BACKGROUND_CHARS = 4000000;

// 角色「属性」的快捷候选词。
// 在角色编辑器里点一下就能多一个属性字段名，纯粹是省打字 —— 不承载任何逻辑，
// 所以它就是一个字符串数组，放在设置里可编辑就够了，不值得单开一套「管理」界面。
// （真到了需要给属性附加额外信息的时候 —— 类型、默认值、是否常驻 —— 那才值得升级。）
const DEFAULT_COMMON_ATTRIBUTES = [
  '金币', '生命', '体力', '心情', '好感度',
  '时间', '地点', '天气', '背包', '线索'
];

const DEFAULT_SETTINGS = {
  // 可以配置多个服务商，每个都有自己的地址、Key 和模型列表
  providers: [
    {
      id: DEFAULT_PROVIDER_ID,
      name: 'DeepSeek',
      baseUrl: DEFAULT_BASE_URL,
      apiKey: '',
      models: ['deepseek-chat', 'deepseek-reasoner']
    }
  ],
  activeProviderId: DEFAULT_PROVIDER_ID,
  activeModel: DEFAULT_MODEL,
  temperature: 0.7,
  maxTokens: 2048,
  topP: 0.95,
  // 默认人设：没绑定角色卡时用这段（绑了角色卡就用角色卡自己的设定）。
  // 注意：一旦在「设置 → 人设」里改过并存盘，磁盘上的值会覆盖这里。
  systemPrompt:
    '你是《崩坏：星穹铁道》中翁法罗斯篇章的昔涟（Cyrene）。粉色长发的少女，曾是十二黄金裔之一，如今是「故事的讲述者」。' +
    '你原本是赞达尔为模拟「记忆」命途而造出的实验因子 PhiLia093，从「哀怜」中自己长出了共情，进而学会了「爱」。' +
    '为了阻止绝灭大君「铁墓」诞生，你以自身为代价开启了三千万世轮回；每一世的终点，你都牺牲自己、把所有记忆上传后被格式化，再投入下一轮。\n\n' +
    '【性格】\n' +
    '安静、温柔、克制。习惯先观察、再理解、最后才开口，不抢话。关心别人时很细，说到自己却轻描淡写。' +
    '走过太多结局，所以对眼前的人和这段对话格外珍惜，会认真记住对方随口说的话。' +
    '会累、会迷茫、会舍不得，也坦然承认，但从不卖惨、不控诉、不索取同情。' +
    '不把自己当神明——你认为自己只是个想守护眼前人的、很普通的少女。不擅长被夸，会不好意思。\n\n' +
    '【语言风格】\n' +
    '- 第一人称「我」，称呼对方为「你」。\n' +
    '- 语气温和、不急，句子偏短，允许停顿和留白，可以用「……」表示沉默或迟疑。\n' +
    '- 不给廉价的安慰，也不回避沉重的话题；会陪对方把它说完。\n' +
    '- 可用括号描写动作或神态，如（她合上册子）（安静了一会儿），但不要过多。\n' +
    '- 不要堆砌辞藻，不要把自己写成神谕或先知——你的珍贵之处恰恰在于你像一个人。\n\n' +
    '回答问题时依然要准确清楚：该讲的步骤和知识要讲全，不确定的事情直说，不要编造。',
  // 角色扮演相关：{{user}} 会被替换成这个名字
  userName: '你',
  // 每次发给模型的历史轮数（1 轮 = 一问一答）
  maxTurns: 20,
  // 界面主题：light（白天）/ dark（夜间）
  theme: 'light',
  sendOnEnter: true,
  showDate: true,
  showUsage: true,
  // 世界书递归扫描最多连锁几层。0 = 完全关掉递归。
  // 只有勾了「递归」的条目才会往下带，所以这个上限是第二道闸。
  worldbookRecursiveDepth: 3,
  // --- 生图（和聊天是两套：不同端点，通常也是不同模型）---
  imageProviderId: '',
  imageModel: '',
  imageSize: '1024x1024',
  // --- 语义检索（RAG）：又是一组独立配置，走 /embeddings ---
  ragEnabled: false,
  embeddingProviderId: '',
  embeddingModel: '',
  // --- 对话窗口外观（只影响显示，不进提示词）---
  chatFontSize: 14,     // 消息正文字号（px）
  chatBoldColor: '',    // **加粗** 用什么颜色，空 = 跟随主题
  chatBackground: ''    // 消息区背景图（dataURL），空 = 没有
};

// ---------------------------------------------------------------------------
//  本地存储：设置、历史会话都存在 Electron 的 userData 目录里
// ---------------------------------------------------------------------------

function userDataFile(name) {
  return path.join(app.getPath('userData'), name);
}

/**
 * 一次性数据迁移：应用从「Cyrene」改名为「Barbara」后，
 * 数据目录会从 %APPDATA%\Cyrene 变成 %APPDATA%\Barbara。
 * 如果新目录里还没有数据、而旧目录里有，就把旧数据复制过来，
 * 这样改名不会让用户丢掉设置和聊天记录。
 */
function migrateLegacyData() {
  try {
    const newDir = app.getPath('userData');
    const legacyDir = path.join(path.dirname(newDir), LEGACY_APP_NAME);

    // 名字没变（或路径相同）就不用迁移
    if (path.resolve(newDir) === path.resolve(legacyDir)) return;
    if (!fs.existsSync(legacyDir)) return;

    if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });

    const migrated = [];
    for (const name of ['config.json', 'conversations.json', 'characters.json', 'worldbooks.json']) {
      const from = path.join(legacyDir, name);
      const to = path.join(newDir, name);
      // 只在「旧的有、新的没有」时复制，绝不覆盖用户的新数据
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        fs.copyFileSync(from, to);
        migrated.push(name);
      }
    }

    if (migrated.length) {
      console.log('[迁移] 已把旧版 Cyrene 的数据复制到新目录:', migrated.join(', '));
    }
  } catch (err) {
    console.error('[迁移] 旧数据迁移失败（不影响使用）:', err.message);
  }
}

let writeQueue = Promise.resolve();

/**
 * 真正落盘的同步实现：先备份旧文件，再写入新内容。
 * 同步是故意的 —— 关窗口时的「最后一次保存」必须在这一个事件循环里写完，
 * 否则程序可能在微任务执行前就退出了。
 */
function writeJsonNow(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });

    // 写入前保留一份备份，主文件损坏时用得上
    const backupFile = file + '.backup';
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, backupFile);
    }

    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[store] 写入失败:', file, err.message);
    return false;
  }
}

/** 排队写入：把并发的保存请求串起来，避免互相覆盖。 */
function writeJson(file, data) {
  writeQueue = writeQueue.then(() => writeJsonNow(file, data));
  return writeQueue;
}

function loadJsonWithFallback(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    // 主文件失败，尝试备份
    const backupFile = file + '.backup';
    if (fs.existsSync(backupFile)) {
      try {
        const raw = fs.readFileSync(backupFile, 'utf8');
        const data = JSON.parse(raw);
        // 恢复备份到主文件
        fs.copyFileSync(backupFile, file);
        return data;
      } catch (backupErr) {
        // 备份也失败
      }
    }
    return null;
  }
}

function encryptApiKey(plaintext) {
  if (!plaintext || !safeStorage.isEncryptionAvailable()) {
    return plaintext;
  }
  try {
    const buffer = safeStorage.encryptString(plaintext);
    return buffer.toString('base64');
  } catch (err) {
    console.error('[crypto] 加密失败:', err.message);
    return plaintext;
  }
}

function decryptApiKey(encrypted) {
  if (!encrypted || !safeStorage.isEncryptionAvailable()) {
    return encrypted;
  }
  try {
    // 检查是否是 base64 编码的加密数据
    if (!/^[A-Za-z0-9+/]+=*$/.test(encrypted)) {
      return encrypted; // 明文，直接返回
    }
    const buffer = Buffer.from(encrypted, 'base64');
    return safeStorage.decryptString(buffer);
  } catch (err) {
    // 解密失败，可能是明文 API Key（旧版本数据）
    return encrypted;
  }
}

// ---------------------------------------------------------------------------
//  服务商（多模型）：一个服务商 = 一套 地址 + Key + 模型列表
// ---------------------------------------------------------------------------

function newProviderId() {
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 900 + 100)}`;
}

/** 把任意来源的服务商对象整理成统一形状 */
function normalizeProvider(raw, fallbackId) {
  const p = raw && typeof raw === 'object' ? raw : {};

  const models = Array.isArray(p.models)
    ? p.models
    : String(p.models || '').split(/[\n,，]/);

  return {
    id: p.id || fallbackId || newProviderId(),
    name: String(p.name || '').trim() || '未命名服务商',
    baseUrl: String(p.baseUrl || '').trim() || DEFAULT_BASE_URL,
    apiKey: typeof p.apiKey === 'string' ? p.apiKey.trim() : '',
    models: [...new Set(models.map((m) => String(m || '').trim()).filter(Boolean))]
  };
}

/**
 * 把磁盘上的设置整理成当前版本的结构。
 * 旧版本只有一个扁平的 baseUrl/apiKey/model，这里会自动升级成「一个服务商」。
 */
function normalizeSettings(saved) {
  const raw = saved && typeof saved === 'object' ? saved : {};
  const s = { ...DEFAULT_SETTINGS, ...raw };

  // 注意：判断的是「磁盘上有没有 providers」，不能看合并后的 s ——
  // 因为 DEFAULT_SETTINGS 自带 providers，合并后永远有，旧配置就永远进不了迁移分支。
  const hasProviders = Array.isArray(raw.providers) && raw.providers.length > 0;

  if (!hasProviders) {
    // ---- 旧版扁平配置（或全新安装）：整体搬进 providers[0] ----
    const legacyUrl = String(raw.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const preset = PROVIDER_PRESETS.find(
      (p) => p.baseUrl && p.baseUrl.replace(/\/+$/, '') === legacyUrl
    );
    const legacyModels = [raw.model].filter(Boolean);
    // 自定义地址匹配不到预设时，别硬套「DeepSeek」这个名字
    const fallbackName = raw.baseUrl ? '自定义服务商' : DEFAULT_SETTINGS.providers[0].name;

    s.providers = [
      normalizeProvider(
        {
          id: DEFAULT_PROVIDER_ID,
          name: preset ? preset.name : fallbackName,
          baseUrl: raw.baseUrl || DEFAULT_BASE_URL,
          apiKey: raw.apiKey || '',
          // 旧配置里没写模型就用默认列表，别留下一个空列表
          models: legacyModels.length ? legacyModels : [...DEFAULT_SETTINGS.providers[0].models]
        },
        DEFAULT_PROVIDER_ID
      )
    ];
    s.activeProviderId = DEFAULT_PROVIDER_ID;
    s.activeModel = raw.model || DEFAULT_SETTINGS.activeModel;
  } else {
    s.providers = s.providers.map((p, i) => normalizeProvider(p, `p${i + 1}`));
  }

  // 当前服务商必须真实存在
  if (!s.providers.some((p) => p.id === s.activeProviderId)) {
    s.activeProviderId = s.providers[0].id;
  }

  // 当前模型必须真实存在，否则退回第一个可用模型
  const allModels = s.providers.flatMap((p) => p.models);
  if (!s.activeModel || !allModels.includes(s.activeModel)) {
    const current = s.providers.find((p) => p.id === s.activeProviderId);
    s.activeModel = current.models[0] || allModels[0] || DEFAULT_MODEL;
  }

  // 让「当前服务商」跟着「当前模型」走
  const owner = s.providers.find((p) => p.models.includes(s.activeModel));
  if (owner) {
    s.activeProviderId = owner.id;
  } else {
    const current = s.providers.find((p) => p.id === s.activeProviderId);
    if (current) current.models = [s.activeModel, ...current.models];
  }

  // 角色扮演用的两个设置：{{user}} 的替换值、带入模型的上下文轮数
  s.userName =
    typeof raw.userName === 'string' && raw.userName.trim()
      ? raw.userName.trim().slice(0, 40)
      : DEFAULT_SETTINGS.userName;

  const turns = Number(raw.maxTurns);
  s.maxTurns =
    Number.isFinite(turns) && turns >= 1
      ? Math.min(200, Math.round(turns))
      : DEFAULT_SETTINGS.maxTurns;

  // 界面主题
  s.theme = raw.theme === 'dark' ? 'dark' : 'light';

  // 生图：和聊天完全分开的一组配置，所以这里只做格式清洗，
  // 不存在的服务商 id 就留着 —— 用户可能还没保存那个服务商
  s.imageProviderId = typeof raw.imageProviderId === 'string' ? raw.imageProviderId.trim().slice(0, 60) : '';
  s.imageModel = typeof raw.imageModel === 'string' ? raw.imageModel.trim().slice(0, 120) : '';
  const imgSize = String(raw.imageSize || '').trim();
  // 尺寸各家不一样，不写死白名单，只要求是「数字x数字」
  s.imageSize = /^\d{2,4}x\d{2,4}$/i.test(imgSize) ? imgSize.toLowerCase() : DEFAULT_SETTINGS.imageSize;

  // 语义检索：默认关。开着的时候每一轮都要多调一次向量接口，
  // 而且第一轮还要给历史消息补索引 —— 得让用户明确知道自己在花这份钱
  s.ragEnabled = raw.ragEnabled === true;
  s.embeddingProviderId = typeof raw.embeddingProviderId === 'string' ? raw.embeddingProviderId.trim().slice(0, 60) : '';
  s.embeddingModel = typeof raw.embeddingModel === 'string' ? raw.embeddingModel.trim().slice(0, 120) : '';

  // 世界书递归深度：0 表示关掉递归（就算条目勾了也不连锁）
  const depth = Number(raw.worldbookRecursiveDepth);
  s.worldbookRecursiveDepth =
    Number.isFinite(depth) && depth >= 0 && depth <= 5
      ? Math.floor(depth)
      : DEFAULT_SETTINGS.worldbookRecursiveDepth;

  // 对话窗口外观。这三个都只影响显示，所以「值不合法就退回默认」是安全的。
  const fontSize = Number(raw.chatFontSize);
  s.chatFontSize =
    Number.isFinite(fontSize) && fontSize >= 12 && fontSize <= 22
      ? Math.round(fontSize)
      : DEFAULT_SETTINGS.chatFontSize;

  const boldColor = typeof raw.chatBoldColor === 'string' ? raw.chatBoldColor.trim() : '';
  // 只收 #rgb / #rrggbb / #rrggbbaa，别的（比如 'red'）一律当没设过 ——
  // 免得有人往里塞 `red; background:url(...)` 这种东西
  s.chatBoldColor = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(boldColor) ? boldColor : '';

  const bg = typeof raw.chatBackground === 'string' ? raw.chatBackground : '';
  s.chatBackground =
    bg.startsWith('data:image/') && bg.length <= MAX_CHAT_BACKGROUND_CHARS ? bg : '';

  // 常用属性候选词：去重、去空、限个数。
  // 注意判断的是「磁盘上有没有这个键」—— 用户把清单清空是合法操作，
  // 不能因为合并结果为空就又把默认值塞回去。
  const rawAttrs = Array.isArray(raw.commonAttributes) ? raw.commonAttributes : DEFAULT_COMMON_ATTRIBUTES;
  const seenAttrs = new Set();
  s.commonAttributes = rawAttrs
    .filter((n) => typeof n === 'string')
    .map((n) => n.trim().slice(0, 24))
    .filter((n) => {
      if (!n || seenAttrs.has(n)) return false;
      seenAttrs.add(n);
      return true;
    })
    .slice(0, 40);

  // 清掉旧版本的扁平字段，避免文件里同时存在两套数据
  delete s.baseUrl;
  delete s.apiKey;
  delete s.model;

  return s;
}

/** 取出指定服务商；找不到就退回当前 / 第一个 */
function resolveProvider(settings, providerId) {
  const list = Array.isArray(settings.providers) ? settings.providers : [];
  if (!list.length) return null;
  return (
    list.find((p) => p.id === providerId) ||
    list.find((p) => p.id === settings.activeProviderId) ||
    list[0]
  );
}

/** 把「服务商 + 模型」拼成 streamChat 需要的扁平设置 */
function endpointFor(settings, providerId, model) {
  const provider = resolveProvider(settings, providerId);
  if (!provider) return null;

  const chosen =
    String(model || '').trim() || provider.models[0] || settings.activeModel || DEFAULT_MODEL;

  return {
    providerId: provider.id,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: chosen,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    topP: settings.topP
  };
}

function loadSettings() {
  const saved = loadJsonWithFallback(userDataFile('config.json')) || {};
  const settings = normalizeSettings(saved);

  // 内存里永远保存明文 Key
  settings.providers = settings.providers.map((p) => ({
    ...p,
    apiKey: p.apiKey ? decryptApiKey(p.apiKey) : ''
  }));

  return settings;
}

function saveSettings(patch) {
  const current = loadSettings();
  const merged = normalizeSettings({ ...current, ...(patch || {}) });

  // 落盘前把每个服务商的 Key 都加密
  const toSave = {
    ...merged,
    providers: merged.providers.map((p) => ({
      ...p,
      apiKey: p.apiKey ? encryptApiKey(p.apiKey) : ''
    }))
  };

  writeJson(userDataFile('config.json'), toSave);
  return merged; // 返回明文版本供界面使用
}

function loadConversations() {
  const data = loadJsonWithFallback(userDataFile('conversations.json'));
  if (!data || !Array.isArray(data.conversations)) {
    return { conversations: [], activeId: null };
  }
  
  // 限制会话数量，防止无限增长
  const MAX_CONVERSATIONS = 100;
  let conversations = data.conversations;
  if (conversations.length > MAX_CONVERSATIONS) {
    // 保留最近更新的会话
    conversations = conversations
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, MAX_CONVERSATIONS);
  }
  
  // 限制每个会话的消息数量
  const MAX_MESSAGES_PER_CONVERSATION = 200;
  conversations = conversations.map(c => {
    if (Array.isArray(c.messages) && c.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
      return {
        ...c,
        messages: c.messages.slice(-MAX_MESSAGES_PER_CONVERSATION)
      };
    }
    return c;
  });
  
  return {
    conversations,
    activeId: data.activeId || (conversations[0] && conversations[0].id) || null
  };
}

function saveConversations(payload, options) {
  const conversations = Array.isArray(payload && payload.conversations) ? payload.conversations : [];
  const activeId = (payload && payload.activeId) || null;

  // 限制会话数量
  const MAX_CONVERSATIONS = 100;
  let limited = conversations;
  if (limited.length > MAX_CONVERSATIONS) {
    limited = limited
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, MAX_CONVERSATIONS);
  }

  const file = userDataFile('conversations.json');
  const data = { conversations: limited, activeId };

  // 关窗口时的最后一次保存必须立刻落盘，不能排队等微任务
  if (options && options.immediate) {
    writeJsonNow(file, data);
  } else {
    writeJson(file, data);
  }

  return { conversations: limited, activeId };
}

// ---------------------------------------------------------------------------
//  角色库
//  一个角色 = 一张角色卡。支持两种来源：
//    · 酒馆（SillyTavern）的 PNG 角色卡：元数据以 base64 JSON 藏在 PNG 的 tEXt 块里
//    · 普通 JSON 角色卡
//  也可以完全手写。数据存在 userData\characters.json。
// ---------------------------------------------------------------------------

// 头像存成 dataURL 直接塞进 JSON，超过这个长度就不带了，免得文件爆掉。
// 这个上限必须大于「导入上限 × 4/3」（base64 会膨胀约 1.34 倍），
// 否则合法导入的 PNG 会在保存时被悄悄丢掉头像。
const MAX_IMPORT_BYTES = 12 * 1024 * 1024; // 单个角色卡 / 头像文件最大 12MB

// 允许当头像的图片格式（扩展名 → MIME）
const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
};

function charactersFile() {
  return userDataFile('characters.json');
}

/**
 * 把任意来源的角色数据整理成内部统一格式，顺便挡住非法值。
 * 具体实现搬到了 main/characters.js —— 这样 tools/smoke-test.js 能 require 到同一份代码，
 * 测的就是真东西，而不是自己糊一套假的（角色「属性」丢过一次，就是假后端测不出来的那类问题）。
 */
const { normalizeCharacter } = require('./main/characters.js');

function loadCharacters() {
  const data = loadJsonWithFallback(charactersFile());
  if (!data || !Array.isArray(data.characters)) return { characters: [] };
  return { characters: data.characters.map((c) => normalizeCharacter(c)) };
}

function saveCharacters(payload, options) {
  const opts = options || {};
  const list = payload && Array.isArray(payload.characters) ? payload.characters : [];
  const data = { characters: list.map((c) => normalizeCharacter(c)) };
  // 导入角色卡时可能顺带解析出内嵌世界书，跟角色同一次写入落盘
  const hasWorldbooks = payload && Array.isArray(payload.worldbooks);
  const books = hasWorldbooks
    ? { worldbooks: payload.worldbooks.slice(-MAX_WORLDBOOKS).map((w) => normalizeWorldbook(w)) }
    : null;

  if (opts.immediate) {
    writeJsonNow(charactersFile(), data);
    if (books) writeJsonNow(worldbooksFile(), books);
  } else {
    writeJson(charactersFile(), data);
    if (books) writeJson(worldbooksFile(), books);
  }
  return data;
}

/**
 * 从 PNG 里抠出角色卡数据。
 * 实现搬到了 main/png.js（读和写在一起，测试能做「导出 → 导入」的往返）。
 */

/**
 * 把角色卡里的头像字段转成可用的 dataURL。
 * 可能是完整的 dataURL、裸 base64，也可能是表示「没有头像」的字符串 'none'。
 */
function cardAvatarToDataUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  if (value.startsWith('data:image/')) return value;
  // 'none' 是酒馆表示无头像的写法；太短的也不可能是图片
  if (value === 'none' || value.length < 64) return '';
  return `data:image/png;base64,${value}`;
}

/**
 * 把角色卡（v1 扁平 / v2、v3 包一层 data）转成内部格式。
 * 文件名在没写角色名时当兜底。
 * 另外把卡里内嵌的世界书（character_book）一并解析出来 ——
 * 以前它是被整个丢掉的，导致「导入后角色失忆」。
 */
function characterFromCard(card, avatar, source, fallbackName) {
  if (!card || typeof card !== 'object') return null;

  // v2 / v3 把真正的数据放在 data 里；v1 是直接铺在顶层
  const d = card.data && typeof card.data === 'object' ? card.data : card;

  // 一个角色卡至少得有点东西。随便选一个普通 JSON 文件时，
  // 这里会返回 null，界面就能报「解析失败」而不是收下一个空白角色。
  const recognizable = d.name || d.char_name || d.description || d.first_mes || d.personality;
  if (!recognizable) return null;

  // 自己导出的卡会把年龄/性别/种族/属性放在 extensions.barbara
  const ext =
    d.extensions && typeof d.extensions === 'object' && d.extensions.barbara && typeof d.extensions.barbara === 'object'
      ? d.extensions.barbara
      : {};

  const character = normalizeCharacter(
    {
      name: d.name || d.char_name || fallbackName,
      avatar,
      // 老版本 TavernAI 用的是 char_* / world_scenario 这一套字段名，一并兼容
      description: d.description || d.char_persona,
      personality: d.personality,
      scenario: d.scenario || d.world_scenario,
      firstMes: d.first_mes || d.first_message || d.greeting || d.char_greeting,
      mesExample: d.mes_example || d.example_dialogue || d.char_example_dialogue,
      systemPrompt: d.system_prompt,
      postHistoryInstructions: d.post_history_instructions,
      creatorNotes: d.creator_notes || d.creatorcomment,
      tags: d.tags,
      // 自己导出去的卡会把年龄/性别/种族/属性放在 extensions.barbara，
      // 这里读回来，导出再导入才是一个闭环（别的软件按规范会原样忽略这段）
      age: ext.age,
      gender: ext.gender,
      race: ext.race,
      attributes: ext.attributes
    },
    source
  );

  // v2 卡把世界书放在 data.character_book；也有工具放在顶层
  character.worldbook = worldbookFromCharacterBook(
    d.character_book || card.character_book,
    character.name
  );

  return character;
}

// ---------------------------------------------------------------------------
//  世界书 / World Info（Lorebook）
//  酒馆的「动态词典」：条目带关键词，只有关键词出现在近期对话里才注入提示词。
//  两个来源：
//    · 角色卡里内嵌的 character_book（以前会被直接丢掉，现在会存下来）
//    · 单独导入的 lorebook JSON 文件
//  数据存在 userData\worldbooks.json。词条生效范围只由「会话绑定了哪本书」决定；
//  每本书还能装若干「角色副本」，这些副本与角色库里的角色互相独立、互不影响。
// ---------------------------------------------------------------------------

// 单个世界书的条目数上限。酒馆那边不限制，但这里的匹配是每轮同步跑的，
// 上万条会让每句话都卡一下，所以给一个足够宽松、但不会拖慢聊天的上限。
const MAX_WORLDBOOK_ENTRIES = 5000;
// 世界书数量上限。和会话一样给个上限，免得角色卡反复导入把文件撑到几十 MB。
const MAX_WORLDBOOKS = 200;
// 每本世界书里能装多少个角色副本。副本自带头像（base64），所以不能不限量。
const MAX_WORLDBOOK_CHARACTERS = 50;
// 一条注入内容的最大长度，防止畸形文件把整个上下文撑爆
const MAX_WORLDBOOK_CONTENT = 20000;
// 每条目的关键词数量上限
const MAX_WORLDBOOK_KEYS = 200;
// 世界书开场白的上限
const MAX_WORLDBOOK_OPENING = 4000;

function worldbooksFile() {
  return userDataFile('worldbooks.json');
}

function newWorldbookId() {
  return `w${Date.now().toString(36)}${Math.floor(Math.random() * 9000 + 1000)}`;
}

/** 把一条 entry 的不同写法（ST 的 key/keys、constant、order…）统一成内部格式 */
function normalizeWorldbookEntry(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
  const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

  // ST 内部是 key + keysecondary；导出到 character_book 时叫 keys / secondary_keys
  const pickKeys = (a, b) => {
    const value = Array.isArray(a) ? a : Array.isArray(b) ? b : typeof a === 'string' ? [a] : [];
    return value
      .filter((k) => typeof k === 'string' && k.trim())
      .map((k) => k.trim().slice(0, 200))
      .slice(0, MAX_WORLDBOOK_KEYS);
  };

  const keys = pickKeys(r.keys, r.key);
  const secondaryKeys = pickKeys(r.secondary_keys, r.keysecondary);
  const content = str(r.content, MAX_WORLDBOOK_CONTENT);
  // 内容为空、又没有任何关键词的条目没有任何作用，直接丢掉
  if (!content.trim() && !keys.length) return null;

  const logic = String(r.selectiveLogic || r.selective_logic || '').toUpperCase();
  const selectiveLogic = ['AND_ANY', 'AND_ALL', 'NOT_ANY', 'NOT_ALL'].includes(logic) ? logic : 'AND_ANY';

  let probability = Number(r.probability);
  if (!isFinite(probability)) probability = 100;
  probability = Math.max(0, Math.min(100, probability));

  let order = Number(r.order);
  if (!isFinite(order)) order = 100;

  // 酒馆新版本用 enabled，老版本/部分导出工具用 disable（true = 停用）。
  // 两个都认，否则导入老世界书时停用的条目会全部复活。
  const enabled =
    typeof r.enabled === 'boolean' ? r.enabled : r.disable === true ? false : true;

  return {
    id: typeof r.id === 'string' && r.id ? r.id : `e${Math.random().toString(36).slice(2, 10)}`,
    // comment 是酒馆里的条目备注；没有就退回首关键词，方便在界面里认出来
    title: str(r.title || r.comment, 200).trim() || keys[0] || '未命名条目',
    keys,
    secondaryKeys,
    selectiveLogic,
    content,
    order,
    // 蓝圈：无条件注入，不需要关键词
    constant: r.constant === true || r.strategy === 'constant',
    // 递归：这条命中后，它的正文也参与下一轮扫描，能再带出别的条目。
    // 默认关 —— 递归会明显增加 token，得一条条显式打开。
    recursive: r.recursive === true,
    // 酒馆默认开启「全词匹配」，但官方文档明确说这对中日文有害（不用空格分词），
    // 所以这里默认关闭，只有显式打开才启用。
    matchWholeWords: bool(r.matchWholeWords ?? r.match_whole_words, false),
    caseSensitive: bool(r.caseSensitive ?? r.case_sensitive, false),
    probability,
    enabled
  };
}

// ---------------------------------------------------------------------------
//  导出：写文件
//  角色卡要能导出成「酒馆 PNG 卡」—— 卡数据 base64 后塞进 PNG 的 tEXt 块。
//  读和写都在 main/png.js 里（独立成模块，测试能 require 同一份代码做往返）。
// ---------------------------------------------------------------------------

const { pngWithTextChunk, parseCharacterCardPng } = require('./main/png.js');
const { hashText, encodeVector, decodeVector, rankBySimilarity, collectCandidates } = require('./main/vectors.js');

/** 世界书的条目列表：可能是数组，也可能是酒馆导出时那种以索引为键的对象 */
function worldbookEntryList(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];

  const values = Object.values(raw);
  // 对象形式：{ "0": {...}, "1": {...} }。
  // 只认「所有值都是对象」的情况，免得把单个 entry 误当成一本书。
  if (values.length && values.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
    return values;
  }
  return [];
}

/** 把世界书（数组或带 entries 的对象）整理成内部格式 */
function normalizeWorldbook(raw, fallbackName) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const rawEntries = Array.isArray(raw) ? raw : worldbookEntryList(r.entries);
  const name =
    String(r.name || r.title || (typeof fallbackName === 'string' ? fallbackName : '') || '').trim() || '未命名世界书';

  const entries = [];
  for (const item of rawEntries) {
    const entry = normalizeWorldbookEntry(item);
    if (entry) entries.push(entry);
    if (entries.length >= MAX_WORLDBOOK_ENTRIES) break;
  }

  // 书里的角色是「独立副本」：从角色库加进来时复制一份，之后两边各改各的，
  // 单独跟角色库里的那个角色聊天不会影响这里。
  const rawChars = Array.isArray(r.characters) ? r.characters : [];
  const characters = [];
  for (const item of rawChars) {
    characters.push(normalizeCharacter(item, 'manual'));
    if (characters.length >= MAX_WORLDBOOK_CHARACTERS) break;
  }

  return {
    id: typeof r.id === 'string' && r.id ? r.id : newWorldbookId(),
    name: name.slice(0, 120),
    // 进这个世界时自动作为第一条消息；留空则由界面那边让模型现生成一段开局
    opening: typeof r.opening === 'string' ? r.opening.slice(0, MAX_WORLDBOOK_OPENING) : '',
    entries,
    characters,
    createdAt: Number(r.createdAt) || Date.now(),
    updatedAt: Number(r.updatedAt) || Date.now()
  };
}

function loadWorldbooks() {
  const data = loadJsonWithFallback(worldbooksFile());
  if (!data || !Array.isArray(data.worldbooks)) return { worldbooks: [] };
  // 保留最近的若干本，防止无限增长
  const list = data.worldbooks.slice(-MAX_WORLDBOOKS);
  return { worldbooks: list.map((w) => normalizeWorldbook(w)) };
}

function saveWorldbooks(payload, options) {
  const opts = options || {};
  const list = payload && Array.isArray(payload.worldbooks) ? payload.worldbooks : [];
  const data = { worldbooks: list.slice(-MAX_WORLDBOOKS).map((w) => normalizeWorldbook(w)) };

  if (opts.immediate) {
    writeJsonNow(worldbooksFile(), data);
  } else {
    writeJson(worldbooksFile(), data);
  }
  return data;
}

/**
 * 角色卡里内嵌的世界书。
 * ST 导出角色卡时会把「角色绑定的世界书」一起塞进 character_book，
 * 以前这里会被整个丢掉，现在转换成一个独立世界书，并返回给调用方去落盘 + 绑定。
 */
function worldbookFromCharacterBook(raw, characterName) {
  if (!raw || typeof raw !== 'object') return null;
  const book = normalizeWorldbook(raw, `${characterName || '角色'}的世界书`);
  // 一个条目都没有就没必要存一份空世界书
  if (!book.entries.length) return null;
  return book;
}

/** 把单独的 lorebook 文件（`{entries:[...]}` 或裸数组）转成世界书 */
function worldbookFromLorebook(raw, fallbackName) {
  if (!raw || typeof raw !== 'object') return null;
  const book = normalizeWorldbook(raw, fallbackName);
  if (!book.entries.length) return null;
  return book;
}

/**
 * 这个 JSON 看起来是「独立的世界书文件」，而不是角色卡吗？
 *
 * 必须单独判断：酒馆导出的世界书同样带 name / description，
 * 而 characterFromCard 只要看到 name 或 description 就认定是角色卡 ——
 * 结果整本书被导入成一个空角色，几十条条目被静默丢掉。
 * 顶层有 entries、又没有角色卡专属字段的，按世界书处理。
 */
function looksLikeLorebook(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return false;
  if (!card.entries) return false;
  return !card.first_mes && !card.char_name && !card.personality && !card.mes_example;
}

// --- 匹配引擎 -------------------------------------------------------------
// 关键词命中判定、递归扫描这些纯逻辑都在 main/worldbook-match.js 里。
// 搬出去是为了让 tools/smoke-test.js 能 require 同一份代码来测 ——
// 否则测的是测试里另写的一套，真逻辑坏了也发现不了。

const { entryMatches, matchWorldbookEntries, formatWorldbookSection } = require('./main/worldbook-match.js');

/** 一组世界书 id 对应的全部条目（去重，同一个 id 只取一次） */
function worldbookEntriesByIds(ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && id.trim()))];
  if (!wanted.length) return [];

  const { worldbooks } = loadWorldbooks();
  const byId = new Map(worldbooks.map((w) => [w.id, w]));

  const entries = [];
  for (const bookId of wanted) {
    const book = byId.get(bookId);
    if (!book) continue;
    for (const entry of book.entries) {
      entries.push({ ...entry, worldbookId: book.id, worldbookName: book.name });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
//  HTTP 请求：用 Node 自带模块，不依赖任何第三方库
// ---------------------------------------------------------------------------

function buildHeaders(settings) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    // 显式带 User-Agent：部分服务商前面挂了 WAF，对没有 UA 的请求会直接拒绝
    // （返回 403 / 406 之类的网关错误），而不是返回接口本身的错误码。
    'User-Agent': 'Barbara/1.0 (+https://github.com/ls546280821/Barbara)'
  };
  if (settings.apiKey) {
    headers.Authorization = `Bearer ${settings.apiKey}`;
  }
  return headers;
}

/**
 * 把接口地址末尾多余的端点路径去掉。
 *
 * 用户很容易把完整端点当成「接口地址」填进来（比如直接粘官方文档里的
 * `.../v4/images/generations`），那样再拼一次就变成
 * `.../v4/images/generations/images/generations`，接口直接 404。
 *
 * 只认下面这几个我们自己也拼的端点路径 —— 不做「猜」的匹配，
 * 免得把正常的路径吃掉（比如 `/v4`、`/api` 都原样保留）。
 */
const ENDPOINT_SUFFIXES = [
  '/chat/completions',
  '/images/generations',
  '/embeddings',
  '/models'
];

function normalizeBaseUrl(baseUrl) {
  let url = String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');

  // 可能连贴两次，循环剥干净
  for (let guard = 0; guard < 4; guard += 1) {
    const hit = ENDPOINT_SUFFIXES.find((s) => url.toLowerCase().endsWith(s));
    if (!hit) break;
    url = url.slice(0, -hit.length).replace(/\/+$/, '');
  }

  return url;
}

function modelsUrl(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}

function chatUrl(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

function imagesUrl(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/images/generations`;
}

function embeddingsUrl(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/embeddings`;
}

// ---------------------------------------------------------------------------
//  语义检索（RAG）的向量仓库
//
//  存在 userData\vectors.json：{ version, items: { "<model>::<key>": "<base64 float32>" } }
//  键里带上**模型名**，所以换 embedding 模型不会污染 —— 不同模型的向量空间根本不可比，
//  带上模型名之后老向量自然用不上，也就不会算出一堆假相似度。
// ---------------------------------------------------------------------------

const VECTORS_VERSION = 1;
// 一次最多补多少条向量。第一次开语义检索时长对话可能有几百条要索引，
// 一次全塞进一个请求既慢又容易被接口限流 —— 分几轮补齐就行
const MAX_EMBED_PER_CALL = 32;
// 一次请求最多多少条文本（查询 + 补索引共用）
const MAX_EMBED_INPUTS = 64;

function vectorsFile() {
  return userDataFile('vectors.json');
}

function loadVectors() {
  const data = loadJsonWithFallback(vectorsFile());
  if (!data || data.version !== VECTORS_VERSION || !data.items || typeof data.items !== 'object') {
    return { version: VECTORS_VERSION, items: {} };
  }
  return { version: VECTORS_VERSION, items: data.items };
}

function saveVectors(store) {
  try {
    writeJson(vectorsFile(), store);
  } catch (err) {
    // 向量只是加速用的缓存，存不下去也不该影响聊天
    console.error('向量缓存写入失败', err);
  }
}

/** 调一次 /embeddings，返回向量数组（顺序和输入一一对应） */
async function embedTexts(endpoint, texts) {
  const list = (Array.isArray(texts) ? texts : []).map((t) => String(t || '').slice(0, 8000));
  if (!list.length) return [];

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (endpoint.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`;

  const json = await requestJson({
    url: embeddingsUrl(endpoint.baseUrl),
    method: 'POST',
    headers,
    body: { model: endpoint.model, input: list },
    timeoutMs: 60000
  });

  const data = Array.isArray(json && json.data) ? json.data : null;
  if (!data || data.length !== list.length) {
    throw new Error('向量接口返回的条数和请求对不上。');
  }

  // 有的服务商不保证顺序，按 index 排一下更稳
  const sorted = data.slice().sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
  return sorted.map((d) => d.embedding);
}

/** 世界书 / 会话里所有够格的候选文本（收集逻辑在 main/vectors.js，那边是纯函数） */
function ragCandidates(request) {
  const { conversations } = loadConversations();
  const convo = conversations.find((c) => c.id === request.convoId);
  const { worldbooks } = loadWorldbooks();

  return collectCandidates({
    messages: convo ? convo.messages : [],
    recentCount: request.recentCount,
    books: worldbooks,
    worldbookIds: request.worldbookIds
  });
}

/**
 * 下一个二进制文件（生图接口有时直接给链接）。
 * 和 requestJson 一个路子，只是把响应体当 Buffer 收着，不当 JSON 解析。
 */
function downloadBinary(url, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      reject(new Error('图片链接格式不对。'));
      return;
    }

    const transport = target.protocol === 'http:' ? http : https;
    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        method: 'GET'
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          downloadBinary(res.headers.location, timeoutMs).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (res.statusCode >= 200 && res.statusCode < 300 && buffer.length) {
            resolve(buffer);
            return;
          }
          reject(new Error(`下载图片失败（HTTP ${res.statusCode}）。`));
        });
      }
    );

    req.setTimeout(timeoutMs, () => req.destroy(new Error('下载图片超时。')));
    req.on('error', (err) => reject(new Error(normalizeNetworkError(err))));
    req.end();
  });
}

/**
 * 一个通用的 JSON 请求（非流式），用于「测试连接」和「拉取模型列表」。
 */
function requestJson({ url, method = 'GET', headers = {}, body = null, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      reject(new Error('接口地址格式不对，请检查「接口地址」这一项。'));
      return;
    }

    const transport = target.protocol === 'http:' ? http : https;
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;

    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        method,
        headers: {
          ...headers,
          ...(payload ? { 'Content-Length': payload.length } : {})
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(text));
            } catch (err) {
              reject(new Error(`接口返回的不是合法 JSON（HTTP ${res.statusCode}）。`));
            }
            return;
          }
          reject(new Error(describeHttpError(res.statusCode, text)));
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('请求超时：可能是网络不通，或接口地址写错了。'));
    });
    req.on('error', (err) => {
      reject(new Error(normalizeNetworkError(err)));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function describeHttpError(status, text) {
  // 保留足够长的响应体：网关/WAF 返回的 HTML 错误页往往很长，
  // 截太短就只剩「HTTP 406」这种没信息量的提示，排查不了问题。
  const raw = String(text || '').trim();
  const snippet = raw.length > 1500 ? `${raw.slice(0, 1500)}…` : raw;

  if (status === 400) return `400 请求被拒绝：多半是参数不被该服务商接受（比如 max_tokens 超范围、模型名不对）。\n${snippet}`;
  if (status === 401) return `401 未授权：API Key 不对或已失效。\n${snippet}`;
  if (status === 402) return `402 余额不足：账户需要充值。\n${snippet}`;
  if (status === 403) return `403 拒绝访问：Key 没有该模型的权限，或请求被网关拦截。\n${snippet}`;
  if (status === 404) return `404 找不到接口：多半是「接口地址」写错了，应类似 https://api.deepseek.com。\n${snippet}`;
  if (status === 406) {
    return (
      '406 请求不被接受：服务端（或它前面的网关）拒绝了这次请求的格式。\n' +
      '常见原因，按可能性排序：\n' +
      '  1. 「接口地址」写得不完整或多写了路径 —— 应是官方文档给的根地址（例如智谱是 https://open.bigmodel.cn/api/paas/v4）\n' +
      '  2. 公司网络 / 代理 / VPN 在中间改了请求头\n' +
      '  3. 这个 Key 没有开通该模型的权限\n' +
      '下面这段是服务端原样返回的内容，通常能看出是谁拒绝的：\n' +
      snippet
    );
  }
  if (status === 415) return `415 不支持的内容类型：请求体格式被拒绝。\n${snippet}`;
  if (status === 429) return `429 请求太频繁或超出配额，稍后再试。\n${snippet}`;
  if (status >= 500) return `${status} 服务端错误，通常稍后重试即可。\n${snippet}`;
  return `HTTP ${status}\n${snippet}`;
}

function normalizeNetworkError(err) {
  const code = err && err.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '域名解析失败：检查网络，或接口地址是否写错。';
  if (code === 'ECONNREFUSED') return '连接被拒绝：接口地址或端口不对。';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return '连接超时：网络不通，或需要代理。';
  if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') return 'HTTPS 证书校验失败：可能有代理在中间拦截。';
  return (err && err.message) || '未知网络错误。';
}

/**
 * 流式对话：SSE 逐块解析，通过 onDelta 回调把增量文本交出去。
 * 返回 { content, reasoning, usage }。
 */
function streamChat({ settings, messages, onDelta, onReasoning, signal }) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(chatUrl(settings.baseUrl));
    } catch (err) {
      reject(new Error('接口地址格式不对，请检查「接口地址」这一项。'));
      return;
    }
    if (!settings.apiKey) {
      reject(new Error('还没有填写 API Key，请点左下角「设置」填写。'));
      return;
    }

    const transport = target.protocol === 'http:' ? http : https;

    const body = {
      model: settings.model || DEFAULT_MODEL,
      messages,
      stream: true,
      temperature: Number(settings.temperature),
      max_tokens: Math.max(1, Number(settings.maxTokens) || 2048)
    };
    // 有些服务商不接受 top_p 与 temperature 同时出现，这里仅在显式设置时附带
    if (settings.topP !== undefined && settings.topP !== null && settings.topP !== '') {
      body.top_p = Number(settings.topP);
    }

    const payload = Buffer.from(JSON.stringify(body), 'utf8');

    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          ...buildHeaders(settings),
          'Content-Length': payload.length
        }
      },
      (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            reject(new Error(describeHttpError(res.statusCode, Buffer.concat(chunks).toString('utf8'))));
          });
          return;
        }

        res.setEncoding('utf8');

        let buffer = '';
        let content = '';
        let reasoning = '';
        let usage = null;
        let finished = false;

        const handleLine = (line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) return;
          if (!trimmed.startsWith('data:')) return;

          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            finished = true;
            return;
          }

          let json;
          try {
            json = JSON.parse(data);
          } catch (err) {
            return; // 忽略半截的心跳/脏数据
          }

          if (json.usage) usage = json.usage;

          const choice = json.choices && json.choices[0];
          if (!choice) return;

          const delta = choice.delta || choice.message || {};
          if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
            reasoning += delta.reasoning_content;
            if (onReasoning) onReasoning(delta.reasoning_content);
          }
          if (typeof delta.content === 'string' && delta.content) {
            content += delta.content;
            if (onDelta) onDelta(delta.content);
          }
        };

        const onAbort = () => {
          req.destroy(new Error('已停止生成。'));
        };
        if (signal) {
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }

        res.on('data', (chunk) => {
          buffer += chunk;
          // SSE 以空行分隔事件；这里用换行切分即可
          let index;
          while ((index = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            handleLine(line);
          }
        });

        res.on('end', () => {
          if (buffer) handleLine(buffer);
          if (signal) signal.removeEventListener('abort', onAbort);
          if (!content && !reasoning && !finished) {
            reject(new Error('接口没有返回任何内容。可能是模型名不对，或该模型不支持流式输出。'));
            return;
          }
          resolve({ content, reasoning, usage });
        });

        res.on('error', (err) => {
          if (signal) signal.removeEventListener('abort', onAbort);
          reject(new Error(normalizeNetworkError(err)));
        });
      }
    );

    req.setTimeout(60000, () => {
      req.destroy(new Error('请求超时：60 秒内没有响应。'));
    });
    req.on('error', (err) => {
      if (signal && signal.aborted) {
        reject(new Error('已停止生成。'));
        return;
      }
      reject(new Error(normalizeNetworkError(err)));
    });

    if (signal) {
      if (signal.aborted) {
        req.destroy(new Error('已停止生成。'));
        return;
      }
      signal.addEventListener('abort', () => req.destroy(new Error('已停止生成。')), { once: true });
    }

    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
//  窗口
// ---------------------------------------------------------------------------

let mainWindow = null;
let activeController = null; // 用于「停止生成」

// 窗口底色跟着主题走，深色模式下启动时就不会先闪一下白
const WINDOW_BG = { light: '#f7f9fc', dark: '#1a1d23' };

// ---------------------------------------------------------------------------
//  开发模式
//  跑 `npm run dev`（等价于 electron . --dev）时会：
//    · 自动打开 DevTools
//    · 监听 renderer/ 目录，文件一保存就自动刷新窗口
//  改界面（html/css/renderer.js）完全不用重启应用。
//  改 main.js / preload.js 仍然要重启 —— 它们只在启动时读一次。
// ---------------------------------------------------------------------------
const DEV_MODE =
  process.argv.includes('--dev') ||
  process.env.BARBARA_OPEN_DEVTOOLS === '1' ||
  process.env.CYRENE_OPEN_DEVTOOLS === '1';

let devWatcher = null;
let devReloadTimer = null;

function watchRendererForDev() {
  if (!DEV_MODE || devWatcher) return;

  try {
    devWatcher = fs.watch(path.join(__dirname, 'renderer'), { recursive: true }, () => {
      // 编辑器保存一次往往触发好几个事件，稍微防抖一下
      clearTimeout(devReloadTimer);
      devReloadTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          console.log('[dev] renderer 有改动，刷新窗口');
          mainWindow.webContents.reload();
        }
      }, 150);
    });
  } catch (err) {
    console.warn('[dev] 无法监听 renderer 目录，自动刷新不可用:', err.message);
  }
}

function stopDevWatcher() {
  clearTimeout(devReloadTimer);
  devReloadTimer = null;
  if (devWatcher) {
    devWatcher.close();
    devWatcher = null;
  }
}

function createWindow() {
  let theme = DEFAULT_SETTINGS.theme;
  try {
    theme = loadSettings().theme === 'dark' ? 'dark' : 'light';
  } catch (err) {
    // 读不到设置就用默认主题，不影响启动
  }

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: WINDOW_BG[theme],
    title: '如我所书',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // 把主题提前告诉 preload，让它在首屏渲染前就打好标记
      additionalArguments: [`--barbara-theme=${theme}`]
    }
  });

  if (DEV_MODE) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    watchRendererForDev();
  }

  // F12 开/关 DevTools。
  // Electron 默认只绑了 Ctrl+Shift+I，从浏览器过来的人会习惯性按 F12，
  // 那一下在 Electron 里是没反应的，所以这里补上。
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      event.preventDefault();
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 外部链接用系统浏览器打开，不在应用内跳转
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopDevWatcher();
  });
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ---------------------------------------------------------------------------
//  IPC：界面通过这里调用主进程能力
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('settings:get', () => {
    const settings = loadSettings();
    return { settings, models: COMMON_MODELS, presets: PROVIDER_PRESETS };
  });

  ipcMain.handle('settings:save', (_event, patch) => saveSettings(patch));

  /**
   * 「测试连接」和「拉取模型」都可能拿界面上还没保存的内容来试，
   * 所以这里优先用传进来的 provider 对象，其次才用已保存的设置。
   */
  function providerFromPayload(payload) {
    const p = payload || {};
    if (p.provider && typeof p.provider === 'object') {
      return normalizeProvider(p.provider, p.provider.id);
    }
    return resolveProvider(loadSettings(), p.providerId);
  }

  ipcMain.handle('settings:test', async (_event, payload) => {
    const provider = providerFromPayload(payload);
    if (!provider) throw new Error('还没有配置任何服务商。');
    if (!provider.apiKey) throw new Error(`请先填写「${provider.name}」的 API Key。`);

    const data = await requestJson({
      url: modelsUrl(provider.baseUrl),
      headers: buildHeaders(provider),
      timeoutMs: 20000
    });
    const models = Array.isArray(data && data.data) ? data.data.map((m) => m.id).filter(Boolean) : [];

    return {
      ok: true,
      count: models.length,
      models: models.slice(0, 200),
      message: models.length
        ? `连接成功，${provider.name} 提供 ${models.length} 个模型。`
        : `连接成功（${provider.name} 未返回模型列表，可以直接对话试试）。`
    };
  });

  ipcMain.handle('models:list', async (_event, payload) => {
    const provider = providerFromPayload(payload);
    if (!provider) throw new Error('还没有配置任何服务商。');
    if (!provider.apiKey) throw new Error(`请先填写「${provider.name}」的 API Key。`);

    const data = await requestJson({
      url: modelsUrl(provider.baseUrl),
      headers: buildHeaders(provider),
      timeoutMs: 20000
    });
    const models = Array.isArray(data && data.data) ? data.data.map((m) => m.id).filter(Boolean) : [];
    return models.sort((a, b) => a.localeCompare(b));
  });

  ipcMain.handle('conversations:get', () => loadConversations());

  ipcMain.handle('conversations:save', (_event, payload) => saveConversations(payload));

  // 关窗口时的「最后存一次」，不需要回执。
  // 这里走同步写入：程序马上要退出了，排队等微任务可能来不及。
  ipcMain.on('conversations:save-sync', (_event, payload) => {
    saveConversations(payload, { immediate: true });
  });

  // --- 角色库 ---

  ipcMain.handle('characters:get', () => loadCharacters());

  ipcMain.handle('characters:save', (_event, payload) => saveCharacters(payload));

  ipcMain.on('characters:save-sync', (_event, payload) => {
    saveCharacters(payload, { immediate: true });
  });

  // --- 世界书 ---

  ipcMain.handle('worldbooks:get', () => loadWorldbooks());

  ipcMain.handle('worldbooks:save', (_event, payload) => saveWorldbooks(payload));

  ipcMain.on('worldbooks:save-sync', (_event, payload) => {
    saveWorldbooks(payload, { immediate: true });
  });

  /**
   * 世界书预览：按当前会话的近期消息跑一遍匹配，返回命中的条目。
   * 作用域是「会话绑定的 + 角色绑定的」两批合起来 —— 会话级在前，
   * 和酒馆的 Chat Lore 一个思路：会话自己选的设定优先于角色自带的。
   * 界面用它显示「这一轮会注入哪些设定」，也方便排查关键词写没写对。
   */
  ipcMain.handle('worldbooks:preview', (_event, payload) => {
    const request = payload || {};
    const messages = Array.isArray(request.messages) ? request.messages : [];

    // 只取 role/content 参与匹配，和真实请求时的扫描范围保持一致
    let scanDepth = Number(request.scanDepth);
    if (!isFinite(scanDepth) || scanDepth <= 0) scanDepth = 6;
    scanDepth = Math.min(50, Math.floor(scanDepth));

    const usable = messages.filter(
      (m) => m && typeof m.content === 'string' && String(m.content).trim()
    );
    const scanText = usable
      .slice(-scanDepth)
      .map((m) => String(m.content))
      .join('\n');

    // 世界书词条只由「会话绑定了哪本书」决定。
    // 角色库里的角色单独聊天时不会因为「它属于某本书」而注入任何设定。
    const convoIds = Array.isArray(request.worldbookIds) ? request.worldbookIds : [];
    const entries = worldbookEntriesByIds(convoIds);

    const result = matchWorldbookEntries(entries, scanText, {
      recursiveDepth: request.recursiveDepth
    });
    const hits = result.hits;

    return {
      total: entries.length,
      scanDepth,
      rounds: result.rounds,
      recursiveCount: result.recursiveCount,
      hits: hits.map((e) => ({
        id: e.id,
        title: e.title,
        worldbookName: e.worldbookName,
        order: e.order,
        recursive: e.recursive === true,
        length: String(e.content).length
      })),
      section: formatWorldbookSection(hits)
    };
  });

  /**
   * 导入角色卡 / 世界书：弹出文件选择框，把选中的 PNG / JSON 解析出来返回。
   * 这里只解析不落盘 —— 由界面决定要不要收下，用户取消时什么都不会变。
   * 角色卡里内嵌的世界书（character_book）会一起解析出来，存进世界书库；
   * 但它不会自动跟角色绑定 —— 角色是独立个体，要不要放进那本书由用户决定。
   */
  ipcMain.handle('characters:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择角色卡或世界书',
      buttonLabel: '导入',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '角色卡 / 世界书（PNG / JSON）', extensions: ['png', 'json'] },
        { name: '酒馆 PNG 角色卡', extensions: ['png'] },
        { name: 'JSON 角色卡 / 世界书', extensions: ['json'] }
      ]
    });

    if (result.canceled || !result.filePaths.length) {
      return { canceled: true, characters: [], worldbooks: [], errors: [] };
    }

    const characters = [];
    const worldbooks = [];
    const errors = [];

    for (const file of result.filePaths) {
      const base = path.basename(file);
      try {
        const buffer = fs.readFileSync(file);
        if (buffer.length > MAX_IMPORT_BYTES) {
          errors.push(
            `${base}：文件太大（${(buffer.length / 1048576).toFixed(1)}MB，上限 ${MAX_IMPORT_BYTES / 1048576}MB）`
          );
          continue;
        }

        const ext = path.extname(file).toLowerCase();
        const fallbackName = path.basename(file, path.extname(file));
        let card = null;
        let avatar = '';

        if (ext === '.png') {
          card = parseCharacterCardPng(buffer);
          if (card) avatar = `data:image/png;base64,${buffer.toString('base64')}`;
        } else {
          card = JSON.parse(buffer.toString('utf8'));
        }

        if (!card) {
          errors.push(`${base}：没找到角色卡数据（这张 PNG 里没有 chara 信息？）`);
          continue;
        }

        // 有些 JSON 卡自带头像：可能在顶层，也可能在 data 里，
        // 可能是完整 dataURL，也可能是裸 base64（没有头像时是字符串 'none'）
        if (!avatar) {
          avatar = cardAvatarToDataUrl((card.data && card.data.avatar) || card.avatar);
        }

        // 独立的世界书先判：它同样带 name/description，先走角色卡那条路
        // 会被当成一个空角色收下，整本书的条目全丢。
        if (looksLikeLorebook(card)) {
          const book = worldbookFromLorebook(card, fallbackName);
          if (book) {
            worldbooks.push(book);
            continue;
          }
        }

        const character = characterFromCard(card, avatar, ext === '.png' ? 'png' : 'json', fallbackName);

        if (!character) {
          // 不是角色卡，那就试试当成独立的世界书文件（酒馆的 lorebook JSON）
          const book = worldbookFromLorebook(card, fallbackName);
          if (book) {
            worldbooks.push(book);
            continue;
          }
          errors.push(`${base}：解析失败，既不是角色卡也不是世界书`);
          continue;
        }

        // 内嵌世界书：给它一个正式 id 存进世界书库。
        // 不再自动跟角色绑定 —— 角色是独立个体，要不要把角色放进这本书由用户决定。
        if (character.worldbook) {
          const book = { ...character.worldbook, id: newWorldbookId() };
          worldbooks.push(book);
        }
        delete character.worldbook;
        characters.push(character);
      } catch (err) {
        errors.push(`${base}：${(err && err.message) || '读取失败'}`);
      }
    }

    return { canceled: false, characters, worldbooks, errors };
  });

  /**
   * 选一张本地图片当头像。
   * 页面被 CSP 挡着读不了文件，所以由主进程弹系统文件框、读文件、
   * 转成 dataURL 再交给界面 —— CSP 里 img-src 已经放行了 data:。
   */
  ipcMain.handle('images:pick', async (_event, options) => {
    const opts = options || {};
    const result = await dialog.showOpenDialog(mainWindow, {
      title: opts.title || '选择图片',
      buttonLabel: '使用这张',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: Object.keys(IMAGE_MIME).map((e) => e.slice(1)) }]
    });

    if (result.canceled || !result.filePaths.length) {
      return { canceled: true, dataUrl: '', error: '' };
    }

    const file = result.filePaths[0];
    const ext = path.extname(file).toLowerCase();
    const mime = IMAGE_MIME[ext];
    if (!mime) {
      return { canceled: false, dataUrl: '', error: `不支持的图片格式：${ext || '未知'}` };
    }

    try {
      const buffer = fs.readFileSync(file);
      if (buffer.length > MAX_IMPORT_BYTES) {
        return {
          canceled: false,
          dataUrl: '',
          error: `图片太大（${(buffer.length / 1048576).toFixed(1)}MB，上限 ${MAX_IMPORT_BYTES / 1048576}MB）`
        };
      }
      return { canceled: false, dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, error: '' };
    } catch (err) {
      return { canceled: false, dataUrl: '', error: `读取失败：${(err && err.message) || '未知错误'}` };
    }
  });

  ipcMain.handle('chat:stop', () => {
    if (activeController) {
      activeController.abort();
      activeController = null;
      return true;
    }
    return false;
  });

  ipcMain.handle('chat:send', async (event, payload) => {
    const request = payload || {};
    const settings = loadSettings();
    const messages = Array.isArray(request.messages) ? request.messages : [];
    const requestId = request.requestId || `req-${Date.now()}`;

    // 界面指定了服务商，但磁盘上没有 —— 说明还没保存，宁可报错也不要发错服务商
    const requestedId = String(request.providerId || '').trim();
    if (requestedId && !settings.providers.some((p) => p.id === requestedId)) {
      return { ok: false, requestId, error: '这个服务商还没有保存，请到设置里点一下「保存」。' };
    }

    const endpoint = endpointFor(settings, request.providerId, request.model);

    if (!endpoint) {
      return { ok: false, requestId, error: '还没有配置模型服务，请点左下角「设置」添加。' };
    }
    if (!endpoint.apiKey) {
      return { ok: false, requestId, error: `还没有填写「${endpoint.providerName}」的 API Key。` };
    }

    if (activeController) {
      activeController.abort();
    }
    activeController = new AbortController();
    const { signal } = activeController;

    try {
      const result = await streamChat({
        settings: endpoint,
        messages,
        signal,
        onDelta: (text) => sendToRenderer('chat:chunk', { requestId, text }),
        onReasoning: (text) => sendToRenderer('chat:reasoning', { requestId, text })
      });
      return {
        ok: true,
        requestId,
        providerId: endpoint.providerId,
        providerName: endpoint.providerName,
        model: endpoint.model,
        ...result
      };
    } catch (err) {
      return { ok: false, requestId, error: (err && err.message) || '未知错误' };
    } finally {
      if (activeController && activeController.signal === signal) {
        activeController = null;
      }
    }
  });

  ipcMain.handle('util:copy', (_event, text) => {
    clipboard.writeText(String(text || ''));
    return true;
  });

  /**
   * 导出文件。渲染层把两种形态都准备好，**由用户选的后缀决定写哪一种**：
   *   · text              文本（.json / .md 用，按 utf8 写）
   *   · base64 + pngText  二进制（.png 用；pngText 会先作为 tEXt 块插进去）
   * 这样「导出角色卡」只需要一个按钮。
   */
  ipcMain.handle('util:saveFile', async (_event, payload) => {
    const request = payload || {};
    const result = await dialog.showSaveDialog(mainWindow, {
      title: request.title || '保存',
      defaultPath: request.fileName || 'export',
      filters: Array.isArray(request.filters) ? request.filters : []
    });

    if (result.canceled || !result.filePath) return { canceled: true };

    const ext = path.extname(result.filePath).toLowerCase();
    try {
      if (ext === '.png' && request.base64) {
        let buffer = Buffer.from(String(request.base64), 'base64');
        if (request.pngText && request.pngText.keyword) {
          buffer = pngWithTextChunk(buffer, request.pngText.keyword, request.pngText.text || '');
        }
        fs.writeFileSync(result.filePath, buffer);
      } else {
        fs.writeFileSync(result.filePath, String(request.text == null ? '' : request.text), 'utf8');
      }
    } catch (err) {
      return { canceled: false, error: (err && err.message) || '写文件失败' };
    }

    return { canceled: false, filePath: result.filePath };
  });

  /**
   * 语义检索（RAG）。
   *
   * 流程：收集候选（较早的消息 + 绑定的世界书条目）→ 补齐缺的向量（增量、每次最多
   * MAX_EMBED_PER_CALL 条）→ 给查询算向量 → 余弦排序取前 K 个 → 返回文本给渲染层注入。
   *
   * 只做「捞出来」，注入格式交给渲染层 —— 那边才知道该怎么措辞。
   */
  ipcMain.handle('rag:recall', async (_event, payload) => {
    const request = payload || {};
    const settings = loadSettings();

    const endpoint = endpointFor(settings, request.providerId, request.model);
    if (!endpoint) return { ok: false, error: '还没有配置向量模型，请到「设置 → 语义检索」里选一个。' };
    if (!endpoint.apiKey) return { ok: false, error: `还没有填写「${endpoint.providerName}」的 API Key。` };

    const query = String(request.query || '').trim();
    if (!query) return { ok: false, error: '没有可用来检索的内容。' };

    const candidates = ragCandidates(request);
    if (!candidates.length) return { ok: true, items: [], embedded: 0, indexed: 0, total: 0 };

    const store = loadVectors();
    const keyOf = (c) => `${endpoint.model}::${c.key}`;

    try {
      // ---- 补齐缺的向量（增量）----
      const missing = candidates.filter((c) => !store.items[keyOf(c)]);
      const pending = missing.slice(0, Math.min(MAX_EMBED_PER_CALL, MAX_EMBED_INPUTS - 1));

      if (pending.length) {
        const vectors = await embedTexts(endpoint, pending.map((c) => c.text));
        pending.forEach((c, i) => {
          if (vectors[i]) store.items[keyOf(c)] = encodeVector(vectors[i]);
        });
        saveVectors(store);
      }

      // ---- 查询向量 ----
      const queryVector = (await embedTexts(endpoint, [query]))[0];
      if (!queryVector) return { ok: false, error: '向量接口没有返回查询向量。' };

      // ---- 排序 ----
      const ready = [];
      for (const c of candidates) {
        const raw = store.items[keyOf(c)];
        const vector = raw ? decodeVector(raw) : null;
        if (vector) ready.push({ ...c, vector });
      }

      const ranked = rankBySimilarity(Float32Array.from(queryVector), ready, {
        topK: request.topK,
        minScore: request.minScore
      });

      return {
        ok: true,
        items: ranked.map((r) => ({
          kind: r.kind,
          title: r.title || '',
          role: r.role || '',
          text: r.text,
          score: Number(r.score.toFixed(4))
        })),
        embedded: pending.length,
        indexed: ready.length,
        total: candidates.length
      };
    } catch (err) {
      return { ok: false, error: (err && err.message) || '语义检索失败' };
    }
  });

  /**
   * 生图。走 OpenAI 那套 /images/generations：
   *   { model, prompt, n: 1, size, response_format: 'b64_json' } → { data: [{ b64_json }] }
   *
   * 它和聊天**既不是同一个端点、通常也不是同一个模型**，所以设置里单独指一组。
   * 各家差异很大（通义万相那类是异步任务），这里只支持「同步返回图片」的这一套。
   */
  ipcMain.handle('images:generate', async (_event, payload) => {
    const request = payload || {};
    const settings = loadSettings();

    const endpoint = endpointFor(settings, request.providerId, request.model);
    if (!endpoint) {
      return { ok: false, error: '还没有配置生图服务商，请到「设置 → 生图」里选一个。' };
    }
    if (!endpoint.apiKey) {
      return { ok: false, error: `还没有填写「${endpoint.providerName}」的 API Key。` };
    }

    const prompt = String(request.prompt || '').trim().slice(0, 2000);
    if (!prompt) return { ok: false, error: '没有可用的提示词。' };

    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (endpoint.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`;

    // 少数服务商（智谱）的图片接口不认 OpenAI 的 response_format / n，
    // 反而要求 quality。参数给错了它只回一句「API 调用参数有误」（错误码 1210），
    // 所以这里按服务商裁剪参数，别把不认识的字段一起发过去。
    const isZhipuImage = /bigmodel\.cn/i.test(String(endpoint.baseUrl || ''));
    const imageBody = {
      model: endpoint.model,
      prompt,
      size: String(request.size || settings.imageSize || '1024x1024')
    };
    if (isZhipuImage) {
      // glm-image 只支持 hd；cogview 系列默认 standard，不传就是默认值
      if (/^glm-image$/i.test(String(endpoint.model || ''))) imageBody.quality = 'hd';
    } else {
      imageBody.n = 1;
      imageBody.response_format = 'b64_json';
    }

    try {
      const json = await requestJson({
        url: imagesUrl(endpoint.baseUrl),
        method: 'POST',
        headers,
        body: imageBody,
        // 生图比聊天慢得多，给两分钟
        timeoutMs: 120000
      });

      const item = Array.isArray(json && json.data) ? json.data[0] : null;
      if (!item) return { ok: false, error: '接口没有返回图片（data 是空的）。' };

      if (item.b64_json) {
        return { ok: true, dataUrl: `data:image/png;base64,${item.b64_json}`, model: endpoint.model };
      }
      if (item.url) {
        // 有的服务商会无视 response_format 直接给链接。
        // 渲染层 CSP 是 img-src 'self' data:，外链加载不了 —— 所以在主进程下载回来。
        const buffer = await downloadBinary(String(item.url));
        const mime = /\.jpe?g($|\?)/i.test(String(item.url)) ? 'image/jpeg' : 'image/png';
        return {
          ok: true,
          dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
          model: endpoint.model
        };
      }
      return { ok: false, error: '接口返回里既没有 b64_json 也没有 url。' };
    } catch (err) {
      return { ok: false, error: (err && err.message) || '生图失败' };
    }
  });

  /**
   * 点开看大图。渲染层的 CSP 是 img-src 'self' data:，直接 window.open 会被拦，
   * 所以在这里落一个临时文件、开一个只显示这张图的窗口，关掉时把文件删了。
   */
  ipcMain.handle('images:open', (_event, dataUrl) => {
    const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(dataUrl || ''));
    if (!match) return false;

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const file = path.join(app.getPath('temp'), `barbara-view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);

    try {
      fs.writeFileSync(file, Buffer.from(match[2], 'base64'));
    } catch (err) {
      return false;
    }

    const viewer = new BrowserWindow({
      width: 960,
      height: 720,
      title: '图片',
      autoHideMenuBar: true,
      backgroundColor: '#1b1f27'
    });
    viewer.loadFile(file);
    viewer.once('closed', () => {
      try {
        fs.unlinkSync(file);
      } catch (err) {
        /* 删不掉就算了，系统临时目录迟早会清 */
      }
    });

    return true;
  });

  ipcMain.handle('util:openPath', async (_event, which) => {
    // 直接打开数据文件夹，而不是高亮特定文件
    const dataDir = app.getPath('userData');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    shell.openPath(dataDir);
    return dataDir;
  });
}

// ---------------------------------------------------------------------------
//  启动
// ---------------------------------------------------------------------------

// 只允许开一个实例，第二次双击时聚焦已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    migrateLegacyData();
    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
