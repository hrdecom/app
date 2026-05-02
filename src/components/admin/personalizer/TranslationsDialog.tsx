import { useEffect, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Sparkles, X, Globe, Gem } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import {
  PERSONALIZER_LOCALES,
  getTemplateTranslations,
  patchTemplateTranslations,
  autoTranslateTemplate,
  type PersonalizerField,
  type BirthstoneOption,
  type TemplateTranslations,
  type FieldTranslation,
} from '@/lib/personalizer-api';

/**
 * P26-28 — Translations editor.
 *
 * Modal opened from the Personalizer panel header. One tab per
 * supported locale (8 non-English markets the merchant has on
 * Shopify). For each tab:
 *   • per-field rows: source (read-only) + translated (editable)
 *     for customer_label, cart_label, info_text, and placeholder
 *     (placeholder only for image fields per the merchant's spec)
 *   • birthstones library: 12 month-name inputs (admin-only edit;
 *     hidden for integrators)
 *   • "Auto-translate" button that calls Claude via the backend
 *
 * Saves are local-first: the form is dirty until the merchant
 * presses "Save changes" or closes (with auto-save on close).
 * Auto-translate writes server-side immediately and pulls the new
 * rows into local state.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  templateId: number;
  fields: PersonalizerField[];
  /** P26-28 — global birthstones library (passed from PersonalizerPanel
   * which already loads it via getSettings). Drives the source labels
   * shown in the birthstone translations section. */
  birthstoneLibrary: BirthstoneOption[];
  /** Whether the current user is admin. Only admins can edit the
   * birthstones library translations (it's a global, shop-wide
   * resource). Integrators see the same data read-only. */
  isAdmin: boolean;
}

