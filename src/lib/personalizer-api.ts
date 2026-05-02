import { api } from './api';

export type FieldKind = 'text' | 'image' | 'birthstone';

/**
 * P26-26 — one entry in the per-template birthstones library. The
 * library has exactly 12 entries (months 1-12). Each entry has an
 * editable label (defaults to the month name in English) and an
 * optional uploaded image_url. A birthstone field on a template
 * references this library by month_index.
 */
export interface BirthstoneOption {
  month_index: number;        // 1..12
  label: string;              // e.g. "January", "Janvier", "Garnet"
  image_url: string | null;   // R2 URL of the uploaded PNG (null = not uploaded yet)
}

export interface PersonalizerSettings {
  id?: number;
  default_font_family: string | null;
  default_font_size_px: number | null;
  default_font_color: string | null;
  default_max_chars: number | null;
  /** P25-V2 — admin-controlled vertical padding around the storefront
   * widget (px). Defaults to 10 each side. */
  widget_padding_top?: number | null;
  widget_padding_bottom?: number | null;
  /** P25-V3 — JSON-encoded array of Shopify option names that count as
   * "color" and should be excluded from the variant_signature. NULL =
   * use the server-side defaults (Color, Couleur, Métal, Metal, ...). */
  color_option_names_json?: string | null;
  /** P26-26 — global birthstones library (12 PNG icons shared by every
   * birthstone field on every product). JSON-encoded BirthstoneOption[]
   * (length 12). Admin-only PATCH. NULL = no library yet. */
  birthstones_json?: string | null;
  updated_at?: string;
}

export interface CustomFont {
  id: number;
  family_name: string;
  display_name: string | null;
  r2_key: string;
  format: string;
  weight: number;
  style: string;
  is_active: number;
  uploaded_by: number | null;
  created_at: string;
}
export type CurveMode = 'linear' | 'arc' | 'circle';
export type MaskShape = 'rect' | 'circle' | 'heart';
export type ProductionStatus = 'pending' | 'in_production' | 'shipped' | 'cancelled';

export interface PersonalizerTemplate {
  id: number;
  product_id: number;
  shopify_product_handle: string | null;
  base_image_url: string | null;
  canvas_width: number;
  canvas_height: number;
  /** P25-4 — z-index where the product image sits in the layer stack.
   * Fields below this render UNDER the image; fields at or above it
   * render on top. Default 5. */
  base_image_layer_z?: number;
  /** P25-V3 — JSON map { variant_signature: imageUrl } that swaps
   * the base image when the shopper picks a different non-color variant
   * (e.g. "1 Heart" → 1-heart.png, "2 Hearts" → 2-hearts.png). NULL =
   * always use base_image_url. */
  variant_image_overrides_json?: string | null;
  /** P26-26 — JSON-encoded BirthstoneOption[] (length 12). LEGACY —
   * the live storefront API now injects the GLOBAL library
   * (personalizer_settings.birthstones_json) into this field at read
   * time. The per-template column is kept in the database for
   * backward compatibility but is no longer written by the admin.
   * Treat this as read-only. */
  birthstones_json?: string | null;
  status: 'draft' | 'published' | 'archived';
  published_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  product_title?: string;
  field_count?: number;
  fields?: PersonalizerField[];
}

export interface PersonalizerField {
  id: number;
  template_id: number;
  field_kind: FieldKind;
  sort_order: number;
  layer_z: number;
  label: string;
  placeholder: string | null;
  default_value: string | null;
  required: number;
  max_chars: number | null;
  allow_empty: number;
  font_family: string | null;
  font_size_px: number | null;
  font_color: string | null;
  text_align: string | null;
  letter_spacing: number | null;
  curve_mode: CurveMode | null;
  curve_radius_px: number | null;
  curve_path_d: string | null;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  rotation_deg: number;
  mask_shape: MaskShape | null;
  image_max_size_kb: number;
  config_json: string | null;
  /** P25-6 — overrides `label` for the Shopify cart line item display.
   * If null/empty, the cart shows the regular `label`. */
  cart_label?: string | null;
  /** P25-6 — JSON-encoded array of variant option values this field
   * shows on. Example: '["2","3","4"]' for a "Pendant 2" field that
   * only shows when the customer picks 2/3/4 pendants. NULL = always
   * visible. The widget watches the storefront variant selector and
   * shows/hides fields accordingly. */
  visible_variant_options?: string | null;
  /** P25-V4 — JSON map { variantValue: hexColor } of per-variant-value
   * text color overrides. The storefront looks up the customer's
   * selected variant value and uses the matching color, falling back
   * to `font_color`. */
  font_color_by_value_json?: string | null;
  /** P25-V4 — customer-facing label shown above the input on the
   * storefront. The existing `label` is reserved for the internal
   * admin name; `customer_label` is what the shopper sees. NULL/empty
   * → falls back to `label`. */
  customer_label?: string | null;
  /** P25-V4 — when 1, this field renders as a small (i) info icon with
   * `info_text` as a tooltip, NOT as an input. Useful for one-off
   * production / shipping notes that don't need customer input. */
  is_info?: number;
  info_text?: string | null;
}

export interface PersonalizerOrder {
  id: number;
  shopify_order_id: string;
  shopify_order_name: string | null;
  shopify_line_item_id: string;
  product_id: number | null;
  template_id: number | null;
  template_snapshot_json: string;
  values_json: string;
  production_status: ProductionStatus;
  production_notes: string | null;
  created_at: string;
  product_title?: string;
}

