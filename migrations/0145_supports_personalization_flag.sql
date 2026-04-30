-- Per-product opt-in flag for the personalizer. Storefront widget no-ops
-- when 0; admin Personalizer tab is hidden when 0.

ALTER TABLE products ADD COLUMN supports_personalization INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_products_supports_personalization ON products(supports_personalization);
