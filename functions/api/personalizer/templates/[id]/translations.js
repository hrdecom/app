/**
 * P26-28 — translations CRUD for one personalizer template.
 *
 * GET  → all locale translations for every field on this template
 *        plus the global birthstones library translations
 * PATCH → upsert merchant edits
 * POST /auto → generate missing translations via Claude (one or all locales)
 */

import { requireRole, json, errorJson } from '../../../../lib/auth-middleware.js';
import {
  SUPPORTED_LOCALES,
  translateTemplateFields,
  translateBirthstoneLabels,
} from '../../../../lib/translate-personalizer.js';

export async function onRequest(context) {
  const { request } = context;
  try {
    if (request.method === 'GET') return await handleGet(context);
    if (request.method === 'PATCH') return await handlePatch(context);
    if (request.method === 'POST') return await handlePostAuto(context);
    return errorJson('Method not allowed', 405);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Translations API error:', e);
    return errorJson('Internal server error', 500);
  }
}

async function handleGet(context) {
  const { params, env } = context;
  await requireRole(context, 'admin', 'integrator');
  const id = parseInt(params.id);
  if (isNaN(id)) return errorJson('Invalid id', 400);

  // Field translations grouped by field_id then locale.
  const { results: rows } = await env.DB
    .prepare(
      `SELECT t.field_id, t.locale, t.customer_label, t.cart_label, t.info_text, t.placeholder
         FROM personalizer_field_translations t
         JOIN customization_fields f ON f.id = t.field_id
        WHERE f.template_id = ?`,
    )
    .bind(id)
    .all();
  const fields = {};
  for (const r of rows || []) {
    if (!fields[r.field_id]) fields[r.field_id] = {};
    fields[r.field_id][r.locale] = {
      customer_label: r.customer_label || null,
      cart_label: r.cart_label || null,
      info_text: r.info_text || null,
      placeholder: r.placeholder || null,
    };
  }

  // Birthstone label translations (global library).
  let birthstones = {};
  const settings = await env.DB
    .prepare(`SELECT birthstones_translations_json FROM personalizer_settings WHERE id = 1`)
    .first()
    .catch(() => null);
  if (settings?.birthstones_translations_json) {
    try {
      const parsed = JSON.parse(settings.birthstones_translations_json);
      if (parsed && typeof parsed === 'object') birthstones = parsed;
    } catch { /* ignore malformed */ }
  }

  return json({
    fields,
    birthstones,
    supported_locales: Object.keys(SUPPORTED_LOCALES),
  });
}

