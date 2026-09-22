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
  setValue('#c-desc', '属性测试角色的设定文本');
  setValue('#c-personality', '沉默寡言');
  setValue('#c-age', '18');
  setValue('#c-gender', '女');
  check('新建角色时种族默认就是人类', byId('c-race').value === '人类', byId('c-race').value);
  setValue('#c-race', '精灵');

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
  check(
    '身份三项也落盘了',
    !!mine && mine.age === '18' && mine.gender === '女' && mine.race === '精灵',
    JSON.stringify({ age: mine && mine.age, gender: mine && mine.gender, race: mine && mine.race })
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

  // 单角色对话（角色库点「聊天」）也得把身份四项带上 ——
  // 这一条当初漏了，结果 16 岁的角色被 AI 回复成 21 岁
  check('单角色对话也把身份种进了面板', ['姓名', '年龄', '性别', '种族'].every((n) => panelNames.includes(n)), JSON.stringify(panelNames));
  const identityValue = (field) => {
    const row = panelRows.find((r) => r.querySelector('.panel-name').textContent === field);
    return row ? row.querySelector('input').value : null;
  };
  check(
    '身份取的是角色卡上的值',
    identityValue('年龄') === '18' && identityValue('性别') === '女' && identityValue('种族') === '精灵',
    JSON.stringify({ 年龄: identityValue('年龄'), 性别: identityValue('性别'), 种族: identityValue('种族') })
  );
  check('姓名取的是角色名', identityValue('姓名') === '属性测试角色', String(identityValue('姓名')));

  // --- 4) 发一条：注入给模型的消息里必须真的带上面板 ---
  // 断言在宿主侧做（要看 chat:send 的 payload），这里只负责发出去
  setValue('#input', '冒烟测试：属性注入');
  click('#btn-send');
  await waitFor('收到回复', () => $('#messages').textContent.includes('冒烟测试回复'), 8000);
});

// ---------------------------------------------------------------------------
//  场景 9：状态面板 —— 默认收起，随时展开
// ---------------------------------------------------------------------------
await scenario('状态面板：默认收起 / 随时展开', async () => {
  await waitFor('面板在', () => shown('#panel-box') && !!byId('btn-panel-collapse'));

  const fieldsH = () => byId('panel-fields').getBoundingClientRect().height;
  const boxH = () => Math.round(byId('panel-box').getBoundingClientRect().height);

  // 默认收起：只留一条细条，但一直在那儿
  check('默认就是收起的', byId('panel-box').classList.contains('collapsed'));
  check('收起时字段区不显示', fieldsH() === 0, `字段区高度 ${fieldsH()}`);
  const collapsedH = boxH();
  check('收起时面板还在（一根细条）', shown('#panel-box') && collapsedH > 0 && collapsedH < 80, `${collapsedH}px`);

  // 关键：收起之后那个开关还得看得见、点得到，否则「随时打开」就是空话
  const toggleBox = byId('btn-panel-collapse').getBoundingClientRect();
  check('收起后开关仍然可见可点', toggleBox.height > 0 && toggleBox.width > 0, `${Math.round(toggleBox.width)}×${Math.round(toggleBox.height)}`);

  click('#btn-panel-collapse');
  await sleep(120);
  const expandedH = boxH();
  check('点一下就展开', fieldsH() > 0 && !byId('panel-box').classList.contains('collapsed'));
  check('展开后 aria 也对', byId('btn-panel-collapse').getAttribute('aria-expanded') === 'true');
  check('展开确实比收起高', expandedH > collapsedH, `${collapsedH} → ${expandedH}`);

  click('#btn-panel-collapse');
  await sleep(120);
  check('再点一下又收起', fieldsH() === 0);

  // 整条标题栏都能点（不必瞄准那个小箭头）
  click('#panel-head');
  await sleep(120);
  check('点标题栏空白处也能展开', fieldsH() > 0);

  click('#panel-head');
  await sleep(120);
  check('点标题栏空白处也能收起', fieldsH() === 0);

  // 右上角那个「状态」按钮已经去掉了，别再回来
  check('顶栏的「状态」按钮已移除', !byId('btn-panel-toggle'));
});

