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
    worldbooks: [{ id: 'w-test', name: '冒烟测试世界', entries: [], characters: [], opening: '' }],
    conversations: [],
    activeId: null
  };
}

const store = makeStore();
const calls = []; // 记录渲染层请求过的写操作，方便排查
let lastChatMessages = null; // 最后一次发给模型的完整消息，用来验「注入内容」

function remember(channel, payload) {
  calls.push(channel);
  if (channel === 'characters:save' && payload && Array.isArray(payload.worldbooks)) {
    store.worldbooks = clone(payload.worldbooks);
  }
}

function registerStubs() {
  // --- 设置 ---
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
    if (payload && Array.isArray(payload.characters)) store.characters = clone(payload.characters);
    if (payload && Array.isArray(payload.worldbooks)) store.worldbooks = clone(payload.worldbooks);
    return { ok: true };
  });
  ipcMain.on('characters:save-sync', (_event, payload) => {
    remember('characters:save-sync', payload);
    if (payload && Array.isArray(payload.characters)) store.characters = clone(payload.characters);
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
  ipcMain.handle('worldbooks:preview', () => ({ section: '' }));

  // --- 图片 / 杂项 ---
  ipcMain.handle('images:pick', () => ({ canceled: true }));
  ipcMain.handle('util:copy', () => true);
  ipcMain.handle('util:openPath', () => true);

  // --- 聊天：假装模型回了一句话，并且真的走一遍流式通道 ---
  ipcMain.handle('chat:stop', () => true);
  ipcMain.handle('chat:send', async (event, payload) => {
    remember('chat:send');
    lastChatMessages = clone((payload && payload.messages) || []);
    const requestId = (payload && payload.requestId) || 'req-smoke';
    const model = (payload && payload.model) || 'test-model';

    // 把「打字机」那条链路也带上：分两次推增量
    for (const piece of ['冒烟测试', '回复']) {
      if (!event.sender.isDestroyed()) event.sender.send('chat:chunk', { requestId, text: piece });
      await sleep(10);
    }

    return {
      ok: true,
      requestId,
      model,
      content: '冒烟测试回复：我收到了。',
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
 * 注入内容验证：看**真正发给模型的消息**里有没有状态面板。
 *
 * 这是唯一能确认「属性真的被注入」的地方 —— 页面上看不出模型收到了什么，
 * 而这条链路（角色卡属性 → 会话面板 → 系统提示词）正是这个功能的全部意义。
 */
function probeInjection(result) {
  if (!result) return;

  const blob = (lastChatMessages || []).map((m) => String((m && m.content) || '')).join('\n');
  const hasGold = blob.includes('【金币】：100');
  const hasTop = blob.includes('【上衣】：布衣');
  const hasPreamble = blob.includes('[当前状态]');

  result.results.push({
    name: '属性：注入给模型的消息里带上了状态面板',
    pass: hasGold && hasTop && hasPreamble,
    detail: `[当前状态]=${hasPreamble} 金币=${hasGold} 上衣=${hasTop}`
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
