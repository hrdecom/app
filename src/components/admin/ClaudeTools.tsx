import { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import {
  GripVertical,
  Plus,
  Edit,
  Trash2,
  Loader2,
  Sparkles,
  Save,
  Eye,
  EyeOff,
  List,
  Tag,
  Ban,
  Wand2,
  Search,
  X,
  Download,
} from 'lucide-react';
import {
  listProductTypes,
  reorderProductTypes,
  deleteProductType,
  listCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  reorderCollections,
  getSettings,
  updateSettings,
  listBlacklist,
  deleteBlacklistItem,
  importShopifyTitlesIntoBlacklist,
  clearAllBlacklist,
  type ProductType,
  type ProductCollection,
  type ClaudeSettings,
  type BlacklistItem,
} from '@/lib/claude';
import { ProductTypeDialog } from './claude/ProductTypeDialog';

function SortableProductTypeRow({ productType, onEdit, onDelete }: any) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: productType.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="h-5 w-5" />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{productType.name}</span>
          <span className="text-sm text-muted-foreground">({productType.slug})</span>
          {productType.is_active ? (
            <Badge variant="outline" className="text-xs">
              <Eye className="h-3 w-3 mr-1" />
              Active
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs">
              <EyeOff className="h-3 w-3 mr-1" />
              Inactive
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => onEdit(productType)}>
          <Edit className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(productType)}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function SortableCollectionRow({ collection, onDelete, onTagsChange }: any) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: collection.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const [tagsInput, setTagsInput] = useState<string>(
    (collection.shopify_tags_list && collection.shopify_tags_list.join(', ')) || collection.shopify_tags || '',
  );
  const [savingTags, setSavingTags] = useState(false);

  const commitTags = async () => {
    const normalized = tagsInput
      .split(',')
      .map((t: string) => t.trim())
      .filter(Boolean)
      .join(', ');
    if (normalized === (collection.shopify_tags || '')) return;
    setSavingTags(true);
    try {
      await onTagsChange(collection, normalized);
    } finally {
      setSavingTags(false);
    }
  };

  const tags: string[] = tagsInput.split(',').map((t: string) => t.trim()).filter(Boolean);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex flex-col gap-2 p-3 bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
    >
      <div className="flex items-center gap-3">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <span className="flex-1 font-medium text-sm">{collection.name}</span>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(collection)}
          className="text-destructive hover:text-destructive h-7 w-7 p-0"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="pl-7 flex items-center gap-2">
        <Input
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          onBlur={commitTags}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Shopify tags (comma separated)…"
          className="h-8 text-xs"
          disabled={savingTags}
        />
        {savingTags && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {tags.length > 0 && (
        <div className="pl-7 flex flex-wrap gap-1">
          {tags.map((t, i) => (
            <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-700">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ClaudeTools() {
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [collections, setCollections] = useState<ProductCollection[]>([]);
  const [settings, setSettings] = useState<ClaudeSettings | null>(null);
  const [blacklist, setBlacklist] = useState<BlacklistItem[]>([]);
  const [blacklistTotal, setBlacklistTotal] = useState(0);

  const [loading, setLoading] = useState(true);
  const [showProductTypeDialog, setShowProductTypeDialog] = useState(false);
  const [editingProductType, setEditingProductType] = useState<ProductType | null>(null);

  const [newCollectionName, setNewCollectionName] = useState('');
  const [addingCollection, setAddingCollection] = useState(false);

  const [blacklistFilter, setBlacklistFilter] = useState<string>('__all__');
  const [blacklistSearch, setBlacklistSearch] = useState('');
  const [blacklistOffset, setBlacklistOffset] = useState(0);
  // FIX 26d — bulk-import-from-Shopify state. The action paginates
  // every product on the storefront and adds each title to the blacklist
  // under the sentinel slug `__shopify__`, so Claude never re-suggests
  // a name that's already in use.
  const [importingShopify, setImportingShopify] = useState(false);
  // FIX 26d v3 — clear-all state for the nuclear "wipe entire blacklist"
  // action. Two-step confirm because it deletes everything (including
  // human-curated entries from the integrator's accept-title flow).
  const [clearingAll, setClearingAll] = useState(false);

  async function handleClearAllBlacklist() {
    if (clearingAll) return;
    if (!confirm(
      'Delete EVERY blacklist entry? This wipes both Shopify-imported names ' +
      'AND names blocked by the integrator workflow. Cannot be undone.'
    )) return;
    if (!confirm('Last chance — really wipe the entire title blacklist?')) return;
    setClearingAll(true);
    try {
      const res = await clearAllBlacklist();
      toast({
        title: 'Blacklist cleared',
        description: `Removed ${res.deleted} entr${res.deleted === 1 ? 'y' : 'ies'}.`,
      });
      setBlacklistOffset(0);
      loadBlacklist();
    } catch (e: any) {
      toast({
        title: 'Clear failed',
        description: e?.message || 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setClearingAll(false);
    }
  }

  async function handleImportShopify() {
    if (importingShopify) return;
    if (!confirm(
      'This will fetch every product on your Shopify storefront and add their titles to the blacklist. ' +
      'Existing entries are kept (no duplicates). Continue?'
    )) return;
    setImportingShopify(true);
    try {
      const res = await importShopifyTitlesIntoBlacklist();
      toast({
        title: 'Shopify titles imported',
        description: `Found ${res.shopify_products} product(s). Added ${res.inserted} new, skipped ${res.skipped} already in blacklist.`,
      });
      // Reset paging + reload list so the new entries appear at top.
      setBlacklistOffset(0);
      loadBlacklist();
    } catch (e: any) {
      toast({
        title: 'Import failed',
        description: e?.message || 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setImportingShopify(false);
    }
  }
  const [loadingBlacklist, setLoadingBlacklist] = useState(false);

  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    loadBlacklist();
  }, [blacklistFilter, blacklistSearch, blacklistOffset]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [types, cols, sett] = await Promise.all([
        listProductTypes(),
        listCollections(),
        getSettings(),
      ]);
      setProductTypes(types);
      setCollections(cols);
      setSettings(sett);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to load Copywriting Tool data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadBlacklist = async () => {
    try {
      setLoadingBlacklist(true);
      const data = await listBlacklist({
        product_type_slug: blacklistFilter && blacklistFilter !== '__all__' ? blacklistFilter : undefined,
        q: blacklistSearch || undefined,
        limit: 50,
        offset: blacklistOffset,
      });
      setBlacklist(data.items);
      setBlacklistTotal(data.total);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to load blacklist',
        variant: 'destructive',
      });
    } finally {
      setLoadingBlacklist(false);
    }
  };

  // Product Types
  const handleProductTypesDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = productTypes.findIndex((t) => t.id === active.id);
    const newIndex = productTypes.findIndex((t) => t.id === over.id);
    const newOrder = arrayMove(productTypes, oldIndex, newIndex);
    setProductTypes(newOrder);

    try {
      await reorderProductTypes(newOrder.map((t) => t.id));
      toast({ title: 'Success', description: 'Product types reordered' });
    } catch (error: any) {
      setProductTypes(productTypes);
      toast({
        title: 'Error',
        description: error.message || 'Failed to reorder',
        variant: 'destructive',
      });
    }
  };

  const handleEditProductType = (type: ProductType) => {
    setEditingProductType(type);
    setShowProductTypeDialog(true);
  };

  const handleNewProductType = () => {
    setEditingProductType(null);
    setShowProductTypeDialog(true);
  };

  const handleProductTypeDialogClose = () => {
    setShowProductTypeDialog(false);
    setEditingProductType(null);
  };

  const handleProductTypeSaved = () => {
    loadData();
    handleProductTypeDialogClose();
    toast({
      title: 'Success',
      description: editingProductType ? 'Product type updated' : 'Product type created',
    });
  };

  const handleDeleteProductType = async (type: ProductType) => {
    if (!confirm(`Delete product type "${type.name}"?`)) return;
    try {
      await deleteProductType(type.id);
      loadData();
      toast({ title: 'Success', description: 'Product type deleted' });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete',
        variant: 'destructive',
      });
    }
  };

  // Collections
  const handleCollectionsDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = collections.findIndex((c) => c.id === active.id);
    const newIndex = collections.findIndex((c) => c.id === over.id);
    const newOrder = arrayMove(collections, oldIndex, newIndex);
    setCollections(newOrder);

    try {
      await reorderCollections(newOrder.map((c) => c.id));
      toast({ title: 'Success', description: 'Collections reordered' });
    } catch (error: any) {
      setCollections(collections);
      toast({
        title: 'Error',
        description: error.message || 'Failed to reorder',
        variant: 'destructive',
      });
    }
  };

  const handleAddCollection = async () => {
    if (!newCollectionName.trim()) return;
    try {
      setAddingCollection(true);
      await createCollection({ name: newCollectionName.trim() });
      setNewCollectionName('');
      loadData();
      toast({ title: 'Success', description: 'Collection added' });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to add collection',
        variant: 'destructive',
      });
    } finally {
      setAddingCollection(false);
    }
  };

  const handleDeleteCollection = async (collection: ProductCollection) => {
    if (!confirm(`Delete collection "${collection.name}"?`)) return;
    try {
      await deleteCollection(collection.id);
      loadData();
      toast({ title: 'Success', description: 'Collection deleted' });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete',
        variant: 'destructive',
      });
    }
  };

  // Settings
  const handleSaveSettings = async () => {
    if (!settings) return;
    try {
      await updateSettings(settings);
      toast({ title: 'Success', description: 'Settings saved' });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save settings',
        variant: 'destructive',
      });
    }
  };

  // Blacklist
  const handleDeleteBlacklistItem = async (item: BlacklistItem) => {
    if (!confirm(`Remove "${item.name}" from blacklist?`)) return;
    try {
      await deleteBlacklistItem(item.id);
      loadBlacklist();
      toast({ title: 'Success', description: 'Blacklist item removed' });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to remove',
        variant: 'destructive',
      });
    }
  };

  const relativeTime = (date: string) => {
    const now = new Date();
    const then = new Date(date);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMins > 0) return `${diffMins}m ago`;
    return 'just now';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Copywriting Tool</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure product types, collections, prompt templates, and title blacklist.
        </p>
      </div>

      {/* 1. Product Types */}
      <Card className="rounded-2xl shadow-sm border-black/5 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <List className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold tracking-tight">Product Types</h3>
          </div>
          <Button onClick={handleNewProductType} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            New product type
          </Button>
        </div>

        {productTypes.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">No product types yet. Create one to get started.</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleProductTypesDragEnd}
          >
            <SortableContext
              items={productTypes.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {productTypes.map((type) => (
                  <SortableProductTypeRow
                    key={type.id}
                    productType={type}
                    onEdit={handleEditProductType}
                    onDelete={handleDeleteProductType}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </Card>

      {/* 2. Collections */}
      <Card className="rounded-2xl shadow-sm border-black/5 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Tag className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold tracking-tight">Collections</h3>
        </div>

        <div className="flex gap-2 mb-4">
          <Input
            placeholder="Add collection name..."
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCollection()}
          />
          <Button
            onClick={handleAddCollection}
            disabled={!newCollectionName.trim() || addingCollection}
            size="sm"
          >
            {addingCollection ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>

        {collections.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <p className="text-sm">No collections yet.</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleCollectionsDragEnd}
          >
            <SortableContext
              items={collections.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {collections.map((collection) => (
                  <SortableCollectionRow
                    key={collection.id}
                    collection={collection}
                    onDelete={handleDeleteCollection}
                    onTagsChange={async (c: any, newTags: string) => {
                      try {
                        await updateCollection(c.id, { shopify_tags: newTags });
                        toast({ title: 'Tags saved', description: c.name });
                        loadData();
                      } catch (err: any) {
                        toast({
                          title: 'Error',
                          description: err?.message || 'Failed to save tags',
                          variant: 'destructive',
                        });
                      }
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </Card>

      {/* 3. Prompt Templates */}
      <div className="space-y-4">
        {/* Title Template */}
        <Card className="rounded-2xl shadow-sm border-black/5 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Wand2 className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold tracking-tight">Title Template</h3>
          </div>

          {settings && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 mb-2">
                <Badge variant="secondary" className="text-xs font-mono">
                  {'{{product_type}}'}
                </Badge>
                <Badge variant="secondary" className="text-xs font-mono">
                  {'{{collection_list}}'}
                </Badge>
                <Badge variant="secondary" className="text-xs font-mono">
                  {'{{source_links}}'}
                </Badge>
                <Badge variant="secondary" className="text-xs font-mono">
                  {'{{blacklisted_names}}'}
                </Badge>
              </div>

              <Textarea
                placeholder="Enter title template..."
                className="min-h-[120px] font-mono text-sm"
                value={settings.title_template}
                onChange={(e) =>
                  setSettings({ ...settings, title_template: e.target.value })
                }
              />

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="format_ring" className="text-sm">
                    Ring format
                  </Label>
                  <Input
                    id="format_ring"
                    placeholder="e.g. {initial}"
                    value={settings.format_ring}
                    onChange={(e) =>
                      setSettings({ ...settings, format_ring: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="format_other" className="text-sm">
                    Other format
                  </Label>
                  <Input
                    id="format_other"
                    placeholder="e.g. {name}"
                    value={settings.format_other}
                    onChange={(e) =>
                      setSettings({ ...settings, format_other: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveSettings} size="sm">
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Description Template */}
        <Card className="rounded-2xl shadow-sm border-black/5 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold tracking-tight">Description Template</h3>
          </div>

          {settings && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 mb-2">
                <Badge variant="secondary" className="text-xs font-mono">
                  {'{{title}}'}
                </Badge>
                <Badge variant="secondary" className="text-xs font-mono">
                  {'{{product_type}}'}
                </Badge>
                <Badge variant="secondary" className="text-xs font-mono">
                  {'{{collection}}'}
                </Badge>
                <Badge variant="secondary" className="text-xs font-mono">
                  {'{{max_chars}}'}
                </Badge>
                <Badge variant="secondary" className="text-xs font-mono">
                  {'{{bullet_template}}'}
                </Badge>
              </div>

              <Textarea
                placeholder="Enter description template..."
                className="min-h-[160px] font-mono text-sm"
                value={settings.description_template}
                onChange={(e) =>
                  setSettings({ ...settings, description_template: e.target.value })
                }
              />

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="max_chars" className="text-sm">
                    Max chars per paragraph
                  </Label>
                  <Input
                    id="max_chars"
                    type="number"
                    value={settings.description_max_chars}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        description_max_chars: parseInt(e.target.value) || 180,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="paragraphs" className="text-sm">
                    Paragraphs
                  </Label>
                  <Input
                    id="paragraphs"
                    type="number"
                    value={settings.description_paragraph_count}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        description_paragraph_count: parseInt(e.target.value) || 2,
                      })
                    }
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveSettings} size="sm">
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* 4. Title Blacklist */}
      <Card className="rounded-2xl shadow-sm border-black/5 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Ban className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold tracking-tight">Title Blacklist</h3>
          {blacklistTotal > 0 && (
            <Badge variant="outline" className="ml-2">
              {blacklistTotal}
            </Badge>
          )}
          {/* FIX 26d — bulk import from Shopify. Pulls every product
              title from the storefront and adds it to the blacklist
              so Claude never re-suggests an existing name. Idempotent
              — re-running just tops up with new titles. */}
          <div className="ml-auto flex items-center gap-2">
            {/* FIX 26d v3 — Clear-all wipes EVERY blacklist row, including
                human-curated entries. Two-step confirm gates the action;
                the destructive styling makes it visually distinct from
                the safe Import button. */}
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={handleClearAllBlacklist}
              disabled={clearingAll || blacklistTotal === 0}
              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
              title="Permanently delete every blacklist entry"
            >
              {clearingAll
                ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
              Clear all
            </Button>
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={handleImportShopify}
              disabled={importingShopify}
              title="Add every Shopify product title to the blacklist"
            >
              {importingShopify
                ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                : <Download className="h-3.5 w-3.5 mr-1.5" />}
              Import from Shopify
            </Button>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <Select value={blacklistFilter} onValueChange={setBlacklistFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All types</SelectItem>
              {(productTypes ?? [])
                .filter((type) => type.slug)
                .map((type) => (
                  <SelectItem key={type.id} value={type.slug}>
                    {type.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>

          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search blacklist..."
              value={blacklistSearch}
              onChange={(e) => setBlacklistSearch(e.target.value)}
              className="pl-9"
            />
            {blacklistSearch && (
              <button
                onClick={() => setBlacklistSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        {loadingBlacklist ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : blacklist.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">No blacklisted titles found.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {blacklist.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border border-gray-200"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{item.name}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="capitalize">{item.product_type_slug}</span>
                    {item.product_id && <span>Product #{item.product_id}</span>}
                    <span>{relativeTime(item.created_at)}</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteBlacklistItem(item)}
                  className="text-destructive hover:text-destructive h-8 w-8 p-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {blacklistTotal > 50 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              Showing {blacklistOffset + 1}-{Math.min(blacklistOffset + 50, blacklistTotal)} of{' '}
              {blacklistTotal}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={blacklistOffset === 0}
                onClick={() => setBlacklistOffset(Math.max(0, blacklistOffset - 50))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={blacklistOffset + 50 >= blacklistTotal}
                onClick={() => setBlacklistOffset(blacklistOffset + 50)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      <ProductTypeDialog
        open={showProductTypeDialog}
        onOpenChange={handleProductTypeDialogClose}
        productType={editingProductType}
        onSaved={handleProductTypeSaved}
      />
    </div>
  );
}
