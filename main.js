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
    models: ['glm-4-flash', 'glm-4-plus']
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
 * PNG 的结构是一串「数据块」：4 字节长度 + 4 字节类型 + 内容 + 4 字节校验。
 * 酒馆把角色卡 JSON 做 base64 后塞在 tEXt 块里，关键字是 chara（v2）或 ccv3（v3）。
 */
function parseCharacterCardPng(buffer) {
  if (!buffer || buffer.length < 8) return null;

  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i += 1) {
    if (buffer[i] !== signature[i]) return null; // 不是 PNG
  }

  let offset = 8;
  let charaText = null;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    // 长度字段不可信，越界就停，避免读到别的数据
    if (length < 0 || dataEnd + 4 > buffer.length) break;

    if (type === 'tEXt') {
      const chunk = buffer.subarray(dataStart, dataEnd);
      const separator = chunk.indexOf(0);
      if (separator > 0) {
        const keyword = chunk.toString('latin1', 0, separator);
        // ccv3 是 v3 卡，优先于老的 chara
        if (keyword === 'chara' && !charaText) {
          charaText = chunk.toString('latin1', separator + 1);
        } else if (keyword === 'ccv3') {
          charaText = chunk.toString('latin1', separator + 1);
        }
      }
    }

    if (type === 'IEND') break;
    offset = dataEnd + 4;
  }

  if (!charaText) return null;

  // 正常是 base64；有些工具直接塞了明文 JSON，两种都试
  try {
    return JSON.parse(Buffer.from(charaText, 'base64').toString('utf8'));
  } catch (err) {
    try {
      return JSON.parse(charaText);
    } catch (err2) {
      return null;
    }
  }
}

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
      tags: d.tags
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
    // 酒馆默认开启「全词匹配」，但官方文档明确说这对中日文有害（不用空格分词），
    // 所以这里默认关闭，只有显式打开才启用。
    matchWholeWords: bool(r.matchWholeWords ?? r.match_whole_words, false),
    caseSensitive: bool(r.caseSensitive ?? r.case_sensitive, false),
    probability,
    enabled
  };
}

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

/**
 * 关键词是否命中。
 * 中日韩文字没有空格分词，只能做子串匹配（酒馆自己也建议这时关掉全词匹配）；
 * 纯拉丁字母的关键词才用词边界，避免 king 命中 liking。
 */
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 编译过的关键词正则缓存。
 * 匹配是每轮对每个条目每个关键词都跑的，不缓存的话每句话都要重新编译几百次正则。
 * 用户改关键词时字符串会变，键自然失配，所以不用担心缓存过期。
 */
const keywordRegexCache = new Map();
const MAX_KEYWORD_REGEX_CACHE = 4000;

/** 解析 /re/flags 写法；不是正则就返回 null */
function parseRegexKeyword(keyword) {
  if (keyword.length <= 2 || !keyword.startsWith('/')) return null;

  const cached = keywordRegexCache.get(keyword);
  if (cached !== undefined) return cached;

  let compiled = null;
  const lastSlash = keyword.lastIndexOf('/');
  if (lastSlash > 0) {
    const body = keyword.slice(1, lastSlash);
    const flags = keyword.slice(lastSlash + 1);
    if (/^[gimsuy]*$/.test(flags)) {
      try {
        compiled = new RegExp(body, flags);
      } catch (err) {
        // 正则写错了就当普通文本处理，别让一条坏正则废掉整本书
        compiled = null;
      }
    }
  }

  // 上限只是防止畸形文件把缓存撑爆；简单粗暴地整体清空即可
  if (keywordRegexCache.size >= MAX_KEYWORD_REGEX_CACHE) keywordRegexCache.clear();
  keywordRegexCache.set(keyword, compiled);
  return compiled;
}

/** 全词匹配的正则同样值得缓存（中文默认不走这条，主要是英文世界书） */
const wordBoundaryCache = new Map();

