import { renderPreviewSvg, type PreviewField, type PreviewTemplate } from './render';

/**
 * Auto-detect the CRM origin from this script's own <script src>.
 * The merchant pastes the snippet with a hardcoded src like
 * `https://jewelry-crm.pages.dev/storefront/personalizer.js`. We pull
 * the origin off that tag so the widget always talks to the same host
 * it was loaded from — no manual configuration needed.
 *
 * Override path (still supported): set `window.__RP_API_BASE__` before
 * the snippet's `<script>` tag if you want to point at a different
 * origin (staging, custom domain, etc.).
 */
function detectApiBase(): string {
  const w = window as any;
  if (w.__RP_API_BASE__) return String(w.__RP_API_BASE__).replace(/\/+$/, '');
  // Look for the most recently inserted script that references our
  // bundle filename. Works for `defer`, `async`, and inline scripts.
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[src*="/storefront/personalizer.js"]',
  );
  if (scripts.length > 0) {
    const src = scripts[scripts.length - 1].src;
    try {
      return new URL(src, document.baseURI).origin;
    } catch {
      /* fall through */
    }
  }
  // Last-resort default — should rarely hit.
  return 'https://jewelry-crm.pages.dev';
}

const API_BASE = detectApiBase();

/**
 * Rewrite relative API paths to absolute URLs against API_BASE.
 * The CRM stores image URLs as relative paths like `/api/images/r2/...`
 * because the admin UI runs on the same origin. The storefront runs on
 * a different origin (riccardiparis.com), so those paths must be
 * absolutified before they're used in <image href> tags.
 */
function absolutifyUrl(u: string | null | undefined): string {
  if (!u) return '';
  const s = String(u).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('/')) return `${API_BASE}${s}`;
  return `${API_BASE}/${s}`;
}

// Extended field shape that includes storefront-only metadata from the API
interface StorefrontField extends PreviewField {
  required?: boolean | number;
  placeholder?: string | null;
  max_chars?: number | null;
  /** P25-6 — used for the cart line item property name when set;
   * falls back to `label`. */
  cart_label?: string | null;
  /** P25-6 — JSON-encoded array of variant option values that show
   * this field. NULL/empty = always visible. The widget watches the
   * Shopify variant selector and toggles field visibility live. */
  visible_variant_options?: string | null;
  /** P25-V4 — customer-facing <label> text. Falls back to `label`. */
  customer_label?: string | null;
  /** P25-V4 — when 1, render a small (i) icon with `info_text` as a
   * tooltip instead of an input. Excluded from cart properties. */
  is_info?: number;
  info_text?: string | null;
}

/**
 * P25-6 — parse the visible_variant_options column. Returns null when
 * the field is always visible, or the array of allowed option values
 * (e.g. ["1","2","3"]) when restricted.
 */
function parseVisibleVariants(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.map((v) => String(v).trim()).filter(Boolean);
  } catch {
    /* fall through to comma-split */
  }
  if (typeof raw === 'string' && raw.includes(',')) {
    const arr = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return arr.length ? arr : null;
  }
  return null;
}

/**
 * P25-V4 — parse the font_color_by_value_json column on a field.
 * Returns an empty object on null/missing/malformed; values must
 * be strings.
 */
function parseFontColorMapWidget(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v) out[k] = v;
      }
      return out;
    }
  } catch {
    /* malformed — fall through */
  }
  return {};
}

/**
 * P25-6 — return TRUE if this field should be visible given the
 * customer's currently selected variant. We match by checking if ANY
 * of the variant's `option1/option2/option3` values appears in the
 * field's allow-list (case-insensitive). Match-any keeps the rule
 * simple: a "Pendant 2" field with allow-list ["2","3","4"] shows
 * whenever the variant has "2", "3", or "4" anywhere in its options.
 */
function fieldVisibleForVariant(allowed: string[] | null, variantOptions: string[]): boolean {
  if (!allowed) return true;
  const haystack = variantOptions.map((s) => s.toLowerCase());
  return allowed.some((needle) => haystack.includes(needle.toLowerCase()));
}

/**
 * Default color/material option names. Used when the API response
 * doesn't include `color_option_names`. Lowercase; comparisons must
 * be case-insensitive.
 */
const DEFAULT_COLOR_OPTION_NAMES = [
  'color',
  'couleur',
  'colour',
  'metal',
  'métal',
  'material',
  'matière',
];

/**
 * Read the currently-selected variant as ordered (name, value) pairs.
 * Order matters because the variant signature joins values in the
 * product's option order (option1 / option2 / option3).
 *
 * Strategy:
 *  1) Prefer theme JSON (window.ShopifyAnalytics.meta.product or
 *     window.product) — gives us the authoritative `options` array
 *     (the names) plus `option1/option2/option3` for the selected
 *     variant. Most reliable.
 *  2) Fall back to scanning <select name="options[Name]"> /
 *     <input type="radio" name="options[Name]" checked> — the
 *     bracket name IS the option name. Order = DOM order, which
 *     is usually the option order on Shopify themes.
 */
/**
 * P25-V5 — Shopify product data, cached. Many themes (Dawn included)
 * don't expose `window.product` or `window.ShopifyAnalytics.meta.product`,
 * so we fetch /products/<handle>.js as the canonical source. Cached on
 * window so multiple widget mounts on the same page share one fetch.
 */
function loadShopifyProduct(handle: string): Promise<any | null> {
  const w = window as any;
  if (!w.__rpShopifyProduct) w.__rpShopifyProduct = {};
  if (w.__rpShopifyProduct[handle]) return Promise.resolve(w.__rpShopifyProduct[handle]);
  if (!w.__rpShopifyProductLoading) w.__rpShopifyProductLoading = {};
  if (w.__rpShopifyProductLoading[handle]) return w.__rpShopifyProductLoading[handle];

  // P25-V5.2 — flatten the helper to avoid the async/await wrapper
  // that some IIFE/CSP setups choke on. Plain Promise chains. Also
  // fire-and-forget retry every 1500ms until the product is cached
  // OR the page tears down — guarantees the cache lands even if the
  // first fetch hits a transient 404.
  const promise: Promise<any | null> = fetch(`/products/${encodeURIComponent(handle)}.js`, {
    credentials: 'same-origin',
  })
    .then((res) => {
      if (!res.ok) throw new Error('product fetch ' + res.status);
      return res.json();
    })
    .then((p) => {
      w.__rpShopifyProduct[handle] = p;
      delete w.__rpShopifyProductLoading[handle];
      return p;
    })
    .catch((err) => {
      delete w.__rpShopifyProductLoading[handle];
      try { console.warn('[rp] /products/.js fetch failed:', err && err.message); } catch { /* */ }
      // Schedule a retry — the variant watcher poll will also try again.
      setTimeout(() => { if (!w.__rpShopifyProduct[handle]) loadShopifyProduct(handle); }, 1500);
      return null;
    });
  w.__rpShopifyProductLoading[handle] = promise;
  return promise;
}

/**
 * P25-V5 — return the currently-selected variant's featured_image. Falls
 * back through three sources: (1) window.product (legacy themes),
 * (2) ShopifyAnalytics, (3) the cached /products/<handle>.js fetch.
 * Source #3 is set asynchronously by `loadShopifyProduct` so the first
 * paint may miss it, but the 750ms variant-watcher poll picks it up
 * once the fetch lands.
 */
