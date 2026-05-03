import { api } from './api';

export type NBRole = 'integrator' | 'ads-creator' | 'both';
export type NBMode = 'direct' | 'indirect';

export interface NBPrompt {
  id: number;
  category_id: number;
  button_label: string;
  content: string;
  mode: NBMode;
  attached_image_url: string | null;
  sort_order: number;
  active: boolean;
  group_id?: number | null;
  created_at: string;
  updated_at: string;
}

export interface NBGroup {
  id: number;
  name: string;
  sort_order: number;
  prompts: NBPrompt[];
}

export interface NBCategory {
  id: number;
  name: string;
  icon: string | null;
  color: string | null;
  role: NBRole;
  sort_order: number;
  parent_id: number | null;
  product_type_ids?: number[];
  created_at: string;
  updated_at: string;
  prompts: NBPrompt[];
  groups?: NBGroup[];
  children?: NBCategory[];
}

export async function listCategories(opts?: { product_type_id?: number; product_type_slug?: string }): Promise<NBCategory[]> {
  const params = new URLSearchParams();
  if (opts?.product_type_id) params.set('product_type_id', String(opts.product_type_id));
  if (opts?.product_type_slug) params.set('product_type_slug', opts.product_type_slug);
  const query = params.toString() ? `?${params}` : '';
  const res: any = await api.get(`/nano-banana/categories${query}`);
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.categories)) return res.categories;
  return [];
}

export async function createCategory(body: {
  name: string;
  icon?: string;
  color?: string;
  role?: NBRole;
  parent_id?: number | null;
}): Promise<NBCategory> {
  return api.post('/nano-banana/categories', body);
}

export async function updateCategory(
  id: number,
  body: {
    name?: string;
    icon?: string;
    color?: string;
    role?: NBRole;
    parent_id?: number | null;
    product_type_ids?: number[];
  }
): Promise<NBCategory> {
  return api.patch(`/nano-banana/categories/${id}`, body);
}

export async function deleteCategory(id: number): Promise<void> {
  return api.delete(`/nano-banana/categories/${id}`);
}

export async function reorderCategories(ids: number[]): Promise<void> {
  return api.post('/nano-banana/categories/reorder', { ids });
}

export async function duplicateCategory(id: number): Promise<NBCategory> {
  return api.post(`/nano-banana/categories/${id}/duplicate`, {});
}

export async function duplicateGroup(id: number): Promise<NBGroup> {
  const res: any = await api.post(`/nano-banana/groups/${id}/duplicate`, {});
  return res?.group || res;
}

export async function duplicatePrompt(id: number): Promise<NBPrompt> {
  const res: any = await api.post(`/nano-banana/prompts/${id}/duplicate`, {});
  return res?.prompt || res;
}

export async function createPrompt(body: {
  category_id: number;
  button_label: string;
  content: string;
  mode?: NBMode;
  attached_image_url?: string;
  active?: boolean;
  group_id?: number | null;
}): Promise<NBPrompt> {
  return api.post('/nano-banana/prompts', body);
}

export async function updatePrompt(
  id: number,
  body: {
    button_label?: string;
    content?: string;
    mode?: NBMode;
    attached_image_url?: string | null;
    active?: boolean;
    group_id?: number | null;
  }
): Promise<NBPrompt> {
  return api.patch(`/nano-banana/prompts/${id}`, body);
}

export async function deletePrompt(id: number): Promise<void> {
  return api.delete(`/nano-banana/prompts/${id}`);
}

export async function reorderPrompts(
  category_id: number,
  ids: number[]
): Promise<void> {
  return api.post('/nano-banana/prompts/reorder', { category_id, ids });
}

export async function uploadPromptImage(data_url: string): Promise<{ url: string }> {
  return api.post('/nano-banana/upload', { data_url });
}

export interface NBGenerateRequest {
  prompt: string;
  product_id?: number;
  attached_image_urls?: string[];
  aspect_ratio?: '1:1' | '9:16' | '16:9' | '4:3';
  quality?: '1k' | '2k' | '4k';
  count?: number;
  prompt_id?: number;
}

export interface NBGeneratedImage {
  url: string;
  prompt: string;
  aspect_ratio: string;
  quality: string;
  generated_image_id?: number;
}

export interface NBGenerateResponse {
  items: NBGeneratedImage[];
  generation_id?: number;
}

export type StudioScope = 'integrator' | 'ads-creator';

