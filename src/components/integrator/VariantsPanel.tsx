import { useState, useEffect, useRef } from 'react';
import {
  Plus,
  X,
  Loader2,
  Layers,
  Link2,
  Sparkles,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { putProductVariants } from '@/lib/product-variants';
import { listVariantTemplates, type VariantTemplate } from '@/lib/variants';
import type { Product } from '@/types/product';
import { api } from '@/lib/api';
import { addProductImagesBatch } from '@/lib/products';

interface VariantOption {
  name: string;
  linkedMetafield: boolean;
  metafieldNamespace?: string;
  metafieldKey?: string;
  values: string[];
}

interface ColorValue { name: string; hex: string; }
interface MetafieldDef { id: string; name: string; namespace: string; key: string; type: string; }

interface VariantsPanelProps {
  product: Product;
  onUpdated: () => void;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const COLOR_SLUG: Record<string, string> = { Silver: 'silver', Gold: 'gold', 'Rose Gold': 'rose-gold' };
const COLOR_LABEL: Record<string, string> = { silver: 'Silver', gold: 'Gold', 'rose-gold': 'Rose Gold' };

interface SavedVariant {
  id: number;
  initial: string | null;
  color: string;
  label: string;
  image_id: number | null;
  image_url: string | null;
  options_json?: string | null;
}

// Parse a saved variant row's options_json into a [{name,value}] array.
// Falls back to reconstructing from the legacy `color` + `initial` columns
// when options_json is missing/empty (handles pre-migration rows).
function extractOptionsFromVariant(v: SavedVariant): { name: string; value: string }[] {
  if (v.options_json) {
    try {
      const parsed = JSON.parse(v.options_json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .filter((o) => o && typeof o.name === 'string' && o.value != null && o.value !== '')
          .map((o) => ({ name: String(o.name), value: String(o.value) }));
      }
    } catch {
      /* fall through to legacy reconstruction */
    }
  }
  const out: { name: string; value: string }[] = [];
  if (v.color) {
    out.push({
      name: 'Color',
      value: COLOR_LABEL[v.color] || v.color.charAt(0).toUpperCase() + v.color.slice(1).replace(/-/g, ' '),
    });
  }
  if (v.initial) out.push({ name: 'Initial', value: v.initial });
  return out;
}

export function VariantsPanel({ product, onUpdated }: VariantsPanelProps) {
  const { toast } = useToast();
  const [options, setOptions] = useState<VariantOption[]>([]);
  const [savedVariants, setSavedVariants] = useState<SavedVariant[]>([]);
  const [imageAssignments, setImageAssignments] = useState<Record<number, number | null>>({});
  const [templates, setTemplates] = useState<VariantTemplate[]>([]);
  const [metafieldDefs, setMetafieldDefs] = useState<MetafieldDef[]>([]);
  const [colorValues, setColorValues] = useState<ColorValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newVal, setNewVal] = useState<Record<number, string>>({});
  const [showImagePicker, setShowImagePicker] = useState<number | string | null>(null);
  // FIX 25a — upload from disk inside the variant-image picker. Same flow
  // as Image Studio's upload: read file → POST /api/images/upload → POST
  // /api/products/:id/images so the new image appears in product.images
  // and immediately becomes pickable for variant assignment.
  const variantUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingVariantImage, setUploadingVariantImage] = useState(false);

  async function handleVariantImageUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      toast({ title: 'Pick image files only', variant: 'destructive' });
      return;
    }
    setUploadingVariantImage(true);
    try {
      const items: { url_or_key: string; role: 'variant' }[] = [];
      for (const file of imageFiles) {
        const dataUrl: string = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result || ''));
          fr.onerror = () => reject(fr.error || new Error('FileReader failed'));
          fr.readAsDataURL(file);
        });
        const up: any = await api.post('/images/upload', { data_url: dataUrl });
        if (!up?.url) throw new Error(`Upload returned no URL for ${file.name}`);
        items.push({ url_or_key: up.url, role: 'variant' });
      }
      await addProductImagesBatch(product.id, items);
      toast({ title: `Uploaded ${items.length} image${items.length === 1 ? '' : 's'}` });
      // Refresh the parent product so product.images includes the new rows;
      // the picker grid then shows them on the next render.
      onUpdated();
    } catch (e: any) {
      toast({ title: 'Upload failed', description: e?.message, variant: 'destructive' });
    } finally {
      setUploadingVariantImage(false);
      if (variantUploadInputRef.current) variantUploadInputRef.current.value = '';
    }
  }

  const loadSavedVariants = async () => {
    try {
      const res: any = await api.get(`/products/${product.id}/variants`);
      const vars: SavedVariant[] = Array.isArray(res?.variants) ? res.variants : [];
      setSavedVariants(vars);
      // Reconstruct image assignments
      const assignments: Record<number, number | null> = {};
      vars.forEach((v) => { assignments[v.id] = v.image_id; });
      setImageAssignments(assignments);
      // Reconstruct options from the union of every saved variant's options_json.
      // Walk all variants in order, build a name → ordered Set<value> map. The first
      // variant's option ordering wins for the option-list order; values within an
      // option appear in first-seen order across the entire variant list.
      // The "Color" option (case-insensitive match) keeps its metafield linkage so
      // the color-pattern swatch picker still lights up.
      if (vars.length > 0) {
        const order: string[] = [];
        const valuesByName = new Map<string, string[]>();
        for (const v of vars) {
          const opts = extractOptionsFromVariant(v);
          for (const { name, value } of opts) {
            if (!valuesByName.has(name)) {
              valuesByName.set(name, []);
              order.push(name);
            }
            const arr = valuesByName.get(name)!;
            if (!arr.includes(value)) arr.push(value);
          }
        }
        const recon: VariantOption[] = order.map((name) => {
          const isColor = name.toLowerCase() === 'color';
          return isColor
            ? {
                name,
                linkedMetafield: true,
                metafieldNamespace: 'shopify',
                metafieldKey: 'color-pattern',
                values: valuesByName.get(name)!,
              }
            : {
                name,
                linkedMetafield: false,
                values: valuesByName.get(name)!,
              };
        });
        setOptions(recon);
      }
    } catch (e) {
      console.error('[VariantsPanel] load saved variants failed:', e);
    }
  };

  useEffect(() => {
    Promise.all([
      listVariantTemplates().catch(() => []),
      api.get('/shopify/variant-metafields').then((r: any) => r?.items || []).catch(() => []),
      // Load colors from Shopify metaobjects (canonical, deduplicated)
      api.get('/shopify/color-metaobjects').then((r: any) => {
        const items = r?.items || [];
        // Also try fallback from D1 color_metadata_map for hex values
        return api.get('/shopify/color-values').then((cv: any) => {
          const hexMap: Record<string, string> = {};
          (cv?.items || []).forEach((c: any) => { hexMap[c.name] = c.hex; });
          return items.map((i: any) => ({ name: i.name, hex: hexMap[i.name] || '#999', gid: i.gid }));
        }).catch(() => items.map((i: any) => ({ name: i.name, hex: '#999', gid: i.gid })));
      }).catch(() => []),
    ]).then(([t, m, c]) => {
      setTemplates(Array.isArray(t) ? t : []);
      setMetafieldDefs(Array.isArray(m) ? m : []);
      setColorValues(Array.isArray(c) ? c : []);
      loadSavedVariants().finally(() => setLoading(false));
    });
  }, [product.id]);

  const addOpt = (linked: boolean) => setOptions((p) => [...p, { name: '', linkedMetafield: linked, metafieldNamespace: linked ? '' : undefined, metafieldKey: linked ? '' : undefined, values: [] }]);
  const upOpt = (i: number, patch: Partial<VariantOption>) => setOptions((p) => p.map((o, j) => j === i ? { ...o, ...patch } : o));
  const rmOpt = (i: number) => setOptions((p) => p.filter((_, j) => j !== i));
  const addVal = (i: number, v: string) => { if (!v.trim()) return; setOptions((p) => p.map((o, j) => j === i && !o.values.includes(v.trim()) ? { ...o, values: [...o.values, v.trim()] } : o)); setNewVal((p) => ({ ...p, [i]: '' })); };
  const rmVal = (i: number, v: string) => setOptions((p) => p.map((o, j) => j === i ? { ...o, values: o.values.filter((x) => x !== v) } : o));

  const applyTemplate = (t: VariantTemplate) => {
    const o: VariantOption[] = [];
    const CL: Record<string, string> = { silver: 'Silver', gold: 'Gold', 'rose-gold': 'Rose Gold' };
    if (t.colors?.length) o.push({ name: 'Color', linkedMetafield: true, metafieldNamespace: 'shopify', metafieldKey: 'color-pattern', values: t.colors.map((c) => CL[c] || c) });
    if (t.kind === 'personalized' && t.initials?.length) o.push({ name: 'Initial', linkedMetafield: false, values: t.initials });
    setOptions(o);
    toast({ title: `Applied "${t.name}"` });
  };

  const combos = (() => {
    if (!options.length) return [];
    let c: Record<string, string>[] = [{}];
    for (const opt of options) { if (!opt.values.length) continue; const n: typeof c = []; for (const r of c) for (const v of opt.values) n.push({ ...r, [opt.name || 'Option']: v }); c = n; }
    return c;
  })();

  const handleSave = async () => {
    setSaving(true);
    try {
      const colorOpt = options.find((o) => o.name.toLowerCase() === 'color');
      const initOpt = options.find((o) => o.name.toLowerCase() === 'initial' || o.name.toLowerCase() === 'letter');
      const rows = combos.map((combo) => {
        const colorName = colorOpt ? combo[colorOpt.name] : null;
        const initial = initOpt ? combo[initOpt.name] : null;
        // Build options array for options_json storage
        const opts = Object.entries(combo).map(([name, value]) => ({ name, value }));
        return {
          color: (COLOR_SLUG[colorName || ''] || colorName?.toLowerCase().replace(/\s+/g, '-') || 'silver') as any,
          initial: initial || undefined,
          options: opts,
        };
      });
      const slug = product.variant_template_slug || (templates[0]?.slug ?? 'standard');
      await putProductVariants(product.id, { template_slug: slug, variants: rows });
      toast({ title: `${rows.length} variant(s) saved` });
      await loadSavedVariants();
      onUpdated();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      {/* Template shortcuts */}
      {templates.length > 0 && (
        <Card className="p-4 space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Quick start</Label>
          <div className="flex flex-wrap gap-2">
            {templates.filter((t) => t.is_active).map((t) => (
              <Button key={t.id} variant="outline" size="sm" onClick={() => applyTemplate(t)}>
                <Sparkles className="h-3 w-3 mr-1" /> {t.name}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {/* Option rows */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2"><Layers className="h-4 w-4" /> Options</h3>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => addOpt(true)}><Link2 className="h-3 w-3 mr-1" /> Metafield</Button>
            <Button variant="outline" size="sm" onClick={() => addOpt(false)}><Plus className="h-3 w-3 mr-1" /> Custom</Button>
          </div>
        </div>

        {options.length === 0 && (
          <Card className="p-6 text-center">
            <Layers className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No options. Use a template or add manually.</p>
          </Card>
        )}

        {options.map((opt, idx) => (
          <Card key={idx} className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant={opt.linkedMetafield ? 'default' : 'secondary'} className="text-[10px] shrink-0">{opt.linkedMetafield ? 'metafield' : 'custom'}</Badge>
              {opt.linkedMetafield ? (
                <Select
                  value={opt.metafieldNamespace && opt.metafieldKey ? `${opt.metafieldNamespace}::${opt.metafieldKey}` : '__none__'}
                  onValueChange={(v) => { if (v === '__none__') return; const [ns, k] = v.split('::'); const d = metafieldDefs.find((x) => x.namespace === ns && x.key === k); upOpt(idx, { metafieldNamespace: ns, metafieldKey: k, name: opt.name || d?.name || k }); }}
                >
                  <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Select metafield…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select metafield…</SelectItem>
                    {metafieldDefs.map((d) => <SelectItem key={`${d.namespace}::${d.key}`} value={`${d.namespace}::${d.key}`}>{d.name} ({d.namespace}.{d.key})</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : null}
              <Input value={opt.name} onChange={(e) => upOpt(idx, { name: e.target.value })} placeholder="Option name" className="h-8 text-xs flex-1" />
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive shrink-0" onClick={() => rmOpt(idx)}><X className="h-4 w-4" /></Button>
            </div>

            {/* Values */}
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {opt.values.map((v) => { const c = colorValues.find((x) => x.name === v); return (
                  <Badge key={v} variant="secondary" className="gap-1 pr-1">
                    {c && <span className="w-3 h-3 rounded-full border border-black/10" style={{ backgroundColor: c.hex }} />}
                    {v}
                    <button onClick={() => rmVal(idx, v)} className="ml-1 hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                  </Badge>
                ); })}
              </div>
              {/* Color picker for Color metafield */}
              {opt.linkedMetafield && opt.metafieldKey === 'color-pattern' && colorValues.filter((c) => !opt.values.includes(c.name)).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {colorValues.filter((c) => !opt.values.includes(c.name)).map((c) => (
                    <button key={c.name} onClick={() => addVal(idx, c.name)} className="flex items-center gap-1.5 px-2 py-1 rounded-md border hover:bg-muted text-xs">
                      <span className="w-3 h-3 rounded-full border border-black/10" style={{ backgroundColor: c.hex }} /> {c.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input value={newVal[idx] || ''} onChange={(e) => setNewVal((p) => ({ ...p, [idx]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addVal(idx, newVal[idx] || ''); } }} placeholder="Add value…" className="h-7 text-xs flex-1" />
                <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => addVal(idx, newVal[idx] || '')}>Add</Button>
                {!opt.linkedMetafield && <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => upOpt(idx, { values: ALPHABET })}>A-Z</Button>}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Variant preview + save */}
      {combos.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">{combos.length} variant{combos.length !== 1 ? 's' : ''}</Label>
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Layers className="h-4 w-4 mr-2" />} Save Variants
            </Button>
          </div>
          <div className="max-h-60 overflow-y-auto divide-y rounded-lg border">
            {combos.slice(0, 100).map((combo, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <span className="text-muted-foreground w-6 text-right">{i + 1}.</span>
                {Object.entries(combo).map(([key, val]) => { const c = colorValues.find((x) => x.name === val); return (
                  <Badge key={key} variant="outline" className="text-[10px] gap-1">
                    {c && <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.hex }} />} {key}: {val}
                  </Badge>
                ); })}
              </div>
            ))}
            {combos.length > 100 && <div className="px-3 py-1.5 text-xs text-muted-foreground">…and {combos.length - 100} more</div>}
          </div>
        </Card>
      )}

      {/* Saved variants — image assignment grid */}
      {savedVariants.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-tight">Variant Images</h3>
            <span className="text-xs text-muted-foreground">{savedVariants.length} saved variant{savedVariants.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Group by color for bulk assignment */}
          {(() => {
            const byColor = new Map<string, SavedVariant[]>();
            savedVariants.forEach((v) => {
              const key = v.color || 'default';
              if (!byColor.has(key)) byColor.set(key, []);
              byColor.get(key)!.push(v);
            });

            return Array.from(byColor.entries()).map(([color, vars]) => {
              const label = COLOR_LABEL[color] || color.charAt(0).toUpperCase() + color.slice(1).replace(/-/g, ' ');
              const cv = colorValues.find((c) => c.name === label);
              return (
                <div key={color} className="space-y-2">
                  <div className="flex items-center gap-2">
                    {cv && <span className="w-3 h-3 rounded-full border border-black/10" style={{ backgroundColor: cv.hex }} />}
                    <Label className="text-xs font-medium">{label}</Label>
                    {vars.length > 1 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] ml-auto"
                        onClick={() => setShowImagePicker(color)}
                      >
                        Assign all {label}
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                    {vars.map((v) => {
                      const imgId = imageAssignments[v.id] ?? v.image_id;
                      const imgUrl = imgId
                        ? product.images.find((i) => i.id === imgId)?.url_or_key
                        : null;
                      // Build a secondary label from every option that ISN'T Color so
                      // users can distinguish multi-option variants inside one color
                      // group (e.g. "Gold · 2 pendants · M").
                      const allOpts = extractOptionsFromVariant(v);
                      const secondaryParts = allOpts
                        .filter((o) => o.name.toLowerCase() !== 'color')
                        .map((o) => o.value);
                      const secondaryLabel = secondaryParts.join(' · ');
                      const placeholderLabel = secondaryLabel || v.initial || label.slice(0, 3);
                      return (
                        <button
                          key={v.id}
                          onClick={() => setShowImagePicker(v.id)}
                          className="aspect-square rounded-lg border-2 border-dashed border-muted-foreground/20 hover:border-primary/50 transition-colors overflow-hidden flex items-center justify-center bg-muted/30 relative"
                          title={v.label || [label, secondaryLabel].filter(Boolean).join(' · ')}
                        >
                          {imgUrl ? (
                            <>
                              <img src={imgUrl} alt="" className="w-full h-full object-cover" />
                              {secondaryLabel && (
                                <span className="absolute bottom-0 left-0 right-0 bg-black/55 text-white text-[9px] leading-tight px-1 py-0.5 truncate">
                                  {secondaryLabel}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-[10px] text-muted-foreground text-center px-1 break-words">
                              {placeholderLabel}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </Card>
      )}

      {/* Image picker modal */}
      <Dialog open={showImagePicker !== null} onOpenChange={(o) => { if (!o) setShowImagePicker(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>Select image for variant</DialogTitle>
              {/* FIX 25a — upload from disk straight inside the picker so
                  the integrator doesn't have to leave the variants tab to
                  add a new image. The new image lands in product.images
                  with role='variant' and shows up in the grid below
                  after onUpdated() refreshes the product. */}
              <input
                ref={variantUploadInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleVariantImageUpload(e.target.files)}
              />
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={() => variantUploadInputRef.current?.click()}
                disabled={uploadingVariantImage}
                title="Upload an image from your computer"
              >
                {uploadingVariantImage
                  ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  : <Upload className="h-3.5 w-3.5 mr-1.5" />}
                Upload image
              </Button>
            </div>
          </DialogHeader>
          {product.images.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No images on this product yet — click "Upload image" above to add one.
            </p>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3 max-h-[60vh] overflow-y-auto p-1">
              {product.images.map((img) => (
                <button
                  key={img.id}
                  onClick={async () => {
                    const targetId = showImagePicker!;
                    // Determine which variant(s) to assign
                    const isBulk = typeof targetId === 'string';
                    const bulkColor = isBulk ? targetId : null;
                    const affectedIds = bulkColor
                      ? savedVariants.filter((sv) => sv.color === bulkColor).map((sv) => sv.id)
                      : [targetId as number];

                    const newAssignments = { ...imageAssignments };
                    affectedIds.forEach((id) => { newAssignments[id] = img.id; });
                    setImageAssignments(newAssignments);

                    try {
                      // P25-V3 — preserve each row's options_json on image
                      // assignment. Without this, the backend's "delete +
                      // re-insert" save path nukes the multi-option data
                      // (e.g. "Number of pendants") because we'd be writing
                      // rows without the options field.
                      const rows = savedVariants.map((sv) => {
                        let options: { name: string; value: string }[] | undefined;
                        if (sv.options_json) {
                          try { options = JSON.parse(sv.options_json); } catch { /* ignore */ }
                        }
                        return {
                          color: sv.color as any,
                          initial: sv.initial || undefined,
                          image_id: affectedIds.includes(sv.id) ? img.id : (newAssignments[sv.id] ?? sv.image_id),
                          options,
                        };
                      });
                      const slug = product.variant_template_slug || 'standard';
                      await putProductVariants(product.id, { template_slug: slug, variants: rows });
                      toast({ title: bulkColor ? `All ${bulkColor} variants assigned` : 'Image assigned' });
                      await loadSavedVariants();
                    } catch (e: any) {
                      toast({ title: 'Failed', description: e?.message, variant: 'destructive' });
                    }
                    setShowImagePicker(null);
                  }}
                  className="aspect-square rounded-lg overflow-hidden bg-muted hover:ring-2 hover:ring-primary transition-all"
                >
                  <img src={img.url_or_key} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {options.length === 0 && savedVariants.length === 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">
          <span className="shrink-0 mt-0.5">ℹ️</span>
          <span>Color swatches activate automatically when linked to the shopify.color-pattern metafield. Use a template or add a metafield option for "Color".</span>
        </div>
      )}
    </div>
  );
}
