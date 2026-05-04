import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listFonts, type PersonalizerField, type BirthstoneOption } from '@/lib/personalizer-api';

// P26-26 — month-name defaults used when the template's birthstones
// library hasn't been populated yet OR the merchant left the label
// blank. Allows the field's "Default selected month" dropdown to
// always show something readable.
const DEFAULT_MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// P26-10 — curated Google Fonts library. Lato is the default for
// new fields (most readable on jewelry product photography). The
// rest covers script (engraving / monogram), serif (luxury), and
// sans (modern / minimal) styles. Storefront widget loads these
// via a single Google Fonts CSS link injected at boot.
const CURATED_FONTS = [
  // Sans-serif (default + modern)
  'Lato', 'Inter', 'Montserrat', 'Poppins', 'Raleway', 'Nunito', 'Quicksand',
  'Work Sans', 'Open Sans', 'Source Sans 3',
  // Serif (luxury / traditional)
  'Playfair Display', 'Cormorant Garamond', 'Cinzel', 'EB Garamond',
  'Libre Baskerville', 'Lora', 'Crimson Text', 'Merriweather',
  // Script / handwritten (engraving)
  'Pinyon Script', 'Great Vibes', 'Allura', 'Dancing Script', 'Sacramento',
  'Parisienne', 'Tangerine', 'Pacifico', 'Satisfy', 'Yellowtail',
  // Display (statement)
  'Bebas Neue', 'Oswald', 'Abril Fatface', 'Comfortaa',
];
const CURVES = ['linear', 'arc', 'circle'] as const;
const MASKS = ['rect', 'circle', 'heart'] as const;

interface Props {
  field: PersonalizerField;
  onPatch: (patch: Partial<PersonalizerField>) => void;
  /** P25-V4 — distinct variant option values the admin can pick from for
   * the "Visible for variants" multi-select (e.g. ["1 Pendant", "2 Pendants",
   * "3 Pendants", "Gold", "Silver"]). When empty, falls back to a free-text
   * comma-separated input so the form still works on products with no
   * Shopify-side variant data yet. */
  availableVariantValues?: string[];
  /** P25-V4 — distinct COLOR option values for this product (e.g. ["Gold",
   * "Silver"]). Drives the "Text color per variant value" section so the
   * admin gets one row per color instead of typing keys by hand. Empty
   * = section hidden. */
  availableColorValues?: string[];
  /** P26-26 — template-level birthstones library, parsed from
   * `tpl.birthstones_json`. Drives the "Default selected month"
   * dropdown for birthstone fields and the per-month label preview. */
  birthstones?: BirthstoneOption[];
}

