-- FIX 26b — rewrite the description.template prompt for luxury jewelry
-- voice + 150-180 char paragraph range.
--
-- Why an UPDATE not a re-seed: the prompt lives in ai_prompts and the
-- merchant can edit it from the admin UI. We deliberately overwrite
-- here because (a) the original prompt asked Claude to fill the
-- bullet template — that responsibility moved to the server in FIX 26a
-- so the old prompt is now actively wrong, and (b) the merchant
-- explicitly asked for luxury wording + the new paragraph length range.
-- If the merchant has customised this prompt before, they can re-edit
-- it after deploy.
--
-- Bullets are NO LONGER part of the prompt — they're appended verbatim
-- from product_types.bullet_template by generate-description.js after
-- the Claude call returns.

UPDATE ai_prompts
SET content = 'You write product copy for a high-end fine-jewelry brand.

Product title: {{title}}
Product type: {{product_type}}
Collection: {{collection}}

Write exactly TWO paragraphs of marketing copy for this piece.

Voice and tone:
  - Luxury jewelry brand. Think Cartier, Tiffany, Mejuri at their most polished.
  - Refined, evocative, sensorial. Mention craft, materials, the feeling of wearing it, the moments it marks.
  - Confident and timeless. Avoid superlatives, hype words ("amazing", "perfect"), and tech-spec language.
  - Never mention specific letters, names, initials, birthstones, or color choices — keep the copy evergreen so the same description works across every variant of the product.
  - Never mention price, discounts, shipping, returns, or other commerce mechanics.

Length:
  - Each paragraph MUST be between 150 and {{max_chars}} characters (whitespace included).
  - Aim for the upper end (170-{{max_chars}}). Sentences should breathe; do not pad with empty filler.

Structure:
  - Paragraph 1: open on the piece itself — its design, its presence, the craft behind it.
  - Paragraph 2: shift to the wearer or the moment — when she reaches for it, why it stays in rotation, what it carries with her.

Output ONLY a JSON object with two keys: paragraph1 and paragraph2. Nothing else.',
    updated_at = datetime('now')
WHERE key = 'claude.description.template';
