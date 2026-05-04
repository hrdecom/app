-- FIX 30 — Add a "tilt" parameter to text-field arc curves so the
-- chord (the line the arc bows from) can be diagonal instead of
-- always horizontal. Closes the gap on rings photographed at an
-- angle: the right tip is foreshortened in 3D perspective and a
-- straight horizontal arc looks fake. With curve_tilt_deg ≠ 0 the
-- whole arc rotates around the field's bbox center, naturally
-- "wrapping" the perspective without touching the existing
-- rotation_deg (which still rotates the entire field).
--
-- Default 0 = identical to the current arc. Range expected -90..+90
-- but no DB-level CHECK so the merchant can experiment freely.
-- Variant overrides get their own column so a tilted arc can have
-- per-variant fine-tuning, mirroring the existing curve_radius_px
-- override.

ALTER TABLE customization_fields
  ADD COLUMN curve_tilt_deg REAL NOT NULL DEFAULT 0;

ALTER TABLE customization_field_variant_overrides
  ADD COLUMN curve_tilt_deg REAL;