export function FieldConfigForm({ field, onPatch, availableVariantValues = [], availableColorValues = [], birthstones = [] }: Props) {
  const [draft, setDraft] = useState(field);
  const [fontOptions, setFontOptions] = useState<string[]>(CURATED_FONTS);

  useEffect(() => { setDraft(field); }, [field.id]);

  useEffect(() => {
    listFonts()
      .then((customFonts) => {
        const customNames = customFonts.map((f) => f.family_name).filter((n) => !CURATED_FONTS.includes(n));
        setFontOptions([...CURATED_FONTS, ...customNames]);
      })
      .catch(() => { /* keep curated list on error */ });
  }, []);

  function patch<K extends keyof PersonalizerField>(k: K, v: PersonalizerField[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
    onPatch({ [k]: v } as Partial<PersonalizerField>);
  }

  // P26-26 follow-up — bound the form's width AND let it shrink so
  // the canvas in the middle column always gets enough room to
  // show the live preview. Without max-w / flex-shrink-0 the form
  // grows past its 320px floor whenever a Section is opened, the
  // canvas gets squeezed out of view, and the merchant can't
  // position fields visually. Width range 280-360 keeps every
  // input usable at any viewport.
  return (
    <div className="bg-white border-l border-gray-200 p-4 space-y-5 w-[320px] min-w-[280px] max-w-[360px] flex-shrink-0 overflow-y-auto">

      <Section title="Identity" defaultOpen>
        <Row label="Label (internal admin name)">
          <Input value={draft.label} onChange={(e) => patch('label', e.target.value)} />
        </Row>
        {/* P25-V4 — customer-facing label shown above the input on the
            storefront. The internal `label` above stays as the admin
            name; this is what the shopper actually reads. */}
        <Row label="Customer-facing label (shown to shopper)">
          <Input
            placeholder="(falls back to internal Label)"
            value={draft.customer_label || ''}
            onChange={(e) => patch('customer_label', e.target.value || null)}
          />
        </Row>
        {/* P26-28 follow-up — birthstone fields render as a dropdown
            selector on the storefront, not an input — a placeholder
            hint would never appear, so hide the row to keep the form
            focused on relevant settings. */}
        {draft.field_kind !== 'birthstone' && (
          <Row label="Placeholder (gray hint)">
            <Input value={draft.placeholder || ''} onChange={(e) => patch('placeholder', e.target.value || null)} />
          </Row>
        )}
        <Row label="Default value (pre-filled, submitted if untouched)">
          <Input value={draft.default_value || ''} onChange={(e) => patch('default_value', e.target.value || null)} />
        </Row>
        <Row label="Required">
          <Select value={draft.required ? 'yes' : 'no'} onValueChange={(v) => patch('required', v === 'yes' ? 1 : 0)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">Required</SelectItem>
              <SelectItem value="no">Optional</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        {/* P25-6 / P26-17 — cart_label overrides what shows in the
            Shopify cart line item. Lets the admin keep a long
            descriptive label in the storefront input ("Enter the
            recipient's first name") but display a clean short tag
            in the cart ("First name"). Empty = falls back to the
            regular Label. P26-17: placeholder echoes the active
            label so the merchant immediately understands what the
            cart will read if they leave it blank. */}
        <Row label="Cart label (what shows in Shopify cart)">
          <Input
            placeholder={draft.label ? `(uses "${draft.label}" by default)` : '(uses Label by default)'}
            value={draft.cart_label || ''}
            onChange={(e) => patch('cart_label', e.target.value || null)}
          />
        </Row>
        {/* P25-6 / P25-V4 — list of variant option values this field
            shows on. Empty = always visible. When the parent passes
            availableVariantValues (list of distinct option values from
            Shopify), we render a checkbox grid so the admin clicks
            instead of typing. Falls back to the comma-separated input
            when no variants are available. */}
        <Row label="Visible for variants (none selected = always visible)">
          {availableVariantValues.length > 0 ? (
            <VariantValueMultiSelect
              available={availableVariantValues}
              selected={parseVariantList(draft.visible_variant_options)}
              onChange={(arr) =>
                patch('visible_variant_options', arr.length === 0 ? null : JSON.stringify(arr))
              }
            />
          ) : (
            <Input
              placeholder="e.g. 2,3,4"
              value={parseVariantList(draft.visible_variant_options).join(', ')}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (!raw) return patch('visible_variant_options', null);
                const arr = raw.split(',').map((s) => s.trim()).filter(Boolean);
                patch('visible_variant_options', JSON.stringify(arr));
              }}
            />
          )}
        </Row>
      </Section>

      {draft.field_kind === 'text' && (
        <>
          <Section title="Constraints">
            <Row label="Max characters">
              <Input type="number" value={draft.max_chars || ''} onChange={(e) => patch('max_chars', e.target.value ? parseInt(e.target.value) : null)} />
            </Row>
            <Row label="Allow empty (skip on preview)">
              <Select value={draft.allow_empty ? 'yes' : 'no'} onValueChange={(v) => patch('allow_empty', v === 'yes' ? 1 : 0)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Allow empty</SelectItem>
                  <SelectItem value="no">Always render</SelectItem>
                </SelectContent>
              </Select>
            </Row>
          </Section>

          <Section title="Typography">
            <Row label="Font family">
              {/* P26-13 — proper combobox: full list visible on open
                  with a search field at the top. Built inline because
                  shadcn doesn't ship Command/Popover here. The trigger
                  shows the current selection in its own typeface so
                  the merchant gets a live preview. */}
              <FontPicker
                value={draft.font_family || ''}
                options={fontOptions}
                onChange={(v) => patch('font_family', v)}
              />
            </Row>
            <Row label="Max font size (px)">
              <Input type="number" value={draft.font_size_px || ''} onChange={(e) => patch('font_size_px', e.target.value ? parseInt(e.target.value) : null)} />
            </Row>
            <Row label="Color (hex)">
              {/* P25-V4 — pair the hex input with a native RGB color
                  picker. Both bind to the same value so the admin can
                  click the swatch to pick visually OR type the hex. */}
              <div className="flex items-center gap-2">
                <Input
                  value={draft.font_color || ''}
                  onChange={(e) => patch('font_color', e.target.value || null)}
                  placeholder="#FAEEDA"
                  className="flex-1 font-mono"
                />
                <input
                  type="color"
                  value={normalizeHexForPicker(draft.font_color)}
                  onChange={(e) => patch('font_color', e.target.value)}
                  className="h-9 w-9 cursor-pointer rounded border border-gray-200 p-0.5"
                  title="Pick color"
                />
              </div>
            </Row>
            {/* P25-V2 — letter_spacing now in PX (user-space coordinates),
                rendered via SVG <text letter-spacing="N">. Integer step;
                positive = wider tracking, negative = condensed. */}
            <Row label="Letter spacing (px)">
              <Input
                type="number"
                step="1"
                value={draft.letter_spacing ?? ''}
                onChange={(e) =>
                  patch(
                    'letter_spacing',
                    e.target.value === '' ? null : parseInt(e.target.value, 10),
                  )
                }
              />
            </Row>
            <Row label="Curve">
              <Select
                value={draft.curve_mode || 'linear'}
                onValueChange={(v) => {
                  patch('curve_mode', v as any);
                  // P26-12 — when switching to arc/circle for the first
                  // time, give the field a generous default radius
                  // (3x its width) so the initial curve looks gentle
                  // and natural instead of a tight semi-circle. The
                  // merchant can fine-tune via the apex handle after.
                  if ((v === 'arc' || v === 'circle') && (!draft.curve_radius_px || draft.curve_radius_px === 0)) {
                    patch('curve_radius_px', Math.round((draft.width || 200) * 3));
                  }
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURVES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </Row>
            {(draft.curve_mode === 'arc' || draft.curve_mode === 'circle') && (
              <Row label="Curve radius (px)">
                <Input type="number" value={draft.curve_radius_px || ''} onChange={(e) => patch('curve_radius_px', e.target.value ? parseInt(e.target.value) : null)} />
              </Row>
            )}
            {/* FIX 30 — Curve tilt: rotates the chord (and the arc with
                it) in degrees so the text wraps around tilted ring tips
                seen in 3/4-view product photos. -90..+90 covers every
                useful angle; 0 = legacy horizontal arc. Only meaningful
                for arc mode (circle is symmetric and doesn't benefit). */}
            {draft.curve_mode === 'arc' && (
              <Row label="Curve tilt (°)">
                <Input
                  type="number"
                  step="1"
                  min="-90"
                  max="90"
                  placeholder="0"
                  value={draft.curve_tilt_deg ?? ''}
                  onChange={(e) =>
                    patch(
                      'curve_tilt_deg',
                      e.target.value === '' ? null : parseFloat(e.target.value),
                    )
                  }
                />
              </Row>
            )}
          </Section>

          {/* P25-V4 — per-color text color overrides. One row per
              distinct color value the product offers; empty hex =
              fall back to the global font_color above. The map is
              persisted as `font_color_by_value_json` ({ "Gold":
              "#FAEEDA", ... }) and looked up case-insensitively at
              render time on the storefront. */}
          {availableColorValues.length > 0 && (
            <Section title="Text color per variant value">
              {availableColorValues.map((colorVal) => {
                const colorMap = parseColorMap(draft.font_color_by_value_json);
                const hex = colorMap[colorVal] || '';
                return (
                  <Row key={colorVal} label={`Color when "${colorVal}" is selected`}>
                    <div className="flex items-center gap-2">
                      <Input
                        value={hex}
                        onChange={(e) => {
                          const next = { ...parseColorMap(draft.font_color_by_value_json) };
                          const v = e.target.value;
                          if (v) next[colorVal] = v;
                          else delete next[colorVal];
                          patch(
                            'font_color_by_value_json',
                            Object.keys(next).length ? JSON.stringify(next) : null,
                          );
                        }}
                        placeholder="(uses Color above)"
                        className="flex-1 font-mono"
                      />
                      <input
                        type="color"
                        value={normalizeHexForPicker(hex || draft.font_color)}
                        onChange={(e) => {
                          const next = { ...parseColorMap(draft.font_color_by_value_json) };
                          next[colorVal] = e.target.value;
                          patch('font_color_by_value_json', JSON.stringify(next));
                        }}
                        className="h-9 w-9 cursor-pointer rounded border border-gray-200 p-0.5"
                        title="Pick color"
                      />
                      {hex && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = { ...parseColorMap(draft.font_color_by_value_json) };
                            delete next[colorVal];
                            patch(
                              'font_color_by_value_json',
                              Object.keys(next).length ? JSON.stringify(next) : null,
                            );
                          }}
                          className="text-gray-400 hover:text-rose-700 px-1 text-sm"
                          title="Reset to default color"
                          aria-label={`Reset color override for ${colorVal}`}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </Row>
                );
              })}
            </Section>
          )}
        </>
      )}

      {draft.field_kind === 'image' && (
        <Section title="Image" defaultOpen>
          {/* P26-17 — cart_label is also exposed in Identity, but
              merchants editing a Photo field expect to see the cart
              property here. Without it the line item shows the raw
              "Photo" / "Photo 1" label and they assume the feature
              is missing. Same value as Identity → cart_label; both
              edit the same field. */}
          <Row label="Cart label (what shows in Shopify cart)">
            <Input
              placeholder={draft.label ? `(uses "${draft.label}" by default)` : 'e.g. Customer photo'}
              value={draft.cart_label || ''}
              onChange={(e) => patch('cart_label', e.target.value || null)}
            />
          </Row>
          <Row label="Mask shape">
            <Select value={draft.mask_shape || 'rect'} onValueChange={(v) => patch('mask_shape', v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MASKS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Max size (KB)">
            <Input type="number" value={draft.image_max_size_kb || 5120} onChange={(e) => patch('image_max_size_kb', parseInt(e.target.value || '5120'))} />
          </Row>
          {/* P26-8 — default presentation image. Stored on the
              field as default_value (URL). Shown in the storefront
              SVG overlay BEFORE the customer uploads their own
              photo, so the listing image doesn't read as "broken
              with a hole" while the customer is still browsing. */}
          <Row label="Default presentation image">
            {draft.default_value && (
              <div className="mb-2 flex items-center gap-2">
                <img
                  src={draft.default_value}
                  alt="default"
                  className="h-12 w-12 object-cover rounded border border-gray-200"
                />
                <button
                  type="button"
                  onClick={() => patch('default_value', null)}
                  className="text-xs text-rose-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const fd = new FormData();
                fd.append('file', file);
                try {
                  const res = await fetch('/api/personalizer/upload', { method: 'POST', body: fd });
                  if (!res.ok) throw new Error('Upload failed');
                  const j = (await res.json()) as { url: string };
                  patch('default_value', j.url);
                } catch (err) {
                  alert('Upload failed');
                }
                // Reset the input so the same file can be re-picked.
                e.target.value = '';
              }}
              className="text-xs"
            />
            <div className="text-[10px] text-muted-foreground mt-1">
              Optional. The customer sees this image in the live preview before they upload their own.
            </div>
          </Row>
        </Section>
      )}

      {/* P26-26 — Birthstone settings. The 12 PNG icons live at
          template level (uploaded via the "Birthstones library" panel
          above the field list), so this form only configures the
          DEFAULT selected month (drives the canvas preview + first
          paint on the storefront) and the cart label override. The
          actual selector UI is rendered by the storefront widget. */}
      {draft.field_kind === 'birthstone' && (
        <Section title="Birthstone" defaultOpen>
          <Row label="Cart label (what shows in Shopify cart)">
            <Input
              placeholder={draft.label ? `(uses "${draft.label}" by default)` : 'e.g. Birthstone'}
              value={draft.cart_label || ''}
              onChange={(e) => patch('cart_label', e.target.value || null)}
            />
          </Row>
          <Row label="Default selected month">
            <Select
              value={String(draft.default_value || '1')}
              onValueChange={(v) => patch('default_value', v)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => {
                  const monthIdx = i + 1;
                  const fromLib = birthstones.find((b) => b.month_index === monthIdx);
                  const label = (fromLib && fromLib.label) || DEFAULT_MONTH_LABELS[i];
                  return (
                    <SelectItem key={monthIdx} value={String(monthIdx)}>
                      {monthIdx}. {label}
                      {fromLib?.image_url ? '' : ' (no icon yet)'}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Mask shape">
            <Select value={draft.mask_shape || 'rect'} onValueChange={(v) => patch('mask_shape', v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MASKS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </Row>
          <div className="text-[11px] text-muted-foreground mt-1 leading-snug">
            Upload the 12 birthstone icons in the <strong>Birthstones library</strong> panel
            above the field list. They are shared across every birthstone layer on this product.
          </div>
        </Section>
      )}

      <Section title="Geometry">
        <Row label="Position X">
          <Input type="number" value={draft.position_x} onChange={(e) => patch('position_x', parseInt(e.target.value || '0'))} />
        </Row>
        <Row label="Position Y">
          <Input type="number" value={draft.position_y} onChange={(e) => patch('position_y', parseInt(e.target.value || '0'))} />
        </Row>
        <Row label="Width">
          <Input type="number" value={draft.width} onChange={(e) => patch('width', parseInt(e.target.value || '0'))} />
        </Row>
        <Row label="Height">
          <Input type="number" value={draft.height} onChange={(e) => patch('height', parseInt(e.target.value || '0'))} />
        </Row>
        <Row label="Rotation (deg)">
          <Input type="number" step="0.5" value={draft.rotation_deg ?? 0} onChange={(e) => patch('rotation_deg', parseFloat(e.target.value || '0'))} />
        </Row>
        <Row label="Layer z (higher = on top)">
          <Input type="number" value={draft.layer_z} onChange={(e) => patch('layer_z', parseInt(e.target.value || '10'))} />
        </Row>
      </Section>

      {/* P26-6 — Info hint. Optional tooltip shown next to the
          customer label as a small (i) icon. The field stays a
          fully-functional input — this is no longer a separate
          "Info-only" field type. Leave the field empty to hide
          the icon. */}
      <Section title="Info hint (optional)">
        <Row label="Tooltip text">
          <Input
            placeholder="e.g. Engraving allows 5 business days"
            value={draft.info_text || ''}
            onChange={(e) => {
              // Make sure is_info stays 0 — info is now just a hint,
              // never a field-type switch.
              if (draft.is_info === 1) patch('is_info', 0);
              patch('info_text', e.target.value || null);
            }}
          />
        </Row>
      </Section>
    </div>
  );
}

// P26-7 — collapsible accordion section. The form had a long flat
// list of every property on every field; the merchant asked for
// sections that fold so they can focus on one concern at a time.
// Identity stays open by default (most-edited block); others start
// collapsed and remember their open state for the duration of the
// session via component state.
function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-xs font-medium uppercase tracking-wide text-gray-700">
          {title}
        </span>
        <span
          className="text-gray-400 text-[10px] transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          {'>'}
        </span>
      </button>
      {open && <div className="space-y-3 px-3 py-3 bg-white">{children}</div>}
    </div>
  );
}

// P26-13 — searchable font picker. Click the trigger to open a panel
// with the FULL list visible (so the merchant can browse) plus a
// search field at the top to narrow it down. Each option renders in
// its own typeface so the merchant can pick by visual appearance.
function FontPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);
  const filtered = query.trim()
    ? options.filter((f) => f.toLowerCase().includes(query.toLowerCase()))
    : options;
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-sm transition-colors"
        style={{ fontFamily: value || 'inherit' }}
      >
        <span className="truncate">{value || 'Pick a font'}</span>
        <span className="text-gray-400 text-xs ml-2">{open ? 'v' : '>'}</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search font..."
            className="w-full px-3 py-2 text-sm border-b border-gray-200 outline-none"
          />
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400">No fonts match "{query}"</div>
            )}
            {filtered.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  onChange(f);
                  setOpen(false);
                  setQuery('');
                }}
                className={[
                  'w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors',
                  f === value ? 'bg-blue-50 text-blue-700' : '',
                ].join(' ')}
                style={{ fontFamily: f }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * P25-V4 — variant-value multi-select for the "Visible for variants"
 * field. Shows every distinct option value the product has (across all
 * dimensions — Color, Number of pendants, etc) as a checkbox chip.
 * Comparison is case-insensitive on save / read so admin and storefront
 * agree even if Shopify shifts capitalization.
 */
function VariantValueMultiSelect({
  available,
  selected,
  onChange,
}: {
  available: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const lowerSel = new Set(selected.map((s) => s.toLowerCase()));
  function toggle(v: string) {
    const lower = v.toLowerCase();
    if (lowerSel.has(lower)) {
      onChange(selected.filter((s) => s.toLowerCase() !== lower));
    } else {
      onChange([...selected, v]);
    }
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {available.map((v) => {
        const isSel = lowerSel.has(v.toLowerCase());
        return (
          <button
            key={v}
            type="button"
            onClick={() => toggle(v)}
            className={[
              'px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors',
              isSel
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400',
            ].join(' ')}
          >
            {v}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="text-[11px] text-rose-700 hover:underline ml-1"
        >
          Clear
        </button>
      )}
    </div>
  );
}

/**
 * P25-V4 — coerce any color string (hex, named, malformed) to a 7-char
 * hex string the native <input type="color"> accepts. Falls back to
 * white on parse failure so the picker still opens at a sensible spot.
 */
function normalizeHexForPicker(raw: string | null | undefined): string {
  if (!raw) return '#FFFFFF';
  const s = String(raw).trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s;
  if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
    return '#' + s.slice(1).split('').map((c) => c + c).join('');
  }
  // Off-by-one hex (5 or 7 chars) — pad with the last char.
  if (/^#[0-9A-Fa-f]{5}$/.test(s)) return s + s[s.length - 1];
  if (/^#[0-9A-Fa-f]{7}$/.test(s)) return s.slice(0, 7);
  return '#FFFFFF';
}

/**
 * P25-V4 — defensive parse of the font_color_by_value_json column.
 * Stored as a JSON-encoded `{ variantValue: hexColor }` map. Returns
 * an empty object on null/missing/malformed so callers can spread it
 * without guarding. Keys preserve original casing (the storefront
 * does its own case-insensitive lookup).
 */
function parseColorMap(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v) out[k] = v;
      }
      return out;
    }
  } catch {
    /* ignore malformed */
  }
  return {};
}

/**
 * P25-6 — defensive parse of the visible_variant_options column.
 * Stored as a JSON-encoded array of strings; legacy or hand-edited
 * rows might be NULL, "" or comma-separated. Always returns a clean
 * string[] for the input to bind to.
 */
function parseVariantList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
  } catch {
    /* fall through */
  }
  if (typeof raw === 'string' && raw.includes(',')) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return raw ? [String(raw).trim()] : [];
}