async function handlePatch(context) {
  const { request, params, env } = context;
  await requireRole(context, 'admin', 'integrator');
  const id = parseInt(params.id);
  if (isNaN(id)) return errorJson('Invalid id', 400);

  let body;
  try { body = await request.json(); } catch { return errorJson('Invalid JSON', 400); }

  // Body shape:
  //   {
  //     fields: { <fieldId>: { <locale>: { customer_label, cart_label, info_text, placeholder } } },
  //     birthstones: { <locale>: [12 labels] }   // birthstones is admin-only
  //   }
  const fieldEdits = (body.fields && typeof body.fields === 'object') ? body.fields : {};
  const birthstoneEdits = body.birthstones && typeof body.birthstones === 'object' ? body.birthstones : null;

  // Validate field_id ↔ template_id (don't let a caller patch translations
  // for fields outside this template).
  const fieldIds = Object.keys(fieldEdits).map((s) => parseInt(s)).filter((n) => Number.isFinite(n));
  if (fieldIds.length > 0) {
    const placeholders = fieldIds.map(() => '?').join(', ');
    const { results: validRows } = await env.DB
      .prepare(`SELECT id FROM customization_fields WHERE template_id = ? AND id IN (${placeholders})`)
      .bind(id, ...fieldIds)
      .all();
    const valid = new Set((validRows || []).map((r) => r.id));
    for (const fid of fieldIds) {
      if (!valid.has(fid)) {
        return errorJson(`Field ${fid} does not belong to template ${id}`, 400);
      }
    }
  }

  // Upsert per (field_id, locale).
  for (const [fieldIdStr, perLocale] of Object.entries(fieldEdits)) {
    const fieldId = parseInt(fieldIdStr);
    if (!Number.isFinite(fieldId) || !perLocale || typeof perLocale !== 'object') continue;
    for (const [locale, vals] of Object.entries(perLocale)) {
      if (!SUPPORTED_LOCALES[locale]) continue;
      if (!vals || typeof vals !== 'object') continue;
      const customer_label = typeof vals.customer_label === 'string' ? vals.customer_label : null;
      const cart_label = typeof vals.cart_label === 'string' ? vals.cart_label : null;
      const info_text = typeof vals.info_text === 'string' ? vals.info_text : null;
      const placeholder = typeof vals.placeholder === 'string' ? vals.placeholder : null;
      // Empty row = delete (so the GET response stays clean).
      if (!customer_label && !cart_label && !info_text && !placeholder) {
        await env.DB
          .prepare(`DELETE FROM personalizer_field_translations WHERE field_id = ? AND locale = ?`)
          .bind(fieldId, locale)
          .run();
        continue;
      }
      await env.DB
        .prepare(
          `INSERT INTO personalizer_field_translations
              (field_id, locale, customer_label, cart_label, info_text, placeholder, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(field_id, locale) DO UPDATE SET
              customer_label = excluded.customer_label,
              cart_label     = excluded.cart_label,
              info_text      = excluded.info_text,
              placeholder    = excluded.placeholder,
              updated_at     = datetime('now')`,
        )
        .bind(fieldId, locale, customer_label, cart_label, info_text, placeholder)
        .run();
    }
  }

  // Birthstone translations are admin-only — they are global, not per-template.
  if (birthstoneEdits) {
    await requireRole(context, 'admin');
    const cleaned = {};
    for (const [locale, arr] of Object.entries(birthstoneEdits)) {
      if (!SUPPORTED_LOCALES[locale]) continue;
      if (!Array.isArray(arr)) continue;
      cleaned[locale] = arr.slice(0, 12).map((s) => (typeof s === 'string' ? s : ''));
    }
    const json = JSON.stringify(cleaned);
    try {
      await env.DB
        .prepare(`UPDATE personalizer_settings SET birthstones_translations_json = ?, updated_at = datetime('now') WHERE id = 1`)
        .bind(json)
        .run();
    } catch (err) {
      // Self-heal: column may be missing on older shops.
      if (/no such column/i.test(String(err?.message || err))) {
        await env.DB.prepare(`ALTER TABLE personalizer_settings ADD COLUMN birthstones_translations_json TEXT`).run();
        await env.DB
          .prepare(`UPDATE personalizer_settings SET birthstones_translations_json = ?, updated_at = datetime('now') WHERE id = 1`)
          .bind(json)
          .run();
      } else {
        throw err;
      }
    }
  }

  return json({ success: true });
}

/**
 * POST /api/personalizer/templates/:id/translations
 *
 * Body: { locales?: string[], includeBirthstones?: boolean, mode?: 'missing' | 'all' }
 *
 * Default behaviour:
 *  - locales: every supported non-English locale
 *  - includeBirthstones: true (when admin)
 *  - mode: 'missing' — only locales without an existing translation row
 *
 * Generates translations via Claude and persists them.
 */
