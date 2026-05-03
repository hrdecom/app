import { useEffect, useState, useRef } from 'react';
import {
  Sparkles,
  Zap,
  ArrowUpLeft,
  Send,
  Check,
  X,
  ImageIcon,
  Loader2,
  Plus,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Trash2,
  Film,
  Clapperboard,
  Upload,
} from 'lucide-react';
import { ImageLightbox } from '@/components/ui/ImageLightbox';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import {
  listCategories,
  generate,
  listStudioGenerations,
  clearStudioGenerations,
  uploadAndSaveStudioImage,
  type NBCategory,
  type NBPrompt,
  type NBGroup,
  type NBGenerateRequest,
  type NBGeneratedImage,
  type StudioScope,
} from '@/lib/nano-banana';
import { addProductImagesBatch } from '@/lib/products';

export interface NBBatch {
  id: string;
  items: NBGeneratedImage[];
  ar: string;
  submittedAt: Date;
}

interface NanoBananaStudioProps {
  productId?: number;
  product?: any; // Product with images[]
  productCategorySlug?: string;
  userRole?: string;
  onImagesAdded?: () => void;
  // PHASE 2 — Scope separates integrator vs ads-creator studio histories on
  // the same product. Defaults to `integrator` for the legacy integrator
  // workspace; ads-creator workspace passes `'ads-creator'`.
  scope?: StudioScope;
  // PHASE 2 — Which product_images.role to write when the user adds images
  // to the product: `'generated'` for integrator output (canonical product
  // images fed into Variants/Shopify push), `'ad'` for ads-creator output
  // (ad creatives consumed by Video Studio / Editor).
  imageRole?: 'generated' | 'ad';
  // PHASE 2 — Label + lucide icon override for the primary add-to-product
  // action so the ads-creator can show "Add to Ad Assets" without
  // misleading the integrator's "Add to Product" wording.
  addButtonLabel?: string;
  // Lifted state (persists across tab switches)
  batches: NBBatch[];
  setBatches: React.Dispatch<React.SetStateAction<NBBatch[]>>;
  selectedUrls: Set<string>;
  setSelectedUrls: React.Dispatch<React.SetStateAction<Set<string>>>;
  attachedImageUrls: string[];
  setAttachedImageUrls: React.Dispatch<React.SetStateAction<string[]>>;
}

type AspectRatio = '1:1' | '9:16' | '16:9' | '4:3';
type Quality = '1k' | '2k' | '4k';

