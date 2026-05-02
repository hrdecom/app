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
 * P26-19 — escape user/admin strings before injecting them into HTML
 * (modal titles, button labels, hint text). Local helper so the widget
 * stays dependency-free.
 */
function rpEscapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c),
  );
}

/**
 * P26-21 — load the heic2any browser library on demand. HEIC/HEIF
 * files come straight off iPhones and Android phones with HEIC
 * support; Chrome desktop and most other browsers cannot decode
 * them natively, so the storefront's <img> tag fires onerror and
 * the cropper crashes. We dynamically inject heic2any only when a
 * HEIC file is detected, then convert it to a JPEG Blob for the
 * rest of the pipeline. Cached on window so repeated uploads in
 * the same session reuse one fetch.
 */
function loadHeic2any(): Promise<any> {
  const w = window as any;
  if (w.heic2any) return Promise.resolve(w.heic2any);
  if (w.__rpHeic2anyLoading) return w.__rpHeic2anyLoading;
  w.__rpHeic2anyLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => {
      if (w.heic2any) res(w.heic2any);
      else rej(new Error('heic2any did not register on window'));
    };
    s.onerror = () => rej(new Error('Failed to load heic2any from CDN'));
    document.head.appendChild(s);
  });
  return w.__rpHeic2anyLoading;
}

/**
 * P26-21 — return TRUE for HEIC/HEIF files. Detected by either MIME
 * (image/heic, image/heif) OR file extension because mobile browsers
 * sometimes hand HEIC over with an empty / generic MIME type.
 */
function isHeicFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  if (mime === 'image/heic' || mime === 'image/heif') return true;
  return /\.heic$|\.heif$/i.test(file.name || '');
}

/**
 * P26-21 — convert a HEIC File to a JPEG File. No-op for non-HEIC
 * inputs. Throws if the browser environment can't load heic2any
 * (e.g. CSP blocks the CDN); the caller catches and falls back to
 * uploading the original (which won't render in the cropper but at
 * least lands in R2).
 */
async function convertHeicIfNeeded(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;
  const heic2any = await loadHeic2any();
  const out = await heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: 0.92,
  });
  // heic2any returns Blob OR Blob[] (multi-page HEIC files give an
  // array of one frame per page; we only ever want the first).
  const jpegBlob = (Array.isArray(out) ? out[0] : out) as Blob;
  const newName = (file.name || 'photo').replace(/\.(heic|heif)$/i, '.jpg');
  return new File([jpegBlob], newName, { type: 'image/jpeg' });
}

/**
 * P26-19 / P26-21 — open an in-page modal that lets the customer
 * crop and zoom their uploaded photo to fit the field's mask shape.
 * Returns a JPEG Blob sized to the field's aspect ratio plus the
 * crop parameters used (so a follow-up "re-adjust" call can restore
 * the same view).
 *
 * Two display modes:
 *  1. **In-context preview** (P26-21 default when productImageUrl +
 *     fieldOnCanvas are provided): the modal shows the actual product
 *     photo as the background, zoomed in on the field area, with the
 *     customer's photo composited inside the field bounds (clipped to
 *     the mask shape). Drag/zoom anywhere on the stage pans/scales the
 *     PHOTO inside the field — what the customer sees is what they get.
 *  2. **Plain crop** (fallback when no product context is available):
 *     the photo fills a rectangular crop window of the output aspect.
 *
 * Design constraints:
 *  - Pure DOM/Canvas, no extra deps in the static bundle. heic2any is
 *    loaded on demand only when the customer picks a HEIC file.
 *  - Touch-first: drag with one finger, pinch-zoom with two, plus a
 *    slider + +/- buttons for desktop.
 *  - All cross-origin images use crossOrigin="anonymous" so canvas
 *    drawImage stays untainted (R2 proxy + Shopify CDN both send
 *    Access-Control-Allow-Origin:*).
 *  - "Cover" semantics: the photo always fills the field area. The
 *    minimum scale = max(fieldW/imgW, fieldH/imgH); slider/pinch
 *    work as a multiplier above that floor (1×..4×).
 *  - On save the modal renders the visible crop to an offscreen
 *    canvas at the requested output resolution and returns a JPEG
 *    blob. Output aspect matches outputWidth/outputHeight (= field
 *    aspect), so the storefront SVG renderer's preserveAspectRatio
 *    "xMidYMid slice" is a no-op on the cropped image.
 */
