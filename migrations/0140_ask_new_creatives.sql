-- "Ask new creatives" flow — admin on Published tab asks the ads-creator
-- for additional creatives on an already-published product, with a note.
--
-- Also: per-ad-number stamp on fb_ads so the Publish dialog can exclude
-- already-published AD projects from the next round (no double-publish).

ALTER TABLE ad_assets ADD COLUMN admin_note_for_creator TEXT;
ALTER TABLE ad_assets ADD COLUMN needs_new_creatives INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_ad_assets_needs_new ON ad_assets(needs_new_creatives);

ALTER TABLE fb_ads ADD COLUMN asset_ad_number INTEGER;
CREATE INDEX IF NOT EXISTS idx_fb_ads_asset_adnum ON fb_ads(ads_asset_id, asset_ad_number);