// ---------------------------------------------------------------------------
//  场景 10：聊天 —— 发一条能收到回复
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

  // 重点的两档样式：**加粗** 和 ==高亮== 要变成真元素，而不是原样显示星号/等号
  const strong = $('#messages strong');
  check('**加粗** 渲染成了 <strong>', !!strong && strong.textContent === '这是加粗', strong ? strong.textContent : `原始文本里有没有 **：${$('#messages').textContent.includes('**')}`);
  const em = $('#messages .msg-em');
  check('==高亮== 渲染成了 .msg-em', !!em && em.textContent === '这是高亮', em ? em.textContent : '没找到 .msg-em');
  check('标记符号本身没有露出来', !$('#messages').textContent.includes('**') && !$('#messages').textContent.includes('=='), $('#messages').textContent.slice(0, 80));
});

// ---------------------------------------------------------------------------
//  场景 11：对话窗口外观（字号 / 加粗颜色 / 背景图）
// ---------------------------------------------------------------------------
await scenario('对话窗口外观', async () => {
  click('#btn-appearance');
  await waitFor('外观弹窗打开', () => shown('#appearance-modal'));
  check(
    '三样控件都在（字号 / 颜色 / 背景）',
    !!byId('appearance-fontsize') && !!byId('appearance-boldcolor-text') && !!byId('btn-pick-bg')
  );

  const bubble = $('#messages .bubble');
  const strong = $('#messages .bubble strong');
  check('聊天里有个 <strong> 可以用来验颜色', !!bubble && !!strong);

  // --- 字号 ---
  const beforeSize = getComputedStyle(bubble).fontSize;
  setValue('#appearance-fontsize', '20');
  byId('appearance-fontsize').dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(250);
  check('字号改了正文的实际大小', getComputedStyle(bubble).fontSize === '20px', `${beforeSize} → ${getComputedStyle(bubble).fontSize}`);
  check('旁边的数字也跟着变', byId('appearance-fontsize-value').textContent === '20px', byId('appearance-fontsize-value').textContent);
  check('字号落盘了', (await window.barbara.getSettings()).settings.chatFontSize === 20);

  // 滑块的「已选比例」是自己用渐变画的（原生那条未选轨道在浅色下是黑的），
  // 所以值一变就得跟着更新 —— 12–22 的滑条拉到 20 是 80%
  const fill = byId('appearance-fontsize').style.getPropertyValue('--range-fill');
  check('滑块的已选比例跟着值走', fill === '80%', `--range-fill = ${fill}`);

  // --- 加粗颜色：手填 ---
  setValue('#appearance-boldcolor-text', '#e06c75');
  byId('appearance-boldcolor-text').dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(250);
  check('加粗字真的变色了', getComputedStyle(strong).color === 'rgb(224, 108, 117)', getComputedStyle(strong).color);
  check('颜色落盘了', (await window.barbara.getSettings()).settings.chatBoldColor === '#e06c75');

  // 不带 # 也认
  setValue('#appearance-boldcolor-text', '00aaff');
  byId('appearance-boldcolor-text').dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(250);
  check('不带 # 也认', (await window.barbara.getSettings()).settings.chatBoldColor === '#00aaff', (await window.barbara.getSettings()).settings.chatBoldColor);

  // 乱填要挡下来，而且不能把原来的值冲掉
  setValue('#appearance-boldcolor-text', 'red');
  byId('appearance-boldcolor-text').dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(250);
  check(
    '乱填的颜色被拒绝、原值不变',
    (await window.barbara.getSettings()).settings.chatBoldColor === '#00aaff',
    (await window.barbara.getSettings()).settings.chatBoldColor
  );

  // --- 背景图：走真实的「选图 → 压缩 → 存起来」链路 ---
  click('#btn-pick-bg');
  await waitFor('背景预览出现', () => shown('#appearance-bg-preview') && !!$('#appearance-bg-preview img'), 10000);
  check('消息区挂上了背景图', getComputedStyle($('#messages')).backgroundImage.includes('data:image'), getComputedStyle($('#messages')).backgroundImage.slice(0, 50));
  check(
    '背景图落盘了',
    String((await window.barbara.getSettings()).settings.chatBackground).startsWith('data:image/'),
    String((await window.barbara.getSettings()).settings.chatBackground).slice(0, 40)
  );

  // --- 清除 ---
  click('#btn-clear-bg');
  await sleep(250);
  check('清掉之后消息区没有背景图', !getComputedStyle($('#messages')).backgroundImage.includes('data:image'), getComputedStyle($('#messages')).backgroundImage);
  check('没背景时「清除」是禁用的', byId('btn-clear-bg').disabled === true);

  click('#btn-boldcolor-reset');
  await sleep(250);
  check('复位后加粗颜色跟随正文', (await window.barbara.getSettings()).settings.chatBoldColor === '');

  click('#btn-close-appearance');
  await waitFor('外观弹窗关闭', () => !shown('#appearance-modal'));
});

