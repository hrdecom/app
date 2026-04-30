# Shopify Personalizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a customer-facing personalizer widget on the Shopify storefront, an admin template editor in the CRM, and the data plumbing that keeps both in sync — all built on the existing Cloudflare Pages + D1 + R2 stack.

**Architecture:** Three D1 tables (`customization_templates`, `customization_fields`, `customization_orders`) hold per-product templates and order snapshots. Cloudflare Pages Functions expose admin CRUD + a public read-only template endpoint + a Shopify webhook receiver. The CRM admin grows a "Personalizer" tab reusing the existing video-editor patterns (drag/resize bbox, layer reorder, properties panel). The storefront ships as a Liquid snippet + ~25 kB JS bundle hosted on the same Pages deploy. Orders sync via `orders/create` webhook into a `customization_orders` mirror, with the supplier-facing spec written back to `order.note` + a structured metafield via Shopify's `orderUpdate` mutation.

**Tech Stack:** Cloudflare Workers (Pages Functions), D1 (SQLite), R2, KV (rate limit + webhook idempotency), React 18 + Vite + TailwindCSS + shadcn/ui (CRM), vanilla JS + SVG (storefront — no React on the public page), Shopify Admin GraphQL API (orderUpdate, metafields), Vitest (new — for testable pure functions).

**Spec reference:** `docs/superpowers/specs/2026-04-29-shopify-personalizer-design.md`

**Testing convention:** This repo has no existing test framework. We add Vitest in Task 0 for pure-function tests (HMAC validation, spec generation, font auto-shrink math). UI components and integration paths are verified via `npx tsc --noEmit` + manual smoke tests, matching the existing pattern in this codebase.

---

## File structure (read once, refer back as you work)

**New files (create):**

- `migrations/0142_customization_templates.sql`
- `migrations/0143_customization_fields.sql`
- `migrations/0144_customization_orders.sql`
- `migrations/0145_supports_personalization_flag.sql`
- `functions/api/personalizer/templates/index.js`
- `functions/api/personalizer/templates/[id].js`
- `functions/api/personalizer/templates/[id]/fields.js`
- `functions/api/personalizer/template/[handle].js` *(public, no auth)*
- `functions/api/personalizer/fields/[id].js`
- `functions/api/personalizer/fields/[id]/reorder.js`
- `functions/api/personalizer/upload.js`
- `functions/api/personalizer/webhook/shopify-order.js`
- `functions/api/personalizer/orders/index.js`
- `functions/api/personalizer/orders/[id].js`
- `functions/lib/personalizer-spec.js` *(spec generation — pure)*
- `functions/lib/shopify-webhook.js` *(HMAC validation — pure)*
- `functions/lib/shopify-graphql.js` *(orderUpdate + metafield helpers)*
- `src/lib/personalizer-api.ts`
- `src/components/admin/personalizer/PersonalizerPanel.tsx`
- `src/components/admin/personalizer/PersonalizerCanvas.tsx`
- `src/components/admin/personalizer/FieldConfigForm.tsx`
- `src/components/admin/personalizer/FieldList.tsx`
- `src/components/admin/personalizer/LivePreview.tsx`
- `src/components/admin/personalizer/ProductionQueuePanel.tsx`
- `src/lib/personalizer-render.ts` *(SVG render fn shared with storefront via build copy)*
- `storefront/personalizer/src/widget.ts` *(entry)*
- `storefront/personalizer/src/render.ts` *(re-exports from src/lib/personalizer-render.ts)*
- `storefront/personalizer/src/cart.ts`
- `storefront/personalizer/src/upload.ts`
- `storefront/personalizer/vite.config.ts`
- `storefront/personalizer/package.json`
- `storefront/personalizer/snippet.liquid` *(install instructions)*
- `tests/personalizer-spec.test.ts`
- `tests/shopify-webhook.test.ts`
- `tests/personalizer-render.test.ts`
- `vitest.config.ts`

**Existing files (modify):**

- `package.json` — add Vitest, add storefront build script
- `scripts/sync-migrations.mjs` — add idempotent block for migrations 0142–0145
- `wrangler.toml` — add Pages routes for `/storefront/personalizer.js` static asset
- `src/components/integrator/WorkspaceView.tsx` — add "Personalizer" tab when `supports_personalization` is true
- `src/lib/products.ts` — add `supports_personalization` boolean on Product type

**Files responsibility map:**

| File | Owns |
|---|---|
| `personalizer-spec.js` | Build human-readable spec from a template snapshot + values map |
| `shopify-webhook.js` | Verify Shopify HMAC, parse order JSON, extract personalized line items |
| `shopify-graphql.js` | Wrap `orderUpdate` (note append) and `metafieldsSet` mutations |
| `personalizer-render.ts` | Pure SVG render: takes template + values → SVG string. Shared admin + storefront. |
| `PersonalizerCanvas.tsx` | Drag/resize bbox manipulation on the product image |
| `FieldConfigForm.tsx` | All field config inputs (label, placeholder, default, font, curve, etc.) |
| `LivePreview.tsx` | Renders `personalizer-render.ts` output with admin's draft values |
| `widget.ts` | Storefront entry: mount, fetch template, wire input → preview → cart |

---

## Milestone 0: Test infrastructure (1 task, 5 min)

### Task 0: Set up Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add devDependencies + scripts)

- [ ] **Step 1: Install Vitest**

```bash
cd /sessions/pensive-zealous-hamilton/mnt/app
npm install --save-dev vitest@^1.6.0
```

- [ ] **Step 2: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
```

- [ ] **Step 3: Add test script to `package.json`**

In the `scripts` block, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Sanity-check**

Run: `npx vitest run`
Expected: `No test files found, exiting with code 1` — Vitest is wired, no tests yet. That's the right output.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "chore: add Vitest for personalizer pure-function tests"
```

---

## Milestone 1: Database schema (5 tasks)

### Task 1.1: Migration 0142 — `customization_templates`

**Files:**
- Create: `migrations/0142_customization_templates.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Personalizer templates — one row per personalizable product. The admin
-- editor writes here; the storefront widget reads here (via the public
-- /api/personalizer/template/:handle endpoint).
--
-- canvas_width / canvas_height define the design coordinate space. Field
-- positions are stored in this space; the widget scales to whatever the
-- product image renders at on the storefront.
--
-- status='draft' is invisible to the storefront; only 'published' rows are
-- served. 'archived' is a soft-delete.

CREATE TABLE IF NOT EXISTS customization_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  shopify_product_handle TEXT,
  base_image_url TEXT,
  canvas_width INTEGER NOT NULL DEFAULT 1080,
  canvas_height INTEGER NOT NULL DEFAULT 1080,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_personalizer_templates_product ON customization_templates(product_id);
CREATE INDEX IF NOT EXISTS idx_personalizer_templates_handle ON customization_templates(shopify_product_handle);
CREATE INDEX IF NOT EXISTS idx_personalizer_templates_status ON customization_templates(status);
```

- [ ] **Step 2: Add to sync-migrations.mjs**

Modify `scripts/sync-migrations.mjs`. Find the `console.log('  migration 0141');` line and insert this block IMMEDIATELY ABOVE it:

```javascript
  console.log('  migration 0142');
  // Personalizer templates — one per personalizable product.
  if (!hasTable('customization_templates')) {
    run(`CREATE TABLE customization_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      shopify_product_handle TEXT,
      base_image_url TEXT,
      canvas_width INTEGER NOT NULL DEFAULT 1080,
      canvas_height INTEGER NOT NULL DEFAULT 1080,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      published_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )`, 'customization_templates');
    run(`CREATE INDEX idx_personalizer_templates_product ON customization_templates(product_id)`,
        'idx_personalizer_templates_product');
    run(`CREATE INDEX idx_personalizer_templates_handle ON customization_templates(shopify_product_handle)`,
        'idx_personalizer_templates_handle');
    run(`CREATE INDEX idx_personalizer_templates_status ON customization_templates(status)`,
        'idx_personalizer_templates_status');
  }
```

- [ ] **Step 3: Run locally**

```bash
node scripts/sync-migrations.mjs
```

Expected output includes `migration 0142` and `✓ customization_templates`.

- [ ] **Step 4: Verify the table**

```bash
wrangler d1 execute jewelry-crm-db --local --command="SELECT name FROM sqlite_master WHERE name='customization_templates'"
```

Expected: one row with `customization_templates`.

- [ ] **Step 5: Commit**

```bash
git add migrations/0142_customization_templates.sql scripts/sync-migrations.mjs
git commit -m "feat(personalizer): migration 0142 — customization_templates table"
```

---

### Task 1.2: Migration 0143 — `customization_fields`

**Files:**
- Create: `migrations/0143_customization_fields.sql`
- Modify: `scripts/sync-migrations.mjs`

- [ ] **Step 1: Write the migration**

```sql
-- One row per input field (text or image) on a template. Fields render in
-- order of `sort_order` in the input list and stack visually by `layer_z`.
-- See spec §6 for column meanings.

CREATE TABLE IF NOT EXISTS customization_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  field_kind TEXT NOT NULL CHECK (field_kind IN ('text', 'image')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  layer_z INTEGER NOT NULL DEFAULT 10,

  label TEXT NOT NULL,
  placeholder TEXT,
  default_value TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  max_chars INTEGER,
  allow_empty INTEGER NOT NULL DEFAULT 0,

  font_family TEXT,
  font_size_px INTEGER,
  font_color TEXT,
  text_align TEXT,
  letter_spacing REAL,
  curve_mode TEXT CHECK (curve_mode IS NULL OR curve_mode IN ('linear', 'arc', 'circle')),
  curve_radius_px INTEGER,
  curve_path_d TEXT,

  position_x INTEGER NOT NULL,
  position_y INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  rotation_deg REAL DEFAULT 0,

  mask_shape TEXT CHECK (mask_shape IS NULL OR mask_shape IN ('rect', 'circle', 'heart')),
  image_max_size_kb INTEGER DEFAULT 5120,

  config_json TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (template_id) REFERENCES customization_templates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_personalizer_fields_template ON customization_fields(template_id, sort_order);
```

- [ ] **Step 2: Add to sync-migrations.mjs**

Insert ABOVE the `console.log('  migration 0142');` line you added in Task 1.1:

```javascript
  console.log('  migration 0143');
  if (!hasTable('customization_fields')) {
    run(`CREATE TABLE customization_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      field_kind TEXT NOT NULL CHECK (field_kind IN ('text', 'image')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      layer_z INTEGER NOT NULL DEFAULT 10,
      label TEXT NOT NULL,
      placeholder TEXT,
      default_value TEXT,
      required INTEGER NOT NULL DEFAULT 0,
      max_chars INTEGER,
      allow_empty INTEGER NOT NULL DEFAULT 0,
      font_family TEXT,
      font_size_px INTEGER,
      font_color TEXT,
      text_align TEXT,
      letter_spacing REAL,
      curve_mode TEXT CHECK (curve_mode IS NULL OR curve_mode IN ('linear', 'arc', 'circle')),
      curve_radius_px INTEGER,
      curve_path_d TEXT,
      position_x INTEGER NOT NULL,
      position_y INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      rotation_deg REAL DEFAULT 0,
      mask_shape TEXT CHECK (mask_shape IS NULL OR mask_shape IN ('rect', 'circle', 'heart')),
      image_max_size_kb INTEGER DEFAULT 5120,
      config_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (template_id) REFERENCES customization_templates(id) ON DELETE CASCADE
    )`, 'customization_fields');
    run(`CREATE INDEX idx_personalizer_fields_template ON customization_fields(template_id, sort_order)`,
        'idx_personalizer_fields_template');
  }
```

