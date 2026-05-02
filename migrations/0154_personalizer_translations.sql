-- P26-28 — translations for personalizer fields + global birthstones library.
--
-- Per-field translations live in a separate table keyed on
-- (field_id, locale). Each row holds the translated values for the
-- four customer-facing strings:
--   • customer_label  — "Name 1", "Birthstone", etc. shown above the input
--   • cart_label      — what appears in the Shopify cart line item
--   • info_text       — tooltip text under the (i) icon
--   • placeholder     — gray hint inside text inputs (image fields only
--                       use this for the upload affordance label)
--
-- Locale strings follow the BCP-47 / Shopify convention used in
-- window.Shopify.locale ("en", "fr", "es", "pt-BR", "pt-PT", etc).
--
-- The English / source values stay on the customization_fields row;
-- this table only stores the OTHER locales. A missing row means
-- "fallback to source" so the storefront keeps working even before
-- translations have been generated.
--
-- Birthstone month labels live at the SHOP level (the library is
-- global, see migration 0152). The translations are stored as a JSON
-- map on personalizer_settings:
--   { "es": [ { month_index: 1, label: "Granate" }, ... ], "fr": [...] }

CREATE TABLE IF NOT EXISTS personalizer_field_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field_id INTEGER NOT NULL,
  locale TEXT NOT NULL,
  customer_label TEXT,
  cart_label TEXT,
  info_text TEXT,
  placeholder TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (field_id) REFERENCES customization_fields(id) ON DELETE CASCADE,
  UNIQUE (field_id, locale)
);

CREATE INDEX IF NOT EXISTS idx_personalizer_field_translations_field
  ON personalizer_field_translations(field_id);
CREATE INDEX IF NOT EXISTS idx_personalizer_field_translations_locale
  ON personalizer_field_translations(locale);

-- Note: personalizer_settings.birthstones_translations_json is added
-- via a separate ADD COLUMN below because SQLite cannot conditionally
-- add a column. The settings.js API self-heal will add it on first
-- write if this migration somehow doesn't run (defensive copy).

ALTER TABLE personalizer_settings ADD COLUMN birthstones_translations_json TEXT;
