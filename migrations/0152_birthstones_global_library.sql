-- P26-26 follow-up — birthstones library moves from per-template to
-- per-shop (global). The merchant uploads the 12 PNG icons ONCE in
-- the admin Personalizer Settings panel, and every birthstone field
-- on every product reuses them. Integrator role keeps the ability
-- to add birthstone fields and pick the default month, but cannot
-- modify the library (admin-only).
--
-- Schema change:
--   • personalizer_settings.birthstones_json (NEW) — JSON array of 12
--     entries [{ month_index, label, image_url }, ...]. Same shape as
--     the previous per-template column.
--   • customization_templates.birthstones_json — kept in place for
--     backward compatibility; storefront API now ignores it. A future
--     migration can drop it once we are sure no rows hold useful data.

ALTER TABLE personalizer_settings ADD COLUMN birthstones_json TEXT;