function CategoryNavItem({
  cat,
  depth,
  selectedCategoryId,
  setSelectedCategoryId,
  selectedDirectPrompts,
  collapsedGroups,
  toggleGroupCollapsed,
  renderPromptButton,
}: {
  cat: NBCategory;
  depth: number;
  selectedCategoryId: number | null;
  setSelectedCategoryId: (id: number) => void;
  selectedDirectPrompts: Set<number>;
  collapsedGroups: Set<number>;
  toggleGroupCollapsed: (id: number) => void;
  renderPromptButton: (p: NBPrompt) => JSX.Element;
}) {
  const isSelected = cat.id === selectedCategoryId;
  const children = cat.children ?? [];

  // Check if this category or any of its descendants is selected
  function isAncestorOfSelected(c: NBCategory): boolean {
    if (c.id === selectedCategoryId) return true;
    return (c.children ?? []).some(isAncestorOfSelected);
  }
  const isExpanded = isSelected || isAncestorOfSelected(cat);

  // Root category's own prompts/groups are ALWAYS visible when expanded (even if a sub-cat is selected)
  const catUngrouped = isExpanded
    ? (cat.prompts ?? []).filter((p: NBPrompt) => p.active && !p.group_id)
    : [];
  const catGroups = isExpanded ? (cat.groups ?? []) : [];

  return (
    <div style={{ paddingLeft: depth > 0 ? 8 : 0 }}>
      {/* Category / sub-category button */}
      {depth === 0 ? (
        <button
          onClick={() => setSelectedCategoryId(cat.id)}
          className={cn(
            'w-full px-3 py-2 rounded-lg text-left text-sm font-medium transition-colors',
            isSelected
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-muted',
          )}
          style={{ backgroundColor: isSelected && cat.color ? cat.color : undefined }}
        >
          {cat.icon && <span className="mr-2">{cat.icon}</span>}
          {cat.name}
        </button>
      ) : (
        <button
          onClick={() => setSelectedCategoryId(cat.id)}
          className={cn(
            'w-full px-3 py-1.5 rounded-lg text-left text-xs font-semibold tracking-wide uppercase transition-colors border',
            isSelected
              ? 'bg-primary/10 text-primary border-primary/30'
              : 'text-foreground/70 bg-muted/60 border-transparent hover:bg-muted hover:border-gray-300',
          )}
        >
          {cat.icon && <span className="mr-1">{cat.icon}</span>}
          {cat.name}
        </button>
      )}

      {/* Sub-categories (always visible when parent is expanded) */}
      {isExpanded && children.length > 0 && (
        <div className="ml-2 mt-1.5 mb-1 space-y-1 border-l-2 border-gray-200 pl-2">
          {children.map((child: NBCategory) => (
            <CategoryNavItem
              key={child.id}
              cat={child}
              depth={depth + 1}
              selectedCategoryId={selectedCategoryId}
              setSelectedCategoryId={setSelectedCategoryId}
              selectedDirectPrompts={selectedDirectPrompts}
              collapsedGroups={collapsedGroups}
              toggleGroupCollapsed={toggleGroupCollapsed}
              renderPromptButton={renderPromptButton}
            />
          ))}
        </div>
      )}

      {/* Groups + ungrouped prompts — visible when this cat or a descendant is selected */}
      {isExpanded && (catUngrouped.length > 0 || catGroups.length > 0) && (
        <div className="space-y-1 mt-1.5 ml-2">
          {catGroups.map((group: NBGroup) => {
            const collapsed = collapsedGroups.has(group.id);
            const activePrompts = group.prompts.filter((p: NBPrompt) => p.active);
            return (
              <div key={group.id} className="space-y-1">
                <button
                  onClick={() => toggleGroupCollapsed(group.id)}
                  className="w-full px-2 py-1.5 rounded-md text-left text-xs font-semibold flex items-center gap-2 hover:bg-muted transition-colors"
                >
                  {collapsed ? (
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  )}
                  <span className="flex-1">{group.name}</span>
                  <Badge variant="secondary" className="text-[10px] px-1 py-0">
                    {activePrompts.length}
                  </Badge>
                </button>
                {!collapsed && (
                  <div className="space-y-1 pl-3">
                    {activePrompts.map(renderPromptButton)}
                  </div>
                )}
              </div>
            );
          })}
          {catUngrouped.map(renderPromptButton)}
        </div>
      )}
    </div>
  );
}

