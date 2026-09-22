// ============================================================================
//  smoke-renderer.js —— 冒烟测试里「跑在页面里」的那一半
//
//  这份代码会被 tools/smoke-test.js 用 executeJavaScript 注入到真实的
//  renderer/index.html 里执行（外面包了一层 async IIFE）。
//
//  规矩（很重要，别破坏）：
//    · 只允许「点真实按钮 + 读真实 DOM + 调 window.barbara 这个 preload 桥」
//    · 绝对不要调用 renderer.js 里的内部函数（sendMessage / newCharacter 之类）
//      因为渲染层正在往 ES module 迁移 —— 迁移之后那些函数就不再是全局的了，
//      凡是直接调它们的测试会**当场全部失效**。
//      「点按钮 + 读 DOM」这套写法能扛住整个重构。
//    · 断言「有没有落盘」一律走 window.barbara.getXxx()，那是唯一可信的持久化视图。
//
//  跑完返回 { results, notes }。
//
//  注意：这个文件**不能单独跑**（下面用了顶层 await），它靠外面那层 async IIFE 包住，
//  所以 `node --check tools/smoke-renderer.js` 会报语法错 —— 那是正常的。
// ============================================================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const byId = (x) => document.getElementById(x);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const notes = [];
let currentScenario = '';

/** 记一条断言结果（自动带上当前场景名，报告里好分组） */
function check(name, pass, detail) {
  const full = currentScenario ? `${currentScenario} · ${name}` : name;
  results.push({ name: full, pass: !!pass, detail: pass || detail == null ? '' : String(detail) });
}

/** 轮询等待，超时抛错（比固定 sleep 稳，也比 sleep 快） */
async function waitFor(label, fn, timeout = 5000) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = fn();
    } catch (err) {
      /* 元素还没出现，继续等 */
    }
    if (ok) return ok;
    if (Date.now() - t0 > timeout) throw new Error(`等待超时（${timeout}ms）：${label}`);
    await sleep(25);
  }
}

/** 每个场景独立 try/catch：一个崩了不影响后面的 */
async function scenario(name, fn) {
  currentScenario = name;
  try {
    await fn();
  } catch (err) {
    check('场景没能跑完', false, (err && err.message) || String(err));
  }
  currentScenario = '';
}

function click(target) {
  const node = typeof target === 'string' ? $(target) : target;
  if (!node) throw new Error(`找不到要点的元素：${target}`);
  node.click();
  return node;
}

function setValue(target, value) {
  const node = typeof target === 'string' ? $(target) : target;
  if (!node) throw new Error(`找不到输入框：${target}`);
  node.value = value;
  node.dispatchEvent(new Event('input', { bubbles: true }));
  return node;
}

/** 按按钮上的文字找按钮（卡片上的「编辑」「聊天」「游玩」都是这么找的） */
function buttonByText(root, text) {
  if (!root) return null;
  return Array.from(root.querySelectorAll('button')).find((b) => b.textContent.trim() === text) || null;
}

/** 元素存在而且没有 .hidden */
function shown(sel) {
  const node = $(sel);
  return !!node && !node.classList.contains('hidden');
}

async function savedCharacters() {
  const res = await window.barbara.getCharacters();
  return (res && res.characters) || [];
}
async function savedWorldbooks() {
  const res = await window.barbara.getWorldbooks();
  return (res && res.worldbooks) || [];
}

// ---------------------------------------------------------------------------
//  场景 1：启动
// ---------------------------------------------------------------------------
await scenario('启动', async () => {
  await waitFor('主界面渲染出会话列表', () => $$('#convo-list .convo-item').length > 0);
  check('主界面已渲染', !!$('#messages') && !!$('#input') && !!$('#btn-send'));
  check('没有掉进「启动失败」兜底页', !document.body.textContent.includes('启动失败'));
  check('没有会话时自动建了一个会话', $$('#convo-list .convo-item').length === 1);
});

// ---------------------------------------------------------------------------
//  场景 2：主题切换（顺带验证 settings 落盘）
// ---------------------------------------------------------------------------
await scenario('主题切换', async () => {
  const before = document.documentElement.getAttribute('data-theme');
  click('#btn-theme');
  await waitFor('data-theme 变化', () => document.documentElement.getAttribute('data-theme') !== before);

  const after = document.documentElement.getAttribute('data-theme');
  check('data-theme 变了', after !== before, `${before} → ${after}`);

  await sleep(150);
  const settings = (await window.barbara.getSettings()).settings;
  check('主题已落盘', settings.theme === after, `落盘的是 ${settings.theme}`);

  click('#btn-theme'); // 切回去，别影响后面的场景
  await waitFor('主题切回', () => document.documentElement.getAttribute('data-theme') === before);
});