// ---------------------------------------------------------------------------
//  场景 12：世界书 —— 新建条目
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
await scenario('进入世界：用角色卡当自己', async () => {
  click('#btn-worldbooks');
  await waitFor('切到世界书页面', () => shown('#view-worldbooks'));

  click(buttonByText($$('#wb-page-grid .char-card')[0], '游玩'));
  await waitFor('玩家角色弹窗打开', () => shown('#player-modal'));
  check('弹窗里有角色名输入框', !!byId('player-name'));

  // 角色库里有「属性测试角色」（带金币/上衣两个属性）
  const options = $$('#player-char option').map((o) => o.textContent);
  check('下拉里有「自己写一个」和角色库的人', options.includes('（自己写一个）') && options.includes('属性测试角色'), JSON.stringify(options));

  // --- 选一张角色卡：名字和设定应该自动填进去 ---
  const cardId = $$('#player-char option').find((o) => o.textContent === '属性测试角色').value;
  setValue('#player-char', cardId).dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(80);

  check('名字被自动填上了', byId('player-name').value === '属性测试角色', byId('player-name').value);
  check('设定也带过来了', byId('player-profile').value.length > 0, `${byId('player-profile').value.length} 字`);
  check('预览说明了会带上哪些属性', shown('#player-char-preview') && byId('player-char-preview').textContent.includes('金币'), byId('player-char-preview').textContent);

  // 填完还能改 —— 改了以你改的为准
  setValue('#player-name', '改过的名字');
  check('选了之后名字仍然可改', byId('player-name').value === '改过的名字');

  // --- 开始游玩：面板里要出现这张卡的属性 ---
  click('#btn-start-play');
  await waitFor('进入世界', () => shown('#view-chat') && !shown('#player-modal'));
  await waitFor('状态面板出现', () => shown('#panel-box'));

  const panelNames = $$('#panel-fields .panel-name').map((n) => n.textContent);
  const panelValue = (field) => {
    const row = $$('#panel-fields .panel-row').find((r) => r.querySelector('.panel-name').textContent === field);
    return row ? row.querySelector('input').value : null;
  };

  check('玩家角色卡的属性种进了面板', panelNames.includes('金币') && panelNames.includes('上衣'), JSON.stringify(panelNames));

  // 身份四件套也要进面板 —— 世界里时间会走、剧情会推，这些都会变
  check('身份四件套也在面板里', ['姓名', '年龄', '性别', '种族'].every((n) => panelNames.includes(n)), JSON.stringify(panelNames));
  check('姓名用的是你改过的名字', panelValue('姓名') === '改过的名字', String(panelValue('姓名')));
  check('年龄/性别/种族来自角色卡', panelValue('年龄') === '18' && panelValue('性别') === '女' && panelValue('种族') === '精灵', JSON.stringify({ 年龄: panelValue('年龄'), 性别: panelValue('性别'), 种族: panelValue('种族') }));

  check('值来自角色卡的初始值', panelValue('金币') === '100', String(panelValue('金币')));

  // 会话里记下了「你用哪张卡当自己」，而且以你改过的名字为准
  await sleep(200); // persistConversations 是防抖的
  const convos = (await window.barbara.getConversations()).conversations;
  const worldConvo = convos.find((c) => c.title === '冒烟测试世界');
  check('会话里记下了玩家角色', !!worldConvo && !!worldConvo.player, JSON.stringify(worldConvo && worldConvo.player));
  check('用的是你改过的名字', !!worldConvo && worldConvo.player.name === '改过的名字', worldConvo ? worldConvo.player.name : '');
  check('也记下了是哪张角色卡', !!worldConvo && worldConvo.player.characterId === cardId, worldConvo ? String(worldConvo.player.characterId) : '');
  check('玩家角色带上了设定文本', !!worldConvo && String(worldConvo.player.profile).length > 0);

  // 发一条：让「身份 + 属性真的注入给了模型」这件事也能被宿主验到
  setValue('#input', '冒烟测试：世界里的状态');
  click('#btn-send');
  await waitFor('收到回复', () => $('#messages').textContent.includes('冒烟测试回复'), 8000);
});

