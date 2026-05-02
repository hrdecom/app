/**
 * P26-28 — Claude-powered translator for personalizer field strings.
 *
 * Why a dedicated helper instead of reusing /api/ads/translate:
 *  - The ads translator does ONE string per call. We need to translate
 *    a whole batch of UI labels per locale in a single call so Claude
 *    can keep tone consistent across them and we save tokens.
 *  - The ads use case is marketing copy (sales tone). Personalizer
 *    fields are UI controls (concise, neutral, e-commerce option
 *    style). The system prompt below is tuned for this.
 *  - The output shape is structured JSON keyed by the source string,
 *    so the caller can map translations back to fields without
 *    relying on order or fuzzy matching.
 */

/**
 * BCP-47 locale → display name + a short usage hint Claude uses to
 * pick the most natural commerce wording. Keep these in sync with
 * the merchant's published Shopify locales.
 */
export const SUPPORTED_LOCALES = {
  da: { name: 'Danish (da)', notes: 'Use natural Danish e-commerce wording. Use "Birthstone" → "Fødselssten".' },
  de: { name: 'German (de)', notes: 'Formal commerce tone (Sie). "Cart" → "Warenkorb". "Birthstone" → "Geburtsstein".' },
  es: { name: 'Spanish (es)', notes: 'Neutral Latin American + Iberian Spanish that reads naturally on jewellery e-commerce. "Cart" → "Carrito". "Birthstone" → "Piedra de nacimiento".' },
  fr: { name: 'French (fr)', notes: 'Tutoiement avoided; concise commerce wording. "Cart" → "Panier". "Birthstone" → "Pierre de naissance".' },
  it: { name: 'Italian (it)', notes: 'E-commerce tone, concise. "Cart" → "Carrello". "Birthstone" → "Pietra portafortuna" or "Pietra del mese di nascita".' },
  nl: { name: 'Dutch (nl)', notes: 'Standard Netherlands Dutch (not Belgian). "Cart" → "Winkelwagen". "Birthstone" → "Geboortesteen".' },
  pl: { name: 'Polish (pl)', notes: 'Concise e-commerce Polish. "Cart" → "Koszyk". "Birthstone" → "Kamień urodzeniowy".' },
  'pt-BR': { name: 'Portuguese — Brazil (pt-BR)', notes: 'Brazilian Portuguese, e-commerce tone. "Cart" → "Carrinho". "Birthstone" → "Pedra do mês".' },
  'pt-PT': { name: 'Portuguese — Portugal (pt-PT)', notes: 'European Portuguese, formal commerce tone. "Cart" → "Carrinho". "Birthstone" → "Pedra de nascimento".' },
};

/**
 * Translate a batch of source strings into one target locale.
 *
 *   strings = { customer_label_5: "Name 1", placeholder_5: "Type a name...", ... }
 *   await translateBatch(env, strings, 'es')
 *   → { customer_label_5: "Nombre 1", placeholder_5: "Escribe un nombre...", ... }
 *
 * The keys are opaque to Claude — we tell it to preserve them exactly
 * and only translate the values. Returns the same key set with
 * translated values. On API failure returns null so callers can
 * decide whether to fall back to source strings.
 */
export async function translateBatch(env, strings, locale) {
  const localeInfo = SUPPORTED_LOCALES[locale];
  if (!localeInfo) throw new Error(`Unsupported locale: ${locale}`);
  const entries = Object.entries(strings || {}).filter(
    ([, v]) => typeof v === 'string' && v.trim().length > 0,
  );
  if (entries.length === 0) return {};
  if (!env.ANTHROPIC_API_KEY) {
    // Local dev / unset key: return placeholder translations so the
    // UI flow stays testable. Clearly marked so the merchant doesn't
    // ship them by accident.
    const out = {};
    for (const [k, v] of entries) out[k] = `[${locale}] ${v}`;
    return out;
  }

  const sourceJson = JSON.stringify(Object.fromEntries(entries), null, 2);

  // System prompt tuned for personalizer / e-commerce option labels.
  // A few non-negotiables baked in:
  //  - "translate VALUES, keep KEYS verbatim" prevents Claude from
  //    rewording the keys.
  //  - "natural commerce wording" + concrete glossary entries from
  //    SUPPORTED_LOCALES.notes give Claude a target register.
  //  - "preserve placeholder examples" prevents Claude from
  //    "improving" customer-facing example values like
  //    "Marie", "John" — those are illustrative, not real names to
  //    swap to a localized equivalent.
  //  - "concise — same length or shorter" matches UI constraints
  //    (input above the field in a narrow column).
  const system = [
    'You translate customer-facing strings for a jewelry e-commerce',
    'product personalizer (think Shopify variant pickers, cart line',
    'item properties, input placeholders, and birthstone month names).',
    '',
    'Hard constraints:',
    '  • Translate ONLY the JSON values. Keep every key verbatim.',
    '  • Output ONLY a JSON object — no preamble, no code fences, no',
    '    explanations. Same key set, translated values.',
    '  • Use natural e-commerce wording for the target locale, NOT a',
    '    literal word-for-word translation. Match the register a real',
    '    Shopify storefront would use.',
    '  • Keep translations concise — same length or shorter than the',
    '    English source whenever possible. These render in narrow UI',
    '    columns and Shopify cart line items.',
    '  • Preserve example names (Marie, Camille, John) — they are',
    '    illustrative. Do NOT swap them for locale-specific names.',
    '  • Preserve number formatting and emojis exactly.',
    '',
    `Target locale: ${localeInfo.name}`,
    `Locale notes: ${localeInfo.notes}`,
  ].join('\n');

  const userMessage =
    'Translate the values of this JSON object. Output the translated JSON object only.\n\n' +
    sourceJson;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[translate-personalizer] Claude HTTP', res.status, detail.slice(0, 200));
      return null;
    }
    const data = await res.json();
    const text = (data.content || []).find((c) => c.type === 'text')?.text || '';
    // Claude sometimes wraps the JSON in code fences despite the
    // instruction; strip them defensively.
    const stripped = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const parsed = JSON.parse(stripped);
    if (!parsed || typeof parsed !== 'object') return null;
    // Normalize: only keep keys we sent, coerce values to strings,
    // drop empty values so the caller treats them as "no translation"
    // (which falls back to source).
    const out = {};
    for (const [k] of entries) {
      const v = parsed[k];
      if (typeof v === 'string' && v.trim().length > 0) out[k] = v.trim();
    }
    return out;
  } catch (err) {
    console.error('[translate-personalizer] Claude call failed:', err && err.message);
    return null;
  }
}

