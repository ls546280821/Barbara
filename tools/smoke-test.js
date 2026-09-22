'use strict';

// ============================================================================
//  smoke-test.js —— 冒烟测试（不属于应用代码，不参与打包）
//
//  跑法： npm run smoke
//
//  它干什么：
//    开一个「不显示」的 Electron 窗口，加载**真实的** renderer/index.html，
//    但把所有 IPC 都换成内存里的假后端 —— 所以它既跑的是真界面，
//    又**不会碰你的 userData**，随便跑，不会弄坏你的角色和会话。
//
//  为什么要它：
//    这个项目没有测试，而接下来要把 renderer.js 拆成 ES module（见 重构方案.md）。
//    有了它，每拆一步都能自动验一遍「功能还在不在」。
//
//  断言写在 tools/smoke-renderer.js 里（那部分代码跑在页面里）。
// ============================================================================

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

// 关键：用**主进程真正在用的**归一化，而不是自己糊一套。
// 角色「属性」丢过一次，就是因为假后端只做存取、不做归一化 ——
// 主进程白名单漏了字段，测试却全绿。现在这段往返走的是同一份代码。
const { normalizeCharacter } = require('../main/characters.js');
// 导出 PNG 卡要插 tEXt 块、导入要读回来 —— 用同一份实现，才能测真正的往返
const { pngWithTextChunk, parseCharacterCardPng } = require('../main/png.js');
// 世界书匹配（含递归扫描）也用真实现
const { matchWorldbookEntries, formatWorldbookSection } = require('../main/worldbook-match.js');
// 语义检索的向量工具也用真实现（编解码 / 余弦 / topK 都是它）
const {
  hashText,
  encodeVector,
  decodeVector,
  cosineSimilarity,
  rankBySimilarity,
  collectCandidates
} = require('../main/vectors.js');

const APP_DIR = path.join(__dirname, '..');
const OVERALL_TIMEOUT_MS = 90000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

// ---------------------------------------------------------------------------
//  假后端：所有读写都留在内存里
//  注意每个 get 都要返回深拷贝 —— 真实 IPC 是序列化的，
//  如果直接把 store 里的数组交给渲染层，两边就会共享引用，
//  「保存前不该落盘」这类断言会变成假阳性。
// ---------------------------------------------------------------------------
function makeStore() {
  return {
    settings: {
      providers: [
        {
          id: 'p-test',
          name: '冒烟测试服务商',
          baseUrl: 'http://127.0.0.1:9/v1',
          apiKey: 'test-key',
          models: ['test-model']
        },
        // 第二个服务商专门给生图用 —— 生图和聊天是两套配置，测试也要分开验
        {
          id: 'p-img',
          name: '冒烟测试生图',
          baseUrl: 'http://127.0.0.1:9/v1',
          apiKey: 'test-key',
          models: ['img-model-x']
        },
        // 第三个给语义检索用 —— 向量模型又是一组独立配置
        {
          id: 'p-emb',
          name: '冒烟测试向量',
          baseUrl: 'http://127.0.0.1:9/v1',
          apiKey: 'test-key',
          models: ['emb-model-x']
        }
      ],
      activeProviderId: 'p-test',
      activeModel: 'test-model',
      temperature: 0.7,
      maxTokens: 512,
      topP: 0.95,
      systemPrompt: '冒烟测试用的全局人设。',
      userName: '测试者',
      maxTurns: 20,
      theme: 'light',
      sendOnEnter: true,
      showDate: false,
      showUsage: false
    },
    characters: [],
    worldbooks: [
      {
        id: 'w-test',
        name: '冒烟测试世界',
        characters: [],
        opening: '',
        // 前三条是给「递归扫描」用的连锁：只提「翁法罗斯」，
        // 靠总览正文里的「十二泰坦」「火种」把另外两条带出来。
        // 第四条谁都不提它，用来验「没命中就是没命中」。
        entries: [
          {
            id: 'e-root',
            title: '世界总览',
            keys: ['翁法罗斯'],
            secondaryKeys: [],
            selectivelogic: 'AND_ANY',
            selectiveLogic: 'AND_ANY',
            // 正文只提「十二泰坦」，不提「火种」—— 这样才是一条严格的链
            content: '翁法罗斯有十二泰坦。',
            constant: false,
            recursive: true,
            probability: 100,
            order: 100,
            enabled: true
          },
          {
            id: 'e-titan',
            title: '十二泰坦',
            keys: ['十二泰坦'],
            secondaryKeys: [],
            selectiveLogic: 'AND_ANY',
            content: '十二泰坦守着火种，是这个世界的神。',
            constant: false,
            recursive: true,
            probability: 100,
            order: 100,
            enabled: true
          },
          {
            id: 'e-flame',
            title: '火种',
            keys: ['火种'],
            secondaryKeys: [],
            selectiveLogic: 'AND_ANY',
            content: '火种是泰坦留下的力量。',
            constant: false,
            recursive: false,
            probability: 100,
            order: 100,
            enabled: true
          },
          {
            id: 'e-unrelated',
            title: '无关条目',
            keys: ['完全没人提的词'],
            secondaryKeys: [],
            selectiveLogic: 'AND_ANY',
            content: '这条不该被带进来。',
            constant: false,
            recursive: true,
            probability: 100,
            order: 100,
            enabled: true
          }
        ]
      }
    ],
    conversations: [],
    activeId: null
  };
}