export async function listTemplates(opts?: { product_id?: number; status?: string }) {
  const params = new URLSearchParams();
  if (opts?.product_id) params.set('product_id', String(opts.product_id));
  if (opts?.status) params.set('status', opts.status);
  const qs = params.toString();
  const r = await api.get(`/personalizer/templates${qs ? `?${qs}` : ''}`);
  return (r.items || []) as PersonalizerTemplate[];
}

export async function getTemplate(id: number) {
  return api.get(`/personalizer/templates/${id}`) as Promise<PersonalizerTemplate>;
}

export async function createTemplate(body: {
  product_id: number;
  base_image_url?: string;
  shopify_product_handle?: string;
  canvas_width?: number;
  canvas_height?: number;
}) {
  return api.post('/personalizer/templates', body) as Promise<{ id: number; created?: boolean; existed?: boolean }>;
}

export async function updateTemplate(id: number, patch: Partial<PersonalizerTemplate>) {
  return api.patch(`/personalizer/templates/${id}`, patch);
}

export async function archiveTemplate(id: number) {
  return api.delete(`/personalizer/templates/${id}`);
}

export async function createField(templateId: number, body: Partial<PersonalizerField>) {
  return api.post(`/personalizer/templates/${templateId}/fields`, body) as Promise<{ id: number; sort_order: number }>;
}

export async function updateField(id: number, patch: Partial<PersonalizerField>) {
  return api.patch(`/personalizer/fields/${id}`, patch);
}

export async function deleteField(id: number) {
  return api.delete(`/personalizer/fields/${id}`);
}

export async function reorderFields(items: { id: number; sort_order?: number; layer_z?: number }[]) {
  return api.post(`/personalizer/fields/0/reorder`, { items });
}

export async function listOrders(opts?: { status?: ProductionStatus }) {
  const qs = opts?.status ? `?status=${opts.status}` : '';
  const r = await api.get(`/personalizer/orders${qs}`);
  return (r.items || []) as PersonalizerOrder[];
}

export async function updateOrder(id: number, patch: { production_status?: ProductionStatus; production_notes?: string }) {
  return api.patch(`/personalizer/orders/${id}`, patch);
}

// ─── Personalizer Settings ────────────────────────────────────────────────────

export async function getSettings(): Promise<PersonalizerSettings> {
  return api.get('/personalizer/settings') as Promise<PersonalizerSettings>;
}

export async function updateSettings(patch: Partial<PersonalizerSettings>): Promise<PersonalizerSettings> {
  return api.patch('/personalizer/settings', patch) as Promise<PersonalizerSettings>;
}

// ─── Custom Fonts ─────────────────────────────────────────────────────────────

export async function listFonts(): Promise<CustomFont[]> {
  const r = await api.get('/personalizer/fonts') as { items: CustomFont[] };
  return r.items || [];
}

export async function uploadFont(
  file: File,
  opts: { family_name: string; display_name?: string; weight?: number; style?: string },
): Promise<CustomFont> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('family_name', opts.family_name);
  if (opts.display_name) fd.append('display_name', opts.display_name);
  if (opts.weight != null) fd.append('weight', String(opts.weight));
  if (opts.style) fd.append('style', opts.style);
  const res = await fetch('/api/personalizer/fonts', { method: 'POST', body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' })) as { error?: string };
    throw new Error(err.error || 'Upload failed');
  }
  return res.json() as Promise<CustomFont>;
}

export async function deleteFont(id: number): Promise<void> {
  await api.delete(`/personalizer/fonts/${id}`);
}

// ─── P25-V3 — Per-variant placement overrides ─────────────────────────────────

/** A single per-variant override row. Every placement column is
 * optional — NULL means "use the field's default". `hidden` is the
 * only required column (defaults to 0). */
export interface VariantOverride {
  variant_signature: string;
  position_x?: number | null;
  position_y?: number | null;
  width?: number | null;
  height?: number | null;
  rotation_deg?: number | null;
  curve_radius_px?: number | null;
  hidden?: number;
}

/** A Shopify variant as returned by /personalizer/templates/:id/variants.
 * `options` is positional and matches `option_names` 1-to-1. */
export interface ShopifyVariantInfo {
  id: string;
  title: string;
  options: string[];
  option_names: string[];
  featured_image_url: string | null;
}

export async function listTemplateVariants(
  templateId: number,
): Promise<{ items: ShopifyVariantInfo[]; option_names: string[] }> {
  return api.get(`/personalizer/templates/${templateId}/variants`) as Promise<{
    items: ShopifyVariantInfo[];
    option_names: string[];
  }>;
}

export async function listFieldOverrides(fieldId: number): Promise<VariantOverride[]> {
  const r = await api.get(`/personalizer/fields/${fieldId}/overrides`) as { items: VariantOverride[] };
  return r.items || [];
}

export async function upsertFieldOverride(
  fieldId: number,
  variant_signature: string,
  patch: Partial<VariantOverride>,
): Promise<{ success: boolean }> {
  return api.patch(`/personalizer/fields/${fieldId}/overrides`, {
    variant_signature,
    patch,
  }) as Promise<{ success: boolean }>;
}

export async function deleteFieldOverride(
  fieldId: number,
  variant_signature: string,
): Promise<{ success: boolean }> {
  // The body wins over the method=DELETE in fetchApi, which serializes
  // any object body to JSON automatically.
  return api.delete(`/personalizer/fields/${fieldId}/overrides`, {
    body: { variant_signature },
  }) as Promise<{ success: boolean }>;
}
