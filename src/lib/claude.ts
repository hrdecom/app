import { api } from './api';

export interface ProductType {
  id: number;
  name: string;
  slug: string;
  bullet_template: string[];
  sort_order: number;
  is_active: boolean;
  shopify_product_type?: string;
  shopify_template_suffix?: string;
  default_tags?: string;
  default_tags_list?: string[];
  shopify_tags?: string;
  shopify_tags_list?: string[];
  include_collection_ids?: string[];
  exclude_collection_ids?: string[];
  shopify_category_gid?: string | null;
  claude_prompt?: string | null;
}

export interface ProductCollection {
  id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
  shopify_tags?: string;
  shopify_tags_list?: string[];
}

export interface ClaudeSettings {
  title_template: string;
  format_ring: string;
  format_other: string;
  description_template: string;
  description_max_chars: number;
  description_paragraph_count: number;
}

export interface BlacklistItem {
  id: number;
  product_type_slug: string;
  name: string;
  product_id: number | null;
  created_at: string;
}

export interface BlacklistResponse {
  items: BlacklistItem[];
  total: number;
}

// Product Types
export async function listProductTypes(): Promise<ProductType[]> {
  const res: any = await api.get('/claude/product-types');
  const arr: ProductType[] = Array.isArray(res)
    ? res
    : Array.isArray(res?.items)
    ? res.items
    : Array.isArray(res?.types)
    ? res.types
    : [];
  // Normalize bullet_template — may arrive as a JSON string.
  return arr.map((t) => ({
    ...t,
    bullet_template: Array.isArray((t as any).bullet_template)
      ? (t as any).bullet_template
      : typeof (t as any).bullet_template === 'string'
      ? safeParseArray((t as any).bullet_template)
      : [],
    is_active: !!(t as any).is_active,
  }));
}

function safeParseArray(s: string): any[] {
  try {
    const p = JSON.parse(s);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

export async function createProductType(body: {
  name: string;
  slug: string;
  bullet_template: string[];
  is_active?: boolean;
  shopify_product_type?: string;
  shopify_template_suffix?: string;
  default_tags?: string;
  shopify_tags?: string;
  include_collection_ids?: string[];
  exclude_collection_ids?: string[];
}): Promise<ProductType> {
  return api.post('/claude/product-types', body);
}

export async function updateProductType(
  id: number,
  body: {
    name?: string;
    slug?: string;
    bullet_template?: string[];
    is_active?: boolean;
    shopify_product_type?: string;
    shopify_template_suffix?: string;
    default_tags?: string;
    shopify_tags?: string;
    include_collection_ids?: string[];
    exclude_collection_ids?: string[];
  }
): Promise<ProductType> {
  return api.patch(`/claude/product-types/${id}`, body);
}

export async function deleteProductType(id: number): Promise<void> {
  return api.delete(`/claude/product-types/${id}`);
}

export async function reorderProductTypes(ids: number[]): Promise<void> {
  return api.post('/claude/product-types/reorder', { ids });
}

// Collections
export async function listCollections(): Promise<ProductCollection[]> {
  const res: any = await api.get('/claude/collections');
  const arr: ProductCollection[] = Array.isArray(res)
    ? res
    : Array.isArray(res?.items)
    ? res.items
    : Array.isArray(res?.collections)
    ? res.collections
    : [];
  return arr.map((c) => ({ ...c, is_active: !!(c as any).is_active }));
}

export async function createCollection(body: {
  name: string;
  is_active?: boolean;
  shopify_tags?: string;
}): Promise<ProductCollection> {
  return api.post('/claude/collections', body);
}

export async function updateCollection(
  id: number,
  body: {
    name?: string;
    is_active?: boolean;
    shopify_tags?: string;
  }
): Promise<ProductCollection> {
  return api.patch(`/claude/collections/${id}`, body);
}

export async function deleteCollection(id: number): Promise<void> {
  return api.delete(`/claude/collections/${id}`);
}

export async function reorderCollections(ids: number[]): Promise<void> {
  return api.post('/claude/collections/reorder', { ids });
}

// Settings
export async function getSettings(): Promise<ClaudeSettings> {
  return api.get('/claude/settings');
}

export async function updateSettings(body: Partial<ClaudeSettings>): Promise<ClaudeSettings> {
  return api.patch('/claude/settings', body);
}

// Blacklist
export async function listBlacklist(params?: {
  product_type_slug?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<BlacklistResponse> {
  const queryParams = new URLSearchParams();
  if (params?.product_type_slug) queryParams.set('product_type_slug', params.product_type_slug);
  if (params?.q) queryParams.set('q', params.q);
  if (params?.limit) queryParams.set('limit', String(params.limit));
  if (params?.offset) queryParams.set('offset', String(params.offset));

  const endpoint = `/claude/blacklist${queryParams.toString() ? `?${queryParams}` : ''}`;
  return api.get(endpoint);
}

export async function createBlacklistItem(body: {
  product_type_slug: string;
  name: string;
  product_id?: number;
}): Promise<BlacklistItem> {
  return api.post('/claude/blacklist', body);
}

export async function deleteBlacklistItem(id: number): Promise<void> {
  return api.delete(`/claude/blacklist/${id}`);
}

// FIX 26d — bulk-import every product title currently on the merchant's
// Shopify storefront into the blacklist so Claude never re-suggests an
// existing name. Returns counts so the admin UI can show feedback.
export interface ImportShopifyResponse {
  ok: boolean;
  shopify_products: number;
  inserted: number;
  skipped: number;
  total_pages: number;
}
export async function importShopifyTitlesIntoBlacklist(): Promise<ImportShopifyResponse> {
  return api.post('/claude/blacklist/import-shopify', {});
}