const store = makeStore();
const calls = []; // 记录渲染层请求过的写操作，方便排查
let chatPayloads = []; // 每次发给模型的完整消息（按顺序留着，供宿主侧断言用）
let lastExport = null; // 最后一次「导出」交给主进程的东西
const exportedPayloads = []; // 按顺序留所有导出，宿主侧断言用
const imageRequests = []; // 生图请求参数
const ragRequests = []; // 语义检索请求参数

function remember(channel, payload) {
  calls.push(channel);
  if (channel === 'characters:save' && payload && Array.isArray(payload.worldbooks)) {
    store.worldbooks = clone(payload.worldbooks);
  }
}

function registerStubs() {
  // --- 设置 ---
  // 语义检索：不调真接口，但**排序用的是真的 rankBySimilarity**。
  // 假的「向量」按关键词落在哪个桶来构造，这样相似度是可控、可预期的：
  //   提到「泰坦 / 那些神」的落第 0 维，提「门 / 钟」的落第 1 维……
  // 于是「问『那些神』→ 捞出写了『十二泰坦』的设定」这件事是真排序算出来的。
  const fakeEmbed = (text) => {
    const t = String(text || '');
    return new Float32Array([
      /泰坦|那些神|神仙/.test(t) ? 1 : 0,
      /门|钟/.test(t) ? 1 : 0,
      /金币|钱/.test(t) ? 1 : 0,
      0.1
    ]);
  };

  ipcMain.handle('rag:recall', (_event, payload) => {
    remember('rag:recall');
    ragRequests.push(clone(payload));

    const req = payload || {};
    const convo = store.conversations.find((c) => c.id === req.convoId);

    // 候选收集用真实现（main/vectors.js 里的纯函数）—— 连「只捞绑定的书」
    // 和「跳过最近几条」这两条规则也一起验了
    const candidates = collectCandidates({
      messages: convo ? convo.messages : [],
      recentCount: req.recentCount,
      books: store.worldbooks,
      worldbookIds: req.worldbookIds
    }).map((c) => ({ ...c, vector: fakeEmbed(c.text) }));

    const ranked = rankBySimilarity(fakeEmbed(req.query), candidates, {
      topK: req.topK,
      minScore: req.minScore
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
      embedded: 0,
      indexed: candidates.length,
      total: candidates.length
    };
  });

  ipcMain.handle('settings:get', () => ({
    settings: clone(store.settings),
    models: [],
    presets: []
  }));
  ipcMain.handle('settings:save', (_event, patch) => {
    remember('settings:save', patch);
    Object.assign(store.settings, patch || {});
    return clone(store.settings);
  });
  ipcMain.handle('settings:test', () => ({ ok: true, models: ['test-model'] }));
  ipcMain.handle('models:list', () => ({ models: ['test-model'] }));

  // --- 会话 ---
  ipcMain.handle('conversations:get', () => clone({ conversations: store.conversations, activeId: store.activeId }));
  ipcMain.handle('conversations:save', (_event, payload) => {
    remember('conversations:save', payload);
    if (payload && Array.isArray(payload.conversations)) store.conversations = clone(payload.conversations);
    if (payload && 'activeId' in payload) store.activeId = payload.activeId;
    return { ok: true };
  });
  ipcMain.on('conversations:save-sync', (_event, payload) => {
    remember('conversations:save-sync', payload);
    if (payload && Array.isArray(payload.conversations)) store.conversations = clone(payload.conversations);
  });

  // --- 角色库（和 main.js 一样：一次调用可能同时带 worldbooks）---
  ipcMain.handle('characters:get', () => clone({ characters: store.characters }));
  ipcMain.handle('characters:save', (_event, payload) => {
    remember('characters:save', payload);
    // 过一遍真正的归一化 —— 白名单漏字段这种事只有跑真代码才测得出来
    if (payload && Array.isArray(payload.characters)) {
      store.characters = clone(payload.characters.map((c) => normalizeCharacter(c)));
    }
    if (payload && Array.isArray(payload.worldbooks)) store.worldbooks = clone(payload.worldbooks);
    return { ok: true };
  });
  ipcMain.on('characters:save-sync', (_event, payload) => {
    remember('characters:save-sync', payload);
    if (payload && Array.isArray(payload.characters)) {
      store.characters = clone(payload.characters.map((c) => normalizeCharacter(c)));
    }
    if (payload && Array.isArray(payload.worldbooks)) store.worldbooks = clone(payload.worldbooks);
  });
  ipcMain.handle('characters:import', () => ({ canceled: true }));

  // --- 世界书 ---
  ipcMain.handle('worldbooks:get', () => clone({ worldbooks: store.worldbooks }));
  ipcMain.handle('worldbooks:save', (_event, payload) => {
    remember('worldbooks:save', payload);
    if (payload && Array.isArray(payload.worldbooks)) store.worldbooks = clone(payload.worldbooks);
    return { ok: true };
  });
  ipcMain.on('worldbooks:save-sync', (_event, payload) => {
    remember('worldbooks:save-sync', payload);
    if (payload && Array.isArray(payload.worldbooks)) store.worldbooks = clone(payload.worldbooks);
  });
  // 世界书匹配用**真实现**（main/worldbook-match.js），这样递归扫描、
  // 副关键词、概率这些逻辑测的是真代码。这里只补主进程 handler 里那段
  // 「取最近 N 条拼成扫描文本」——它本来就是十来行拼字符串。
  ipcMain.handle('worldbooks:preview', (_event, payload) => {
    const request = payload || {};
    const messages = Array.isArray(request.messages) ? request.messages : [];

    let scanDepth = Number(request.scanDepth);
    if (!isFinite(scanDepth) || scanDepth <= 0) scanDepth = 6;
    scanDepth = Math.min(50, Math.floor(scanDepth));

    const usable = messages.filter((m) => m && typeof m.content === 'string' && String(m.content).trim());
    const scanText = usable
      .slice(-scanDepth)
      .map((m) => String(m.content))
      .join('\n');

    const wanted = Array.isArray(request.worldbookIds) ? request.worldbookIds : [];
    const entries = [];
    for (const book of store.worldbooks) {
      if (!wanted.includes(book.id)) continue;
      for (const entry of book.entries || []) {
        entries.push({ ...entry, worldbookId: book.id, worldbookName: book.name });
      }
    }

    const matched = matchWorldbookEntries(entries, scanText, { recursiveDepth: request.recursiveDepth });

    return {
      total: entries.length,
      scanDepth,
      rounds: matched.rounds,
      recursiveCount: matched.recursiveCount,
      hits: matched.hits.map((e) => ({
        id: e.id,
        title: e.title,
        worldbookName: e.worldbookName,
        order: e.order,
        recursive: e.recursive === true,
        length: String(e.content).length
      })),
      section: formatWorldbookSection(matched.hits)
    };
  });

  // --- 图片 / 杂项 ---
  // 返回一张真的 1×1 PNG：这样「选背景图」那条链路（解码 → 缩放 → 存 dataURL）
  // 走的是真代码，而不是被 stub 掉
  const TINY_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  ipcMain.handle('images:pick', () => ({ canceled: false, dataUrl: TINY_PNG }));

  // 生图：记下请求参数（要验它用的是「生图」那组配置，不是聊天模型），
  // 返回一张真的 1×1 PNG，让渲染层真实的「解码 → 压缩 → 存进会话」链路跑一遍
  ipcMain.handle('images:generate', (_event, payload) => {
    remember('images:generate');
    imageRequests.push(clone(payload));
    return { ok: true, dataUrl: TINY_PNG, model: (payload && payload.model) || '' };
  });
  ipcMain.handle('util:copy', () => true);
  ipcMain.handle('util:openPath', () => true);

  // 「导出」：不弹真的保存框，但把渲染层交上来的东西原样收下 ——
  // 宿主侧再拿它跑一遍真正的「写 PNG → 读 PNG」往返
  ipcMain.handle('util:saveFile', (_event, payload) => {
    remember('util:saveFile');
    lastExport = clone(payload);
    exportedPayloads.push(clone(payload));
    return { canceled: false, filePath: 'C:\\fake\\' + ((payload && payload.fileName) || 'export') };
  });

  // --- 聊天：假装模型回了一句话，并且真的走一遍流式通道 ---
  ipcMain.handle('chat:stop', () => true);
  // 每次回复带个序号 —— 不然「重新生成」出来的候选和原来那条一模一样，
  // 测不出「到底是哪一条」
  let replySeq = 0;
  ipcMain.handle('chat:send', async (event, payload) => {
    remember('chat:send');
    chatPayloads.push(clone((payload && payload.messages) || []));
    const requestId = (payload && payload.requestId) || 'req-smoke';
    const model = (payload && payload.model) || 'test-model';

    replySeq += 1;
    const CONTENT = `冒烟测试回复 #${replySeq}：我收到了。**这是加粗**，==这是高亮==。`;
    const pieces = [`冒烟测试回复 #${replySeq}`, '：我收到了。', '**这是加粗**，', '==这是高亮==。'];

    for (const piece of pieces) {
      if (!event.sender.isDestroyed()) event.sender.send('chat:chunk', { requestId, text: piece });
      await sleep(8);
    }

    return {
      ok: true,
      requestId,
      model,
      content: CONTENT,
      reasoning: '',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    };
  });
}

// ---------------------------------------------------------------------------
//  跑测试
// ---------------------------------------------------------------------------
function report(result, consoleErrors, consoleWarnings, crashed) {
  const results = (result && result.results) || [];
  const notes = (result && result.notes) || [];

  const failed = results.filter((r) => !r.pass);
  const width = results.reduce((m, r) => Math.max(m, r.name.length), 0);

  console.log('');
  console.log('────────────── 冒烟测试 ──────────────');

  let current = '';
  for (const r of results) {
    // 场景名是「场景 · 断言」的形式，切一下方便阅读
    const group = r.name.split(' · ')[0];
    if (group !== current) {
      current = group;
      console.log(`\n  【${group}】`);
    }
    const label = r.name.includes(' · ') ? r.name.split(' · ').slice(1).join(' · ') : r.name;
    console.log(`    ${r.pass ? '✓' : '✗'} ${label.padEnd(width)}${r.pass ? '' : '   ← ' + r.detail}`);
  }

  console.log('');
  if (consoleWarnings.length) {
    console.log(`  控制台警告 ${consoleWarnings.length} 条：`);
    consoleWarnings.slice(0, 5).forEach((w) => console.log('    ! ' + w));
    console.log('');
  }
  notes.forEach((n) => console.log('  · ' + n));

  const consoleOk = consoleErrors.length === 0;
  if (!consoleOk) {
    console.log('');
    console.log(`  控制台报错 ${consoleErrors.length} 条：`);
    consoleErrors.slice(0, 10).forEach((e) => console.log('    ! ' + e));
  }

  console.log('');
  const passed = results.length - failed.length;
  console.log(`  断言：${passed}/${results.length} 通过` + (failed.length ? `，${failed.length} 条失败` : ''));
  console.log(`  控制台报错：${consoleErrors.length} 条`);
  console.log(`  写操作记录：${calls.length} 次（${[...new Set(calls)].join(', ')}）`);
  if (crashed) console.log(`  ⚠ ${crashed}`);

  const ok = failed.length === 0 && consoleOk && !crashed;
  console.log('');
  console.log(ok ? '  ✅ 冒烟测试通过' : '  ❌ 冒烟测试失败');
  console.log('──────────────────────────────────────');
  console.log('');
  return ok;
}

/**
 * 悬停验证：卡片上的删除按钮必须「鼠标移上去才浮出来」。
 *
 * 为什么这条断言不能写在页面里，也不能用模拟指针：
 *   1. `:hover` 只认真实指针，页面里 dispatchEvent('mouseover') 不算数；
 *   2. 用 sendInputEvent 真移指针也不行 —— 窗口是隐藏的（show:false），
 *      Chromium 不会给它算 hover 状态；
 *   3. 所以走 CDP 的 CSS.forcePseudoState 强制加 `:hover`（已验证能用，
 *      拿左侧会话列表那套生产环境正常的 .convo-del 做过对照）。
 *
 * 还有一个坑（踩过，记在这免得下次又查一遍）：
 *   `.char-card-del` 上有 `transition: opacity 0.12s`，而**隐藏窗口不产生动画帧**，
 *   过渡永远不会推进 —— 强制 hover 之后等 1.5 秒 opacity 依然是 0。
 *   所以这里先把过渡临时关掉，让计算值直接跳到位。
 *   真实窗口里过渡正常播放（那就是我们要的淡入效果）。
 */
async function probeHover(win, result) {
  const probe = result && result.hoverProbe;
  if (!probe) return;

  const run = (code) => win.webContents.executeJavaScript(code);
  const readOpacity = () =>
    run("getComputedStyle(document.querySelector('#char-page-grid .char-card .char-card-del')).opacity");

  const before = await readOpacity();

  let after = before;
  let note = '';
  const dbg = win.webContents.debugger;

  try {
    // 关掉过渡：隐藏窗口里过渡不会推进，计算值会永远停在起点
    await run("document.querySelector('#char-page-grid .char-card .char-card-del').style.transition = 'none'");

    dbg.attach('1.3');
    await dbg.sendCommand('DOM.enable');
    await dbg.sendCommand('CSS.enable');

    const { root } = await dbg.sendCommand('DOM.getDocument');
    const { nodeId } = await dbg.sendCommand('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '#char-page-grid .char-card'
    });
    if (!nodeId) throw new Error('找不到角色卡节点');

    await dbg.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
    await sleep(150);
    after = await readOpacity();

    await dbg.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    dbg.detach();

    // 复原，别影响后续（虽然之后也没别的断言了）
    await run("document.querySelector('#char-page-grid .char-card .char-card-del').style.transition = ''");
  } catch (err) {
    note = '（CDP 出错：' + ((err && err.message) || err) + '）';
    try { if (dbg.isAttached()) dbg.detach(); } catch (e) { /* 忽略 */ }
  }

  result.results.push({
    name: '角色库：卡片上删除 · 鼠标移上去才会浮出来',
    pass: before === '0' && after === '1',
    detail: `移入前 opacity=${before}，移入后 opacity=${after}${note}`
  });
}