/**
 * Batch translate the per-field strings of a template into ONE locale.
 *
 *   fields = [{ id, customer_label, cart_label, info_text, placeholder, field_kind }, ...]
 *   await translateTemplateFields(env, fields, 'es')
 *   → {
 *       fields: { 5: { customer_label: "Nombre 1", cart_label: "Nombre 1", info_text: null, placeholder: null }, ... },
 *       provider: 'claude' | 'fallback'
 *     }
 *
 * Internal: builds a single-shot dict (one key per field × translatable
 * column), calls translateBatch, then re-shapes back to a per-field
 * map. Placeholder is included only for image (Photo) fields per the
 * merchant's spec.
 */
export async function translateTemplateFields(env, fields, locale) {
  const dict = {};
  const fieldList = Array.isArray(fields) ? fields : [];
  for (const f of fieldList) {
    if (!f || !f.id) continue;
    const id = f.id;
    // P26-28 follow-up — ALWAYS translate a customer-facing label and
    // a cart label, even when the merchant left those columns null.
    // The widget falls back to f.label (the internal admin name)
    // when customer_label / cart_label are empty; without this we'd
    // ship the English admin name to non-English visitors. We
    // synthesize the source by preferring the explicit value, then
    // falling back to f.label so Claude has SOMETHING to translate.
    const customerSource =
      (typeof f.customer_label === 'string' && f.customer_label.trim()) ||
      (typeof f.label === 'string' && f.label.trim()) ||
      '';
    if (customerSource) {
      dict[`customer_label_${id}`] = customerSource;
    }
    const cartSource =
      (typeof f.cart_label === 'string' && f.cart_label.trim()) ||
      (typeof f.label === 'string' && f.label.trim()) ||
      '';
    if (cartSource) {
      dict[`cart_label_${id}`] = cartSource;
    }
    if (typeof f.info_text === 'string' && f.info_text.trim()) {
      dict[`info_text_${id}`] = f.info_text;
    }
    // Per merchant spec: placeholder translations only matter for
    // image (Photo) fields where it labels the upload affordance.
    // Text-field placeholders are user examples that should stay
    // in their original language so the customer recognizes the
    // intent (e.g. "Marie" stays "Marie" even on the Spanish site).
    if (
      f.field_kind === 'image' &&
      typeof f.placeholder === 'string' &&
      f.placeholder.trim()
    ) {
      dict[`placeholder_${id}`] = f.placeholder;
    }
  }
  if (Object.keys(dict).length === 0) {
    return { fields: {}, provider: 'noop' };
  }
  const translated = await translateBatch(env, dict, locale);
  if (!translated) return { fields: {}, provider: 'fallback' };
  const out = {};
  for (const f of fieldList) {
    if (!f || !f.id) continue;
    const id = f.id;
    const entry = {
      customer_label: translated[`customer_label_${id}`] || null,
      cart_label: translated[`cart_label_${id}`] || null,
      info_text: translated[`info_text_${id}`] || null,
      placeholder: translated[`placeholder_${id}`] || null,
    };
    // Skip fields with nothing translated to avoid storing empty rows.
    if (entry.customer_label || entry.cart_label || entry.info_text || entry.placeholder) {
      out[id] = entry;
    }
  }
  return { fields: out, provider: env.ANTHROPIC_API_KEY ? 'claude' : 'fallback' };
}

/**
 * Translate the 12 birthstone month labels into one locale.
 *
 *   labels = ["January", "February", ..., "December"]   (length 12)
 *   await translateBirthstoneLabels(env, labels, 'es')
 *   → ["Enero", "Febrero", ..., "Diciembre"]
 *
 * Returns null on Claude failure. Empty / missing input returns the
 * source array unchanged so the storefront keeps rendering English
 * if the merchant skipped translation.
 */
export async function translateBirthstoneLabels(env, labels, locale) {
  if (!Array.isArray(labels) || labels.length === 0) return labels || [];
  const dict = {};
  labels.forEach((label, i) => {
    if (typeof label === 'string' && label.trim()) {
      dict[`m${i + 1}`] = label;
    }
  });
  const translated = await translateBatch(env, dict, locale);
  if (!translated) return null;
  return labels.map((label, i) => translated[`m${i + 1}`] || label);
}