function getActiveVariantFeaturedImage(productHandle: string): { src: string; id: string | null } | null {
  try {
    const w = window as any;
    const product =
      (w.__rpShopifyProduct && w.__rpShopifyProduct[productHandle]) ||
      w.ShopifyAnalytics?.meta?.product ||
      w.product ||
      w.meta?.product ||
      null;
    if (!product || !Array.isArray(product.variants)) return null;

    // P25-V5.1 — variant ID lookup spans every Shopify cart-form pattern:
    //   • Dawn / Dawn-derived: <input type="hidden" name="id">
    //   • Legacy themes: <select name="id">
    //   • Theme-Analytics: ShopifyAnalytics.meta.selectedVariantId
    let variantId: string | null = null;
    const ana = w.ShopifyAnalytics?.meta?.selectedVariantId
      || w.ShopifyAnalytics?.meta?.product?.selectedVariantId;
    if (ana) variantId = String(ana);
    if (!variantId) {
      const inp = document.querySelector<HTMLInputElement>('input[name="id"]')
        || document.querySelector<HTMLSelectElement>('select[name="id"]');
      if (inp && inp.value) variantId = String(inp.value);
    }
    let v: any = null;
    if (variantId) v = product.variants.find((x: any) => String(x.id) === variantId);

    // Fallback: match by current option pairs (Color/Pendants/etc).
    // Works even when no <input name="id"> exists or before the theme
    // updates it.
    if (!v) {
      const pairs = readCurrentVariantOptionPairs();
      if (pairs.length > 0) {
        const optionNames: string[] = (product.options || []).map((o: any) =>
          typeof o === 'string' ? o : o?.name || '',
        );
        v = product.variants.find((x: any) =>
          optionNames.every((name, idx) => {
            const pair = pairs.find((p) => p.name.toLowerCase() === name.toLowerCase());
            const variantVal = [x.option1, x.option2, x.option3][idx];
            if (!pair) return true;
            return String(pair.value).toLowerCase() === String(variantVal || '').toLowerCase();
          }),
        );
      }
    }

    if (!v) v = product.variants[0];
    const fi = v?.featured_image;
    if (fi && (fi.src || typeof fi === 'string')) {
      const src = typeof fi === 'string' ? fi : String(fi.src || '');
      const id = (typeof fi === 'object' && fi.id) ? String(fi.id) : null;
      return src ? { src, id } : null;
    }
    if (Array.isArray(product.images) && product.images[0]) {
      return { src: String(product.images[0]), id: null };
    }
  } catch { /* defensive */ }
  return null;
}

/**
 * P25-V5 — normalize a Shopify image URL for comparison. Shopify
 * serves the same logical image at many URLs (different sizes,
 * widths, cdn domains, query versions). We strip the size suffix
 * (`_500x.jpg` → `.jpg`), query string, and protocol so a thumbnail
 * src and a hero src for the same image compare equal.
 */
function normalizeShopifyImageUrl(u: string | null | undefined): string {
  if (!u) return '';
  return String(u)
    .replace(/^https?:/, '')
    .replace(/\?.*$/, '')
    .replace(/_(?:pico|icon|thumb|small|compact|medium|large|grande|original|master|\d+x|\d+x\d+)\.([a-z]+)$/i, '.$1')
    .toLowerCase();
}

/**
 * P25-V5.7 — extract the FILENAME from a Shopify image URL. The
 * substring-include compare in V5.5 failed in production because
 * Shopify exposes the same image at two different URLs:
 *   • /products/<handle>.js returns `cdn.shopify.com/s/files/.../files/IMG.webp`
 *   • Dawn renders the storefront IMG with `<shop>.myshopify.com/cdn/shop/files/IMG.webp`
 * Different host AND different path. After normalize, neither
 * substring contained the other. Filenames ARE unique per image
 * upload, so comparing just the last path segment (after stripping
 * size suffixes) is reliable across CDN proxies.
 */
