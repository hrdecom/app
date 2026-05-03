/**
 * Facebook Marketing API wrapper for Cloudflare Workers.
 *
 * One entry point — `fbApi(env)` — returns a client bound to the access token
 * (env.FB_ACCESS_TOKEN) and the active settings row in fb_settings (ad
 * account, page, pixel, etc.). All Marketing-API calls go through it so the
 * REST endpoints in /api/facebook/* don't need to know about Graph URL
 * shapes, error envelopes, or credentials.
 *
 * Design notes
 * ------------
 *  - All NEW objects (campaigns, adsets, ads) are created in PAUSED status.
 *    The admin must explicitly unpause from FB Ads Manager OR trigger an
 *    unpause via this wrapper, which logs who/when. This is intentional —
 *    publishing an ad spends real money, and we want a human-in-the-loop
 *    confirmation between "Publish" in our UI and "actually serving".
 *
 *  - Rate-limit (HTTP 4 with code 17/32) and expired-token (code 190)
 *    responses get translated into FBApiError with .retryable / .needsReauth
 *    flags so callers can react sensibly.
 *
 *  - We never log the access token. It's accepted into the constructor and
 *    used in headers/query strings only.
 *
 *  - Money values are always passed in MINOR units (cents). FB's API
 *    expects strings ("1000" = 10 EUR if currency is EUR). We do the
 *    string conversion at the wire.
 */

const GRAPH = 'https://graph.facebook.com';

export class FBApiError extends Error {
  constructor(message, { status, fbCode, fbSubcode, fbType, retryable, needsReauth, raw } = {}) {
    super(message);
    this.name = 'FBApiError';
    this.status = status;
    this.fbCode = fbCode;
    this.fbSubcode = fbSubcode;
    this.fbType = fbType;
    this.retryable = !!retryable;
    this.needsReauth = !!needsReauth;
    this.raw = raw;
  }
}

/**
 * Build a client. Reads settings (ad_account_id / page_id / pixel_id /
 * api_version) from the fb_settings row. An optional `overrides` arg lets
 * the caller target a different ad account than the default (used when the
 * admin picks a specific account from the Publish dialog — supports
 * multi-account workflows without persisting the choice in fb_settings).
 */
