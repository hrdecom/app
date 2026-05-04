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

  // P26-28 — locale param drives field-string translation. Empty /
  // "en" / unsupported locale = source strings (English).
  const url = new URL(request.url);
  const localeRaw = (url.searchParams.get('locale') || '').trim();
  const locale = localeRaw && localeRaw !== 'en' ? localeRaw : null;

  // FIX 33 — three-tier handle lookup so the personalizer keeps
  // working when the merchant has churn between the
  // shopify_product_handle the template was created with and the
  // handle Shopify ends up assigning to the live product (handle
  // changes on title rename, special-character normalization, etc).
  //
  //   tier A: exact match on customization_templates.shopify_product_handle
  //   tier B: match via products.shopify_url ending with /products/<handle>
  //           (the product table is the source of truth post-push)
  //   tier C: match via products.title slug ≈ handle (last-resort
  //           fuzzy match — handles e.g. quoted-character mangling)
  //
  // Each tier returns the most recently published template for the
  // resolved product. Falls through to 404 only when all three miss.
  let tpl = await env.DB
    .prepare(
      `SELECT * FROM customization_templates
        WHERE shopify_product_handle = ? AND status = 'published'
        ORDER BY published_at DESC LIMIT 1`,
    )
    .bind(handle)
    .first();

  if (!tpl) {
    // tier B — find the products row whose shopify_url contains
    // /products/<handle>, then look up its template.
    const productRow = await env.DB
      .prepare(
        `SELECT id FROM products
          WHERE shopify_url LIKE ?
             OR shopify_admin_url LIKE ?
          ORDER BY id DESC LIMIT 1`,
      )
      .bind(`%/products/${handle}%`, `%/products/${handle}%`)
      .first()
      .catch(() => null);
    if (productRow?.id) {
      tpl = await env.DB
        .prepare(
          `SELECT * FROM customization_templates
            WHERE product_id = ? AND status = 'published'
            ORDER BY published_at DESC LIMIT 1`,
        )
        .bind(productRow.id)
        .first();
      if (tpl) {
        console.log('[personalizer/template] handle resolved via shopify_url match', { handle, product_id: productRow.id });
      }
    }
  }

  if (!tpl) {
    // tier C — fuzzy match the handle as a slugified title. Strip
    // dashes, lowercase, and compare against a similarly normalized
    // products.title.
    const slugSpaced = handle.replace(/-/g, ' ').toLowerCase();
    const productRow = await env.DB
      .prepare(`SELECT id, title FROM products WHERE LOWER(title) LIKE ? ORDER BY id DESC`)
      .bind(`%${slugSpaced}%`)
      .first()
      .catch(() => null);
    if (productRow?.id) {
      tpl = await env.DB
        .prepare(
          `SELECT * FROM customization_templates
            WHERE product_id = ? AND status = 'published'
            ORDER BY published_at DESC LIMIT 1`,
        )
        .bind(productRow.id)
        .first();
      if (tpl) {
        console.log('[personalizer/template] handle resolved via title slug match', { handle, product_id: productRow.id, title: productRow.title });
      }
    }
  }

  if (!tpl) {
    console.log('[personalizer/template] 404 — no template found for handle', handle);
    return jsonCors({ found: false, handle }, 404, request);
  }

  // P26-29 — order fields by layer_z DESC (then sort_order, then id)
  // so the storefront form order matches the admin layer list. Admin
  // shows the layer list top-to-bottom = highest z to lowest (top of
  // list is visually on top), and the merchant expects the form on
  // the product page to follow the same ordering. Previously we used
  // sort_order ASC, which drifts from layer_z whenever a field is
  // created LATER than fields that sit visually below it (e.g. a name
  // field added after birthstones still appears above the birthstones
  // in the layer list because it has a higher z-index, but used to
  // render at the bottom of the storefront form). sort_order +
  // id are kept as deterministic tiebreakers when two layers share
  // the same z (matches the admin's stable-sort behaviour).
  const { results: fields } = await env.DB
    .prepare(
      `SELECT * FROM customization_fields
        WHERE template_id = ?
        ORDER BY layer_z DESC, sort_order ASC, id ASC`,
    )
    .bind(tpl.id)
    .all();

  // P26-28 — overlay translations onto fields when a non-English
  // locale was requested. Each translatable column is replaced ONLY
  // if the translation row has a non-null value, so missing
  // translations gracefully fall back to the source string.
  if (locale && fields && fields.length > 0) {
    const fieldIds = fields.map((f) => f.id);
    const placeholders = fieldIds.map(() => '?').join(', ');
    const { results: trRows } = await env.DB
      .prepare(
        `SELECT field_id, customer_label, cart_label, info_text, placeholder
           FROM personalizer_field_translations
          WHERE locale = ? AND field_id IN (${placeholders})`,
      )
      .bind(locale, ...fieldIds)
      .all();
    const byField = new Map();
    for (const r of trRows || []) byField.set(r.field_id, r);
    for (const f of fields) {
      const tr = byField.get(f.id);
      if (!tr) continue;
      if (tr.customer_label) f.customer_label = tr.customer_label;
      if (tr.cart_label) f.cart_label = tr.cart_label;
      if (tr.info_text) f.info_text = tr.info_text;
      if (tr.placeholder) f.placeholder = tr.placeholder;
    }
  }

  // P25-V2 — embed the global widget settings (padding) so the
  // storefront can apply them without a second round-trip. Defaults
  // gracefully if the row hasn't been set.
  const settings = await env.DB
    .prepare(`SELECT widget_padding_top, widget_padding_bottom, color_option_names_json, birthstones_json, birthstones_translations_json FROM personalizer_settings WHERE id = 1`)
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
                rotation_deg, curve_radius_px, curve_tilt_deg, hidden
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
  //
  // P26-28 — when a non-English locale is requested, also overlay
  // the per-locale month label translations onto the library so the
  // storefront selector reads "Enero / Febrero / ..." instead of
  // "January / February / ..." for ?locale=es.
  let birthstonesJsonOut = settings?.birthstones_json ?? null;
  if (locale && birthstonesJsonOut && settings?.birthstones_translations_json) {
    try {
      const lib = JSON.parse(birthstonesJsonOut);
      const trMap = JSON.parse(settings.birthstones_translations_json);
      const localeLabels = trMap && trMap[locale];
      if (Array.isArray(lib) && Array.isArray(localeLabels)) {
        const merged = lib.map((entry) => {
          if (!entry || typeof entry !== 'object') return entry;
          const idx = Number(entry.month_index);
          if (!Number.isFinite(idx) || idx < 1 || idx > 12) return entry;
          const localized = localeLabels[idx - 1];
          if (typeof localized === 'string' && localized.trim()) {
            return { ...entry, label: localized };
          }
          return entry;
        });
        birthstonesJsonOut = JSON.stringify(merged);
      }
    } catch { /* malformed translations — fall back to source */ }
  }
  const tplOut = { ...tpl, birthstones_json: birthstonesJsonOut };

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
