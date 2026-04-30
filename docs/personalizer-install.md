# Personalizer install

## Prerequisites
- Shopify store running an Online Store 2.0 theme (most modern themes).
- Shopify Admin API access token (existing — same one the CRM uses).
- A custom app (private app) registered for webhook signing — get the webhook secret.

## One-time setup (CRM side)
1. Apply migrations 0142–0145 on remote D1: `npm run db:migrate:remote`.
2. Set wrangler secrets: `wrangler secret put SHOPIFY_WEBHOOK_SECRET` and `wrangler secret put SHOPIFY_SHOP`.
3. Build the storefront bundle: `npm run build:storefront`.
4. Deploy: `npm run deploy`.
5. In Shopify Admin → Notifications → Webhooks, register `Order creation` JSON to `https://app.riccardiparis.com/api/personalizer/webhook/shopify-order` with API version 2024-10.

## Per-product setup (Roger flow)
1. Push the product to Shopify via the existing CRM flow.
2. In the product card, flip `supports_personalization=1` (admin-only flag).
3. Open the new "Personalizer" tab. Add fields, configure, hit Publish.
4. In your Shopify theme, paste the snippet from `storefront/personalizer/snippet.liquid` into `product.liquid` above the add-to-cart button.

## Troubleshooting
- Widget doesn't render → check the snippet placement, browser console for the fetch URL, and that the template `status='published'`.
- Order note missing → check Cloudflare logs for webhook errors, verify `SHOPIFY_WEBHOOK_SECRET` is correct.
- Preview wrong → re-publish the template (drafts are not served to the storefront).
