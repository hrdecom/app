import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  useDroppable,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  closestCenter,
  getFirstCollision,
  type CollisionDetection,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import {
  GripVertical,
  MoreVertical,
  Edit,
  Trash2,
  Plus,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Copy,
  MoveRight,
} from 'lucide-react';
import {
  type NBCategory,
  type NBPrompt,
  type NBGroup,
} from '@/lib/nano-banana';
import { usePromptStudioApi } from './PromptStudioContext';
import { PromptRow } from './PromptRow';
import { PromptDialog } from './PromptDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { CategoryDialog } from './CategoryDialog';
import { GroupDialog } from './GroupDialog';
import { MoveToDialog } from './MoveToDialog';

/* ─── helpers ─── */

function findPromptInTree(pid: number, cat: NBCategory): { prompt: NBPrompt; owner: NBCategory; group?: NBGroup } | null {
  for (const p of cat.prompts || []) if (p.id === pid) return { prompt: p, owner: cat };
  for (const g of cat.groups || []) for (const p of g.prompts) if (p.id === pid) return { prompt: p, owner: cat, group: g };
  for (const c of cat.children || []) { const f = findPromptInTree(pid, c); if (f) return f; }
  return null;
}

function findGroupInTree(gid: number, cat: NBCategory): { group: NBGroup; owner: NBCategory } | null {
  for (const g of cat.groups || []) if (g.id === gid) return { group: g, owner: cat };
  for (const c of cat.children || []) { const f = findGroupInTree(gid, c); if (f) return f; }
  return null;
}

function getDragLabel(id: string | number | null, root: NBCategory): string {
  if (!id) return '';
  const s = String(id);
  if (s.startsWith('group-')) {
    const f = findGroupInTree(parseInt(s.replace('group-', '')), root);
    return f ? `⊞ ${f.group.name}` : s;
  }
  if (s.startsWith('prompt-')) {
    const f = findPromptInTree(parseInt(s.replace('prompt-', '')), root);
    return f ? f.prompt.button_label : s;
  }
  if (s.startsWith('subcat-')) {
    const cid = parseInt(s.replace('subcat-', ''));
    for (const c of root.children || []) if (c.id === cid) return c.name;
  }
  return s;
}

/**
 * FIX 27 follow-up — custom collision strategy for the mixed
 * groups+prompts list. The previous `pointerWithin` strategy failed
 * to find a target when the cursor sat in the GAP between two
 * stacked items (e.g. between group 4 and prompt 6) because no
 * droppable's bounding box contained the pointer. The user could
 * see the drop preview overlay floating in the gap but the drop
 * silently snapped elsewhere or did nothing.
 *
 * The fix walks three strategies in priority order:
 *   1. pointerWithin — exact hit (handles drop INTO group containers
 *      and sub-cat headers, which both rely on cursor-inside semantics)
 *   2. rectIntersection — when the dragged overlay overlaps any
 *      droppable, pick the most-overlapped one
 *   3. closestCenter — last-resort fallback when the cursor is in a
 *      gap; finds the nearest sortable to the pointer so we always
 *      land somewhere predictable
 *
 * This pattern is what the dnd-kit team recommends in the "Multiple
 * containers" example for nested sortables — pointerWithin alone
 * doesn't handle the gap case.
 */
const mixedCollision: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length > 0) return pointerHits;
  const rectHits = rectIntersection(args);
  if (rectHits.length > 0) return rectHits;
  const closest = closestCenter(args);
  // Re-rank: prefer collisions that share a "type prefix" with the
  // active draggable (group-/prompt-/subcat-). This keeps a dragged
  // group from snapping onto an inner-prompt droppable that happens
  // to be the geometric closest, which would cause silent drop
  // failures (the drop handler can't process group→prompt-context
  // moves).
  const activeId = String(args.active?.id || '');
  const activeKind = activeId.startsWith('group-')
    ? 'group'
    : activeId.startsWith('prompt-')
    ? 'prompt'
    : activeId.startsWith('subcat-')
    ? 'subcat'
    : null;
  if (!activeKind) return closest;
  const sameKind = closest.filter((c) => {
    const cid = String(c.id || '');
    if (activeKind === 'group') return cid.startsWith('group-') || cid.startsWith('prompt-') || cid.startsWith('drop-ungrouped-') || cid.startsWith('drop-subcat-');
    if (activeKind === 'prompt') return cid.startsWith('prompt-') || cid.startsWith('group-') || cid.startsWith('drop-group-') || cid.startsWith('drop-ungrouped-') || cid.startsWith('drop-subcat-');
    if (activeKind === 'subcat') return cid.startsWith('subcat-') || cid.startsWith('drop-subcat-');
    return true;
  });
  if (sameKind.length > 0) return sameKind;
  // Last resort — return the unfiltered closest so we never strand
  // the drag with no target at all.
  const first = getFirstCollision(closest);
  return first ? [closest[0]] : closest;
};