export function NanoBananaStudio({
  productId,
  product,
  productCategorySlug,
  userRole,
  onImagesAdded,
  scope = 'integrator',
  imageRole = 'generated',
  addButtonLabel,
  batches,
  setBatches,
  selectedUrls,
  setSelectedUrls,
  attachedImageUrls,
  setAttachedImageUrls,
}: NanoBananaStudioProps) {
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Categories & prompts
  const [categories, setCategories] = useState<NBCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());

  // Generation settings
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [quality, setQuality] = useState<Quality>('4k');
  const [count, setCount] = useState<number>(2);

  // Chat & generation
  const [promptText, setPromptText] = useState('');
  const [quotaWarning, setQuotaWarning] = useState<string | null>(null);

  // Selected direct prompt buttons (multi-select, fired on Send)
  const [selectedDirectPrompts, setSelectedDirectPrompts] = useState<Set<number>>(new Set());

  // Concurrent generation tracking — each entry is one in-flight request
  const [pendingGens, setPendingGens] = useState<{ id: string; label: string; count: number; ar: string }[]>([]);
  const generating = pendingGens.length > 0;

  // batches, selectedUrls, attachedImageUrl are lifted to the parent so they
  // survive tab switches. See props above.

  // Load persisted generations from D1 on mount
  const [loadingGenerations, setLoadingGenerations] = useState(false);
  const generationsLoaded = useRef(false);

  useEffect(() => {
    if (!productId || generationsLoaded.current || batches.length > 0) return;
    generationsLoaded.current = true;
    setLoadingGenerations(true);
    listStudioGenerations(productId, { scope })
      .then((gens) => {
        if (gens.length === 0) return;
        // Server returns newest-first; reverse so oldest batches render at
        // the top and new live batches continue appending at the bottom
        // (matches real-time generation order).
        const ordered = [...gens].reverse();
        const restored: NBBatch[] = ordered.map((g) => ({
          id: `db-${g.id}`,
          items: g.images.map((url) => ({
            url,
            prompt: g.prompt,
            aspect_ratio: g.aspect_ratio,
            quality: g.quality,
          })),
          ar: g.aspect_ratio,
          submittedAt: new Date(g.created_at),
        }));
        setBatches(restored);
      })
      .catch((e) => console.error('Failed to load studio generations', e))
      .finally(() => setLoadingGenerations(false));
  }, [productId]);

  // Add to product state
  const [addingToProduct, setAddingToProduct] = useState(false);

  // PHASE 2 — "Add to Editor" picker (ads-creator only). Opens a dialog
  // listing the product's editor projects; picking one appends the selected
  // images as timeline elements on that project.
  const [editorPickerOpen, setEditorPickerOpen] = useState(false);
  const [editorProjects, setEditorProjects] = useState<{ id: number; name: string }[]>([]);
  const [loadingEditorProjects, setLoadingEditorProjects] = useState(false);
  const [addingToEditor, setAddingToEditor] = useState(false);

  // Lightbox
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const allImages = batches.flatMap((b) => b.items.map((it) => ({ url: it.url })));

  // Load categories
  useEffect(() => {
    let cancelled = false;
    setLoadingCategories(true);
    listCategories({ product_type_slug: product?.product_type_slug || undefined })
      .then((raw: any) => {
        if (cancelled) return;
        // Defensive: tolerate both array and { items }/{ categories } shapes even if
        // the wrapper already unwraps — prevents the class of "x.find is not a function" bugs.
        const cats: NBCategory[] = Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.items)
          ? raw.items
          : Array.isArray(raw?.categories)
          ? raw.categories
          : [];
        setCategories(cats);
        // Collapse all groups by default (including sub-category groups)
        const allGroupIds = new Set<number>();
        const collectGroups = (list: NBCategory[]) => {
          list.forEach((c) => {
            (c.groups ?? []).forEach((g) => allGroupIds.add(g.id));
            if (c.children) collectGroups(c.children);
          });
        };
        collectGroups(cats);
        setCollapsedGroups(allGroupIds);
        if (cats.length > 0) {
          setSelectedCategoryId(cats[0].id);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        console.error('Failed to load Nano Banana categories', e);
        toast({
          title: 'Failed to load categories',
          description: e?.message || 'Unknown error',
          variant: 'destructive',
        });
      })
      .finally(() => !cancelled && setLoadingCategories(false));
    return () => {
      cancelled = true;
    };
  }, [productCategorySlug, toast]);

  // Find category by id in tree (root or child)
  function findCategory(id: number | null, list: NBCategory[]): NBCategory | undefined {
    for (const c of list) {
      if (c.id === id) return c;
      if (c.children) {
        const found = findCategory(id, c.children);
        if (found) return found;
      }
    }
    return undefined;
  }

  const selectedCategory = findCategory(selectedCategoryId, categories);
  const groups = selectedCategory?.groups ?? [];
  const ungroupedPrompts =
    selectedCategory?.prompts?.filter?.((p) => p.active && !p.group_id) ?? [];

  // Fire a single generation request (non-blocking — runs concurrently)
  function fireGeneration(prompt: string, label: string, extraImages?: string[], promptId?: number) {
    const allImages = [
      ...attachedImageUrls,
      ...(extraImages ?? []).filter((u) => !attachedImageUrls.includes(u)),
    ];

    const req: NBGenerateRequest & { scope?: StudioScope } = {
      prompt,
      product_id: productId,
      attached_image_urls: allImages.length > 0 ? allImages : undefined,
      aspect_ratio: aspectRatio,
      quality,
      count,
      prompt_id: promptId,
      // PHASE 2 — pass scope so admin users (who aren't ads-creator) still
      // persist to the correct scope when operating the ads-creator workspace.
      scope,
    };

    const pendingId = crypto.randomUUID();
    const pending = { id: pendingId, label, count, ar: aspectRatio };
    setPendingGens((prev) => [...prev, pending]);

    generate(req)
      .then((res) => {
        if ((res as any).error === 'quota_exceeded' || (res as any).error) {
          setQuotaWarning((res as any).message || 'API quota exceeded.');
          toast({ title: 'Quota exceeded', description: (res as any).message || 'Enable billing at aistudio.google.com', variant: 'destructive' });
        } else if (res.items.length > 0) {
          setQuotaWarning(null);
          // PHASE 2 — surface save_error if the server couldn't persist the
          // generation. Previously the INSERT was silently swallowed, so
          // ads-creator users thought their generations were saved when they
          // weren't.
          if ((res as any).save_error) {
            console.error('[NanoBananaStudio] server reported save_error:', (res as any).save_error);
            toast({
              title: 'Generated but not saved',
              description: `Server error: ${(res as any).save_error}. These images will disappear on refresh.`,
              variant: 'destructive',
            });
          }
          const batch: NBBatch = { id: crypto.randomUUID(), items: res.items, ar: aspectRatio, submittedAt: new Date() };
          setBatches((prev) => [...prev, batch]);
        } else {
          toast({ title: 'No images returned', description: `"${label}" — try a different prompt.`, variant: 'destructive' });
        }
      })
      .catch((e: any) => {
        console.error('Generation failed', e);
        const msg = e?.message || 'Unknown error';
        if (msg.includes('quota') || msg.includes('billing') || msg.includes('429')) setQuotaWarning(msg);
        toast({ title: 'Generation failed', description: `"${label}": ${msg}`, variant: 'destructive' });
      })
      .finally(() => {
        setPendingGens((prev) => prev.filter((p) => p.id !== pendingId));
      });
  }

  // FIX 25a — local image upload. Pick one (or several) files from disk,
  // upload each one to R2 via /api/images/upload, persist as a one-image
  // studio_generations row so it survives reload, and append to the
  // batches state so it appears immediately in the gallery alongside
  // Nano Banana outputs. The merchant can then click → select → add to
  // product / variant / editor with the existing tray buttons. We ignore
  // non-image files silently and surface upload failures via toast.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleUploadFiles(files: FileList | null) {
    if (!files || files.length === 0 || !productId) return;
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      toast({ title: 'Pick image files only', variant: 'destructive' });
      return;
    }
    setUploading(true);
    const newItems: NBGeneratedImage[] = [];
    for (const file of imageFiles) {
      try {
        const { url } = await uploadAndSaveStudioImage(productId, file, { scope });
        newItems.push({ url, prompt: '[uploaded]', aspect_ratio: '1:1', quality: '4k' } as NBGeneratedImage);
      } catch (e: any) {
        console.error('[upload] failed for', file.name, e);
        toast({
          title: 'Upload failed',
          description: `${file.name}: ${e?.message || 'unknown error'}`,
          variant: 'destructive',
        });
      }
    }
    if (newItems.length > 0) {
      const batch: NBBatch = {
        id: crypto.randomUUID(),
        items: newItems,
        ar: '1:1',
        submittedAt: new Date(),
      };
      setBatches((prev) => [...prev, batch]);
      toast({
        title: `Uploaded ${newItems.length} image${newItems.length === 1 ? '' : 's'}`,
      });
    }
    setUploading(false);
    // Reset the input so picking the same file again still triggers onChange.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Send button handler — fires all selected direct prompts + chat prompt
  function handleSend() {
    const allPrompts = getAllDirectPrompts();
    const selectedDirect = allPrompts.filter((p) => selectedDirectPrompts.has(p.id));

    // Fire each selected direct prompt as a separate parallel request
    for (const p of selectedDirect) {
      const extraImages = p.attached_image_url ? [p.attached_image_url] : [];
      fireGeneration(p.content, p.button_label, extraImages, p.id);
    }

    // Fire the manual chat prompt if present
    if (promptText.trim()) {
      fireGeneration(promptText.trim(), promptText.trim().slice(0, 40));
      setPromptText('');
    }

    // If nothing was queued (no prompts selected, no text), fire with just images
    if (selectedDirect.length === 0 && !promptText.trim() && attachedImageUrls.length > 0) {
      fireGeneration('', 'Image only');
    }

    // Clear direct prompt selections after send
    setSelectedDirectPrompts(new Set());
    // FIX 25d — also clear selected reference images so the next prompt
    // starts with a fresh slate. The previous behaviour kept attached
    // images checked across multiple sends, which made it easy to
    // accidentally re-attach an unwanted reference to a brand new
    // request. clearSelections() handles both selectedUrls (gallery
    // checkmarks) and attachedImageUrls (the chip row above the
    // textarea).
    clearSelections();
  }

  // Gather all direct prompts across all categories (including sub-categories)
  function getAllDirectPrompts(): NBPrompt[] {
    const all: NBPrompt[] = [];
    function collect(list: NBCategory[]) {
      for (const cat of list) {
        for (const p of cat.prompts ?? []) if (p.active && p.mode === 'direct') all.push(p);
        for (const g of cat.groups ?? []) for (const p of g.prompts) if (p.active && p.mode === 'direct') all.push(p);
        if (cat.children) collect(cat.children);
      }
    }
    collect(categories);
    return all;
  }

  // Toggle direct prompt selection
  function toggleDirectPrompt(p: NBPrompt) {
    setSelectedDirectPrompts((prev) => {
      const next = new Set(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.add(p.id);
      return next;
    });
  }

  // Indirect prompt handler — replaces chat text (not append)
  function pasteIndirectPrompt(p: NBPrompt) {
    setPromptText(p.content);
    textareaRef.current?.focus();
  }

  // Selection handlers
  function toggleSelection(url: string) {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
        setAttachedImageUrls((a) => a.filter((u) => u !== url));
      } else {
        next.add(url);
      }
      return next;
    });
  }

  function toggleAttachment(url: string) {
    setAttachedImageUrls((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url],
    );
  }

  function clearSelections() {
    setSelectedUrls(new Set());
    setAttachedImageUrls([]);
  }

  function attachSelected() {
    const urls = Array.from(selectedUrls);
    if (urls.length === 0) return;
    setAttachedImageUrls((prev) => {
      const combined = [...prev];
      for (const u of urls) if (!combined.includes(u)) combined.push(u);
      return combined;
    });
    toast({ title: 'Attached', description: `${urls.length} image(s) attached to prompt.` });
  }

  function toggleGroupCollapsed(groupId: number) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  async function addToProduct() {
    if (!productId || selectedUrls.size === 0) return;

    setAddingToProduct(true);
    try {
      // PHASE 2 — imageRole lets the ads-creator save under role='ad' so the
      // image joins the ad-creative pool without polluting the canonical
      // product_images['generated'] list used by Variants / Shopify push.
      const items = Array.from(selectedUrls).map((url) => ({
        url_or_key: url,
        prompt: '',
        role: imageRole,
        tool: 'nano-banana' as const,
      }));

      await addProductImagesBatch(productId, items);

      toast({
        title:
          imageRole === 'ad'
            ? 'Images added to Video Studio'
            : 'Images added to product',
        description: `${items.length} image(s) added successfully.`,
      });

      clearSelections();
      onImagesAdded?.();
    } catch (e: any) {
      console.error('Failed to add images to product', e);
      toast({
        title: 'Failed to add images',
        description: e?.message || 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setAddingToProduct(false);
    }
  }

  // PHASE 2 — Fetch editor projects for this product and open the picker so
  // the ads-creator can drop the selected Image Studio images directly onto
  // an existing timeline (or spin up a new project).
  async function openEditorPicker() {
    if (!productId || selectedUrls.size === 0) return;
    setLoadingEditorProjects(true);
    setEditorPickerOpen(true);
    try {
      const res: any = await api.get(`/editor/projects?product_id=${productId}`);
      const list = Array.isArray(res) ? res : res?.items || [];
      setEditorProjects(list);
    } catch (e: any) {
      console.error('Failed to load editor projects', e);
      toast({
        title: 'Failed to load projects',
        description: e?.message || 'Unknown error',
        variant: 'destructive',
      });
      setEditorPickerOpen(false);
    } finally {
      setLoadingEditorProjects(false);
    }
  }

  // Append the selected images as image elements on a project's timeline,
  // matching the shape EditorPanel uses when importing an image from disk
  // (type: 'image', sized to fit the 1080×1920 / 1080×1350 canvases). Each
  // image is laid end-to-end so nothing overlaps and the user can drag them
  // apart afterwards. Vertical + portrait coordinates are both set so the
  // dual-canvas Preview & Render pipeline works without extra steps.
  async function addToEditorProject(projectId: number | null) {
    if (!productId || selectedUrls.size === 0) return;
    setAddingToEditor(true);
    try {
      let resolvedProjectId = projectId;
      // If no project exists / user chose "Create new", spin one up first.
      if (!resolvedProjectId) {
        const created: any = await api.post('/editor/projects', {
          product_id: productId,
          name: `Ad ${editorProjects.length + 1}`,
        });
        resolvedProjectId = created?.id;
        if (!resolvedProjectId) throw new Error('Could not create editor project');
      }

      // Load the project so we can append to its existing elements list.
      const proj: any = await api.get(`/editor/projects/${resolvedProjectId}`);
      const elements: any[] = (() => {
        try {
          return JSON.parse(proj?.elements_json || '[]');
        } catch {
          return [];
        }
      })();
      const maxLayer = elements.reduce(
        (m, e) => Math.max(m, typeof e.layer === 'number' ? e.layer : 0),
        0,
      );
      const startAt = elements.length > 0
        ? Math.max(...elements.map((e: any) => (e.startTime || 0) + (e.duration || 5)))
        : 0;

      const offset = 40;
      const vW = 1080 - offset * 2;
      const vH = 1920 - offset * 2;
      const pW = 1080 - offset * 2;
      const pH = 1350 - offset * 2;

      const urls = Array.from(selectedUrls);
      urls.forEach((url, i) => {
        const id = `image-${Date.now()}-${i}`;
        elements.push({
          id,
          type: 'image',
          src: url,
          startTime: startAt + i * 5,
          duration: 5,
          zoomEffect: 'none',
          zoomIntensity: 0.2,
          opacity: 1,
          rotation: 0,
          layer: maxLayer + 1 + i,
          vertical: { x: offset, y: offset, width: vW, height: vH },
          portrait: { x: offset, y: offset, width: pW, height: pH },
          baseVertical: { width: vW, height: vH },
          basePortrait: { width: pW, height: pH },
        });
      });

      await api.patch(`/editor/projects/${resolvedProjectId}`, {
        elements_json: JSON.stringify(elements),
      });

      toast({
        title: 'Added to Editor',
        description: `${urls.length} image(s) appended to "${proj?.name || 'project'}".`,
      });
      setEditorPickerOpen(false);
      clearSelections();
    } catch (e: any) {
      console.error('Failed to add images to editor project', e);
      toast({
        title: 'Failed to add to Editor',
        description: e?.message || 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setAddingToEditor(false);
    }
  }

  function aspectClass(ar: string): string {
    switch (ar) {
      case '1:1': return 'aspect-[1/1]';
      case '9:16': return 'aspect-[9/16]';
      case '16:9': return 'aspect-[16/9]';
      case '4:3': return 'aspect-[4/3]';
      default: return 'aspect-[1/1]';
    }
  }

  const canSend = promptText.trim().length > 0 || selectedDirectPrompts.size > 0 || attachedImageUrls.length > 0;

  function renderPromptButton(p: NBPrompt) {
    const isDirectSelected = p.mode === 'direct' && selectedDirectPrompts.has(p.id);
    return (
      <button
        key={p.id}
        onClick={() => (p.mode === 'direct' ? toggleDirectPrompt(p) : pasteIndirectPrompt(p))}
        className={cn(
          'w-full px-3 py-2 rounded-lg text-left text-xs font-medium transition-colors flex items-center gap-2',
          isDirectSelected
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'bg-muted hover:bg-muted/80',
        )}
      >
        {p.mode === 'direct' ? (
          isDirectSelected ? <Check className="h-3 w-3 flex-shrink-0" /> : <Zap className="h-3 w-3 flex-shrink-0" />
        ) : (
          <ArrowUpLeft className="h-3 w-3 flex-shrink-0" />
        )}
        {p.attached_image_url && (
          <img
            src={p.attached_image_url}
            alt=""
            className={cn('w-4 h-4 rounded object-cover flex-shrink-0', isDirectSelected && 'ring-1 ring-white')}
          />
        )}
        <span className="flex-1 truncate">{p.button_label}</span>
      </button>
    );
  }

  if (loadingCategories) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Quota warning banner */}
      {quotaWarning && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Image generation unavailable</p>
            <p>{quotaWarning}</p>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-[220px_1fr_300px] gap-6">
      {/* LEFT — Categories + Groups rail */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold tracking-tight">Categories</h3>
        </div>

        {categories.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No categories configured. Chat works fine — categories are optional.
          </p>
        ) : (
          <div className="space-y-1">
            {categories.map((cat) => (
              <CategoryNavItem
                key={cat.id}
                cat={cat}
                depth={0}
                selectedCategoryId={selectedCategoryId}
                setSelectedCategoryId={setSelectedCategoryId}
                selectedDirectPrompts={selectedDirectPrompts}
                collapsedGroups={collapsedGroups}
                toggleGroupCollapsed={toggleGroupCollapsed}
                renderPromptButton={renderPromptButton}
                ungroupedPrompts={cat.id === selectedCategoryId ? ungroupedPrompts : undefined}
                groups={cat.id === selectedCategoryId ? groups : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* CENTER — Results feed + chat bar */}
      <div className="space-y-4">
        {/* Results header */}
        {batches.length > 0 && (
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-muted-foreground">
              {batches.reduce((n, b) => n + b.items.length, 0)} image(s) generated
            </p>
            {(userRole === 'admin' ||
              userRole === 'product-integrator' ||
              userRole === 'ads-creator') && (
              <button
                onClick={async () => {
                  if (!confirm('Clear all generated images for this product? This cannot be undone.')) return;
                  if (productId) {
                    try {
                      // PHASE 2 — pass scope so each role clears only their
                      // own studio history, not the other role's.
                      await clearStudioGenerations(productId, { scope });
                    } catch (e: any) {
                      console.error('Failed to clear generations', e);
                    }
                  }
                  setBatches([]);
                  toast({ title: 'Results cleared' });
                }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear results
              </button>
            )}
          </div>
        )}
        {/* Results feed */}
        <div className="min-h-[400px] max-h-[600px] overflow-y-auto overflow-x-visible rounded-2xl border border-black/5 bg-white shadow-sm p-4 space-y-4">
          {loadingGenerations && (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {batches.length === 0 && pendingGens.length === 0 && !loadingGenerations && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
              <ImageIcon className="h-12 w-12 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Type a prompt below, or click a category button on the left.
              </p>
            </div>
          )}

          {batches.map((batch, batchIdx) => {
            const priorCount = batches.slice(0, batchIdx).reduce((n, b) => n + b.items.length, 0);
            return (
              <div key={batch.id} className="space-y-2">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 overflow-visible p-1">
                  {batch.items.map((item, idx) => {
                    const isSelected = selectedUrls.has(item.url);
                    const globalIdx = priorCount + idx;
                    return (
                      <div
                        key={idx}
                        className={cn(
                          aspectClass(batch.ar),
                          'relative rounded-lg overflow-hidden bg-muted group cursor-zoom-in',
                          isSelected && 'ring-2 ring-primary ring-offset-2',
                        )}
                        onClick={() => setLightboxIndex(globalIdx)}
                      >
                        <img
                          src={item.url}
                          alt=""
                          className="w-full h-full object-cover transition-opacity group-hover:opacity-90"
                          loading="lazy"
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelection(item.url);
                          }}
                          className={cn(
                            'absolute top-2 right-2 rounded-full p-1.5 transition-colors',
                            isSelected
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-black/50 text-white hover:bg-black/70 opacity-0 group-hover:opacity-100',
                          )}
                          aria-label={isSelected ? 'Deselect' : 'Select'}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {pendingGens.map((pg) => (
            <div key={pg.id} className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground truncate max-w-[280px] px-1">
                <Loader2 className="h-3 w-3 animate-spin inline mr-1 align-text-bottom" />
                {pg.label.length > 50 ? pg.label.slice(0, 50) + '…' : pg.label}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {Array.from({ length: pg.count }).map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      aspectClass(pg.ar),
                      'rounded-lg bg-muted animate-pulse flex items-center justify-center'
                    )}
                  >
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Chat bar (sticky at bottom) */}
        <Card className="sticky bottom-4 shadow-lg overflow-hidden">
          {/* Product reference images — click to attach/detach */}
          {product?.images?.length > 0 && (
            <div className="px-3 pt-3 pb-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">
                Reference images <span className="normal-case font-normal">— click to attach to prompt</span>
              </p>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {product.images.map((img: any) => {
                  const isAttached = attachedImageUrls.includes(img.url_or_key);
                  return (
                    <button
                      key={img.id}
                      onClick={() => toggleAttachment(img.url_or_key)}
                      className={cn(
                        'relative w-11 h-11 rounded-lg overflow-hidden shrink-0 transition-all border-2',
                        isAttached
                          ? 'border-primary ring-1 ring-primary/30'
                          : 'border-transparent hover:border-muted-foreground/30',
                      )}
                      title={isAttached ? 'Click to detach' : 'Click to attach to prompt'}
                    >
                      <img src={img.url_or_key} alt="" className="w-full h-full object-cover" />
                      {isAttached && (
                        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                          <Check className="h-3 w-3 text-primary" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Selected direct prompts indicator */}
          {selectedDirectPrompts.size > 0 && (
            <div className="px-3 pt-2 pb-0 flex flex-wrap gap-1">
              {getAllDirectPrompts()
                .filter((p) => selectedDirectPrompts.has(p.id))
                .map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-medium"
                  >
                    <Zap className="h-2.5 w-2.5" />
                    {p.button_label}
                    <button
                      onClick={() => toggleDirectPrompt(p)}
                      className="ml-0.5 hover:text-destructive"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
            </div>
          )}

          <div className="p-3 flex items-end gap-2">
            {/* Attached image thumbnails */}
            {attachedImageUrls.length > 0 && (
              <div className="flex gap-1 flex-shrink-0 flex-wrap max-w-[180px]">
                {attachedImageUrls.map((url) => (
                  <div key={url} className="relative">
                    <img src={url} alt="" className="w-10 h-10 rounded-lg object-cover border" />
                    <button
                      onClick={() => toggleAttachment(url)}
                      className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600 transition-colors"
                      title="Detach image"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Textarea */}
            <Textarea
              ref={textareaRef}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder={attachedImageUrls.length > 0 ? 'Describe what to do with these image(s)...' : 'Describe what you want to generate...'}
              className="flex-1 resize-none min-h-[40px] max-h-[120px]"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend) handleSend();
                }
              }}
            />

            {/* FIX 25a — Upload local image(s) into the gallery. Hidden
                <input type=file> + a styled button that triggers it. The
                button sits to the LEFT of Send so it's easy to discover
                without crowding the textarea. Multiple selection is
                allowed for batch uploads. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleUploadFiles(e.target.files)}
            />
            <Button
              size="icon"
              variant="outline"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || !productId}
              className="flex-shrink-0"
              title="Upload image from your computer"
            >
              {uploading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Upload className="h-4 w-4" />}
            </Button>

            {/* Send button */}
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!canSend}
              className="flex-shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      </div>

      {/* RIGHT — My Selections + Settings */}
      <div className="space-y-4">
        {/* My selections tray */}
        <Card className="p-5 space-y-3 h-fit sticky top-20">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold tracking-tight">My selections</h4>
            <Badge variant="secondary">{selectedUrls.size}</Badge>
          </div>

          {selectedUrls.size === 0 ? (
            <p className="text-xs text-muted-foreground">
              No images selected yet. Click a generated image to select it.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                {Array.from(selectedUrls).map((url) => (
                  <button
                    key={url}
                    onClick={() => toggleSelection(url)}
                    className="relative aspect-square rounded-md overflow-hidden bg-muted hover:opacity-90 transition-opacity group"
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <div className="opacity-0 group-hover:opacity-100 bg-red-500 text-white rounded-full p-1">
                        <X className="h-3 w-3" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="space-y-1">
                <Button variant="outline" size="sm" onClick={attachSelected} className="w-full">
                  Attach to prompt
                </Button>
                {productId && (
                  <Button onClick={addToProduct} disabled={addingToProduct} size="sm" className="w-full">
                    {addingToProduct ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Adding...
                      </>
                    ) : (
                      <>
                        <Clapperboard className="h-4 w-4 mr-2" />
                        {addButtonLabel ||
                          (imageRole === 'ad' ? 'Add to Video Studio' : 'Add to Product')}
                      </>
                    )}
                  </Button>
                )}
                {/* PHASE 2 — Ads-creator can also drop selected images straight
                    onto an Editor project's timeline without having to pass
                    through Video Studio first. Only shown when imageRole='ad'
                    so the integrator's workspace stays simple. */}
                {productId && imageRole === 'ad' && (
                  <Button
                    variant="secondary"
                    onClick={openEditorPicker}
                    disabled={addingToEditor}
                    size="sm"
                    className="w-full"
                  >
                    {addingToEditor ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Adding...
                      </>
                    ) : (
                      <>
                        <Film className="h-4 w-4 mr-2" />
                        Add to Editor
                      </>
                    )}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={clearSelections} className="w-full">
                  Clear
                </Button>
              </div>
            </>
          )}
        </Card>

        {/* Settings */}
        <Card className="p-5 space-y-3">
          <h4 className="text-sm font-semibold tracking-tight">Settings</h4>

          <div className="space-y-2">
            <Label htmlFor="aspect" className="text-xs text-muted-foreground">
              Aspect Ratio
            </Label>
            <Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as AspectRatio)}>
              <SelectTrigger id="aspect" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1:1">1:1</SelectItem>
                <SelectItem value="9:16">9:16</SelectItem>
                <SelectItem value="16:9">16:9</SelectItem>
                <SelectItem value="4:3">4:3</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="quality" className="text-xs text-muted-foreground">
              Quality
            </Label>
            <Select value={quality} onValueChange={(v) => setQuality(v as Quality)}>
              <SelectTrigger id="quality" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1k">1k</SelectItem>
                <SelectItem value="2k">2k</SelectItem>
                <SelectItem value="4k">4k</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="count" className="text-xs text-muted-foreground">
              Count
            </Label>
            <Select value={String(count)} onValueChange={(v) => setCount(Number(v))}>
              <SelectTrigger id="count" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="4">4</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>
      </div>
      </div>

      {lightboxIndex !== null && allImages.length > 0 && (
        <ImageLightbox
          images={allImages}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}

      {/* PHASE 2 — Editor project picker (ads-creator flow only). Mirrors the
          Video Studio "Add to which project?" dialog so both tools feel the
          same: one click here pushes the selected Image Studio images to the
          chosen editor project's timeline. */}
      <Dialog open={editorPickerOpen} onOpenChange={setEditorPickerOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add to which project?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {loadingEditorProjects && (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loadingEditorProjects && editorProjects.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">
                No projects yet — create one below.
              </p>
            )}
            {editorProjects.map((p) => (
              <Button
                key={p.id}
                variant="outline"
                className="w-full justify-start"
                disabled={addingToEditor}
                onClick={() => addToEditorProject(p.id)}
              >
                <Film className="h-4 w-4 mr-2" />
                {p.name}
              </Button>
            ))}
            <Button
              variant="ghost"
              className="w-full justify-start text-muted-foreground"
              disabled={addingToEditor}
              onClick={() => addToEditorProject(null)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create new project
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
