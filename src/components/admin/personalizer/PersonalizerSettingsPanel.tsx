import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Trash2, Upload } from 'lucide-react';
import {
  getSettings,
  updateSettings,
  listFonts,
  uploadFont,
  deleteFont,
  type PersonalizerSettings,
  type CustomFont,
  type BirthstoneOption,
} from '@/lib/personalizer-api';
import { BirthstonesLibraryPanel } from './BirthstonesLibraryPanel';

// P26-26 — defaults for the global birthstones library so the panel
// always renders 12 rows even when the merchant has not set anything.
const DEFAULT_MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseBirthstones(raw: string | null | undefined): BirthstoneOption[] {
  let parsed: any[] = [];
  if (raw) {
    try { const j = JSON.parse(raw); if (Array.isArray(j)) parsed = j; } catch { /* */ }
  }
  const byMonth = new Map<number, BirthstoneOption>();
  for (const e of parsed) {
    if (!e || typeof e !== 'object') continue;
    const idx = Number(e.month_index);
    if (!Number.isFinite(idx) || idx < 1 || idx > 12) continue;
    byMonth.set(idx, {
      month_index: idx,
      label: typeof e.label === 'string' ? e.label : DEFAULT_MONTH_LABELS[idx - 1],
      image_url: typeof e.image_url === 'string' ? e.image_url : null,
    });
  }
  const out: BirthstoneOption[] = [];
  for (let i = 1; i <= 12; i++) {
    out.push(byMonth.get(i) || {
      month_index: i,
      label: DEFAULT_MONTH_LABELS[i - 1],
      image_url: null,
    });
  }
  return out;
}

const CURATED_FONTS = [
  'Pinyon Script',
  'Great Vibes',
  'Cormorant Garamond',
  'Playfair Display',
  'Cinzel',
  'Inter',
];

const WEIGHT_OPTIONS = [
  { value: '300', label: 'Light (300)' },
  { value: '400', label: 'Regular (400)' },
  { value: '500', label: 'Medium (500)' },
  { value: '600', label: 'SemiBold (600)' },
  { value: '700', label: 'Bold (700)' },
];

