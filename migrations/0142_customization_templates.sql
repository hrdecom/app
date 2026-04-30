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
