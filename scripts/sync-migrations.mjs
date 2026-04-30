#!/usr/bin/env node
// Apply migrations 0134→0137 to ALL sqlite files in the miniflare D1 state
// dir. Miniflare picks a different file depending on CLI state and dev
// server lifecycle, so migrating a single file isn't enough — we hit all
// of them and let the "already exists" branches no-op the ones that are
// already up-to-date. Safe + idempotent.

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const dir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const candidates = readdirSync(dir)
  .filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');

if (candidates.length === 0) {
  console.error('No sqlite files to migrate in', dir);
  process.exit(1);
}

for (const file of candidates) {
  const path = join(dir, file);
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`Migrating ${file}`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  migrateOne(path);
}

function migrateOne(path) {
  let db;
  try {
    db = new DatabaseSync(path);
  } catch (e) {
    console.log(`  ✗ can't open: ${e.message}`);
    return;
  }

  // Skip files that don't have the base schema we're extending — those are
  // dormant / unused by any recent wrangler session.
  let hasFbCampaigns = false;
  try {
    const row = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='fb_campaigns'`).get();
    hasFbCampaigns = !!row;
  } catch {}
  if (!hasFbCampaigns) {
    console.log(`  · skip — no fb_campaigns base table (dormant/empty file)`);
    db.close();
    return;
  }

  function hasTable(name) {
    const row = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
    return !!row;
  }
  function hasColumn(table, col) {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r.name === col);
  }
  function run(sql, label) {
    try { db.exec(sql); console.log('  ✓', label); }
    catch (e) { console.log('  ✗', label, '—', e.message); }
  }

  console.log('  migration 0134');
  const add0134 = [
    ['fb_campaigns', 'ad_account_id', 'TEXT'],
    ['fb_campaigns', 'buying_type', "TEXT NOT NULL DEFAULT 'AUCTION'"],
    ['fb_campaigns', 'budget_mode', 'TEXT'],
    ['fb_campaigns', 'daily_budget_cents', 'INTEGER'],
    ['fb_campaigns', 'lifetime_budget_cents', 'INTEGER'],
    ['fb_campaigns', 'special_ad_categories', 'TEXT'],
    ['fb_campaigns', 'last_synced_at', 'INTEGER'],
    ['fb_adsets', 'fb_campaign_id', 'TEXT'],
    ['fb_adsets', 'daily_budget_cents', 'INTEGER'],
    ['fb_adsets', 'billing_event', "TEXT NOT NULL DEFAULT 'IMPRESSIONS'"],
    ['fb_adsets', 'optimization_goal', 'TEXT'],
    ['fb_adsets', 'bid_strategy', 'TEXT'],
    ['fb_adsets', 'bid_amount_cents', 'INTEGER'],
    ['fb_adsets', 'promoted_object_json', 'TEXT'],
    ['fb_adsets', 'lifetime_budget_cents', 'INTEGER'],
    ['fb_adsets', 'start_time', 'INTEGER'],
    ['fb_adsets', 'end_time', 'INTEGER'],
    ['fb_adsets', 'advantage_plus_placements', 'INTEGER NOT NULL DEFAULT 1'],
    ['fb_adsets', 'created_by', 'INTEGER'],
    ['fb_adsets', 'last_synced_at', 'INTEGER'],
    ['fb_adsets', 'campaign_local_id', 'INTEGER'],
    ['fb_ads', 'fb_creative_id', 'TEXT'],
    ['fb_ads', 'fb_adset_id', 'TEXT'],
    ['fb_ads', 'ads_asset_id', 'INTEGER'],
    ['fb_ads', 'adset_local_id', 'INTEGER'],
    ['fb_ads', 'name', 'TEXT'],
    ['fb_ads', 'creative_type', 'TEXT'],
    ['fb_ads', 'creative_video_url', 'TEXT'],
    ['fb_ads', 'creative_image_url', 'TEXT'],
    ['fb_ads', 'creative_thumbnail_url', 'TEXT'],
    ['fb_ads', 'preview_shareable_link', 'TEXT'],
    ['fb_ads', 'headline', 'TEXT'],
    ['fb_ads', 'primary_text', 'TEXT'],
    ['fb_ads', 'description', 'TEXT'],
    ['fb_ads', 'call_to_action', 'TEXT'],
    ['fb_ads', 'destination_url', 'TEXT'],
    ['fb_ads', 'language', 'TEXT'],
    ['fb_ads', 'created_by', 'INTEGER'],
    ['fb_ads', 'last_synced_at', 'INTEGER'],
  ];
  for (const [t, c, def] of add0134) {
    if (hasColumn(t, c)) continue;
    run(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`, `${t}.${c}`);
  }
  if (!hasTable('fb_settings')) {
    run(`CREATE TABLE fb_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      ad_account_id TEXT, page_id TEXT, instagram_actor_id TEXT, pixel_id TEXT,
      default_currency TEXT NOT NULL DEFAULT 'EUR',
      default_country TEXT NOT NULL DEFAULT 'WW',
      default_objective TEXT NOT NULL DEFAULT 'OUTCOME_SALES',
      default_optimization_goal TEXT NOT NULL DEFAULT 'OFFSITE_CONVERSIONS',
      default_call_to_action TEXT NOT NULL DEFAULT 'SHOP_NOW',
      advantage_plus_placements INTEGER NOT NULL DEFAULT 1,
      api_version TEXT NOT NULL DEFAULT 'v21.0',
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
    )`, 'fb_settings table');
    run(`INSERT OR IGNORE INTO fb_settings (id) VALUES (1)`, 'fb_settings row');
  }

  console.log('  migration 0135');
  const add0135 = [
    ['fb_campaigns', 'is_draft', 'INTEGER NOT NULL DEFAULT 0'],
    ['fb_adsets', 'is_draft', 'INTEGER NOT NULL DEFAULT 0'],
    ['fb_ads', 'is_draft', 'INTEGER NOT NULL DEFAULT 0'],
    ['fb_ads', 'utm_source', 'TEXT'],
    ['fb_ads', 'utm_medium', 'TEXT'],
    ['fb_ads', 'utm_campaign', 'TEXT'],
    ['fb_ads', 'utm_content', 'TEXT'],
    ['fb_ads', 'utm_term', 'TEXT'],
    ['fb_settings', 'business_id', 'TEXT'],
    ['fb_adsets', 'adv_plus_audience', 'INTEGER NOT NULL DEFAULT 1'],
    ['fb_adsets', 'adv_plus_placements', 'INTEGER NOT NULL DEFAULT 1'],
    ['fb_adsets', 'adv_plus_creative', 'INTEGER NOT NULL DEFAULT 0'],
    ['fb_adsets', 'adv_plus_budget', 'INTEGER NOT NULL DEFAULT 0'],
    ['fb_adsets', 'adv_plus_delivery', 'INTEGER NOT NULL DEFAULT 0'],
    ['fb_adsets', 'adv_plus_detailed_targeting_expansion', 'INTEGER NOT NULL DEFAULT 1'],
  ];
  for (const [t, c, def] of add0135) {
    if (hasColumn(t, c)) continue;
    run(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`, `${t}.${c}`);
  }
  if (!hasTable('fb_launch_presets')) {
    run(`CREATE TABLE fb_launch_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      description TEXT, ad_account_id TEXT, fb_campaign_id TEXT, fb_adset_id TEXT,
      page_id TEXT, instagram_actor_id TEXT, pixel_id TEXT,
      default_objective TEXT, default_optimization_goal TEXT,
      default_budget_mode TEXT, default_daily_budget_cents INTEGER,
      default_call_to_action TEXT,
      adv_plus_audience INTEGER, adv_plus_placements INTEGER,
      adv_plus_creative INTEGER, adv_plus_budget INTEGER,
      adv_plus_delivery INTEGER, adv_plus_detailed_targeting_expansion INTEGER,
      utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT,
      targeting_json TEXT, is_default INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
    )`, 'fb_launch_presets');
  }

  console.log('  migration 0136');
  const add0136 = [
    ['fb_ads', 'utm_params', 'TEXT'],
    ['fb_ads', 'creative_enhancements_json', 'TEXT'],
  ];
  for (const [t, c, def] of add0136) {
    if (hasColumn(t, c)) continue;
    run(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`, `${t}.${c}`);
  }

  console.log('  migration 0137');
  if (!hasTable('ad_description_presets')) {
    run(`CREATE TABLE ad_description_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preset_text TEXT NOT NULL,
      translations_json TEXT DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`, 'ad_description_presets');
  }

  console.log('  migration 0138');
  // Vertical video variant for FB Placement Asset Customization (4:5 for
  // Feed, 9:16 for Reels/Stories in the same ad).
  if (hasTable('fb_ads') && !hasColumn('fb_ads', 'creative_video_vertical_url')) {
    run(`ALTER TABLE fb_ads ADD COLUMN creative_video_vertical_url TEXT`,
        'fb_ads.creative_video_vertical_url');
  }

  console.log('  migration 0145');
  if (hasTable('products') && !hasColumn('products', 'supports_personalization')) {
    run(`ALTER TABLE products ADD COLUMN supports_personalization INTEGER NOT NULL DEFAULT 0`,
        'products.supports_personalization');
    run(`CREATE INDEX IF NOT EXISTS idx_products_supports_personalization ON products(supports_personalization)`,
        'idx_products_supports_personalization');
  }

  console.log('  migration 0144');
  if (!hasTable('customization_orders')) {
    run(`CREATE TABLE customization_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shopify_order_id TEXT NOT NULL,
      shopify_order_name TEXT,
      shopify_line_item_id TEXT NOT NULL UNIQUE,
      product_id INTEGER,
      template_id INTEGER,
      template_snapshot_json TEXT NOT NULL,
      values_json TEXT NOT NULL,
      production_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (production_status IN ('pending', 'in_production', 'shipped', 'cancelled')),
      production_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (template_id) REFERENCES customization_templates(id) ON DELETE SET NULL
    )`, 'customization_orders');
    run(`CREATE INDEX idx_personalizer_orders_status ON customization_orders(production_status)`,
        'idx_personalizer_orders_status');
    run(`CREATE INDEX idx_personalizer_orders_shopify ON customization_orders(shopify_order_id)`,
        'idx_personalizer_orders_shopify');
    run(`CREATE INDEX idx_personalizer_orders_created ON customization_orders(created_at DESC)`,
        'idx_personalizer_orders_created');
  }

  console.log('  migration 0143');
  if (!hasTable('customization_fields')) {
    run(`CREATE TABLE customization_fields (
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
    )`, 'customization_fields');
    run(`CREATE INDEX idx_personalizer_fields_template ON customization_fields(template_id, sort_order)`,
        'idx_personalizer_fields_template');
  }

  console.log('  migration 0142');
  // Personalizer templates — one per personalizable product.
  if (!hasTable('customization_templates')) {
    run(`CREATE TABLE customization_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      shopify_product_handle TEXT,
      base_image_url TEXT,
      canvas_width INTEGER NOT NULL DEFAULT 1080,
      canvas_height INTEGER NOT NULL DEFAULT 1080,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      published_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )`, 'customization_templates');
    run(`CREATE INDEX idx_personalizer_templates_product ON customization_templates(product_id)`,
        'idx_personalizer_templates_product');
    run(`CREATE INDEX idx_personalizer_templates_handle ON customization_templates(shopify_product_handle)`,
        'idx_personalizer_templates_handle');
    run(`CREATE INDEX idx_personalizer_templates_status ON customization_templates(status)`,
        'idx_personalizer_templates_status');
  }

  console.log('  migration 0141');
  // Per-AD-number admin-approval history on ad_assets — see
  // migrations/0141_approved_ad_numbers.sql for the rationale. The
  // column is a JSON-encoded array of integer AD numbers; the
  // AdsReviewPanel uses it to hide already-approved (and already-
  // published) AD projects from the Pending Review video grid so the
  // admin only re-reviews truly new content.
  if (hasTable('ad_assets') && !hasColumn('ad_assets', 'approved_ad_numbers')) {
    run(`ALTER TABLE ad_assets ADD COLUMN approved_ad_numbers TEXT NOT NULL DEFAULT '[]'`,
        'ad_assets.approved_ad_numbers');
  }

  console.log('  migration 0140');
  // "Ask new creatives" flow (admin asks ads-creator for additional creatives
  // after a product has been published to FB) + per-AD-number stamp on
  // fb_ads so the Publish dialog can dedupe already-published AD projects.
  if (hasTable('ad_assets') && !hasColumn('ad_assets', 'admin_note_for_creator')) {
    run(`ALTER TABLE ad_assets ADD COLUMN admin_note_for_creator TEXT`,
        'ad_assets.admin_note_for_creator');
  }
  if (hasTable('ad_assets') && !hasColumn('ad_assets', 'needs_new_creatives')) {
    run(`ALTER TABLE ad_assets ADD COLUMN needs_new_creatives INTEGER NOT NULL DEFAULT 0`,
        'ad_assets.needs_new_creatives');
    run(`CREATE INDEX IF NOT EXISTS idx_ad_assets_needs_new ON ad_assets(needs_new_creatives)`,
        'idx_ad_assets_needs_new');
  }
  if (hasTable('fb_ads') && !hasColumn('fb_ads', 'asset_ad_number')) {
    run(`ALTER TABLE fb_ads ADD COLUMN asset_ad_number INTEGER`, 'fb_ads.asset_ad_number');
    run(`CREATE INDEX IF NOT EXISTS idx_fb_ads_asset_adnum ON fb_ads(ads_asset_id, asset_ad_number)`,
        'idx_fb_ads_asset_adnum');
  }

  console.log('  migration 0139');
  // Per-language campaign/adset defaults + global excluded audiences.
  if (!hasTable('fb_language_defaults')) {
    run(`CREATE TABLE fb_language_defaults (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      ad_account_id TEXT,
      fb_campaign_id TEXT,
      fb_adset_id TEXT,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    )`, 'fb_language_defaults');
    run(`CREATE INDEX IF NOT EXISTS idx_fb_language_defaults_code ON fb_language_defaults(code)`,
        'idx_fb_language_defaults_code');
  }
  if (hasTable('fb_settings') && !hasColumn('fb_settings', 'default_excluded_audience_ids')) {
    run(`ALTER TABLE fb_settings ADD COLUMN default_excluded_audience_ids TEXT`,
        'fb_settings.default_excluded_audience_ids');
  }

  // Seed the saved credentials so the admin doesn't have to re-enter them.
  const SEED = {
    ad_account_id: 'act_479366914637865',
    business_id:   '702367546045241',
    page_id:       '939622612569860',
    pixel_id:      '4047535368724185',
  };
  for (const [k, v] of Object.entries(SEED)) {
    try {
      const stmt = db.prepare(`UPDATE fb_settings SET ${k}=COALESCE(${k}, ?) WHERE id=1`);
      stmt.run(v);
    } catch {}
  }
  db.close();
  console.log('  done.');
}

console.log('\nAll sqlite files processed.');