/* ─── droppable zones ─── */

function DropZone({ id, label, children: ch }: { id: string; label?: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn('transition-all rounded-xl', isOver && 'ring-2 ring-primary ring-offset-2 bg-primary/5')}>
      {ch}
    </div>
  );
}

/* ─── SortablePrompt ─── */

function SortablePrompt({ prompt, onEdit, onDeleted }: { prompt: NBPrompt; onEdit: (p: NBPrompt) => void; onDeleted: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `prompt-${prompt.id}` });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 };
  return (
    <div ref={setNodeRef} style={style}>
      <div className="flex items-center gap-1">
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0 p-1">
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <div className="flex-1 min-w-0">
          <PromptRow prompt={prompt} onEdit={onEdit} onDeleted={onDeleted} />
        </div>
      </div>
    </div>
  );
}

/* ─── SortableGroup ─── */

function SortableGroup({ group, categoryId, onDeleted, onUpdated }: { group: NBGroup; categoryId: number; onDeleted: () => void; onUpdated: () => void }) {
  const api = usePromptStudioApi();
  const [collapsed, setCollapsed] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showPromptDialog, setShowPromptDialog] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<NBPrompt | null>(null);
  const { toast } = useToast();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `group-${group.id}` });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 };

  return (
    <>
      <DropZone id={`drop-group-${group.id}`}>
        <div ref={setNodeRef} style={style} className="rounded-xl bg-muted/40 border border-gray-200 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"><GripVertical className="h-4 w-4" /></button>
            <button onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-2 flex-1 min-w-0">
              {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              <span className="font-semibold text-sm">{group.name}</span>
              <Badge variant="secondary" className="text-xs">{group.prompts.length}</Badge>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-7 p-0"><MoreVertical className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowRenameDialog(true)}><Edit className="h-3.5 w-3.5 mr-2" />Rename</DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setEditingPrompt(null); setShowPromptDialog(true); }}><Plus className="h-3.5 w-3.5 mr-2" />Add prompt</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowMoveDialog(true)}><MoveRight className="h-3.5 w-3.5 mr-2" />Move to...</DropdownMenuItem>
                <DropdownMenuItem onClick={async () => { try { await api.duplicateGroup(group.id); onUpdated(); toast({ title: 'Duplicated' }); } catch { toast({ title: 'Error', variant: 'destructive' }); } }}><Copy className="h-3.5 w-3.5 mr-2" />Duplicate</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowDeleteDialog(true)} className="text-destructive focus:text-destructive"><Trash2 className="h-3.5 w-3.5 mr-2" />Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {!collapsed && group.prompts.length > 0 && (
            <SortableContext items={group.prompts.map((p) => `prompt-${p.id}`)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1 pl-6">
                {group.prompts.map((p) => <SortablePrompt key={p.id} prompt={p} onEdit={(pr) => { setEditingPrompt(pr); setShowPromptDialog(true); }} onDeleted={onUpdated} />)}
              </div>
            </SortableContext>
          )}
          {!collapsed && group.prompts.length === 0 && (
            <div className="pl-6 py-3 text-xs text-muted-foreground">No prompts. <button onClick={() => { setEditingPrompt(null); setShowPromptDialog(true); }} className="text-primary hover:underline">Add one</button></div>
          )}
        </div>
      </DropZone>
      <GroupDialog open={showRenameDialog} onOpenChange={setShowRenameDialog} categoryId={categoryId} group={group} onSaved={() => { setShowRenameDialog(false); onUpdated(); }} />
      <ConfirmDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog} title="Delete group" description={`Delete "${group.name}"? Prompts become ungrouped.`} confirmLabel="Delete" onConfirm={async () => { await api.deleteGroup(group.id); onDeleted(); }} />
      <PromptDialog open={showPromptDialog} onOpenChange={(o) => { if (!o) { setShowPromptDialog(false); setEditingPrompt(null); } }} categoryId={categoryId} groupId={group.id} prompt={editingPrompt} onSaved={() => { setShowPromptDialog(false); setEditingPrompt(null); onUpdated(); }} />
      <MoveToDialog open={showMoveDialog} onOpenChange={setShowMoveDialog} title={`Move "${group.name}" to...`} excludeCategoryId={categoryId} onMove={async (id) => { await api.updateGroup(group.id, { category_id: id }); onUpdated(); }} />
    </>
  );
}

