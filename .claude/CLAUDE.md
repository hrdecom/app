# Jewelry CRM — E-commerce Platform

## Stack
- Frontend: React + Vite + TailwindCSS + shadcn/ui
- Backend: Cloudflare Workers (REST API)
- Database: Cloudflare D1 (SQLite) + KV (sessions/cache)
- Auth: JWT + Cloudflare KV
- Video editor: Remotion (CapCut-style UI)
- Deploy: Cloudflare Pages + Workers
- Repo: GitHub (hrdecom/app)

## User Roles
1. **admin** — Full access, validates products, manages users & prompts, reviews and launches FB Ads, global dashboard
2. **product-researcher** — Adds products (links from 1688/Temu/Alizy/Facebook, images, title) as catalog cards
3. **product-integrator** — Works on validated products, uses AI tools, pushes to Shopify
4. **ads-creator** — Creates ad assets (headlines, copy, images, videos), sends to admin for launch

## Product Workflow

cat > .claude/CLAUDE.md << 'EOF'
# Jewelry CRM — E-commerce Platform

## Stack
- Frontend: React + Vite + TailwindCSS + shadcn/ui
- Backend: Cloudflare Workers (REST API)
- Database: Cloudflare D1 (SQLite) + KV (sessions/cache)
- Auth: JWT + Cloudflare KV
- Video editor: Remotion (CapCut-style UI)
- Deploy: Cloudflare Pages + Workers
- Repo: GitHub (hrdecom/app)

## User Roles
1. **admin** — Full access, validates products, manages users & prompts, reviews and launches FB Ads, global dashboard
2. **product-researcher** — Adds products (links from 1688/Temu/Alizy/Facebook, images, title) as catalog cards
3. **product-integrator** — Works on validated products, uses AI tools, pushes to Shopify
4. **ads-creator** — Creates ad assets (headlines, copy, images, videos), sends to admin for launch

## Product Workflow Researcher adds product (links + images + title)
→ Appears as card in researcher's catalog
Admin clicks "Validate"
→ Card sent to integrator with "To Do" badge
Integrator clicks "Work on it"
→ Uses Claude (title + description generation)
→ Uses Nano Banana (image generation, pre-prompts by jewelry category)
→ Assigns images to Shopify variants (up to 52 variants: A-Z × 2 colors)
→ Clicks "Push to Shopify" → product created on Shopify, URL saved
Ads Creator receives card (images + title + description + Shopify URL)
→ Uses Claude (headlines, adcopy, translations in multiple languages)
→ Uses Nano Banana (ad images)
→ Uses Seedance Pro 2 (video generation from images/prompts)
→ Uses Remotion editor (cuts, music, zoom, text overlays)
→ Clicks "Ready for Review"
Admin reviews assets in "Launch Ads" interface
→ Configures FB campaign (new or existing)
→ Configures adset (new or existing)
→ Sets presets: worldwide/country targeting, FB AI on/off, budget, placements
→ Clicks "Publish" → Facebook Marketing API## Jewelry Categories & AI Prompts
All prompts are stored in D1 and editable by admin from the UI. Never hardcoded.
Categories: small rings, large rings, custom rings (3 colors: rose gold/silver/gold),
custom necklaces, bracelets, boxed jewelry sets.
Custom personalized jewelry: up to 26 initials × 2 colors (silver + gold) = 52 variants max.

## External APIs
- Anthropic Claude Opus 4.6 (titles, descriptions, headlines, adcopy, translations)
- Nano Banana latest pro (image generation for products and ads)
- Seedance Pro 2 (video generation)
- Shopify Admin API (product creation, variants, images)
- Facebook Marketing API (campaign/adset management, ad publishing)

## Design Principles
- Apple-like aesthetic: clean, minimal, high contrast
- Fully responsive: mobile / tablet / desktop
- Interface language: English
- Generated content: multi-language support
- Max simultaneous users: 2-3 collaborators

## Development Phases
Phase 0: Audit existing repo, Cloudflare setup, DB schema, Auth
Phase 1: CRM core — researcher UI, cards, admin validate, integrator list
Phase 2: Integrator AI tools — Claude + Nano Banana + Shopify push
Phase 3: Ads creator tools — Claude + Nano Banana + Seedance + Remotion editor
Phase 4: Facebook Ads launch interface + Marketing API
Phase 5: Advanced admin — dashboard, user management, prompt editor
Phase 6: Polish, QA, continuous debugging