// ---------------------------------------------------------------------------
//  场景 3：设置弹窗
// ---------------------------------------------------------------------------
await scenario('设置弹窗', async () => {
  click('#btn-settings');
  await waitFor('设置弹窗打开', () => shown('#settings-modal'));
  check('设置弹窗里有表单卡片', !!$('#settings-modal .modal-card'));

  click('#btn-close-settings');
  await waitFor('设置弹窗关闭', () => !shown('#settings-modal'));
});

// ---------------------------------------------------------------------------
//  场景 4：角色库 —— 新建必须「保存后才生成」
// ---------------------------------------------------------------------------
await scenario('角色库：新建角色', async () => {
  click('#btn-chars');
  await waitFor('切到角色库页面', () => shown('#view-chars'));
  check('角色库一开始是空的', shown('#char-page-empty'));

  const before = (await savedCharacters()).length;

  click('#btn-new-char');
  await waitFor('角色编辑器打开', () => shown('#chars-modal'));
  check('标题是「新建角色」', byId('chars-title').textContent === '新建角色', byId('chars-title').textContent);
  check('保存前列表里没有多出卡片', $$('#char-page-grid .char-card').length === before);
  check('保存前「删除角色」是禁用的', byId('btn-del-char').disabled === true);

  // 关键断言：这一刻磁盘上不该有它
  const mid = (await savedCharacters()).length;
  check('保存前没有落盘', mid === before, `期望 ${before}，实际 ${mid}`);

  setValue('#c-name', '冒烟测试角色');
  setValue('#c-desc', '这是冒烟测试写进去的描述');
  setValue('#c-tags', '测试分类, 治愈');
  click('#btn-save-char');

  await waitFor('角色卡片出现', () => $$('#char-page-grid .char-card').length === before + 1);

  const saved = await savedCharacters();
  check('保存后落盘了一个角色', saved.length === before + 1, `实际 ${saved.length}`);
  const last = saved[saved.length - 1] || {};
  check('落盘的角色名正确', last.name === '冒烟测试角色', `落盘的是「${last.name}」`);
  check('落盘的描述正确', last.description === '这是冒烟测试写进去的描述', `落盘的是「${last.description}」`);
  check('标题变回「编辑角色」', byId('chars-title').textContent === '编辑角色', byId('chars-title').textContent);

  const card = $$('#char-page-grid .char-card')[0];
  check('卡片上有「编辑」和「聊天」两个入口', !!buttonByText(card, '编辑') && !!buttonByText(card, '聊天'));

  // 标签是「这张卡属于什么类型」，得让人在列表页就看得见，否则分类没意义
  const subText = card.querySelector('.char-card-sub').textContent;
  check('卡片上显示了分类标签', subText.includes('测试分类') && subText.includes('治愈'), subText);
  check('卡片上仍然标着来源', subText.includes('手写'), subText);
});

// ---------------------------------------------------------------------------
//  场景 5：角色库 —— 放弃新建不能留下东西
// ---------------------------------------------------------------------------
await scenario('角色库：放弃新建', async () => {
  const before = (await savedCharacters()).length;
  const cardsBefore = $$('#char-page-grid .char-card').length;

  click('#btn-new-char');
  await waitFor('角色编辑器打开', () => shown('#chars-modal'));
  setValue('#c-name', '半途而废');

  click('#btn-close-chars');
  await waitFor('弹出放弃确认框', () => shown('#confirm-modal'));
  check('确认框里带了刚输入的名字', byId('confirm-message').textContent.includes('半途而废'), byId('confirm-message').textContent);

  click('#confirm-ok');
  await waitFor('编辑器关闭', () => !shown('#chars-modal'));
  await sleep(150);

  const after = (await savedCharacters()).length;
  check('放弃后没有新增角色', after === before, `期望 ${before}，实际 ${after}`);
  check('放弃后卡片数量不变', $$('#char-page-grid .char-card').length === cardsBefore);
});