/* ─── CategoryContent — renders the inside of a category (sub-cats, groups, ungrouped) ─── */

function CategoryContent({ cat, allCategories, onPromptUpdated, onEdit }: {
  cat: NBCategory; allCategories?: NBCategory[]; onPromptUpdated: () => void; onEdit: (c: NBCategory) => void;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [showGroup, setShowGroup] = useState(false);
  const [showSubCat, setShowSubCat] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<NBPrompt | null>(null);
  const { toast } = useToast();

  const groups = cat.groups || [];
  const ungrouped = (cat.prompts || []).filter((p) => !p.group_id);
  const children = cat.children || [];

  return (
    <>
      {/* Sub-categories */}
      {children.length > 0 && (
        <div className="mb-3 space-y-2 border-l-2 border-gray-200 ml-2 pl-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sub-categories</p>
          <SortableContext items={children.map((c) => `subcat-${c.id}`)} strategy={verticalListSortingStrategy}>
            {children.map((child) => (
              <SubCategoryCard key={child.id} cat={child} allCategories={allCategories} onPromptUpdated={onPromptUpdated} onEdit={onEdit} />
            ))}
          </SortableContext>
        </div>
      )}

      {/* FIX 27b — UNIFIED groups + ungrouped prompts list. Both kinds
          live in the same SortableContext so the admin can drop a prompt
          BETWEEN two groups (and vice versa). Items are sorted by their
          shared sort_order — the reorder-mixed endpoint keeps both
          tables in lockstep. The "Ungrouped" header is dropped because
          the section is no longer a separate bucket. */}
      <DropZone id={`drop-ungrouped-${cat.id}`}>
        {(() => {
          type MixedItem =
            | { kind: 'group'; data: typeof groups[number]; sort: number }
            | { kind: 'prompt'; data: typeof ungrouped[number]; sort: number };
          const mixed: MixedItem[] = [
            ...groups.map((g): MixedItem => ({ kind: 'group', data: g, sort: g.sort_order ?? 0 })),
            ...ungrouped.map((p): MixedItem => ({ kind: 'prompt', data: p, sort: p.sort_order ?? 0 })),
          ].sort((a, b) => a.sort - b.sort);
          const sortableIds = mixed.map((it) =>
            it.kind === 'group' ? `group-${it.data.id}` : `prompt-${it.data.id}`,
          );
          if (mixed.length === 0) {
            return (
              <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                <div className="py-2 mb-2 text-xs text-muted-foreground text-center border border-dashed rounded-lg">
                  Drop prompts or groups here
                </div>
              </SortableContext>
            );
          }
          return (
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-2 mb-2">
                {mixed.map((it) =>
                  it.kind === 'group' ? (
                    <SortableGroup
                      key={`g-${it.data.id}`}
                      group={it.data}
                      categoryId={cat.id}
                      onDeleted={onPromptUpdated}
                      onUpdated={onPromptUpdated}
                    />
                  ) : (
                    <SortablePrompt
                      key={`p-${it.data.id}`}
                      prompt={it.data}
                      onEdit={(pr) => { setEditingPrompt(pr); setShowPrompt(true); }}
                      onDeleted={onPromptUpdated}
                    />
                  ),
                )}
              </div>
            </SortableContext>
          );
        })()}
      </DropZone>

      {/* Actions */}
      <div className="flex gap-2 flex-wrap mt-2">
        <Button onClick={() => setShowSubCat(true)} variant="outline" size="sm" className="h-7 text-xs"><Plus className="h-3 w-3 mr-1" />Sub-cat</Button>
        <Button onClick={() => setShowGroup(true)} variant="outline" size="sm" className="h-7 text-xs"><Plus className="h-3 w-3 mr-1" />Group</Button>
        <Button onClick={() => { setEditingPrompt(null); setShowPrompt(true); }} variant="outline" size="sm" className="h-7 text-xs"><Plus className="h-3 w-3 mr-1" />Prompt</Button>
      </div>

      <PromptDialog open={showPrompt} onOpenChange={(o) => { if (!o) { setShowPrompt(false); setEditingPrompt(null); } }} categoryId={cat.id} prompt={editingPrompt} onSaved={() => { setShowPrompt(false); setEditingPrompt(null); onPromptUpdated(); }} />
      <GroupDialog open={showGroup} onOpenChange={setShowGroup} categoryId={cat.id} onSaved={() => { setShowGroup(false); onPromptUpdated(); }} />
      <CategoryDialog open={showSubCat} onOpenChange={setShowSubCat} parentId={cat.id} allCategories={allCategories} onSaved={() => { setShowSubCat(false); onPromptUpdated(); }} />
    </>
  );
}

/* ─── SubCategoryCard ─── */

function SubCatDropHeader({ catId, name, icon }: { catId: number; name: string; icon?: string | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop-subcat-${catId}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'px-3 py-1.5 -mx-4 -mt-4 mb-2 rounded-t-xl text-xs font-semibold uppercase tracking-wide transition-colors border-b',
        isOver
          ? 'bg-blue-100 text-blue-700 border-blue-300'
          : 'bg-gray-50 text-muted-foreground border-gray-100',
      )}
    >
      {icon && <span className="mr-1">{icon}</span>}
      {name}
      {isOver && <span className="ml-2 normal-case font-normal">— drop to move here</span>}
    </div>
  );
}

