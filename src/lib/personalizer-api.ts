import { api } from './api';

export type FieldKind = 'text' | 'image';
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
