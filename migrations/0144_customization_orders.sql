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