function wordBoundaryRegex(keyword) {
  const cached = wordBoundaryCache.get(keyword);
  if (cached !== undefined) return cached;

  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(keyword)}(?![\\p{L}\\p{N}])`, 'u');
  if (wordBoundaryCache.size >= MAX_KEYWORD_REGEX_CACHE) wordBoundaryCache.clear();
  wordBoundaryCache.set(keyword, re);
  return re;
}

function keywordHit(haystack, rawKeyword, entry) {
  const keyword = String(rawKeyword || '').trim();
  if (!keyword) return false;

  // 关键词写成 /re/flags 就当正则处理，和酒馆一致
  const asRegex = parseRegexKeyword(keyword);
  if (asRegex) return asRegex.test(haystack);

  const text = entry && entry.caseSensitive ? haystack : haystack.toLowerCase();
  const needle = entry && entry.caseSensitive ? keyword : keyword.toLowerCase();

  if (CJK_RE.test(needle)) return text.includes(needle);
  if (entry && entry.matchWholeWords) return wordBoundaryRegex(needle).test(text);
  return text.includes(needle);
}

/** 把某条目的所有关键词拼成一个正则，用来判断「至少命中一个」还是「全部命中」 */
function anyKeywordHit(haystack, keywords, entry) {
  return keywords.some((k) => keywordHit(haystack, k, entry));
}

function allKeywordsHit(haystack, keywords, entry) {
  return keywords.length > 0 && keywords.every((k) => keywordHit(haystack, k, entry));
}

/** 单条 entry 是否应该被注入 */
function entryMatches(entry, haystack) {
  if (!entry || entry.enabled === false) return false;
  if (!String(entry.content || '').trim()) return false;

  // constant（蓝圈）不需要关键词，永远注入
  if (entry.constant) return true;
  if (!entry.keys.length) return false;

  // 触发概率：100 必中，50 一半概率，0 等于停用
  if (entry.probability < 100 && Math.random() * 100 >= entry.probability) return false;

  if (!anyKeywordHit(haystack, entry.keys, entry)) return false;

  // 附加过滤词（secondary keys）
  if (entry.secondaryKeys.length) {
    const any = anyKeywordHit(haystack, entry.secondaryKeys, entry);
    const all = allKeywordsHit(haystack, entry.secondaryKeys, entry);
    switch (entry.selectiveLogic) {
      case 'AND_ALL':
        if (!all) return false;
        break;
      case 'NOT_ANY':
        if (any) return false;
        break;
      case 'NOT_ALL':
        if (all) return false;
        break;
      case 'AND_ANY':
      default:
        if (!any) return false;
        break;
    }
  }

  return true;
}

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

/**
 * 扫描近期对话，返回命中的世界书条目（按 order 升序，大的更靠后 = 影响更大）。
 * scanDepth 是往回扫多少条消息，和酒馆的 Scan Depth 一个意思。
 */
function matchWorldbookEntries(entries, scanText) {
  const hits = [];
  for (const entry of entries) {
    if (entryMatches(entry, scanText)) hits.push(entry);
  }
  hits.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return String(a.title).localeCompare(String(b.title));
  });
  return hits;
}

/** 命中条目拼成注入块 */
function formatWorldbookSection(hits) {
  if (!hits.length) return '';
  const lines = hits.map((e) => `【${e.title}】\n${String(e.content).trim()}`);
  return `[世界设定]\n以下资料与当前对话相关，请自然地运用，不要直接复述：\n\n${lines.join('\n\n')}`;
}

// ---------------------------------------------------------------------------
//  HTTP 请求：用 Node 自带模块，不依赖任何第三方库
// ---------------------------------------------------------------------------

function buildHeaders(settings) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream'
  };
  if (settings.apiKey) {
    headers.Authorization = `Bearer ${settings.apiKey}`;
  }
  return headers;
}

function modelsUrl(baseUrl) {
  return `${String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')}/models`;
}

function chatUrl(baseUrl) {
  return `${String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')}/chat/completions`;
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
  const snippet = String(text || '').slice(0, 400);
  if (status === 401) return `401 未授权：API Key 不对或已失效。\n${snippet}`;
  if (status === 402) return `402 余额不足：账户需要充值。\n${snippet}`;
  if (status === 403) return `403 拒绝访问：Key 没有该模型的权限。\n${snippet}`;
  if (status === 404) return `404 找不到接口：多半是「接口地址」写错了，应类似 https://api.deepseek.com。\n${snippet}`;
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

    const hits = matchWorldbookEntries(entries, scanText);

    return {
      total: entries.length,
      scanDepth,
      hits: hits.map((e) => ({
        id: e.id,
        title: e.title,
        worldbookName: e.worldbookName,
        order: e.order,
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
  ipcMain.handle('images:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择头像图片',
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
