-- P26-26 repair — re-apply the field_kind CHECK relaxation that
-- migration 0151 was supposed to do. 0151 had a `BEGIN TRANSACTION /
-- COMMIT` block inside it which conflicted with wrangler's own
-- per-migration transaction wrapping; the result was that the table
-- rebuild failed silently and `wrangler d1 migrations apply` marked
-- 0151 as "applied" anyway. Subsequent INSERTs with
-- field_kind='birthstone' then hit the OLD CHECK and returned 500.
--
-- This migration re-runs the rebuild WITHOUT the inner transaction
-- markers (wrangler wraps the file). Idempotent: if 0151 actually
-- did succeed for some shop, the new table already has 'birthstone'
-- in its CHECK, the rebuild still works (it just re-creates the same
-- shape), and the data copy is unchanged.

CREATE TABLE customization_fields_p26_26 (
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

INSERT INTO customization_fields_p26_26
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

ALTER TABLE customization_fields_p26_26 RENAME TO customization_fields;

CREATE INDEX IF NOT EXISTS idx_personalizer_fields_template ON customization_fields(template_id, sort_order);