/**
 * 注入内容验证：看**真正发给模型的消息**里有没有该有的东西。
 *
 * 这是唯一能确认「注入真的生效」的地方 —— 页面上看不出模型收到了什么，
 * 而这条链路（角色卡属性 → 会话面板 → 系统提示词）正是这个功能的全部意义。
 *
 * 注意：不看「最后一条」，而是把每次请求都收进来找。
 * 因为世界里没写开场白时，进世界会立刻多发一次「生成开局」的请求，
 * 那次是不带状态面板的 —— 只认最后一条会误判。
 */
function probeInjection(result) {
  if (!result) return;

  const blobs = chatPayloads.map((msgs) => msgs.map((m) => String((m && m.content) || '')).join('\n'));

  const panelOk = blobs.some(
    (b) => b.includes('[当前状态]') && b.includes('【金币】：100') && b.includes('【上衣】：布衣')
  );
  result.results.push({
    name: '属性：注入给模型的消息里带上了状态面板',
    pass: panelOk,
    detail: panelOk ? '' : `翻了 ${blobs.length} 次请求都没找到完整面板`
  });

  const playerOk = blobs.some((b) => b.includes('【玩家角色：改过的名字】'));
  result.results.push({
    name: '进入世界：注入的是你选/改过的玩家角色',
    pass: playerOk,
    detail: playerOk ? '' : `翻了 ${blobs.length} 次请求都没找到「【玩家角色：改过的名字】」`
  });

  // 单角色对话：角色卡上的年龄必须真的进提示词（曾经漏了，AI 就把 16 岁写成 21 岁）
  const ageOk = blobs.some((b) => b.includes('【属性测试角色的基本信息】') && b.includes('年龄 18'));
  result.results.push({
    name: '单角色对话：角色的年龄/性别/种族被注入给模型',
    pass: ageOk,
    detail: ageOk ? '' : `翻了 ${blobs.length} 次请求都没找到「【属性测试角色的基本信息】…年龄 18」`
  });

  // 身份四件套也要跟着面板一起注入 —— 世界里这些是会变的
  const identityOk = blobs.some(
    (b) => b.includes('【姓名】：改过的名字') && b.includes('【年龄】：18') && b.includes('【种族】：精灵')
  );
  result.results.push({
    name: '进入世界：身份四件套被注入给模型',
    pass: identityOk,
    detail: identityOk ? '' : `翻了 ${blobs.length} 次请求都没找齐姓名/年龄/种族`
  });
}

