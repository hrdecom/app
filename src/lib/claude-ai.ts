import { api } from './api';

export interface ProductType {
  id?: number;
  slug: string;
  name: string;
  is_active?: boolean | number;
}

export interface TitleSuggestion {
  title: string;
  product_type: string;
  collection: string;
  name_part: string;
  is_recommended: boolean;
}

export interface GenerateTitleResponse {
  suggestions: TitleSuggestion[];
  image_used: string;
  product_type_options: ProductType[];
  collection_options: { name: string }[];
}

export interface GenerateDescriptionResponse {
  paragraph1: string;
  paragraph2: string;
  bullets: string[] | string;  // Backend may return "\n"-joined string or array
}

export interface ClaudeSettings {
  title_template?: string;
  format_ring?: string;
  format_other?: string;
  description_template?: string;
  description_max_chars?: number;
  description_paragraph_count?: number;
  max_chars?: number;
}

// Shared defensive unwrap — tolerates array / { items } / { <named> } shapes.
function asArray<T = any>(res: any, ...candidateKeys: string[]): T[] {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.items)) return res.items;
  for (const key of candidateKeys) {
    if (Array.isArray(res?.[key])) return res[key];
  }
  return [];
}

export async function getProductTypes(): Promise<ProductType[]> {
  // NB: api.get auto-prefixes /api — do NOT prepend it again.
  const res: any = await api.get('/claude/product-types');
  return asArray<ProductType>(res, 'product_types');
}

export async function generateTitle(
  productId: number,
  productTypeSlug?: string,
  // FIX 26c — optional per-request integrator guidance, e.g.
  // "this is a ring with 2 customizable initials".
  extraPrompt?: string,
): Promise<GenerateTitleResponse> {
  const res: any = await api.post('/ai/claude/generate-title', {
    product_id: productId,
    product_type_slug: productTypeSlug,
    extra_prompt: extraPrompt && extraPrompt.trim().length > 0 ? extraPrompt.trim() : undefined,
  });
  return {
    suggestions: asArray<TitleSuggestion>(res?.suggestions ?? res, 'suggestions'),
    image_used: res?.image_used ?? '',
    product_type_options: asArray<ProductType>(res?.product_type_options, 'product_types'),
    collection_options: asArray<{ name: string }>(res?.collection_options, 'collections'),
  };
}

export async function acceptTitle(
  productId: number,
  title: string,
  productTypeSlug: string,
  collection: string | null | undefined,
  namePart: string,
): Promise<any> {
  return api.post('/ai/claude/accept-title', {
    product_id: productId,
    title,
    product_type_slug: productTypeSlug,
    // collection is OPTIONAL — normalize empty strings to null.
    collection: collection && String(collection).trim().length > 0 ? collection : null,
    name_part: namePart,
  });
}

export async function generateDescription(
  productId: number,
  productTypeSlug?: string,
  // FIX 26c — same per-request guidance hook as generateTitle. The
  // backend prepends it to Claude's prompt under "ADDITIONAL CONTEXT
  // FROM THE PRODUCT TEAM".
  extraPrompt?: string,
): Promise<GenerateDescriptionResponse> {
  const res: any = await api.post('/ai/claude/generate-description', {
    product_id: productId,
    product_type_slug: productTypeSlug,
    extra_prompt: extraPrompt && extraPrompt.trim().length > 0 ? extraPrompt.trim() : undefined,
  });
  // Backend returns bullets as a "\n"-joined string (e.g. "- Material: ...\n- Hypo...").
  // Pass it through as-is — the UI handler parses both strings and arrays.
  const rawBullets = res?.bullets;
  let bullets: any;
  if (Array.isArray(rawBullets)) {
    bullets = rawBullets;
  } else if (typeof rawBullets === 'string') {
    bullets = rawBullets; // pass the raw string; UI splits on \n
  } else {
    bullets = [];
  }
  return {
    paragraph1: res?.paragraph1 ?? '',
    paragraph2: res?.paragraph2 ?? '',
    bullets,
  };
}

export async function getClaudeSettings(): Promise<ClaudeSettings> {
  try {
    const res: any = await api.get('/claude/settings');
    const maxChars = res?.description_max_chars ?? res?.max_chars ?? 180;
    return {
      ...res,
      description_max_chars: Number(maxChars),
      max_chars: Number(maxChars),
    };
  } catch {
    return { max_chars: 180, description_max_chars: 180 };
  }
}
