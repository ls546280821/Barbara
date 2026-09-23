// ---------------------------------------------------------------------------
//  角色库 / 世界书：只读访问器
//
//  这里放「从 state 里把一张卡、一本书捞出来」这类查询。它们被上下两头同时用 ——
//  界面拿它填列表，组装提示词拿它取设定，所以属于共享数据层，
//  不能跟着某一个功能模块走（否则谁都 import 谁）。
//
//  只读：写入分别走 persist.js（落盘）和各处的编辑逻辑。
// ---------------------------------------------------------------------------

import { state } from '../core/state.js';
import { normalizePanelFields } from '../core/panel-fields.js';

// --- 角色库 ---

export function characters() {
  return Array.isArray(state.characters) ? state.characters : [];
}

export function characterById(id) {
  if (!id) return null;
  return characters().find((c) => c.id === id) || null;
}

/** 当前会话绑定的角色（没绑就是 null，走通用助手） */
export function characterForConvo(convo) {
  return convo ? characterById(convo.characterId) : null;
}

/**
 * 读角色卡上的属性（容错老数据 / 导入的角色卡）。
 *
 * 老数据只有 {name, value}，这里走一遍共享归一化，于是 type/min/max/hint
 * 缺省都补成合理的值（type 默认 text）。范围/hint 是可选增强 ——
 * 没有它们的属性行为和以前完全一样。
 */
export function characterAttrs(character) {
  if (!character || !Array.isArray(character.attributes)) return [];
  return normalizePanelFields(character.attributes);
}

// --- 世界书 ---

export function worldbooks() {
  return Array.isArray(state.worldbooks) ? state.worldbooks : [];
}

export function worldbookById(id) {
  if (!id) return null;
  return worldbooks().find((w) => w.id === id) || null;
}

/**
 * 一本书里的「本书角色」（从角色库复制进来的独立副本）。
 * 和角色库里的那个角色互相独立 —— 改这边不影响那边，反之亦然。
 */
export function worldbookCharacters(book) {
  return book && Array.isArray(book.characters) ? book.characters : [];
}

/** 会话绑定了哪些世界书（id 列表，容错老数据） */
export function convoWorldbookIds(convo) {
  return convo && Array.isArray(convo.worldbookIds) ? convo.worldbookIds : [];
}