function SubCategoryCard({ cat, allCategories, onPromptUpdated, onEdit }: {
  cat: NBCategory; allCategories?: NBCategory[]; onPromptUpdated: () => void; onEdit: (c: NBCategory) => void;
}) {
  const api = usePromptStudioApi();
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  // FIX 18 — collapse/uncollapse for sub-categories. Roger asked for this so
  // the admin panel stays compact when a sub-cat has lots of prompts/groups.
  const [collapsed, setCollapsed] = useState(false);
  const { toast } = useToast();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `subcat-${cat.id}` });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 };
  // FIX 17c — show the role on sub-categories too, so admins can verify at a
  // glance that their role re-assignments actually stuck. Previously only the
  // root category showed a role badge, which hid cases where a sub-cat kept a
  // stale role after editing.
  const roleLabel = { integrator: 'Integrator', 'ads-creator': 'Ads Creator', both: 'Both' }[cat.role];

  // Compact count for the collapsed summary: sub-cats + groups + own prompts.
  const summaryCount =
    (cat.children || []).length +
    (cat.groups || []).length +
    (cat.prompts || []).filter((p) => !p.group_id).length;

  return (
    <>
      <div ref={setNodeRef} style={style} className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
        <SubCatDropHeader catId={cat.id} name={cat.name} icon={cat.icon} />
        <div className="flex items-center gap-2 mb-2">
          <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"><GripVertical className="h-4 w-4" /></button>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="flex items-center gap-2 flex-1 min-w-0 text-left"
            aria-label={collapsed ? 'Expand sub-category' : 'Collapse sub-category'}
          >
            {collapsed
              ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
            <h4 className="flex-1 min-w-0 font-semibold text-sm truncate">
              {cat.icon && <span className="mr-1">{cat.icon}</span>}{cat.name}
            </h4>
            {collapsed && summaryCount > 0 && (
              <Badge variant="secondary" className="shrink-0 text-[10px]">{summaryCount}</Badge>
            )}
          </button>
          <Badge variant="outline" className="shrink-0 text-[10px]">{roleLabel}</Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-7 p-0"><MoreVertical className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowEdit(true)}><Edit className="h-3.5 w-3.5 mr-2" />Edit</DropdownMenuItem>
              <DropdownMenuItem onClick={async () => { try { await api.duplicateCategory(cat.id); onPromptUpdated(); toast({ title: 'Duplicated' }); } catch { toast({ title: 'Error', variant: 'destructive' }); } }}><Copy className="h-3.5 w-3.5 mr-2" />Duplicate</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowDelete(true)} className="text-destructive focus:text-destructive"><Trash2 className="h-3.5 w-3.5 mr-2" />Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {!collapsed && (
          <CategoryContent cat={cat} allCategories={allCategories} onPromptUpdated={onPromptUpdated} onEdit={onEdit} />
        )}
      </div>
      <CategoryDialog open={showEdit} onOpenChange={setShowEdit} category={cat} allCategories={allCategories} onSaved={() => { setShowEdit(false); onPromptUpdated(); }} />
      <ConfirmDialog open={showDelete} onOpenChange={setShowDelete} title="Delete sub-category" description={`Delete "${cat.name}"?`} confirmLabel="Delete" onConfirm={async () => { await api.deleteCategory(cat.id); onPromptUpdated(); }} />
    </>
  );
}