/**
 * 导出验证。放在宿主侧的原因：渲染层把内容交给主进程之后自己就看不见了。
 *
 * 最有价值的一条是**真往返**：拿渲染层生成的 PNG 字节，用主进程真正在用的
 * pngWithTextChunk 把卡数据插进去，再用 parseCharacterCardPng 读回来 ——
 * 这两步都是真代码（main/png.js），所以「导出的卡能不能被导入」是真验过的。
 */
function probeExports(result) {
  // 按内容找，不按下标 —— 以后调整场景顺序时不会连带把断言搞错
  const charExport = exportedPayloads.find((p) => p.text && p.text.includes('chara_card_v2'));
  const wbExport = exportedPayloads.find((p) => p.text && p.text.includes('"entries"'));
  const convoExport = exportedPayloads.find((p) => String(p.fileName || '').endsWith('.md'));

  // --- 角色卡 ---
  let cardOk = false;
  let cardDetail = '没有导出记录';
  if (charExport) {
    try {
      const png = Buffer.from(String(charExport.base64 || ''), 'base64');
      const withText = pngWithTextChunk(png, charExport.pngText.keyword, charExport.pngText.text);
      const card = parseCharacterCardPng(withText);
      const ext = (card && card.data && card.data.extensions && card.data.extensions.barbara) || {};
      cardOk =
        !!card &&
        card.spec === 'chara_card_v2' &&
        card.data.name === '属性测试角色' &&
        ext.age === '18' &&
        ext.gender === '女' &&
        Array.isArray(ext.attributes) &&
        ext.attributes.length === 2;
      cardDetail = card ? `读回来的是「${card.data.name}」 ext=${JSON.stringify(ext)}` : 'PNG 里没读回卡数据';
    } catch (err) {
      cardDetail = '往返崩了：' + ((err && err.message) || err);
    }
  }
  result.results.push({
    name: '导出：角色卡 PNG 写进去还能读回来（真往返）',
    pass: cardOk,
    detail: cardOk ? '' : cardDetail
  });
  result.results.push({
    name: '导出：角色卡文件名默认 .png',
    pass: !!charExport && String(charExport.fileName).endsWith('.png'),
    detail: String(charExport && charExport.fileName)
  });

  // --- 世界书 ---
  let bookOk = false;
  let bookDetail = '没有导出记录';
  if (wbExport) {
    try {
      const book = JSON.parse(wbExport.text);
      const first = Object.values(book.entries || {})[0];
      bookOk =
        !!book.name &&
        !!first &&
        'key' in first &&
        'keysecondary' in first &&
        'disable' in first &&
        String(wbExport.fileName).endsWith('.json');
      bookDetail = `name=${book.name} 首个条目字段=${first ? Object.keys(first).join(',') : '无'}`;
    } catch (err) {
      bookDetail = 'JSON 解析失败：' + ((err && err.message) || err);
    }
  }
  result.results.push({
    name: '导出：世界书是酒馆认的 lorebook 形状',
    pass: bookOk,
    detail: bookOk ? '' : bookDetail
  });

  // --- 会话 ---
  const md = String((convoExport && convoExport.text) || '');
  const convoOk =
    !!convoExport &&
    String(convoExport.fileName).endsWith('.md') &&
    md.startsWith('# ') &&
    md.includes('改过的回复内容') &&
    md.includes('## 对话');
  result.results.push({
    name: '导出：会话是能读的 Markdown',
    pass: convoOk,
    detail: convoOk ? '' : md.slice(0, 80)
  });
}

