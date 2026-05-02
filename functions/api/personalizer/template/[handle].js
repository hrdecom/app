/**
 * GET /api/personalizer/template/:handle
 *
 * Public read-only endpoint consumed by the storefront widget.
 * - Only returns published templates (drafts and archived are 404).
 * - Returns CORS headers so the storefront page can fetch from our domain.
 *
 * No auth — this is intentionally public. Templates contain no PII.
 *
 * P25-V3 — also returns:
 *   • overrides: per-field, per-variant_signature placement overrides
 *   • variant_image_overrides: per-variant_signature base image URLs
 *   • color_option_names: list of Shopify option names that count as
 *     "color" (and should be excluded from the variant_signature on
 *     the storefront).
 */

const DEFAULT_COLOR_OPTION_NAMES = [
  'Color', 'Couleur', 'Colour', 'Métal', 'Metal', 'Material', 'Matière',
];

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const handle = String(params.handle || '').trim();
  if (!handle) return jsonCors({ error: 'handle required' }, 400, request);

  const tpl = await env.DB
    .prepare(
      `SELECT * FROM customization_templates
        WHERE shopify_product_handle = ? AND status = 'published'
        ORDER BY published_at DESC LIMIT 1`,
    )
    .bind(handle)
    .first();
  if (!tpl) return jsonCors({ found: false }, 404, request);

  const { results: fields } = await env.DB
    .prepare(`SELECT * FROM customization_fields WHERE template_id = ? ORDER BY sort_order ASC`)
    .bind(tpl.id)
    .all();

  // P25-V2 — embed the global widget settings (padding) so the
  // storefront can apply them without a second round-trip. Defaults
  // gracefully if the row hasn't been set.
  const settings = await env.DB
    .prepare(`SELECT widget_padding_top, widget_padding_bottom, color_option_names_json, birthstones_json FROM personalizer_settings WHERE id = 1`)
    .first()
    .catch(() => null);

  // P25-V3 — pull every per-variant override for this template's
  // fields in one query and group them as
  //   overrides[fieldId][variant_signature] = { ... }
  let overrides = {};
  if (fields && fields.length > 0) {
    const fieldIds = fields.map((f) => f.id);
    const placeholders = fieldIds.map(() => '?').join(', ');
    const { results: ovRows } = await env.DB
      .prepare(
        `SELECT field_id, variant_signature, position_x, position_y, width, height,
                rotation_deg, curve_radius_px, hidden
           FROM customization_field_variant_overrides
          WHERE field_id IN (${placeholders})`,
      )
      .bind(...fieldIds)
      .all();
    for (const row of ovRows || []) {
      const fid = row.field_id;
      if (!overrides[fid]) overrides[fid] = {};
      const { field_id: _omit, variant_signature, ...rest } = row;
      overrides[fid][variant_signature] = rest;
    }
  }

  // Per-variant base image overrides — stored as JSON on the template row.
  let variant_image_overrides = {};
  if (tpl.variant_image_overrides_json) {
    try {
      const parsed = JSON.parse(tpl.variant_image_overrides_json);
      if (parsed && typeof parsed === 'object') variant_image_overrides = parsed;
    } catch {
      // Ignore malformed JSON — fall back to {}.
    }
  }

  // Color option names — admin-editable list of Shopify option names
  // that should be excluded from the variant_signature.
  let color_option_names = DEFAULT_COLOR_OPTION_NAMES;
  if (settings?.color_option_names_json) {
    try {
      const parsed = JSON.parse(settings.color_option_names_json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        color_option_names = parsed.filter((s) => typeof s === 'string');
      }
    } catch {
      // Keep defaults on parse failure.
    }
  }

  // P26-26 follow-up — birthstones library moved from per-template
  // (tpl.birthstones_json) to per-shop (settings.birthstones_json).
  // Inject the global library into the template payload under the
  // existing key so the storefront widget + renderer (which already
  // read template.birthstones_json) keep working unchanged.
  const tplOut = { ...tpl, birthstones_json: settings?.birthstones_json ?? null };

  return jsonCors({
    found: true,
    template: tplOut,
    fields: fields || [],
    settings: {
      widget_padding_top: settings?.widget_padding_top ?? 10,
      widget_padding_bottom: settings?.widget_padding_bottom ?? 10,
    },
    overrides,
    variant_image_overrides,
    color_option_names,
  }, 200, request);
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request) });
}

function jsonCors(body, status, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

function corsHeaders(request) {
  const origin = request?.headers?.get('Origin') || '';
  const allowed = origin.endsWith('.myshopify.com') || origin === 'https://riccardiparis.com'
    ? origin
    : '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}
