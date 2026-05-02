import { requireRole, json, errorJson } from '../../../lib/auth-middleware.js';
import { graphql } from '../../../lib/shopify-graphql.js';
import {
  SUPPORTED_LOCALES,
  translateTemplateFields,
  translateBirthstoneLabels,
} from '../../../lib/translate-personalizer.js';

export async function onRequest(context) {
  const { request } = context;
  try {
    if (request.method === 'GET') return await handleGet(context);
    if (request.method === 'PATCH') return await handlePatch(context);
    if (request.method === 'DELETE') return await handleDelete(context);
    return errorJson('Method not allowed', 405);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Template [id] error:', e);
    return errorJson('Internal server error', 500);
  }
}

async function handleGet(context) {
  const { params, env } = context;
  await requireRole(context, 'admin', 'integrator');
  const id = parseInt(params.id);
  if (isNaN(id)) return errorJson('Invalid id', 400);

  const tpl = await env.DB
    .prepare(`SELECT * FROM customization_templates WHERE id = ?`)
    .bind(id)
    .first();
  if (!tpl) return errorJson('Not found', 404);

  const { results: fields } = await env.DB
    .prepare(`SELECT * FROM customization_fields WHERE template_id = ? ORDER BY sort_order ASC, id ASC`)
    .bind(id)
    .all();
  return json({ ...tpl, fields: fields || [] });
}

