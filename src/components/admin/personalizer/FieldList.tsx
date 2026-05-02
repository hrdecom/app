import { Button } from '@/components/ui/button';
import { Plus, Type, Image as ImageIcon, GripVertical, Trash2, Loader2, ImagePlus, Copy, Gem } from 'lucide-react';
import { useState } from 'react';
import type { PersonalizerField } from '@/lib/personalizer-api';

interface Props {
  fields: PersonalizerField[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onAddText: () => void;
  onAddImage: () => void;
  onAddBirthstone: () => void;
  onReorder: (ids: number[]) => void;
  /** P25-2 — fired when the trash button on a row is clicked (and confirmed). */
  onDelete: (fieldId: number) => Promise<void> | void;
  /** P25-V4 — duplicate this field (creates a new field with the same
   * config, slightly offset position so it's visible). */
  onDuplicate: (fieldId: number) => Promise<void> | void;
  /** P25-4 — current z-index of the product image in the layer stack.
   * Editing this value lets the admin push fields above or below the
   * image (useful for transparent-window pendants where a customer
   * photo shows through). Default 5. */
  baseImageLayerZ: number;
  onChangeBaseImageLayerZ: (z: number) => void;
}

export function FieldList({
  fields, selectedId, onSelect, onAddText, onAddImage, onAddBirthstone, onReorder, onDelete, onDuplicate,
  baseImageLayerZ, onChangeBaseImageLayerZ,
}: Props) {
  const [busyDeletingId, setBusyDeletingId] = useState<number | null>(null);
  // P25-V2 — drag-to-reorder layer state. dragId = the row currently
  // being dragged; overId = the row the cursor is hovering on (for the
  // blue insertion-line indicator).
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  async function handleDelete(e: React.MouseEvent, f: PersonalizerField) {
    e.stopPropagation();
    if (!confirm(`Delete field "${f.label}" ? This can't be undone.`)) return;
    setBusyDeletingId(f.id);
    try {
      await onDelete(f.id);
    } finally {
      setBusyDeletingId(null);
    }
  }

  // P25-V2 — finalise a drop. Build the new ordering as an array of
  // field IDs, then hand it to onReorder. The parent persists via the
  // /personalizer/fields/0/reorder endpoint and refetches.
  function handleDrop(targetId: number) {
    if (dragId == null || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const ids = unifiedItems.map((it) => it.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) {
      setDragId(null);
      setOverId(null);
      return;
    }
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);
    setDragId(null);
    setOverId(null);
    // P26-8 — strip the special PRODUCT_IMAGE id and let the parent
    // know the new ordering of fields PLUS the image's position. The
    // parent recomputes layer_z values from the list position.
    onReorder(ids);
  }

  // P26-8 — Build a unified list that mixes fields and the product
  // image, sorted by layer_z descending so the top of the list IS
  // visually the topmost layer. The product image is identified by
  // sentinel id PRODUCT_IMAGE_ID so the rest of the dnd code can
  // treat it as just another row.
  const PRODUCT_IMAGE_ID = -1;
  type UnifiedItem = { id: number; kind: 'image' | 'field'; field?: PersonalizerField; z: number };
  const unifiedItems: UnifiedItem[] = [
    ...fields.map((f) => ({ id: f.id, kind: 'field' as const, field: f, z: f.layer_z })),
    { id: PRODUCT_IMAGE_ID, kind: 'image' as const, z: baseImageLayerZ },
  ].sort((a, b) => b.z - a.z);

  return (
    <div className="border-r border-gray-200 bg-white p-3 space-y-2 min-w-[220px]">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Layers</div>
      <ul className="space-y-1">
        {/* P26-8 — unified layer list. Fields AND the product image are
            interleaved by their z-index (top of list = visually on
            top). Every row is draggable so the merchant can reorder
            anything against anything else. The parent recomputes the
            layer_z values from the new list position. */}
        {unifiedItems.map((item) => {
          if (item.kind === 'image') {
            const isOver = overId === item.id && dragId !== null && dragId !== item.id;
            const dragFromIdx = dragId != null ? unifiedItems.findIndex((x) => x.id === dragId) : -1;
            const overIdx = unifiedItems.findIndex((x) => x.id === item.id);
            const insertAbove = isOver && dragFromIdx > overIdx;
            const insertBelow = isOver && dragFromIdx < overIdx;
            return (
              <li
                key="product-image"
                draggable
                onDragStart={(e) => {
                  setDragId(item.id);
                  e.dataTransfer.effectAllowed = 'move';
                  try { e.dataTransfer.setData('text/plain', String(item.id)); } catch { /* */ }
                }}
                onDragEnter={(e) => {
                  if (dragId == null || dragId === item.id) return;
                  e.preventDefault();
                  setOverId(item.id);
                }}
                onDragOver={(e) => {
                  if (dragId == null || dragId === item.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (overId !== item.id) setOverId(item.id);
                }}
                onDragLeave={() => { if (overId === item.id) setOverId(null); }}
                onDrop={(e) => { e.preventDefault(); handleDrop(item.id); }}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
                className={[
                  'group flex items-center gap-2 px-2 py-1.5 rounded cursor-grab text-sm relative',
                  'bg-amber-50 border border-amber-200',
                  dragId === item.id ? 'opacity-40' : '',
                  insertAbove ? 'border-t-2 border-t-primary' : '',
                  insertBelow ? 'border-b-2 border-b-primary' : '',
                ].join(' ')}
              >
                <GripVertical className="h-3 w-3 text-amber-700" />
                <ImagePlus className="h-3.5 w-3.5 text-amber-700" />
                <span className="flex-1 truncate text-amber-900">Product image</span>
                <span className="text-[10px] text-amber-700">z</span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={baseImageLayerZ}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onChangeBaseImageLayerZ(parseInt(e.target.value || '5'))}
                  className="w-10 text-[11px] px-1 py-0.5 border border-amber-300 rounded text-amber-900 bg-white"
                />
              </li>
            );
          }
          const f = item.field!;
          const isSel = selectedId === f.id;
          const deleting = busyDeletingId === f.id;
          const isOver = overId === f.id && dragId !== null && dragId !== f.id;
          const dragFromIdx = dragId != null ? unifiedItems.findIndex((x) => x.id === dragId) : -1;
          const overIdx = unifiedItems.findIndex((x) => x.id === f.id);
          const insertAbove = isOver && dragFromIdx > overIdx;
          const insertBelow = isOver && dragFromIdx < overIdx;
          return (
            <li
              key={f.id}
              draggable
              onClick={() => onSelect(f.id)}
              onDragStart={(e) => {
                setDragId(f.id);
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', String(f.id)); } catch { /* noop */ }
              }}
              onDragEnter={(e) => {
                if (dragId == null || dragId === f.id) return;
                e.preventDefault();
                setOverId(f.id);
              }}
              onDragOver={(e) => {
                if (dragId == null || dragId === f.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (overId !== f.id) setOverId(f.id);
              }}
              onDragLeave={() => {
                if (overId === f.id) setOverId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(f.id);
              }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              className={[
                'group flex items-center gap-2 px-2 py-1.5 rounded cursor-grab text-sm relative',
                'transition-colors',
                isSel ? 'bg-primary/10 text-primary' : 'hover:bg-gray-50',
                dragId === f.id ? 'opacity-40' : '',
                insertAbove ? 'border-t-2 border-t-primary' : '',
                insertBelow ? 'border-b-2 border-b-primary' : '',
              ].join(' ')}
            >
              <GripVertical className="h-3 w-3 text-muted-foreground" />
              {f.field_kind === 'text' ? (
                <Type className="h-3.5 w-3.5" />
              ) : f.field_kind === 'birthstone' ? (
                <Gem className="h-3.5 w-3.5 text-violet-600" />
              ) : (
                <ImageIcon className="h-3.5 w-3.5" />
              )}
              <span className="flex-1 truncate">{f.label}</span>
              <span className="text-[10px] text-muted-foreground">z{f.layer_z}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDuplicate(f.id); }}
                title={`Duplicate "${f.label}"`}
                className={[
                  'inline-flex items-center justify-center rounded p-1 transition-opacity',
                  isSel ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  'text-muted-foreground hover:text-primary hover:bg-primary/10',
                ].join(' ')}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => handleDelete(e, f)}
                disabled={deleting}
                title={`Delete "${f.label}"`}
                className={[
                  'inline-flex items-center justify-center rounded p-1 transition-opacity',
                  isSel ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  'text-muted-foreground hover:text-rose-600 hover:bg-rose-50',
                ].join(' ')}
              >
                {deleting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="pt-2 space-y-1">
        <Button variant="outline" size="sm" className="w-full justify-start" onClick={onAddText}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add text field
        </Button>
        <Button variant="outline" size="sm" className="w-full justify-start" onClick={onAddImage}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add image field
        </Button>
        {/* P26-26 — Birthstone field. Renders on the storefront as a
            compact dropdown selector (12 months with thumbnail + name)
            plus an SVG image overlay at the field's position that
            swaps to the selected month's PNG. The 12 PNGs are
            uploaded once at template level and reused across every
            birthstone layer on this product. */}
        <Button variant="outline" size="sm" className="w-full justify-start" onClick={onAddBirthstone}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add birthstone field
        </Button>
      </div>
    </div>
  );
}
