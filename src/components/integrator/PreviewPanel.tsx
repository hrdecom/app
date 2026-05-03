import { useState, useEffect, useMemo } from 'react';
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
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Eye, ShoppingBag, GripHorizontal, X, ExternalLink, ImageOff } from 'lucide-react';
import { ImageLightbox } from '@/components/ui/ImageLightbox';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { reorderProductImages, deleteImage } from '@/lib/products';
import { getProductVariants } from '@/lib/product-variants';
import { PushChecklistDialog } from './PushChecklistDialog';
import type { Product } from '@/types/product';

// FIX 25f — Variant preview row shape returned by GET /products/:id/variants.
// The endpoint already returns options_json (flexible option array) but the
// shared ProductVariant type doesn't include it; we extend locally.
interface PreviewVariantRow {
  id: number;
  initial: string | null;
  color: string | null;
  label?: string | null;
  image_id: number | null;
  image_url: string | null;
  options_json?: string | null;
}

const COLOR_LABELS: Record<string, string> = {
  silver: 'Silver',
  gold: 'Gold',
  'rose-gold': 'Rose Gold',
};

// Reconstruct the merchant's option set for one variant. Prefer
// options_json when present (the new flexible format saved by
// VariantsPanel); fall back to the legacy color + initial columns so
// older products still render something useful.
function variantOptions(v: PreviewVariantRow): { name: string; value: string }[] {
  if (v.options_json) {
    try {
      const parsed = JSON.parse(v.options_json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .filter((o: any) => o && typeof o.name === 'string' && o.value != null && o.value !== '')
          .map((o: any) => ({ name: String(o.name), value: String(o.value) }));
      }
    } catch {
      /* fall through */
    }
  }
  const out: { name: string; value: string }[] = [];
  if (v.color) {
    out.push({
      name: 'Color',
      value: COLOR_LABELS[v.color] || (v.color.charAt(0).toUpperCase() + v.color.slice(1).replace(/-/g, ' ')),
    });
  }
  if (v.initial) {
    out.push({ name: 'Initial', value: v.initial });
  }
  return out;
}

interface PreviewPanelProps {
  product: Product;
  onImagesReordered: () => void;
  onProductChanged?: () => void;
}

interface SortableImageProps {
  id: number;
  url: string;
  isHero: boolean;
  onClick: () => void;
  onDelete: () => void;
}