/**
 * 递归扫描的引擎级验证。直接打 main/worldbook-match.js —— 比隔着界面点
 * 「预览命中」更精确，能把深度 0/1/3 和「哪条允许往下带」分开验。
 */
function probeRecursion(result) {
  const entry = (id, title, keys, content, recursive) => ({
    id,
    title,
    keys,
    secondaryKeys: [],
    selectiveLogic: 'AND_ANY',
    content,
    constant: false,
    recursive,
    probability: 100,
    order: 100,
    enabled: true
  });

  // 严格链：总览 → 十二泰坦 → 火种。每一条的正文只提下一层的关键词，
  // 所以深度几层就该带出几条 —— 如果总览正文里同时写了「火种」，
  // 那就成了扇出（深度 1 就全出来），验不出「逐层接力」。
  const entries = [
    entry('a', '世界总览', ['翁法罗斯'], '翁法罗斯有十二泰坦。', true),
    entry('b', '十二泰坦', ['十二泰坦'], '十二泰坦守着火种。', true),
    entry('c', '火种', ['火种'], '火种是泰坦留下的力量。', false),
    entry('d', '无关条目', ['没人提的词'], '不该出现。', true)
  ];

  const run = (depth) => matchWorldbookEntries(entries, '翁法罗斯是个什么样的地方？', { recursiveDepth: depth });

  const zero = run(0);
  const one = run(1);
  const three = run(3);

  const titles = (r) => r.hits.map((h) => h.title).join('、');
  const ok =
    zero.hits.length === 1 &&
    zero.recursiveCount === 0 &&
    one.hits.length === 2 &&
    one.recursiveCount === 1 &&
    three.hits.length === 3 &&
    three.recursiveCount === 2 &&
    !titles(three).includes('无关条目') &&
    three.rounds === 3;
  result.results.push({
    name: '递归扫描：深度 0 只给直接命中的那一条',
    pass: zero.hits.length === 1 && zero.recursiveCount === 0,
    detail: `${titles(zero)}（${zero.hits.length} 条）`
  });
  result.results.push({
    name: '递归扫描：深度 1 带出第一层',
    pass: one.hits.length === 2 && one.recursiveCount === 1,
    detail: `${titles(one)}（${one.hits.length} 条）`
  });
  result.results.push({
    name: '递归扫描：逐层接力直到没得带（深度 3 → 3 条 3 轮）',
    pass: ok,
    detail: `${titles(three)}（${three.hits.length} 条 / ${three.rounds} 轮 / 递归 ${three.recursiveCount}）`
  });
  result.results.push({
    name: '递归扫描：命中过的条目不会被重复带进来',
    pass: new Set(three.hits.map((h) => h.id)).size === three.hits.length,
    detail: titles(three)
  });

  // 递归关闭的条目：它的正文不该参与下一轮
  const gated = matchWorldbookEntries(
    [entry('a', '总览', ['翁法罗斯'], '里面写了十二泰坦。', false), entry('b', '十二泰坦', ['十二泰坦'], '细节。', false)],
    '翁法罗斯',
    { recursiveDepth: 3 }
  );
  result.results.push({
    name: '递归扫描：没勾「递归」的条目不会往下带',
    pass: gated.hits.length === 1,
    detail: titles(gated)
  });
}