/* ─── CategoryBlock (root) ─── */

interface CategoryBlockProps {
  category: NBCategory;
  allCategories?: NBCategory[];
  onEdit: (category: NBCategory) => void;
  onDeleted: () => void;
  onPromptUpdated: () => void;
}

export function CategoryBlock({ category, allCategories, onEdit, onDeleted, onPromptUpdated }: CategoryBlockProps) {
  const api = usePromptStudioApi();
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showSubCategoryDialog, setShowSubCategoryDialog] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | number | null>(null);
  // FIX 18 — collapse/uncollapse for root categories. When a category has
  // many groups/sub-cats, scrolling the admin panel becomes painful; Roger
  // asked for a way to roll them up.
  const [collapsed, setCollapsed] = useState(false);
  const { toast } = useToast();

  const children = category.children || [];
  const groups = category.groups || [];
  const ungroupedPrompts = (category.prompts || []).filter((p) => !p.group_id);
  const summaryCount =
    children.length +
    groups.length +
    ungroupedPrompts.length;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: category.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const aId = String(active.id);
    const oId = String(over.id);

    try {
      // ── drop on named zone ──

      if (oId.startsWith('drop-ungrouped-')) {
        const targetCatId = parseInt(oId.replace('drop-ungrouped-', ''));
        if (aId.startsWith('group-')) {
          const gid = parseInt(aId.replace('group-', ''));
          const f = findGroupInTree(gid, category);
          if (f && f.owner.id !== targetCatId) {
            await api.updateGroup(gid, { category_id: targetCatId });
            onPromptUpdated(); return;
          }
        } else if (aId.startsWith('prompt-')) {
          const pid = parseInt(aId.replace('prompt-', ''));
          const f = findPromptInTree(pid, category);
          if (f) {
            if (f.owner.id !== targetCatId) await api.updatePrompt(pid, { category_id: targetCatId, group_id: null });
            else if (f.group) await api.assignPromptGroup(pid, null);
            onPromptUpdated(); return;
          }
        }
      }

      if (oId.startsWith('drop-group-')) {
        const targetGid = parseInt(oId.replace('drop-group-', ''));
        if (aId.startsWith('prompt-')) {
          const pid = parseInt(aId.replace('prompt-', ''));
          const gInfo = findGroupInTree(targetGid, category);
          const pInfo = findPromptInTree(pid, category);
          if (gInfo && pInfo) {
            if (gInfo.owner.id !== pInfo.owner.id) await api.updatePrompt(pid, { category_id: gInfo.owner.id, group_id: targetGid });
            else await api.updatePrompt(pid, { group_id: targetGid });
            onPromptUpdated(); return;
          }
        }
      }

      if (oId.startsWith('drop-subcat-')) {
        const targetCatId = parseInt(oId.replace('drop-subcat-', ''));
        if (aId.startsWith('group-')) {
          const gid = parseInt(aId.replace('group-', ''));
          await api.updateGroup(gid, { category_id: targetCatId });
          onPromptUpdated(); return;
        } else if (aId.startsWith('prompt-')) {
          const pid = parseInt(aId.replace('prompt-', ''));
          await api.updatePrompt(pid, { category_id: targetCatId, group_id: null });
          onPromptUpdated(); return;
        }
      }

      // ── reorder sub-categories ──
      if (aId.startsWith('subcat-') && oId.startsWith('subcat-')) {
        const aCid = parseInt(aId.replace('subcat-', ''));
        const oCid = parseInt(oId.replace('subcat-', ''));
        const ci = children.findIndex((c) => c.id === aCid);
        const cj = children.findIndex((c) => c.id === oCid);
        if (ci >= 0 && cj >= 0) {
          await api.reorderCategories(arrayMove(children, ci, cj).map((c) => c.id));
          onPromptUpdated(); return;
        }
        // sub-cats within a sub-cat
        for (const ch of children) {
          const sch = ch.children || [];
          const si = sch.findIndex((c) => c.id === aCid);
          const sj = sch.findIndex((c) => c.id === oCid);
          if (si >= 0 && sj >= 0) { await api.reorderCategories(arrayMove(sch, si, sj).map((c) => c.id)); onPromptUpdated(); return; }
        }
      }

      // FIX 27b — UNIFIED reorder for groups + ungrouped prompts at the
      // category level. The previous code had two separate paths
      // (group↔group and ungroupedPrompt↔ungroupedPrompt) and rejected
      // cross-type drags entirely, so a solo prompt could never sit
      // between two groups. We now build the merged list (all groups +
      // all ungrouped prompts in their current sort_order), apply
      // arrayMove, and POST one unified array to /reorder-mixed which
      // writes the new index to BOTH tables in one batch. This handles
      // every category-level case: group↔group, prompt↔prompt, and
      // group↔prompt.
      const isCategoryLevelMove =
        (aId.startsWith('group-') || aId.startsWith('prompt-')) &&
        (oId.startsWith('group-') || oId.startsWith('prompt-'));
      if (isCategoryLevelMove) {
        // Build the candidate mixed list for each category we own
        // (the root category and its sub-categories that share the
        // DnD context with us).
        const allCats = [category, ...children];
        for (const cat of allCats) {
          const groups = cat.groups || [];
          const ungrouped = (cat.prompts || []).filter((p) => !p.group_id);
          const merged: Array<{ kind: 'group' | 'prompt'; id: number; sort: number }> = [
            ...groups.map((g) => ({ kind: 'group' as const, id: g.id, sort: g.sort_order ?? 0 })),
            ...ungrouped.map((p) => ({ kind: 'prompt' as const, id: p.id, sort: p.sort_order ?? 0 })),
          ].sort((a, b) => a.sort - b.sort);
          const ai = merged.findIndex(
            (it) => `${it.kind}-${it.id}` === aId,
          );
          const oi = merged.findIndex(
            (it) => `${it.kind}-${it.id}` === oId,
          );
          if (ai >= 0 && oi >= 0) {
            const reordered = arrayMove(merged, ai, oi);
            await api.reorderMixed(
              cat.id,
              reordered.map((it) => ({ type: it.kind, id: it.id })),
            );
            onPromptUpdated();
            return;
          }
        }
        // Not a category-level same-cat move — could be inside a group
        // (prompt↔prompt within the same group). Fall through to the
        // intra-group path below.
      }

      // ── reorder prompts INSIDE a group (intra-group only — the
      // category-level path above already handled ungrouped
      // prompt↔prompt and prompt↔group) ──
      if (aId.startsWith('prompt-') && oId.startsWith('prompt-')) {
        const aPid = parseInt(aId.replace('prompt-', ''));
        const oPid = parseInt(oId.replace('prompt-', ''));
        const allCats = [category, ...children];
        for (const cat of allCats) {
          for (const g of cat.groups || []) {
            const pi = g.prompts.findIndex((p) => p.id === aPid);
            const pj = g.prompts.findIndex((p) => p.id === oPid);
            if (pi >= 0 && pj >= 0) {
              await api.reorderPrompts(cat.id, arrayMove(g.prompts, pi, pj).map((p) => p.id));
              onPromptUpdated();
              return;
            }
          }
        }
      }
    } catch (e: any) {
      console.error('DnD failed:', e);
      toast({ title: 'Error', description: e?.message || 'Failed', variant: 'destructive' });
    }
  };

  const roleLabel = { integrator: 'Integrator', 'ads-creator': 'Ads Creator', both: 'Both' }[category.role];

  return (
    <>
      <Card ref={setNodeRef} style={style} className="p-6 rounded-2xl shadow-sm border border-black/5">
        <div className="flex items-start gap-4 mb-4">
          <button {...attributes} {...listeners} className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"><GripVertical className="h-5 w-5" /></button>
          <div className="flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="flex items-center gap-3 w-full text-left"
              aria-label={collapsed ? 'Expand category' : 'Collapse category'}
            >
              {collapsed
                ? <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                : <ChevronDown className="h-5 w-5 text-muted-foreground shrink-0" />}
              {category.icon && <span className="text-xl shrink-0">{category.icon === 'Sparkles' ? <Sparkles className="h-5 w-5" style={{ color: category.color || undefined }} /> : category.icon}</span>}
              <h3 className="text-lg font-semibold tracking-tight truncate">{category.name}</h3>
              <Badge variant="outline" className="shrink-0">{roleLabel}</Badge>
              {collapsed && summaryCount > 0 && (
                <Badge variant="secondary" className="shrink-0 text-xs">{summaryCount}</Badge>
              )}
            </button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowEditDialog(true)}><Edit className="h-4 w-4 mr-2" />Edit</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowSubCategoryDialog(true)}><Plus className="h-4 w-4 mr-2" />Add sub-category</DropdownMenuItem>
              <DropdownMenuItem onClick={async () => { try { await api.duplicateCategory(category.id); onPromptUpdated(); toast({ title: 'Duplicated' }); } catch { toast({ title: 'Error', variant: 'destructive' }); } }}><Copy className="h-4 w-4 mr-2" />Duplicate</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowDeleteDialog(true)} className="text-destructive focus:text-destructive"><Trash2 className="h-4 w-4 mr-2" />Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {!collapsed && (category.product_type_ids?.length ?? 0) > 0 && (
          <div className="mb-4 flex flex-wrap gap-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide mr-1 self-center">Product types:</span>
            {category.product_type_ids!.map((ptId) => <Badge key={ptId} variant="secondary" className="text-[10px]">PT#{ptId}</Badge>)}
          </div>
        )}

        {!collapsed && (
          <DndContext
            sensors={sensors}
            collisionDetection={mixedCollision}
            onDragStart={(e) => setActiveDragId(e.active.id)}
            onDragCancel={() => setActiveDragId(null)}
            onDragEnd={handleDragEnd}
          >
            <CategoryContent cat={category} allCategories={allCategories} onPromptUpdated={onPromptUpdated} onEdit={onEdit} />
            <DragOverlay dropAnimation={null}>
              {activeDragId && (
                <div className="px-3 py-2 rounded-lg bg-white shadow-xl border-2 border-primary/30 text-sm font-medium max-w-[220px] truncate pointer-events-none">
                  {getDragLabel(activeDragId, category)}
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}

        {!collapsed && (category.prompts || []).length === 0 && children.length === 0 && groups.length === 0 && (
          <div className="py-8 text-center border-2 border-dashed rounded-xl"><p className="text-sm text-muted-foreground">No content yet.</p></div>
        )}
      </Card>

      <CategoryDialog open={showEditDialog} onOpenChange={setShowEditDialog} category={category} allCategories={allCategories} onSaved={() => { setShowEditDialog(false); onPromptUpdated(); }} />
      <CategoryDialog open={showSubCategoryDialog} onOpenChange={setShowSubCategoryDialog} parentId={category.id} allCategories={allCategories} onSaved={() => { setShowSubCategoryDialog(false); onPromptUpdated(); }} />
      <ConfirmDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog} title="Delete category" description={`Delete "${category.name}"? All content will be deleted.`} confirmLabel="Delete" onConfirm={async () => { await api.deleteCategory(category.id); onDeleted(); }} />
    </>
  );
}
