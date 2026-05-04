-- FIX 30 v4 — relax the customization_fields.curve_mode CHECK
-- constraint to include the new 'embrace' mode.
--
-- Background: migration 0143 created the table with
--   curve_mode TEXT CHECK (curve_mode IS NULL OR curve_mode IN ('linear', 'arc', 'circle'))
-- so any UPDATE setting curve_mode='embrace' fails with a CHECK
-- constraint violation, surfaced to the merchant as a 500 from
-- PATCH /api/personalizer/fields/:id and a UI fallback to 'arc'
-- on the next refresh.
--
-- SQLite has no ALTER COLUMN, so we rebuild the table the same way
-- migration 0153 did to add 'birthstone' to field_kind. The new
-- CHECK adds 'embrace' to the allowed set; everything else (column
-- list, indexes, FK) is preserved verbatim. Includes curve_tilt_deg
-- (added in 0157) in the new schema.

CREATE TABLE customization_fields_fix30v4 (
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
  curve_mode TEXT CHECK (curve_mode IS NULL OR curve_mode IN ('linear', 'arc', 'circle', 'embrace')),
  curve_radius_px INTEGER,
  curve_path_d TEXT,
  curve_tilt_deg REAL NOT NULL DEFAULT 0,

  position_x INTEGER NOT NULL,
  position_y INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  rotation_deg REAL DEFAULT 0,

  mask_shape TEXT CHECK (mask_shape IS NULL OR mask_shape IN ('rect', 'circle', 'heart')),
  image_max_size_kb INTEGER DEFAULT 5120,

  config_json TEXT,
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

INSERT INTO customization_fields_fix30v4
SELECT
  id, template_id, field_kind, sort_order, layer_z,
  label, placeholder, default_value, required, max_chars, allow_empty,
  font_family, font_size_px, font_color, text_align, letter_spacing,
  curve_mode, curve_radius_px, curve_path_d, curve_tilt_deg,
  position_x, position_y, width, height, rotation_deg,
  mask_shape, image_max_size_kb, config_json,
  cart_label, visible_variant_options, customer_label, is_info, info_text,
  font_color_by_value_json,
  created_at, updated_at
FROM customization_fields;

DROP TABLE customization_fields;

ALTER TABLE customization_fields_fix30v4 RENAME TO customization_fields;

CREATE INDEX IF NOT EXISTS idx_personalizer_fields_template ON customization_fields(template_id, sort_order);