// ---------------------------------------------------------------------------
//  场景 6：角色库 —— 编辑已有角色是「更新」，不是「新增」
// ---------------------------------------------------------------------------
await scenario('角色库：编辑已有角色', async () => {
  const before = (await savedCharacters()).length;
  const cards = $$('#char-page-grid .char-card');
  check('有可编辑的卡片', cards.length > 0);

  click(buttonByText(cards[0], '编辑'));
  await waitFor('编辑器打开', () => shown('#chars-modal'));
  check('编辑已有角色时标题是「编辑角色」', byId('chars-title').textContent === '编辑角色', byId('chars-title').textContent);
  check('「删除角色」按钮可用', byId('btn-del-char').disabled === false);

  setValue('#c-name', '改过名字的角色');
  click('#btn-save-char');
  await waitFor('卡片改名', () => $$('#char-page-grid .char-card-name').some((n) => n.textContent === '改过名字的角色'));

  const after = await savedCharacters();
  check('没有新增角色', after.length === before, `期望 ${before}，实际 ${after.length}`);
  check('落盘的名字被更新了', after.some((c) => c.name === '改过名字的角色'));

  click('#btn-close-chars');
  await sleep(120);
  check('关闭已有角色时不弹确认框', !shown('#confirm-modal'));
});

// ---------------------------------------------------------------------------
//  场景 7：角色库 —— 角色卡右上角直接删除
// ---------------------------------------------------------------------------
await scenario('角色库：卡片上删除', async () => {
  const before = (await savedCharacters()).length;
  check('待删的角色存在', before > 0, `实际 ${before}`);

  const delBtn = $$('#char-page-grid .char-card')[0].querySelector('.char-card-del');
  check('卡片上有删除按钮（×）', !!delBtn);
  check('删除按钮平时是透明的（悬停才浮出）', !!delBtn && getComputedStyle(delBtn).opacity === '0');

  // --- 先点「取消」：角色必须还在 ---
  click(delBtn);
  await waitFor('确认框出现', () => shown('#confirm-modal'));
  check('确认文案说明了会话会受影响', byId('confirm-message').textContent.includes('会话'), byId('confirm-message').textContent);
  click('#confirm-cancel');
  await sleep(150);
  check('点取消后角色还在', (await savedCharacters()).length === before, `实际 ${(await savedCharacters()).length}`);

  // --- 再点「删除」：角色消失并落盘 ---
  click($$('#char-page-grid .char-card')[0].querySelector('.char-card-del'));
  await waitFor('确认框出现', () => shown('#confirm-modal'));
  click('#confirm-ok');
  await waitFor('卡片消失', () => $$('#char-page-grid .char-card').length === before - 1);

  const after = (await savedCharacters()).length;
  check('删除后落盘数量正确', after === before - 1, `期望 ${before - 1}，实际 ${after}`);
  check('删空后显示空状态', shown('#char-page-empty'));
});

