# Shopify Personalizer — Design Spec

**Date:** 2026-04-29
**Status:** Draft, awaiting review
**Owner:** Roger
**Related skills used:** `superpowers:brainstorming`, `frontend-design`

## 1. Problem

Riccardiparis sells personalized jewelry — necklaces, rings, bracelets, pendants — where the value of each item comes from the customer's own engraving (a name, a date, sometimes a photo). The current Shopify storefront has no customization layer: a customer can pick a variant (color, sometimes initial), but cannot type free text, see a live preview of how their name will look on the actual piece, or attach a photo. The Jewelry CRM behind the storefront already pushes products with up to 52 variants (26 initials × 2 colors), but that pre-baked variant model collapses under any input richer than a single letter.

We're building a **personalizer** — a customer-facing widget that lives on the Shopify product page and lets the buyer type freely, see a live rendering of their input on the product image, and proceed to checkout with the customization captured. Behind it sits an **admin template editor** in the existing CRM where Roger configures, per product, exactly how the customization works: where the text sits, what fonts are allowed, how many characters fit, whether text is curved (rings need circle-arc text, pendants stay linear), what the layer stack looks like, and how multiple fields combine for products that take more than one input.

## 2. Goals

- A storefront widget that renders on every personalizable product page, ships customer input cleanly into the cart, and never blocks the checkout path.
- An admin editor in the CRM where Roger defines a customization template per product without touching code.
- Live preview that updates as the customer types, on the actual product image (not a generic mockup).
- Multiple customization fields per product (e.g. couples bracelet with two names, necklace with name + birthdate).
- Curved text support for rings and arched pendants, in addition to linear.
- Optional photo upload field for products that engrave or inset a customer photo.
- Every order automatically carries a production-ready spec for the supplier — readable on the Shopify admin, the order confirmation, and the CRM production view.
- Two-way data sync: the CRM owns the template, Shopify owns the order, both stay in lockstep so production never works from stale data.

## 3. Non-goals (for v1)

- Building a Shopify App for the public app store. The v1 ships as a Liquid snippet plus a JS bundle, installed on the merchant's single Shopify store. Listing as a public app comes later.
- 3D rendering, AR try-on, photoreal lighting on the preview. v1 is 2D layered SVG/canvas.
- Customer accounts that save customization drafts. The cart preserves it; nothing more in v1.
- Variant-driven base SKUs beyond the existing 52-variant model — color × initial stays as the variant axis where it already exists; the personalizer adds free-text on top via line item properties.
- AI-assisted preview (Nano Banana / Seedance generation per click). Cost and latency are wrong for a storefront; v1 sticks to deterministic layered rendering.
- Multi-language fonts that need shaping engines (Arabic RTL, CJK, complex scripts). Latin script only in v1; CJK and Arabic are v2.
- Building a font upload pipeline. v1 ships with a curated set of admin-selectable fonts (~5–8) loaded from Google Fonts.
- Migrating existing 52-variant (Color × Initial) products to the personalizer model. They keep their current variant structure. The personalizer is opt-in per product: a `supports_personalization` flag on the product (or category) gates whether the new editor and storefront widget are active. New personalized products typically have just color as a variant axis (e.g., Silver/Gold = 2 variants), with the engraving captured as line item properties rather than as a 26-way variant explosion.

## 4. User stories

### 4.1 Customer on the storefront

> A customer lands on the Angel Wings Heart Pendant product page. Above the Add-to-Bag button she sees a "Personalize your piece" section: a single text input labelled "First name" with placeholder "Put name here" in soft gray, a character counter "0 / 12", and an italic-serif "Camille" already showing on the heart in the product photo to the left. She types her own name; each keystroke updates the engraving on the heart in real time. The character counter ticks up; when she hits 12 the input stops accepting more. She picks Gold over Silver. She clicks Add to Bag. Checkout goes through Shopify normally; her order confirmation lists the engraving "Iris" on a dedicated line; the production team gets the same spec.

