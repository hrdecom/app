-- P26-26 — birthstone field type. A birthstone field renders on the
-- storefront as a compact dropdown selector (12 months, each with a
-- thumbnail icon + label) plus an SVG image overlay at the field's
-- position that swaps to the selected month's icon. Fulfills the
-- "personalized birthstone necklace" use-case where the customer
-- picks the birth month for one or more stones.
--
-- The 12 birthstone PNG icons live at the TEMPLATE level (one library
-- shared by all birthstone fields on a product) — birthstones_json on
-- customization_templates is a JSON array:
--
--   [
--     { "month_index": 1,  "label": "January",   "image_url": "/api/images/r2/..." },
--     { "month_index": 2,  "label": "February",  "image_url": null },
--     ...
--     { "month_index": 12, "label": "December",  "image_url": null }
--   ]
--
-- A field of kind 'birthstone' uses default_value to record the
-- selected month index (string "1".."12") on first paint. Position /
-- size / mask_shape / per-variant overrides all behave exactly like
-- image fields.

-- Step 1: add the library column to templates.
ALTER TABLE customization_templates ADD COLUMN birthstones_json TEXT;

-- Step 2: relax the field_kind CHECK constraint so 'birthstone' is
-- accepted. SQLite doesn't support ALTER on a CHECK directly, so we
-- rebuild the table preserving every column + index.
--
-- NOTE: no BEGIN TRANSACTION / COMMIT here — `wrangler d1 migrations
-- apply` runs each migration inside its own implicit transaction, and
-- nesting them causes the whole migration to fail silently on
-- Cloudflare D1.

CREATE TABLE customization_fields_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  field_kind TEXT NOT NULL CHECK (field_kind IN ('text', 'image', 'birthstone')),
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

  -- Carry-over columns added by later migrations. Keeping these in the
  -- new schema so the swap is lossless. If a future migration adds yet
  -- another column we'll need to update this list.
  cart_label TEXT,
  visible_variant_options TEXT,
  customer_label TEXT,
  is_info INTEGER DEFAULT 0,
  info_text TEXT,
  font_color_by_value_json TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (template_id) REFERENCES customization_templates(id) ON DELETE CASCADE
);

INSERT INTO customization_fields_new
SELECT
  id, template_id, field_kind, sort_order, layer_z,
  label, placeholder, default_value, required, max_chars, allow_empty,
  font_family, font_size_px, font_color, text_align, letter_spacing,
  curve_mode, curve_radius_px, curve_path_d,
  position_x, position_y, width, height, rotation_deg,
  mask_shape, image_max_size_kb, config_json,
  cart_label, visible_variant_options, customer_label, is_info, info_text,
  font_color_by_value_json,
  created_at, updated_at
FROM customization_fields;

DROP TABLE customization_fields;
ALTER TABLE customization_fields_new RENAME TO customization_fields;

CREATE INDEX IF NOT EXISTS idx_personalizer_fields_template ON customization_fields(template_id, sort_order);