notes.push(`磁盘上的角色数：${(await savedCharacters()).length}`);
notes.push(`磁盘上的世界书数：${(await savedWorldbooks()).length}`);
notes.push(`会话数：${$$('#convo-list .convo-item').length}`);

// ---------------------------------------------------------------------------
//  场景 13：角色卡 —— 每个字段都能原样存下来
//
//  为什么专门做这个：主进程的 normalizeCharacter 是**白名单式**的，
//  它只保留显式列出来的字段。漏一个 ≠ 报错，而是「静默丢掉」——
//  「属性」当初就是这么丢的，而当时的假后端不做归一化，测试全绿。
//  这里把每个可编辑字段都填上不同的值，再逐个核对回来没有。
// ---------------------------------------------------------------------------
await scenario('角色卡：字段往返不丢', async () => {
  click('#btn-chars');
  await waitFor('切到角色库页面', () => shown('#view-chars'));
  click('#btn-new-char');
  await waitFor('角色编辑器打开', () => shown('#chars-modal'));

  const NAME = '字段往返测试';
  setValue('#c-name', NAME);
  setValue('#c-tags', '甲, 乙');
  setValue('#c-age', '23');
  setValue('#c-gender', '男');
  setValue('#c-race', '龙');
  setValue('#c-desc', 'D-描述');
  setValue('#c-personality', 'P-性格');
  setValue('#c-scenario', 'S-场景');
  setValue('#c-first', 'F-开场白');
  setValue('#c-example', 'E-示例');
  setValue('#c-system', 'SP-系统提示');
  setValue('#c-post', 'PH-后指令');
  setValue('#c-notes', 'CN-备注');

  setValue('#c-attr-new', '金币');
  click('#btn-add-attr');
  await waitFor('属性行出现', () => $$('#c-attr-list .attr-row').length === 1);
  setValue($$('#c-attr-list .attr-row')[0].querySelector('.attr-value'), '777');

  click('#btn-save-char');
  await waitFor('保存完成', () => byId('chars-title').textContent === '编辑角色');
  await sleep(150);

  const saved = (await savedCharacters()).find((c) => c.name === NAME);
  check('角色存下来了', !!saved);

  const expect = {
    tags: ['甲', '乙'],
    age: '23',
    gender: '男',
    race: '龙',
    description: 'D-描述',
    personality: 'P-性格',
    scenario: 'S-场景',
    firstMes: 'F-开场白',
    mesExample: 'E-示例',
    systemPrompt: 'SP-系统提示',
    postHistoryInstructions: 'PH-后指令',
    creatorNotes: 'CN-备注'
  };
  for (const [key, want] of Object.entries(expect)) {
    const got = saved ? saved[key] : undefined;
    check(`字段 ${key} 没被丢掉`, JSON.stringify(got) === JSON.stringify(want), `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`);
  }
  check(
    '属性没被丢掉',
    !!saved && Array.isArray(saved.attributes) && saved.attributes.length === 1 && saved.attributes[0].value === '777',
    JSON.stringify(saved && saved.attributes)
  );
});

