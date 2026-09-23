'use strict';

// ============================================================================
//  data/panel.js —— 状态面板（世界模型的状态栏）：解析 / 归一化 / 夹取 / 注入
//
//  模型每轮输出一段固定格式的状态栏，比如：
//      【金币】：100
//      【时间】：早上
//  把它交给模型自己「抄上一轮」是靠不住的 —— 历史会被 maxTurns 截断，
//  一旦截出去模型就开始编数值。所以这里把它解析出来存到会话上，
//  每轮由程序权威注入，数值就不会漂了。
//
//  纯逻辑，不碰 DOM。字段的类型/范围/变化规则由 main/panel-fields.js 定义，
//  主进程加载的是同一个文件，所以「范围怎么夹」两边跑的是同一份代码。
//
//  剧情选项（【剧情选项】：A / B / C）的解析也在这里：它和状态栏是同一类东西 ——
//  程序读的中间产物，解析出来之后正文里就该剥掉（值已经由面板权威注入、
//  选项已经变成可点的按钮，原文留在气泡里只会吵）。
// ============================================================================

import { now } from '../core/util.js';
import {
  clampFieldValue,
  normalizePanelField,
  groupPanelFields,
  describePanelField,
  trimNumber
} from '../core/panel-fields.js';
// 面板的写入口（setPanelField）改完值要落盘，所以 data 层里有一条
// panel → persist 的单向依赖。方向是单一的，不构成环。
import { persistConversations } from './persist.js';

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

export const MAX_PANEL_FIELDS = 120;

export const OPTIONS_LABEL = '剧情选项';
export const OPTIONS_LINE_RE = /^【剧情选项】[：:]\s*(.*)$/;

export function panelFieldAllowed(name) {
  return !PANEL_RESERVED.has(name) && !name.includes('的设定') && !name.includes('的性格');
}

/**
 * 从一段文本里抽出面板字段（保持出现顺序）。
 *
 * knownFields：已经确立的字段名。给了它就以它为准 —— 正文里出现的
 * 「【某某】：……」不会被误收。只有第一次扫（还没有已知字段）时才靠
 * 形态猜测，这时候用「值很短」这个条件兜一下，避免把整段正文当面板。
 */
