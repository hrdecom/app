-- FIX 34 — text fields can be configured to force-uppercase customer
-- input. When set, the storefront widget uppercases the value as the
-- customer types AND uppercases the value sent to the cart line item
-- (so what the engraver sees matches what the customer typed). Default
-- 0 = legacy behaviour (case preserved exactly as typed).

ALTER TABLE customization_fields ADD COLUMN uppercase_only INTEGER NOT NULL DEFAULT 0;