export async function fbApi(env, overrides = {}) {
  const token = env.FB_ACCESS_TOKEN;
  if (!token) {
    throw new FBApiError('FB_ACCESS_TOKEN missing in env', { status: 500, needsReauth: true });
  }

  const settingsRow = await env.DB
    .prepare('SELECT * FROM fb_settings WHERE id = 1')
    .first();

  const settings = settingsRow || {};
  // v22+ silently strips ineligible enhancement keys from creative_features_spec
  // (instead of throwing on unknown keys like v21 did) — required for our
  // "send all enhancements with OPT_OUT" strategy to be safe across accounts.
  const apiVersion = settings.api_version || 'v22.0';
  // Per-request override takes priority over the fb_settings default. The
  // override must already be in "act_xxx" form.
  const adAccountId = overrides.adAccountId || settings.ad_account_id;
  const base = `${GRAPH}/${apiVersion}`;

  // ─── low-level request helper ──────────────────────────────────────────────
  async function request(method, path, { query, body, multipart } = {}) {
    const url = new URL(path.startsWith('http') ? path : `${base}${path}`);

    // Token always goes in the URL — it's the simplest cross-method approach
    // FB supports, including for multipart uploads.
    url.searchParams.set('access_token', token);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
    }

    let init = { method };
    if (multipart instanceof FormData) {
      init.body = multipart;
    } else if (body) {
      // For POST/PATCH with JSON-ish payload, FB accepts both JSON body and
      // form-encoded. We use form-encoded with JSON-stringified nested values
      // because that's what every FB SDK does and it's the path with the most
      // edge cases ironed out.
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined || v === null) continue;
        form.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
      init.body = form;
      init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    }

    // Built-in retry on transient errors — but ONLY for short-lived hiccups:
    //   • HTTP 5xx (internal Graph)
    //   • is_transient=true without a rate-limit code
    // Rate-limit codes (4 = app, 17 = user, 32 = page, 613 = custom) reset
    // in HOURS, not seconds, so retrying within-request is pointless and
    // just burns more of the quota. We surface them immediately with a
    // clear message so the UI can back off.
    const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await fetch(url.toString(), init);
      let json;
      try { json = await res.json(); }
      catch {
        throw new FBApiError(`Non-JSON response from FB (${res.status})`, { status: res.status });
      }

      if (!res.ok || json.error) {
        const e = json.error || {};
        const code = e.code;
        const subcode = e.error_subcode;
        const needsReauth = code === 190 || subcode === 463 || subcode === 467;
        const isRateLimit = RATE_LIMIT_CODES.has(code);
        const retryable = !isRateLimit && (res.status >= 500 || e.is_transient === true);
        const err = new FBApiError(e.message || `FB request failed (${res.status})`, {
          status: res.status,
          fbCode: code,
          fbSubcode: subcode,
          fbType: e.type,
          retryable: retryable || isRateLimit, // keep flag for UI, even if we don't auto-retry
          needsReauth,
          raw: json,
        });
        if (retryable && attempt < 2) {
          const waitMs = 1000 * Math.pow(2, attempt);
          console.warn(`[fb-api] transient error (code ${code}), retrying in ${waitMs}ms`);
          await new Promise((r) => setTimeout(r, waitMs));
          lastErr = err;
          continue;
        }
        throw err;
      }

      return json;
    }
    throw lastErr; // shouldn't be reached, but satisfies the linter
  }

  // ─── account / token introspection ─────────────────────────────────────────
  async function listAdAccounts() {
    const r = await request('GET', '/me/adaccounts', {
      query: { fields: 'id,account_id,name,currency,account_status,timezone_name' },
    });
    return r.data || [];
  }

  async function listPages() {
    const r = await request('GET', '/me/accounts', {
      query: { fields: 'id,name,instagram_business_account{id,username}' },
    });
    return r.data || [];
  }

  async function listBusinesses() {
    // Scoped to the /me endpoint which returns the user's linked businesses.
    // If the token doesn't have business_management scope this returns an empty list.
    const r = await request('GET', '/me/businesses', {
      query: { fields: 'id,name,primary_page,verification_status,created_time' },
    });
    return r.data || [];
  }

  async function listPixels() {
    if (!adAccountId) throw new FBApiError('fb_settings.ad_account_id is not set', { status: 412 });
    const r = await request('GET', `/${adAccountId}/adspixels`, {
      query: { fields: 'id,name,code,is_created_by_business,last_fired_time' },
    });
    return r.data || [];
  }

  // ─── campaigns ─────────────────────────────────────────────────────────────
  /**
   * Create a campaign. Always PAUSED on creation.
   * @param {object} p
   *   - name (required)
   *   - objective: OUTCOME_SALES | OUTCOME_TRAFFIC | OUTCOME_ENGAGEMENT | OUTCOME_AWARENESS | OUTCOME_LEADS | OUTCOME_APP_PROMOTION
   *   - budget_mode: 'CBO' | 'ABO'
   *   - daily_budget_cents | lifetime_budget_cents (CBO only)
   *   - special_ad_categories: array (default [])
   */
  async function createCampaign(p) {
    if (!adAccountId) throw new FBApiError('fb_settings.ad_account_id is not set', { status: 412 });
    const body = {
      name: p.name,
      objective: p.objective,
      status: 'PAUSED',
      special_ad_categories: p.special_ad_categories ?? [],
      buying_type: p.buying_type || 'AUCTION',
    };
    if (p.budget_mode === 'CBO') {
      if (p.daily_budget_cents) body.daily_budget = String(p.daily_budget_cents);
      if (p.lifetime_budget_cents) body.lifetime_budget = String(p.lifetime_budget_cents);
      // CBO requires the bid_strategy at CAMPAIGN level (not adset). Without
      // it FB propagates a default that may require a bid cap on adsets,
      // producing the opaque "Bid Amount Required" (#1815857) error. We set
      // the safest default so admins never have to deal with bid caps.
      body.bid_strategy = p.bid_strategy || 'LOWEST_COST_WITHOUT_CAP';
    } else {
      // ABO (adset-level budgets). FB now requires is_adset_budget_sharing_enabled
      // to be explicitly set when the campaign isn't CBO — otherwise it
      // errors with subcode 4834011. We default to false (no sharing) so
      // admins aren't surprised by budget reallocations between adsets.
      body.is_adset_budget_sharing_enabled = false;
    }
    const r = await request('POST', `/${adAccountId}/campaigns`, { body });
    return r; // { id }
  }

  async function getCampaign(fbCampaignId, fields = 'id,name,objective,status,daily_budget,lifetime_budget,buying_type,special_ad_categories') {
    return request('GET', `/${fbCampaignId}`, { query: { fields } });
  }

  async function listCampaigns({ limit = 25, after } = {}) {
    if (!adAccountId) throw new FBApiError('fb_settings.ad_account_id is not set', { status: 412 });
    const query = {
      fields: 'id,name,objective,status,daily_budget,lifetime_budget,created_time,buying_type',
      limit,
    };
    if (after) query.after = after;
    return request('GET', `/${adAccountId}/campaigns`, { query });
  }

  async function updateCampaign(fbCampaignId, patch) {
    return request('POST', `/${fbCampaignId}`, { body: patch });
  }

  async function setCampaignStatus(fbCampaignId, status) {
    return updateCampaign(fbCampaignId, { status });
  }

  // ─── adsets ────────────────────────────────────────────────────────────────
  /**
   * Create an adset under a campaign. Always PAUSED.
   * @param {object} p
   *   - campaign_id (FB id, required)
   *   - name (required)
   *   - daily_budget_cents | lifetime_budget_cents (ABO only)
   *   - billing_event (default IMPRESSIONS)
   *   - optimization_goal (default OFFSITE_CONVERSIONS for sales; LINK_CLICKS for traffic)
   *   - bid_strategy: LOWEST_COST_WITHOUT_CAP (recommended) | LOWEST_COST_WITH_BID_CAP | COST_CAP
   *   - bid_amount_cents (only when bid_strategy uses cap)
   *   - targeting: object — { geo_locations: { countries: ['US','FR',...] }, age_min, age_max, ... }
   *   - promoted_object: { pixel_id, custom_event_type, page_id, ... }
   *   - start_time / end_time: ISO strings
   */
  async function createAdset(p) {
    if (!adAccountId) throw new FBApiError('fb_settings.ad_account_id is not set', { status: 412 });
    const body = {
      campaign_id: p.campaign_id,
      name: p.name,
      status: 'PAUSED',
      billing_event: p.billing_event || 'IMPRESSIONS',
      optimization_goal: p.optimization_goal || 'OFFSITE_CONVERSIONS',
      targeting: p.targeting || {},
    };
    // Bid strategy rules:
    //   - LOWEST_COST_WITHOUT_CAP → no bid_amount required (FB's recommended default)
    //   - LOWEST_COST_WITH_BID_CAP / COST_CAP / TARGET_COST → bid_amount REQUIRED,
    //     otherwise FB errors 2490487 "Bid Amount Or Bid Constraints Required"
    // For ABO adsets FB won't auto-default — we must pass a valid combo. Default
    // to LOWEST_COST_WITHOUT_CAP so the admin never has to think about bid caps.
    const capStrategies = ['LOWEST_COST_WITH_BID_CAP', 'COST_CAP', 'TARGET_COST'];
    if (capStrategies.includes(p.bid_strategy) && p.bid_amount_cents) {
      body.bid_strategy = p.bid_strategy;
      body.bid_amount = String(p.bid_amount_cents);
    } else {
      body.bid_strategy = 'LOWEST_COST_WITHOUT_CAP';
    }
    if (p.daily_budget_cents) body.daily_budget = String(p.daily_budget_cents);
    if (p.lifetime_budget_cents) body.lifetime_budget = String(p.lifetime_budget_cents);
    if (p.promoted_object) body.promoted_object = p.promoted_object;
    if (p.start_time) body.start_time = p.start_time;
    if (p.end_time) body.end_time = p.end_time;
    return request('POST', `/${adAccountId}/adsets`, { body });
  }

  async function getAdset(fbAdsetId, fields = 'id,name,campaign_id,status,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_strategy,targeting,promoted_object,start_time,end_time') {
    return request('GET', `/${fbAdsetId}`, { query: { fields } });
  }

  async function listAdsetsForCampaign(fbCampaignId, { limit = 25, after } = {}) {
    const query = {
      fields: 'id,name,status,daily_budget,lifetime_budget,optimization_goal,billing_event,targeting,start_time,end_time,is_dynamic_creative',
      limit,
    };
    if (after) query.after = after;
    return request('GET', `/${fbCampaignId}/adsets`, { query });
  }

  async function updateAdset(fbAdsetId, patch) {
    return request('POST', `/${fbAdsetId}`, { body: patch });
  }

  async function setAdsetStatus(fbAdsetId, status) {
    return updateAdset(fbAdsetId, { status });
  }

  // ─── media uploads ─────────────────────────────────────────────────────────
  /**
   * Upload an image to FB. Same pattern as uploadVideoFromUrl: try public
   * URL first, fall back to multipart when FB can't fetch it (dev-mode with
   * localhost URLs, or private R2 without a public domain).
   */
  async function uploadImageFromUrl(imageUrl) {
    if (!adAccountId) throw new FBApiError('fb_settings.ad_account_id is not set', { status: 412 });

    const isPublicUrl = /^https?:\/\//.test(imageUrl)
      && !/\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\])(?::|\/)/.test(imageUrl)
      && !imageUrl.startsWith('/');

    // Fast path — FB fetches the URL itself.
    if (isPublicUrl) {
      try {
        const r = await request('POST', `/${adAccountId}/adimages`, { body: { url: imageUrl } });
        const images = r.images || {};
        const first = Object.values(images)[0];
        if (!first?.hash) throw new FBApiError('Image upload did not return a hash', { raw: r });
        return { hash: first.hash, url: first.url };
      } catch (e) {
        const fb = e?.raw?.error;
        const retryable = fb?.code === 1487002 || /fetch/i.test(e?.message || '');
        if (!retryable) throw e;
        console.warn('[fb uploadImageFromUrl] URL fetch failed, falling back to multipart:', e?.message);
      }
    }

    // Multipart path — we download locally and stream to FB.
    const res = await fetch(imageUrl);
    if (!res.ok) throw new FBApiError(`Failed to download image locally (${res.status})`, { status: 502 });
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const blob = await res.blob();
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const fd = new FormData();
    fd.append('source', new File([blob], `image.${ext}`, { type: contentType }));
    const r = await request('POST', `/${adAccountId}/adimages`, { multipart: fd });
    const images = r.images || {};
    const first = Object.values(images)[0];
    if (!first?.hash) throw new FBApiError('Image upload did not return a hash', { raw: r });
    return { hash: first.hash, url: first.url };
  }

  /**
   * Upload a video to FB. FB supports two modes:
   *   a) `file_url` — FB fetches the URL itself (fast, works only when the
   *      URL is publicly reachable from FB's servers)
   *   b) multipart file upload — we stream bytes directly to FB (works from
   *      localhost + from a non-public-R2 setup)
   *
   * We try (a) first for public URLs (https and host !== localhost) and fall
   * back to (b) when FB says "Unable to fetch video file from url" (code
   * 1487002 / subcode 1885011) OR when the URL is obviously non-public.
   * This keeps dev-on-localhost working without forcing the admin to set up
   * a tunnel — FB just sees an upload from the Worker.
   */
  async function uploadVideoFromUrl(videoUrl, name, opts = {}) {
    if (!adAccountId) throw new FBApiError('fb_settings.ad_account_id is not set', { status: 412 });

    const isPublicUrl = /^https?:\/\//.test(videoUrl)
      && !/\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\])(?::|\/)/.test(videoUrl)
      && !videoUrl.startsWith('/');

    // Fast path: let FB fetch the URL itself.
    if (isPublicUrl && !opts.forceMultipart) {
      try {
        const r = await request('POST', `/${adAccountId}/advideos`, {
          body: { file_url: videoUrl, ...(name ? { name } : {}) },
        });
        return { id: r.id };
      } catch (e) {
        // FB code 1487002 = generic "can't fetch video from url". Fall through
        // to multipart. Any other error re-throws so the caller sees the real
        // problem instead of triggering an unnecessary large upload.
        const fb = e?.raw?.error;
        const retryable = fb?.code === 1487002 || /fetch video file from url/i.test(e?.message || '');
        if (!retryable) throw e;
        console.warn('[fb uploadVideoFromUrl] URL fetch failed, falling back to multipart:', e?.message);
      }
    }

    // Slow path: proxy the bytes through this Worker to FB.
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) {
      throw new FBApiError(`Failed to download video locally (${videoRes.status})`, { status: 502 });
    }
    const contentType = videoRes.headers.get('content-type') || 'video/mp4';
    const blob = await videoRes.blob();
    const fileName = name ? `${name}.mp4` : 'upload.mp4';
    const fd = new FormData();
    fd.append('source', new File([blob], fileName, { type: contentType }));
    if (name) fd.append('name', name);

    const r = await request('POST', `/${adAccountId}/advideos`, { multipart: fd });
    return { id: r.id };
  }

  async function getVideoStatus(videoId) {
    return request('GET', `/${videoId}`, { query: { fields: 'status,published,length,picture' } });
  }

  /**
   * Poll /{video_id}?fields=picture until FB returns a thumbnail URL (or we
   * give up). FB generates a static thumbnail almost immediately on upload
   * but the field sometimes takes a few seconds to populate. Returns the
   * URL or null if no thumbnail materialized within the timeout.
   */
  async function waitForVideoThumbnail(videoId, { timeoutMs = 20000, intervalMs = 1500 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const r = await request('GET', `/${videoId}`, { query: { fields: 'picture' } });
        if (r?.picture) return r.picture;
      } catch { /* transient — keep polling */ }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return null;
  }

  /**
   * Poll /{video_id}?fields=status until FB reports the video as `ready` for
   * use in an ad creative. FB returns a nested status object:
   *   { status: { video_status, processing_phase, uploading_phase, processing_progress } }
   * where video_status transitions: upload_complete → processing → ready (or failed).
   *
   * Creatives reject videos in `processing`/`upload_complete` with the opaque
   * code-1/subcode-99 and code-100/subcode-1885252 errors, so we must wait
   * here before calling createVideoCreative.
   *
   * Default timeout = 3 min (FB's SLA for short videos is well under that).
   * Returns true if the video reached `ready`, throws if it hit `failed`,
   * resolves false on timeout (caller decides whether to proceed anyway).
   */
  /**
   * Resolve FB's numeric locale IDs for a given language name.
   * FB's locale IDs aren't publicly documented and shift, but the
   * `targetingsearch` API returns live ones. Example:
   *   searchLocales('English') → [{ key: 1001, name: 'English (All)' }, …]
   */
  async function searchLocales(q) {
    if (!q) return [];
    const r = await request('GET', '/search', { query: { type: 'adlocale', q, limit: 25 } });
    return (r?.data || []).map((x) => ({ key: x.key, name: x.name }));
  }

  async function waitForVideoReady(videoId, { timeoutMs = 180000, intervalMs = 1500 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = null;
    while (Date.now() < deadline) {
      try {
        const r = await request('GET', `/${videoId}`, { query: { fields: 'status' } });
        const vs = r?.status?.video_status;
        lastStatus = vs || lastStatus;
        if (vs === 'ready') return true;
        if (vs === 'failed' || vs === 'error') {
          throw new FBApiError(`FB video ${videoId} failed to process (status=${vs})`, { status: 502 });
        }
      } catch (e) {
        if (e instanceof FBApiError) throw e;
        // transient fetch error — keep polling
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    // Hit the timeout — let the caller decide whether to proceed.
    console.warn(`[fb-api] waitForVideoReady timed out for ${videoId} (last status: ${lastStatus})`);
    return false;
  }

  // ─── creatives ─────────────────────────────────────────────────────────────
  /**
   * Create an ad creative for one or more videos. Returns { id } — the
   * creative id used by createAd.
   *
   * Two shapes are supported on the `p` parameter:
   *   Legacy single-value (back-compat):
   *     - video_id, image_hash/image_url, message, headline, description
   *   Multi-value (Dynamic Creative / asset_feed_spec):
   *     - videos: [{ video_id, image_hash?, image_url? }]
   *     - messages: string[]
   *     - headlines: string[]
   *     - descriptions?: string[]
   *
   * Shared fields:
   *   - page_id (defaults to fb_settings.page_id)
   *   - call_to_action: SHOP_NOW | LEARN_MORE | etc
   *   - link_url: destination URL (raw, UTMs go via url_tags below)
   *   - url_tags: separate UTM/tracking string, sent as the `url_tags` field
   *               — FB appends it to the served URL at impression time and
   *               shows it in the "URL parameters" column in Ads Manager.
   *   - instagram_actor_id: explicit IG account; when omitted/null we DO NOT
   *     inject fb_settings.instagram_actor_id → FB falls back to the Page
   *     (equivalent to "Use Facebook page" in the UI).
   *   - use_facebook_page_as_instagram: when true (default) we actively skip
   *     any IG actor so FB uses the page. Only ignored when the caller
   *     passes a non-empty instagram_actor_id.
   */
  async function createVideoCreative(p) {
    if (!adAccountId) throw new FBApiError('fb_settings.ad_account_id is not set', { status: 412 });
    const pageId = p.page_id || settings.page_id;
    if (!pageId) throw new FBApiError('No FB page_id configured (fb_settings.page_id)', { status: 412 });

    // ── Normalize inputs ───────────────────────────────────────────────────
    // Single video per ad (asset_feed_spec supports multi-video but that
    // flips the creative into Dynamic Creative territory, which locks the
    // adset to 1 ad). For multiple videos, the caller creates multiple ads.
    const videos = Array.isArray(p.videos) && p.videos.length
      ? p.videos
      : [{ video_id: p.video_id, image_hash: p.image_hash, image_url: p.image_url }];
    const firstVideo = videos[0] || {};
    const messages = (Array.isArray(p.messages) && p.messages.length ? p.messages
      : (p.message ? [p.message] : [])).slice(0, 5);
    const headlines = (Array.isArray(p.headlines) && p.headlines.length ? p.headlines
      : (p.headline ? [p.headline] : [])).slice(0, 5);
    const descriptions = (Array.isArray(p.descriptions) && p.descriptions.length ? p.descriptions
      : (p.description ? [p.description] : [])).slice(0, 5);
    const cta = p.call_to_action || 'SHOP_NOW';

    const explicitIgActor = p.instagram_actor_id;
    const useFbPage = p.use_facebook_page_as_instagram !== false;
    const igActor = explicitIgActor
      || (useFbPage ? null : (settings.instagram_actor_id || null));

    // ── Degrees of freedom — FB only accepts a narrow set of UPPERCASE keys
    //    on this account (it errors on anything else). STANDARD_ENHANCEMENTS_
    //    CATALOG is the umbrella we set to OPT_OUT to minimize Meta's
    //    auto-enabled "Essential enhancements" (Relevant comments, Enhance
    //    CTA, Add video effects, etc). Individual per-feature control for
    //    those is NOT exposed by Meta's API on this ad account — they're
    //    enrolled at the ad account level and must be disabled globally via
    //    Meta Ads Manager → Account Overview → Settings.
    const enh = p.creative_enhancements || {};
    const optIn = (flag) => enh[flag] === true;
    const creativeFeaturesSpec = {
      STANDARD_ENHANCEMENTS_CATALOG: { enroll_status: 'OPT_OUT' },
      IMAGE_ANIMATION:               { enroll_status: optIn('image_animation') ? 'OPT_IN' : 'OPT_OUT' },
      TEXT_OVERLAY_TRANSLATION:      { enroll_status: optIn('text_improvements') ? 'OPT_IN' : 'OPT_OUT' },
      IG_VIDEO_NATIVE_SUBTITLE:      { enroll_status: 'OPT_OUT' },
      PRODUCT_METADATA_AUTOMATION:   { enroll_status: 'OPT_OUT' },
      PROFILE_CARD:                  { enroll_status: 'OPT_OUT' },
    };

    // Resolve the Instagram actor for IG placements. Priority chain:
    //   1. Caller-provided instagram_actor_id
    //   2. The Page's connected IG Business Account (via Graph API)
    //   3. A Page-Backed Instagram Account (PBIA) — Meta creates one on
    //      demand for Pages without a real IG. This is what the "Use
    //      Facebook Page" toggle in Ads Manager uses behind the scenes.
    //   4. Give up → IG placements just won't serve (FB-only ad).
    const portraitVar = videos.find((v) => v.aspect === 'portrait' || v.format === 'portrait');
    const verticalVar = videos.find((v) => v.aspect === 'vertical' || v.format === 'vertical');
    const primaryVideo = portraitVar || firstVideo;

    let resolvedIgActor = igActor;
    if (!resolvedIgActor) {
      try {
        const r = await request('GET', `/${pageId}`, {
          query: { fields: 'instagram_business_account{id},connected_instagram_account{id}' },
        });
        resolvedIgActor = r?.instagram_business_account?.id
          || r?.connected_instagram_account?.id
          || null;
      } catch { /* fall through to PBIA */ }
    }
    // Page-Backed Instagram Account flow:
    //   1. Fetch Page Access Token (PBIA endpoints reject the user/system token)
    //   2. GET /{page_id}/instagram_accounts — lists ALL IG actors linked to
    //      the Page (real IG Business + PBIA). This is the endpoint that
    //      returns the IDs you pass as `instagram_actor_id` on a creative.
    //   3. If empty, POST /{page_id}/page_backed_instagram_accounts to create
    //      one, then re-query the instagram_accounts edge to get the proper
    //      actor id (the POST's own response returns a different id format
    //      that Marketing API rejects).
    if (!resolvedIgActor) {
      try {
        const pageTokRes = await request('GET', `/${pageId}`, {
          query: { fields: 'access_token' },
        });
        const pageAccessToken = pageTokRes?.access_token;
        if (!pageAccessToken) throw new Error('Page access_token unavailable — token needs pages_manage_ads + pages_show_list scopes');
        console.log('[fb-api] Got page access token for', pageId, 'len=', pageAccessToken.length);

        const fetchIgAccounts = async (edge) => {
          const url = `${base}/${pageId}/${edge}?fields=id,username&access_token=${encodeURIComponent(pageAccessToken)}`;
          const r = await fetch(url, { method: 'GET' });
          const j = await r.json().catch(() => ({}));
          console.log(`[fb-api] GET /${pageId}/${edge} →`, JSON.stringify(j).slice(0, 500));
          return j;
        };

        // 1. Try /instagram_accounts (primary edge). When PBIA exists it
        //    should show up here.
        let igJson = await fetchIgAccounts('instagram_accounts');
        resolvedIgActor = igJson?.data?.[0]?.id || null;

        // 2. Try /page_backed_instagram_accounts directly.
        if (!resolvedIgActor) {
          const pbJson = await fetchIgAccounts('page_backed_instagram_accounts');
          resolvedIgActor = pbJson?.data?.[0]?.id || pbJson?.id || null;
        }

        // 3. Still nothing → create a PBIA, then re-fetch both edges.
        if (!resolvedIgActor) {
          const pbiaCreateUrl = `${base}/${pageId}/page_backed_instagram_accounts?access_token=${encodeURIComponent(pageAccessToken)}`;
          const mkRes = await fetch(pbiaCreateUrl, { method: 'POST' });
          const mkJson = await mkRes.json().catch(() => ({}));
          console.log('[fb-api] POST /page_backed_instagram_accounts →', JSON.stringify(mkJson).slice(0, 500));
          if (mkJson?.id) resolvedIgActor = mkJson.id;
          if (!resolvedIgActor) {
            igJson = await fetchIgAccounts('instagram_accounts');
            resolvedIgActor = igJson?.data?.[0]?.id || null;
          }
          if (!resolvedIgActor) {
            const pbJson = await fetchIgAccounts('page_backed_instagram_accounts');
            resolvedIgActor = pbJson?.data?.[0]?.id || pbJson?.id || null;
          }
        }

        if (resolvedIgActor) {
          console.log('[fb-api] ✓ Resolved IG actor for page', pageId, '→', resolvedIgActor);
        } else {
          console.warn('[fb-api] ✗ Could not obtain an IG actor id for page', pageId,
            '— verify token has pages_manage_ads + pages_show_list scopes, and the Page has IG-ads permission');
        }
      } catch (e) {
        console.warn('[fb-api] IG actor resolution threw:', e?.message, e?.stack);
      }
    }

    const videoData = {
      video_id: primaryVideo.video_id,
      title: headlines[0] || '',
      message: messages[0] || '',
      call_to_action: { type: cta, value: { link: p.link_url } },
    };
    if (primaryVideo.image_hash) videoData.image_hash = primaryVideo.image_hash;
    else if (primaryVideo.image_url) videoData.image_url = primaryVideo.image_url;
    if (descriptions[0]) videoData.link_description = descriptions[0];

    const objectStorySpec = { page_id: pageId, video_data: videoData };
    // v22+ renamed the field: instagram_actor_id → instagram_user_id.
    // Old field is rejected with "must be a valid Instagram account id".
    if (resolvedIgActor) objectStorySpec.instagram_user_id = resolvedIgActor;

    const body = {
      name: p.name || `Creative ${Date.now()}`,
      object_story_spec: objectStorySpec,
      degrees_of_freedom_spec: { creative_features_spec: creativeFeaturesSpec },
    };
    if (p.url_tags) body.url_tags = p.url_tags;

    // Placement Asset Customization — only added when we have BOTH a distinct
    // portrait and vertical upload AND a resolved IG actor (real IG BA or
    // Page-Backed Instagram Account). Serves 4:5 on Feed/Marketplace and
    // 9:16 on Reels/Stories within a single non-Dynamic-Creative ad. Each
    // text array stays single-element so FB does NOT classify the creative
    // as Dynamic Creative. NOTE: when asset_feed_spec is present,
    // object_story_spec must drop video_data (FB errors "Object story spec
    // ill formed" otherwise) — asset_feed_spec carries the videos instead.
    if (portraitVar?.video_id && verticalVar?.video_id
        && portraitVar.video_id !== verticalVar.video_id
        && resolvedIgActor) {
      delete objectStorySpec.video_data;
      const videoEntry = (v) => {
        const out = { video_id: v.video_id, adlabels: [{ name: v.aspect || v.format }] };
        if (v.image_hash) out.thumbnail_hash = v.image_hash;
        else if (v.image_url) out.thumbnail_url = v.image_url;
        return out;
      };
      body.asset_feed_spec = {
        videos: [videoEntry(portraitVar), videoEntry(verticalVar)],
        bodies: [{ text: messages[0] || '' }],
        titles: [{ text: headlines[0] || '' }],
        ...(descriptions[0] ? { descriptions: [{ text: descriptions[0] }] } : {}),
        link_urls: [{ website_url: p.link_url }],
        ad_formats: ['SINGLE_VIDEO'],
        call_to_action_types: [cta],
        asset_customization_rules: [
          {
            customization_spec: {
              publisher_platforms: ['facebook', 'instagram', 'messenger', 'audience_network'],
              facebook_positions: ['feed', 'right_hand_column', 'marketplace', 'video_feeds', 'search'],
              instagram_positions: ['stream', 'explore', 'explore_home', 'profile_feed', 'shop'],
              messenger_positions: ['messenger_home'],
            },
            video_label: { name: 'portrait' },
          },
          {
            customization_spec: {
              publisher_platforms: ['facebook', 'instagram'],
              facebook_positions: ['story', 'facebook_reels'],
              instagram_positions: ['story', 'reels'],
            },
            video_label: { name: 'vertical' },
          },
        ],
      };
    }

    return request('POST', `/${adAccountId}/adcreatives`, { body });
  }

  /**
   * Create an ad creative for a single image. Same shape as the video version.
   */
  async function createImageCreative(p) {
    if (!adAccountId) throw new FBApiError('fb_settings.ad_account_id is not set', { status: 412 });
    const pageId = p.page_id || settings.page_id;
    if (!pageId) throw new FBApiError('No FB page_id configured (fb_settings.page_id)', { status: 412 });

    const linkData = {
      message: p.message || '',
      link: p.link_url,
      name: p.headline || '',
      description: p.description || '',
      call_to_action: { type: p.call_to_action || 'SHOP_NOW', value: { link: p.link_url } },
    };
    if (p.image_hash) linkData.image_hash = p.image_hash;
    else if (p.image_url) linkData.picture = p.image_url;

    const objectStorySpec = { page_id: pageId, link_data: linkData };
    // Mirror the "Use Facebook page" default from createVideoCreative so
    // image creatives don't silently fall back to fb_settings.instagram_actor_id.
    const explicitIgActor = p.instagram_actor_id;
    const useFbPage = p.use_facebook_page_as_instagram !== false;
    const igActor = explicitIgActor
      || (useFbPage ? null : (settings.instagram_actor_id || null));
    // v22+ field rename: instagram_actor_id → instagram_user_id.
    if (igActor) objectStorySpec.instagram_user_id = igActor;

    const body = {
      name: p.name || `Creative ${Date.now()}`,
      object_story_spec: objectStorySpec,
    };
    if (p.url_tags) body.url_tags = p.url_tags;
    return request('POST', `/${adAccountId}/adcreatives`, { body });
  }

  /**
   * Get a shareable preview link for a creative — useful for the admin to
   * see exactly how the ad will render in different placements before launch.
   */
  async function getCreativePreviews(fbCreativeId, ad_format = 'MOBILE_FEED_STANDARD') {
    return request('GET', `/${fbCreativeId}/previews`, { query: { ad_format } });
  }

  // ─── ads ───────────────────────────────────────────────────────────────────
  /**
   * Create an ad inside an adset, bound to a creative. PAUSED on creation.
   */
  async function createAd(p) {
    if (!adAccountId) throw new FBApiError('fb_settings.ad_account_id is not set', { status: 412 });
    return request('POST', `/${adAccountId}/ads`, {
      body: {
        name: p.name,
        adset_id: p.adset_id,
        creative: { creative_id: p.creative_id },
        status: 'PAUSED',
      },
    });
  }

  async function getAd(fbAdId, fields = 'id,name,adset_id,creative,status,preview_shareable_link') {
    return request('GET', `/${fbAdId}`, { query: { fields } });
  }

  async function listAdsForAdset(fbAdsetId, { limit = 25, after } = {}) {
    const query = { fields: 'id,name,status,creative{id},preview_shareable_link', limit };
    if (after) query.after = after;
    return request('GET', `/${fbAdsetId}/ads`, { query });
  }

  async function setAdStatus(fbAdId, status) {
    return request('POST', `/${fbAdId}`, { body: { status } });
  }

  // ─── insights (basic) ──────────────────────────────────────────────────────
  /**
   * Fetch insights for a campaign / adset / ad. Basic wrapper — caller passes
   * the level and the desired fields. Used later for the admin dashboard.
   */
  async function getInsights(fbObjectId, { fields, datePreset, timeRange, level } = {}) {
    const query = {
      fields: fields || 'impressions,reach,clicks,spend,ctr,cpc,cpm,actions,cost_per_action_type',
    };
    if (level) query.level = level;
    if (datePreset) query.date_preset = datePreset;
    if (timeRange) query.time_range = timeRange;
    return request('GET', `/${fbObjectId}/insights`, { query });
  }

  return {
    // raw
    request,
    settings,
    apiVersion,
    adAccountId,

    // account / page / business / pixel
    listAdAccounts,
    listPages,
    listBusinesses,
    listPixels,

    // campaigns
    createCampaign,
    getCampaign,
    listCampaigns,
    updateCampaign,
    setCampaignStatus,

    // adsets
    createAdset,
    getAdset,
    listAdsetsForCampaign,
    updateAdset,
    setAdsetStatus,

    // media
    uploadImageFromUrl,
    uploadVideoFromUrl,
    getVideoStatus,
    waitForVideoThumbnail,
    waitForVideoReady,
    searchLocales,

    // creatives
    createVideoCreative,
    createImageCreative,
    getCreativePreviews,

    // ads
    createAd,
    getAd,
    listAdsForAdset,
    setAdStatus,

    // insights
    getInsights,
  };
}