// ---------------------------------------------------------------------------
//  场景 14：角色属性 —— 粘贴文本批量生成
// ---------------------------------------------------------------------------
await scenario('角色属性：粘贴文本批量生成', async () => {
  click('#btn-chars');
  await waitFor('切到角色库页面', () => shown('#view-chars'));
  click('#btn-new-char');
  await waitFor('角色编辑器打开', () => shown('#chars-modal'));
  setValue('#c-name', '粘贴测试角色');

  check('粘贴区一开始是收着的', !shown('#c-attr-paste'));
  click('#btn-attr-paste');
  await waitFor('粘贴区展开', () => shown('#c-attr-paste'));

  // 故意混几种写法 + 两行认不出来的（空行 / 光一个名字 / 保留字）
  setValue(
    '#c-attr-paste-text',
    ['金币：9900', '【上衣】：衬衫', '年龄 16', '- 下装：裙子', '', '体重', '旁白：不该收进来'].join('\n')
  );
  click('#btn-attr-paste-apply');
  await waitFor('属性行出现', () => $$('#c-attr-list .attr-row').length >= 4);
  await sleep(80);

  const names = $$('#c-attr-list .attr-name').map((n) => n.textContent);
  const valueOf = (n) => {
    const row = $$('#c-attr-list .attr-row').find((r) => r.querySelector('.attr-name').textContent === n);
    return row ? row.querySelector('.attr-value').value : null;
  };

  check('四种写法都认出来了', ['金币', '上衣', '年龄', '下装'].every((n) => names.includes(n)), JSON.stringify(names));
  check(
    '值也对',
    valueOf('金币') === '9900' && valueOf('上衣') === '衬衫' && valueOf('年龄') === '16' && valueOf('下装') === '裙子',
    JSON.stringify({ 金币: valueOf('金币'), 上衣: valueOf('上衣'), 年龄: valueOf('年龄'), 下装: valueOf('下装') })
  );
  check('认不出的行跳过（光一个名字）', !names.includes('体重'), JSON.stringify(names));
  check('保留字不收（旁白）', !names.includes('旁白'), JSON.stringify(names));
  check('解析完自动收起粘贴区', !shown('#c-attr-paste'));

  // 再贴一次：同名的应该覆盖值，而不是加出第二条
  click('#btn-attr-paste');
  await waitFor('粘贴区展开', () => shown('#c-attr-paste'));
  setValue('#c-attr-paste-text', '金币：1\n新字段：值');
  click('#btn-attr-paste-apply');
  await waitFor('新字段出现', () => $$('#c-attr-list .attr-name').some((n) => n.textContent === '新字段'));
  await sleep(80);

  const names2 = $$('#c-attr-list .attr-name').map((n) => n.textContent);
  check('同名没有加出第二条', names2.filter((n) => n === '金币').length === 1, JSON.stringify(names2));
  check('同名的值被覆盖了', valueOf('金币') === '1', String(valueOf('金币')));
  check('新字段加进来了', names2.includes('新字段'), JSON.stringify(names2));

  // 存盘往返（顺带再验一次白名单没漏字段）
  click('#btn-save-char');
  await waitFor('保存完成', () => byId('chars-title').textContent === '编辑角色');
  await sleep(150);

  const saved = (await savedCharacters()).find((c) => c.name === '粘贴测试角色');
  check(
    '粘贴出来的属性也落盘了',
    !!saved && saved.attributes.length === 5 && saved.attributes.some((a) => a.name === '金币' && a.value === '1'),
    JSON.stringify(saved && saved.attributes)
  );
});

// ---------------------------------------------------------------------------
//  准备悬停验证（必须放最后：它会把卡片摆好交给宿主）
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