// ---------------------------------------------------------------------------
//  场景 8：角色属性 → 状态面板（属性模板的完整链路）
// ---------------------------------------------------------------------------
await scenario('属性：从角色卡种到状态面板', async () => {
  // --- 1) 设置里编辑「常用属性」，快捷候选词要跟着变 ---
  click('#btn-settings');
  await waitFor('设置弹窗打开', () => shown('#settings-modal'));
  check('设置里有常用属性输入框', !!byId('s-commonattrs'));

  setValue('#s-commonattrs', '金币, 上衣, 下衣');
  click('#btn-save-settings');
  await waitFor('设置弹窗关闭', () => !shown('#settings-modal'));
  await sleep(150);

  const savedSettings = (await window.barbara.getSettings()).settings;
  check(
    '常用属性已落盘',
    JSON.stringify(savedSettings.commonAttributes) === JSON.stringify(['金币', '上衣', '下衣']),
    JSON.stringify(savedSettings.commonAttributes)
  );

  // --- 2) 角色编辑器里用快捷按钮加属性 ---
  click('#btn-chars');
  await waitFor('切到角色库页面', () => shown('#view-chars'));
  click('#btn-new-char');
  await waitFor('角色编辑器打开', () => shown('#chars-modal'));
  setValue('#c-name', '属性测试角色');

  const quick = $$('#c-attr-quick .attr-quick-btn');
  check('快捷候选词按钮出现了', quick.length === 3, `实际 ${quick.length} 个`);

  click(quick[0]); // 金币
  await waitFor('属性行出现', () => $$('#c-attr-list .attr-row').length === 1);
  check('快捷加进来的名字对', byId('c-attr-list').querySelector('.attr-name').textContent === '金币');
  check('加过的候选词就不再显示了', $$('#c-attr-quick .attr-quick-btn').length === 2, `剩余 ${$$('#c-attr-quick .attr-quick-btn').length} 个`);

  // 手写一个（不走快捷按钮）
  setValue('#c-attr-new', '上衣');
  click('#btn-add-attr');
  await waitFor('第二个属性行', () => $$('#c-attr-list .attr-row').length === 2);

  // 保留字段名要被拦下（这些是提示词自己的段落标记，当属性会打架）
  setValue('#c-attr-new', '旁白');
  click('#btn-add-attr');
  await sleep(100);
  check('保留字段名被拒绝', $$('#c-attr-list .attr-row').length === 2, `实际 ${$$('#c-attr-list .attr-row').length}`);

  // 填初始值
  const attrRows = $$('#c-attr-list .attr-row');
  setValue(attrRows[0].querySelector('.attr-value'), '100');
  setValue(attrRows[1].querySelector('.attr-value'), '布衣');

  click('#btn-save-char');
  await waitFor('保存完成', () => byId('chars-title').textContent === '编辑角色');
  await sleep(150);

  const saved = await savedCharacters();
  const mine = saved.find((c) => c.name === '属性测试角色');
  check('属性已落盘到角色卡', !!mine && Array.isArray(mine.attributes) && mine.attributes.length === 2, JSON.stringify(mine && mine.attributes));
  check(
    '初始值也一起落盘了',
    !!mine && mine.attributes[0].name === '金币' && mine.attributes[0].value === '100' && mine.attributes[1].value === '布衣',
    JSON.stringify(mine && mine.attributes)
  );

  // --- 3) 点「聊天」绑定角色 → 属性应该种进状态面板 ---
  click('#btn-close-chars');
  await sleep(150);

  const card = $$('#char-page-grid .char-card').find((c) => c.textContent.includes('属性测试角色'));
  check('找到了新角色的卡片', !!card);
  click(buttonByText(card, '聊天'));
  await waitFor('切到聊天视图', () => shown('#view-chat'));

  await waitFor('状态面板出现', () => shown('#panel-box'));
  const panelRows = $$('#panel-fields .panel-row');
  const panelNames = panelRows.map((r) => r.querySelector('.panel-name').textContent);
  check('面板里出现了角色属性', panelNames.includes('金币') && panelNames.includes('上衣'), JSON.stringify(panelNames));

  const goldRow = panelRows.find((r) => r.querySelector('.panel-name').textContent === '金币');
  check(
    '面板里的值是角色卡上的初始值',
    !!goldRow && goldRow.querySelector('input').value === '100',
    goldRow ? goldRow.querySelector('input').value : '没找到「金币」那一行'
  );

  // --- 4) 发一条：注入给模型的消息里必须真的带上面板 ---
  // 断言在宿主侧做（要看 chat:send 的 payload），这里只负责发出去
  setValue('#input', '冒烟测试：属性注入');
  click('#btn-send');
  await waitFor('收到回复', () => $('#messages').textContent.includes('冒烟测试回复'), 8000);
});

// ---------------------------------------------------------------------------
//  场景 9：聊天 —— 发一条能收到回复
// ---------------------------------------------------------------------------
await scenario('聊天：发送与回复', async () => {
  click('#convo-list .convo-item');
  await waitFor('切回聊天视图', () => shown('#view-chat'));

  // 用「消息条数」判断新回复，而不是找某个文字 ——
  // 这个会话里可能已经有别的回复带着同样的文字了（属性场景就发过一条）
  const beforeMsgs = $$('#messages .msg').length;

  setValue('#input', '冒烟测试：你好');
  click('#btn-send');

  await waitFor('新回复出现', () => $$('#messages .msg').length >= beforeMsgs + 2, 8000);
  await waitFor('助手回复出现', () => $('#messages').textContent.includes('冒烟测试回复'), 8000);
  await waitFor('流式状态结束', () => byId('btn-send').disabled === false, 8000);

  check('用户消息已渲染', $('#messages').textContent.includes('冒烟测试：你好'));
  check('助手回复已渲染', $('#messages').textContent.includes('冒烟测试回复'));
  check('没有出现错误气泡', $$('#messages .msg.error').length === 0);
  check('发送按钮恢复可用（没有卡在流式状态）', byId('btn-send').disabled === false);
  check('停止按钮已隐藏', shown('#btn-stop') === false);
});

// ---------------------------------------------------------------------------
//  场景 10：世界书 —— 新建条目
// ---------------------------------------------------------------------------
await scenario('世界书：新建条目', async () => {
  click('#btn-worldbooks');
  await waitFor('切到世界书页面', () => shown('#view-worldbooks'));
  check('种子里那本世界书有卡片', $$('#wb-page-grid .char-card').length === 1);

  click(buttonByText($$('#wb-page-grid .char-card')[0], '编辑'));
  await waitFor('世界书弹窗打开', () => shown('#worldbooks-modal'));

  click('#btn-new-entry');
  setValue('#wb-e-title', '冒烟测试条目');
  setValue('#wb-e-keys', '冒烟');
  setValue('#wb-e-content', '命中时注入的设定内容');
  click('#btn-save-entry');

  await waitFor('条目出现在列表里', () => $('#wb-entry-list').textContent.includes('冒烟测试条目'));

  const books = await savedWorldbooks();
  const titles = (books[0].entries || []).map((e) => e.title);
  check('条目已落盘', titles.includes('冒烟测试条目'), `落盘的是 ${JSON.stringify(titles)}`);
});