export function extractPanelFromText(text, knownFields) {
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
export function stripPanelLines(text, knownFields) {
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
export function collapseBlankLines(text) {
  return String(text || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * 把「【剧情选项】：…」这一行剥掉。
 * 它和状态栏一样是给程序读的：程序把它解析成按钮之后，正文里再留一份
 * 就是重复（选项已经是可点的按钮了，原文留在气泡里只会吵）。
 */
export function stripOptionsLine(text) {
  const source = String(text || '');
  if (!source.includes(OPTIONS_LABEL)) return source;

  const out = source.split('\n').filter((rawLine) => !OPTIONS_LINE_RE.test(rawLine.trim()));
  return collapseBlankLines(out.join('\n')).trim();
}

/**
 * 助手消息的正文该怎么给模型/界面看：状态栏行和剧情选项行都剥掉。
 * 两者都是程序读的中间产物 —— 值已经由面板权威注入，选项已经变成按钮。
 */
export function cleanAssistantText(text, panelFields) {
  return stripOptionsLine(stripPanelLines(text, panelFields));
}

export function convoPanelFields(convo) {
  return convo && Array.isArray(convo.panelFields) ? convo.panelFields : [];
}

export function convoPanel(convo) {
  return convo && convo.panel && typeof convo.panel === 'object' ? convo.panel : {};
}

/**
 * 字段定义表（名字 → {type, min, max, hint}）。
 *
 * 为什么存在**会话**上、而不是每轮去查角色卡：
 *   · 面板值本来就存在会话上，定义跟着走才不会两边对不上；
 *   · 这一局中途换了角色、或者把角色卡删了，正在进行的局仍然该受原来的约束；
 *   · 老会话没有这张表 → 返回空，一切照旧（范围/hint 是可选增强）。
 */
export function convoPanelDefs(convo) {
  return convo && convo.panelDefs && typeof convo.panelDefs === 'object' ? convo.panelDefs : {};
}

/**
 * 归一化整张定义表。读盘进来的数据不可信（用户手改过 JSON、版本更老），
 * 所以只留真正能用的条目，其余丢掉 —— 丢一条定义只是少了范围提示，
 * 留一条坏定义却可能让夹取逻辑算出个乱值。
 */
export function normalizePanelDefs(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const out = {};
  let count = 0;
  for (const name of Object.keys(value)) {
    if (count >= MAX_PANEL_FIELDS) break;
    const raw = value[name];
    if (!raw || typeof raw !== 'object') continue;

    const def = normalizePanelField({ ...raw, name, value: '' });
    if (!def) continue;
    // normalizePanelField 对没有意义的定义只回 type:'text' 且没有范围/hint，
    // 这种和「没有定义」等价，不用存
    const hasRange = typeof def.min === 'number' || typeof def.max === 'number';
    if (def.type === 'text' && !def.hint && !hasRange) continue;

    out[name] = {
      type: def.type,
      ...(typeof def.min === 'number' ? { min: def.min } : {}),
      ...(typeof def.max === 'number' ? { max: def.max } : {}),
      ...(def.hint ? { hint: def.hint } : {}),
      ...(def.group ? { group: def.group } : {})
    };
    count += 1;
  }
  return out;
}

/** 某个字段的定义（可能是 undefined —— 表示没有范围/hint） */
export function convoPanelDef(convo, name) {
  const def = convoPanelDefs(convo)[name];
  return def && typeof def === 'object' ? def : null;
}

/**
 * 把一个值按字段范围夹回去。返回夹过之后的字符串。
 * 没有定义 / 不是数值字段 / 解析不出数字，都原样返回。
 * defs 可以不传（默认用会话上的定义表）—— 同步历史时定义表还在构建中，
 * 那时要显式把新的传进来，否则新推断出来的范围当轮不生效。
 */
export function clampPanelValue(convo, name, value, defs) {
  const table = defs && typeof defs === 'object' ? defs : convoPanelDefs(convo);
  const def = table[name];
  if (!def || typeof def !== 'object') return value;
  return clampFieldValue(value, def).value;
}

/**
 * 把会话历史里出现过的面板字段同步到 convo.panel。
 * 取「最近一条提到该字段的助手消息」的值，所以手动改过的旧轮次会被更新的值覆盖。
 * 返回是否发生了变化 —— 调用方据此决定要不要重绘面板。
 *
 * 注意这里是**累积**而不是「从历史重建」：
 * 角色卡带过来的字段、以及用户在面板里手动加的字段，这一轮模型可能压根没提到
 * （小模型经常不听话），从零重建会把它们连值一起抹掉。
 * 所以以现有面板为底，把历史里扫到的值盖上去。
 */
export function syncConvoPanel(convo) {
  if (!convo || !Array.isArray(convo.messages)) return false;

  const beforeFields = convoPanelFields(convo).join('\u0001');
  const beforePanel = JSON.stringify(convoPanel(convo));

  const existingFields = convoPanelFields(convo);
  const existingPanel = convoPanel(convo);

  // 字段顺序：先保留已经有的（角色卡种下的 / 手动加的），新发现的追加在后面。
  const order = [...existingFields];
  const known = new Set(order);
  const latest = new Map();
  const defs = { ...convoPanelDefs(convo) };

  for (const msg of convo.messages) {
    if (!msg || msg.role !== 'assistant') continue;
    const content = String(msg.content || '');
    if (!content.includes('【')) continue;

    const found = extractPanelFromText(content, [...known]);
    for (const [name, value] of found) {
      if (!known.has(name)) {
        if (order.length >= MAX_PANEL_FIELDS) continue;
        order.push(name);
        known.add(name);
        // 模型自己冒出来的字段：从值的形状补个定义（「63/100」= 带范围的数值），
        // 否则它永远没有进度条、也不受范围约束。
        if (!defs[name]) {
          const inferred = inferPanelDef(name, value);
          if (inferred) defs[name] = inferred;
        }
      }
      latest.set(name, value);
    }
  }

  // 值：历史里扫到的优先（最新一轮说了算），没扫到的沿用面板里现有的。
  // 有范围的数值字段在这里夹一下 —— 模型写 150/100、-5/100 都会被拉回范围内，
  // 否则面板上会长期挂着一个越界的数，而且下一轮它还会照抄那个越界值。
  const panel = {};
  for (const name of order) {
    const value = latest.has(name) ? latest.get(name) : existingPanel[name];
    if (value !== undefined) panel[name] = clampPanelValue(convo, name, value, defs);
  }

  convo.panelFields = order;
  convo.panel = panel;
  convo.panelDefs = defs;

  return beforeFields !== order.join('\u0001') || beforePanel !== JSON.stringify(panel);
}

/** 手动改一个字段的值（面板 UI 里直接编辑） */
export function setPanelField(convo, name, value) {
  if (!convo) return;
  const fields = [...convoPanelFields(convo)];
  if (!fields.includes(name)) fields.push(name);
  convo.panelFields = fields.slice(0, MAX_PANEL_FIELDS);

  const prev = String(convoPanel(convo)[name] == null ? '' : convoPanel(convo)[name]);
  const text = String(value == null ? '' : value).trim().slice(0, 500);
  // 界面上「/100」是拆成后缀单独显示的，输入框里只有分子。存的时候把分母拼回去，
  // 否则「60/100」改一下变成「60」，分母就永久丢了。
  const merged = mergeMeterValue(text, prev, convoPanelDef(convo, name));

  convo.panel = { ...convoPanel(convo), [name]: clampPanelValue(convo, name, merged) };
  convo.updatedAt = now();
  persistConversations(0);
}

/**
 * 把「只有分子」的值和分母拼回「60/100」。
 *
 * 为什么需要它：
 *   · 界面上「/100」是拆成后缀单独显示的，输入框里只有分子；
 *   · 卡片里的数值字段 initial 常常是个裸数字（20），而卡的文字和历史里写的是
 *     「20/100」—— 不统一的话，面板里是个光秃秃的 20，夹取也拿不到满值。
 * 所以：有范围上限的数值字段一律存成「分子/满值」这一种格式，两个入口
 * （种初始值、手动编辑）都走这里，格式就不会两样。
 *
 * 只对「数值型 + 有 max」的字段生效，别的字段原样返回。
 */
export function mergeMeterValue(value, prev, def) {
  const text = String(value == null ? '' : value).trim();
  if (!text || !def || def.type !== 'meter' || typeof def.max !== 'number') return text;
  if (text.includes('/')) return text;

  // 分母优先用旧值里的（可能和 max 不同，比如按比例的分数字段），没有就用 max
  const m = String(prev == null ? '' : prev).match(/^[-+]?\d+(?:\.\d+)?\s*\/\s*([-+]?\d+(?:\.\d+)?)$/);
  const total = m ? m[1] : trimNumber(def.max);
  return `${text}/${total}`;
}

/**
 * 字段说明图例：有范围 / 变化规则的字段才出现。
 *
 * 单独列在图例里，而不是跟在值后面 —— 值本身要**原样回显**给模型看
 * （它就是模型上一轮写的），掺上注解会影响它照着抄。
 */
export function panelFieldLegend(convo, fields) {
  const lines = [];
  for (const name of fields) {
    const def = convoPanelDef(convo, name);
    if (!def) continue;
    const desc = describePanelField(def);
    if (!desc) continue;
    lines.push(`- ${name}：${desc}`);
  }
  return lines;
}

/**
 * 分组标题在注入文本里的写法：**刻意不用【】**。
 *
 * 用「【关系】：」的话会被自己的面板解析器当成一个名叫「关系」的字段
 * （PANEL_LINE_RE 认的就是这个形状），于是模型照着输出、下一轮就多出
 * 一个垃圾字段。用「—— 关系 ——」这种破折号包法就不会误匹配。
 */
export function panelGroupHeader(title) {
  return `—— ${title} ——`;
}

/**
 * 从值的形状推断字段定义 —— 只用于**模型自己冒出来的字段**。
 *
 * 「【好感度】：63/100」这种「数字/数字」的形状本身就说明了它是个带范围的数值：
 * 分子是当前值、分母是满值。不做这一步的话，卡片里没声明过的数值字段永远
 * 拿不到进度条，明明值里已经写着满值是多少。
 *
 * 只认这一个形状（中间一个斜杠、两边都是数字），而且只在字段还没有定义时补。
 * 刻意**不**推断 min：分母只能告诉我们上限，下限猜不出来（写 0 会错，
 * 留空则由夹取逻辑按「只夹上限」处理）。
 */
export function inferPanelDef(name, value) {
  const m = String(value == null ? '' : value).trim().match(/^([-+]?\d+(?:\.\d+)?)\s*\/\s*([-+]?\d+(?:\.\d+)?)$/);
  if (!m) return null;

  const total = Number(m[2]);
  if (!isFinite(total) || total <= 0) return null;

  return { type: 'meter', max: total };
}

/** 面板拼成注入块；没有面板就返回空串 */
export function formatPanelForPrompt(convo) {
  const fields = convoPanelFields(convo);
  if (!fields.length) return '';

  const panel = convoPanel(convo);

  // 按分组拼。分组的字段顺序由 groupPanelFields 保序，没分组的排最后。
  const groups = groupPanelFields(
    fields.map((name) => ({ name, group: (convoPanelDef(convo, name) || {}).group || '' }))
  );

  const lines = [];
  let groupCount = 0;
  for (const bucket of groups) {
    const filled = bucket.fields.filter((f) => {
      const v = panel[f.name];
      return v !== undefined && v !== '';
    });
    if (!filled.length) continue;

    if (bucket.id) {
      groupCount += 1;
      lines.push(panelGroupHeader(bucket.id));
    }
    for (const f of filled) lines.push(`【${f.name}】：${panel[f.name]}`);
  }

  const grouped = groupCount > 0;
  const legend = panelFieldLegend(convo, fields);
  const legendBlock = legend.length
    ? '\n\n字段的取值范围与变化规则（务必遵守，数值超出范围会被程序拉回）：\n' + legend.join('\n')
    : '';
  // 有分组时交代一句 —— 否则模型看不懂那些破折号标题是干什么的
  const groupNote = grouped
    ? '\n（「—— 组名 ——」是状态分组的小标题，照抄即可，不要当成字段输出。）'
    : '';

  // 一个值都还没有 = 刚用角色卡的属性模板开的局。
  // 这时候也要把字段名告诉模型，否则它不知道要维护哪些状态 ——
  // 而「模型得自己碰巧输出【金币】：100」正是属性模板要解决的冷启动问题。
  if (!lines.length) {
    return (
      '[当前状态]\n' +
      `本局需要维护这些状态字段：${fields.join('、')}\n` +
      '请在每次回复的末尾，用「【字段】：值」的格式把它们完整输出一遍' +
      '（还不知道的写「未知」）；之后每轮照抄并更新，不要凭空改动已有数值。' +
      groupNote +
      legendBlock
    );
  }

  return (
    '[当前状态]\n' +
    '这是本局当前的权威状态，请以它为准，不要自行改动历史数值。\n' +
    '每次回复末尾按同样的格式输出更新后的完整状态栏；没有变化的字段照抄。' +
    groupNote +
    '\n\n' +
    lines.join('\n') +
    legendBlock
  );
}
