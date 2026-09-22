'use strict';

// ============================================================================
//  main/characters.js —— 角色卡的数据整理
//
//  独立成模块的原因不只是「拆文件」：tools/smoke-test.js 要 require 它，
//  让冒烟测试跑**真正的**归一化，而不是自己糊一套假的。
//
//  ⚠️ 血泪教训：normalizeCharacter 是**白名单式**的 —— 它只保留显式列出来的字段。
//  漏一个字段，就等于「存盘时丢掉、读盘时也丢掉」，而且是静默的。
//  所以下面这个 return 里每加一个角色字段，都要在这里同步加一行。
//  （「属性」attributes 当初就是这么丢的：界面里填得好好的，一存盘就没了。）
// ============================================================================

// 头像存成 dataURL 直接塞进 JSON，超过这个长度就不带了，免得文件爆掉。
// 这个上限必须大于「导入上限 × 4/3」（base64 会膨胀约 1.34 倍），
// 否则合法导入的 PNG 会在保存时被悄悄丢掉头像。
const MAX_AVATAR_CHARS = 18000000; // ≈ 13MB 的 PNG，留足余量

// 角色「属性」的条数上限，和渲染层状态面板的 MAX_PANEL_FIELDS 保持一致
const MAX_ATTRIBUTES = 120;

function newCharacterId() {
  return `c${Date.now().toString(36)}${Math.floor(Math.random() * 9000 + 1000)}`;
}

/**
 * 性别归一化。
 * 酒馆卡里常写成 male / female，统一成选择框认的那几个值；
 * 认不出来的一律留空（宁可不填，也不要塞个编辑器里选不中的值进去 —— 那样一保存就丢了）。
 */
function normalizeGender(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!text) return '';
  if (['男', 'male', 'm', 'man', '男性'].includes(text)) return '男';
  if (['女', 'female', 'f', 'woman', '女性'].includes(text)) return '女';
  if (['其他', 'other', 'nonbinary', 'non-binary', '未知'].includes(text)) return '其他';
  return '';
}

/** 角色「属性」：一串 { name, value }，名字去重，顺序保留 */
function normalizeAttributes(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 24) : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, value: typeof item.value === 'string' ? item.value.slice(0, 500) : '' });
    if (out.length >= MAX_ATTRIBUTES) break;
  }
  return out;
}

/** 把任意来源的角色数据整理成内部统一格式，顺便挡住非法值 */
function normalizeCharacter(raw, source) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

  const avatar = typeof r.avatar === 'string' && r.avatar.startsWith('data:image/') ? r.avatar : '';

  return {
    id: typeof r.id === 'string' && r.id ? r.id : newCharacterId(),
    name: str(r.name, 120).trim() || '未命名角色',
    avatar: avatar.length <= MAX_AVATAR_CHARS ? avatar : '',
    description: str(r.description, 20000),
    personality: str(r.personality, 10000),
    scenario: str(r.scenario, 10000),
    firstMes: str(r.firstMes, 10000),
    mesExample: str(r.mesExample, 30000),
    systemPrompt: str(r.systemPrompt, 10000),
    postHistoryInstructions: str(r.postHistoryInstructions, 10000),
    creatorNotes: str(r.creatorNotes, 5000),
    // 身份三项。酒馆卡规范里没有它们，有些卡会写在 extensions 里，
    // 所以这里有就收、没有就是空（种族不硬塞「人类」，免得给精灵安个人类）。
    age: str(r.age, 40).trim(),
    gender: normalizeGender(r.gender),
    race: str(r.race, 40).trim(),
    tags: Array.isArray(r.tags)
      ? r.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, 40)).slice(0, 20)
      : [],
    // 状态面板的字段模板。少了这一行，界面上填的属性一存盘就没了。
    attributes: normalizeAttributes(r.attributes),
    source: ['png', 'json', 'manual'].includes(r.source) ? r.source : source || 'manual',
    createdAt: Number(r.createdAt) || Date.now(),
    updatedAt: Number(r.updatedAt) || Date.now()
  };
}

module.exports = { normalizeCharacter, normalizeAttributes, normalizeGender, newCharacterId, MAX_AVATAR_CHARS };
