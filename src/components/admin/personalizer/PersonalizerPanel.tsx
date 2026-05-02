import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Rocket, ImageIcon, RotateCcw } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { FieldList } from './FieldList';
import { FieldConfigForm } from './FieldConfigForm';
import { PersonalizerCanvas } from './PersonalizerCanvas';
import {
  getTemplate, createTemplate, updateTemplate, createField, updateField, deleteField,
  listTemplateVariants, listFieldOverrides, upsertFieldOverride, deleteFieldOverride,
  getSettings,
  type PersonalizerTemplate, type PersonalizerField,
  type ShopifyVariantInfo, type VariantOverride,
} from '@/lib/personalizer-api';

interface Props {
  productId: number;
  baseImageUrl: string | null;
  shopifyHandle: string | null;
}

// P25-V3 — fallback list when settings.color_option_names_json is missing.
// Compared case-insensitively against Shopify option names.
const DEFAULT_COLOR_OPTION_NAMES = [
  'color', 'couleur', 'colour', 'metal', 'métal', 'material', 'matière',
];

/**
 * P25-V3 — compute the canonical "variant signature" for a Shopify variant.
 * The signature is the slash-joined list of NON-color option values, in
 * the original Shopify option order. Color-only variants collapse to "" and
 * share the base configuration. Examples:
 *   - options=[Style:"2 Hearts", Color:"Gold"]  →  "2 Hearts"
 *   - options=[Style:"2 Hearts", Size:"M", Color:"Gold"]  →  "2 Hearts / M"
 *   - options=[Color:"Gold"]  →  ""  (no override needed; uses base)
 *
 * MUST match the algorithm in the storefront widget for overrides to apply.
 */
function variantSignature(v: ShopifyVariantInfo, colorNames: string[]): string {
  const skip = new Set(colorNames.map((s) => s.toLowerCase()));
  const parts: string[] = [];
  for (let i = 0; i < v.option_names.length; i++) {
    const name = String(v.option_names[i] || '');
    const value = String(v.options[i] || '');
    if (!name || !value) continue;
    if (skip.has(name.toLowerCase())) continue;
    parts.push(value);
  }
  return parts.join(' / ');
}

