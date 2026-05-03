import { api } from './api';
import type { NBCategory, NBPrompt, NBGroup, NBRole, NBMode } from './nano-banana';

// FIX 27b — unified-reorder item shape. Used by reorderMixed below.
export interface MixedReorderItem {
  type: 'group' | 'prompt';
  id: number;
}

export interface PromptStudioApi {
  listCategories: () => Promise<NBCategory[]>;
  createCategory: (body: { name: string; icon?: string; color?: string; role?: NBRole; parent_id?: number | null }) => Promise<NBCategory>;
  updateCategory: (id: number, body: any) => Promise<NBCategory>;
  deleteCategory: (id: number) => Promise<void>;
  reorderCategories: (ids: number[]) => Promise<void>;
  createPrompt: (body: any) => Promise<NBPrompt>;
  updatePrompt: (id: number, body: any) => Promise<any>;
  deletePrompt: (id: number) => Promise<void>;
  reorderPrompts: (categoryId: number, ids: number[]) => Promise<void>;
  duplicatePrompt: (id: number) => Promise<NBPrompt>;
  createGroup: (body: { category_id: number; name: string }) => Promise<NBGroup>;
  updateGroup: (id: number, body: any) => Promise<NBGroup>;
  deleteGroup: (id: number) => Promise<void>;
  reorderGroups: (categoryId: number, ids: number[]) => Promise<void>;
  duplicateGroup: (id: number) => Promise<NBGroup>;
  duplicateCategory: (id: number) => Promise<NBCategory>;
  assignPromptGroup: (promptId: number, groupId: number | null) => Promise<void>;
  // FIX 27b — unified reorder of groups + ungrouped prompts within a
  // category. Use this instead of reorderGroups/reorderPrompts when
  // the desired ordering interleaves both kinds (which is the new
  // default expectation after FIX 27b).
  reorderMixed: (categoryId: number, items: MixedReorderItem[]) => Promise<void>;
}

function buildApi(prefix: string): PromptStudioApi {
  const unwrap = (res: any) => Array.isArray(res) ? res : res?.items || res?.categories || [];

  return {
    listCategories: async () => unwrap(await api.get(`${prefix}/categories`)),
    createCategory: (body) => api.post(`${prefix}/categories`, body),
    updateCategory: (id, body) => api.patch(`${prefix}/categories/${id}`, body),
    deleteCategory: (id) => api.delete(`${prefix}/categories/${id}`),
    reorderCategories: (ids) => api.post(`${prefix}/categories/reorder`, { ids }),
    createPrompt: (body) => api.post(`${prefix}/prompts`, body),
    updatePrompt: (id, body) => api.patch(`${prefix}/prompts/${id}`, body),
    deletePrompt: (id) => api.delete(`${prefix}/prompts/${id}`),
    reorderPrompts: (categoryId, ids) => api.post(`${prefix}/prompts/reorder`, { category_id: categoryId, ids }),
    duplicatePrompt: async (id) => { const r: any = await api.post(`${prefix}/prompts/${id}/duplicate`, {}); return r?.prompt || r; },
    createGroup: async (body) => { const r: any = await api.post(`${prefix}/groups`, body); return r?.group || r; },
    updateGroup: async (id, body) => { const r: any = await api.patch(`${prefix}/groups/${id}`, body); return r?.group || r; },
    deleteGroup: (id) => api.delete(`${prefix}/groups/${id}`),
    reorderGroups: (categoryId, ids) => api.post(`${prefix}/groups/reorder`, { category_id: categoryId, ids }),
    duplicateGroup: async (id) => { const r: any = await api.post(`${prefix}/groups/${id}/duplicate`, {}); return r?.group || r; },
    duplicateCategory: (id) => api.post(`${prefix}/categories/${id}/duplicate`, {}),
    assignPromptGroup: (promptId, groupId) => api.post(`${prefix}/prompts/assign-group`, { prompt_id: promptId, group_id: groupId }),
    // FIX 27b — only nano-banana has the reorder-mixed endpoint today.
    // Seedance falls back to no-op (its admin UI never calls this); the
    // promise resolves immediately so callers don't break under the
    // unified type contract.
    reorderMixed: (categoryId, items) => {
      if (prefix === '/nano-banana') {
        return api.post(`${prefix}/reorder-mixed`, { category_id: categoryId, items });
      }
      console.warn(`[prompt-studio-api] reorderMixed not implemented for prefix=${prefix}; ignoring (${items.length} item(s))`);
      return Promise.resolve();
    },
  };
}

export const nanoBananaApi = buildApi('/nano-banana');
export const seedanceApi = buildApi('/seedance/prompt');