/**
 * 「给 AI 看图」的验证。
 * 关键不是界面上有没有缩略图，而是**真正发出去的那条消息是不是多模态数组** ——
 * 发错格式的话模型只会当你没发图，而界面上一切正常。
 */
function probeImageMessage(result) {
  let found = null;
  for (const messages of chatPayloads) {
    for (const m of messages) {
      if (m.role === 'user' && Array.isArray(m.content)) {
        found = m;
        break;
      }
    }
    if (found) break;
  }

  const parts = found ? found.content : [];
  const text = parts.find((p) => p.type === 'text');
  const image = parts.find((p) => p.type === 'image_url');

  result.results.push({
    name: '看图：发给模型的是多模态数组',
    pass: !!found,
    detail: found ? `共 ${parts.length} 段` : '翻遍所有请求都没找到数组形态的 user 消息'
  });

  result.results.push({
    name: '看图：数组里同时带上文字和图片',
    pass: !!text && String(text.text).includes('这是我拍的照片') && !!image && String(image.image_url.url).startsWith('data:image/'),
    detail:
      text && image
        ? `text="${String(text.text).slice(0, 14)}" · image=${String(image.image_url.url).slice(0, 24)}`
        : '缺文字段或缺图片段'
  });

  // 没有图的普通消息仍然是纯字符串 —— 别把所有请求都改成数组，
  // 有些便宜的老接口收到数组会直接报错
  const plain = chatPayloads.some((messages) =>
    messages.some((m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('翁法罗斯'))
  );
  result.results.push({
    name: '看图：没带图的消息仍然是纯文本',
    pass: plain,
    detail: plain ? '' : '没找到一条纯文本的用户消息'
  });
}

/**
 * 生图的验证。关键一条：**它用的是「生图」那一组配置，而不是聊天模型** ——
 * 用错了的话界面照样出图，但你的对话模型会被当成画图模型去打 /images/generations，
 * 只会得到一个莫名其妙的报错。
 */
function probeImageGen(result) {
  const req = imageRequests[0];

  result.results.push({
    name: '生图：用的是「生图」那一组配置，不是聊天模型',
    pass: !!req && req.providerId === 'p-img' && req.model === 'img-model-x',
    detail: req ? `providerId=${req.providerId} model=${req.model}` : '没收到生图请求'
  });

  result.results.push({
    name: '生图：提示词取自那条回复的正文',
    pass: !!req && String(req.prompt).includes('冒烟测试回复'),
    detail: req ? `"${String(req.prompt).slice(0, 36)}…"` : ''
  });

  result.results.push({
    name: '生图：请求里带上了尺寸',
    pass: !!req && req.size === '1024x1024',
    detail: req ? String(req.size) : ''
  });
}

/**
 * 向量工具的单测。直接打 main/vectors.js —— 相似度算错了，整套语义检索就是
 * 「随机捞几条塞进上下文」，而且界面上完全看不出来。
 */
function probeVectors(result) {
  const push = (name, pass, detail) => result.results.push({ name, pass: !!pass, detail: detail || '' });

  // 编解码往返
  const original = new Float32Array([0.125, -0.5, 0.75, 1e-3]);
  const back = decodeVector(encodeVector(original));
  push(
    '向量：编码再解码能原样回来',
    back && back.length === original.length && original.every((v, i) => Math.abs(back[i] - v) < 1e-7),
    back ? `[${Array.from(back).join(', ')}]` : '解码失败'
  );

  // base64 比 JSON 数字省得多
  push(
    '向量：存成 base64 比 JSON 数字省',
    encodeVector(original).length < JSON.stringify(Array.from(original)).length,
    `base64 ${encodeVector(original).length} 字节 vs JSON ${JSON.stringify(Array.from(original)).length} 字节`
  );

  push('向量：坏数据解码返回 null', decodeVector('不是base64!!') === null && decodeVector('') === null);

  // 余弦相似度：同向 1、正交 0、反向 -1
  const a = new Float32Array([1, 0]);
  const b = new Float32Array([0, 1]);
  const c = new Float32Array([-1, 0]);
  push(
    '向量：余弦相似度对（同向 1 / 正交 0 / 反向 -1）',
    Math.abs(cosineSimilarity(a, a) - 1) < 1e-6 &&
      Math.abs(cosineSimilarity(a, b)) < 1e-6 &&
      Math.abs(cosineSimilarity(a, c) + 1) < 1e-6,
    [cosineSimilarity(a, a), cosineSimilarity(a, b), cosineSimilarity(a, c)].join(' / ')
  );

  // 没归一化的向量也要能比（各家服务商不一样，这也是当初选余弦的原因）
  const un = new Float32Array([10, 0]);
  push('向量：没归一化也算得对', Math.abs(cosineSimilarity(a, un) - 1) < 1e-6, String(cosineSimilarity(a, un)));
  push('向量：维度不一样返回 0（不瞎算）', cosineSimilarity(new Float32Array([1, 2, 3]), a) === 0);

  // 排序：topK / 阈值 / 排除
  const candidates = [
    { key: 'high', vector: new Float32Array([1, 0, 0.1]) },
    { key: 'mid', vector: new Float32Array([0.7, 0.7, 0.1]) },
    { key: 'low', vector: new Float32Array([0, 1, 0.1]) },
    { key: 'excluded', vector: new Float32Array([1, 0, 0.1]) }
  ];
  const ranked = rankBySimilarity(new Float32Array([1, 0, 0.1]), candidates, { topK: 2, minScore: 0.9 });
  push(
    '向量：topK 和阈值都生效',
    ranked.length === 2 && ranked[0].key === 'high' && ranked[1].key === 'excluded' && ranked[0].score >= ranked[1].score,
    ranked.map((r) => `${r.key}=${r.score.toFixed(3)}`).join(', ')
  );

  const excluded = rankBySimilarity(new Float32Array([1, 0, 0.1]), candidates, {
    topK: 5,
    minScore: 0,
    exclude: new Set(['excluded'])
  });
  push(
    '向量：exclude 里的不会被捞回来',
    excluded.length === 3 && !excluded.some((r) => r.key === 'excluded'),
    excluded.map((r) => r.key).join(', ')
  );

  push(
    '向量：全都不够像时宁可一条都不给',
    rankBySimilarity(new Float32Array([0, 0, 1]), candidates, { topK: 4, minScore: 0.9 }).length === 0,
    ''
  );

  push('向量：内容指纹随内容变', hashText('甲') !== hashText('乙') && hashText('甲') === hashText('甲'));

  // 候选收集：跳过最近几条、只捞绑定的书、空内容不要
  const collected = collectCandidates({
    messages: [
      { role: 'user', content: '很早以前说过的话' },
      { role: 'assistant', content: '很早以前的回复' },
      { role: 'user', content: '刚说的这句' },
      { role: 'user', content: '   ' },
      { role: 'error', content: '出错了' }
    ],
    recentCount: 2,
    books: [
      { id: 'b1', entries: [{ id: 'e1', title: '甲条', content: '甲的内容' }, { id: 'e2', title: '空条', content: '  ' }] },
      { id: 'b2', entries: [{ id: 'e9', title: '没绑的书', content: '不该被捞' }] }
    ],
    worldbookIds: ['b1']
  });
  const keys = collected.map((c) => c.key).join(' | ');
  push(
    '向量：候选收集跳过最近几条消息',
    !collected.some((c) => c.text === '刚说的这句') && collected.some((c) => c.text === '很早以前说过的话'),
    keys
  );
  push(
    '向量：候选收集只捞绑定了的那本书',
    collected.some((c) => c.text === '甲的内容') && !collected.some((c) => c.text === '不该被捞'),
    keys
  );
  push(
    '向量：空白内容和 error 消息都不收',
    !collected.some((c) => c.text === '出错了') && collected.every((c) => c.text.trim()),
    keys
  );
}

/**
 * 语义检索注入链路的验证（宿主侧，看真正发出去的消息）。
 * 光看界面上「有没有反应」是验不出这个功能的 —— 它本来就没有可见反应。
 */
function probeRag(result) {
  const fromSystem = (messages) =>
    (messages || []).find((m) => m.role === 'system' && String(m.content || '').includes('[可能相关的往事]'));

  const withRag = chatPayloads.map(fromSystem).filter(Boolean);
  const section = withRag.length ? String(withRag[withRag.length - 1].content) : '';

  result.results.push({
    name: 'RAG：把相关的设定捞回来注入了',
    pass: !!section && section.includes('十二泰坦'),
    detail: section ? section.replace(/\s+/g, ' ').slice(0, 70) : '所有请求里都没有 [可能相关的往事] 这一段'
  });

  result.results.push({
    name: 'RAG：不像的没被硬凑进来',
    pass: !!section && !section.includes('这条不该被带进来'),
    detail: section.includes('这条不该被带进来') ? '把不相关的条目也塞进来了' : ''
  });

  result.results.push({
    name: 'RAG：注入的是一段独立的 system 消息',
    pass: !!section && section.trim().startsWith('[可能相关的往事]'),
    detail: section ? section.trim().slice(0, 20) : '没找到这一段'
  });

  // 负向对照：关掉之后不该再出现
  const last = chatPayloads[chatPayloads.length - 1];
  result.results.push({
    name: 'RAG：关掉之后就不再注入了',
    pass: !fromSystem(last),
    detail: fromSystem(last) ? '关了还在注入' : ''
  });

  // 渲染层确实把配置传下去了
  const req = ragRequests[0];
  result.results.push({
    name: 'RAG：检索用的是「向量」那组配置',
    pass: !!req && req.providerId === 'p-emb' && req.model === 'emb-model-x',
    detail: req ? `${req.providerId}/${req.model}` : '没收到检索请求'
  });
}

app.whenReady().then(async () => {
  registerStubs();

  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    show: false, // 不弹窗，跑测试不打扰你
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false // 窗口不可见时不要限制定时器/动画帧
    }
  });

  const consoleErrors = [];
  const consoleWarnings = [];

  win.webContents.on('console-message', (...args) => {
    // 新旧 Electron 的事件签名不一样，两种都兜住
    const first = args[0];
    const level = typeof args[1] === 'number' ? args[1] : first && first.level;
    const message = typeof args[2] === 'string' ? args[2] : first && first.message;
    const text = String(message == null ? '' : message);
    if (level === 3 || level === 'error') consoleErrors.push(text);
    else if (level === 2 || level === 'warning') consoleWarnings.push(text);
  });

  let crashed = '';
  try {
    await win.loadFile(path.join(APP_DIR, 'renderer', 'index.html'));
  } catch (err) {
    crashed = '页面加载失败：' + ((err && err.message) || err);
  }

  let result = null;
  if (!crashed) {
    const domScript = fs.readFileSync(path.join(__dirname, 'smoke-renderer.js'), 'utf8');
    try {
      result = await win.webContents.executeJavaScript(`(async () => {\n${domScript}\n})()`);
    } catch (err) {
      crashed = '页面内脚本执行失败：' + ((err && err.message) || err);
    }
  }

  if (!crashed && result) {
    try {
      probeInjection(result);
      probeExports(result);
      probeRecursion(result);
      probeImageMessage(result);
      probeImageGen(result);
      probeVectors(result);
      probeRag(result);
      await probeHover(win, result);
    } catch (err) {
      crashed = '宿主侧验证失败：' + ((err && err.message) || err);
    }
  }

  const ok = report(result, consoleErrors, consoleWarnings, crashed);
  app.exit(ok ? 0 : 1);
});
// 兜底：万一卡住（窗口没起来 / executeJavaScript 不返回），别让终端一直挂着
setTimeout(() => {
  console.error('\n  ⏱ 冒烟测试超过 90 秒没有结束，判定失败\n');
  app.exit(2);
}, OVERALL_TIMEOUT_MS).unref();