export function PersonalizerSettingsPanel() {
  const { toast } = useToast();

  // ── Settings ──────────────────────────────────────────────────────────────
  const [settings, setSettings] = useState<PersonalizerSettings>({
    default_font_family: null,
    default_font_size_px: 60,
    default_font_color: '#000000',
    default_max_chars: 20,
    widget_padding_top: 10,
    widget_padding_bottom: 10,
  });
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  // ── Fonts ─────────────────────────────────────────────────────────────────
  const [fonts, setFonts] = useState<CustomFont[]>([]);
  const [loadingFonts, setLoadingFonts] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Upload form state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFamilyName, setUploadFamilyName] = useState('');
  const [uploadDisplayName, setUploadDisplayName] = useState('');
  const [uploadWeight, setUploadWeight] = useState('400');
  const [uploadStyle, setUploadStyle] = useState('normal');

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoadingSettings(true);
    setLoadingFonts(true);
    try {
      const [s, f] = await Promise.all([getSettings(), listFonts()]);
      setSettings(s);
      setFonts(f);
    } catch (e: any) {
      toast({ title: 'Failed to load settings', description: e?.message, variant: 'destructive' });
    } finally {
      setLoadingSettings(false);
      setLoadingFonts(false);
    }
  }

  async function handleSaveSettings() {
    setSavingSettings(true);
    try {
      const updated = await updateSettings({
        default_font_family: settings.default_font_family || null,
        default_font_size_px: settings.default_font_size_px,
        default_font_color: settings.default_font_color,
        default_max_chars: settings.default_max_chars,
        widget_padding_top: settings.widget_padding_top ?? 10,
        widget_padding_bottom: settings.widget_padding_bottom ?? 10,
      });
      setSettings(updated);
      toast({ title: 'Settings saved' });
    } catch (e: any) {
      toast({ title: 'Failed to save settings', description: e?.message, variant: 'destructive' });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleUploadFont() {
    if (!uploadFile) { toast({ title: 'Select a font file first', variant: 'destructive' }); return; }
    if (!uploadFamilyName.trim()) { toast({ title: 'family_name is required', variant: 'destructive' }); return; }
    setUploading(true);
    try {
      await uploadFont(uploadFile, {
        family_name: uploadFamilyName.trim(),
        display_name: uploadDisplayName.trim() || undefined,
        weight: parseInt(uploadWeight),
        style: uploadStyle,
      });
      toast({ title: 'Font uploaded' });
      // Reset form
      setUploadFile(null);
      setUploadFamilyName('');
      setUploadDisplayName('');
      setUploadWeight('400');
      setUploadStyle('normal');
      if (fileInputRef.current) fileInputRef.current.value = '';
      // Reload font list
      const fresh = await listFonts();
      setFonts(fresh);
    } catch (e: any) {
      toast({ title: 'Upload failed', description: e?.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteFont(id: number, name: string) {
    if (!confirm(`Remove font "${name}"? It will be hidden from the picker (the file stays in storage).`)) return;
    try {
      await deleteFont(id);
      setFonts((prev) => prev.filter((f) => f.id !== id));
      toast({ title: 'Font removed' });
    } catch (e: any) {
      toast({ title: 'Failed to remove font', description: e?.message, variant: 'destructive' });
    }
  }

  const allFontOptions = [
    ...CURATED_FONTS,
    ...fonts.map((f) => f.family_name).filter((n) => !CURATED_FONTS.includes(n)),
  ];

  if (loadingSettings && loadingFonts) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-10 max-w-2xl">
      {/* ── P26-26 — Birthstones library ────────────────────────────────
          Global library of 12 PNG icons (one per month). Shared by
          every birthstone field on every product, so the merchant
          uploads them once here. Admin-only (the API rejects PATCH
          on birthstones_json from non-admin roles, see
          functions/api/personalizer/settings.js). */}
      <section>
        <h2 className="text-lg font-semibold tracking-tight mb-1">Birthstones library</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Upload the 12 birthstone PNG icons once. They are reused by every birthstone
          field across every product. Use a transparent background and the same
          dimensions for all 12 so they sit consistently on the jewelry.
        </p>
        <BirthstonesLibraryPanel
          birthstones={parseBirthstones(settings.birthstones_json ?? null)}
          autoOpen={true}
          onChange={async (next) => {
            const json = JSON.stringify(next);
            const prev = settings.birthstones_json ?? null;
            // Optimistic UI: update local state, then PATCH; revert
            // on failure so the merchant sees the actual saved state.
            setSettings((s) => ({ ...s, birthstones_json: json }));
            try {
              const updated = await updateSettings({ birthstones_json: json });
              setSettings(updated);
            } catch (e: any) {
              setSettings((s) => ({ ...s, birthstones_json: prev }));
              toast({
                title: 'Failed to save birthstones',
                description: e?.message || 'Make sure you are signed in as admin.',
                variant: 'destructive',
              });
            }
          }}
        />
      </section>

      {/* ── Section 1: Defaults ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold tracking-tight mb-1">Field Defaults</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Applied automatically when a new field is created. Explicit values in the field config always take priority.
        </p>

        <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-5">
          {/* Default font family */}
          <div>
            <Label htmlFor="default_font_family" className="text-sm font-medium">
              Default font family
            </Label>
            <div className="mt-1.5">
              <Select
                value={settings.default_font_family || '__none__'}
                onValueChange={(v) =>
                  setSettings((s) => ({
                    ...s,
                    default_font_family: v === '__none__' ? null : v,
                  }))
                }
              >
                <SelectTrigger id="default_font_family">
                  <SelectValue placeholder="None (leave unset)" />
                </SelectTrigger>
                <SelectContent>
                  {/* Radix forbids empty-string SelectItem values — they collide
                      with "no selection". Sentinel "__none__" is mapped to NULL
                      in the change handler. */}
                  <SelectItem value="__none__">None (leave unset)</SelectItem>
                  {allFontOptions.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Default font size */}
          <div>
            <Label htmlFor="default_font_size_px" className="text-sm font-medium">
              Default font size (px)
            </Label>
            <div className="mt-1.5">
              <Input
                id="default_font_size_px"
                type="number"
                min={1}
                value={settings.default_font_size_px ?? ''}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, default_font_size_px: e.target.value ? parseInt(e.target.value) : null }))
                }
                className="max-w-[140px]"
              />
            </div>
          </div>

          {/* Default font color */}
          <div>
            <Label htmlFor="default_font_color" className="text-sm font-medium">
              Default font color
            </Label>
            <div className="mt-1.5 flex items-center gap-2">
              <Input
                id="default_font_color"
                type="text"
                value={settings.default_font_color || ''}
                onChange={(e) => setSettings((s) => ({ ...s, default_font_color: e.target.value || null }))}
                placeholder="#000000"
                className="max-w-[160px] font-mono"
              />
              <input
                type="color"
                value={settings.default_font_color || '#000000'}
                onChange={(e) => setSettings((s) => ({ ...s, default_font_color: e.target.value }))}
                className="h-9 w-9 cursor-pointer rounded border border-gray-200 p-0.5"
                title="Pick color"
              />
            </div>
          </div>

          {/* Default max chars */}
          <div>
            <Label htmlFor="default_max_chars" className="text-sm font-medium">
              Default max characters
            </Label>
            <div className="mt-1.5">
              <Input
                id="default_max_chars"
                type="number"
                min={1}
                value={settings.default_max_chars ?? ''}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, default_max_chars: e.target.value ? parseInt(e.target.value) : null }))
                }
                className="max-w-[140px]"
              />
            </div>
          </div>

          {/* P25-V2 — admin-controlled vertical padding for the
              storefront widget. Defaults to 10px each side. */}
          <div>
            <Label htmlFor="widget_padding_top" className="text-sm font-medium">
              Storefront widget padding — top (px)
            </Label>
            <div className="mt-1.5">
              <Input
                id="widget_padding_top"
                type="number"
                min={0}
                value={settings.widget_padding_top ?? 10}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    widget_padding_top: e.target.value === '' ? 10 : Math.max(0, parseInt(e.target.value)),
                  }))
                }
                className="max-w-[140px]"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="widget_padding_bottom" className="text-sm font-medium">
              Storefront widget padding — bottom (px)
            </Label>
            <div className="mt-1.5">
              <Input
                id="widget_padding_bottom"
                type="number"
                min={0}
                value={settings.widget_padding_bottom ?? 10}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    widget_padding_bottom: e.target.value === '' ? 10 : Math.max(0, parseInt(e.target.value)),
                  }))
                }
                className="max-w-[140px]"
              />
            </div>
          </div>

          <div className="pt-2">
            <Button onClick={handleSaveSettings} disabled={savingSettings}>
              {savingSettings && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Save defaults
            </Button>
          </div>
        </div>
      </section>

      {/* ── Section 2: Custom fonts ─────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold tracking-tight mb-1">Custom Fonts</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Upload brand fonts (woff2/woff/ttf/otf). They'll appear in the font picker and load automatically in the storefront widget via @font-face.
        </p>

        {/* Existing fonts list */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-6">
          {loadingFonts ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : fonts.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No custom fonts uploaded yet.</div>
          ) : (
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Family</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Weight</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Style</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Format</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {fonts.map((font) => (
                  <tr key={font.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 text-sm font-medium">{font.display_name || font.family_name}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{font.weight}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{font.style}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground uppercase">{font.format}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteFont(font.id, font.display_name || font.family_name)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Upload form */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <h3 className="text-sm font-semibold">Upload new font</h3>

          <div>
            <Label htmlFor="font_file" className="text-sm font-medium">Font file (.woff2, .woff, .ttf, .otf)</Label>
            <div className="mt-1.5">
              <Input
                id="font_file"
                type="file"
                accept=".woff2,.woff,.ttf,.otf"
                ref={fileInputRef}
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setUploadFile(f);
                  if (f && !uploadFamilyName) {
                    // Auto-populate family name from filename (strip ext + dashes)
                    const base = f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
                    setUploadFamilyName(base);
                  }
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="upload_family_name" className="text-sm font-medium">Family name <span className="text-destructive">*</span></Label>
              <div className="mt-1.5">
                <Input
                  id="upload_family_name"
                  value={uploadFamilyName}
                  onChange={(e) => setUploadFamilyName(e.target.value)}
                  placeholder="e.g. My Brand Font"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="upload_display_name" className="text-sm font-medium">Display name (optional)</Label>
              <div className="mt-1.5">
                <Input
                  id="upload_display_name"
                  value={uploadDisplayName}
                  onChange={(e) => setUploadDisplayName(e.target.value)}
                  placeholder="Same as family name"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="upload_weight" className="text-sm font-medium">Weight</Label>
              <div className="mt-1.5">
                <Select value={uploadWeight} onValueChange={setUploadWeight}>
                  <SelectTrigger id="upload_weight">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEIGHT_OPTIONS.map((w) => (
                      <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="upload_style" className="text-sm font-medium">Style</Label>
              <div className="mt-1.5">
                <Select value={uploadStyle} onValueChange={setUploadStyle}>
                  <SelectTrigger id="upload_style">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="italic">Italic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="pt-1">
            <Button onClick={handleUploadFont} disabled={uploading || !uploadFile || !uploadFamilyName.trim()}>
              {uploading
                ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                : <Upload className="h-4 w-4 mr-1.5" />
              }
              Upload font
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