export interface StudioGeneration {
  id: number;
  product_id: number;
  prompt: string;
  aspect_ratio: string;
  quality: string;
  images: string[];
  created_by: number | null;
  scope?: StudioScope;
  created_at: string;
}

export async function generate(body: NBGenerateRequest): Promise<NBGenerateResponse & { error?: string; message?: string }> {
  try {
    return await api.post('/nano-banana/generate', body);
  } catch (e: any) {
    // On quota errors, return the structured body instead of throwing
    if (e?.body && (e.body.error === 'quota_exceeded' || e.status === 429)) {
      return e.body;
    }
    throw e;
  }
}

// Studio generations persistence
//
// PHASE 2 — The server scopes rows by the caller's role automatically; admin
// callers can pass `scope` to mirror one role's view.
export async function listStudioGenerations(
  productId: number,
  opts?: { scope?: StudioScope },
): Promise<StudioGeneration[]> {
  const query = opts?.scope ? `?scope=${encodeURIComponent(opts.scope)}` : '';
  const res: any = await api.get(
    `/products/${productId}/studio-generations${query}`,
  );
  const items = Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : [];
  return items;
}

export async function clearStudioGenerations(
  productId: number,
  opts?: { scope?: StudioScope },
): Promise<{ deleted: number }> {
  const query = opts?.scope ? `?scope=${encodeURIComponent(opts.scope)}` : '';
  return api.delete(`/products/${productId}/studio-generations/clear${query}`);
}

// FIX 25a — upload an image file from the merchant's disk and persist
// it as a one-image studio_generations row so it shows up in the Image
// Studio gallery on next reload (alongside Nano Banana generations).
//
// /api/images/upload accepts a base64 data URL, writes it to R2, and
// returns a public URL. We then POST to /products/:id/studio-generations
// with images_json=[that url] so the row survives reloads. The "prompt"
// column gets a sentinel value so the UI can recognize uploads if it
// wants to surface them differently later.
export async function uploadAndSaveStudioImage(
  productId: number,
  file: File,
  opts?: { scope?: StudioScope },
): Promise<{ url: string }> {
  // 1) read file as data URL
  const dataUrl: string = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error || new Error('FileReader failed'));
    fr.readAsDataURL(file);
  });
  // 2) upload to R2 via the existing endpoint (returns { url })
  const up: any = await api.post('/images/upload', { data_url: dataUrl });
  const url = up?.url;
  if (!url) throw new Error('Upload returned no url');
  // 3) persist as a studio_generations row so it's gallery-visible
  //    after reload. The server scopes the row by the caller's role;
  //    we still pass scope so admins acting in the ads-creator workspace
  //    write to the right bucket.
  const body: any = {
    prompt: '[uploaded image]',
    aspect_ratio: '1:1',
    quality: '4k',
    images_json: JSON.stringify([url]),
  };
  if (opts?.scope) body.scope = opts.scope;
  await api.post(`/products/${productId}/studio-generations`, body);
  return { url };
}

// Group management
export async function createGroup(body: {
  category_id: number;
  name: string;
}): Promise<NBGroup> {
  const res: any = await api.post('/nano-banana/groups', body);
  return res?.group || res;
}

export async function updateGroup(
  id: number,
  body: { name?: string; category_id?: number }
): Promise<NBGroup> {
  const res: any = await api.patch(`/nano-banana/groups/${id}`, body);
  return res?.group || res;
}

export async function deleteGroup(id: number): Promise<void> {
  return api.delete(`/nano-banana/groups/${id}`);
}

export async function reorderGroups(
  category_id: number,
  ids: number[]
): Promise<void> {
  return api.post('/nano-banana/groups/reorder', { category_id, ids });
}

// FIX 27b — unified reorder of groups + ungrouped prompts within a
// category. Items must be in the desired order; the backend writes the
// array index to BOTH ai_prompts.sort_order and nano_banana_groups.sort_order
// so the integrator render can merge them correctly.
export interface MixedReorderItem {
  type: 'group' | 'prompt';
  id: number;
}
export async function reorderMixed(
  category_id: number,
  items: MixedReorderItem[]
): Promise<void> {
  return api.post('/nano-banana/reorder-mixed', { category_id, items });
}

export async function assignPromptGroup(
  prompt_id: number,
  group_id: number | null
): Promise<void> {
  return api.post('/nano-banana/prompts/assign-group', { prompt_id, group_id });
}
