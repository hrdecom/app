import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronRight, Gem, Upload, Loader2 } from 'lucide-react';
import type { BirthstoneOption } from '@/lib/personalizer-api';

/**
 * P26-26 — template-level birthstones library editor.
 *
 * Shows 12 rows (one per month) with: month label input, image upload,
 * thumbnail preview, remove button. Saves the whole array back to the
 * parent on every change (parent persists via PATCH templates/:id with
 * birthstones_json). Collapsible header — auto-opens when at least
 * one birthstone field exists on the template so the merchant doesn't
 * have to hunt for it.
 *
 * Why template-level (not per-field): the merchant uploads the 12
 * PNG icons once and reuses them across every "Birthstone" layer on
 * the same product (e.g. Left / Center / Right stones).
 */

interface Props {
  birthstones: BirthstoneOption[];
  onChange: (next: BirthstoneOption[]) => Promise<void> | void;
  /** When true, auto-expand on first render (e.g. when at least one
   * birthstone field exists on the template). */
  autoOpen?: boolean;
}

export function BirthstonesLibraryPanel({ birthstones, onChange, autoOpen = false }: Props) {
  const [open, setOpen] = useState(autoOpen);
  const [busyMonth, setBusyMonth] = useState<number | null>(null);

  function patchEntry(monthIdx: number, patch: Partial<BirthstoneOption>) {
    const next = birthstones.map((b) =>
      b.month_index === monthIdx ? { ...b, ...patch } : b,
    );
    onChange(next);
  }

  async function handleUpload(monthIdx: number, file: File) {
    setBusyMonth(monthIdx);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/personalizer/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Upload failed (HTTP ' + res.status + ')');
      const j = (await res.json()) as { url: string };
      patchEntry(monthIdx, { image_url: j.url });
    } catch (e: any) {
      alert(e?.message || 'Upload failed');
    } finally {
      setBusyMonth(null);
    }
  }

  const uploadedCount = birthstones.filter((b) => !!b.image_url).length;

  return (
    <div className="border border-violet-200 bg-violet-50/40 rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-violet-100/50 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-violet-700" /> : <ChevronRight className="h-3.5 w-3.5 text-violet-700" />}
        <Gem className="h-3.5 w-3.5 text-violet-600" />
        <span className="text-sm font-medium text-violet-900">Birthstones library</span>
        <span className="ml-auto text-[11px] text-violet-700 tabular-nums">
          {uploadedCount}/12 icons
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-1.5">
          <div className="text-[11px] text-violet-700/80 leading-snug pb-1">
            Upload one PNG per month (transparent background recommended,
            same size across all 12 for consistent placement on the product).
            Used by every Birthstone layer on this template.
          </div>
          {birthstones.map((b) => (
            <div
              key={b.month_index}
              className="flex items-center gap-2 px-2 py-1.5 bg-white rounded border border-violet-100"
            >
              <span className="text-[10px] font-mono text-violet-700 w-5 text-right tabular-nums">
                {b.month_index}.
              </span>
              <div className="relative h-8 w-8 flex-shrink-0 rounded border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
                {b.image_url ? (
                  <img
                    src={b.image_url}
                    alt={b.label}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <Gem className="h-3.5 w-3.5 text-gray-300" />
                )}
                {busyMonth === b.month_index && (
                  <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                    <Loader2 className="h-3 w-3 animate-spin text-violet-600" />
                  </div>
                )}
              </div>
              <Input
                value={b.label}
                onChange={(e) => patchEntry(b.month_index, { label: e.target.value })}
                className="h-7 text-xs flex-1"
                placeholder={`Month ${b.month_index}`}
              />
              <label
                className="inline-flex items-center justify-center h-7 px-2 rounded border border-violet-200 bg-white hover:bg-violet-50 cursor-pointer text-violet-700 transition-colors"
                title={b.image_url ? 'Replace icon' : 'Upload icon'}
              >
                <Upload className="h-3 w-3" />
                <input
                  type="file"
                  accept="image/png,image/webp,image/jpeg,image/svg+xml"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(b.month_index, f);
                    e.target.value = '';
                  }}
                  disabled={busyMonth === b.month_index}
                />
              </label>
              {b.image_url && (
                <button
                  type="button"
                  onClick={() => patchEntry(b.month_index, { image_url: null })}
                  className="text-[10px] text-rose-600 hover:underline px-1"
                  title="Remove icon"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
