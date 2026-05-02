import { requireRole, json, errorJson } from '../../lib/auth-middleware.js';

export async function onRequest(context) {
  const { request } = context;
  try {
    if (request.method === 'GET') return await handleGet(context);
    if (request.method === 'PATCH') return await handlePatch(context);
    return errorJson('Method not allowed', 405);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Settings API error:', e);
    return errorJson('Internal server error', 500);
  }
}

async function handleGet(context) {
  const row = await context.env.DB
    .prepare(`SELECT * FROM personalizer_settings WHERE id = 1`)
    .first();
  return json(row || { id: 1 });
}

async function handlePatch(context) {
  // P26-26 follow-up — admin-only for the birthstones library; the
  // rest stays open to integrator. We do the strict check first when
  // birthstones_json is present, then fall back to the looser check.
  const body = await context.request.json().catch(() => ({}));
  if ('birthstones_json' in body) {
    await requireRole(context, 'admin');
  } else {
    await requireRole(context, 'admin', 'integrator');
  }
  const allowed = [
    'default_font_family',
    'default_font_size_px',
    'default_font_color',
    'default_max_chars',
    // P25-V2 — admin-controlled storefront widget padding (px).
    'widget_padding_top',
    'widget_padding_bottom',
    // P25-V3 — JSON array of Shopify option names that count as "color"
    // and should be excluded from the variant_signature.
    'color_option_names_json',
    // P26-26 — global birthstones library (12 PNG icons shared by
    // every birthstone field on every product). Admin-only PATCH.
    'birthstones_json',
  ];
  const sets = [];
  const binds = [];
  for (const k of allowed) {
    if (k in body) { sets.push(`${k} = ?`); binds.push(body[k]); }
  }
  if (sets.length === 0) return errorJson('No editable fields supplied', 400);
  sets.push(`updated_at = datetime('now')`);
  await context.env.DB
    .prepare(`UPDATE personalizer_settings SET ${sets.join(', ')} WHERE id = 1`)
    .bind(...binds)
    .run();
  const row = await context.env.DB.prepare(`SELECT * FROM personalizer_settings WHERE id = 1`).first();
  return json(row);
}
