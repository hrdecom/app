-- FIX 25b — repair migration 0134's typo
--
-- 0134_facebook_ads.sql:38 added:
--   ALTER TABLE fb_ads ADD COLUMN ads_asset_id INTEGER REFERENCES ads_assets(id);
-- The actual table is `ad_assets` (no trailing 's'). With FK enforcement
-- enabled, every cascade DELETE that hits fb_ads (e.g. deleting a product
-- that owns adsets and ads) trips SQLite's "no such table: ads_assets"
-- check on the dangling FK and the whole DELETE statement aborts with a
-- 500. Symptom: DELETE /api/products/:id returns 500 "Internal Server
-- Error" once any fb_ads row exists for the product.
--
-- SQLite has no DROP CONSTRAINT, so we drop+re-add the column. Data in
-- ads_asset_id is preserved by copying through a temp column. We do NOT
-- re-add the FK on the new column — the original ad_assets.id reference
-- is fine to leave as a soft link (the row gets cleared if/when the
-- asset is removed via app code, and there's no cascade requirement
-- here).
--
-- 2026-05-03 — TWO indexes reference ads_asset_id and SQLite refuses
-- DROP COLUMN whenever any index points at the column being dropped.
-- Both must come out before the swap, then both get recreated on the
-- new column. The indexes are:
--   • idx_fb_ads_ads_asset       (migration 0134)
--   • idx_fb_ads_asset_adnum     (migration 0140 — composite with
--                                  asset_ad_number)
-- All DROP/CREATE statements use IF EXISTS / IF NOT EXISTS so this
-- migration is safe to retry if a partial run leaves intermediate
-- state.

-- 0) drop EVERY index that references ads_asset_id BEFORE touching
-- the column. SQLite otherwise raises "error in index ... no such
-- column: ads_asset_id" during DROP COLUMN and the migration aborts.
DROP INDEX IF EXISTS idx_fb_ads_ads_asset;
DROP INDEX IF EXISTS idx_fb_ads_asset_adnum;

-- 1) stash the existing values into a temp column with no FK
ALTER TABLE fb_ads ADD COLUMN ads_asset_id_tmp INTEGER;
UPDATE fb_ads SET ads_asset_id_tmp = ads_asset_id;

-- 2) drop the broken column (D1's SQLite supports DROP COLUMN since
-- 3.35; safe now that no index references it)
ALTER TABLE fb_ads DROP COLUMN ads_asset_id;

-- 3) rename temp back into place — same column name, no broken FK
ALTER TABLE fb_ads RENAME COLUMN ads_asset_id_tmp TO ads_asset_id;

-- 4) recreate BOTH indexes on the new column
CREATE INDEX IF NOT EXISTS idx_fb_ads_ads_asset    ON fb_ads(ads_asset_id);
CREATE INDEX IF NOT EXISTS idx_fb_ads_asset_adnum  ON fb_ads(ads_asset_id, asset_ad_number);