export function PersonalizerPanel({ productId, baseImageUrl, shopifyHandle }: Props) {
  const { toast } = useToast();
  const [tpl, setTpl] = useState<PersonalizerTemplate | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // P25-V3 — multi-customization-per-variant state.
  // - shopifyVariants: every variant Shopify has for this product
  // - colorOptionNames: from /personalizer/settings (admin-editable)
  // - activeSignature: which signature the canvas is currently editing.
  //   "" means "base / default" — drags update the field's base values.
  //   Anything else means "this signature's override".
  // - overridesMap: { fieldId: { signature: { position_x, ... } } }
  // - variantImageOverrides: { signature: imageUrl } — swaps the canvas
  //   base image when the admin picks a non-default variant.
  const [shopifyVariants, setShopifyVariants] = useState<ShopifyVariantInfo[]>([]);
  const [colorOptionNames, setColorOptionNames] = useState<string[]>(DEFAULT_COLOR_OPTION_NAMES);

  // P26-5 — undo / redo for canvas commits (drags, resizes, curve,
  // rotation). Each entry is a (before, after) pair tagged with the
  // commit path (base field vs. override) so undo can route the
  // reverse patch through the right backend endpoint. Stacks live
  // entirely in this component — no backend persistence; history
  // resets on full page reload, which matches typical design-tool
  // expectations.
  type HistoryEntry =
    | { kind: 'base'; fieldId: number; before: Partial<PersonalizerField>; after: Partial<PersonalizerField> }
    | { kind: 'override'; fieldId: number; signature: string; before: Partial<VariantOverride>; after: Partial<VariantOverride> };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_history, setHistory] = useState<HistoryEntry[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  // P25-V4 — defaults to the first non-color signature once variants
  // load (set in `load()` below). Empty until then. We never expose
  // "" / "base" as a UI option; the FIRST variant IS the default.
  const [activeSignature, setActiveSignature] = useState<string>('');
  const [overridesMap, setOverridesMap] = useState<Record<number, Record<string, VariantOverride>>>({});
  const [variantImageOverrides, setVariantImageOverrides] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    try {
      const created = await createTemplate({
        product_id: productId,
        base_image_url: baseImageUrl || undefined,
        shopify_product_handle: shopifyHandle || undefined,
      });
      const fresh = await getTemplate(created.id);
      setTpl(fresh);
      const first = (fresh.fields || [])[0];
      if (first) setSelectedFieldId(first.id);

      // Hydrate the variant-image overrides from the template column.
      let imgOverrides: Record<string, string> = {};
      if (fresh.variant_image_overrides_json) {
        try { imgOverrides = JSON.parse(fresh.variant_image_overrides_json) || {}; }
        catch { /* ignore malformed */ }
      }
      setVariantImageOverrides(imgOverrides);

      // Pull global settings (for color_option_names_json) + Shopify
      // variants + per-field overrides in parallel — independent calls.
      const [settings, variantsResp, fieldOverridesResults] = await Promise.all([
        getSettings().catch(() => null),
        listTemplateVariants(created.id).catch(() => ({ items: [] as ShopifyVariantInfo[], option_names: [] })),
        Promise.all((fresh.fields || []).map(async (f) => [f.id, await listFieldOverrides(f.id).catch(() => [])] as const)),
      ]);
      if (settings?.color_option_names_json) {
        try {
          const parsed = JSON.parse(settings.color_option_names_json);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setColorOptionNames(parsed.map(String).filter(Boolean));
          }
        } catch { /* keep defaults */ }
      }
      setShopifyVariants(variantsResp.items || []);
      const map: Record<number, Record<string, VariantOverride>> = {};
      for (const [fid, list] of fieldOverridesResults) {
        const sigMap: Record<string, VariantOverride> = {};
        for (const ov of list as VariantOverride[]) sigMap[ov.variant_signature] = ov;
        map[fid] = sigMap;
      }
      setOverridesMap(map);

      // P25-V4 — pick the FIRST non-color signature as the default active
      // tab so the canvas opens on a real variant instead of an abstract
      // "base" mode. The "Default (base)" pill is gone; the first variant
      // IS the default and drags on it edit the field's base values.
      // Also re-resolve color names for signature computation now that
      // settings have loaded (kept in local var to avoid stale state).
      const colorNames = (() => {
        if (settings?.color_option_names_json) {
          try {
            const parsed = JSON.parse(settings.color_option_names_json);
            if (Array.isArray(parsed) && parsed.length > 0) {
              return parsed.map(String).filter(Boolean);
            }
          } catch { /* keep defaults */ }
        }
        return DEFAULT_COLOR_OPTION_NAMES;
      })();
      const sigs = (() => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const v of variantsResp.items || []) {
          const sig = variantSignature(v, colorNames);
          if (sig && !seen.has(sig)) { seen.add(sig); out.push(sig); }
        }
        return out;
      })();
      if (sigs.length > 0) setActiveSignature(sigs[0]);
    } catch (e: any) {
      toast({ title: 'Failed to load template', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [productId]);

  // P25-V3 — derived: distinct non-color signatures from the Shopify
  // variants, in the order Shopify returned them. We dedupe so a product
  // with 4 colors × 4 styles still shows just 4 signature pills (one per
  // style). The empty-string signature ("base") is always available
  // implicitly — it's the leftmost pill.
  const distinctSignatures = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of shopifyVariants) {
      const sig = variantSignature(v, colorOptionNames);
      if (!sig || seen.has(sig)) continue;
      seen.add(sig);
      out.push(sig);
    }
    return out;
  }, [shopifyVariants, colorOptionNames]);

  // For each non-color signature, pick a representative variant so we
  // can offer "Use this variant's Shopify image" without ambiguity. The
  // first variant matching the signature wins.
  const repVariantBySignature = useMemo(() => {
    const m: Record<string, ShopifyVariantInfo> = {};
    for (const v of shopifyVariants) {
      const sig = variantSignature(v, colorOptionNames);
      if (sig && !m[sig]) m[sig] = v;
    }
    return m;
  }, [shopifyVariants, colorOptionNames]);

  async function handleAddText() {
    if (!tpl) return;
    const created = await createField(tpl.id, {
      field_kind: 'text',
      label: 'New text',
      placeholder: 'Type here',
      default_value: null,
      required: 0,
      max_chars: 12,
      font_family: 'Pinyon Script',
      font_size_px: 22,
      font_color: '#FAEEDA',
      curve_mode: 'linear',
      position_x: 100, position_y: 100, width: 200, height: 40,
      layer_z: 10,
    });
    await load();
    setSelectedFieldId(created.id);
  }
  async function handleAddImage() {
    if (!tpl) return;
    const created = await createField(tpl.id, {
      field_kind: 'image',
      label: 'Photo',
      mask_shape: 'rect',
      position_x: 100, position_y: 100, width: 200, height: 200,
      layer_z: 5,
    });
    await load();
    setSelectedFieldId(created.id);
  }

  async function handlePatch(patch: Partial<PersonalizerField>) {
    if (!selectedFieldId) return;
    // P26-5 — record history for FieldConfigForm-driven changes too
    // (label, font, color, default_value, alignment, etc.) so Cmd+Z
    // covers everything, not just canvas drags.
    const prevField = (tpl?.fields || []).find((f) => f.id === selectedFieldId);
    if (prevField) {
      const before: Partial<PersonalizerField> = {};
      for (const k of Object.keys(patch) as (keyof PersonalizerField)[]) {
        (before as any)[k] = (prevField as any)[k];
      }
      setHistory((h) => [...h, { kind: 'base', fieldId: selectedFieldId, before, after: patch }]);
      setRedoStack([]);
    }
    await updateField(selectedFieldId, patch);
    setTpl((prev) => prev && {
      ...prev,
      fields: (prev.fields || []).map((f) => f.id === selectedFieldId ? { ...f, ...patch } as PersonalizerField : f),
    });
  }

  async function handlePublish() {
    if (!tpl) return;
    setSaving(true);
    try {
      await updateTemplate(tpl.id, { status: 'published' });
      toast({ title: 'Personalizer published', description: 'Storefront will pick up the change on next page load.' });
    } catch (e: any) {
      toast({ title: 'Publish failed', description: e?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  // P26-5 — apply an undo/redo entry. Replays the reverse (or forward)
  // patch through the same code path that originally committed it,
  // so the backend stays in sync. Does NOT push back into history
  // (the caller handles redoStack vs. history bookkeeping).
  async function applyHistoryEntry(entry: HistoryEntry, useBefore: boolean) {
    if (entry.kind === 'base') {
      const patch = useBefore ? entry.before : entry.after;
      setTpl((prev) => prev && {
        ...prev,
        fields: (prev.fields || []).map((f) =>
          f.id === entry.fieldId ? ({ ...f, ...patch } as PersonalizerField) : f,
        ),
      });
      try {
        await updateField(entry.fieldId, patch);
      } catch (e: any) {
        toast({ title: 'Undo/redo failed', description: e?.message, variant: 'destructive' });
        await load();
      }
    } else {
      const sig = entry.signature;
      const patch = useBefore ? entry.before : entry.after;
      setOverridesMap((m) => {
        const fieldMap = { ...(m[entry.fieldId] || {}) };
        fieldMap[sig] = {
          ...(fieldMap[sig] || { variant_signature: sig }),
          ...patch,
          variant_signature: sig,
        };
        return { ...m, [entry.fieldId]: fieldMap };
      });
      try {
        await upsertFieldOverride(entry.fieldId, sig, patch);
      } catch (e: any) {
        toast({ title: 'Undo/redo failed', description: e?.message, variant: 'destructive' });
        await load();
      }
    }
  }

  async function undo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      setRedoStack((r) => [...r, last]);
      // Fire async; state update is sync.
      applyHistoryEntry(last, true);
      return h.slice(0, -1);
    });
  }

  async function redo() {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const last = r[r.length - 1];
      setHistory((h) => [...h, last]);
      applyHistoryEntry(last, false);
      return r.slice(0, -1);
    });
  }

  // P26-5 — global Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z. Skipped when the
  // user is typing in an input/textarea so we don't fight with native
  // text undo. Uses captured handlers so Mac and Windows both work.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || (tgt as HTMLElement).isContentEditable)) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // P25-V3 — set or clear the variant-base-image override. We mutate the
  // local map optimistically and PATCH the template's
  // variant_image_overrides_json. Empty url removes the entry.
  async function setVariantImageOverride(signature: string, url: string | null) {
    if (!tpl || !signature) return;
    const next = { ...variantImageOverrides };
    if (url) next[signature] = url;
    else delete next[signature];
    setVariantImageOverrides(next);
    try {
      await updateTemplate(tpl.id, { variant_image_overrides_json: JSON.stringify(next) });
    } catch (e: any) {
      // Revert on error.
      setVariantImageOverrides(variantImageOverrides);
      toast({ title: 'Failed to save variant image', description: e?.message, variant: 'destructive' });
    }
  }

  if (loading || !tpl) {
    return <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const baseFields = tpl.fields || [];
  const selected = baseFields.find((f) => f.id === selectedFieldId) || null;

  // P25-V4 — the FIRST signature is treated as the "base". Drags on it
  // update the field's base values directly (not overrides). Other
  // signatures = override layer on top of base. This eliminates the
  // confusing "Default (base)" pseudo-tab while keeping per-variant
  // customization.
  const firstSignature = distinctSignatures[0] || '';
  const isFirstSig = activeSignature !== '' && activeSignature === firstSignature;

  // P25-V4 — TRUE if this field's `visible_variant_options` includes the
  // active signature (or if no restriction). Mirrors the storefront's
  // visibility filter so the canvas preview matches what the customer
  // will actually see for this variant.
  function isFieldVisibleForActive(f: PersonalizerField): boolean {
    const allowedRaw = f.visible_variant_options;
    if (!allowedRaw) return true;
    let allowed: string[] = [];
    try {
      const parsed = JSON.parse(allowedRaw);
      if (Array.isArray(parsed)) allowed = parsed.map(String);
    } catch {
      if (typeof allowedRaw === 'string') allowed = allowedRaw.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (allowed.length === 0) return true;
    if (!activeSignature) return true;
    // Match if any allowed value appears in the active signature's
    // slash-joined parts (case-insensitive). Same algorithm as widget.
    const sigParts = activeSignature.split(' / ').map((p) => p.toLowerCase());
    return allowed.some((needle) => sigParts.includes(needle.toLowerCase()));
  }

  const effectiveFields: PersonalizerField[] = baseFields
    .filter(isFieldVisibleForActive)
    .map((f) => {
      // First variant uses base values as-is. No override merge.
      if (isFirstSig) return f;
      const ov = activeSignature ? overridesMap[f.id]?.[activeSignature] : null;
      if (!ov) return f;
      return {
        ...f,
        position_x: ov.position_x ?? f.position_x,
        position_y: ov.position_y ?? f.position_y,
        width: ov.width ?? f.width,
        height: ov.height ?? f.height,
        rotation_deg: ov.rotation_deg ?? f.rotation_deg,
        curve_radius_px: ov.curve_radius_px ?? f.curve_radius_px,
      };
    });

  // P25-V4 — effective base image: explicit override > Shopify variant's
  // featured_image_url > template base. This makes "use Shopify variant
  // image" the DEFAULT behaviour without requiring a save per variant.
  const effectiveBaseImage =
    (activeSignature && variantImageOverrides[activeSignature]) ||
    (activeSignature && repVariantBySignature[activeSignature]?.featured_image_url) ||
    tpl.base_image_url;
  const effectiveTemplate: PersonalizerTemplate = { ...tpl, base_image_url: effectiveBaseImage };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-gray-200 px-4 py-2 flex items-center justify-between">
        <div className="text-sm font-medium">Personalizer · {tpl.status}</div>
        <Button size="sm" onClick={handlePublish} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Rocket className="h-3.5 w-3.5 mr-1" />}
          Publish
        </Button>
      </div>
      <div className="flex flex-1 min-h-0">
        <FieldList
          fields={baseFields}
          selectedId={selectedFieldId}
          onSelect={setSelectedFieldId}
          onAddText={handleAddText}
          onAddImage={handleAddImage}
          onReorder={async (ids) => {
            // P26-8 — unified layer reorder. ids is the new order from
            // top of list to bottom, including the sentinel -1 for the
            // product image. We recompute layer_z values from list
            // position (top of list = highest z = visually on top) so
            // the merchant's drag literally moves things in/out of
            // the visual stack. Each affected layer gets one update:
            //   • field rows -> updateField(id, { layer_z, sort_order })
            //   • product image row -> updateTemplate(id, { base_image_layer_z })
            const prevFields = baseFields;
            const prevImageZ = tpl?.base_image_layer_z ?? 5;
            const N = ids.length;
            const fieldUpdates: Array<{ id: number; layer_z: number; sort_order: number }> = [];
            let nextImageZ = prevImageZ;
            ids.forEach((id, i) => {
              const newZ = N - i; // top = N, bottom = 1
              if (id === -1) {
                nextImageZ = newZ;
              } else {
                fieldUpdates.push({ id, layer_z: newZ, sort_order: i });
              }
            });
            // Optimistic local update so the list snaps in place.
            setTpl((t) => {
              if (!t) return t;
              const idToZ = new Map(fieldUpdates.map((u) => [u.id, u.layer_z]));
              const idToSort = new Map(fieldUpdates.map((u) => [u.id, u.sort_order]));
              const newFields = (t.fields || []).map((f) => ({
                ...f,
                layer_z: idToZ.has(f.id) ? idToZ.get(f.id)! : f.layer_z,
                sort_order: idToSort.has(f.id) ? idToSort.get(f.id)! : f.sort_order,
              }));
              return { ...t, fields: newFields, base_image_layer_z: nextImageZ };
            });
            try {
              // Persist field z + sort_order in parallel + image z
              await Promise.all([
                ...fieldUpdates.map((u) => updateField(u.id, { layer_z: u.layer_z, sort_order: u.sort_order })),
                nextImageZ !== prevImageZ
                  ? updateTemplate(tpl!.id, { base_image_layer_z: nextImageZ })
                  : Promise.resolve(undefined),
              ]);
            } catch (e: any) {
              setTpl((t) => t ? { ...t, fields: prevFields, base_image_layer_z: prevImageZ } : t);
              toast({ title: 'Failed to reorder layers', description: e?.message, variant: 'destructive' });
            }
          }}
          baseImageLayerZ={tpl.base_image_layer_z ?? 5}
          onChangeBaseImageLayerZ={async (z) => {
            const prev = tpl.base_image_layer_z ?? 5;
            setTpl((t) => t ? { ...t, base_image_layer_z: z } : t);
            try {
              await updateTemplate(tpl.id, { base_image_layer_z: z });
            } catch (e: any) {
              setTpl((t) => t ? { ...t, base_image_layer_z: prev } : t);
              toast({ title: 'Failed to save image layer', description: e?.message, variant: 'destructive' });
            }
          }}
          onDelete={async (fieldId) => {
            try {
              await deleteField(fieldId);
              if (selectedFieldId === fieldId) setSelectedFieldId(null);
              await load();
              toast({ title: 'Field deleted' });
            } catch (e: any) {
              toast({ title: 'Failed to delete field', description: e?.message, variant: 'destructive' });
            }
          }}
          onDuplicate={async (fieldId) => {
            // P25-V4 — clone the field's full config with a small offset
            // so the duplicate is immediately visible (and not stacked
            // exactly under the original).
            const src = (tpl.fields || []).find((f) => f.id === fieldId);
            if (!src) return;
            try {
              const created = await createField(tpl.id, {
                field_kind: src.field_kind,
                label: `${src.label} (copy)`,
                placeholder: src.placeholder,
                default_value: src.default_value,
                required: src.required,
                max_chars: src.max_chars,
                allow_empty: src.allow_empty,
                font_family: src.font_family,
                font_size_px: src.font_size_px,
                font_color: src.font_color,
                text_align: src.text_align,
                letter_spacing: src.letter_spacing,
                curve_mode: src.curve_mode,
                curve_radius_px: src.curve_radius_px,
                position_x: src.position_x + 20,
                position_y: src.position_y + 20,
                width: src.width,
                height: src.height,
                rotation_deg: src.rotation_deg,
                mask_shape: src.mask_shape,
                image_max_size_kb: src.image_max_size_kb,
                layer_z: src.layer_z,
                cart_label: src.cart_label,
                visible_variant_options: src.visible_variant_options,
              });
              await load();
              setSelectedFieldId(created.id);
              toast({ title: 'Field duplicated' });
            } catch (e: any) {
              toast({ title: 'Failed to duplicate', description: e?.message, variant: 'destructive' });
            }
          }}
        />
        <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-3">
          {/* P25-V3 — variant picker. Always shows "Default" + one pill
              per non-color signature. Clicking a pill swaps the canvas
              into "edit overrides for this variant" mode. */}
          {distinctSignatures.length > 0 && (
            <VariantPicker
              signatures={distinctSignatures}
              active={activeSignature}
              onPick={setActiveSignature}
              variantImageOverrides={variantImageOverrides}
              repVariantBySignature={repVariantBySignature}
              onUseShopifyImage={(sig) => {
                const v = repVariantBySignature[sig];
                const url = v?.featured_image_url || null;
                if (!url) {
                  toast({ title: 'No Shopify image for this variant', variant: 'destructive' });
                  return;
                }
                setVariantImageOverride(sig, url);
              }}
              onResetImage={(sig) => setVariantImageOverride(sig, null)}
              onResetField={async (fieldId, sig) => {
                // Remove the per-variant override so the field falls back
                // to base values for this signature.
                const prev = overridesMap;
                setOverridesMap((m) => {
                  const next = { ...m };
                  if (next[fieldId]) {
                    next[fieldId] = { ...next[fieldId] };
                    delete next[fieldId][sig];
                  }
                  return next;
                });
                try {
                  await deleteFieldOverride(fieldId, sig);
                } catch (e: any) {
                  setOverridesMap(prev);
                  toast({ title: 'Failed to reset override', description: e?.message, variant: 'destructive' });
                }
              }}
              selectedFieldId={selectedFieldId}
              hasOverrideForSelectedField={
                selectedFieldId != null && activeSignature
                  ? Boolean(overridesMap[selectedFieldId]?.[activeSignature])
                  : false
              }
              isFirstVariant={isFirstSig}
            />
          )}
          <PersonalizerCanvas
            template={effectiveTemplate}
            fields={effectiveFields}
            selectedFieldId={selectedFieldId}
            onSelect={setSelectedFieldId}
            onDeselect={() => setSelectedFieldId(null)}
            onCommit={async (fieldId, patch) => {
              // P25-V4 — first variant = base. Drags update the field's
              // base values directly. Other variants = override layer.
              if (!activeSignature || isFirstSig) {
                // P26-5 — record the prior values for the keys this
                // patch touches, so undo can restore them.
                const prevField = (tpl?.fields || []).find((f) => f.id === fieldId);
                if (prevField) {
                  const before: Partial<PersonalizerField> = {};
                  for (const k of Object.keys(patch) as (keyof PersonalizerField)[]) {
                    (before as any)[k] = (prevField as any)[k];
                  }
                  setHistory((h) => [...h, { kind: 'base', fieldId, before, after: patch }]);
                  setRedoStack([]); // any new action invalidates the redo branch
                }
                setTpl((prev) =>
                  prev && {
                    ...prev,
                    fields: (prev.fields || []).map((f) =>
                      f.id === fieldId ? ({ ...f, ...patch } as PersonalizerField) : f,
                    ),
                  },
                );
                try {
                  await updateField(fieldId, patch);
                } catch (e: any) {
                  toast({ title: 'Failed to save position', description: e?.message, variant: 'destructive' });
                  await load();
                }
                return;
              }
              // Override path. Optimistic merge into overridesMap so the
              // canvas stays visually pinned to where the user dropped.
              const prevMap = overridesMap;
              // P26-5 — capture override "before" values for undo.
              const prevOverride = overridesMap[fieldId]?.[activeSignature];
              const overrideBefore: Partial<VariantOverride> = { variant_signature: activeSignature };
              for (const k of Object.keys(patch) as (keyof VariantOverride)[]) {
                (overrideBefore as any)[k] = prevOverride ? (prevOverride as any)[k] : null;
              }
              setHistory((h) => [...h, {
                kind: 'override', fieldId, signature: activeSignature,
                before: overrideBefore,
                after: { ...patch, variant_signature: activeSignature },
              }]);
              setRedoStack([]);
              setOverridesMap((m) => {
                const fieldMap = { ...(m[fieldId] || {}) };
                fieldMap[activeSignature] = {
                  ...(fieldMap[activeSignature] || { variant_signature: activeSignature }),
                  ...patch,
                  variant_signature: activeSignature,
                };
                return { ...m, [fieldId]: fieldMap };
              });
              try {
                await upsertFieldOverride(fieldId, activeSignature, patch);
              } catch (e: any) {
                setOverridesMap(prevMap);
                toast({ title: 'Failed to save override', description: e?.message, variant: 'destructive' });
              }
            }}
          />
        </div>
        {selected && (
          <FieldConfigForm
            field={selected}
            onPatch={handlePatch}
            // P25-V4 — distinct NON-COLOR option values across the
            // product's Shopify variants. Color values are excluded
            // (they don't belong in "Visible for variants" — colors are
            // handled per-color via font_color, not via show/hide).
            availableVariantValues={(() => {
              const colorSet = new Set(colorOptionNames.map((s) => s.toLowerCase()));
              const out: string[] = [];
              const seen = new Set<string>();
              for (const v of shopifyVariants) {
                for (let i = 0; i < (v.option_names || []).length; i++) {
                  const name = String(v.option_names[i] || '');
                  const value = String(v.options[i] || '');
                  if (!name || !value) continue;
                  if (colorSet.has(name.toLowerCase())) continue;
                  const k = value.toLowerCase();
                  if (seen.has(k)) continue;
                  seen.add(k);
                  out.push(value);
                }
              }
              return out;
            })()}
            // P25-V4 — distinct COLOR option values across the product's
            // variants. Mirrors availableVariantValues above but KEEPS
            // color names (instead of excluding them) so the per-color
            // text-color section can offer one row per color the
            // product actually ships in.
            availableColorValues={(() => {
              const colorSet = new Set(colorOptionNames.map((s) => s.toLowerCase()));
              const out: string[] = [];
              const seen = new Set<string>();
              for (const v of shopifyVariants) {
                for (let i = 0; i < (v.option_names || []).length; i++) {
                  const name = String(v.option_names[i] || '');
                  const value = String(v.options[i] || '');
                  if (!name || !value) continue;
                  if (!colorSet.has(name.toLowerCase())) continue;
                  const k = value.toLowerCase();
                  if (seen.has(k)) continue;
                  seen.add(k);
                  out.push(value);
                }
              }
              return out;
            })()}
          />
        )}
      </div>
    </div>
  );
}