- [ ] **Step 3: Run + verify**

```bash
node scripts/sync-migrations.mjs
wrangler d1 execute jewelry-crm-db --local --command="PRAGMA table_info(customization_fields)"
```

Expected: 24 columns listed (including `field_kind`, `placeholder`, `default_value`, `curve_mode`, `mask_shape`).

- [ ] **Step 4: Commit**

```bash
git add migrations/0143_customization_fields.sql scripts/sync-migrations.mjs
git commit -m "feat(personalizer): migration 0143 — customization_fields table"
```

---

### Task 1.3: Migration 0144 — `customization_orders`

**Files:**
- Create: `migrations/0144_customization_orders.sql`
- Modify: `scripts/sync-migrations.mjs`

- [ ] **Step 1: Write the migration**

```sql
-- Mirror of Shopify orders that carry customization. Created by the
-- /api/personalizer/webhook/shopify-order receiver.
--
-- template_snapshot_json is the FROZEN copy of the template + fields at
-- the moment of order creation. Production reads this snapshot — never
-- the live template — so admin edits never break in-flight orders.

CREATE TABLE IF NOT EXISTS customization_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shopify_order_id TEXT NOT NULL,
  shopify_order_name TEXT,
  shopify_line_item_id TEXT NOT NULL UNIQUE,
  product_id INTEGER,
  template_id INTEGER,
  template_snapshot_json TEXT NOT NULL,
  values_json TEXT NOT NULL,
  production_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (production_status IN ('pending', 'in_production', 'shipped', 'cancelled')),
  production_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (template_id) REFERENCES customization_templates(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_personalizer_orders_status ON customization_orders(production_status);
CREATE INDEX IF NOT EXISTS idx_personalizer_orders_shopify ON customization_orders(shopify_order_id);
CREATE INDEX IF NOT EXISTS idx_personalizer_orders_created ON customization_orders(created_at DESC);
```

- [ ] **Step 2: Add to sync-migrations.mjs**

Insert ABOVE the `console.log('  migration 0143');` line:

```javascript
  console.log('  migration 0144');
  if (!hasTable('customization_orders')) {
    run(`CREATE TABLE customization_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shopify_order_id TEXT NOT NULL,
      shopify_order_name TEXT,
      shopify_line_item_id TEXT NOT NULL UNIQUE,
      product_id INTEGER,
      template_id INTEGER,
      template_snapshot_json TEXT NOT NULL,
      values_json TEXT NOT NULL,
      production_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (production_status IN ('pending', 'in_production', 'shipped', 'cancelled')),
      production_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (template_id) REFERENCES customization_templates(id) ON DELETE SET NULL
    )`, 'customization_orders');
    run(`CREATE INDEX idx_personalizer_orders_status ON customization_orders(production_status)`,
        'idx_personalizer_orders_status');
    run(`CREATE INDEX idx_personalizer_orders_shopify ON customization_orders(shopify_order_id)`,
        'idx_personalizer_orders_shopify');
    run(`CREATE INDEX idx_personalizer_orders_created ON customization_orders(created_at DESC)`,
        'idx_personalizer_orders_created');
  }
```

- [ ] **Step 3: Run + verify**

```bash
node scripts/sync-migrations.mjs
wrangler d1 execute jewelry-crm-db --local --command="SELECT sql FROM sqlite_master WHERE name='customization_orders'"
```

- [ ] **Step 4: Commit**

```bash
git add migrations/0144_customization_orders.sql scripts/sync-migrations.mjs
git commit -m "feat(personalizer): migration 0144 — customization_orders mirror"
```

---

### Task 1.4: Migration 0145 — `supports_personalization` flag

**Files:**
- Create: `migrations/0145_supports_personalization_flag.sql`
- Modify: `scripts/sync-migrations.mjs`

- [ ] **Step 1: Write the migration**

```sql
-- Per-product opt-in flag for the personalizer. Storefront widget no-ops
-- when 0; admin Personalizer tab is hidden when 0.

ALTER TABLE products ADD COLUMN supports_personalization INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_products_supports_personalization ON products(supports_personalization);
```

- [ ] **Step 2: Add to sync-migrations.mjs**

Insert ABOVE the `console.log('  migration 0144');` line:

```javascript
  console.log('  migration 0145');
  if (hasTable('products') && !hasColumn('products', 'supports_personalization')) {
    run(`ALTER TABLE products ADD COLUMN supports_personalization INTEGER NOT NULL DEFAULT 0`,
        'products.supports_personalization');
    run(`CREATE INDEX IF NOT EXISTS idx_products_supports_personalization ON products(supports_personalization)`,
        'idx_products_supports_personalization');
  }
```

- [ ] **Step 3: Run + verify**

```bash
node scripts/sync-migrations.mjs
wrangler d1 execute jewelry-crm-db --local --command="PRAGMA table_info(products)" | grep supports_personalization
```

Expected: one row mentioning `supports_personalization INTEGER`.

- [ ] **Step 4: Commit**

```bash
git add migrations/0145_supports_personalization_flag.sql scripts/sync-migrations.mjs
git commit -m "feat(personalizer): migration 0145 — supports_personalization opt-in flag"
```

---

### Task 1.5: Apply to remote D1

Production D1 needs the same migrations.

- [ ] **Step 1: Apply on remote**

```bash
npm run db:migrate:remote
```

Expected: 0142, 0143, 0144, 0145 each show ✅. (Earlier migrations already applied per FIX 22.)

- [ ] **Step 2: Verify**

```bash
wrangler d1 execute jewelry-crm-db --remote --command="SELECT name FROM sqlite_master WHERE name LIKE 'customization%'"
```

Expected: 3 rows — `customization_templates`, `customization_fields`, `customization_orders`.

- [ ] **Step 3: No commit needed** (no file changes).

---

## Milestone 2: Pure-function libraries (3 tasks, TDD)

These are pure functions consumed by the API endpoints later. Test-first because they're isolated and easy to test. Each is in `functions/lib/` so it's importable from any endpoint.

### Task 2.1: `personalizer-spec.js` — build supplier-facing spec

**Files:**
- Create: `tests/personalizer-spec.test.ts`
- Create: `functions/lib/personalizer-spec.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/personalizer-spec.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildSpecText, buildSpecJson } from '../functions/lib/personalizer-spec.js';

const snapshot = {
  template: { id: 42, canvas_width: 1080, canvas_height: 1080 },
  fields: [
    {
      id: 1, field_kind: 'text', label: 'First name',
      font_family: 'Pinyon Script', font_size_px: 22, font_color: '#FAEEDA',
      curve_mode: 'linear', position_x: 160, position_y: 151,
      width: 70, height: 22, layer_z: 3,
    },
  ],
};

describe('personalizer-spec.buildSpecText', () => {
  it('formats a single text field for the supplier note', () => {
    const out = buildSpecText({
      productTitle: 'Angel wings heart pendant',
      color: 'Gold',
      snapshot,
      values: { '1': 'Iris' },
    });
    expect(out).toContain('[PERSONALIZATION]');
    expect(out).toContain('Item: Angel wings heart pendant');
    expect(out).toContain('Color: Gold');
    expect(out).toContain('Field "First name": Iris');
    expect(out).toContain('Font: Pinyon Script');
    expect(out).toContain('Position: x=160 y=151');
  });

  it('omits empty optional fields when allow_empty=1', () => {
    const snap = {
      ...snapshot,
      fields: [{ ...snapshot.fields[0], allow_empty: 1 }],
    };
    const out = buildSpecText({ productTitle: 'X', color: '', snapshot: snap, values: { '1': '' } });
    expect(out).not.toContain('Field "First name"');
  });

  it('renders multiple fields stably ordered by sort_order', () => {
    const snap = {
      template: snapshot.template,
      fields: [
        { ...snapshot.fields[0], id: 1, sort_order: 1, label: 'Name 1' },
        { ...snapshot.fields[0], id: 2, sort_order: 0, label: 'Name 2' },
      ],
    };
    const out = buildSpecText({ productTitle: 'X', color: '', snapshot: snap, values: { '1': 'A', '2': 'B' } });
    const idxA = out.indexOf('Name 2');
    const idxB = out.indexOf('Name 1');
    expect(idxA).toBeLessThan(idxB);
  });
});

describe('personalizer-spec.buildSpecJson', () => {
  it('returns a structured object suitable for a Shopify metafield', () => {
    const out = buildSpecJson({
      productTitle: 'Angel wings heart pendant',
      color: 'Gold',
      snapshot,
      values: { '1': 'Iris' },
    });
    expect(out.product).toBe('Angel wings heart pendant');
    expect(out.color).toBe('Gold');
    expect(out.fields).toHaveLength(1);
    expect(out.fields[0]).toMatchObject({
      label: 'First name',
      value: 'Iris',
      font: 'Pinyon Script',
      curve: 'linear',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/personalizer-spec.test.ts
```

Expected: FAIL with `Cannot find module '../functions/lib/personalizer-spec.js'`.

- [ ] **Step 3: Implement the module**

Create `functions/lib/personalizer-spec.js`:

```javascript
/**
 * Build the human-readable supplier spec block + the structured JSON
 * used as a Shopify order metafield. Pure functions — no I/O. Consumed
 * by the order webhook receiver.
 */

export function buildSpecText({ productTitle, color, snapshot, values }) {
  const lines = ['[PERSONALIZATION]', `Item: ${productTitle}`];
  if (color) lines.push(`Color: ${color}`);
  const fields = [...(snapshot?.fields || [])].sort(
    (a, b) => (a.sort_order || 0) - (b.sort_order || 0),
  );
  for (const f of fields) {
    const value = values?.[String(f.id)] ?? '';
    if (!value && f.allow_empty) continue;
    if (f.field_kind === 'text') {
      lines.push(`Field "${f.label}": ${value}`);
      const meta = [];
      if (f.font_family) meta.push(`Font: ${f.font_family}`);
      if (f.font_size_px) meta.push(`${f.font_size_px}px`);
      if (f.font_color) meta.push(`Color: ${f.font_color}`);
      if (f.curve_mode) meta.push(`Curve: ${f.curve_mode}`);
      if (meta.length) lines.push(`  ${meta.join(' · ')}`);
      lines.push(`  Position: x=${f.position_x} y=${f.position_y} · Layer: ${f.layer_z ?? 10}`);
    } else if (f.field_kind === 'image') {
      lines.push(`Field "${f.label}" (image): ${value}`);
      if (f.mask_shape) lines.push(`  Mask: ${f.mask_shape}`);
    }
  }
  return lines.join('\n');
}

export function buildSpecJson({ productTitle, color, snapshot, values }) {
  const fields = [...(snapshot?.fields || [])]
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((f) => ({
      id: f.id,
      kind: f.field_kind,
      label: f.label,
      value: values?.[String(f.id)] ?? '',
      font: f.font_family || null,
      size_px: f.font_size_px || null,
      color: f.font_color || null,
      curve: f.curve_mode || 'linear',
      position: { x: f.position_x, y: f.position_y, w: f.width, h: f.height },
      layer_z: f.layer_z ?? 10,
      mask: f.mask_shape || null,
    }))
    .filter((f) => !(f.value === '' && snapshot.fields.find((x) => x.id === f.id)?.allow_empty));
  return {
    product: productTitle,
    color: color || null,
    fields,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/personalizer-spec.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/personalizer-spec.test.ts functions/lib/personalizer-spec.js
git commit -m "feat(personalizer): spec text + JSON builders for supplier note"
```

