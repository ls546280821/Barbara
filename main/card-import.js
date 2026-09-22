'use strict';

// ============================================================================
//  main/card-import.js —— 导入一个文件时的「形状识别 + 归一化」
//
//  从 main.js 的 registerIpc() 里抽出来的。以前这段夹在 dialog / fs / 闭包中间，
//  只有走真实的文件对话框才能跑到，所以「卡里内嵌的世界书被静默丢掉」
//  「导出时 character_book 写死 null」这两个 bug 长期没有测试能发现。
//
//  抽出来之后，tools/smoke-test.js 可以直接 require 这个模块，
//  用真实的 PNG 字节跑完整的导入链路（而不是自己在测试里糊一套）。
//
//  这里不碰磁盘：给 buffer，返回解析结果。
// ============================================================================

const { parseCharacterCardPng } = require('./png.js');
const { normalizeCharacter } = require('./characters.js');
const {
  worldbookFromCharacterBook,
  worldbookFromLorebook,
  looksLikeLorebook
} = require('./worldbook-parse.js');

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
 *
 * 注意：内嵌世界书挂在返回值的临时的 `worldbook` 字段上，
 * **由调用方决定怎么落盘和绑定**（导入链路会给它发 id 并绑到这个角色）。
 */
function characterFromCard(card, avatar, source, fallbackName, makeWorldbookId) {
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
      attributes: ext.attributes,
      // 自带世界书的开关也跟着一起回来。缺省 true，所以没这个字段的卡不受影响。
      worldbookEnabled: typeof ext.worldbookEnabled === 'boolean' ? ext.worldbookEnabled : true
    },
    source
  );

  // v2 卡把世界书放在 data.character_book；也有工具放在顶层
  character.worldbook = worldbookFromCharacterBook(
    d.character_book || card.character_book,
    character.name,
    makeWorldbookId
  );

  return character;
}

/**
 * 解析一个导入的文件（PNG 或 JSON 文本），返回它到底是什么。
 *
 * 返回值三种情况：
 *   { kind: 'character', character, worldbook }
 *     —— 角色卡；worldbook 是卡里内嵌的那本（可能为 null）
 *   { kind: 'worldbook', worldbook }
 *     —— 独立的世界书文件
 *   { kind: 'error', error }
 *     —— 认不出来 / 解析失败
 *
 * 判断顺序很讲究：**先判世界书**。酒馆导出的世界书同样带 name/description，
 * 先走角色卡那条路会被当成一个空角色收下，整本书的条目全丢。
 */
function parseImportFile({ buffer, ext, fallbackName, makeWorldbookId }) {
  const isPng = ext === '.png';

  let card = null;
  let avatar = '';

  if (isPng) {
    card = parseCharacterCardPng(buffer);
    if (card) avatar = `data:image/png;base64,${buffer.toString('base64')}`;
  } else {
    try {
      card = JSON.parse(buffer.toString('utf8'));
    } catch (err) {
      return { kind: 'error', error: '不是合法的 JSON' };
    }
  }

  if (!card) {
    return { kind: 'error', error: isPng ? '这张 PNG 里没有角色卡数据（没有 chara 信息？）' : '解析失败' };
  }

  // 有些 JSON 卡自带头像：可能在顶层，也可能在 data 里，
  // 可能是完整 dataURL，也可能是裸 base64（没有头像时是字符串 'none'）
  if (!avatar) {
    avatar = cardAvatarToDataUrl((card.data && card.data.avatar) || card.avatar);
  }

  // 独立世界书先判（理由见上面）
  if (looksLikeLorebook(card)) {
    const book = worldbookFromLorebook(card, fallbackName, makeWorldbookId);
    if (book) return { kind: 'worldbook', worldbook: book };
  }

  const character = characterFromCard(card, avatar, isPng ? 'png' : 'json', fallbackName, makeWorldbookId);
  if (!character) {
    // 不是角色卡，再试一次世界书（形状松一点的，比如裸数组）
    const book = worldbookFromLorebook(card, fallbackName, makeWorldbookId);
    if (book) return { kind: 'worldbook', worldbook: book };
    return { kind: 'error', error: '既不是角色卡也不是世界书' };
  }

  const worldbook = character.worldbook || null;
  delete character.worldbook;
  return { kind: 'character', character, worldbook };
}

module.exports = {
  cardAvatarToDataUrl,
  characterFromCard,
  parseImportFile
};