### 4.2 Roger in the CRM

> Roger pushes a new ring to Shopify via the existing CRM flow. After it lands he opens the product card, clicks the new "Personalizer" tab, and lands in a side-by-side editor: the product image fills the left canvas, a properties panel sits on the right. He drags a text bounding box onto the inside of the band, sets the field label to "Engraving", picks the Pinyon Script font, sets max 18 characters, sets the curve mode to "circle" with radius 78px so the text wraps the band, and sets the placeholder to "Type your message". He saves. Within seconds the storefront product page picks up the template and serves the personalizer to customers.

### 4.3 Supplier fulfilling an order

> The supplier opens an order in Shopify Admin (or via the CRM's production queue). The line item shows: product name, color (Gold), and a structured block of customization data — Field "First name": "Iris" · Font: Pinyon Script · Curve: linear · Color: gold engraving · Position: x=160 y=151. A printable spec sheet is one click away. The supplier can produce the piece without a single follow-up question.

## 5. Architecture overview

The system has four moving parts:

**Storefront widget** — a static JS bundle hosted on the same Cloudflare Pages deploy as the existing CRM, loaded via a Liquid snippet that the merchant pastes into their product template once. The widget reads its template config from the CRM API at page load, renders the personalizer UI inside a placeholder div on the product page, and binds to the existing Shopify add-to-cart form. No backend in the hot interaction path — the only network calls are the initial template fetch and the optional photo upload.

**Admin editor** — a new tab in the React CRM, alongside the existing Image Studio / Video Studio / Copywriting Tool / Shopify Settings tabs. It reuses patterns the team already has from the video editor (drag/resize bounding boxes, properties panel, layer reorder) so the muscle memory transfers. It writes to the same D1 database that the rest of the CRM uses.

**Cloudflare Pages Functions** — three new endpoints under `/api/personalizer/*` for template CRUD, photo upload, and the Shopify webhook receiver. Plus a public read-only endpoint `/api/personalizer/template/:product_handle` consumed by the storefront widget.

**Shopify** — provides the product page surface, captures customization as line item properties, sends an `orders/create` webhook to the CRM. The CRM mirror tables enrich each order with the resolved customization spec (joined with the template at order time, so the production view stays accurate even if the template later changes).

## 6. Data model (new D1 tables)

### `customization_templates`
One row per personalizable product.

```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
product_id INTEGER NOT NULL                     -- FK products.id
shopify_product_handle TEXT                     -- denormalized for fast storefront lookup
base_image_url TEXT                             -- which product image is the canvas
canvas_width INTEGER NOT NULL DEFAULT 1080      -- design coordinate space
canvas_height INTEGER NOT NULL DEFAULT 1080
status TEXT NOT NULL DEFAULT 'draft'            -- 'draft' | 'published' | 'archived'
published_at TEXT
created_by INTEGER                              -- FK users.id
created_at TEXT NOT NULL DEFAULT (datetime('now'))
updated_at TEXT NOT NULL DEFAULT (datetime('now'))
FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
```

### `customization_fields`
One row per input field. A product with two text inputs and one photo upload has three rows.

```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
template_id INTEGER NOT NULL                    -- FK customization_templates.id
field_kind TEXT NOT NULL                        -- 'text' | 'image'
sort_order INTEGER NOT NULL DEFAULT 0           -- input render order
layer_z INTEGER NOT NULL DEFAULT 10             -- compositing order on the preview canvas

label TEXT NOT NULL                             -- "First name", "Engraving", "Photo"
placeholder TEXT                                -- gray hint, NOT submitted
default_value TEXT                              -- pre-filled, IS submitted unless changed
required INTEGER NOT NULL DEFAULT 0
max_chars INTEGER                               -- text only
allow_empty INTEGER NOT NULL DEFAULT 0          -- if 1 + not required, "no engraving" path

font_family TEXT                                -- text only, e.g. 'Pinyon Script'
font_size_px INTEGER                            -- max size; auto-shrink if needed
font_color TEXT                                 -- '#FAEEDA'
text_align TEXT                                 -- 'center' | 'left' | 'right'
letter_spacing REAL                             -- em units
curve_mode TEXT                                 -- 'linear' | 'arc' | 'circle'
curve_radius_px INTEGER                         -- arc/circle only
curve_path_d TEXT                               -- optional admin-drawn SVG path

position_x INTEGER NOT NULL                     -- top-left corner of bbox
position_y INTEGER NOT NULL
width INTEGER NOT NULL
height INTEGER NOT NULL
rotation_deg REAL DEFAULT 0

mask_shape TEXT                                 -- image only: 'rect' | 'circle' | 'heart'
image_max_size_kb INTEGER DEFAULT 5120

config_json TEXT                                -- escape hatch for v2 props

created_at TEXT NOT NULL DEFAULT (datetime('now'))
updated_at TEXT NOT NULL DEFAULT (datetime('now'))
FOREIGN KEY (template_id) REFERENCES customization_templates(id) ON DELETE CASCADE
```

### `customization_orders`
One row per Shopify line item that carries customization data. Created by the order webhook.

```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
shopify_order_id TEXT NOT NULL                  -- "gid://shopify/Order/..." or numeric id
shopify_order_name TEXT                         -- "#1042" for human display
shopify_line_item_id TEXT NOT NULL UNIQUE
product_id INTEGER                              -- FK products.id, may be null if product was deleted
template_id INTEGER                             -- snapshot of which template was active at order time
template_snapshot_json TEXT NOT NULL            -- frozen copy of fields at order time
values_json TEXT NOT NULL                       -- {"field_42":"Iris","field_43":"https://r2/.../photo.jpg"}
production_status TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'in_production' | 'shipped' | 'cancelled'
production_notes TEXT                           -- supplier-facing free text
created_at TEXT NOT NULL DEFAULT (datetime('now'))
updated_at TEXT NOT NULL DEFAULT (datetime('now'))
FOREIGN KEY (template_id) REFERENCES customization_templates(id) ON DELETE SET NULL
```

The `template_snapshot_json` is critical. The admin can edit a template at any time; orders placed before the edit must keep producing what the customer actually saw and approved. We snapshot at order-create time and never mutate.

## 7. Storefront widget

### 7.1 Install

Merchant pastes the following into their product template (`product.liquid` or a section file) once:

```liquid
<div id="rp-personalizer"
     data-product-handle="{{ product.handle }}"
     data-product-id="{{ product.id }}"></div>
<script src="https://app.riccardiparis.com/storefront/personalizer.js" defer></script>
```

The script self-mounts when the DOM is ready, finds the placeholder, and injects the widget above the existing add-to-cart form. If the product has no published template, the script no-ops silently.

### 7.2 Layout

The widget is a single section above the add-to-cart, two-column on desktop (preview left, inputs right), single-column on mobile (preview top, inputs below). The preview is an SVG that composites the product base image with the current field values. Inputs are stacked vertically, one per `customization_field`.

### 7.3 Input behaviour

- **Placeholder** is rendered as the native HTML5 `placeholder` attribute on a `<input>` or `<textarea>`. It shows in soft gray, disappears on focus or first keystroke, and is never submitted.
- **Default value** is set as the input's `value` attribute. Submitted as-is unless the customer overwrites. Distinct from placeholder: an input with placeholder "Put name here" and no default value submits an empty string if untouched; an input with default "Iris" submits "Iris" if untouched.
- **Character counter** lives below each text input, updated on every `input` event.
- **Required fields** block Add-to-Cart with an inline error if empty; non-required fields with `allow_empty=1` render the preview without that field's layer.
- **Image upload** sends the file to `POST /api/personalizer/upload` which stores it in R2 under `personalizer/{order_pending_token}/{filename}` and returns the URL. Max size enforced client-side first, server-side as a defence.

### 7.4 Live preview

The preview is built in SVG so we can use `textPath` for curved text (arc, circle), and so we can layer text over a raster product image without extra dependencies. The render pipeline on every input change:

1. Read the template's base canvas dimensions (default 1080×1080).
2. For each field, sorted by `layer_z`:
   - text: render `<text>` with the configured font/size/color, anchored at `position_x/y`. If `curve_mode` is `arc` or `circle`, wrap in a `<textPath href="#path-{field_id}">` and emit the path from `curve_radius_px` plus position. Auto-shrink font-size if the rendered text exceeds the field's `width`.
   - image: render `<image>` clipped to `mask_shape`.
3. Update the SVG inline; no React, no virtual DOM, just direct DOM updates for snappy keystroke response.

### 7.5 Add to cart

On submit, the widget walks the field set and emits Shopify line item properties:

```js
{
  properties: {
    "_template_id": "42",
    "_template_updated_at": "2026-04-29T18:15:00Z",
    "First name": "Iris",
    "Photo": "https://app.riccardiparis.com/r2/personalizer/abc123/photo.jpg",
    "_spec_preview": "First name=Iris (Pinyon Script, gold, x=160 y=151) · linear curve"
  }
}
```

Properties prefixed with `_` are hidden from the customer in the cart (Shopify convention) but remain visible to the merchant on the order. The plain-named ones show in the cart line item so the customer can confirm what they ordered.

`_spec_preview` is a client-generated hint so the customer sees something sensible if they peek at the cart line item details mid-checkout. The canonical supplier-facing spec is generated server-side at webhook time (§10) and appended to the order note — that's the source of truth, regenerated from the template snapshot so it never drifts.

## 8. Admin editor

A new tab "Personalizer" appears on the integrator/admin product card next to "Image Studio", "Video Studio", "Shopify Settings". It's only enabled for products whose category supports personalization (configurable per category in the existing categories table — adds a `supports_personalization` flag).

### 8.1 Layout

Side-by-side: 60/40 split. Left is the canvas — the product's first image fills the area, with draggable bounding boxes per field overlaid on top. Right is a stacked properties panel: a list of fields at the top (drag-reorder for layer order), and a per-field config form below. Toolbar across the top: Save Draft, Publish, Preview Storefront, History.

### 8.2 Reused patterns

The CRM already has a sophisticated layer panel and bounding-box editor in the Video Studio's `EditorPanel.tsx`. We import the relevant pieces (the drag-resize-rotate bounding box, the layer reorder list, the snap-to-center magnetic snap, the keyboard-arrow nudges) so the personalizer feels native. Specifically reused: the drag/resize handle component, the magnetic snap algorithm, the layer reorder DnD.

### 8.3 Field config form

Per field, the admin sets every attribute that maps to a column in `customization_fields`. The form groups them into sections: Identity (label, placeholder, default, required), Constraints (max chars, allow_empty), Typography (font, size, color, alignment, letter spacing), Geometry (position, width, height, rotation, curve mode + radius/path), Layer (z-index visualized as drag-reorder).

### 8.4 Live admin preview

Same SVG render pipeline as the storefront, but with placeholder/default values pre-filled. Lets the admin see exactly what the customer will see.

### 8.5 Snapshotting on order

We don't keep a separate template-versions table in v1. Every `customization_order` carries an inline `template_snapshot_json` of the template + fields exactly as they were when the order was placed; that snapshot is what the supplier produces against, regardless of any later admin edit to the template. Versioned history is a v2 concern — for now, if an edit broke a product, the admin re-edits to fix it. Past orders are unaffected because they never re-read the live template.

## 9. API endpoints

All under `/api/personalizer/*`. Auth model:

- Admin endpoints (`POST /templates`, `PATCH /templates/:id`, etc.): require `admin` or `integrator` role via the existing JWT auth middleware.
- Public endpoints (`GET /template/:handle`): no auth, CORS open to the merchant's Shopify domain.

| Method | Path | Purpose |
|---|---|---|
| GET | /personalizer/template/:product_handle | Public. Returns the published template + fields for the storefront. CORS-allowed for the Shopify domain. |
| GET | /personalizer/templates | Admin. List all templates with status counts. |
| GET | /personalizer/templates/:id | Admin. Read one template + fields. |
| POST | /personalizer/templates | Admin. Create a new template for a product. |
| PATCH | /personalizer/templates/:id | Admin. Update template-level config (status, base image, canvas size). |
| DELETE | /personalizer/templates/:id | Admin. Soft-delete (sets status='archived'). |
| POST | /personalizer/templates/:id/fields | Admin. Add a field. |
| PATCH | /personalizer/fields/:id | Admin. Update a field's config. |
| DELETE | /personalizer/fields/:id | Admin. Remove a field. |
| POST | /personalizer/fields/:id/reorder | Admin. Update sort_order + layer_z of multiple fields in one shot. |
| POST | /personalizer/upload | Public. Receives a customer photo, stores in R2, returns URL. Rate-limited per IP. |
| POST | /personalizer/webhook/shopify-order | Public. Shopify HMAC-validated. Mirrors a new order's customization into customization_orders. |
| GET | /personalizer/orders | Admin. List customization orders, filter by production_status. |
| PATCH | /personalizer/orders/:id | Admin. Update production_status, add production_notes. |

## 10. Cart & order flow

1. Customer fills the personalizer, clicks Add to Bag. Widget posts to `/cart/add.js` with line item properties as described in §7.5.
2. Shopify proceeds normally through cart, checkout, payment.
3. On `orders/create`, Shopify fires a webhook to `/api/personalizer/webhook/shopify-order`. We verify HMAC, parse line items, find any with `_template_id` properties.
4. For each personalized line item we:
   - Look up the matching `customization_template` and snapshot it into `template_snapshot_json`.
   - Build the `values_json` map from line item properties.
   - Build the human-readable spec summary.
   - Call Shopify Admin API `orderUpdate` mutation to append the formatted spec block to `order.note` (visible on packing slips, fulfillment views, supplier order exports). Also write a structured metafield `riccardiparis.personalization_spec` (JSON) on the order so downstream tooling can parse it without screen-scraping the note.
   - Insert the row in `customization_orders` for the CRM production view.
5. The CRM exposes a Production Queue list (filterable by status), with a print-spec button that generates a one-page PDF with the field values, the rendered preview, and the dimensions in mm/px — for suppliers who fulfill outside Shopify.

## 11. Supplier-facing notes

Two delivery surfaces, both populated from the same `_spec` string:

**Shopify order note.** Appended on every webhook process. Format:

```
[PERSONALIZATION]
Item: Angel wings heart pendant
Color: Gold
Field "First name": Iris
  Font: Pinyon Script · 22px · Italic
  Color: #FAEEDA · Curve: linear
  Position: x=160 y=151 · Layer: 3
```

Visible on Shopify Admin order page, in fulfillment apps, on auto-generated packing slips.

**CRM production view.** Lists every `customization_orders` row with the resolved snapshot and a Print Spec button that generates a PDF including the live-rendered preview image. For Roger's in-house production and external suppliers connected through the CRM.

Both surfaces show identical content, so a supplier can work from whichever is in their existing workflow.

## 12. Sync between Shopify and CRM

Two-way:

- **CRM → Shopify** is one-way "publish": when a template is saved with status='published', the storefront fetches the latest version on next page load. No webhook needed because the storefront pulls fresh data on every product page render.
- **Shopify → CRM** is webhook-driven: `orders/create`, `orders/updated`, `orders/cancelled` all hit our webhook receiver and update the matching `customization_orders` row.

The product itself stays under the existing CRM → Shopify push pipeline — no change there.

## 13. Aesthetic & UX guardrails

The storefront widget visually matches the merchant's theme: it inherits font from CSS rather than imposing one (except for the engraving font, which IS the customization). Frame elements (input borders, buttons, labels) use neutral CSS that overrides cleanly with a couple of CSS variable overrides the merchant can set in the Liquid snippet. Selection accents and the live-preview engraving use admin-configurable colors per field.

The admin editor matches the rest of the CRM: shadcn/ui + Tailwind, same iconography, same toolbar pattern.

## 14. Risks & open questions

- **Font rendering parity**: SVG text rendering differs subtly between the Chrome/Safari/Firefox the customer sees, the Chrome the admin sees, and the production rendering. v1 mitigation: ship a small set of curated Google Fonts loaded the same way in both surfaces; document a "what you see is what you get" caveat.
- **Photo upload abuse**: an unauthed `POST /personalizer/upload` is a free file upload endpoint. Mitigation: rate-limit per IP (Cloudflare Workers KV counter), enforce file size + MIME, scan for non-image bytes, expire R2 objects with no associated order after 24 h.
- **Order webhook reliability**: Shopify retries, but if our endpoint is down for too long the order falls through. Mitigation: log every received webhook payload to KV before processing; have a "rebuild from raw" admin button for stuck orders.
- **Curve text auto-fitting**: a customer types "Constantinople" into a field that fits 8 chars. Mitigation: hard maxlength enforced client-side (HTML5) + server-side (webhook validates), plus auto-shrink font-size down to a configurable minimum, then truncate with ellipsis if even that overflows.
- **Theme compatibility**: Online Store 2.0 themes work natively; vintage themes might not render the snippet placement correctly. Mitigation: ship a documented snippet for OS 2.0 + a fallback inline drop-in for vintage themes.

## 15. v1 scope summary

| In | Out (v2 backlog) |
|---|---|
| Single-product editor with multi-field templates | Cross-product template library |
| 1–4 text fields, 0–1 image fields per template | Unbounded fields |
| Linear, arc, and circle curve modes | Custom path drawing in the admin |
| ~5–8 curated Google Fonts | Custom font upload, font weights, OpenType features |
| Mask shapes: rect, circle, heart | Arbitrary clip paths |
| Latin script | CJK, Arabic, Hebrew, Indic |
| Live preview, character counter, default + placeholder | 3D preview, AR try-on |
| Cart binding via line item properties | Variant-driven free-text (would need Shopify Functions) |
| Order note auto-population on webhook | Direct supplier portal |
| CRM production queue with PDF print | Production scheduling, capacity planning |
| FR + EN copy on storefront | Multi-language admin UI |
| Single Shopify store install | Public Shopify App listing |

## 16. Implementation milestones (rough)

These are not the implementation plan — the writing-plans skill produces that. Just a sketch for sizing.

1. **DB + APIs**: migrations 0142–0144 for the three tables, CRUD endpoints, webhook receiver.
2. **Admin editor**: new tab in CRM, field-config form, layer panel, live preview.
3. **Storefront widget**: standalone JS bundle, Liquid snippet, CSS, R2 upload flow.
4. **Webhook + order sync**: HMAC validation, order mirror, spec generation, Shopify order-note injection.
5. **Production queue + PDF**: CRM tab listing customization_orders, print-spec PDF.
6. **Polish + testing**: cross-browser font check, mobile responsive, French + English copy, rate limiting.

## 17. Success criteria

- A customer can personalize a product with name + optional photo, see the live preview render correctly on desktop and mobile, and complete checkout in under 30 seconds.
- Roger can configure a new product's template (3 fields, 2 fonts, 1 curve) end-to-end in under 5 minutes without writing code.
- Every order placed through the personalizer has a complete production spec on its Shopify order note within 30 seconds of order creation.
- Zero orders go to production missing customization data (validated by the production queue's pending count tracking against Shopify orders).