async function handlePostAuto(context) {
  const { request, params, env } = context;
  await requireRole(context, 'admin', 'integrator');
  const id = parseInt(params.id);
  if (isNaN(id)) return errorJson('Invalid id', 400);

  let body = {};
  try { body = await request.json(); } catch { /* allow empty body */ }
  const requestedLocales = Array.isArray(body.locales) && body.locales.length > 0
    ? body.locales.filter((l) => SUPPORTED_LOCALES[l])
    : Object.keys(SUPPORTED_LOCALES);
  const mode = body.mode === 'all' ? 'all' : 'missing';
  const includeBirthstones = body.includeBirthstones !== false;

  // Pull every field on this template (only the translatable columns).
  const { results: fields } = await env.DB
    .prepare(
      `SELECT id, field_kind, customer_label, cart_label, info_text, placeholder
         FROM customization_fields
        WHERE template_id = ?`,
    )
    .bind(id)
    .all();

  // Existing translations to skip in 'missing' mode.
  let existing = {};
  if (mode === 'missing') {
    const { results: rows } = await env.DB
      .prepare(
        `SELECT t.field_id, t.locale FROM personalizer_field_translations t
           JOIN customization_fields f ON f.id = t.field_id WHERE f.template_id = ?`,
      )
      .bind(id)
      .all();
    for (const r of rows || []) {
      if (!existing[r.field_id]) existing[r.field_id] = new Set();
      existing[r.field_id].add(r.locale);
    }
  }

  const summary = { fields_translated: 0, locales: {} };

  // Run all locales in parallel (8 max). Anthropic happily handles
  // this much concurrency under our usual rate limits.
  await Promise.all(requestedLocales.map(async (locale) => {
    summary.locales[locale] = { fields: 0, provider: null };
    let fieldsToTranslate = fields || [];
    if (mode === 'missing') {
      fieldsToTranslate = fieldsToTranslate.filter((f) => {
        // If ANY of the four columns has a value, the field is
        // translatable; if it's already translated for this locale,
        // skip it.
        const hasContent =
          (f.customer_label && f.customer_label.trim()) ||
          (f.cart_label && f.cart_label.trim()) ||
          (f.info_text && f.info_text.trim()) ||
          (f.field_kind === 'image' && f.placeholder && f.placeholder.trim());
        if (!hasContent) return false;
        return !(existing[f.id] && existing[f.id].has(locale));
      });
    }
    if (fieldsToTranslate.length === 0) return;
    const { fields: translated, provider } = await translateTemplateFields(env, fieldsToTranslate, locale);
    summary.locales[locale].provider = provider;
    for (const [fid, vals] of Object.entries(translated)) {
      const fieldId = parseInt(fid);
      if (!Number.isFinite(fieldId)) continue;
      await env.DB
        .prepare(
          `INSERT INTO personalizer_field_translations
              (field_id, locale, customer_label, cart_label, info_text, placeholder, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(field_id, locale) DO UPDATE SET
              customer_label = excluded.customer_label,
              cart_label     = excluded.cart_label,
              info_text      = excluded.info_text,
              placeholder    = excluded.placeholder,
              updated_at     = datetime('now')`,
        )
        .bind(
          fieldId, locale,
          vals.customer_label, vals.cart_label, vals.info_text, vals.placeholder,
        )
        .run();
      summary.locales[locale].fields += 1;
      summary.fields_translated += 1;
    }
  }));

  // Birthstones (global library) translations — only when admin.
  if (includeBirthstones) {
    const role = (context.user && context.user.role) || null;
    if (role === 'admin') {
      const settings = await env.DB
        .prepare(`SELECT birthstones_json, birthstones_translations_json FROM personalizer_settings WHERE id = 1`)
        .first()
        .catch(() => null);
      let library = [];
      if (settings?.birthstones_json) {
        try {
          const parsed = JSON.parse(settings.birthstones_json);
          if (Array.isArray(parsed)) library = parsed;
        } catch { /* ignore */ }
      }
      const sourceLabels = [];
      for (let i = 1; i <= 12; i++) {
        const entry = library.find((b) => b && Number(b.month_index) === i);
        sourceLabels.push((entry && typeof entry.label === 'string' && entry.label) || `Month ${i}`);
      }
      let bsTranslations = {};
      if (settings?.birthstones_translations_json) {
        try {
          const parsed = JSON.parse(settings.birthstones_translations_json);
          if (parsed && typeof parsed === 'object') bsTranslations = parsed;
        } catch { /* ignore */ }
      }
      summary.birthstones = {};
      await Promise.all(requestedLocales.map(async (locale) => {
        if (mode === 'missing' && Array.isArray(bsTranslations[locale]) && bsTranslations[locale].length === 12) {
          summary.birthstones[locale] = { skipped: true };
          return;
        }
        const arr = await translateBirthstoneLabels(env, sourceLabels, locale);
        if (arr) {
          bsTranslations[locale] = arr;
          summary.birthstones[locale] = { translated: arr.filter(Boolean).length };
        }
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
    }
  }

  return json(summary);
}