async function openImageCropper(opts: {
  imageUrl: string;
  outputWidth: number;
  outputHeight: number;
  maskShape: 'rect' | 'circle' | 'heart';
  initial?: { offsetX: number; offsetY: number; scale: number } | null;
  // P26-21 — in-context preview inputs. Provide all three to enable
  // the WYSIWYG preview; omit any to fall back to the plain cropper.
  productImageUrl?: string | null;
  fieldOnCanvas?: { x: number; y: number; w: number; h: number } | null;
  canvasWidth?: number | null;
  canvasHeight?: number | null;
  title?: string;
  hint?: string;
  saveLabel?: string;
  cancelLabel?: string;
}): Promise<{
  blob: Blob;
  params: { offsetX: number; offsetY: number; scale: number };
} | null> {
  return new Promise((resolve) => {
    // Decide layout: in-context preview vs plain crop.
    const useContext = !!(
      opts.productImageUrl &&
      opts.fieldOnCanvas &&
      opts.canvasWidth &&
      opts.canvasHeight
    );

    // Stage size in CSS pixels — fits comfortably above the slider /
    // buttons on a phone (≤ 90vw, capped at 340px on the longer side).
    const stageMax = Math.min(340, window.innerWidth * 0.85);

    // Compute the field's display dims AND, in context mode, where on
    // the stage the field lands.
    let fieldDispW: number;
    let fieldDispH: number;
    let stageDispW: number;
    let stageDispH: number;
    let fieldDispLeft = 0;
    let fieldDispTop = 0;
    let imgDispLeft = 0;
    let imgDispTop = 0;
    let imgDispW = 0;
    let imgDispH = 0;

    if (useContext) {
      const fc = opts.fieldOnCanvas as { x: number; y: number; w: number; h: number };
      const cw = opts.canvasWidth as number;
      const ch = opts.canvasHeight as number;
      // Stage aspect = canvas aspect (so the product image isn't
      // distorted). Stage covers stageMax on its longer side.
      const stageAspect = cw / ch;
      if (stageAspect >= 1) {
        stageDispW = stageMax;
        stageDispH = Math.round(stageMax / stageAspect);
      } else {
        stageDispH = stageMax;
        stageDispW = Math.round(stageMax * stageAspect);
      }
      // Compute imageScale so the field area takes ~65% of the stage's
      // smaller dimension. Customer sees field + a generous border of
      // surrounding product context (the rest of the necklace).
      const targetFieldDisp = Math.min(stageDispW, stageDispH) * 0.65;
      const fieldLong = Math.max(fc.w, fc.h);
      const imgScale = targetFieldDisp / fieldLong;
      imgDispW = cw * imgScale;
      imgDispH = ch * imgScale;
      fieldDispW = fc.w * imgScale;
      fieldDispH = fc.h * imgScale;
      // Center the field area on the stage.
      const fieldCenterOnImg = { x: fc.x + fc.w / 2, y: fc.y + fc.h / 2 };
      imgDispLeft = stageDispW / 2 - fieldCenterOnImg.x * imgScale;
      imgDispTop = stageDispH / 2 - fieldCenterOnImg.y * imgScale;
      fieldDispLeft = imgDispLeft + fc.x * imgScale;
      fieldDispTop = imgDispTop + fc.y * imgScale;
    } else {
      // Plain crop: stage aspect = output aspect, no product image.
      const aspect = opts.outputWidth / opts.outputHeight;
      if (aspect >= 1) {
        stageDispW = stageMax;
        stageDispH = stageMax / aspect;
      } else {
        stageDispH = stageMax;
        stageDispW = stageMax * aspect;
      }
      fieldDispW = stageDispW;
      fieldDispH = stageDispH;
      fieldDispLeft = 0;
      fieldDispTop = 0;
    }

    const modal = document.createElement('div');
    modal.className = 'rp-pz-crop-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    // P26-21 — body of the modal differs by mode:
    //   in-context: stage holds <img product> + <div field-clip><img photo></div>
    //   plain     : stage holds <img photo> + <div mask-overlay>
    const stageBody = useContext
      ? `
        <img class="rp-pz-crop-bg" alt="" draggable="false" />
        <div class="rp-pz-crop-frame rp-pz-crop-frame--${opts.maskShape}"
             style="left:${fieldDispLeft}px;top:${fieldDispTop}px;width:${fieldDispW}px;height:${fieldDispH}px;">
          <img class="rp-pz-crop-img" alt="" draggable="false" />
        </div>
        <div class="rp-pz-crop-frame-outline rp-pz-crop-frame--${opts.maskShape}"
             style="left:${fieldDispLeft}px;top:${fieldDispTop}px;width:${fieldDispW}px;height:${fieldDispH}px;">
        </div>
      `
      : `
        <img class="rp-pz-crop-img" alt="" draggable="false" />
        <div class="rp-pz-crop-mask rp-pz-crop-mask--${opts.maskShape}"></div>
      `;
    modal.innerHTML = `
      <div class="rp-pz-crop-card" role="document">
        <div class="rp-pz-crop-title">${rpEscapeHtml(opts.title || 'Adjust your photo')}</div>
        <div class="rp-pz-crop-hint">${rpEscapeHtml(opts.hint || 'Drag to position. Pinch or use the slider to zoom.')}</div>
        <div class="rp-pz-crop-stage" style="width:${stageDispW}px;height:${stageDispH}px;">
          ${stageBody}
        </div>
        <div class="rp-pz-crop-zoom">
          <button type="button" class="rp-pz-crop-zoom-btn" data-act="zoom-out" aria-label="Zoom out">&#8722;</button>
          <input type="range" class="rp-pz-crop-zoom-slider" min="1" max="4" step="0.01" value="1" aria-label="Zoom" />
          <button type="button" class="rp-pz-crop-zoom-btn" data-act="zoom-in" aria-label="Zoom in">+</button>
        </div>
        <div class="rp-pz-crop-actions">
          <button type="button" class="rp-pz-crop-btn rp-pz-crop-btn--cancel" data-act="cancel">${rpEscapeHtml(opts.cancelLabel || 'Cancel')}</button>
          <button type="button" class="rp-pz-crop-btn rp-pz-crop-btn--save" data-act="save">${rpEscapeHtml(opts.saveLabel || 'Use this photo')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const stage = modal.querySelector<HTMLDivElement>('.rp-pz-crop-stage')!;
    const imgEl = modal.querySelector<HTMLImageElement>('.rp-pz-crop-img')!;
    const bgEl = modal.querySelector<HTMLImageElement>('.rp-pz-crop-bg');
    const slider = modal.querySelector<HTMLInputElement>('.rp-pz-crop-zoom-slider')!;
    const cancelBtn = modal.querySelector<HTMLButtonElement>('[data-act="cancel"]')!;
    const saveBtn = modal.querySelector<HTMLButtonElement>('[data-act="save"]')!;
    const zoomOutBtn = modal.querySelector<HTMLButtonElement>('[data-act="zoom-out"]')!;
    const zoomInBtn = modal.querySelector<HTMLButtonElement>('[data-act="zoom-in"]')!;

    // Lock body scroll so background doesn't slide while dragging.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Position the product background image in the stage.
    if (useContext && bgEl) {
      bgEl.crossOrigin = 'anonymous';
      bgEl.style.left = imgDispLeft + 'px';
      bgEl.style.top = imgDispTop + 'px';
      bgEl.style.width = imgDispW + 'px';
      bgEl.style.height = imgDispH + 'px';
      bgEl.onerror = () => {
        // Product image failed to load (CORS, 404). Hide it but keep
        // the cropper functional with a neutral background.
        bgEl.style.display = 'none';
        stage.style.background = '#1f2937';
      };
      bgEl.src = opts.productImageUrl as string;
    }

    let imgNaturalW = 0;
    let imgNaturalH = 0;
    let scaleMin = 1;          // photo→display ratio at "cover" (= 1× on slider)
    let scale = 1;             // current photo→display ratio
    let offsetX = 0;           // top-left of photo in field-area coords
    let offsetY = 0;
    let resolved = false;

    function clampOffsets() {
      const dispW = imgNaturalW * scale;
      const dispH = imgNaturalH * scale;
      // photo must always cover the field area — top-left can never
      // go positive (would expose left/top edge), bottom-right can
      // never go below field bounds (would expose right/bottom edge).
      offsetX = Math.min(0, Math.max(fieldDispW - dispW, offsetX));
      offsetY = Math.min(0, Math.max(fieldDispH - dispH, offsetY));
    }
    function applyTransform() {
      imgEl.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    }
    function setZoomRatio(ratio: number) {
      const clamped = Math.max(1, Math.min(4, ratio));
      const newScale = scaleMin * clamped;
      // Keep the photo-pixel currently under the field center fixed
      // so zoom feels natural (CapCut/Instagram-style center-anchored).
      const cx = fieldDispW / 2;
      const cy = fieldDispH / 2;
      const imgCx = (cx - offsetX) / scale;
      const imgCy = (cy - offsetY) / scale;
      scale = newScale;
      offsetX = cx - imgCx * scale;
      offsetY = cy - imgCy * scale;
      clampOffsets();
      applyTransform();
      slider.value = String(clamped);
    }

    imgEl.crossOrigin = 'anonymous';
    imgEl.onload = () => {
      imgNaturalW = imgEl.naturalWidth || imgEl.width;
      imgNaturalH = imgEl.naturalHeight || imgEl.height;
      scaleMin = Math.max(fieldDispW / imgNaturalW, fieldDispH / imgNaturalH);
      // Restore prior crop on re-adjust, otherwise center+cover.
      if (opts.initial) {
        scale = scaleMin * Math.max(1, Math.min(4, opts.initial.scale || 1));
        offsetX = opts.initial.offsetX;
        offsetY = opts.initial.offsetY;
      } else {
        scale = scaleMin;
        offsetX = (fieldDispW - imgNaturalW * scale) / 2;
        offsetY = (fieldDispH - imgNaturalH * scale) / 2;
      }
      clampOffsets();
      applyTransform();
      slider.value = String(scale / scaleMin);
    };
    imgEl.onerror = () => {
      // Photo failed to load. Surface to caller as null so the upload
      // flow can fall back to using the URL as-is.
      cleanup();
      if (!resolved) { resolved = true; resolve(null); }
    };
    imgEl.src = opts.imageUrl;

    // ===== Pointer drag (works anywhere on the stage; pans the photo
    // inside the field area regardless of where the customer presses) =====
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let activePointerId: number | null = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      // Two fingers → pinch (handled by touch listeners). Suppress drag.
      if ((e as any).pointerType === 'touch') return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      activePointerId = e.pointerId;
      try { stage.setPointerCapture(e.pointerId); } catch { /* */ }
      e.preventDefault();
    });
    stage.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      offsetX += dx;
      offsetY += dy;
      clampOffsets();
      applyTransform();
    });
    function endDrag(e: PointerEvent) {
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      dragging = false;
      activePointerId = null;
      try { stage.releasePointerCapture(e.pointerId); } catch { /* */ }
    }
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    // ===== Wheel zoom (desktop) =====
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY / 400);
      setZoomRatio((scale / scaleMin) * factor);
    }, { passive: false });

    // ===== Slider + +/- buttons =====
    slider.addEventListener('input', () => {
      setZoomRatio(parseFloat(slider.value));
    });
    zoomInBtn.addEventListener('click', () => {
      setZoomRatio((scale / scaleMin) * 1.2);
    });
    zoomOutBtn.addEventListener('click', () => {
      setZoomRatio((scale / scaleMin) / 1.2);
    });

    // ===== Touch — single-finger pan + two-finger pinch. =====
    let pinchStartDist = 0;
    let pinchStartRatio = 1;
    let pinchStartImgPt = { x: 0, y: 0 };
    let pinchStartFieldPt = { x: 0, y: 0 };
    stage.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        dragging = true;
        lastX = t.clientX;
        lastY = t.clientY;
        e.preventDefault();
      } else if (e.touches.length === 2) {
        dragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchStartDist = Math.hypot(dx, dy);
        pinchStartRatio = scale / scaleMin;
        const rect = stage.getBoundingClientRect();
        // Pinch center in stage coords:
        const stageCx = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
        const stageCy = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
        // Convert to field-area coords (relative to field's top-left):
        pinchStartFieldPt = { x: stageCx - fieldDispLeft, y: stageCy - fieldDispTop };
        // Photo-pixel under that gesture center:
        pinchStartImgPt = {
          x: (pinchStartFieldPt.x - offsetX) / scale,
          y: (pinchStartFieldPt.y - offsetY) / scale,
        };
        e.preventDefault();
      }
    }, { passive: false });
    stage.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && dragging) {
        const t = e.touches[0];
        const dx = t.clientX - lastX;
        const dy = t.clientY - lastY;
        lastX = t.clientX;
        lastY = t.clientY;
        offsetX += dx;
        offsetY += dy;
        clampOffsets();
        applyTransform();
        e.preventDefault();
      } else if (e.touches.length === 2 && pinchStartDist > 0) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const newRatio = Math.max(1, Math.min(4, pinchStartRatio * (dist / pinchStartDist)));
        scale = scaleMin * newRatio;
        // Anchor the gesture center to the same image pixel.
        offsetX = pinchStartFieldPt.x - pinchStartImgPt.x * scale;
        offsetY = pinchStartFieldPt.y - pinchStartImgPt.y * scale;
        clampOffsets();
        applyTransform();
        slider.value = String(newRatio);
        e.preventDefault();
      }
    }, { passive: false });
    function endTouch() {
      pinchStartDist = 0;
      dragging = false;
    }
    stage.addEventListener('touchend', endTouch);
    stage.addEventListener('touchcancel', endTouch);

    // ===== Backdrop click + ESC cancel =====
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cleanup();
        if (!resolved) { resolved = true; resolve(null); }
      }
    });
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        cleanup();
        if (!resolved) { resolved = true; resolve(null); }
      }
    }
    document.addEventListener('keydown', onKeyDown);

    cancelBtn.addEventListener('click', () => {
      cleanup();
      if (!resolved) { resolved = true; resolve(null); }
    });
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      const prevText = saveBtn.textContent;
      saveBtn.textContent = 'Processing…';
      try {
        const blob = await renderCrop();
        const params = { offsetX, offsetY, scale: scale / scaleMin };
        cleanup();
        if (!resolved) { resolved = true; resolve({ blob, params }); }
      } catch {
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        saveBtn.textContent = prevText || (opts.saveLabel || 'Use this photo');
      }
    });

    function renderCrop(): Promise<Blob> {
      return new Promise((res, rej) => {
        const cv = document.createElement('canvas');
        cv.width = opts.outputWidth;
        cv.height = opts.outputHeight;
        const ctx = cv.getContext('2d');
        if (!ctx) return rej(new Error('No 2D context'));
        // Map field area → source photo rect.
        const srcX = -offsetX / scale;
        const srcY = -offsetY / scale;
        const srcW = fieldDispW / scale;
        const srcH = fieldDispH / scale;
        // White background as a defensive default for transparent
        // PNGs (a transparent JPEG can't exist — painting white avoids
        // accidental black pixels in lossy browsers).
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, opts.outputWidth, opts.outputHeight);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        try {
          ctx.drawImage(
            imgEl,
            srcX, srcY, srcW, srcH,
            0, 0, opts.outputWidth, opts.outputHeight,
          );
        } catch (err) {
          return rej(err);
        }
        cv.toBlob(
          (blob) => {
            if (!blob) return rej(new Error('toBlob returned null'));
            res(blob);
          },
          'image/jpeg',
          0.92,
        );
      });
    }

    function cleanup() {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeyDown);
      modal.remove();
    }
  });
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

/**
 * P26-10 — Google Fonts library. Mirrors the curated set the admin
 * dropdown offers so any field that picks one of these will render
 * with the right webfont on the storefront. Loaded via a single
 * stylesheet link so we benefit from Google's CDN cache. We only
 * inject the link once per page even with multiple personalizer
 * mounts. Lato is the default font for new fields; the rest cover
 * script (engraving), serif (luxury), and display (statement) needs.
 */
const GOOGLE_FONTS_FAMILIES = [
  'Lato', 'Inter', 'Montserrat', 'Poppins', 'Raleway', 'Nunito', 'Quicksand',
  'Work Sans', 'Open Sans', 'Source Sans 3',
  'Playfair Display', 'Cormorant Garamond', 'Cinzel', 'EB Garamond',
  'Libre Baskerville', 'Lora', 'Crimson Text', 'Merriweather',
  'Pinyon Script', 'Great Vibes', 'Allura', 'Dancing Script', 'Sacramento',
  'Parisienne', 'Tangerine', 'Pacifico', 'Satisfy', 'Yellowtail',
  'Bebas Neue', 'Oswald', 'Abril Fatface', 'Comfortaa',
];
function injectGoogleFontsLink(): void {
  if (document.getElementById('rp-google-fonts')) return;
  const families = GOOGLE_FONTS_FAMILIES
    .map((f) => 'family=' + encodeURIComponent(f).replace(/%20/g, '+'))
    .join('&');
  const link = document.createElement('link');
  link.id = 'rp-google-fonts';
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  document.head.appendChild(link);
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
  // P26-10 — load Google Fonts before mounting widgets so SVG text
  // hits the right webfont on first paint (display=swap means we
  // also degrade gracefully if the user is offline).
  injectGoogleFontsLink();
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

  // P26-19 — per-field crop state. We keep the ORIGINAL uncropped URL
  // separate from the cropped URL written into the cart so the
  // "Re-adjust crop" button can reopen the cropper with the same
  // source image AND restore the previous offset/scale. Cleared
  // whenever the customer picks a brand-new file.
  const cropState: Record<string, {
    originalUrl: string;
    filename: string;
    params: { offsetX: number; offsetY: number; scale: number };
  }> = {};

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

        /* P26-15 — upload affordance for image fields. Full-width
           rounded button with a soft dashed border (signals "drop /
           pick a file" without screaming). Subtle shadow on hover so
           it reads as clickable. Font-size is FIXED at 16px (also
           prevents iOS focus-zoom) regardless of the field's
           font_size_px (which is meant for the engraved text on the
           product, not the upload control). */
        .rp-pz-upload {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          /* P26-16 — gap reset; per-element margin gives tighter
             control over icon/text/check spacing than a single gap.
             "center" alignment vertically centers all children. */
          gap: 0;
          width: 100%;
          padding: 14px 18px;
          border: 1.5px dashed rgba(0,0,0,0.22);
          border-radius: 10px;
          background: rgba(0,0,0,0.02);
          font-family: inherit;
          font-size: 16px;
          font-weight: 500;
          color: inherit;
          text-align: center;
          cursor: pointer;
          transition: background-color .15s, border-color .15s, box-shadow .15s, transform .05s;
          box-sizing: border-box;
          line-height: 1.3;
          user-select: none;
        }
        .rp-pz-upload:hover {
          background: rgba(0,0,0,0.05);
          border-color: rgba(0,0,0,0.45);
          box-shadow: 0 1px 2px rgba(0,0,0,0.06);
        }
        .rp-pz-upload:active {
          transform: scale(0.99);
          background: rgba(0,0,0,0.07);
        }
        .rp-pz-upload-text {
          word-break: break-word;
          max-width: 100%;
        }
        .rp-pz-upload-icon {
          flex: 0 0 auto;
          opacity: 0.6;
          /* Nudge down 1 px so the SVG strokes line up with the
             text x-height instead of the cap-height (default flex
             centers the box, which leaves the icon visually high
             relative to the lowercase letters). */
          position: relative;
          top: 1px;
          margin-right: 8px;
        }
        .rp-pz-upload-check {
          flex: 0 0 auto;
          margin-left: 8px;
          position: relative;
          top: 1px;
        }

        /* P26-18 — TWO overlay layers, one BEHIND the product <img>
           and one in FRONT, so a customer photo placed at layer_z <
           base_image_layer_z shows through transparent regions of
           the PNG (heart-locket, ring window, etc). The product
           IMG itself gets z-index:1 (set inline in JS) to sit
           between them. */
        .rp-pz-overlay { position: absolute; inset: 0; pointer-events: none; transition: opacity .15s; }
        .rp-pz-overlay--below { z-index: 0; }
        .rp-pz-overlay--above { z-index: 5; }
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

        /* P26-19 — re-adjust crop button. Slim secondary control under
           the upload affordance, only revealed once a photo has been
           uploaded. Kept text-only / underlined so it never competes
           visually with the primary "Upload your photo" button. */
        .rp-pz-recrop {
          display: none;
          background: none;
          border: 0;
          padding: 6px 0 0;
          margin: 0;
          font-family: inherit;
          font-size: 13px;
          color: inherit;
          opacity: 0.65;
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .rp-pz-recrop:hover { opacity: 1; }
        .rp-pz-recrop[data-visible="1"] { display: inline-flex; align-items: center; gap: 4px; }
        .rp-pz-recrop svg { width: 12px; height: 12px; }
      </style>

      <!-- P26-19 — crop modal styles live OUTSIDE .rp-pz so they apply
           when the modal is portaled to <body> (so it sits above any
           theme overlays). They are scoped under .rp-pz-crop-* classes
           to avoid leaking into the host theme. -->
      <style data-rp-crop-modal-styles>
        .rp-pz-crop-modal {
          position: fixed;
          inset: 0;
          z-index: 999999;
          background: rgba(15, 15, 15, 0.78);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          animation: rp-crop-fade .15s ease-out;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          color: #111;
          box-sizing: border-box;
        }
        @keyframes rp-crop-fade { from { opacity: 0; } to { opacity: 1; } }
        .rp-pz-crop-card {
          background: #fff;
          border-radius: 14px;
          padding: 20px;
          width: 100%;
          max-width: 380px;
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .rp-pz-crop-title {
          font-size: 16px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: #111;
          text-align: center;
        }
        .rp-pz-crop-hint {
          font-size: 12px;
          color: #6b7280;
          text-align: center;
          line-height: 1.4;
          max-width: 320px;
        }
        .rp-pz-crop-stage {
          position: relative;
          background: #f3f4f6;
          border-radius: 10px;
          overflow: hidden;
          touch-action: none;        /* swallow pinch/pan from theme */
          cursor: grab;
          user-select: none;
          -webkit-user-select: none;
        }
        .rp-pz-crop-stage:active { cursor: grabbing; }
        /* P26-21 — product image as in-context background. Position
           and size are set inline by the JS so the field area lands
           centered inside the stage. */
        .rp-pz-crop-bg {
          position: absolute;
          left: 0;
          top: 0;
          max-width: none;
          pointer-events: none;
          -webkit-user-drag: none;
          user-select: none;
        }
        /* P26-21 — frame: clipping container for the customer photo.
           Positioned and sized inline by the JS to cover exactly the
           field area on the stage. Mask shape (rect / circle / heart)
           is applied via the modifier class. */
        .rp-pz-crop-frame {
          position: absolute;
          overflow: hidden;
          background: rgba(0, 0, 0, 0.04);
          pointer-events: none;
        }
        .rp-pz-crop-frame--circle { border-radius: 50%; }
        /* P26-21 — outline overlay: paints a soft 2px white border
           around the field area (and a dim 4px shadow outside) so
           the customer can clearly see the boundary even when the
           photo blends into the necklace. Sibling of frame so the
           border is not clipped by overflow:hidden. */
        .rp-pz-crop-frame-outline {
          position: absolute;
          pointer-events: none;
          box-shadow:
            inset 0 0 0 2px rgba(255, 255, 255, 0.92),
            0 0 0 4px rgba(0, 0, 0, 0.18);
          border-radius: inherit;
        }
        .rp-pz-crop-frame-outline.rp-pz-crop-frame--circle {
          border-radius: 50%;
        }
        .rp-pz-crop-img {
          position: absolute;
          left: 0;
          top: 0;
          transform-origin: 0 0;     /* JS math assumes top-left origin */
          max-width: none;            /* defeat theme img { max-width: 100% } */
          will-change: transform;
          pointer-events: none;       /* let the stage receive all events */
          -webkit-user-drag: none;
        }
        /* P26-19 — plain-mode mask (used only when no product context
           is available). Outlines the cropped region without dimming
           the visible photo. */
        .rp-pz-crop-mask {
          position: absolute;
          inset: 0;
          pointer-events: none;
          box-shadow:
            inset 0 0 0 2px rgba(255, 255, 255, 0.92),
            inset 0 0 0 9999px rgba(0, 0, 0, 0.28);
        }
        .rp-pz-crop-mask--circle {
          box-shadow: none;
        }
        .rp-pz-crop-mask--circle::before {
          content: '';
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.55);
          -webkit-mask-image: radial-gradient(circle at center, transparent 49.5%, black 50%);
                  mask-image: radial-gradient(circle at center, transparent 49.5%, black 50%);
        }
        .rp-pz-crop-mask--circle::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 50%;
          box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.92);
        }
        .rp-pz-crop-zoom {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 0 4px;
          box-sizing: border-box;
        }
        .rp-pz-crop-zoom-slider {
          flex: 1;
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          background: #e5e7eb;
          border-radius: 4px;
          outline: none;
          margin: 0;
        }
        .rp-pz-crop-zoom-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          background: #111;
          border-radius: 50%;
          cursor: pointer;
          border: 2px solid #fff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        }
        .rp-pz-crop-zoom-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          background: #111;
          border-radius: 50%;
          cursor: pointer;
          border: 2px solid #fff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        }
        .rp-pz-crop-zoom-btn {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 1px solid #d1d5db;
          background: #fff;
          color: #111;
          font-size: 16px;
          font-weight: 600;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          flex-shrink: 0;
          transition: background-color .12s, border-color .12s;
        }
        .rp-pz-crop-zoom-btn:hover { background: #f3f4f6; border-color: #9ca3af; }
        .rp-pz-crop-actions {
          display: flex;
          gap: 8px;
          width: 100%;
          margin-top: 4px;
        }
        .rp-pz-crop-btn {
          flex: 1;
          padding: 11px 14px;
          border-radius: 9px;
          font-family: inherit;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid transparent;
          transition: background-color .12s, border-color .12s, opacity .12s;
        }
        .rp-pz-crop-btn:disabled { opacity: 0.6; cursor: progress; }
        .rp-pz-crop-btn--cancel {
          background: #fff;
          color: #111;
          border-color: #d1d5db;
        }
        .rp-pz-crop-btn--cancel:hover { background: #f3f4f6; }
        .rp-pz-crop-btn--save {
          background: #111;
          color: #fff;
        }
        .rp-pz-crop-btn--save:hover { background: #000; }
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
  // P25-V6.4 — read productHandle from DOM, not closure. V6.3 passed
  // it explicitly but Vite's minifier hoisted the input arrow out of
  // mount and the captured `y` resolved to the init function instead
  // of mount's productHandle. Verified live: V was called but s(t)
  // returned null because t was the init function, not the handle
  // string. Reading from `[data-product-handle]` defeats every
  // closure-shadowing class of bug because there's no closure to lose.
  function ensureVariantImageVisible(_unused?: string) {
    const handle =
      document.querySelector<HTMLElement>('#rp-personalizer, [data-rp-personalizer]')
        ?.getAttribute('data-product-handle') || '';
    if (!handle) return;
    if (isVariantSlideActive(handle)) return;
    const mediaId = getActiveVariantMediaId(handle);
    if (!mediaId) return;
    // P25-V6.5 — Iterate selectors INDIVIDUALLY in priority order.
    // V6.4's comma-joined querySelector returned the first match in
    // DOCUMENT order (the parent <li>) instead of the BUTTON we
    // wanted, because the <li> comes before its children in the tree.
    // Dawn's slider click handler is on the <button>; clicking the
    // <li> is a no-op. Loop guarantees we hit the button first.
    const selectors = [
      `[data-target$="-${mediaId}"] button`,
      `[data-thumbnail-id="${mediaId}"] button`,
      `[data-image-id="${mediaId}"] button`,
      `button[data-id="${mediaId}"]`,
      `[data-target$="-${mediaId}"]`,
      `[data-thumbnail-id="${mediaId}"]`,
      `[data-image-id="${mediaId}"]`,
    ];
    let thumb: HTMLElement | null = null;
    for (const sel of selectors) {
      thumb = document.querySelector<HTMLElement>(sel);
      if (thumb) break;
    }
    if (!thumb) return;
    // P25-V6.2 — Dawn's slider-component listens for pointerdown +
    // pointerup (not just click). A bare `.click()` synthetic event
    // dispatches `click` only and Dawn's handler ignores it. Fire
    // the full pointer/mouse sequence a real tap produces so Dawn's
    // PointerEvent listeners react. `bubbles:true` is required to
    // reach delegated listeners higher up in the DOM.
    try {
      const opts = { bubbles: true, cancelable: true, composed: true } as EventInit;
      try { thumb.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch { /* */ }
      try { thumb.dispatchEvent(new MouseEvent('mousedown', opts)); } catch { /* */ }
      try { thumb.dispatchEvent(new PointerEvent('pointerup', opts)); } catch { /* */ }
      try { thumb.dispatchEvent(new MouseEvent('mouseup', opts)); } catch { /* */ }
      try { thumb.click(); } catch { /* */ }
      // Belt-and-suspenders: also click the parent <li> in case the
      // listener delegates from there.
      const li = thumb.closest('li');
      if (li && li !== thumb) {
        try { li.dispatchEvent(new MouseEvent('click', opts)); } catch { /* */ }
      }
    } catch { /* never break input */ }
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
    // findProductImage() picks up the new IMG and we'd append fresh
    // overlays to its parent — leaving the OLD overlays stranded on
    // the previous slide's parent. Result: stale overlays accumulating
    // on every gallery navigation. Sweep them up here so EXACTLY one
    // pair (below + above) exists at any time, attached to whatever
    // the visible active slide is. Idempotent — no-op once we're in
    // steady state.
    document.querySelectorAll('[data-rp-overlay]').forEach((o) => {
      if (o.parentElement && o.parentElement !== parent) o.remove();
    });
    // P26-18 — clean up legacy single-overlay nodes (data-rp-overlay="")
    // shipped by older bundle versions. They have neither "below" nor
    // "above" as the attribute value and would otherwise sit on top of
    // the new pair, painting the full field set above the IMG and
    // hiding fields routed to the below-overlay.
    parent.querySelectorAll(':scope > [data-rp-overlay]').forEach((o) => {
      const v = o.getAttribute('data-rp-overlay');
      if (v !== 'below' && v !== 'above') o.remove();
    });
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    // P26-18 — sandwich the IMG between two overlay layers via z-index.
    // Without this, the product <img> stays in the static stacking flow
    // (z-index: auto) and the below-overlay (z-index: 0) still paints
    // ABOVE it. Setting position+z-index on the IMG creates a stacking
    // context at z=1, so z=0 is BEHIND and z=5 is IN FRONT.
    if (getComputedStyle(img).position === 'static') {
      img.style.position = 'relative';
    }
    if (!img.style.zIndex) img.style.zIndex = '1';
    // P26-18 — two overlays. "below" sits behind the IMG (z-index:0)
    // for fields with layer_z < base_image_layer_z; "above" sits in
    // front (z-index:5) for everything else. The below overlay gets
    // inserted at the start of the parent so DOM order also matches
    // paint order (defense in depth — z-index is the source of truth).
    let belowOverlay = parent.querySelector<HTMLDivElement>(':scope > [data-rp-overlay="below"]');
    if (!belowOverlay) {
      belowOverlay = document.createElement('div');
      belowOverlay.setAttribute('data-rp-overlay', 'below');
      belowOverlay.className = 'rp-pz-overlay rp-pz-overlay--below';
      parent.insertBefore(belowOverlay, parent.firstChild);
    }
    let aboveOverlay = parent.querySelector<HTMLDivElement>(':scope > [data-rp-overlay="above"]');
    if (!aboveOverlay) {
      aboveOverlay = document.createElement('div');
      aboveOverlay.setAttribute('data-rp-overlay', 'above');
      aboveOverlay.className = 'rp-pz-overlay rp-pz-overlay--above';
      parent.appendChild(aboveOverlay);
    }
    // P25-V6 — image-tied overlays. Texts only show when Dawn's active
    // gallery slide IS the variant's featured slide (compared by
    // media-id, not URL). Fails-open until /products/<handle>.js
    // lands so first paint isn't blank. The 500ms rerender loop +
    // variant watcher drive transitions; no extra event hooks needed.
    const overlayOpacity = isVariantSlideActive(productHandle) ? '1' : '0';
    belowOverlay.style.opacity = overlayOpacity;
    aboveOverlay.style.opacity = overlayOpacity;
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
    // P26-18 — split fields by layer_z relative to base_image_layer_z.
    // Below = renders behind the storefront <img> (only visible through
    // transparent regions of the PNG, e.g. inside a heart-locket
    // cutout). Above = renders on top of the <img> (the historical
    // default for engraved text and overlays). Mirrors the admin-side
    // renderer's `fz < baseZ` / `fz >= baseZ` split in
    // src/lib/personalizer-render.ts.
    const baseZ = template.base_image_layer_z ?? 5;
    const belowFields: StorefrontField[] = [];
    const aboveFields: StorefrontField[] = [];
    for (const f of visibleFields) {
      const fz = f.layer_z ?? 10;
      if (fz < baseZ) belowFields.push(f);
      else aboveFields.push(f);
    }
    // Render WITHOUT the base image in either overlay — the storefront's
    // <img> IS the base, sitting between the two SVG layers via the
    // z-index sandwich set up above. The renderer's own image-insertion
    // logic (renderPreviewSvg in personalizer-render.ts) is therefore a
    // no-op here because base_image_url is null.
    belowOverlay.innerHTML = renderPreviewSvg({
      template: { ...template, base_image_url: null },
      fields: belowFields,
      values: initialValues,
      currentColorValue: activeColorValue,
    });
    aboveOverlay.innerHTML = renderPreviewSvg({
      template: { ...template, base_image_url: null },
      fields: aboveFields,
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

    // P26-6 — Info hint is no longer a SEPARATE field type. Every
    // text/image field can carry an optional info_text that renders
    // as a small (i) tooltip next to the label. Legacy info-only
    // fields (is_info===1) still render as the icon-only block for
    // backward compat with templates the merchant already saved.
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
    // P26-6 — append a small (i) tooltip icon when info_text is set,
    // so the merchant can attach a hint to a normal input.
    if (f.info_text && f.info_text.trim()) {
      const infoBtn = document.createElement('button');
      infoBtn.type = 'button';
      infoBtn.className = 'rp-pz-info-icon';
      infoBtn.textContent = 'i';
      infoBtn.title = f.info_text;
      infoBtn.setAttribute('aria-label', f.info_text);
      infoBtn.style.marginLeft = '6px';
      labelEl.appendChild(infoBtn);
    }
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
        // P25-V6.3 — snap gallery back to the variant image so the
        // customer sees the live preview as they type. Pass handle
        // explicitly to defeat Vite minifier's closure-hoisting bug.
        ensureVariantImageVisible(productHandle);
        rerender();
      });
      wrap.appendChild(input);
      const count = document.createElement('div');
      count.className = 'rp-pz-count';
      count.textContent = `${(f.default_value || '').length} / ${f.max_chars || '∞'}`;
      wrap.appendChild(count);
      row.appendChild(wrap);
    } else if (f.field_kind === 'image') {
      // P26-15 — apple-style upload affordance: full-width
      // dashed-border button with centered label, click-anywhere opens
      // the file picker, filename appears once uploaded. The label
      // text inherits font_family / font_color from the field for
      // brand consistency, but font-size is FIXED at 16px (the
      // field's font_size_px is for the engraving render — using it
      // here would make a 60px headline button when the merchant
      // designed a big curved name).
      const dropZone = document.createElement('label');
      dropZone.className = 'rp-pz-upload';
      if (f.font_color) dropZone.style.color = f.font_color;
      if (f.font_family) dropZone.style.fontFamily = f.font_family;
      // Small upload icon so the button reads unmistakably as
      // "click to send a file" (the dashed border alone is too easy
      // to miss). Inline SVG = no extra request.
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('class', 'rp-pz-upload-icon');
      icon.setAttribute('width', '16');
      icon.setAttribute('height', '16');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '2');
      icon.setAttribute('stroke-linecap', 'round');
      icon.setAttribute('stroke-linejoin', 'round');
      icon.innerHTML = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>';
      dropZone.appendChild(icon);
      const dropText = document.createElement('span');
      dropText.className = 'rp-pz-upload-text';
      dropText.textContent = f.placeholder || 'Upload your photo';
      dropZone.appendChild(dropText);
      // P26-16 — minimalist green checkmark shown only AFTER a
      // successful upload, on the right side, vertically aligned
      // with the text. Pre-created here (display:none) so the
      // upload handler can just toggle visibility — no DOM thrashing
      // and no risk of duplicate icons after re-uploads.
      const checkIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      checkIcon.setAttribute('class', 'rp-pz-upload-check');
      checkIcon.setAttribute('width', '16');
      checkIcon.setAttribute('height', '16');
      checkIcon.setAttribute('viewBox', '0 0 24 24');
      checkIcon.setAttribute('fill', 'none');
      checkIcon.setAttribute('stroke', '#16a34a');
      checkIcon.setAttribute('stroke-width', '2.5');
      checkIcon.setAttribute('stroke-linecap', 'round');
      checkIcon.setAttribute('stroke-linejoin', 'round');
      checkIcon.innerHTML = '<polyline points="20 6 9 17 4 12"/>';
      checkIcon.style.display = 'none';
      dropZone.appendChild(checkIcon);

      const file = document.createElement('input');
      file.type = 'file';
      // P26-15 — accept the formats every modern phone / camera produces.
      // Wide net here because mobile share-sheets sometimes hand HEIC
      // over with a generic MIME; the server-side validator does the
      // strict check.
      file.accept = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
        'image/heic', 'image/heif', 'image/avif', 'image/bmp', 'image/tiff',
        '.jpg', '.jpeg', '.png', '.webp',
        '.heic', '.heif', '.avif', '.bmp', '.tif', '.tiff',
      ].join(',');
      file.style.display = 'none';
      // P26-19 — helpers shared between first-upload and re-adjust:
      //  - uploadBlob() POSTs to /api/personalizer/upload and returns
      //    the absolute R2 URL.
      //  - commitCartValue() updates initialValues + the per-row hidden
      //    input + the cart mirror so the storefront and the cart all
      //    see the latest URL.
      //  - computeOutputDims() picks an output resolution that matches
      //    the field's aspect ratio (so the SVG renderer's slice mode
      //    is a no-op) and is high enough for retina displays.
      const errEl = document.createElement('div');
      errEl.className = 'rp-pz-error';
      async function uploadBlob(blob: Blob, filename: string): Promise<string> {
        const fd = new FormData();
        fd.append('file', blob, filename);
        const r = await fetch(`${API_BASE}/api/personalizer/upload`, {
          method: 'POST',
          body: fd,
        });
        if (!r.ok) throw new Error('Upload HTTP ' + r.status);
        const j = (await r.json()) as { url: string };
        return j.url.startsWith('http') ? j.url : `${API_BASE}${j.url}`;
      }
      function commitCartValue(url: string) {
        initialValues[String(f.id)] = url;
        const propName = `properties[${cartName}]`;
        let hidden = row.querySelector<HTMLInputElement>(
          `input[type=hidden][name="${propName.replace(/"/g, '\\"')}"]`,
        );
        if (!hidden) {
          hidden = document.createElement('input');
          hidden.type = 'hidden';
          hidden.name = propName;
          row.appendChild(hidden);
        }
        hidden.value = url;
      }
      function computeOutputDims(): { w: number; h: number } {
        // Field design dims define the aspect ratio. The renderer
        // displays the image at <image width=f.width height=f.height>
        // inside a 1080-px design canvas, then scales down to the
        // storefront's product image width (typically ~600 css px),
        // then up by devicePixelRatio (~2-3 on phones). We aim for
        // ~4× the design dim, capped between 600 and 1800 px on the
        // longer side, so detail looks crisp on retina without
        // generating multi-megabyte JPEGs.
        const fw = Math.max(1, f.width || 1);
        const fh = Math.max(1, f.height || 1);
        const longer = Math.max(fw, fh);
        const targetLonger = Math.min(1800, Math.max(600, longer * 4));
        const k = targetLonger / longer;
        return { w: Math.round(fw * k), h: Math.round(fh * k) };
      }

      // P26-19 — Re-adjust button: only visible after a successful
      // upload, reopens the cropper with the original (uncropped) URL
      // and the last-saved offset/scale so the customer can fine-tune
      // without re-uploading.
      const recropBtn = document.createElement('button');
      recropBtn.type = 'button';
      recropBtn.className = 'rp-pz-recrop';
      // Crop / overlapping-rectangles icon — universally read as "frame
      // / crop", matching the apps customers already know.
      recropBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M6 2v14a2 2 0 0 0 2 2h14"/>' +
        '<path d="M2 6h14a2 2 0 0 1 2 2v14"/>' +
        '</svg>';
      const recropLabel = document.createElement('span');
      recropLabel.textContent = 'Re-adjust crop';
      recropBtn.appendChild(recropLabel);
      // P26-21 — read the currently-visible product image src so the
      // cropper can show an in-context WYSIWYG preview (the customer
      // sees their photo composited inside the necklace / locket as
      // they drag, not just the bare photo).
      function currentProductImageUrl(): string | null {
        const img = findProductImage();
        if (!img) return null;
        const src = img.currentSrc || img.src || '';
        // Shopify CDN serves CORS-enabled images, but bare /assets/
        // URLs sometimes 404 or lack CORS — we still try, the cropper
        // falls back gracefully if loading fails.
        return src || null;
      }
      function fieldRectForCropper(): { x: number; y: number; w: number; h: number } {
        // Use the per-variant override geometry if one applies, so the
        // preview matches the storefront render exactly.
        const eff = effectiveField(f).field;
        return {
          x: eff.position_x,
          y: eff.position_y,
          w: eff.width,
          h: eff.height,
        };
      }
      recropBtn.addEventListener('click', async () => {
        const state = cropState[String(f.id)];
        if (!state) return;
        const dims = computeOutputDims();
        const result = await openImageCropper({
          imageUrl: state.originalUrl,
          outputWidth: dims.w,
          outputHeight: dims.h,
          maskShape: (f.mask_shape as any) || 'rect',
          initial: state.params,
          productImageUrl: currentProductImageUrl(),
          fieldOnCanvas: fieldRectForCropper(),
          canvasWidth: template.canvas_width,
          canvasHeight: template.canvas_height,
          title: 'Adjust your photo',
          hint: 'Drag to position. Pinch or use the slider to zoom.',
          saveLabel: 'Use this photo',
          cancelLabel: 'Cancel',
        });
        if (!result) return;
        // Re-upload cropped version, swap the cart URL.
        if (errEl) errEl.textContent = '';
        const prevText = dropText.textContent || '';
        dropText.textContent = 'Saving…';
        try {
          const url = await uploadBlob(result.blob, state.filename);
          commitCartValue(url);
          cropState[String(f.id)].params = result.params;
          dropText.textContent = state.filename;
          checkIcon.style.display = 'inline-block';
          rerender();
          syncCartMirrorsRef();
        } catch (e: any) {
          dropText.textContent = prevText || state.filename;
          errEl.textContent = e?.message || 'Save failed';
        }
      });

      file.addEventListener('change', async () => {
        let f0 = file.files?.[0];
        if (!f0) return;
        const prevText = dropText.textContent || '';
        // Hide any prior success badge while a new upload is in flight.
        checkIcon.style.display = 'none';
        recropBtn.removeAttribute('data-visible');
        if (errEl) errEl.textContent = '';
        try {
          // P26-21 — Step 0: convert HEIC → JPEG client-side BEFORE
          // anything else. iPhones produce HEIC by default and most
          // non-Safari browsers can't decode HEIC, so the cropper
          // would crash on load and the renderer would show a broken
          // image. heic2any (loaded on demand from CDN) handles the
          // decode. Customer sees a brief "Converting…" message.
          if (isHeicFile(f0)) {
            dropText.textContent = 'Converting…';
            try {
              f0 = await convertHeicIfNeeded(f0);
            } catch (heicErr: any) {
              // If conversion fails (CSP blocks CDN, very large file
              // OOMs, …), fall through with the original file. The
              // upload will still land in R2 but the cropper will
              // skip the WYSIWYG preview.
              try { console.warn('[rp] HEIC conversion failed:', heicErr); } catch { /* */ }
            }
          }

          dropText.textContent = 'Uploading...';
          // Step 1 — upload the (possibly-converted) file. The cropper
          // needs a public URL it can load with crossOrigin to draw
          // onto a canvas, and we want the original kept on the
          // server so the customer can re-adjust later without
          // re-uploading.
          const originalUrl = await uploadBlob(f0, f0.name);

          // Step 2 — open the cropper. Output dims match field aspect.
          // P26-21 — pass the current product image + field bounds so
          // the cropper renders an in-context WYSIWYG preview (the
          // customer's photo composited inside the locket / window
          // as they adjust the crop).
          const dims = computeOutputDims();
          const result = await openImageCropper({
            imageUrl: originalUrl,
            outputWidth: dims.w,
            outputHeight: dims.h,
            maskShape: (f.mask_shape as any) || 'rect',
            productImageUrl: currentProductImageUrl(),
            fieldOnCanvas: fieldRectForCropper(),
            canvasWidth: template.canvas_width,
            canvasHeight: template.canvas_height,
            title: 'Adjust your photo',
            hint: 'Drag to position. Pinch or use the slider to zoom.',
            saveLabel: 'Use this photo',
            cancelLabel: 'Cancel',
          });

          // Step 3 — pick the URL that goes into the cart.
          //   • Save  → upload cropped JPEG, use that URL.
          //   • Cancel → fall back to the original URL (renderer will
          //              center-crop via preserveAspectRatio="slice"),
          //              and remember NO crop params so re-adjust
          //              starts fresh-centered.
          let finalUrl: string;
          let finalParams: { offsetX: number; offsetY: number; scale: number };
          if (result) {
            dropText.textContent = 'Saving…';
            finalUrl = await uploadBlob(result.blob, f0.name);
            finalParams = result.params;
          } else {
            finalUrl = originalUrl;
            finalParams = { offsetX: 0, offsetY: 0, scale: 1 };
          }

          // Step 4 — commit to initialValues + hidden input + record
          // crop state for the re-adjust button.
          commitCartValue(finalUrl);
          cropState[String(f.id)] = {
            originalUrl,
            filename: f0.name,
            params: finalParams,
          };
          // Show filename so the customer knows the upload landed.
          dropText.textContent = f0.name;
          // P26-16 — reveal the green check on success.
          checkIcon.style.display = 'inline-block';
          // P26-19 — reveal the re-adjust button.
          recropBtn.setAttribute('data-visible', '1');
          rerender();
          // Also sync cart mirrors immediately (file dispatched no
          // 'input' event on the personalizer wrapper, so the
          // delegated input listener wouldn't fire).
          syncCartMirrorsRef();
        } catch (e: any) {
          dropText.textContent = prevText || (f.placeholder || 'Upload your photo');
          if (errEl) errEl.textContent = e?.message || 'Upload failed';
        }
      });
      dropZone.appendChild(file);
      row.appendChild(dropZone);
      row.appendChild(recropBtn);
      row.appendChild(errEl);
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