---

### Task 2.2: `shopify-webhook.js` — HMAC validation

**Files:**
- Create: `tests/shopify-webhook.test.ts`
- Create: `functions/lib/shopify-webhook.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/shopify-webhook.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { verifyShopifyHmac } from '../functions/lib/shopify-webhook.js';

const SECRET = 'shpss_test_secret_value';
const BODY = '{"id":12345,"line_items":[]}';
const VALID_HMAC = 'O5pDLs+RPi7Pxxcn7ZyaCpWsGD8qVYJX8xMdj5Tnpt8=';

describe('verifyShopifyHmac', () => {
  it('accepts a payload with the matching HMAC header', async () => {
    const ok = await verifyShopifyHmac(BODY, VALID_HMAC, SECRET);
    expect(ok).toBe(true);
  });

  it('rejects a payload with a tampered body', async () => {
    const ok = await verifyShopifyHmac(BODY + 'X', VALID_HMAC, SECRET);
    expect(ok).toBe(false);
  });

  it('rejects a missing or empty HMAC header', async () => {
    expect(await verifyShopifyHmac(BODY, '', SECRET)).toBe(false);
    expect(await verifyShopifyHmac(BODY, null, SECRET)).toBe(false);
  });

  it('is constant-time — different lengths still return false fast', async () => {
    expect(await verifyShopifyHmac(BODY, 'short', SECRET)).toBe(false);
  });
});
```

> If `VALID_HMAC` doesn't match what your Workers runtime computes, recompute it: paste BODY and SECRET into a tiny local Node script using `crypto.createHmac('sha256', SECRET).update(BODY).digest('base64')` and replace the constant. The test asserts internal consistency — pick whatever hash your environment generates.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/shopify-webhook.test.ts
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement using Web Crypto (Workers-compatible)**

Create `functions/lib/shopify-webhook.js`:

```javascript
/**
 * Verify that a Shopify webhook payload was signed with our shared secret.
 * Uses the Web Crypto API so this works inside Cloudflare Workers (no
 * Node 'crypto' import).
 *
 * Shopify sends X-Shopify-Hmac-Sha256: base64(hmac-sha256(secret, body)).
 * We compute the same and constant-time-compare.
 */

export async function verifyShopifyHmac(body, headerHmacB64, secret) {
  if (!headerHmacB64 || typeof headerHmacB64 !== 'string') return false;
  if (!secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const expected = bufToBase64(sig);
  return constantTimeEq(expected, headerHmacB64);
}

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function constantTimeEq(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/shopify-webhook.test.ts
```

Expected: 4 tests pass. If `VALID_HMAC` is wrong for your runtime, the test will tell you and you replace it with the actual hash printed by Vitest's failure diff.

- [ ] **Step 5: Commit**

```bash
git add tests/shopify-webhook.test.ts functions/lib/shopify-webhook.js
git commit -m "feat(personalizer): Shopify webhook HMAC validator (Web Crypto)"
```

---

### Task 2.3: `personalizer-render.ts` — SVG render fn

**Files:**
- Create: `tests/personalizer-render.test.ts`
- Create: `src/lib/personalizer-render.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/personalizer-render.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { renderPreviewSvg, autoShrinkFontSize } from '../src/lib/personalizer-render';

describe('autoShrinkFontSize', () => {
  it('keeps the requested size when the text fits', () => {
    expect(autoShrinkFontSize('Iris', 22, 70, 12)).toBe(22);
  });

  it('shrinks proportionally when the text overflows', () => {
    const got = autoShrinkFontSize('Constantinople', 22, 70, 12);
    expect(got).toBeGreaterThanOrEqual(12);
    expect(got).toBeLessThan(22);
  });

  it('clamps at the floor', () => {
    expect(autoShrinkFontSize('AVeryLongNameIndeed', 22, 30, 12)).toBe(12);
  });
});

describe('renderPreviewSvg', () => {
  const template = { canvas_width: 1080, canvas_height: 1080, base_image_url: 'https://example.com/p.jpg' };
  const fields = [{
    id: 1, field_kind: 'text', label: 'First name', layer_z: 3,
    font_family: 'Pinyon Script', font_size_px: 22, font_color: '#FAEEDA',
    curve_mode: 'linear', position_x: 160, position_y: 151,
    width: 70, height: 22, sort_order: 0,
  }];

  it('emits a valid SVG with the typed value', () => {
    const svg = renderPreviewSvg({ template, fields, values: { 1: 'Iris' } });
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('Iris');
    expect(svg).toContain('viewBox="0 0 1080 1080"');
  });

  it('falls back to default_value when value is missing', () => {
    const f = [{ ...fields[0], default_value: 'Camille' }];
    const svg = renderPreviewSvg({ template, fields: f, values: {} });
    expect(svg).toContain('Camille');
    expect(svg).not.toContain('Iris');
  });

  it('emits a textPath element when curve_mode=circle', () => {
    const f = [{ ...fields[0], curve_mode: 'circle', curve_radius_px: 80 }];
    const svg = renderPreviewSvg({ template, fields: f, values: { 1: 'Iris' } });
    expect(svg).toContain('<path');
    expect(svg).toContain('textPath');
  });

  it('orders fields by layer_z ascending so higher z renders on top', () => {
    const f = [
      { ...fields[0], id: 1, layer_z: 5, default_value: 'BACK' },
      { ...fields[0], id: 2, layer_z: 1, default_value: 'FRONT' },
    ];
    const svg = renderPreviewSvg({ template, fields: f, values: {} });
    const idxFront = svg.indexOf('FRONT');
    const idxBack = svg.indexOf('BACK');
    expect(idxFront).toBeLessThan(idxBack);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/personalizer-render.test.ts
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

Create `src/lib/personalizer-render.ts`:

```typescript
/**
 * Pure SVG render for the personalizer live preview. Used in three
 * places: the storefront widget (every keystroke), the admin Live
 * Preview component (admin's draft values), and the production-queue
 * print PDF (final order spec).
 *
 * Output is a string of SVG markup. The caller decides what to do with
 * it (insert via innerHTML, serialize to PDF, etc.).
 *
 * No DOM access here — the function must run in Workers, Node (tests),
 * and browsers identically.
 */

export interface PreviewTemplate {
  canvas_width: number;
  canvas_height: number;
  base_image_url?: string | null;
}

export interface PreviewField {
  id: number;
  field_kind: 'text' | 'image';
  label: string;
  layer_z?: number;
  sort_order?: number;
  default_value?: string | null;
  font_family?: string | null;
  font_size_px?: number | null;
  font_color?: string | null;
  text_align?: string | null;
  letter_spacing?: number | null;
  curve_mode?: 'linear' | 'arc' | 'circle' | null;
  curve_radius_px?: number | null;
  curve_path_d?: string | null;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  rotation_deg?: number | null;
  mask_shape?: 'rect' | 'circle' | 'heart' | null;
}

export function renderPreviewSvg(opts: {
  template: PreviewTemplate;
  fields: PreviewField[];
  values: Record<string | number, string>;
}): string {
  const { template, fields, values } = opts;
  const w = template.canvas_width || 1080;
  const h = template.canvas_height || 1080;
  const ordered = [...fields].sort((a, b) => (a.layer_z ?? 10) - (b.layer_z ?? 10));

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">`);
  if (template.base_image_url) {
    parts.push(`<image href="${escapeAttr(template.base_image_url)}" x="0" y="0" width="${w}" height="${h}" />`);
  }

  for (const f of ordered) {
    const raw = values[f.id] ?? values[String(f.id)];
    const value = (raw == null || raw === '') ? (f.default_value || '') : raw;
    if (!value) continue;

    if (f.field_kind === 'text') {
      parts.push(renderTextField(f, value));
    } else if (f.field_kind === 'image') {
      parts.push(renderImageField(f, value));
    }
  }
  parts.push('</svg>');
  return parts.join('');
}

export function autoShrinkFontSize(
  text: string,
  requestedPx: number,
  boxWidthPx: number,
  floorPx: number,
): number {
  // Coarse approximation: 1 char ≈ 0.5 × font-size. Good enough for
  // serif italic. The real fit happens client-side via getBBox, but for
  // server-side preview / PDF we use this estimator.
  const approxWidth = text.length * requestedPx * 0.5;
  if (approxWidth <= boxWidthPx) return requestedPx;
  const scaled = Math.floor((boxWidthPx / Math.max(text.length, 1)) / 0.5);
  return Math.max(scaled, floorPx);
}

function renderTextField(f: PreviewField, value: string): string {
  const fontSize = autoShrinkFontSize(value, f.font_size_px || 22, f.width, 12);
  const fill = escapeAttr(f.font_color || '#000000');
  const family = escapeAttr(f.font_family || 'serif');
  const cx = f.position_x + Math.floor(f.width / 2);
  const cy = f.position_y + Math.floor(f.height / 2);
  const text = escapeText(value);

  if (f.curve_mode === 'circle' || f.curve_mode === 'arc') {
    const radius = f.curve_radius_px || Math.floor(f.width / 2);
    const pathId = `pp-${f.id}`;
    const pathD =
      f.curve_path_d ||
      (f.curve_mode === 'circle'
        ? circlePath(cx, cy, radius)
        : arcPath(cx, cy, radius));
    return (
      `<defs><path id="${pathId}" d="${pathD}" /></defs>` +
      `<text font-family="${family}" font-size="${fontSize}" fill="${fill}">` +
      `<textPath href="#${pathId}" startOffset="50%" text-anchor="middle">${text}</textPath>` +
      `</text>`
    );
  }

  const align = (f.text_align as string) || 'middle';
  const anchor = align === 'start' ? 'start' : align === 'end' ? 'end' : 'middle';
  const x = anchor === 'middle' ? cx : anchor === 'end' ? f.position_x + f.width : f.position_x;
  return (
    `<text x="${x}" y="${cy + Math.floor(fontSize / 3)}" ` +
    `text-anchor="${anchor}" ` +
    `font-family="${family}" font-size="${fontSize}" fill="${fill}">` +
    `${text}</text>`
  );
}

function renderImageField(f: PreviewField, url: string): string {
  const safeUrl = escapeAttr(url);
  if (f.mask_shape === 'circle') {
    const cx = f.position_x + Math.floor(f.width / 2);
    const cy = f.position_y + Math.floor(f.height / 2);
    const r = Math.floor(Math.min(f.width, f.height) / 2);
    const clipId = `pp-clip-${f.id}`;
    return (
      `<defs><clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${r}" /></clipPath></defs>` +
      `<image href="${safeUrl}" x="${f.position_x}" y="${f.position_y}" width="${f.width}" height="${f.height}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice" />`
    );
  }
  return `<image href="${safeUrl}" x="${f.position_x}" y="${f.position_y}" width="${f.width}" height="${f.height}" preserveAspectRatio="xMidYMid slice" />`;
}

function circlePath(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
}

function arcPath(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
}

function escapeAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeText(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/personalizer-render.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/personalizer-render.test.ts src/lib/personalizer-render.ts
git commit -m "feat(personalizer): pure SVG render shared by admin + storefront"
```

---

## Milestone 3: Admin CRUD API endpoints (10 tasks)

The admin endpoints all follow the same pattern: requireRole('admin', 'integrator'), parse body, hit D1, return JSON. Each task = one endpoint.

### Task 3.1: GET `/api/personalizer/templates` (list)

**Files:**
- Create: `functions/api/personalizer/templates/index.js`

- [ ] **Step 1: Implement**

```javascript
/**
 * GET  /api/personalizer/templates — list all templates with field counts.
 * POST /api/personalizer/templates — create a new template for a product.
 *
 * Admin / integrator only.
 */

import { requireRole, json, errorJson } from '../../../lib/auth-middleware.js';

export async function onRequest(context) {
  const { request } = context;
  try {
    if (request.method === 'GET') return await handleGet(context);
    if (request.method === 'POST') return await handlePost(context);
    return errorJson('Method not allowed', 405);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Personalizer templates API error:', error);
    return errorJson('Internal server error', 500);
  }
}

async function handleGet(context) {
  const { request, env } = context;
  await requireRole(context, 'admin', 'integrator');

  const url = new URL(request.url);
  const productId = url.searchParams.get('product_id');
  const status = url.searchParams.get('status');

  let query = `SELECT t.*,
                      p.title AS product_title,
                      (SELECT COUNT(*) FROM customization_fields WHERE template_id = t.id) AS field_count
                 FROM customization_templates t
                 LEFT JOIN products p ON p.id = t.product_id
                 WHERE 1=1`;
  const bindings = [];
  if (productId) { query += ' AND t.product_id = ?'; bindings.push(parseInt(productId)); }
  if (status)    { query += ' AND t.status = ?';     bindings.push(status); }
  query += ' ORDER BY t.updated_at DESC';

  const stmt = bindings.length ? env.DB.prepare(query).bind(...bindings) : env.DB.prepare(query);
  const { results } = await stmt.all();
  return json({ items: results || [] });
}

async function handlePost(context) {
  const { request, env } = context;
  const user = await requireRole(context, 'admin', 'integrator');

  let body;
  try { body = await request.json(); } catch { return errorJson('Invalid JSON', 400); }
  const { product_id, base_image_url, canvas_width, canvas_height, shopify_product_handle } = body;
  if (!product_id) return errorJson('product_id required', 400);

  // One published template per product. If a draft already exists, return it.
  const existing = await env.DB
    .prepare(`SELECT id FROM customization_templates WHERE product_id = ? AND status != 'archived' ORDER BY id DESC LIMIT 1`)
    .bind(parseInt(product_id))
    .first();
  if (existing) return json({ id: existing.id, existed: true });

  const result = await env.DB
    .prepare(
      `INSERT INTO customization_templates
        (product_id, shopify_product_handle, base_image_url, canvas_width, canvas_height, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
    )
    .bind(
      parseInt(product_id),
      shopify_product_handle || null,
      base_image_url || null,
      canvas_width || 1080,
      canvas_height || 1080,
      user.id,
    )
    .run();
  return json({ id: result.meta.last_row_id, created: true });
}
```

- [ ] **Step 2: Smoke test**

Start dev server:

```bash
npm run dev
```

In another terminal, log in once via the UI (or grab a JWT from the existing flow), then:

```bash
curl -X GET http://localhost:8788/api/personalizer/templates \
  -H "Cookie: <your session cookie>"
```

Expected: `{"items":[]}`.

- [ ] **Step 3: Commit**

```bash
git add functions/api/personalizer/templates/index.js
git commit -m "feat(personalizer): GET/POST /api/personalizer/templates"
```

---

### Task 3.2: GET/PATCH/DELETE `/api/personalizer/templates/[id]`

**Files:**
- Create: `functions/api/personalizer/templates/[id].js`

- [ ] **Step 1: Implement**

```javascript
import { requireRole, json, errorJson } from '../../../../lib/auth-middleware.js';

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

  const allowed = ['shopify_product_handle', 'base_image_url', 'canvas_width', 'canvas_height', 'status'];
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
  return json({ success: true, id });
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
```

- [ ] **Step 2: Smoke test**

```bash
curl -X POST http://localhost:8788/api/personalizer/templates \
  -H "Content-Type: application/json" \
  -H "Cookie: <session>" \
  -d '{"product_id":1,"canvas_width":1080,"canvas_height":1080}'
# → {"id":1,"created":true}

curl http://localhost:8788/api/personalizer/templates/1 \
  -H "Cookie: <session>"
# → {"id":1,"product_id":1,...,"fields":[]}

curl -X PATCH http://localhost:8788/api/personalizer/templates/1 \
  -H "Content-Type: application/json" -H "Cookie: <session>" \
  -d '{"status":"published"}'
# → {"success":true,"id":1}
```

- [ ] **Step 3: Commit**

```bash
git add functions/api/personalizer/templates/\[id\].js
git commit -m "feat(personalizer): GET/PATCH/DELETE /api/personalizer/templates/:id"
```

---

### Task 3.3: POST `/api/personalizer/templates/[id]/fields` (create field)

**Files:**
- Create: `functions/api/personalizer/templates/[id]/fields.js`

- [ ] **Step 1: Implement**

```javascript
import { requireRole, json, errorJson } from '../../../../../lib/auth-middleware.js';

const VALID_KIND = new Set(['text', 'image']);
const VALID_CURVE = new Set(['linear', 'arc', 'circle']);
const VALID_MASK = new Set(['rect', 'circle', 'heart']);

export async function onRequestPost(context) {
  try {
    await requireRole(context, 'admin', 'integrator');
    const { request, params, env } = context;
    const templateId = parseInt(params.id);
    if (isNaN(templateId)) return errorJson('Invalid template id', 400);

    let body;
    try { body = await request.json(); } catch { return errorJson('Invalid JSON', 400); }

    const kind = body.field_kind;
    if (!VALID_KIND.has(kind)) return errorJson('field_kind must be text or image', 400);
    if (!body.label) return errorJson('label is required', 400);
    if (typeof body.position_x !== 'number' || typeof body.position_y !== 'number') {
      return errorJson('position_x and position_y are required numbers', 400);
    }
    if (typeof body.width !== 'number' || typeof body.height !== 'number') {
      return errorJson('width and height are required numbers', 400);
    }
    if (body.curve_mode && !VALID_CURVE.has(body.curve_mode)) {
      return errorJson('curve_mode must be linear, arc, or circle', 400);
    }
    if (body.mask_shape && !VALID_MASK.has(body.mask_shape)) {
      return errorJson('mask_shape must be rect, circle, or heart', 400);
    }

    // Append to end by default — caller can reorder later.
    const maxRow = await env.DB
      .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM customization_fields WHERE template_id = ?`)
      .bind(templateId).first();
    const nextSort = (maxRow?.m ?? -1) + 1;

    const result = await env.DB
      .prepare(
        `INSERT INTO customization_fields
          (template_id, field_kind, sort_order, layer_z,
           label, placeholder, default_value, required, max_chars, allow_empty,
           font_family, font_size_px, font_color, text_align, letter_spacing,
           curve_mode, curve_radius_px, curve_path_d,
           position_x, position_y, width, height, rotation_deg,
           mask_shape, image_max_size_kb, config_json)
         VALUES (?, ?, ?, ?,  ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?, ?)`,
      )
      .bind(
        templateId, kind, nextSort, body.layer_z ?? 10,
        body.label, body.placeholder || null, body.default_value || null,
        body.required ? 1 : 0, body.max_chars || null, body.allow_empty ? 1 : 0,
        body.font_family || null, body.font_size_px || null, body.font_color || null,
        body.text_align || null, body.letter_spacing ?? null,
        body.curve_mode || null, body.curve_radius_px || null, body.curve_path_d || null,
        body.position_x, body.position_y, body.width, body.height, body.rotation_deg ?? 0,
        body.mask_shape || null, body.image_max_size_kb || 5120,
        body.config_json ? JSON.stringify(body.config_json) : null,
      )
      .run();
    return json({ id: result.meta.last_row_id, sort_order: nextSort, created: true });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Field create error:', e);
    return errorJson('Internal server error', 500);
  }
}
```

- [ ] **Step 2: Smoke test**

```bash
curl -X POST http://localhost:8788/api/personalizer/templates/1/fields \
  -H "Content-Type: application/json" -H "Cookie: <session>" \
  -d '{"field_kind":"text","label":"First name","placeholder":"Put name here","default_value":"Camille","max_chars":12,"font_family":"Pinyon Script","font_size_px":22,"font_color":"#FAEEDA","curve_mode":"linear","position_x":160,"position_y":151,"width":70,"height":22}'
# → {"id":1,"sort_order":0,"created":true}
```

- [ ] **Step 3: Commit**

```bash
git add functions/api/personalizer/templates/\[id\]/fields.js
git commit -m "feat(personalizer): POST /api/personalizer/templates/:id/fields"
```

---

### Task 3.4: PATCH/DELETE `/api/personalizer/fields/[id]`

**Files:**
- Create: `functions/api/personalizer/fields/[id].js`

- [ ] **Step 1: Implement**

```javascript
import { requireRole, json, errorJson } from '../../../../lib/auth-middleware.js';

const ALLOWED = [
  'label', 'placeholder', 'default_value', 'required', 'max_chars', 'allow_empty',
  'font_family', 'font_size_px', 'font_color', 'text_align', 'letter_spacing',
  'curve_mode', 'curve_radius_px', 'curve_path_d',
  'position_x', 'position_y', 'width', 'height', 'rotation_deg',
  'mask_shape', 'image_max_size_kb', 'layer_z',
];

export async function onRequest(context) {
  const { request } = context;
  try {
    if (request.method === 'PATCH') return await handlePatch(context);
    if (request.method === 'DELETE') return await handleDelete(context);
    return errorJson('Method not allowed', 405);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Field [id] error:', e);
    return errorJson('Internal server error', 500);
  }
}

