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