function SortableImage({ id, url, isHero, onClick, onDelete }: SortableImageProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative aspect-square rounded-md overflow-hidden bg-muted cursor-pointer group',
        isDragging && 'opacity-50 z-50',
        isHero && 'ring-2 ring-primary ring-offset-2'
      )}
    >
      <img
        src={url}
        alt=""
        className="w-full h-full object-cover"
        loading="lazy"
        onClick={onClick}
      />
      <div
        {...listeners}
        {...attributes}
        className="absolute top-1 right-1 bg-black/50 backdrop-blur-sm p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
      >
        <GripHorizontal className="h-3 w-3 text-white" />
      </div>
      {isHero && (
        <div className="absolute top-1 left-1 bg-primary text-primary-foreground px-2 py-0.5 rounded-md text-xs font-medium">
          Hero
        </div>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (confirm('Delete this image from the product?')) onDelete();
        }}
        className="absolute bottom-1 right-1 rounded-full bg-black/60 text-white p-1 opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all"
        aria-label="Delete image"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function PreviewPanel({ product, onImagesReordered, onProductChanged }: PreviewPanelProps) {
  const { toast } = useToast();
  const [heroIndex, setHeroIndex] = useState(0);
  const [localImages, setLocalImages] = useState(product.images);
  const [reordering, setReordering] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showPushDialog, setShowPushDialog] = useState(false);
  const [variantPrice, setVariantPrice] = useState<string | null>(null);
  const [productTags, setProductTags] = useState<string[]>([]);
  // FIX 25f — variant preview state. We load the saved variants once on
  // mount, derive the option name → value map, and let the merchant
  // pick a combination to see the assigned image.
  const [variantRows, setVariantRows] = useState<PreviewVariantRow[]>([]);
  const [variantSelections, setVariantSelections] = useState<Record<string, string>>({});

  // FIX 25f — load saved variants for this product so the preview can
  // show the merchant which image is currently assigned to each option
  // combination. Silent on failure: variant data is optional in
  // Preview, the rest of the panel still works without it.
  useEffect(() => {
    let cancelled = false;
    getProductVariants(product.id)
      .then((res) => {
        if (cancelled) return;
        setVariantRows((res.variants as PreviewVariantRow[]) || []);
      })
      .catch((e) => {
        // Most likely the product just doesn't have variants set up yet.
        console.warn('[PreviewPanel] variant load failed:', e?.message);
      });
    return () => { cancelled = true; };
  }, [product.id]);

  // Derive { optionName: [unique values…] } across all saved variants.
  // We preserve the order in which option names appear (so "Color" comes
  // before "Size" if that's how the merchant defined them) and dedupe
  // values per name.
  const optionMap = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, string[]>();
    for (const v of variantRows) {
      for (const opt of variantOptions(v)) {
        if (!map.has(opt.name)) {
          map.set(opt.name, []);
          order.push(opt.name);
        }
        const arr = map.get(opt.name)!;
        if (!arr.includes(opt.value)) arr.push(opt.value);
      }
    }
    return order.map((name) => ({ name, values: map.get(name) || [] }));
  }, [variantRows]);

  // Initialise the selection to the first value of every option once
  // variants load. Without this the merchant has to manually pick every
  // dropdown to see anything.
  useEffect(() => {
    if (optionMap.length === 0) return;
    setVariantSelections((prev) => {
      const next = { ...prev };
      let touched = false;
      for (const opt of optionMap) {
        if (!next[opt.name] && opt.values.length > 0) {
          next[opt.name] = opt.values[0];
          touched = true;
        }
      }
      return touched ? next : prev;
    });
  }, [optionMap]);

  // Find the variant whose options match every current selection. If no
  // exact match exists (e.g. the merchant hasn't created a row for that
  // combo) we fall back to a partial-match scoring: rows that match the
  // most options win, ties broken by the first hit.
  const matchedVariant = useMemo(() => {
    if (variantRows.length === 0 || optionMap.length === 0) return null;
    let bestRow: PreviewVariantRow | null = null;
    let bestScore = -1;
    for (const v of variantRows) {
      const opts = variantOptions(v);
      let score = 0;
      let exactCount = 0;
      for (const opt of opts) {
        if (variantSelections[opt.name] === opt.value) {
          score += 1;
          exactCount += 1;
        }
      }
      // Prefer a row that matches every selected option exactly, then
      // by partial-match count.
      const isFullMatch = optionMap.every((om) =>
        opts.some((o) => o.name === om.name && o.value === variantSelections[om.name]),
      );
      const finalScore = isFullMatch ? 1000 + score : score;
      if (finalScore > bestScore && exactCount > 0) {
        bestScore = finalScore;
        bestRow = v;
      }
    }
    return bestRow;
  }, [variantRows, variantSelections, optionMap]);

  useEffect(() => {
    // Read the price that was actually pushed to Shopify (saved on products.shopify_price after push).
    const pushed = (product as any).shopify_price;
    if (pushed && parseFloat(String(pushed)) > 0) {
      setVariantPrice(String(pushed));
    } else {
      setVariantPrice(null);
    }
    // Build tags from product type + collection
    import('@/lib/claude').then(({ listProductTypes, listCollections }) => {
      Promise.all([listProductTypes().catch(() => []), listCollections().catch(() => [])]).then(([types, cols]) => {
        const tags: string[] = [];
        const pt = (types as any[]).find((t: any) => t.slug === (product as any).product_type_slug);
        if (pt?.shopify_tags_list) tags.push(...pt.shopify_tags_list);
        else if (pt?.shopify_tags) tags.push(...pt.shopify_tags.split(',').map((t: string) => t.trim()).filter(Boolean));
        if (pt?.default_tags_list) tags.push(...pt.default_tags_list);
        if ((product as any).collection) {
          const col = (cols as any[]).find((c: any) => c.name === (product as any).collection);
          if (col?.shopify_tags_list) tags.push(...col.shopify_tags_list);
          else if (col?.shopify_tags) tags.push(...col.shopify_tags.split(',').map((t: string) => t.trim()).filter(Boolean));
        }
        setProductTags([...new Set(tags)]);
      });
    });
  }, [product.id]);

  async function handleDelete(imageId: number) {
    const idx = localImages.findIndex((i) => i.id === imageId);
    if (idx < 0) return;
    const previous = localImages;
    setLocalImages(localImages.filter((i) => i.id !== imageId));
    if (heroIndex >= idx && heroIndex > 0) setHeroIndex(heroIndex - 1);
    try {
      await deleteImage(imageId);
      toast({ title: 'Image deleted' });
      onImagesReordered();
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e?.message, variant: 'destructive' });
      setLocalImages(previous);
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = localImages.findIndex((img) => img.id === active.id);
    const newIndex = localImages.findIndex((img) => img.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(localImages, oldIndex, newIndex);
    const previousImages = localImages;

    // Optimistic update
    setLocalImages(reordered);

    // Adjust hero index if needed
    if (heroIndex === oldIndex) {
      setHeroIndex(newIndex);
    } else if (heroIndex > oldIndex && heroIndex <= newIndex) {
      setHeroIndex(heroIndex - 1);
    } else if (heroIndex < oldIndex && heroIndex >= newIndex) {
      setHeroIndex(heroIndex + 1);
    }

    setReordering(true);
    try {
      const ids = reordered.map((img) => img.id);
      await reorderProductImages(product.id, ids);
      toast({ title: 'Images reordered' });
      onImagesReordered();
    } catch (e: any) {
      console.error('Failed to reorder images', e);
      toast({
        title: 'Reorder failed',
        description: e?.message || 'Unknown error',
        variant: 'destructive',
      });
      // Revert
      setLocalImages(previousImages);
    } finally {
      setReordering(false);
    }
  }

  const heroImage = localImages[heroIndex]?.url_or_key || null;

  return (
    <div className="grid md:grid-cols-2 gap-8">
      {/* LEFT — Images */}
      <div className="space-y-4">
        {/* Hero */}
        <Card
          className="aspect-square rounded-2xl overflow-hidden shadow-sm border-black/5 cursor-zoom-in"
          onClick={() => heroImage && setLightboxIndex(heroIndex)}
        >
          {heroImage ? (
            <img
              src={heroImage}
              alt={product.title || 'Product'}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-muted">
              <Eye className="h-12 w-12 text-muted-foreground/30" />
            </div>
          )}
        </Card>

        {/* Thumbnail carousel */}
        {localImages.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Gallery {reordering && '(saving...)'}
            </p>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={localImages.map((img) => img.id)}
                strategy={horizontalListSortingStrategy}
              >
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                  {localImages.map((img, idx) => (
                    <SortableImage
                      key={img.id}
                      id={img.id}
                      url={img.url_or_key}
                      isHero={idx === heroIndex}
                      onClick={() => setLightboxIndex(idx)}
                      onDelete={() => handleDelete(img.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}
      </div>

      {/* RIGHT — Product details */}
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            {product.title || 'Untitled product'}
          </h2>
          {product.shopify_url && (
            <a
              href={product.shopify_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline break-all"
              title="Open storefront page"
            >
              {product.shopify_url.replace(/^https?:\/\//, '')}
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          )}
        </div>

        {/* Price + status */}
        <div className="flex items-center gap-3">
          <p className="text-2xl font-bold">
            {variantPrice && parseFloat(variantPrice) > 0
              ? `€${parseFloat(variantPrice).toFixed(2)}`
              : ''}
          </p>
          {product.status && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              product.status === 'pushed_to_shopify' ? 'bg-teal-100 text-teal-800' : 'bg-gray-100 text-gray-700'
            }`}>
              {product.status === 'pushed_to_shopify' ? 'Shopify Ready' : product.status}
            </span>
          )}
        </div>

        {/* Tags */}
        {productTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {productTags.map((tag, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-700">{tag}</span>
            ))}
          </div>
        )}

        <div className="prose prose-sm max-w-none">
          {product.description ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {product.description}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">No description yet.</p>
          )}
        </div>

        {/* Variant count */}
        <Card className="p-4 bg-muted/50 border-muted">
          <p className="text-xs text-muted-foreground">
            {localImages.length} image{localImages.length !== 1 ? 's' : ''} configured
            {variantRows.length > 0 && ` · ${variantRows.length} variant${variantRows.length === 1 ? '' : 's'}`}
          </p>
        </Card>

        {/* FIX 25f — Variant preview. Renders one dropdown per saved
            option (Color, Size, …). Picking a combination shows the
            image currently assigned to the matching variant. Hidden
            entirely when the product has no variants. */}
        {optionMap.length > 0 && (
          <Card className="p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Variant preview</h3>
              <p className="text-xs text-muted-foreground">
                Pick a combination to see which image is attributed to each variant.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {optionMap.map((opt) => (
                <div key={opt.name} className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">{opt.name}</label>
                  <Select
                    value={variantSelections[opt.name] || ''}
                    onValueChange={(v) =>
                      setVariantSelections((prev) => ({ ...prev, [opt.name]: v }))
                    }
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder={`Pick ${opt.name.toLowerCase()}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {opt.values.map((val) => (
                        <SelectItem key={val} value={val}>{val}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {/* Assigned image preview. We always render the box (so the
                section doesn't jump when the merchant changes options)
                and swap content based on whether a variant matched and
                whether it has an image. */}
            <div className="aspect-square w-full max-w-xs mx-auto rounded-lg overflow-hidden bg-muted/40 border border-muted flex items-center justify-center">
              {matchedVariant?.image_url ? (
                <img
                  src={matchedVariant.image_url}
                  alt={matchedVariant.label || ''}
                  className="w-full h-full object-cover cursor-zoom-in"
                  onClick={() => {
                    if (!matchedVariant?.image_url) return;
                    const idx = localImages.findIndex((i) => i.url_or_key === matchedVariant.image_url);
                    if (idx >= 0) setLightboxIndex(idx);
                  }}
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-center text-muted-foreground p-4">
                  <ImageOff className="h-8 w-8 mb-2 opacity-40" />
                  <p className="text-xs">
                    {matchedVariant
                      ? 'No image assigned to this variant yet.'
                      : 'No variant matches this combination.'}
                  </p>
                </div>
              )}
            </div>

            {matchedVariant && (
              <p className="text-[11px] text-muted-foreground text-center">
                Variant: <span className="font-medium text-foreground">{matchedVariant.label || `#${matchedVariant.id}`}</span>
              </p>
            )}
          </Card>
        )}

        <div className="relative">
          <Button
            size="lg"
            className="w-full"
            onClick={() => setShowPushDialog(true)}
          >
            <ShoppingBag className="h-5 w-5 mr-2" />
            {product.status === 'pushed_to_shopify' ? 'Update on Shopify' : 'Push to Shopify'}
          </Button>
        </div>
      </div>

      {lightboxIndex !== null && localImages.length > 0 && (
        <ImageLightbox
          images={localImages.map((i) => ({ url: i.url_or_key }))}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={(i) => {
            setLightboxIndex(i);
            setHeroIndex(i);
          }}
        />
      )}

      <PushChecklistDialog
        open={showPushDialog}
        onOpenChange={setShowPushDialog}
        product={product}
        intent={product.status === 'pushed_to_shopify' ? 'update' : 'push'}
        onSuccess={() => {
          setShowPushDialog(false);
          if (onProductChanged) onProductChanged();
        }}
      />
    </div>
  );
}
