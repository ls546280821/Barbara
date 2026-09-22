'use strict';

// ============================================================================
//  data/persist.js —— 把内存里的数据写回磁盘
//  目前只有会话（防抖保存）。角色库 / 世界书的落盘还在 main.js 里，
//  等对应功能搬出去的时候一起挪过来。
// ============================================================================

import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { showToast } from '../ui/toast.js';

let saveTimer = null;

export function persistConversations(delay) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api
      .saveConversations({ conversations: state.conversations, activeId: state.activeId })
      .then(() => {
        // 保存成功，静默
      })
      .catch((err) => {
        console.error('保存会话失败', err);
        showToast('保存会话失败，请检查磁盘空间', 'error');
      });
  }, typeof delay === 'number' ? delay : 350);
}
