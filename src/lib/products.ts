import { api } from './api';
import type { Product, ProductListItem } from '../types/product';

export interface ListProductsParams {
  limit?: number;
  offset?: number;
  status?: string;
  category?: string;
  search?: string;
  created_by?: string;
  assigned_to?: string;
  // FIX 32 — filters by the user who pushed the product to Shopify
  // (sourced from workflow_events on the backend). Used by the
  // integrator's Done tab so a shipped product still shows there
  // after an ads-creator picks it up and re-assigns it.
  pushed_by?: string;
}

export interface ListProductsResponse {
  items: ProductListItem[];
  total: number;
  limit: number;
  offset: number;
}

export async function listProducts(
  params: ListProductsParams = {}
): Promise<ListProductsResponse> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      query.append(key, String(value));
    }
  });

  const queryString = query.toString();
  const endpoint = queryString ? `/products?${queryString}` : '/products';
  const res: any = await api.get(endpoint);
  // Defensive: tolerate array, {items}, or {products} shapes.
  const items: ProductListItem[] = Array.isArray(res)
    ? res
    : Array.isArray(res?.items)
    ? res.items
    : Array.isArray(res?.products)
    ? res.products
    : [];
  return {
    items,
    total: Number(res?.total ?? items.length),
    limit: Number(res?.limit ?? items.length),
    offset: Number(res?.offset ?? 0),
  };
}

export async function getProduct(id: number): Promise<Product> {
  return api.get(`/products/${id}`);
}

export async function createProduct(body: {
  title: string;
  category?: string | null;
  description?: string | null;
  status?: string;
}): Promise<Product> {
  return api.post('/products', body);
}

export async function updateProduct(
  id: number,
  body: {
    title?: string;
    category?: string;
    description?: string;
    product_type_slug?: string;
    collection?: string;
    bullet_list?: string[];
  }
): Promise<Product> {
  return api.patch(`/products/${id}`, body);
}

export async function deleteProduct(id: number): Promise<void> {
  return api.delete(`/products/${id}`);
}

export async function transitionProduct(
  id: number,
  body: {
    to: string;
    note?: string;
    assigned_to?: number;
  }
): Promise<Product> {
  return api.post(`/products/${id}/transition`, body);
}

export interface ProductCounts {
  by_status: Record<string, number>;
}

export async function getProductCounts(): Promise<ProductCounts> {
  return api.get('/products/counts');
}

export async function addLink(
  productId: number,
  body: {
    source: string;
    url: string;
    notes?: string;
    kind?: 'source' | 'competitor';
  }
): Promise<any> {
  return api.post(`/products/${productId}/links`, body);
}

export async function updateLink(
  linkId: number,
  body: {
    source?: string;
    url?: string;
    notes?: string;
    kind?: 'source' | 'competitor';
  }
): Promise<any> {
  return api.patch(`/products/links/${linkId}`, body);
}

export async function deleteLink(linkId: number): Promise<void> {
  return api.delete(`/products/links/${linkId}`);
}

/**
 * Compress a data URL image to fit D1's ~1MB cell limit.
 * Max 1600px on longest side, JPEG quality 0.92 — preserves good quality.
 * Returns a smaller data URL. Skips non-data URLs.
 */
async function compressDataUrl(dataUrl: string, maxSize = 1600, quality = 0.92): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) return dataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        const scale = maxSize / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl); // fallback to original on error
    img.src = dataUrl;
  });
}

export async function addImage(
  productId: number,
  body: {
    role: string;
    url_or_key: string;
    prompt?: string;
    tool?: string;
  }
): Promise<any> {
  let finalUrl = body.url_or_key;

  if (finalUrl.startsWith('data:image/')) {
    // Try R2 upload first (full resolution), fall back to compression for D1
    try {
      const uploadRes: any = await api.post('/images/upload', { data_url: finalUrl });
      if (uploadRes?.url && uploadRes.storage === 'r2') {
        finalUrl = uploadRes.url; // R2 URL — full resolution preserved
      } else {
        // R2 not available — compress for D1
        finalUrl = await compressDataUrl(finalUrl);
      }
    } catch {
      // Upload endpoint failed — compress as fallback
      finalUrl = await compressDataUrl(finalUrl);
    }
  }

  return api.post(`/products/${productId}/images`, { ...body, url_or_key: finalUrl });
}

export async function deleteImage(imageId: number): Promise<void> {
  return api.delete(`/products/images/${imageId}`);
}

export async function addProductImagesBatch(
  productId: number,
  items: Array<{
    url_or_key: string;
    prompt?: string;
    role?: 'generated' | 'source' | 'variant' | 'ad';
    tool?: 'nano-banana' | 'manual' | 'external' | 'seedance' | 'remotion';
  }>
): Promise<void> {
  const errors: string[] = [];

  for (const item of items) {
    try {
      await addImage(productId, {
        role: item.role || 'generated',
        url_or_key: item.url_or_key,
        prompt: item.prompt,
        tool: item.tool || 'nano-banana',
      });
    } catch (e: any) {
      errors.push(`${item.url_or_key}: ${e?.message || 'Unknown error'}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`${errors.length} image(s) failed to add. ${errors.slice(0, 3).join('; ')}`);
  }
}

export async function reorderProductImages(
  productId: number,
  ids: number[]
): Promise<void> {
  return api.patch(`/products/${productId}/images/reorder`, { ids });
}