// ---------------------------------------------------------------------------
//  场景 11：世界书 —— 新建「本书角色」，同时验证编辑器没被世界书弹窗盖住
// ---------------------------------------------------------------------------
await scenario('世界书：本书角色', async () => {
  // 世界书弹窗还开着
  click('#btn-new-wb-char');
  await waitFor('角色编辑器打开', () => shown('#chars-modal'));
  check('标题是「新建本书角色」', byId('chars-title').textContent === '新建本书角色', byId('chars-title').textContent);

  // 回归测试：角色编辑器必须盖在世界书弹窗上面（否则点了跟没反应一样）
  const cx = Math.floor(innerWidth / 2);
  const cy = Math.floor(innerHeight / 2);
  const top = document.elementFromPoint(cx, cy);
  const where = top ? (top.closest('#chars-modal') ? 'chars' : top.closest('#worldbooks-modal') ? 'worldbooks' : 'other') : 'null';
  check('编辑器没有被世界书弹窗盖住', where === 'chars', `最上层是 ${where}`);

  const before = ((await savedWorldbooks())[0].characters || []).length;

  setValue('#c-name', '冒烟NPC');
  click('#btn-save-char');
  await waitFor('副本 chip 出现', () => $('#wb-char-list').textContent.includes('冒烟NPC'));

  const after = ((await savedWorldbooks())[0].characters || []).length;
  check('副本已落盘', after === before + 1, `期望 ${before + 1}，实际 ${after}`);

  click('#btn-close-chars');
  await sleep(120);
  check('副本保存后关闭不弹确认框', !shown('#confirm-modal'));

  click('#btn-close-worldbooks');
  await waitFor('世界书弹窗关闭', () => !shown('#worldbooks-modal'));
});

// ---------------------------------------------------------------------------
//  场景 12：进入世界 —— 玩家角色弹窗
// ---------------------------------------------------------------------------
await scenario('进入世界：玩家角色', async () => {
  click('#btn-worldbooks');
  await waitFor('切到世界书页面', () => shown('#view-worldbooks'));

  click(buttonByText($$('#wb-page-grid .char-card')[0], '游玩'));
  await waitFor('玩家角色弹窗打开', () => shown('#player-modal'));
  check('弹窗里有角色名输入框', !!byId('player-name'));

  click('#btn-cancel-player');
  await waitFor('玩家角色弹窗关闭', () => !shown('#player-modal'));
});

notes.push(`磁盘上的角色数：${(await savedCharacters()).length}`);
notes.push(`磁盘上的世界书数：${(await savedWorldbooks()).length}`);
notes.push(`会话数：${$$('#convo-list .convo-item').length}`);

// ---------------------------------------------------------------------------
//  留给宿主做「真实鼠标悬停」验证
//  :hover 只认真实指针，页面里模拟不出来（派发 mouseover 事件不算），
//  所以这里只把卡片摆好、把坐标交回去，由 smoke-test.js 发输入事件。
// ---------------------------------------------------------------------------
let hoverProbe = null;
await scenario('准备悬停验证', async () => {
  click('#btn-chars');
  await waitFor('切到角色库页面', () => shown('#view-chars'));

  // 这里可能已经有别的角色卡了（属性场景留下的），所以按「多了一张」判断
  const beforeCards = $$('#char-page-grid .char-card').length;

  click('#btn-new-char');
  await waitFor('角色编辑器打开', () => shown('#chars-modal'));
  setValue('#c-name', '悬停验证角色');
  click('#btn-save-char');
  await waitFor('卡片出现', () => $$('#char-page-grid .char-card').length === beforeCards + 1);
  click('#btn-close-chars');
  await sleep(120);

  const card = $$('#char-page-grid .char-card')[0];
  const r = card.getBoundingClientRect();
  hoverProbe = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  check('卡片已就位，坐标可交给宿主', !!hoverProbe && hoverProbe.x > 0 && hoverProbe.y > 0, JSON.stringify(hoverProbe));
});

return { results, notes, hoverProbe };