const MONTH_DEFAULTS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function TranslationsDialog({
  open, onClose, templateId, fields, birthstoneLibrary, isAdmin,
}: Props) {
  const { toast } = useToast();
  const [activeLocale, setActiveLocale] = useState<string>(PERSONALIZER_LOCALES[0].code);
  const [translations, setTranslations] = useState<TemplateTranslations | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoTranslating, setAutoTranslating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState<{ fields: Set<string>; birthstones: Set<string> }>({
    fields: new Set(),
    birthstones: new Set(),
  });

  // Load on open. We refetch each time so the dialog reflects
  // whatever the merchant did since last open (including auto-translate
  // runs from elsewhere).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getTemplateTranslations(templateId)
      .then((data) => { if (!cancelled) setTranslations(data); })
      .catch((e) => {
        if (!cancelled) toast({ title: 'Failed to load translations', description: e?.message, variant: 'destructive' });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    setDirty({ fields: new Set(), birthstones: new Set() });
    return () => { cancelled = true; };
  }, [open, templateId, toast]);

  // Subset of fields that have at least one translatable string,
  // computed once per fields update so the per-tab body skips empty
  // fields cleanly.
  const translatableFields = useMemo(() => {
    return (fields || []).filter((f) => {
      const hasContent =
        (f.customer_label && f.customer_label.trim()) ||
        (f.cart_label && f.cart_label.trim()) ||
        (f.info_text && f.info_text.trim()) ||
        (f.field_kind === 'image' && f.placeholder && f.placeholder.trim());
      return hasContent;
    });
  }, [fields]);

  function patchFieldLocale(fieldId: number, locale: string, key: keyof FieldTranslation, value: string) {
    setTranslations((tr) => {
      if (!tr) return tr;
      const fields = { ...tr.fields };
      const perLocale = { ...(fields[fieldId] || {}) };
      const cur: FieldTranslation = {
        ...{ customer_label: null, cart_label: null, info_text: null, placeholder: null },
        ...(perLocale[locale] || {}),
      };
      const trimmed = value.trim();
      cur[key] = trimmed.length > 0 ? trimmed : null;
      perLocale[locale] = cur;
      fields[fieldId] = perLocale;
      return { ...tr, fields };
    });
    setDirty((d) => {
      const next = new Set(d.fields);
      next.add(`${fieldId}|${locale}`);
      return { ...d, fields: next };
    });
  }

  function patchBirthstoneLocale(locale: string, monthIdx: number, value: string) {
    setTranslations((tr) => {
      if (!tr) return tr;
      const birthstones = { ...tr.birthstones };
      const arr = [...(birthstones[locale] || Array(12).fill(''))];
      while (arr.length < 12) arr.push('');
      arr[monthIdx - 1] = value;
      birthstones[locale] = arr;
      return { ...tr, birthstones };
    });
    setDirty((d) => {
      const next = new Set(d.birthstones);
      next.add(locale);
      return { ...d, birthstones: next };
    });
  }

  async function handleSave() {
    if (!translations) return;
    setSaving(true);
    try {
      const fieldsBody: Record<number, Record<string, FieldTranslation>> = {};
      for (const key of dirty.fields) {
        const [fid, loc] = key.split('|');
        const fieldId = parseInt(fid);
        const perLocale = translations.fields[fieldId];
        if (!perLocale || !perLocale[loc]) continue;
        if (!fieldsBody[fieldId]) fieldsBody[fieldId] = {};
        fieldsBody[fieldId][loc] = perLocale[loc];
      }
      const birthstonesBody: Record<string, string[]> = {};
      if (isAdmin) {
        for (const locale of dirty.birthstones) {
          const arr = translations.birthstones[locale] || [];
          birthstonesBody[locale] = arr.slice(0, 12);
        }
      }
      const body: any = {};
      if (Object.keys(fieldsBody).length > 0) body.fields = fieldsBody;
      if (isAdmin && Object.keys(birthstonesBody).length > 0) body.birthstones = birthstonesBody;
      if (Object.keys(body).length === 0) {
        toast({ title: 'Nothing to save' });
        return;
      }
      await patchTemplateTranslations(templateId, body);
      setDirty({ fields: new Set(), birthstones: new Set() });
      toast({ title: 'Translations saved' });
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleAutoTranslate(scope: 'this' | 'all') {
    setAutoTranslating(true);
    try {
      const body: { locales?: string[]; mode: 'missing' | 'all'; includeBirthstones: boolean } = {
        mode: scope === 'all' ? 'all' : 'all', // always overwrite — the merchant explicitly asked
        includeBirthstones: isAdmin,
      };
      if (scope === 'this') body.locales = [activeLocale];
      const summary = await autoTranslateTemplate(templateId, body);
      // Reload state from server.
      const fresh = await getTemplateTranslations(templateId);
      setTranslations(fresh);
      setDirty({ fields: new Set(), birthstones: new Set() });
      const total = summary.fields_translated || 0;
      toast({
        title: scope === 'this' ? `Translated to ${activeLocale}` : 'Translated to all locales',
        description: `${total} field translation${total === 1 ? '' : 's'} updated.`,
      });
    } catch (e: any) {
      toast({ title: 'Auto-translate failed', description: e?.message, variant: 'destructive' });
    } finally {
      setAutoTranslating(false);
    }
  }

  if (!open) return null;

  const localeTranslations = translations?.fields || {};
  const birthstonesByLocale = translations?.birthstones || {};

  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-gray-600" />
            <h2 className="text-base font-semibold tracking-tight">Translations</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleAutoTranslate('this')}
              disabled={autoTranslating || loading}
              title="Re-translate this language with Claude"
            >
              {autoTranslating
                ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                : <Sparkles className="h-3.5 w-3.5 mr-1" />}
              Auto-translate {activeLocale}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleAutoTranslate('all')}
              disabled={autoTranslating || loading}
              title="Re-translate every language with Claude (overwrites manual edits)"
            >
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              All languages
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || (dirty.fields.size === 0 && dirty.birthstones.size === 0)}
            >
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Save changes
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-gray-100"
              aria-label="Close"
            >
              <X className="h-4 w-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Locale tabs */}
        <div className="border-b border-gray-200 px-3 flex-shrink-0">
          <div className="flex gap-1 overflow-x-auto no-scrollbar py-2">
            {PERSONALIZER_LOCALES.map((l) => {
              const active = l.code === activeLocale;
              const filled = (translatableFields.length > 0 && translatableFields.every((f) =>
                !!(localeTranslations[f.id] && localeTranslations[f.id][l.code]),
              ));
              return (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => setActiveLocale(l.code)}
                  className={[
                    'px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
                    active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
                  ].join(' ')}
                  title={l.name}
                >
                  {l.code}
                  {filled && <span className={['ml-1.5 text-[10px]', active ? 'text-emerald-300' : 'text-emerald-600'].join(' ')}>●</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              {/* Field translations */}
              {translatableFields.length === 0 ? (
                <div className="text-sm text-muted-foreground italic">
                  No translatable strings on this template yet. Add a Customer-facing label,
                  Cart label, Tooltip, or Photo placeholder to a field, then come back here.
                </div>
              ) : (
                translatableFields.map((f) => {
                  const tr = localeTranslations[f.id]?.[activeLocale] || {
                    customer_label: null, cart_label: null, info_text: null, placeholder: null,
                  };
                  const rows: Array<{ key: keyof FieldTranslation; sourceLabel: string; source: string; show: boolean }> = [
                    { key: 'customer_label', sourceLabel: 'Customer label', source: f.customer_label || '', show: !!(f.customer_label && f.customer_label.trim()) },
                    { key: 'cart_label', sourceLabel: 'Cart label', source: f.cart_label || '', show: !!(f.cart_label && f.cart_label.trim()) },
                    { key: 'info_text', sourceLabel: 'Tooltip', source: f.info_text || '', show: !!(f.info_text && f.info_text.trim()) },
                    { key: 'placeholder', sourceLabel: 'Placeholder', source: f.placeholder || '', show: f.field_kind === 'image' && !!(f.placeholder && f.placeholder.trim()) },
                  ];
                  return (
                    <div key={f.id} className="border border-gray-200 rounded-lg p-3 bg-white">
                      <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-100 text-gray-600 uppercase">
                          {f.field_kind}
                        </span>
                        <span>{f.label}</span>
                      </div>
                      <div className="space-y-2">
                        {rows.filter((r) => r.show).map((r) => (
                          <div key={r.key} className="grid grid-cols-[100px_1fr_1fr] gap-2 items-center">
                            <div className="text-[11px] text-gray-500">{r.sourceLabel}</div>
                            <div className="text-[12px] text-gray-700 px-2 py-1.5 bg-gray-50 rounded truncate" title={r.source}>
                              {r.source}
                            </div>
                            <Input
                              value={tr[r.key] || ''}
                              onChange={(e) => patchFieldLocale(f.id, activeLocale, r.key, e.target.value)}
                              placeholder={`(${activeLocale} translation…)`}
                              className="h-8 text-[12px]"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}

              {/* Birthstones */}
              {birthstoneLibrary.some((b) => !!b.image_url) && (
                <div className="border border-violet-200 bg-violet-50/30 rounded-lg p-3 space-y-2">
                  <div className="text-xs font-semibold text-violet-900 flex items-center gap-2">
                    <Gem className="h-3.5 w-3.5 text-violet-600" />
                    Birthstones library
                    {!isAdmin && (
                      <span className="ml-2 text-[10px] font-normal text-violet-700/70 italic">
                        (admin only — you can view but not edit)
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    {birthstoneLibrary.map((b) => {
                      const localeArr = birthstonesByLocale[activeLocale] || [];
                      const translated = localeArr[b.month_index - 1] || '';
                      return (
                        <div key={b.month_index} className="grid grid-cols-[100px_1fr_1fr] gap-2 items-center">
                          <div className="text-[11px] text-violet-700 font-mono">
                            {b.month_index}.
                          </div>
                          <div className="text-[12px] text-gray-700 px-2 py-1.5 bg-white rounded border border-violet-100">
                            {b.label || MONTH_DEFAULTS[b.month_index - 1]}
                          </div>
                          <Input
                            value={translated}
                            onChange={(e) => patchBirthstoneLocale(activeLocale, b.month_index, e.target.value)}
                            placeholder={`(${activeLocale} translation…)`}
                            className="h-8 text-[12px]"
                            disabled={!isAdmin}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-gray-200 px-5 py-2 text-[11px] text-muted-foreground bg-gray-50/50 flex-shrink-0">
          Translations apply to the storefront automatically when the visitor's
          Shopify locale matches. Empty fields fall back to the English source.
          Publish from the main panel pushes everything to the Shopify metafield
          <code className="font-mono mx-1 text-[10px] bg-white px-1 rounded">personalizer.translations_json</code>
          for permanent backup.
        </div>
      </div>
    </div>
  );
}
