'use strict';

// ============================================================================
//  core/util.js —— 与业务无关的小工具
// ============================================================================

import { state } from './state.js';

export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function now() {
  return Date.now();
}

export function activeConvo() {
  return state.conversations.find((c) => c.id === state.activeId) || null;
}