function imageFilename(u: string | null | undefined): string {
  const norm = normalizeShopifyImageUrl(u);
  if (!norm) return '';
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

/**
 * P25-V6 — return the active variant's featured_media.id from the
 * cached product. Returns null when the cache hasn't loaded or the
 * variant has no featured_media (rare). String type so it concatenates
 * cleanly into selectors.
 */
function getActiveVariantMediaId(productHandle: string): string | null {
  const w = window as any;
  const product = w.__rpShopifyProduct?.[productHandle];
  if (!product || !Array.isArray(product.variants)) return null;
  const variantId =
    document.querySelector<HTMLInputElement>('input[name="id"]')?.value ||
    document.querySelector<HTMLSelectElement>('select[name="id"]')?.value ||
    (w.ShopifyAnalytics?.meta?.selectedVariantId as string | undefined) ||
    null;
  if (!variantId) return null;
  const v = product.variants.find((x: any) => String(x.id) === String(variantId));
  const id = v?.featured_media?.id;
  return id ? String(id) : null;
}

/**
 * P25-V6 — TRUE when the visible (.is-active) gallery slide is the
 * variant's featured slide. Compares Dawn's `.product__media-item.is-active`
 * id suffix against the variant's `featured_media.id` (an integer
 * exposed by /products/<handle>.js). This sidesteps the V5.5–V5.7
 * URL-comparison bug where Shopify served the SAME image at two
 * different URLs (cdn.shopify.com vs <shop>/cdn/shop/) — IDs are
 * deterministic and don't get rewritten by CDN proxies.
 *
 * Fail-open in three cases so first paint never flashes blank:
 *   1) cache not loaded yet → true
 *   2) no `.is-active` slide (non-Dawn theme) → true
 *   3) variant has no featured_media id → true
 */
function isVariantSlideActive(productHandle: string): boolean {
  const wantId = getActiveVariantMediaId(productHandle);
  if (!wantId) return true;
  const active = document.querySelector<HTMLElement>('.product__media-item.is-active');
  if (!active) return true;
  const idSuffix = '-' + wantId;
  return (active.id || '').endsWith(idSuffix)
    || (active.getAttribute('data-media-id') || '').endsWith(idSuffix);
}

function readCurrentVariantOptionPairs(): Array<{ name: string; value: string }> {
  const pairs: Array<{ name: string; value: string }> = [];

  // 1) Theme JSON path.
  try {
    const w = window as any;
    const product =
      w.ShopifyAnalytics?.meta?.product ||
      w.product ||
      w.meta?.product ||
      null;
    const variantId =
      w.ShopifyAnalytics?.meta?.selectedVariantId ||
      w.ShopifyAnalytics?.meta?.product?.selectedVariantId ||
      null;
    if (product && Array.isArray(product.variants)) {
      // Resolve the selected variant: explicit selectedVariantId →
      // hidden <select name="id"> → first variant.
      let v: any = null;
      if (variantId) v = product.variants.find((x: any) => String(x.id) === String(variantId));
      if (!v) {
        const sel = document.querySelector<HTMLSelectElement>('select[name="id"]');
        if (sel && sel.value) v = product.variants.find((x: any) => String(x.id) === String(sel.value));
      }
      if (!v) v = product.variants[0];
      // `options` may be ["Pendant", "Color"] OR
      // [{ name: "Pendant", ... }, ...]. Normalize.
      const optionNames: string[] = Array.isArray(product.options)
        ? product.options.map((o: any) => (typeof o === 'string' ? o : o?.name || '')).filter(Boolean)
        : [];
      if (v && optionNames.length > 0) {
        const vals = [v.option1, v.option2, v.option3];
        for (let i = 0; i < optionNames.length; i++) {
          if (vals[i] != null && vals[i] !== '') {
            pairs.push({ name: String(optionNames[i]), value: String(vals[i]) });
          }
        }
        return pairs;
      }
    }
  } catch {
    /* fall through to DOM scan */
  }

  // 2) DOM scan path. Use a Map to dedupe by option name (last write
  // wins — radios + selects can both exist for the same option).
  const seen = new Map<string, string>();
  const order: string[] = [];
  function record(name: string, value: string) {
    if (!name || !value) return;
    if (!seen.has(name)) order.push(name);
    seen.set(name, value);
  }
  document.querySelectorAll<HTMLSelectElement>('select[name^="options["]').forEach((sel) => {
    const m = sel.name.match(/^options\[(.+?)\]$/);
    if (!m) return;
    const opt = sel.options[sel.selectedIndex];
    if (opt && opt.value) record(m[1], opt.value);
  });
  document.querySelectorAll<HTMLInputElement>('input[type="radio"][name^="options["]:checked').forEach((inp) => {
    const m = inp.name.match(/^options\[(.+?)\]$/);
    if (!m) return;
    if (inp.value) record(m[1], inp.value);
  });
  for (const name of order) pairs.push({ name, value: seen.get(name) || '' });
  return pairs;
}

/**
 * P25-V4 — read the customer's currently-selected COLOR option value.
 * Walks the same (name, value) pairs `readCurrentVariantSignature`
 * uses but KEEPS only color-named options (and returns the first
 * matching value). Empty string when no color option is selected (or
 * the product has no color option at all). Used by the per-color
 * font_color_by_value_json lookup.
 */
function readCurrentColorValue(colorOptionNames: string[]): string {
  const lowerColor = new Set(
    (colorOptionNames || []).map((s) => String(s).toLowerCase().trim()).filter(Boolean),
  );
  const pairs = readCurrentVariantOptionPairs();
  for (const p of pairs) {
    if (lowerColor.has(p.name.toLowerCase().trim())) return p.value;
  }
  return '';
}

/**
 * Compute the variant signature for per-variant overrides. The
 * signature is the slash-joined non-color option values, in the
 * product's original option order.
 *
 * Examples (with colorOptionNames = ["Color"]):
 *  - Style="2 Hearts", Color="Gold"             → "2 Hearts"
 *  - Style="2 Hearts", Size="M", Color="Gold"   → "2 Hearts / M"
 *  - Color="Gold" (only color)                  → ""
 *
 * Comparison is case-insensitive on the option NAME only — values
 * are preserved exactly as Shopify exposes them so they round-trip
 * with what the admin UI saved.
 */
function readCurrentVariantSignature(colorOptionNames: string[]): string {
  const lowerColor = new Set(
    (colorOptionNames || []).map((s) => String(s).toLowerCase().trim()).filter(Boolean),
  );
  const pairs = readCurrentVariantOptionPairs();
  const kept = pairs.filter((p) => !lowerColor.has(p.name.toLowerCase().trim()));
  if (kept.length === 0) return '';
  return kept.map((p) => p.value).join(' / ');
}

/**
 * P25-6 — read the currently-selected variant option values from
 * whatever variant selector the theme uses. We probe ALL the common
 * Shopify patterns and merge results, because a single page can have
 * the variant exposed in multiple places (a hidden master select +
 * visible radios, etc). Returns a flat list of option values like
 * ["1", "Gold", "Small"]. Case-preserving — fieldVisibleForVariant
 * does the case-insensitive compare.
 */
function readCurrentVariantOptions(): string[] {
  const values: string[] = [];

  // 1) Hidden master select: <select name="id"><option ... selected>1 / Gold</option></select>
  //    Option text is typically "opt1 / opt2 / opt3" — split on "/".
  document.querySelectorAll<HTMLSelectElement>('select[name="id"]').forEach((sel) => {
    const opt = sel.options[sel.selectedIndex];
    if (!opt) return;
    const text = (opt.textContent || '').split(/\s*[\/\-|]\s*/).map((s) => s.trim()).filter(Boolean);
    values.push(...text);
  });

  // 2) Per-option selects: <select name="options[Pendant]"><option value="1" selected>1</option></select>
  document.querySelectorAll<HTMLSelectElement>('select[name^="options["]').forEach((sel) => {
    const opt = sel.options[sel.selectedIndex];
    if (opt && opt.value) values.push(opt.value);
  });

  // 3) Checked radio inputs: <input type="radio" name="options[Pendant]" value="1" checked>
  document.querySelectorAll<HTMLInputElement>('input[type="radio"][name^="options["]:checked').forEach((inp) => {
    if (inp.value) values.push(inp.value);
  });

  // 4) Theme-provided JSON: window.ShopifyAnalytics or window.product.
  try {
    const w = window as any;
    const variantId =
      w.ShopifyAnalytics?.meta?.selectedVariantId ||
      w.ShopifyAnalytics?.meta?.product?.selectedVariantId ||
      null;
    const variants =
      w.ShopifyAnalytics?.meta?.product?.variants ||
      w.product?.variants ||
      w.meta?.product?.variants ||
      null;
    if (variantId && Array.isArray(variants)) {
      const v = variants.find((x: any) => String(x.id) === String(variantId));
      if (v) {
        if (v.option1) values.push(String(v.option1));
        if (v.option2) values.push(String(v.option2));
        if (v.option3) values.push(String(v.option3));
      }
    }
  } catch {
    /* defensive — themes are inconsistent */
  }

  return values;
}

/**
 * P25-6 — walk every `[data-rp-allowed-variants]` row and toggle
 * `style.display` based on the current variant selection. Idempotent
 * and cheap (typically <10 rows), so we can fire it from change
 * events AND on a polling interval as a safety net for themes that
 * don't dispatch standard events.
 */
function applyVariantVisibility() {
  const opts = readCurrentVariantOptions();
  document.querySelectorAll<HTMLElement>('[data-rp-allowed-variants]').forEach((row) => {
    const allowed: string[] | null = (row as any).__rpAllowedVariants ?? null;
    if (!allowed) return;
    const visible = fieldVisibleForVariant(allowed, opts);
    row.style.display = visible ? '' : 'none';
    // Disable inputs in hidden rows so they're not POSTed to /cart/add
    // — otherwise an empty "Pendant 2" property leaks into single-pendant
    // orders and clutters the line item.
    row.querySelectorAll<HTMLInputElement>('input,select,textarea').forEach((inp) => {
      inp.disabled = !visible;
    });
  });
}

/**
 * Per-mount handlers that need to fire on every variant change in
 * addition to the base visibility pass. A mount registers itself
 * here from `mount()` to handle:
 *   - signature recompute → re-render overlay (picks up new overrides)
 *   - storefront <img> swap when variant_image_overrides has a hit
 *   - per-variant hidden flags on cart inputs
 * The watcher iterates this list AFTER the base visibility pass so
 * overrides win over the P25-6 visible_variant_options filter when
 * both apply (we want the union of "hidden" reasons).
 */
const variantChangeHandlers: Array<() => void> = [];
function fireVariantChange() {
  applyVariantVisibility();
  for (const h of variantChangeHandlers) {
    try { h(); } catch { /* one bad mount shouldn't kill the rest */ }
  }
}

/**
 * P25-6 — install ONE document-wide listener for variant changes.
 * We listen on `change` (covers <select> and <input type=radio>) and
 * on the bubbling `variant:change` / `variantChange` events that
 * Dawn-derived themes dispatch. Idempotent: only installs once.
 */
let variantWatcherInstalled = false;
function installVariantWatcher() {
  if (variantWatcherInstalled) return;
  variantWatcherInstalled = true;
  const handler = () => {
    // RAF + microtask: themes often update window.ShopifyAnalytics
    // *after* the change event fires, so we wait one frame (RAF) and
    // then a microtask for good measure to read the fresh state.
    requestAnimationFrame(() => {
      Promise.resolve().then(fireVariantChange);
    });
  };
  document.addEventListener('change', (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const name = (t as HTMLInputElement).name || '';
    if (name === 'id' || name.startsWith('options[')) handler();
  }, true);
  document.addEventListener('variant:change', handler as EventListener);
  document.addEventListener('variantChange', handler as EventListener);
  // Polling safety net — covers themes that mutate the DOM without
  // firing any standard event. 750 ms is imperceptible to humans
  // but cheap on the main thread.
  setInterval(fireVariantChange, 750);
}

// Extended template shape that includes id + updated_at from the API
interface StorefrontTemplate extends PreviewTemplate {
  id?: number;
  updated_at?: string;
}

interface MountSpec {
  el: HTMLElement;
  productHandle: string;
  productId: string;
}

async function injectCustomFonts(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/personalizer/fonts/active`);
    if (!res.ok) return;
    const data: { items: Array<{ family_name: string; url: string; format: string; weight: number; style: string }> } =
      await res.json();
    if (!data.items || data.items.length === 0) return;
    const css = data.items
      .map(
        (f) =>
          `@font-face {\n` +
          `  font-family: "${f.family_name}";\n` +
          `  src: url("${API_BASE}${f.url}") format("${f.format}");\n` +
          `  font-weight: ${f.weight};\n` +
          `  font-style: ${f.style};\n` +
          `  font-display: swap;\n` +
          `}`,
      )
      .join('\n');
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-rp-fonts', '');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  } catch {
    /* non-fatal — fall through with system fonts */
  }
}

/**
 * P25-V5.2 — global watchdog: every 2s, find every personalizer mount
 * on the page and ensure its product handle is cached. Runs even when
 * the per-mount `mount()` async path errored out, so the cache is
 * guaranteed to land within a few seconds of page load. Idempotent.
 */
function startProductCacheWatchdog() {
  const w = window as any;
  if (w.__rpCacheWatchdog) return;
  w.__rpCacheWatchdog = true;
  const tick = () => {
    document.querySelectorAll<HTMLElement>('#rp-personalizer, [data-rp-personalizer]').forEach((el) => {
      const handle = el.getAttribute('data-product-handle');
      if (handle && !w.__rpShopifyProduct?.[handle]) {
        loadShopifyProduct(handle);
      }
    });
  };
  tick();
  setInterval(tick, 2000);
}

async function init() {
  // P25-V6 — version stamp so the merchant can verify in browser
  // console (Cmd+Opt+J → Console tab) which bundle is running. If
  // they see V5 or older, they're on a cached bundle — hard refresh
  // (Cmd+Shift+R / Ctrl+Shift+R) clears it.
  try { console.info('[rp-personalizer] V6 — slide-id matching'); } catch { /* */ }
  // Inject custom @font-face rules before mounting widgets so fonts are
  // available immediately for SVG text rendering.
  await injectCustomFonts();

  const mounts: MountSpec[] = [];
  document.querySelectorAll<HTMLElement>('#rp-personalizer, [data-rp-personalizer]').forEach((el) => {
    const productHandle = el.getAttribute('data-product-handle') || '';
    const productId = el.getAttribute('data-product-id') || '';
    if (!productHandle) return;
    mounts.push({ el, productHandle, productId });
  });
  await Promise.all(mounts.map(mount));
}

async function mount({ el, productHandle }: MountSpec) {
  // P25-V5 — fire-and-forget Shopify product fetch in parallel with our
  // template fetch. Many themes (Dawn included) don't expose
  // window.product, so we cache /products/<handle>.js to know each
  // variant's featured_image. Awaiting both is fine; the personalizer
  // template fetch is the slower of the two anyway.
  loadShopifyProduct(productHandle);
  let payload: any;
  try {
    const res = await fetch(`${API_BASE}/api/personalizer/template/${encodeURIComponent(productHandle)}`);
    if (!res.ok) return;
    payload = await res.json();
    if (!payload?.found) return;
  } catch { return; }

  // Absolutify the template's base image URL so the SVG <image> tag
  // resolves against the CRM origin instead of the Shopify storefront
  // (where /api/images/r2/... is a 404). Same treatment for any image
  // field default value that's a relative path.
  const template: StorefrontTemplate = {
    ...payload.template,
    base_image_url: absolutifyUrl(payload.template?.base_image_url),
  };
  const fields: StorefrontField[] = (payload.fields || []).map((f: any) =>
    f.field_kind === 'image' && f.default_value
      ? { ...f, default_value: absolutifyUrl(f.default_value) }
      : f,
  );

  // Per-variant override payloads. The backend already JSON-parses
  // these (see /api/personalizer/template/:handle), so they arrive
  // as plain objects/arrays — no JSON.parse here. Defaults keep the
  // widget functional against older API responses that pre-date
  // the multi-customization feature.
  const overrides: Record<string, Record<string, any>> =
    (payload.overrides && typeof payload.overrides === 'object') ? payload.overrides : {};
  const variantImageOverrides: Record<string, string> =
    (payload.variant_image_overrides && typeof payload.variant_image_overrides === 'object')
      ? payload.variant_image_overrides
      : {};
  const colorOptionNames: string[] = Array.isArray(payload.color_option_names)
    ? payload.color_option_names.map((s: any) => String(s))
    : DEFAULT_COLOR_OPTION_NAMES.slice();

  // Active signature — recomputed on every variant change. Drives
  // both the field-override merge and the storefront image swap.
  let activeSignature = readCurrentVariantSignature(colorOptionNames);
  // P25-V4 — current color value. Drives per-color text color overrides
  // (font_color_by_value_json). Recomputed on every variant change.
  let activeColorValue = readCurrentColorValue(colorOptionNames);
  // Original storefront <img src>, captured the first time we swap
  // it out. Restored when the active variant has no override so we
  // don't leave a stale custom image visible after the customer
  // toggles back to a default variant.
  let originalImageSrc: string | null = null;
  let originalImageEl: HTMLImageElement | null = null;

  const initialValues: Record<string, string> = {};
  for (const f of fields) initialValues[String(f.id)] = f.default_value || '';

  // P25-V2 — admin-controlled vertical padding. Falls back to 10px
  // each side if settings absent (older API responses).
  const padTop = Math.max(0, Number(payload?.settings?.widget_padding_top ?? 10));
  const padBot = Math.max(0, Number(payload?.settings?.widget_padding_bottom ?? 10));

  el.innerHTML = `
    <div class="rp-pz" style="padding-top:${padTop}px;padding-bottom:${padBot}px;">
      <style>
        /* P25-V5 — every value inherits the theme's native styles
           wherever possible (font-family, color, border, radius) so
           the personalizer rows feel like they belong to the variant
           picker. Inputs ship at 16px (iOS no-zoom threshold) but
           still inherit the theme font face. */
        .rp-pz { font-family: inherit; }
        .rp-pz-row { margin-bottom: 12px; }
        .rp-pz-row:last-child { margin-bottom: 0; }

        /* Label — copies Dawn's variant-picker label exactly:
             "Color"   → 13px / 400 / letter-spacing 0.4px / no transform
           but stays theme-agnostic via inherit so it matches whatever
           the merchant's CSS says about labels. */
        .rp-pz-row label {
          display:block;
          font-family: inherit;
          font-size: 13px;
          font-weight: 400;
          letter-spacing: 0.4px;
          text-transform: none;
          color: inherit;
          opacity: 0.85;
          margin-bottom: 6px;
        }

        /* Input wrapper — relative so we can absolutely-position the
           character counter inside the input on the right. */
        .rp-pz-input-wrap { position: relative; }
        .rp-pz-input-wrap .rp-pz-count {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          font-family: inherit;
          font-size: 11px;
          color: inherit;
          opacity: 0.55;
          pointer-events: none;
        }

        .rp-pz-row input[type=text] {
          width: 100%;
          padding: 12px 60px 12px 14px; /* room for inline counter */
          border: 1px solid rgba(0,0,0,0.18);
          border-radius: inherit; /* picks up theme radius from parent */
          font-family: inherit;
          font-size: 16px;
          line-height: 1.3;
          background: transparent;
          color: inherit;
          box-sizing: border-box;
          transition: border-color .15s;
        }
        .rp-pz-row input[type=text]:focus {
          outline: none;
          border-color: rgba(0,0,0,0.55);
        }
        .rp-pz-row input[type=file] { font-family: inherit; font-size: 14px; }
        .rp-pz-error { font-family: inherit; color: #c0392b; font-size: 12px; margin-top: 6px; }

        .rp-pz-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 5; transition: opacity .15s; }
        .rp-pz-overlay svg { width: 100%; height: 100%; display: block; }

        .rp-pz-info {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          background: rgba(0,0,0,0.04);
          border-radius: inherit;
          font-family: inherit;
          font-size: 13px;
          color: inherit;
        }
        .rp-pz-info-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #999;
          color: #fff;
          font-weight: bold;
          font-size: 12px;
          cursor: help;
        }
      </style>
      <div class="rp-pz-fields" data-fields></div>
    </div>
  `;

  const fieldsEl = el.querySelector<HTMLDivElement>('[data-fields]')!;

  /**
   * Find the storefront's main product image. Tries common Online
   * Store 2.0 selectors in priority order. The merchant can override
   * by adding a `data-rp-target-image` attribute on any element on
   * the page (or by setting `window.__RP_TARGET_IMAGE_SELECTOR`).
   *
   * Returns the IMG element that's currently visible on screen — for
   * themes with a slider/gallery, that's the active slide.
   */
  function findProductImage(): HTMLImageElement | null {
    const override = (window as any).__RP_TARGET_IMAGE_SELECTOR as string | undefined;
    const selectors: string[] = [
      ...(override ? [override] : []),
      '[data-rp-target-image] img',
      '[data-rp-target-image]',
      '.product__media-item.is-active img',
      '.product__media-item:not([hidden]) img',
      '.product__media img',
      '.product-single__photo img',
      '.product-image-main img',
      '[data-product-featured-image]',
      '.product-gallery__image',
      '.product-gallery img',
      '.product__photo img',
      'img[data-zoom-image]',
    ];
    for (const sel of selectors) {
      const candidates = document.querySelectorAll<HTMLImageElement>(sel);
      for (const img of Array.from(candidates)) {
        const tag = img.tagName?.toUpperCase();
        if (tag !== 'IMG') continue;
        // Visible-on-screen check: anything 0×0 or display:none is skipped.
        if (img.offsetWidth > 80 && img.offsetHeight > 80) return img;
      }
    }
    return null;
  }

  /**
   * P25-V6 — snap the gallery to the variant's featured slide when the
   * customer types in a personalizer input but the gallery is on a
   * non-variant image. Idempotent: returns early if already on the
   * right slide. Uses `button.click()` (not `scrollIntoView`) so:
   *   • document focus stays on the input → no iOS keyboard dismiss/zoom
   *   • Dawn's slider scrolls horizontally only → no page viewport jump
   */
  function ensureVariantImageVisible() {
    const onVariant = isVariantSlideActive(productHandle);
    const mediaId = getActiveVariantMediaId(productHandle);
    try { console.info('[rp-snap] called', { onVariant, mediaId, productHandle }); } catch { /* */ }
    if (onVariant) return;
    if (!mediaId) return;
    // Dawn / Online Store 2.0: thumbnails are <li data-target="...-${mediaId}">
    // wrapping a <button>. Click the button so Dawn runs its own
    // slide-to-media animation. Older themes use [data-thumbnail-id]
    // / [data-image-id] / button[data-id].
    const sel = [
      `[data-target$="-${mediaId}"] button`,
      `[data-target$="-${mediaId}"]`,
      `[data-thumbnail-id="${mediaId}"]`,
      `[data-image-id="${mediaId}"]`,
      `button[data-id="${mediaId}"]`,
    ].join(',');
    const thumb = document.querySelector<HTMLElement>(sel);
    if (thumb) {
      try { thumb.click(); } catch { /* never break input */ }
    }
  }

  /**
   * Mount (or update) the overlay SVG on top of the product image.
   * The SVG has the same viewBox as the personalizer's design canvas
   * (typically 1080×1080), so field positions stay correct when the
   * image is scaled by the storefront's responsive layout.
   *
   * Re-runnable: subsequent calls reuse the existing overlay element
   * if it's still on the page, or recreate it if the image was
   * swapped (e.g., gallery slide change).
   */
  function attachOrUpdateOverlay() {
    const img = findProductImage();
    if (!img) return; // No image found yet — try again on next rerender.
    const parent = img.parentElement;
    if (!parent) return;
    // P25-V5.6 — Dawn-class themes keep ALL slides in the DOM and just
    // mark one `is-active`. Each time the active slide changes,
    // findProductImage() picks up the new IMG and we'd append a fresh
    // overlay to its parent — leaving the OLD overlay stranded on the
    // previous slide's parent. Result: 2-3 stale overlays accumulating
    // on every gallery navigation. Sweep them up here so EXACTLY one
    // overlay exists at any time, attached to whatever the visible
    // active slide is. Idempotent — no-op once we're in steady state.
    document.querySelectorAll('[data-rp-overlay]').forEach((o) => {
      if (o.parentElement && o.parentElement !== parent) o.remove();
    });
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    let overlay = parent.querySelector<HTMLDivElement>(':scope > [data-rp-overlay]');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.setAttribute('data-rp-overlay', '');
      overlay.className = 'rp-pz-overlay';
      parent.appendChild(overlay);
    }
    // P25-V6 — image-tied overlay. Texts only show when Dawn's active
    // gallery slide IS the variant's featured slide (compared by
    // media-id, not URL). Fails-open until /products/<handle>.js
    // lands so first paint isn't blank. The 500ms rerender loop +
    // variant watcher drive transitions; no extra event hooks needed.
    overlay.style.opacity = isVariantSlideActive(productHandle) ? '1' : '0';
    // P25-6 — only paint fields whose row is currently visible. The
    // variant watcher toggles row.style.display; we mirror that into
    // the SVG so a hidden "Pendant 2" doesn't show on the preview
    // for a single-pendant variant. We also fold per-variant
    // overrides in here: position/size/rotation/curve come from the
    // override row when one matches the active signature, and
    // override.hidden=1 forces the field off regardless of whether
    // the P25-6 visible_variant_options filter would have shown it.
    const visibleFields: StorefrontField[] = [];
    for (const f of fields) {
      // P25-V4 — info-only fields are pure UI affordances; they have
      // no value to render in the SVG overlay (and no input to
      // collect from the customer). Skip them entirely here.
      if (Number(f.is_info || 0) === 1) continue;
      const eff = effectiveField(f);
      if (eff.hidden) continue;
      const row = fieldsEl.querySelector<HTMLElement>(`[data-rp-field-id="${f.id}"]`);
      if (row && row.style.display === 'none') continue;
      visibleFields.push(eff.field);
    }
    // Render WITHOUT the base image — the storefront's <img> is the
    // base. We just paint text + image-field overlays on top.
    overlay.innerHTML = renderPreviewSvg({
      template: { ...template, base_image_url: null },
      fields: visibleFields,
      values: initialValues,
      // P25-V4 — drives per-color font_color_by_value_json lookups
      // inside renderTextField. effectiveField() also pre-applies
      // the override, so this is mostly belt-and-suspenders for
      // any caller that bypasses effectiveField (none today).
      currentColorValue: activeColorValue,
    });
  }

  /**
   * Return the field as it should be rendered for the current
   * variant: base field merged with any override row matching
   * `activeSignature`. Also reports whether the override marks the
   * field hidden — callers use that to skip render and to disable
   * the cart input.
   *
   * Override fields recognized: position_x, position_y, width,
   * height, rotation_deg, curve_radius_px, hidden.
   */
  function effectiveField(f: StorefrontField): { field: StorefrontField; hidden: boolean } {
    const sig = activeSignature;
    const perField = overrides[String(f.id)];
    const ovr = perField && sig ? perField[sig] : null;
    let merged: StorefrontField = f;
    let hidden = false;
    if (ovr && typeof ovr === 'object') {
      merged = { ...f };
      const numericKeys = ['position_x', 'position_y', 'width', 'height', 'rotation_deg', 'curve_radius_px'] as const;
      for (const k of numericKeys) {
        const v = (ovr as any)[k];
        if (v != null && v !== '' && !Number.isNaN(Number(v))) (merged as any)[k] = Number(v);
      }
      hidden = Number(ovr.hidden || 0) === 1;
    }
    // P25-V4 — per-color text color override. Look up the customer's
    // currently-selected color value in font_color_by_value_json
    // (case-insensitive). When a key matches, swap font_color so the
    // SVG render picks it up. Falls back to the field's base
    // font_color when no map / no match / no current color.
    if (merged.font_color_by_value_json && activeColorValue) {
      const map = parseFontColorMapWidget(merged.font_color_by_value_json);
      const needle = activeColorValue.toLowerCase();
      for (const [k, v] of Object.entries(map)) {
        if (k.toLowerCase() === needle) {
          if (merged === f) merged = { ...f };
          merged.font_color = v;
          break;
        }
      }
    }
    return { field: merged, hidden };
  }

  /**
   * If the active variant has an entry in `variant_image_overrides`,
   * point the storefront's main <img> at that URL. Otherwise restore
   * the image we cached on first swap. We never write to <img> when
   * the URL is already correct, to avoid fighting Shopify's own
   * variant-image swap.
   */
  function applyImageOverride() {
    const img = findProductImage();
    if (!img) return;
    // First time we see an image, snapshot it so we can restore later.
    if (!originalImageEl) {
      originalImageEl = img;
      originalImageSrc = img.getAttribute('src');
    } else if (originalImageEl !== img) {
      // Theme swapped to a different IMG (e.g. gallery slide). Track
      // its source as the new "original" — that's what we'll restore
      // to when no override applies.
      originalImageEl = img;
      originalImageSrc = img.getAttribute('src');
    }
    const sig = activeSignature;
    const overrideUrl = sig ? variantImageOverrides[sig] : '';
    if (overrideUrl) {
      const abs = absolutifyUrl(overrideUrl);
      if (img.getAttribute('src') !== abs) {
        // Snapshot the current src as the restore target the first
        // time we swap — but only if the current src isn't already
        // one of our override URLs (could happen on hot reload).
        const isOurs = Object.values(variantImageOverrides).some(
          (u) => absolutifyUrl(u) === img.getAttribute('src'),
        );
        if (!isOurs && originalImageSrc == null) originalImageSrc = img.getAttribute('src');
        img.setAttribute('src', abs);
      }
    } else if (originalImageSrc != null) {
      // Restore — but only if the current src is one of our overrides.
      // If Shopify already swapped to its own variant image, leave it.
      const isOurs = Object.values(variantImageOverrides).some(
        (u) => absolutifyUrl(u) === img.getAttribute('src'),
      );
      if (isOurs && img.getAttribute('src') !== originalImageSrc) {
        img.setAttribute('src', originalImageSrc);
      }
    }
  }

  function rerender() {
    attachOrUpdateOverlay();
  }

  /**
   * Apply per-variant override-driven visibility to each field row.
   * Runs AFTER the global P25-6 `applyVariantVisibility()` pass so it
   * sees the post-P25-6 row.style.display state. Override.hidden=1
   * forces the row off; override.hidden=0 leaves the existing P25-6
   * decision alone (override doesn't un-hide). Cart mirror disabled
   * flag is updated in syncCartMirrors().
   */
  function applyOverrideVisibility() {
    for (const f of fields) {
      const { hidden } = effectiveField(f);
      const row = fieldsEl.querySelector<HTMLElement>(`[data-rp-field-id="${f.id}"]`);
      if (!row) continue;
      if (hidden) {
        row.style.display = 'none';
        row.querySelectorAll<HTMLInputElement>('input,select,textarea').forEach((inp) => {
          inp.disabled = true;
        });
      }
    }
  }

  /**
   * Variant-change handler installed into the global watcher. Order
   * matters: signature recompute → image swap → override visibility
   * → cart mirror sync → rerender. Cart mirrors and rerender run last
   * so they observe the latest visibility state.
   */
  function onVariantChange() {
    const newSig = readCurrentVariantSignature(colorOptionNames);
    const sigChanged = newSig !== activeSignature;
    activeSignature = newSig;
    activeColorValue = readCurrentColorValue(colorOptionNames);
    if (sigChanged) applyImageOverride();
    applyOverrideVisibility();
    syncCartMirrorsRef();
    rerender();
  }
  // Forward reference — syncCartMirrors is declared later in the
  // mount but onVariantChange needs to call it. We bind through a
  // mutable ref that gets filled in once syncCartMirrors exists.
  let syncCartMirrorsRef: () => void = () => { /* no-op until wired */ };
  variantChangeHandlers.push(onVariantChange);

  // Re-attach when the storefront swaps the visible image (gallery
  // navigation, theme JS replacing src, etc). Watching the document
  // for any IMG src/style changes is too broad — instead we re-detect
  // every 500 ms while the widget is alive. Cheap, robust, and themes
  // vary too widely to target a single mutation source.
  setInterval(() => {
    rerender();
  }, 500);

  // Also re-attach on resize so the overlay tracks the image's new
  // bounding box (the SVG itself is responsive but a swap from desktop
  // to mobile layout can move the image to a different parent).
  window.addEventListener('resize', () => rerender());

  for (const f of fields) {
    const row = document.createElement('div');
    row.className = 'rp-pz-row';
    row.setAttribute('data-rp-field-id', String(f.id));
    // P25-6 — tag every row with its allow-list so the variant
    // watcher can show/hide it without rebuilding the DOM.
    const allowed = parseVisibleVariants(f.visible_variant_options);
    if (allowed) row.setAttribute('data-rp-allowed-variants', allowed.join('|').toLowerCase());
    (row as any).__rpAllowedVariants = allowed;

    // P25-V4 — info-only fields short-circuit the input render path.
    // Visible: a small (i) icon with `info_text` as tooltip. Excluded
    // from the cart-property mirror so they NEVER POST to /cart/add.
    if (Number(f.is_info || 0) === 1) {
      const wrap = document.createElement('div');
      wrap.className = 'rp-pz-info';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rp-pz-info-icon';
      btn.textContent = 'i';
      btn.setAttribute('aria-label', f.info_text || 'Info');
      if (f.info_text) btn.setAttribute('title', f.info_text);
      const span = document.createElement('span');
      span.textContent = (f.customer_label && f.customer_label.trim()) || f.label;
      wrap.appendChild(btn);
      wrap.appendChild(span);
      row.appendChild(wrap);
      fieldsEl.appendChild(row);
      continue;
    }

    const labelEl = document.createElement('label');
    // P25-V4 — show customer-facing label when set, fall back to
    // internal `label`. The internal label is the admin's name
    // (used in the layer list); customer_label is what the
    // shopper actually reads.
    const visibleLabel = (f.customer_label && f.customer_label.trim()) || f.label;
    labelEl.textContent = visibleLabel + (f.required ? ' *' : '');
    row.appendChild(labelEl);

    // P25-6 — cart label override. Defaults to label when null/empty.
    const cartName = (f.cart_label && f.cart_label.trim()) || f.label;

    if (f.field_kind === 'text') {
      // P25-V5 — input + counter live inside a positioned wrapper so
      // the "5/12" sits inside the input on the right (matches the
      // common Shopify input affordance and saves vertical space).
      const wrap = document.createElement('div');
      wrap.className = 'rp-pz-input-wrap';
      const input = document.createElement('input');
      input.type = 'text';
      input.name = `properties[${cartName}]`;
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.default_value) input.value = f.default_value;
      if (f.max_chars) input.maxLength = f.max_chars;
      input.addEventListener('input', () => {
        initialValues[String(f.id)] = input.value;
        const count = wrap.querySelector<HTMLDivElement>('.rp-pz-count');
        if (count) count.textContent = `${input.value.length} / ${f.max_chars || '∞'}`;
        // P25-V5.6 — snap gallery back to the variant image so the
        // customer sees the live preview as they type. Idempotent /
        // cheap when already on the right image (early-return inside).
        ensureVariantImageVisible();
        rerender();
      });
      wrap.appendChild(input);
      const count = document.createElement('div');
      count.className = 'rp-pz-count';
      count.textContent = `${(f.default_value || '').length} / ${f.max_chars || '∞'}`;
      wrap.appendChild(count);
      row.appendChild(wrap);
    } else if (f.field_kind === 'image') {
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/jpeg,image/png,image/webp';
      file.addEventListener('change', async () => {
        const f0 = file.files?.[0];
        if (!f0) return;
        const fd = new FormData();
        fd.append('file', f0);
        const r = await fetch(`${API_BASE}/api/personalizer/upload`, { method: 'POST', body: fd });
        if (!r.ok) {
          const err = row.querySelector<HTMLDivElement>('.rp-pz-error');
          if (err) err.textContent = 'Upload failed';
          return;
        }
        const j: { url: string } = await r.json();
        const fullUrl = j.url.startsWith('http') ? j.url : `${API_BASE}${j.url}`;
        initialValues[String(f.id)] = fullUrl;
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = `properties[${cartName}]`;
        hidden.value = fullUrl;
        row.appendChild(hidden);
        rerender();
      });
      row.appendChild(file);
      const err = document.createElement('div');
      err.className = 'rp-pz-error';
      row.appendChild(err);
    }

    fieldsEl.appendChild(row);
  }

  // P25-6 — kick off the variant watcher and apply initial visibility.
  // Install is idempotent so multiple mounts on one page share one
  // listener. The first apply runs synchronously so the customer
  // never sees a "fields flicker in/out" on page load. We also run
  // the per-variant override pipeline once so the initial render
  // reflects the customer's currently-selected variant.
  installVariantWatcher();
  applyVariantVisibility();
  applyImageOverride();
  applyOverrideVisibility();

  // P25-V2 — find the cart form regardless of where the personalizer
  // mounted. We try el.closest first (mount inside the form), then
  // fall back to the page's first /cart/add form (mount outside).
  // External cart drawers and Shopify ajax both POST this form's
  // FormData, so any hidden input we put INSIDE it gets submitted as
  // a line-item property. That's what most cart apps render under
  // the line item title ("First name: Marie").
  const cartForm =
    (el.closest('form[action*="/cart/add"]') as HTMLFormElement | null) ||
    (document.querySelector('form[action*="/cart/add"]') as HTMLFormElement | null);

  // P25-V2 — per-field hidden mirror inside the cart form. The
  // visible input in the personalizer mount is the SOURCE OF TRUTH;
  // the hidden mirror is what gets POSTed to /cart/add. Synced on
  // every input so the cart always sees the latest value, even if
  // the visible input is outside the form.
  const cartMirrors: Record<string, HTMLInputElement> = {};
  function ensureCartMirror(name: string): HTMLInputElement | null {
    if (!cartForm) return null;
    if (cartMirrors[name]) return cartMirrors[name];
    let inp = cartForm.querySelector<HTMLInputElement>(
      `input[name="properties[${cssEscape(name)}]"][data-rp-mirror]`,
    );
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'hidden';
      inp.name = `properties[${name}]`;
      inp.setAttribute('data-rp-mirror', '1');
      cartForm.appendChild(inp);
    }
    cartMirrors[name] = inp;
    return inp;
  }
  function syncCartMirrors() {
    for (const f of fields) {
      // P25-V4 — info-only fields never make it into the cart. They
      // have no input + no value, and a "property" with no value
      // would just clutter the line item. Skip outright.
      if (Number(f.is_info || 0) === 1) continue;
      const cartName = (f.cart_label && f.cart_label.trim()) || f.label;
      const v = initialValues[String(f.id)] || '';
      const row = fieldsEl.querySelector<HTMLElement>(`[data-rp-field-id="${f.id}"]`);
      const visible = !row || row.style.display !== 'none';
      // effectiveHidden = P25-6 row hide OR per-variant override.hidden=1.
      // Both reasons disable the mirror so the property doesn't leak
      // into the cart line item.
      const overrideHidden = effectiveField(f).hidden;
      const mirror = ensureCartMirror(cartName);
      if (!mirror) continue;
      mirror.disabled = !visible || overrideHidden || !v;
      mirror.value = v;
    }
  }
  // Wire the forward reference so onVariantChange can call us.
  syncCartMirrorsRef = syncCartMirrors;

  // Wrap each text/file change to also sync the cart mirrors.
  // P25-V6 — `ensureMatchingImage` removed. It was V5.3-era scroll-based
  // snap that caused iOS viewport jumps and is fully replaced by
  // `ensureVariantImageVisible()` (media-id thumbnail click).

  fieldsEl.addEventListener('input', syncCartMirrors);
  fieldsEl.addEventListener('change', syncCartMirrors);
  // Initial pass for default values.
  syncCartMirrors();

  // Hidden metadata properties — useful for the warehouse to look up
  // the exact template snapshot the order was placed against.
  if (cartForm) {
    addHidden(cartForm, '_template_id', String(template.id || (template as any).template_id || payload.template?.id));
    addHidden(cartForm, '_template_updated_at', String(template.updated_at || ''));
    cartForm.addEventListener('submit', () => {
      // Final sync just before submit, in case the user typed and
      // hit Enter without an intervening blur.
      syncCartMirrors();
      let preview = '';
      for (const f of fields) {
        if (Number(f.is_info || 0) === 1) continue;
        const v = initialValues[String(f.id)];
        if (v && f.field_kind === 'text') {
          const previewLabel = (f.customer_label && f.customer_label.trim()) || f.label;
          preview += `${previewLabel}=${v} · `;
        }
      }
      addHidden(cartForm, '_spec_preview', preview.replace(/ · $/, ''));
    });
  }

  // P25-V2 — AJAX safety net for cart drawers that bypass the form
  // submit and POST to /cart/add.js directly via fetch. We patch
  // window.fetch ONCE; for any /cart/add request that lacks our
  // properties, we inject them. Idempotent thanks to the
  // __rpFetchPatched flag.
  installCartFetchPatch(() => {
    const props: Record<string, string> = {};
    for (const f of fields) {
      // P25-V4 — info-only fields are excluded from the AJAX cart
      // path too, mirroring the syncCartMirrors() exclusion above.
      if (Number(f.is_info || 0) === 1) continue;
      const cartName = (f.cart_label && f.cart_label.trim()) || f.label;
      const v = initialValues[String(f.id)] || '';
      const row = fieldsEl.querySelector<HTMLElement>(`[data-rp-field-id="${f.id}"]`);
      const visible = !row || row.style.display !== 'none';
      const overrideHidden = effectiveField(f).hidden;
      if (visible && !overrideHidden && v) props[cartName] = v;
    }
    return props;
  });

  rerender();
}

/**
 * P25-V2 — escape a string for use inside a CSS attribute selector.
 * Keeps `cartName` selectors safe when the merchant's label has
 * quotes, brackets, or other CSS-meaningful chars.
 */
function cssEscape(s: string): string {
  if (typeof (window as any).CSS?.escape === 'function') return (window as any).CSS.escape(s);
  return String(s).replace(/"/g, '\\"').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

/**
 * P25-V2 — monkey-patch window.fetch so any /cart/add or /cart/add.js
 * AJAX request automatically picks up the personalizer field values
 * as line-item properties. Covers external cart drawers (Slide Cart,
 * UFE, ReConvert, etc.) that intercept the cart form submit and
 * forward to Shopify via fetch — bypassing the form's hidden inputs
 * we wired above.
 *
 * The getProps() callback is captured per-mount, but the patch
 * itself only installs once (window.__rpFetchPatched flag).
 */
const cartPropsProviders: Array<() => Record<string, string>> = [];
function installCartFetchPatch(getProps: () => Record<string, string>) {
  cartPropsProviders.push(getProps);
  const w = window as any;
  if (w.__rpFetchPatched) return;
  w.__rpFetchPatched = true;
  const orig = w.fetch.bind(window);
  w.fetch = async function (input: any, init?: any) {
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (/\/cart\/add(?:\.js)?(?:\?|$)/i.test(url)) {
        const merged: Record<string, string> = {};
        for (const provider of cartPropsProviders) {
          const p = provider();
          for (const k of Object.keys(p)) merged[k] = p[k];
        }
        if (Object.keys(merged).length > 0) {
          init = injectCartProperties(init, merged);
        }
      }
    } catch {
      /* never break the underlying cart request */
    }
    return orig(input, init);
  };
}

/**
 * P25-V2 — merge personalizer properties into a /cart/add fetch
 * init object. Handles the three formats Shopify cart APIs accept:
 *   - JSON body { id, quantity, properties }
 *   - FormData with properties[...] keys
 *   - URLSearchParams with properties[...] keys
 * Existing properties are preserved; ours fill in only what's missing.
 */
function injectCartProperties(init: any, props: Record<string, string>): any {
  init = init ? { ...init } : {};
  const body = init.body;

  if (body instanceof FormData) {
    for (const k of Object.keys(props)) {
      const key = `properties[${k}]`;
      if (!body.has(key)) body.set(key, props[k]);
    }
    return init;
  }
  if (body instanceof URLSearchParams) {
    for (const k of Object.keys(props)) {
      const key = `properties[${k}]`;
      if (!body.has(key)) body.set(key, props[k]);
    }
    return init;
  }
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.items)) {
          parsed.items = parsed.items.map((it: any) => ({
            ...it,
            properties: { ...props, ...(it.properties || {}) },
          }));
        } else {
          parsed.properties = { ...props, ...(parsed.properties || {}) };
        }
        init.body = JSON.stringify(parsed);
        return init;
      }
    } catch {
      /* not JSON — give up gracefully */
    }
  }
  return init;
}

function addHidden(form: HTMLFormElement, name: string, value: string) {
  let el = form.querySelector<HTMLInputElement>(`input[name="properties[${name}]"]`);
  if (!el) {
    el = document.createElement('input');
    el.type = 'hidden';
    el.name = `properties[${name}]`;
    form.appendChild(el);
  }
  el.value = value;
}

// P25-V5.2 — start the cache watchdog IMMEDIATELY (not gated on init
// success) so the product cache lands even if init/mount errors out.
startProductCacheWatchdog();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