async function handlePatch(context) {
  const { request, params, env } = context;
  await requireRole(context, 'admin', 'integrator');
  const id = parseInt(params.id);
  if (isNaN(id)) return errorJson('Invalid id', 400);

  let body;
  try { body = await request.json(); } catch { return errorJson('Invalid JSON', 400); }

  const allowed = [
    'shopify_product_handle', 'base_image_url', 'canvas_width', 'canvas_height',
    'status', 'base_image_layer_z',
    // P25-V3 — JSON map { variant_signature: image_url } for per-variant
    // base image swaps. NULL/empty = no override (use template base_image_url).
    'variant_image_overrides_json',
    // P26-26 — JSON array of 12 birthstone entries
    // ([{ month_index, label, image_url }, ...]) shared by every
    // birthstone field on this template. NULL = no library yet.
    'birthstones_json',
  ];
  const sets = [];
  const binds = [];
  for (const k of allowed) {
    if (k in body) { sets.push(`${k} = ?`); binds.push(body[k]); }
  }
  if (body.status === 'published') sets.push(`published_at = datetime('now')`);
  if (sets.length === 0) return errorJson('No editable fields supplied', 400);
  sets.push(`updated_at = datetime('now')`);
  binds.push(id);

  await env.DB
    .prepare(`UPDATE customization_templates SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  // P26-28 — Publish hook. When the merchant publishes the template,
  // auto-translate any field strings missing for the 8 non-English
  // locales AND mirror the full translation snapshot into a Shopify
  // product metafield so it persists outside our app. Best-effort:
  // failures here are logged but don't fail the publish (the
  // merchant can re-trigger later from the Translations panel).
  let publishExtras = null;
  if (body.status === 'published') {
    try {
      publishExtras = await runPublishTranslations(env, id);
    } catch (e) {
      console.error('[publish translations] failed:', e?.message || e);
      publishExtras = { error: 'translation_pipeline_failed', detail: String(e?.message || e) };
    }
  }
  return json({ success: true, id, publish: publishExtras });
}

/**
 * P26-28 — on Publish: ensure every supported locale has translated
 * field strings + birthstone labels, then push the whole snapshot to
 * a Shopify product metafield. Returns a summary the admin UI can
 * surface in a toast.
 */
async function runPublishTranslations(env, templateId) {
  const tpl = await env.DB
    .prepare(`SELECT id, product_id, shopify_product_handle FROM customization_templates WHERE id = ?`)
    .bind(templateId)
    .first();
  if (!tpl) throw new Error('template not found');

  const { results: fields } = await env.DB
    .prepare(
      `SELECT id, field_kind, customer_label, cart_label, info_text, placeholder
         FROM customization_fields
        WHERE template_id = ?`,
    )
    .bind(templateId)
    .all();

  // P26-28 follow-up — pull existing translation rows AND build a
  // per-(field, locale) "is this row complete?" set. A row counts as
  // complete only when every column the SOURCE has content for is
  // populated in the translation. Stale rows generated before the
  // f.label fallback synthesis landed (cart_label=null even though
  // the field has a label) are now correctly flagged as incomplete
  // and get refreshed on the next publish, instead of being skipped
  // by a naive "row exists -> skip" check.
  const { results: existingRows } = await env.DB
    .prepare(
      `SELECT t.field_id, t.locale, t.customer_label, t.cart_label, t.info_text, t.placeholder
         FROM personalizer_field_translations t
         JOIN customization_fields f ON f.id = t.field_id
        WHERE f.template_id = ?`,
    )
    .bind(templateId)
    .all();
  const fieldById = new Map();
  for (const f of fields || []) fieldById.set(f.id, f);
  const completeByFL = new Set();
  for (const r of existingRows || []) {
    const f = fieldById.get(r.field_id);
    if (!f) continue;
    const wantsCustomer = !!((f.customer_label && f.customer_label.trim()) || (f.label && f.label.trim()));
    const wantsCart = !!((f.cart_label && f.cart_label.trim()) || (f.label && f.label.trim()));
    const wantsInfo = !!(f.info_text && f.info_text.trim());
    const wantsPlaceholder = f.field_kind === 'image' && !!(f.placeholder && f.placeholder.trim());
    const isComplete =
      (!wantsCustomer || !!r.customer_label) &&
      (!wantsCart || !!r.cart_label) &&
      (!wantsInfo || !!r.info_text) &&
      (!wantsPlaceholder || !!r.placeholder);
    if (isComplete) completeByFL.add(`${r.field_id}|${r.locale}`);
  }

  const localeKeys = Object.keys(SUPPORTED_LOCALES);
  const summary = { locales_translated: 0, fields_inserted: 0 };

  await Promise.all(localeKeys.map(async (locale) => {
    const fieldsToTranslate = (fields || []).filter((f) => {
      const hasContent =
        (f.label && f.label.trim()) ||
        (f.customer_label && f.customer_label.trim()) ||
        (f.cart_label && f.cart_label.trim()) ||
        (f.info_text && f.info_text.trim()) ||
        (f.field_kind === 'image' && f.placeholder && f.placeholder.trim());
      if (!hasContent) return false;
      // P26-28 follow-up — re-translate when the row is missing OR
      // incomplete (some translatable column is null while the source
      // has content). The COALESCE upsert below preserves any
      // manually-edited cells that are already populated.
      return !completeByFL.has(`${f.id}|${locale}`);
    });
    if (fieldsToTranslate.length === 0) return;
    const { fields: translated } = await translateTemplateFields(env, fieldsToTranslate, locale);
    for (const [fid, vals] of Object.entries(translated)) {
      const fieldId = parseInt(fid);
      if (!Number.isFinite(fieldId)) continue;
      // P26-28 follow-up — COALESCE upsert: only fill columns that
      // are currently null. Any value the merchant manually edited
      // (or that an earlier auto-translate run already set) survives
      // the publish without being overwritten by a fresh Claude run.
      // Side benefit: if Claude returns null for a column we asked
      // about, we don't blank a previously-translated value.
      await env.DB
        .prepare(
          `INSERT INTO personalizer_field_translations
              (field_id, locale, customer_label, cart_label, info_text, placeholder, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(field_id, locale) DO UPDATE SET
              customer_label = COALESCE(customer_label, excluded.customer_label),
              cart_label     = COALESCE(cart_label,     excluded.cart_label),
              info_text      = COALESCE(info_text,      excluded.info_text),
              placeholder    = COALESCE(placeholder,    excluded.placeholder),
              updated_at     = datetime('now')`,
        )
        .bind(fieldId, locale, vals.customer_label, vals.cart_label, vals.info_text, vals.placeholder)
        .run();
      summary.fields_inserted += 1;
    }
    summary.locales_translated += 1;
  }));

  // Birthstone library translations (global) — also fill gaps.
  const settingsRow = await env.DB
    .prepare(`SELECT birthstones_json, birthstones_translations_json FROM personalizer_settings WHERE id = 1`)
    .first()
    .catch(() => null);
  let bsLibrary = [];
  if (settingsRow?.birthstones_json) {
    try {
      const parsed = JSON.parse(settingsRow.birthstones_json);
      if (Array.isArray(parsed)) bsLibrary = parsed;
    } catch { /* */ }
  }
  let bsTranslations = {};
  if (settingsRow?.birthstones_translations_json) {
    try {
      const parsed = JSON.parse(settingsRow.birthstones_translations_json);
      if (parsed && typeof parsed === 'object') bsTranslations = parsed;
    } catch { /* */ }
  }
  const sourceLabels = [];
  for (let i = 1; i <= 12; i++) {
    const entry = bsLibrary.find((b) => b && Number(b.month_index) === i);
    sourceLabels.push((entry && typeof entry.label === 'string' && entry.label) || `Month ${i}`);
  }
  await Promise.all(localeKeys.map(async (locale) => {
    const existing = bsTranslations[locale];
    if (Array.isArray(existing) && existing.length === 12 && existing.every((s) => typeof s === 'string' && s.trim())) {
      return;
    }
    const arr = await translateBirthstoneLabels(env, sourceLabels, locale);
    if (arr) bsTranslations[locale] = arr;
  }));
  try {
    await env.DB
      .prepare(`UPDATE personalizer_settings SET birthstones_translations_json = ?, updated_at = datetime('now') WHERE id = 1`)
      .bind(JSON.stringify(bsTranslations))
      .run();
  } catch (err) {
    if (/no such column/i.test(String(err?.message || err))) {
      await env.DB.prepare(`ALTER TABLE personalizer_settings ADD COLUMN birthstones_translations_json TEXT`).run();
      await env.DB
        .prepare(`UPDATE personalizer_settings SET birthstones_translations_json = ?, updated_at = datetime('now') WHERE id = 1`)
        .bind(JSON.stringify(bsTranslations))
        .run();
    } else {
      throw err;
    }
  }

  // Shopify metafield mirror — full per-locale snapshot of the
  // current template's field translations + the global birthstones
  // translations. Persists in Shopify even if our app is removed.
  let metafield = null;
  try {
    metafield = await pushTranslationsMetafield(env, tpl, fields || [], bsTranslations);
  } catch (e) {
    console.error('[publish translations] Shopify metafield push failed:', e?.message || e);
    summary.metafield_error = String(e?.message || e);
  }
  if (metafield) summary.metafield = metafield;

  return summary;
}

/**
 * P26-28 — write the per-locale translation snapshot to a product
 * metafield (`personalizer.translations_json`, type=json). This makes
 * the data portable: even if the merchant uninstalls our app the
 * translations still live on the product in their Shopify admin.
 */
async function pushTranslationsMetafield(env, tpl, fields, bsTranslations) {
  const productId = tpl.product_id;
  if (!productId) return null;
  const row = await env.DB
    .prepare(`SELECT shopify_product_id FROM products WHERE id = ?`)
    .bind(productId)
    .first()
    .catch(() => null);
  const shopifyProductId = row?.shopify_product_id;
  if (!shopifyProductId) return { skipped: 'no shopify_product_id on product' };

  // Build the full per-locale snapshot.
  const fieldIds = fields.map((f) => f.id);
  let trRows = [];
  if (fieldIds.length > 0) {
    const placeholders = fieldIds.map(() => '?').join(', ');
    const { results } = await env.DB
      .prepare(
        `SELECT field_id, locale, customer_label, cart_label, info_text, placeholder
           FROM personalizer_field_translations
          WHERE field_id IN (${placeholders})`,
      )
      .bind(...fieldIds)
      .all();
    trRows = results || [];
  }
  const fieldTr = {};
  for (const r of trRows) {
    if (!fieldTr[r.field_id]) fieldTr[r.field_id] = {};
    fieldTr[r.field_id][r.locale] = {
      customer_label: r.customer_label || null,
      cart_label: r.cart_label || null,
      info_text: r.info_text || null,
      placeholder: r.placeholder || null,
    };
  }

  // Include source strings too so the metafield is self-contained.
  const fieldSources = {};
  for (const f of fields) {
    fieldSources[f.id] = {
      field_kind: f.field_kind,
      customer_label: f.customer_label || null,
      cart_label: f.cart_label || null,
      info_text: f.info_text || null,
      placeholder: f.placeholder || null,
    };
  }

  const value = {
    snapshot_at: new Date().toISOString(),
    template_id: tpl.id,
    fields: fieldSources,
    field_translations: fieldTr,
    birthstone_translations: bsTranslations || {},
  };

  const ownerId = `gid://shopify/Product/${shopifyProductId}`;
  const result = await graphql(env, `
    mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key }
        userErrors { field message }
      }
    }
  `, {
    metafields: [{
      ownerId,
      namespace: 'personalizer',
      key: 'translations_json',
      type: 'json',
      value: JSON.stringify(value),
    }],
  });
  const errors = result?.metafieldsSet?.userErrors || [];
  if (errors.length > 0) {
    throw new Error('userErrors: ' + JSON.stringify(errors));
  }
  return { ok: true, metafield: 'personalizer.translations_json' };
}

async function handleDelete(context) {
  const { params, env } = context;
  await requireRole(context, 'admin', 'integrator');
  const id = parseInt(params.id);
  if (isNaN(id)) return errorJson('Invalid id', 400);
  await env.DB
    .prepare(`UPDATE customization_templates SET status = 'archived', updated_at = datetime('now') WHERE id = ?`)
    .bind(id)
    .run();
  return json({ success: true, id, archived: true });
}