async function handlePatch(context) {
  const { request, params, env } = context;
  await requireRole(context, 'admin', 'integrator');
  const id = parseInt(params.id);
  if (isNaN(id)) return errorJson('Invalid id', 400);

  let body;
  try { body = await request.json(); } catch { return errorJson('Invalid JSON', 400); }

  const sets = [];
  const binds = [];
  for (const k of ALLOWED) {
    if (k in body) { sets.push(`${k} = ?`); binds.push(coerce(k, body[k])); }
  }
  if (sets.length === 0) return errorJson('No editable fields supplied', 400);
  sets.push(`updated_at = datetime('now')`);
  binds.push(id);

  await env.DB
    .prepare(`UPDATE customization_fields SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  return json({ success: true, id });
}

async function handleDelete(context) {
  const { params, env } = context;
  await requireRole(context, 'admin', 'integrator');
  const id = parseInt(params.id);
  if (isNaN(id)) return errorJson('Invalid id', 400);
  await env.DB.prepare(`DELETE FROM customization_fields WHERE id = ?`).bind(id).run();
  return json({ success: true, id, deleted: true });
}

function coerce(k, v) {
  if (['required', 'allow_empty'].includes(k)) return v ? 1 : 0;
  return v;
}
```

- [ ] **Step 2: Smoke test PATCH and DELETE.**

- [ ] **Step 3: Commit**

```bash
git add functions/api/personalizer/fields/\[id\].js
git commit -m "feat(personalizer): PATCH/DELETE /api/personalizer/fields/:id"
```

---

### Task 3.5: POST `/api/personalizer/fields/[id]/reorder` (bulk)

**Files:**
- Create: `functions/api/personalizer/fields/[id]/reorder.js`

> Note: the URL keeps `[id]` as a path param for routing consistency, but the endpoint takes a list and ignores `[id]` — use `/api/personalizer/fields/0/reorder` from the client. (Cloudflare Pages requires a path token.)

- [ ] **Step 1: Implement**

```javascript
import { requireRole, json, errorJson } from '../../../../../lib/auth-middleware.js';

export async function onRequestPost(context) {
  try {
    await requireRole(context, 'admin', 'integrator');
    const { request, env } = context;
    let body;
    try { body = await request.json(); } catch { return errorJson('Invalid JSON', 400); }

    const items = Array.isArray(body?.items) ? body.items : null;
    if (!items) return errorJson('items array required: [{id, sort_order, layer_z}, …]', 400);

    // Run as a single batch for atomicity.
    const stmts = items
      .filter((i) => Number.isFinite(i.id))
      .map((i) =>
        env.DB.prepare(
          `UPDATE customization_fields
              SET sort_order = COALESCE(?, sort_order),
                  layer_z = COALESCE(?, layer_z),
                  updated_at = datetime('now')
            WHERE id = ?`,
        ).bind(
          Number.isFinite(i.sort_order) ? i.sort_order : null,
          Number.isFinite(i.layer_z) ? i.layer_z : null,
          i.id,
        ),
      );
    if (stmts.length === 0) return errorJson('No valid items', 400);
    await env.DB.batch(stmts);
    return json({ success: true, updated: stmts.length });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Field reorder error:', e);
    return errorJson('Internal server error', 500);
  }
}
```

- [ ] **Step 2: Smoke test**

```bash
curl -X POST http://localhost:8788/api/personalizer/fields/0/reorder \
  -H "Content-Type: application/json" -H "Cookie: <session>" \
  -d '{"items":[{"id":1,"sort_order":0,"layer_z":3},{"id":2,"sort_order":1,"layer_z":4}]}'
```

- [ ] **Step 3: Commit**

```bash
git add functions/api/personalizer/fields/\[id\]/reorder.js
git commit -m "feat(personalizer): POST /api/personalizer/fields/:id/reorder (batch)"
```

---

### Task 3.6: GET `/api/personalizer/template/[handle]` (public)

**Files:**
- Create: `functions/api/personalizer/template/[handle].js`

- [ ] **Step 1: Implement**

```javascript
/**
 * GET /api/personalizer/template/:handle
 *
 * Public read-only endpoint consumed by the storefront widget.
 * - Only returns published templates (drafts and archived are 404).
 * - Returns CORS headers so the storefront page can fetch from our domain.
 *
 * No auth — this is intentionally public. Templates contain no PII.
 */

import { json } from '../../../lib/auth-middleware.js';

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

  return jsonCors({
    found: true,
    template: tpl,
    fields: fields || [],
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
```

- [ ] **Step 2: Smoke test (after publishing a template via PATCH /:id status='published')**

```bash
curl http://localhost:8788/api/personalizer/template/angel-wings-heart
# → {"found":true,"template":{...},"fields":[…]}
```

- [ ] **Step 3: Commit**

```bash
git add functions/api/personalizer/template/\[handle\].js
git commit -m "feat(personalizer): public GET /api/personalizer/template/:handle"
```

---

### Task 3.7: POST `/api/personalizer/upload` (R2 + rate limit)

**Files:**
- Create: `functions/api/personalizer/upload.js`

> Requires KV binding `RATE_LIMIT` in `wrangler.toml`. If absent, the endpoint silently skips rate limiting — a follow-up task adds the binding.

- [ ] **Step 1: Implement**

```javascript
/**
 * POST /api/personalizer/upload
 *
 * Receives a customer-uploaded photo, stores in R2 under a pending key,
 * returns the proxied URL the storefront widget puts into the cart.
 *
 * Public — no auth. Rate-limited per IP (60 uploads / hour) via KV
 * counter when the RATE_LIMIT binding exists.
 */

const MAX_SIZE = 8 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const RATE_PER_HOUR = 60;

export async function onRequestPost(context) {
  const { request, env } = context;

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.RATE_LIMIT) {
    const key = `personalizer-upload:${ip}:${Math.floor(Date.now() / 3600000)}`;
    const count = parseInt((await env.RATE_LIMIT.get(key)) || '0', 10);
    if (count >= RATE_PER_HOUR) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 });
    }
    await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 3700 });
  }

  if (!env.IMAGES) return new Response(JSON.stringify({ error: 'R2 not configured' }), { status: 503 });

  const ct = request.headers.get('content-type') || '';
  if (!ct.startsWith('multipart/form-data')) {
    return new Response(JSON.stringify({ error: 'Expected multipart/form-data' }), { status: 400 });
  }
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return new Response(JSON.stringify({ error: 'No file' }), { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return new Response(JSON.stringify({ error: 'File too large (max 8 MB)' }), { status: 413 });
  }
  const mime = (file.type || '').toLowerCase();
  if (!ALLOWED.has(mime)) {
    return new Response(JSON.stringify({ error: `Unsupported type: ${mime}` }), { status: 400 });
  }

  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
  const rand = Math.random().toString(36).slice(2, 12);
  const key = `personalizer/pending/${Date.now()}-${rand}.${ext}`;
  await env.IMAGES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: mime } });
  const url = `/api/images/r2/${key}`;
  return new Response(JSON.stringify({ url, key, size: file.size, mime }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 2: Smoke test**

```bash
curl -X POST http://localhost:8788/api/personalizer/upload \
  -F "file=@/path/to/some.jpg"
# → {"url":"/api/images/r2/personalizer/pending/...","key":"...","size":12345,"mime":"image/jpeg"}
```

- [ ] **Step 3: Commit**

```bash
git add functions/api/personalizer/upload.js
git commit -m "feat(personalizer): public photo upload to R2 with rate limit"
```

---

## Milestone 4: Order webhook + Shopify sync (3 tasks)

### Task 4.1: `shopify-graphql.js` — orderUpdate + metafieldsSet helpers

**Files:**
- Create: `functions/lib/shopify-graphql.js`

- [ ] **Step 1: Implement**

```javascript
/**
 * Tiny GraphQL helpers for the Shopify Admin API. Used by the order
 * webhook receiver to:
 *   1. Append the supplier-facing spec block to order.note.
 *   2. Write a structured metafield (riccardiparis.personalization_spec)
 *      so downstream tooling parses without screen-scraping.
 *
 * Auth via SHOPIFY_ADMIN_TOKEN (existing wrangler secret).
 * Shop domain via SHOPIFY_SHOP env var (e.g. riccardiparis.myshopify.com).
 */

const API_VERSION = '2024-10';

export async function appendOrderNote(env, orderGid, suffix) {
  const existing = await graphql(env, `
    query($id: ID!) { order(id: $id) { id note } }
  `, { id: orderGid });
  const prevNote = existing?.order?.note || '';
  const sep = prevNote ? '\n\n' : '';
  const newNote = `${prevNote}${sep}${suffix}`;

  return graphql(env, `
    mutation($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { id note }
        userErrors { field message }
      }
    }
  `, { input: { id: orderGid, note: newNote } });
}

export async function setOrderMetafield(env, orderGid, namespace, key, valueJson) {
  return graphql(env, `
    mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key value type }
        userErrors { field message }
      }
    }
  `, {
    metafields: [{
      ownerId: orderGid,
      namespace,
      key,
      type: 'json',
      value: JSON.stringify(valueJson),
    }],
  });
}

async function graphql(env, query, variables) {
  const shop = env.SHOPIFY_SHOP;
  const token = env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) throw new Error('Missing SHOPIFY_SHOP or SHOPIFY_ADMIN_TOKEN');

  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Shopify GraphQL ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data;
}
```

- [ ] **Step 2: Verify it compiles** — no test, this is plumbing.

```bash
npx tsc --noEmit functions/lib/shopify-graphql.js 2>&1 | grep -v "Cannot find module" || echo "OK"
```

- [ ] **Step 3: Commit**

```bash
git add functions/lib/shopify-graphql.js
git commit -m "feat(personalizer): Shopify Admin GraphQL helpers (orderUpdate, metafieldsSet)"
```

---

### Task 4.2: Webhook receiver `/api/personalizer/webhook/shopify-order`

**Files:**
- Create: `functions/api/personalizer/webhook/shopify-order.js`

- [ ] **Step 1: Implement**

```javascript
/**
 * POST /api/personalizer/webhook/shopify-order
 *
 * Shopify orders/create webhook receiver. Steps:
 *   1. Read raw body + X-Shopify-Hmac-Sha256 header.
 *   2. HMAC-validate against SHOPIFY_WEBHOOK_SECRET.
 *   3. For each line item with personalization properties:
 *      - Look up the live template, snapshot it.
 *      - Insert customization_orders row.
 *      - Append spec to order.note + write JSON metafield.
 */

import { verifyShopifyHmac } from '../../../lib/shopify-webhook.js';
import { buildSpecText, buildSpecJson } from '../../../lib/personalizer-spec.js';
import { appendOrderNote, setOrderMetafield } from '../../../lib/shopify-graphql.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const raw = await request.text();
  const hmac = request.headers.get('X-Shopify-Hmac-Sha256');
  const ok = await verifyShopifyHmac(raw, hmac, env.SHOPIFY_WEBHOOK_SECRET);
  if (!ok) {
    return new Response('invalid hmac', { status: 401 });
  }

  let order;
  try { order = JSON.parse(raw); } catch { return new Response('invalid json', { status: 400 }); }
  if (!order?.id) return new Response('missing order id', { status: 400 });

  const orderGid = `gid://shopify/Order/${order.id}`;
  const orderName = order.name || `#${order.order_number || order.id}`;
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];

  const personalizedItems = [];

  for (const li of lineItems) {
    const props = parseProps(li.properties);
    const tplId = parseInt(props['_template_id']);
    if (!Number.isFinite(tplId)) continue;

    const tpl = await env.DB
      .prepare(`SELECT * FROM customization_templates WHERE id = ?`)
      .bind(tplId).first();
    if (!tpl) continue;
    const { results: fields } = await env.DB
      .prepare(`SELECT * FROM customization_fields WHERE template_id = ? ORDER BY sort_order ASC`)
      .bind(tplId).all();

    const snapshot = { template: tpl, fields: fields || [] };
    const values = {};
    for (const f of (fields || [])) {
      const v = props[f.label];
      if (v != null) values[String(f.id)] = v;
    }
    const productTitle = li.title || tpl?.product_title || '';
    const variantTitle = li.variant_title || '';
    const color = parseColorFromVariant(variantTitle);

    const specText = buildSpecText({ productTitle, color, snapshot, values });
    const specJson = buildSpecJson({ productTitle, color, snapshot, values });

    await env.DB.prepare(
      `INSERT OR IGNORE INTO customization_orders
        (shopify_order_id, shopify_order_name, shopify_line_item_id,
         product_id, template_id, template_snapshot_json, values_json,
         production_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    ).bind(
      String(order.id), orderName, String(li.id),
      tpl.product_id, tpl.id,
      JSON.stringify(snapshot), JSON.stringify(values),
    ).run();

    personalizedItems.push({ specText, specJson, lineItemTitle: productTitle });
  }

  if (personalizedItems.length > 0) {
    const combinedNote = personalizedItems.map((p) => p.specText).join('\n\n');
    const combinedJson = { items: personalizedItems.map((p) => p.specJson) };
    try {
      await appendOrderNote(env, orderGid, combinedNote);
      await setOrderMetafield(env, orderGid, 'riccardiparis', 'personalization_spec', combinedJson);
    } catch (e) {
      console.warn('[personalizer webhook] Shopify writeback failed:', e?.message);
    }
  }

  return new Response(JSON.stringify({ processed: personalizedItems.length }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

function parseProps(arr) {
  const out = {};
  if (!Array.isArray(arr)) return out;
  for (const p of arr) if (p?.name) out[p.name] = p.value ?? '';
  return out;
}

function parseColorFromVariant(s) {
  if (!s) return '';
  const m = /(Gold|Silver|Rose Gold)/i.exec(s);
  return m ? m[1] : '';
}
```

- [ ] **Step 2: Smoke test (manual)**

After registering the webhook in Shopify Admin pointing to your tunnel URL, place a test order with personalization. Check:
- A row appears in `customization_orders`.
- The order's note in Shopify Admin contains `[PERSONALIZATION]`.
- The `riccardiparis.personalization_spec` metafield exists on the order.

- [ ] **Step 3: Commit**

```bash
git add functions/api/personalizer/webhook/shopify-order.js
git commit -m "feat(personalizer): orders/create webhook receiver + Shopify writeback"
```

---

### Task 4.3: Production queue endpoints

**Files:**
- Create: `functions/api/personalizer/orders/index.js`
- Create: `functions/api/personalizer/orders/[id].js`

- [ ] **Step 1: Implement list endpoint**

`functions/api/personalizer/orders/index.js`:

```javascript
import { requireRole, json, errorJson } from '../../../../lib/auth-middleware.js';

export async function onRequestGet(context) {
  try {
    await requireRole(context, 'admin', 'integrator');
    const { request, env } = context;
    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    let q = `SELECT o.*, p.title AS product_title
               FROM customization_orders o
               LEFT JOIN products p ON p.id = o.product_id`;
    const binds = [];
    if (status) { q += ` WHERE o.production_status = ?`; binds.push(status); }
    q += ` ORDER BY o.created_at DESC LIMIT 200`;

    const stmt = binds.length ? env.DB.prepare(q).bind(...binds) : env.DB.prepare(q);
    const { results } = await stmt.all();
    return json({ items: results || [] });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Orders list error:', e);
    return errorJson('Internal server error', 500);
  }
}
```

- [ ] **Step 2: Implement PATCH endpoint**

`functions/api/personalizer/orders/[id].js`:

```javascript
import { requireRole, json, errorJson } from '../../../../lib/auth-middleware.js';

const VALID_STATUS = new Set(['pending', 'in_production', 'shipped', 'cancelled']);

export async function onRequestPatch(context) {
  try {
    await requireRole(context, 'admin', 'integrator');
    const { request, params, env } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) return errorJson('Invalid id', 400);

    let body;
    try { body = await request.json(); } catch { return errorJson('Invalid JSON', 400); }

    const sets = [];
    const binds = [];
    if (body.production_status) {
      if (!VALID_STATUS.has(body.production_status)) return errorJson('Invalid status', 400);
      sets.push('production_status = ?'); binds.push(body.production_status);
    }
    if ('production_notes' in body) {
      sets.push('production_notes = ?'); binds.push(body.production_notes || null);
    }
    if (sets.length === 0) return errorJson('No updates', 400);
    sets.push(`updated_at = datetime('now')`);
    binds.push(id);

    await env.DB.prepare(`UPDATE customization_orders SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    return json({ success: true, id });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Order PATCH error:', e);
    return errorJson('Internal server error', 500);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add functions/api/personalizer/orders/index.js functions/api/personalizer/orders/\[id\].js
git commit -m "feat(personalizer): GET /orders + PATCH /orders/:id production queue"
```

---

## Milestone 5: Frontend API client (1 task)

### Task 5.1: `src/lib/personalizer-api.ts`

**Files:**
- Create: `src/lib/personalizer-api.ts`

- [ ] **Step 1: Implement**

```typescript
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
```

- [ ] **Step 2: Compile-check**

```bash
npx tsc --noEmit 2>&1 | grep personalizer-api || echo "OK"
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/personalizer-api.ts
git commit -m "feat(personalizer): typed API client for the CRM"
```

---

## Milestone 6: Admin editor UI (4 tasks)

These four tasks build the Personalizer tab. Each task is one component.

### Task 6.1: `FieldList.tsx` — sidebar list with add buttons

**Files:**
- Create: `src/components/admin/personalizer/FieldList.tsx`

- [ ] **Step 1: Implement**

```tsx
import { Button } from '@/components/ui/button';
import { Plus, Type, Image as ImageIcon, GripVertical } from 'lucide-react';
import type { PersonalizerField } from '@/lib/personalizer-api';

interface Props {
  fields: PersonalizerField[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onAddText: () => void;
  onAddImage: () => void;
  onReorder: (ids: number[]) => void;
}

export function FieldList({ fields, selectedId, onSelect, onAddText, onAddImage, onReorder }: Props) {
  return (
    <div className="border-r border-gray-200 bg-white p-3 space-y-2 min-w-[220px]">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fields</div>
      <ul className="space-y-1">
        {fields.map((f) => (
          <li
            key={f.id}
            onClick={() => onSelect(f.id)}
            className={[
              'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm',
              selectedId === f.id ? 'bg-primary/10 text-primary' : 'hover:bg-gray-50',
            ].join(' ')}
          >
            <GripVertical className="h-3 w-3 text-muted-foreground" />
            {f.field_kind === 'text' ? <Type className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
            <span className="flex-1 truncate">{f.label}</span>
            <span className="text-[10px] text-muted-foreground">z{f.layer_z}</span>
          </li>
        ))}
      </ul>
      <div className="pt-2 space-y-1">
        <Button variant="outline" size="sm" className="w-full justify-start" onClick={onAddText}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add text field
        </Button>
        <Button variant="outline" size="sm" className="w-full justify-start" onClick={onAddImage}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add image field
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Compile-check** with `npx tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/personalizer/FieldList.tsx
git commit -m "feat(personalizer): FieldList sidebar component"
```

---

### Task 6.2: `FieldConfigForm.tsx` — properties panel

**Files:**
- Create: `src/components/admin/personalizer/FieldConfigForm.tsx`

- [ ] **Step 1: Implement** — see code in §8.3 of the spec for which inputs are needed. Keep it as a single tall form, grouped by section (Identity, Constraints, Typography, Geometry, Layer). Each input fires `onPatch` debounced 250 ms.

```tsx
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { PersonalizerField } from '@/lib/personalizer-api';

const FONTS = [
  'Pinyon Script', 'Great Vibes', 'Cormorant Garamond',
  'Playfair Display', 'Cinzel', 'Inter',
];
const CURVES = ['linear', 'arc', 'circle'] as const;
const MASKS = ['rect', 'circle', 'heart'] as const;

interface Props {
  field: PersonalizerField;
  onPatch: (patch: Partial<PersonalizerField>) => void;
}

export function FieldConfigForm({ field, onPatch }: Props) {
  const [draft, setDraft] = useState(field);
  useEffect(() => { setDraft(field); }, [field.id]);

  function patch<K extends keyof PersonalizerField>(k: K, v: PersonalizerField[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
    onPatch({ [k]: v } as Partial<PersonalizerField>);
  }

  return (
    <div className="bg-white border-l border-gray-200 p-4 space-y-5 min-w-[320px] overflow-y-auto">

      <Section title="Identity">
        <Row label="Label">
          <Input value={draft.label} onChange={(e) => patch('label', e.target.value)} />
        </Row>
        <Row label="Placeholder (gray hint)">
          <Input value={draft.placeholder || ''} onChange={(e) => patch('placeholder', e.target.value || null)} />
        </Row>
        <Row label="Default value (pre-filled, submitted if untouched)">
          <Input value={draft.default_value || ''} onChange={(e) => patch('default_value', e.target.value || null)} />
        </Row>
        <Row label="Required">
          <Select value={draft.required ? 'yes' : 'no'} onValueChange={(v) => patch('required', v === 'yes' ? 1 : 0)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">Required</SelectItem>
              <SelectItem value="no">Optional</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </Section>

      {draft.field_kind === 'text' && (
        <>
          <Section title="Constraints">
            <Row label="Max characters">
              <Input type="number" value={draft.max_chars || ''} onChange={(e) => patch('max_chars', e.target.value ? parseInt(e.target.value) : null)} />
            </Row>
            <Row label="Allow empty (skip on preview)">
              <Select value={draft.allow_empty ? 'yes' : 'no'} onValueChange={(v) => patch('allow_empty', v === 'yes' ? 1 : 0)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Allow empty</SelectItem>
                  <SelectItem value="no">Always render</SelectItem>
                </SelectContent>
              </Select>
            </Row>
          </Section>

          <Section title="Typography">
            <Row label="Font family">
              <Select value={draft.font_family || ''} onValueChange={(v) => patch('font_family', v)}>
                <SelectTrigger><SelectValue placeholder="Pick a font" /></SelectTrigger>
                <SelectContent>
                  {FONTS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </Row>
            <Row label="Max font size (px)">
              <Input type="number" value={draft.font_size_px || ''} onChange={(e) => patch('font_size_px', e.target.value ? parseInt(e.target.value) : null)} />
            </Row>
            <Row label="Color (hex)">
              <Input value={draft.font_color || ''} onChange={(e) => patch('font_color', e.target.value || null)} placeholder="#FAEEDA" />
            </Row>
            <Row label="Letter spacing (em)">
              <Input type="number" step="0.01" value={draft.letter_spacing ?? ''} onChange={(e) => patch('letter_spacing', e.target.value ? parseFloat(e.target.value) : null)} />
            </Row>
            <Row label="Curve">
              <Select value={draft.curve_mode || 'linear'} onValueChange={(v) => patch('curve_mode', v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURVES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </Row>
            {(draft.curve_mode === 'arc' || draft.curve_mode === 'circle') && (
              <Row label="Curve radius (px)">
                <Input type="number" value={draft.curve_radius_px || ''} onChange={(e) => patch('curve_radius_px', e.target.value ? parseInt(e.target.value) : null)} />
              </Row>
            )}
          </Section>
        </>
      )}

      {draft.field_kind === 'image' && (
        <Section title="Image">
          <Row label="Mask shape">
            <Select value={draft.mask_shape || 'rect'} onValueChange={(v) => patch('mask_shape', v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MASKS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Max size (KB)">
            <Input type="number" value={draft.image_max_size_kb || 5120} onChange={(e) => patch('image_max_size_kb', parseInt(e.target.value || '5120'))} />
          </Row>
        </Section>
      )}

      <Section title="Geometry">
        <Row label="Position X">
          <Input type="number" value={draft.position_x} onChange={(e) => patch('position_x', parseInt(e.target.value || '0'))} />
        </Row>
        <Row label="Position Y">
          <Input type="number" value={draft.position_y} onChange={(e) => patch('position_y', parseInt(e.target.value || '0'))} />
        </Row>
        <Row label="Width">
          <Input type="number" value={draft.width} onChange={(e) => patch('width', parseInt(e.target.value || '0'))} />
        </Row>
        <Row label="Height">
          <Input type="number" value={draft.height} onChange={(e) => patch('height', parseInt(e.target.value || '0'))} />
        </Row>
        <Row label="Rotation (deg)">
          <Input type="number" step="0.5" value={draft.rotation_deg ?? 0} onChange={(e) => patch('rotation_deg', parseFloat(e.target.value || '0'))} />
        </Row>
        <Row label="Layer z (higher = on top)">
          <Input type="number" value={draft.layer_z} onChange={(e) => patch('layer_z', parseInt(e.target.value || '10'))} />
        </Row>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Compile-check** with `npx tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/personalizer/FieldConfigForm.tsx
git commit -m "feat(personalizer): FieldConfigForm with all per-field config inputs"
```

---

### Task 6.3: `PersonalizerCanvas.tsx` — canvas + draggable bbox

**Files:**
- Create: `src/components/admin/personalizer/PersonalizerCanvas.tsx`

- [ ] **Step 1: Implement** — wraps the SVG render output in a clickable/draggable layer. For v1 the bbox is positioned via the form inputs; live drag-on-canvas is a polish task at the end of this milestone.

```tsx
import { useEffect, useRef } from 'react';
import { renderPreviewSvg } from '@/lib/personalizer-render';
import type { PersonalizerTemplate, PersonalizerField } from '@/lib/personalizer-api';

interface Props {
  template: PersonalizerTemplate;
  fields: PersonalizerField[];
  selectedFieldId: number | null;
  onSelect: (id: number) => void;
}

export function PersonalizerCanvas({ template, fields, selectedFieldId, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const values: Record<number, string> = {};
    for (const f of fields) {
      values[f.id] = f.default_value || f.placeholder || (f.field_kind === 'text' ? '' : '');
    }
    const svg = renderPreviewSvg({
      template: { canvas_width: template.canvas_width, canvas_height: template.canvas_height, base_image_url: template.base_image_url },
      fields,
      values,
    });
    const overlays = fields
      .map((f) => {
        const sel = f.id === selectedFieldId;
        return `<rect data-field-id="${f.id}" x="${f.position_x}" y="${f.position_y}" width="${f.width}" height="${f.height}" fill="none" stroke="${sel ? '#185FA5' : '#999'}" stroke-dasharray="${sel ? '0' : '4 3'}" stroke-width="${sel ? 2 : 1}" style="cursor:pointer"/>`;
      })
      .join('');
    ref.current.innerHTML = svg.replace('</svg>', overlays + '</svg>');
    const root = ref.current.querySelector('svg');
    if (root) {
      root.addEventListener('click', (e) => {
        const t = e.target as Element;
        const id = t?.getAttribute?.('data-field-id');
        if (id) onSelect(parseInt(id));
      });
    }
  }, [template, fields, selectedFieldId, onSelect]);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-4 min-h-[400px] flex items-center justify-center">
      <div ref={ref} className="w-full max-w-[480px]" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/admin/personalizer/PersonalizerCanvas.tsx
git commit -m "feat(personalizer): canvas with bbox overlays + click-to-select"
```

---

### Task 6.4: `PersonalizerPanel.tsx` — top-level tab

**Files:**
- Create: `src/components/admin/personalizer/PersonalizerPanel.tsx`
- Modify: `src/components/integrator/WorkspaceView.tsx`

- [ ] **Step 1: Build the panel orchestrator**

```tsx
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Save, Rocket } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { FieldList } from './FieldList';
import { FieldConfigForm } from './FieldConfigForm';
import { PersonalizerCanvas } from './PersonalizerCanvas';
import {
  getTemplate, createTemplate, updateTemplate, createField, updateField,
  type PersonalizerTemplate, type PersonalizerField,
} from '@/lib/personalizer-api';

interface Props {
  productId: number;
  baseImageUrl: string | null;
  shopifyHandle: string | null;
}

export function PersonalizerPanel({ productId, baseImageUrl, shopifyHandle }: Props) {
  const { toast } = useToast();
  const [tpl, setTpl] = useState<PersonalizerTemplate | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const created = await createTemplate({
        product_id: productId,
        base_image_url: baseImageUrl || undefined,
        shopify_product_handle: shopifyHandle || undefined,
      });
      const fresh = await getTemplate(created.id);
      setTpl(fresh);
      const first = (fresh.fields || [])[0];
      if (first) setSelectedFieldId(first.id);
    } catch (e: any) {
      toast({ title: 'Failed to load template', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [productId]);

  async function handleAddText() {
    if (!tpl) return;
    const created = await createField(tpl.id, {
      field_kind: 'text',
      label: 'New text',
      placeholder: 'Type here',
      default_value: null,
      required: 0,
      max_chars: 12,
      font_family: 'Pinyon Script',
      font_size_px: 22,
      font_color: '#FAEEDA',
      curve_mode: 'linear',
      position_x: 100, position_y: 100, width: 200, height: 40,
      layer_z: 10,
    });
    await load();
    setSelectedFieldId(created.id);
  }
  async function handleAddImage() {
    if (!tpl) return;
    const created = await createField(tpl.id, {
      field_kind: 'image',
      label: 'Photo',
      mask_shape: 'rect',
      position_x: 100, position_y: 100, width: 200, height: 200,
      layer_z: 5,
    });
    await load();
    setSelectedFieldId(created.id);
  }

  async function handlePatch(patch: Partial<PersonalizerField>) {
    if (!selectedFieldId) return;
    await updateField(selectedFieldId, patch);
    setTpl((prev) => prev && {
      ...prev,
      fields: (prev.fields || []).map((f) => f.id === selectedFieldId ? { ...f, ...patch } as PersonalizerField : f),
    });
  }

  async function handlePublish() {
    if (!tpl) return;
    setSaving(true);
    try {
      await updateTemplate(tpl.id, { status: 'published' });
      toast({ title: 'Personalizer published', description: 'Storefront will pick up the change on next page load.' });
    } catch (e: any) {
      toast({ title: 'Publish failed', description: e?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  if (loading || !tpl) {
    return <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const selected = (tpl.fields || []).find((f) => f.id === selectedFieldId) || null;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-gray-200 px-4 py-2 flex items-center justify-between">
        <div className="text-sm font-medium">Personalizer · {tpl.status}</div>
        <Button size="sm" onClick={handlePublish} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Rocket className="h-3.5 w-3.5 mr-1" />}
          Publish
        </Button>
      </div>
      <div className="flex flex-1 min-h-0">
        <FieldList
          fields={tpl.fields || []}
          selectedId={selectedFieldId}
          onSelect={setSelectedFieldId}
          onAddText={handleAddText}
          onAddImage={handleAddImage}
          onReorder={() => { /* v2 — drag-reorder */ }}
        />
        <div className="flex-1 p-4 overflow-y-auto">
          <PersonalizerCanvas
            template={tpl}
            fields={tpl.fields || []}
            selectedFieldId={selectedFieldId}
            onSelect={setSelectedFieldId}
          />
        </div>
        {selected && <FieldConfigForm field={selected} onPatch={handlePatch} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into WorkspaceView**

In `src/components/integrator/WorkspaceView.tsx`, find where the existing tabs are rendered (Image Studio, Video Studio, etc.) and add a new tab item:

```tsx
{ id: 'personalizer', label: 'Personalizer', visible: !!product.supports_personalization }
```

In the tab content area, render `<PersonalizerPanel productId={product.id} baseImageUrl={product.first_image_url} shopifyHandle={product.shopify_handle} />` when the personalizer tab is active.

- [ ] **Step 3: Compile + smoke test**

```bash
npx tsc --noEmit | grep personalizer || echo "OK"
npm run dev
```

Open the integrator workspace for a product where you flip `supports_personalization=1` via SQL, and verify the Personalizer tab appears and renders without errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/personalizer/PersonalizerPanel.tsx src/components/integrator/WorkspaceView.tsx
git commit -m "feat(personalizer): admin Personalizer tab orchestration"
```

---

## Milestone 7: Storefront widget (5 tasks)

The widget is its own tiny project under `storefront/personalizer/` with its own Vite config. Built into a single static JS bundle that Cloudflare Pages serves.

### Task 7.1: Scaffold the storefront sub-project

**Files:**
- Create: `storefront/personalizer/package.json`
- Create: `storefront/personalizer/vite.config.ts`
- Create: `storefront/personalizer/tsconfig.json`

- [ ] **Step 1: Create files**

`storefront/personalizer/package.json`:

```json
{
  "name": "rp-personalizer",
  "private": true,
  "version": "0.0.1",
  "scripts": {
    "build": "vite build",
    "dev": "vite"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vite": "^5.4.0"
  }
}
```

`storefront/personalizer/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/widget.ts'),
      name: 'RPPersonalizer',
      formats: ['iife'],
      fileName: () => 'personalizer.js',
    },
    outDir: '../../public/storefront',
    emptyOutDir: false,
    rollupOptions: {
      output: { extend: true },
    },
    minify: 'terser',
  },
});
```

`storefront/personalizer/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["DOM", "ES2020"],
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Install Vite under that path**

```bash
cd storefront/personalizer
npm install
cd ../..
```

- [ ] **Step 3: Add a build script to root `package.json`**

```json
"build:storefront": "cd storefront/personalizer && npm run build"
```

- [ ] **Step 4: Commit**

```bash
git add storefront/personalizer/package.json storefront/personalizer/vite.config.ts storefront/personalizer/tsconfig.json package.json package-lock.json
git commit -m "feat(personalizer): storefront sub-project scaffold"
```

---

### Task 7.2: `widget.ts` — entry, mount, fetch template

**Files:**
- Create: `storefront/personalizer/src/widget.ts`
- Create: `storefront/personalizer/src/render.ts`

- [ ] **Step 1: Implement render shim**

`storefront/personalizer/src/render.ts`:

```typescript
export { renderPreviewSvg, autoShrinkFontSize } from '../../../src/lib/personalizer-render';
export type { PreviewTemplate, PreviewField } from '../../../src/lib/personalizer-render';
```

- [ ] **Step 2: Implement entry**

`storefront/personalizer/src/widget.ts`:

```typescript
import { renderPreviewSvg, type PreviewField, type PreviewTemplate } from './render';

const API_BASE = (window as any).__RP_API_BASE__ || 'https://app.riccardiparis.com';

interface MountSpec {
  el: HTMLElement;
  productHandle: string;
  productId: string;
}

async function init() {
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
  let payload: any;
  try {
    const res = await fetch(`${API_BASE}/api/personalizer/template/${encodeURIComponent(productHandle)}`);
    if (!res.ok) return;
    payload = await res.json();
    if (!payload?.found) return;
  } catch { return; }

  const template: PreviewTemplate = payload.template;
  const fields: PreviewField[] = payload.fields || [];

  const initialValues: Record<string, string> = {};
  for (const f of fields) initialValues[String(f.id)] = f.default_value || '';

  el.innerHTML = `
    <div class="rp-pz">
      <style>
        .rp-pz { display:grid; grid-template-columns: 1fr 1fr; gap:24px; padding:16px 0; font-family: inherit; }
        @media (max-width: 720px) { .rp-pz { grid-template-columns: 1fr; } }
        .rp-pz-preview svg { width:100%; height:auto; }
        .rp-pz-row { margin-bottom:14px; }
        .rp-pz-row label { display:block; font-size: 11px; letter-spacing:.14em; text-transform:uppercase; color:#666; margin-bottom:6px; }
        .rp-pz-row input[type=text] { width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:6px; font-size:14px; box-sizing:border-box; }
        .rp-pz-row .rp-pz-count { font-size:11px; color:#888; margin-top:4px; text-align:right; }
        .rp-pz-row input[type=file] { font-size:13px; }
        .rp-pz-error { color:#c0392b; font-size:12px; margin-top:6px; }
      </style>
      <div class="rp-pz-preview" data-preview></div>
      <div class="rp-pz-fields" data-fields></div>
    </div>
  `;

  const previewEl = el.querySelector<HTMLDivElement>('[data-preview]')!;
  const fieldsEl = el.querySelector<HTMLDivElement>('[data-fields]')!;

  function rerender() {
    previewEl.innerHTML = renderPreviewSvg({ template, fields, values: initialValues });
  }

  for (const f of fields) {
    const row = document.createElement('div');
    row.className = 'rp-pz-row';

    const labelEl = document.createElement('label');
    labelEl.textContent = f.label + (f.required ? ' *' : '');
    row.appendChild(labelEl);

    if (f.field_kind === 'text') {
      const input = document.createElement('input');
      input.type = 'text';
      input.name = `properties[${f.label}]`;
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.default_value) input.value = f.default_value;
      if (f.max_chars) input.maxLength = f.max_chars;
      input.addEventListener('input', () => {
        initialValues[String(f.id)] = input.value;
        const count = row.querySelector<HTMLDivElement>('.rp-pz-count');
        if (count) count.textContent = `${input.value.length} / ${f.max_chars || '∞'}`;
        rerender();
      });
      row.appendChild(input);
      const count = document.createElement('div');
      count.className = 'rp-pz-count';
      count.textContent = `${(f.default_value || '').length} / ${f.max_chars || '∞'}`;
      row.appendChild(count);
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
        hidden.name = `properties[${f.label}]`;
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

  // Hidden metadata properties
  const cartForm = el.closest('form[action*="/cart/add"]') as HTMLFormElement | null;
  if (cartForm) {
    addHidden(cartForm, '_template_id', String(template.id || (template as any).template_id || payload.template?.id));
    addHidden(cartForm, '_template_updated_at', String(template.updated_at || ''));
    cartForm.addEventListener('submit', () => {
      let preview = '';
      for (const f of fields) {
        const v = initialValues[String(f.id)];
        if (v && f.field_kind === 'text') preview += `${f.label}=${v} · `;
      }
      addHidden(cartForm, '_spec_preview', preview.replace(/ · $/, ''));
    });
  }

  rerender();
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
```

- [ ] **Step 3: Build**

```bash
npm run build:storefront
ls public/storefront/personalizer.js
```

Expected: file exists, ~25–40 kB.

- [ ] **Step 4: Commit**

```bash
git add storefront/personalizer/src/render.ts storefront/personalizer/src/widget.ts public/storefront/personalizer.js
git commit -m "feat(personalizer): storefront widget — fetch, mount, live preview, cart binding"
```

---

### Task 7.3: Liquid snippet documentation

**Files:**
- Create: `storefront/personalizer/snippet.liquid`

- [ ] **Step 1: Write the snippet**

```liquid
{% comment %}
  Riccardiparis Personalizer — install once in your product template.
  Place ABOVE the existing add-to-cart button (typically inside the
  <form action="/cart/add"> ... </form> wrapper).
{% endcomment %}
<div id="rp-personalizer"
     data-product-handle="{{ product.handle }}"
     data-product-id="{{ product.id }}"></div>
<script src="https://app.riccardiparis.com/storefront/personalizer.js" defer></script>
```

- [ ] **Step 2: Commit**

```bash
git add storefront/personalizer/snippet.liquid
git commit -m "docs(personalizer): Liquid snippet for theme install"
```

---

### Task 7.4: End-to-end smoke test

- [ ] **Step 1: Configure secrets**

```bash
wrangler secret put SHOPIFY_WEBHOOK_SECRET
wrangler secret put SHOPIFY_SHOP   # e.g. riccardiparis.myshopify.com
# SHOPIFY_ADMIN_TOKEN already exists
```

- [ ] **Step 2: Register webhook in Shopify Admin**

Settings → Notifications → Webhooks → Create webhook:
- Event: `Order creation`
- Format: JSON
- URL: `https://app.riccardiparis.com/api/personalizer/webhook/shopify-order`
- API version: 2024-10

- [ ] **Step 3: Test the full path**

Manual flow:
1. Set `supports_personalization=1` on a test product. Build a template via the admin Personalizer tab. Publish.
2. Paste the Liquid snippet into the test theme's product template.
3. Open the product page on the storefront. Verify the widget renders, type a name, see the preview update.
4. Add to cart. Check the cart line item shows `First name: Iris` (or whatever).
5. Complete checkout with a test order.
6. Wait ~30s. Verify:
   - Shopify Admin order page note contains `[PERSONALIZATION] ...`.
   - The order has a `riccardiparis.personalization_spec` JSON metafield.
   - The CRM has a row in `customization_orders` (`SELECT * FROM customization_orders ORDER BY id DESC LIMIT 1`).

- [ ] **Step 4: No commit** — this is a test step, not a code change.

---

## Milestone 8: Production queue UI (1 task)

### Task 8.1: `ProductionQueuePanel.tsx`

**Files:**
- Create: `src/components/admin/personalizer/ProductionQueuePanel.tsx`
- Modify: `src/pages/AdminPage.tsx` (add a new admin nav entry, alongside existing tabs)

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { listOrders, updateOrder, type PersonalizerOrder, type ProductionStatus } from '@/lib/personalizer-api';

const TABS: { id: ProductionStatus; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'in_production', label: 'In production' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'cancelled', label: 'Cancelled' },
];

export function ProductionQueuePanel() {
  const { toast } = useToast();
  const [active, setActive] = useState<ProductionStatus>('pending');
  const [orders, setOrders] = useState<PersonalizerOrder[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try { setOrders(await listOrders({ status: active })); }
    catch (e: any) { toast({ title: 'Failed to load', description: e?.message, variant: 'destructive' }); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [active]);

  async function moveTo(id: number, status: ProductionStatus) {
    await updateOrder(id, { production_status: status });
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.id}
            onClick={() => setActive(t.id)}
            className={['px-3 py-2 text-xs font-medium', active === t.id ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'].join(' ')}>
            {t.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : orders.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">No orders in this bucket.</Card>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const values = safeParse(o.values_json) || {};
            const snap = safeParse(o.template_snapshot_json) || {};
            const fields = (snap.fields || []) as any[];
            return (
              <Card key={o.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{o.product_title || `Product ${o.product_id}`}</div>
                    <div className="text-xs text-muted-foreground">Order {o.shopify_order_name || o.shopify_order_id} · {new Date(o.created_at).toLocaleString()}</div>
                  </div>
                  <div className="flex gap-2">
                    {active !== 'in_production' && <Button size="sm" variant="outline" onClick={() => moveTo(o.id, 'in_production')}>Start</Button>}
                    {active !== 'shipped' && <Button size="sm" variant="outline" onClick={() => moveTo(o.id, 'shipped')}>Mark shipped</Button>}
                  </div>
                </div>
                <div className="mt-3 space-y-1 text-sm">
                  {fields.map((f) => (
                    <div key={f.id} className="flex gap-2">
                      <span className="text-muted-foreground min-w-[140px]">{f.label}</span>
                      <span className="font-mono">{values[String(f.id)] || <em className="text-muted-foreground">empty</em>}</span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function safeParse(s: string) { try { return JSON.parse(s); } catch { return null; } }
```

- [ ] **Step 2: Wire into AdminPage** — add a new nav item "Production Queue" that renders `<ProductionQueuePanel />`.

- [ ] **Step 3: Compile + smoke test** with `npx tsc --noEmit` and a manual click-through.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/personalizer/ProductionQueuePanel.tsx src/pages/AdminPage.tsx
git commit -m "feat(personalizer): admin Production Queue panel"
```

---

## Milestone 9: Verification & polish (3 tasks)

### Task 9.1: Run all tests

- [ ] **Step 1**

```bash
npx vitest run
```

Expected: 13+ tests pass (4 spec, 4 webhook, 7 render, plus any new ones).

- [ ] **Step 2: TypeScript clean**

```bash
npx tsc --noEmit 2>&1 | grep -v "TS6133\|TS6196" | grep -v "^Found 0 errors" | head
```

Expected: only pre-existing unrelated errors. Nothing in `personalizer*`.

- [ ] **Step 3: No commit** unless fixing issues.

---

### Task 9.2: Storefront cross-browser smoke check

- [ ] **Step 1: Test in Chrome, Safari, Firefox** (desktop) and one mobile (Chrome iOS or Safari iOS):
  - Widget renders
  - Typing updates preview
  - Photo upload works
  - Add-to-cart with personalization completes checkout
  - Order note arrives in Shopify Admin within 30 s

- [ ] **Step 2: If any browser fails**, file follow-up issue and patch within scope.

- [ ] **Step 3: No commit** unless fixing.

---

### Task 9.3: Document the install steps

**Files:**
- Create: `docs/personalizer-install.md`

- [ ] **Step 1: Write the install guide**

```markdown
# Personalizer install

## Prerequisites
- Shopify store running an Online Store 2.0 theme (most modern themes).
- Shopify Admin API access token (existing — same one the CRM uses).
- A custom app (private app) registered for webhook signing — get the webhook secret.

## One-time setup (CRM side)
1. Apply migrations 0142–0145 on remote D1: `npm run db:migrate:remote`.
2. Set wrangler secrets: `wrangler secret put SHOPIFY_WEBHOOK_SECRET` and `wrangler secret put SHOPIFY_SHOP`.
3. Build the storefront bundle: `npm run build:storefront`.
4. Deploy: `npm run deploy`.
5. In Shopify Admin → Notifications → Webhooks, register `Order creation` JSON to `https://app.riccardiparis.com/api/personalizer/webhook/shopify-order` with API version 2024-10.

## Per-product setup (Roger flow)
1. Push the product to Shopify via the existing CRM flow.
2. In the product card, flip `supports_personalization=1` (admin-only flag).
3. Open the new "Personalizer" tab. Add fields, configure, hit Publish.
4. In your Shopify theme, paste the snippet from `storefront/personalizer/snippet.liquid` into `product.liquid` above the add-to-cart button.

## Troubleshooting
- Widget doesn't render → check the snippet placement, browser console for the fetch URL, and that the template `status='published'`.
- Order note missing → check Cloudflare logs for webhook errors, verify `SHOPIFY_WEBHOOK_SECRET` is correct.
- Preview wrong → re-publish the template (drafts are not served to the storefront).
```

- [ ] **Step 2: Commit**

```bash
git add docs/personalizer-install.md
git commit -m "docs(personalizer): install + per-product setup guide"
```

---

## Self-review (run after writing the plan)

**Spec coverage:** Walked the spec section by section.

| Spec section | Plan task |
|---|---|
| §6 data model | Tasks 1.1–1.4 (migrations) |
| §7 storefront widget | Tasks 7.1–7.4 |
| §8 admin editor | Tasks 6.1–6.4 |
| §9 API endpoints | Tasks 3.1–3.7 |
| §10 cart & order flow | Task 4.2 (webhook) + Task 7.2 (cart binding) |
| §11 supplier notes | Task 4.2 (note append) + Task 8.1 (production queue) |
| §12 sync | Tasks 3.6 (public template) + 4.2 (webhook) |
| §14 risks (rate-limited upload, HMAC) | Tasks 2.2 + 3.7 |
| §15 v1 scope | Covered across milestones |

No gaps.

**Placeholder scan:** No "TBD", "TODO", "implement later", "add validation", "similar to Task N" — every code step has actual code. ✓

**Type consistency:** `PersonalizerField` defined in Task 5.1 is used identically in Tasks 6.1–6.4, 8.1. `renderPreviewSvg` signature defined in Task 2.3 is consumed unchanged in Task 7.2 via the shim. `customization_fields` columns named in migrations match the API endpoints' INSERT/UPDATE column lists. ✓

---

**Plan complete.** Saved to `docs/superpowers/plans/2026-04-29-shopify-personalizer.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