// ─── VariantPicker ──────────────────────────────────────────────────────────

interface VariantPickerProps {
  signatures: string[];
  active: string;
  onPick: (sig: string) => void;
  variantImageOverrides: Record<string, string>;
  repVariantBySignature: Record<string, ShopifyVariantInfo>;
  onUseShopifyImage: (sig: string) => void;
  onResetImage: (sig: string) => void;
  selectedFieldId: number | null;
  hasOverrideForSelectedField: boolean;
  onResetField: (fieldId: number, sig: string) => void;
  /** P25-V4 — TRUE when the active signature is the first one (the "base"
   * variant). Drags edit the field directly instead of an override; no
   * per-variant reset button. */
  isFirstVariant: boolean;
}

function VariantPicker({
  signatures, active, onPick,
  variantImageOverrides, repVariantBySignature,
  onUseShopifyImage, onResetImage,
  selectedFieldId, hasOverrideForSelectedField, onResetField,
  isFirstVariant,
}: VariantPickerProps) {
  const activeRep = active ? repVariantBySignature[active] : null;
  const activeImageUrl = active ? (variantImageOverrides[active] || activeRep?.featured_image_url || null) : null;
  const usingShopifyImage =
    active && activeRep?.featured_image_url && variantImageOverrides[active] === activeRep.featured_image_url;
  const usingCustomImage = active && variantImageOverrides[active];
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Editing for</span>
        {/* P25-V4 — no "Default (base)" pill. The first signature IS the
            default; drags on it edit the field's base values. Other
            signatures stack overrides on top. */}
        {signatures.map((sig) => (
          <Pill key={sig} active={active === sig} onClick={() => onPick(sig)}>{sig}</Pill>
        ))}
      </div>
      {active && (
        <div className="flex items-center gap-2 pt-1 border-t border-gray-100 text-xs text-muted-foreground flex-wrap">
          {isFirstVariant ? (
            <span>This is the <strong className="text-gray-900">default</strong> — drags update the base position used by every variant unless they have their own override.</span>
          ) : (
            <span>Drags & resizes here only affect the <strong className="text-gray-900">{active}</strong> variant.</span>
          )}
          {!isFirstVariant && selectedFieldId != null && hasOverrideForSelectedField && (
            <button
              type="button"
              onClick={() => onResetField(selectedFieldId, active)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-rose-700 hover:bg-rose-50"
              title="Remove this field's override for this variant"
            >
              <RotateCcw className="h-3 w-3" /> Reset selected field for this variant
            </button>
          )}
        </div>
      )}
      {active && (
        <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-2">
            {activeImageUrl ? (
              <img
                src={activeImageUrl}
                alt=""
                className="h-10 w-10 rounded object-cover border border-gray-200 bg-white"
              />
            ) : (
              <div className="h-10 w-10 rounded border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center">
                <ImageIcon className="h-4 w-4 text-gray-400" />
              </div>
            )}
            <div className="flex flex-col">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Variant image</span>
              <span className="text-xs text-gray-700">
                {usingShopifyImage ? 'Using Shopify variant image' : usingCustomImage ? 'Using custom override' : 'Inheriting base image'}
              </span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {activeRep?.featured_image_url && !usingShopifyImage && (
              <Button size="sm" variant="outline" onClick={() => onUseShopifyImage(active)}>
                Use Shopify variant image
              </Button>
            )}
            {usingCustomImage && (
              <Button size="sm" variant="ghost" onClick={() => onResetImage(active)}>
                Reset image
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
