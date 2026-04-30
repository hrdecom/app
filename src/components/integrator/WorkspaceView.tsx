import { useEffect, useState, useRef } from 'react';
import {
  ArrowLeft,
  ExternalLink,
  Info,
  Layers,
  Loader2,
  Package,
  Sparkles,
  Wand2,
  Image as ImageIcon,
  Eye,
  X,
  Check,
  Pencil,
  Plus,
  Trash2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import {
  getProduct,
  transitionProduct,
  updateProduct,
  deleteImage,
} from '@/lib/products';
import {
  getProductTypes,
  generateTitle,
  acceptTitle,
  generateDescription,
  getClaudeSettings,
  type ProductType,
  type TitleSuggestion,
  type GenerateDescriptionResponse,
} from '@/lib/claude-ai';
import {
  CATEGORIES,
  LINK_SOURCES,
  STATUS_META,
  type Product,
  type ProductCategory,
} from '@/types/product';
import { useAuth } from '@/lib/auth';
import { NanoBananaStudio, type NBBatch } from './NanoBananaStudio';
import { PreviewPanel } from './PreviewPanel';
import { VariantsPanel } from './VariantsPanel';
import { PushChecklistDialog } from './PushChecklistDialog';
import { PersonalizerPanel } from '@/components/admin/personalizer/PersonalizerPanel';

interface WorkspaceViewProps {
  productId: number;
  onUpdated: () => void;
  onBack: () => void;
}

type TabKey = 'brief' | 'claude' | 'nano' | 'variants' | 'preview' | 'personalizer';

const BASE_TABS: { key: TabKey; label: string; icon: any }[] = [
  { key: 'brief', label: 'Brief', icon: Package },
  { key: 'claude', label: 'Copywriting Tool', icon: Wand2 },
  { key: 'nano', label: 'Image Studio', icon: Sparkles },
  { key: 'variants', label: 'Variants', icon: Layers },
  { key: 'preview', label: 'Preview', icon: Eye },
];


export function WorkspaceView({ productId, onUpdated, onBack }: WorkspaceViewProps) {
  const { toast } = useToast();
  const { user: authUser } = useAuth();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('brief');

  // Panel drafts (live in component so switching tabs preserves input)
  const [titleDraft, setTitleDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [savingDesc, setSavingDesc] = useState(false);

  // Lightbox
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Action state
  const [transitioning, setTransitioning] = useState(false);
  const [showPushDialog, setShowPushDialog] = useState(false);
  const [pushIntent, setPushIntent] = useState<'push' | 'update'>('push');

  // Nano Banana Studio state — lifted here so it survives tab switches.
  // Cleared only on explicit user action ("Clear results") or page refresh.
  const [nbBatches, setNbBatches] = useState<NBBatch[]>([]);
  const [nbSelectedUrls, setNbSelectedUrls] = useState<Set<string>>(new Set());

  // Copywriting Tool: whether generate has been clicked at least once.
  // Lives in parent so it survives child re-renders from onUpdated().
  const [claudeGenerated, setClaudeGenerated] = useState(false);
  // Lifted description state — survives ClaudePanel re-renders from onUpdated()/title accept.
  const [claudePara1, setClaudePara1] = useState('');
  const [claudePara2, setClaudePara2] = useState('');
  const [claudeBullets, setClaudeBullets] = useState<string[]>([]);
  const [nbAttachedImageUrls, setNbAttachedImageUrls] = useState<string[]>([]);

  async function loadProduct() {
    setLoading(true);
    try {
      const p = await getProduct(productId);
      setProduct(p);
      setTitleDraft(p.title ?? '');
      setDescDraft(p.description ?? '');
    } catch (e: any) {
      console.error('Failed to load product', e);
      toast({
        title: 'Failed to load product',
        description: e?.message || 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setTab('brief');
    // Reset Nano Banana state when switching to a different product
    // so generated images from one product don't leak into another.
    setNbBatches([]);
    setClaudeGenerated(false);
    setClaudePara1('');
    setClaudePara2('');
    setClaudeBullets([]);
    setNbSelectedUrls(new Set());
    setNbAttachedImageUrls([]);
    loadProduct().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const tabsLocked = product?.status === 'validated_todo';

  // Build tab list: include Personalizer tab only when product supports personalization
  const TABS = product?.supports_personalization
    ? [...BASE_TABS, { key: 'personalizer' as TabKey, label: 'Personalizer', icon: Layers }]
    : BASE_TABS;

  async function handleWorkOnIt() {
    if (!product) return;
    setTransitioning(true);
    try {
      const updated = await transitionProduct(product.id, { to: 'in_progress' });
      setProduct((prev) => (prev ? { ...prev, ...updated } : prev));
      toast({ title: "You're now working on this product." });
      onUpdated();
    } catch (e: any) {
      const msg: string = e?.message || '';
      if (/already|claimed|forbid/i.test(msg)) {
        toast({
          title: 'Already claimed',
          description: 'This task was already claimed by someone else.',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Could not start task', description: msg, variant: 'destructive' });
      }
      onUpdated();
    } finally {
      setTransitioning(false);
    }
  }

  function handlePushToShopify() {
    setPushIntent('push');
    setShowPushDialog(true);
  }

  function handleUpdateOnShopify() {
    setPushIntent('update');
    setShowPushDialog(true);
  }

  async function saveTitle() {
    if (!product) return;
    setSavingTitle(true);
    try {
      await updateProduct(product.id, { title: titleDraft });
      toast({ title: 'Title saved' });
      onUpdated();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message, variant: 'destructive' });
    } finally {
      setSavingTitle(false);
    }
  }

  async function saveDescription() {
    if (!product) return;
    setSavingDesc(true);
    try {
      await updateProduct(product.id, { description: descDraft });
      toast({ title: 'Description saved' });
      onUpdated();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message, variant: 'destructive' });
    } finally {
      setSavingDesc(false);
    }
  }

  if (loading || !product) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const sourceLinks = product.links.filter((l) => (l.kind ?? 'source') === 'source');
  const competitorLinks = product.links.filter((l) => l.kind === 'competitor');

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="md:hidden">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-xl md:text-2xl font-semibold tracking-tight flex-1 min-w-0 truncate">
          {product.title || 'Untitled product'}
        </h2>
        <Badge className={STATUS_META[product.status].className}>
          {STATUS_META[product.status].label}
        </Badge>

        {product.status === 'validated_todo' && (
          <Button onClick={handleWorkOnIt} disabled={transitioning}>
            {transitioning ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting…
              </>
            ) : (
              'Work on it'
            )}
          </Button>
        )}

        {product.status === 'in_progress' && (
          <Button onClick={handlePushToShopify}>Push to Shopify</Button>
        )}

        {product.status === 'pushed_to_shopify' && (
          <>
            <Button onClick={handleUpdateOnShopify}>Update on Shopify</Button>
            {(() => {
              const adminHref = product.shopify_admin_url || null;
              return (
                <Button
                  variant="outline"
                  asChild={!!adminHref}
                  disabled={!adminHref}
                  title="Open in Shopify admin editor"
                >
                  {adminHref ? (
                    <a href={adminHref} target="_blank" rel="noopener noreferrer">
                      View on Shopify <ExternalLink className="h-4 w-4 ml-2" />
                    </a>
                  ) : (
                    <>Shopify Ready</>
                  )}
                </Button>
              );
            })()}
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="sticky top-0 md:-mx-8 md:px-8 bg-gray-50/95 backdrop-blur z-10 border-b border-gray-200">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const disabled = tabsLocked && t.key !== 'brief' && t.key !== 'preview';
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => !disabled && setTab(t.key)}
                disabled={disabled}
                title={disabled ? "Click 'Work on it' to unlock" : undefined}
                className={cn(
                  'relative px-4 py-3 text-sm font-medium whitespace-nowrap flex items-center gap-2',
                  'border-b-2 -mb-px transition-colors',
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                  disabled && 'opacity-50 cursor-not-allowed',
                )}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Panels */}
      {tab === 'brief' && (
        <BriefPanel
          product={product}
          sourceLinks={sourceLinks}
          competitorLinks={competitorLinks}
          onOpenImage={setLightbox}
          onDeleteImage={async (imageId) => {
            try {
              await deleteImage(imageId);
              toast({ title: 'Image removed' });
              loadProduct();
            } catch (e: any) {
              toast({ title: 'Delete failed', description: e?.message, variant: 'destructive' });
            }
          }}
        />
      )}

      {tab === 'claude' && (
        <ClaudePanel
          product={product}
          hasEverGenerated={claudeGenerated}
          onFirstGenerate={() => setClaudeGenerated(true)}
          liftedPara1={claudePara1}
          liftedPara2={claudePara2}
          liftedBullets={claudeBullets}
          setLiftedPara1={setClaudePara1}
          setLiftedPara2={setClaudePara2}
          setLiftedBullets={setClaudeBullets}
          onUpdated={() => {
            loadProduct();
            onUpdated();
          }}
        />
      )}

      {tab === 'nano' && (
        <NanoBananaStudio
          productId={product.id}
          product={product}
          productCategorySlug={product.category ?? undefined}
          userRole={authUser?.role}
          // PHASE 2 — explicit scope so the integrator Image Studio doesn't
          // accidentally share rows with the ads-creator side (same default,
          // but spelled out for clarity).
          scope="integrator"
          imageRole="generated"
          onImagesAdded={loadProduct}
          batches={nbBatches}
          setBatches={setNbBatches}
          selectedUrls={nbSelectedUrls}
          setSelectedUrls={setNbSelectedUrls}
          attachedImageUrls={nbAttachedImageUrls}
          setAttachedImageUrls={setNbAttachedImageUrls}
        />
      )}

      {tab === 'variants' && <VariantsPanel product={product} onUpdated={loadProduct} />}

      {tab === 'preview' && (
        <PreviewPanel
          product={product}
          onImagesReordered={loadProduct}
          onProductChanged={loadProduct}
        />
      )}

      {tab === 'personalizer' && product.supports_personalization && (
        <PersonalizerPanel
          productId={product.id}
          baseImageUrl={product.first_image_url ?? null}
          shopifyHandle={product.shopify_handle ?? null}
        />
      )}

      {/* Lightbox */}
      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden bg-black">
          {lightbox && (
            <img src={lightbox} alt="" className="w-full h-auto max-h-[80vh] object-contain" />
          )}
        </DialogContent>
      </Dialog>

      {/* Push to Shopify dialog */}
      <PushChecklistDialog
        open={showPushDialog}
        onOpenChange={setShowPushDialog}
        product={product}
        intent={pushIntent}
        onSuccess={() => {
          loadProduct();
          onUpdated();
        }}
      />
    </div>
  );
}

/* ------------------------------ Brief ------------------------------ */

function BriefPanel({
  product,
  sourceLinks,
  competitorLinks,
  onOpenImage,
  onDeleteImage,
}: {
  product: Product;
  sourceLinks: Product['links'];
  competitorLinks: Product['links'];
  onOpenImage: (url: string) => void;
  onDeleteImage: (imageId: number) => void | Promise<void>;
}) {
  const relativeTime = (date: string) => {
    const diffMs = Date.now() - new Date(date).getTime();
    const d = Math.floor(diffMs / 86400000);
    const h = Math.floor(diffMs / 3600000);
    const m = Math.floor(diffMs / 60000);
    if (d > 0) return `${d}d ago`;
    if (h > 0) return `${h}h ago`;
    if (m > 0) return `${m}m ago`;
    return 'just now';
  };

  const LinkChip = ({ link, tone }: { link: Product['links'][number]; tone: 'source' | 'competitor' }) => (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors',
        tone === 'source'
          ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
          : 'bg-amber-50 text-amber-700 hover:bg-amber-100',
      )}
    >
      {LINK_SOURCES[link.source]}
      <ExternalLink className="h-3 w-3" />
    </a>
  );

  // Extract admin notes from workflow events
  const adminNotes = (product.workflow_events || [])
    .filter((e: any) => e.note && e.note.trim() && e.to_status !== 'draft')
    .map((e: any) => ({
      note: e.note,
      from: e.from_status,
      to: e.to_status,
      actor: e.actor_name || 'Admin',
      time: e.created_at,
    }));

  return (
    <div className="space-y-6">
      {/* Admin notes */}
      {adminNotes.length > 0 && (
        <Card className="p-4 space-y-2 border-blue-200 bg-blue-50/50">
          <Label className="text-xs uppercase tracking-wide text-blue-700">Admin notes</Label>
          {adminNotes.map((n: any, i: number) => (
            <div key={i} className="text-sm text-blue-900">
              <span className="font-medium">{n.actor}</span>
              <span className="text-blue-600 text-xs ml-2">{relativeTime(n.time)}</span>
              <p className="mt-0.5">{n.note}</p>
            </div>
          ))}
        </Card>
      )}

      <Card className="p-5 space-y-4">
        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Original title</Label>
          <p className="text-lg font-medium tracking-tight mt-1">{product.title}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Submitted by {product.creator_name || product.creator_email || 'unknown'} •{' '}
          {relativeTime(product.created_at)}
        </p>

        <div className="space-y-2">
          {sourceLinks.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Source Links</p>
              <div className="flex flex-wrap gap-2">
                {sourceLinks.map((l) => (
                  <LinkChip key={l.id} link={l} tone="source" />
                ))}
              </div>
            </div>
          )}
          {competitorLinks.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Competitor Links</p>
              <div className="flex flex-wrap gap-2">
                {competitorLinks.map((l) => (
                  <LinkChip key={l.id} link={l} tone="competitor" />
                ))}
              </div>
            </div>
          )}
          {sourceLinks.length === 0 && competitorLinks.length === 0 && (
            <p className="text-sm text-muted-foreground">No links provided.</p>
          )}
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold tracking-tight">Selected images</h3>
        </div>
        {product.images.length === 0 ? (
          <p className="text-sm text-muted-foreground">No images yet.</p>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {product.images.map((img) => (
              <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden bg-muted group">
                <button
                  onClick={() => onOpenImage(img.url_or_key)}
                  className="w-full h-full cursor-zoom-in"
                  aria-label="Open image"
                >
                  <img src={img.url_or_key} alt="" className="w-full h-full object-cover" loading="lazy" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Remove this image from the product?')) onDeleteImage(img.id);
                  }}
                  className="absolute top-1.5 right-1.5 rounded-full bg-black/60 text-white p-1 opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all"
                  aria-label="Delete image"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------ Claude ------------------------------ */

function ClaudePanel({
  product,
  onUpdated,
  hasEverGenerated,
  onFirstGenerate,
  liftedPara1,
  liftedPara2,
  liftedBullets,
  setLiftedPara1,
  setLiftedPara2,
  setLiftedBullets,
}: {
  product: Product;
  onUpdated: () => void;
  hasEverGenerated: boolean;
  onFirstGenerate: () => void;
  liftedPara1: string;
  liftedPara2: string;
  liftedBullets: string[];
  setLiftedPara1: (v: string) => void;
  setLiftedPara2: (v: string) => void;
  setLiftedBullets: (v: string[]) => void;
}) {
  const { toast } = useToast();

  // Product types + collections — single selector at top
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [collections, setCollections] = useState<any[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [selectedProductType, setSelectedProductType] = useState(product.product_type_slug ?? '');
  const [selectedCollection, setSelectedCollection] = useState(product.collection ?? '');
  const [savingMeta, setSavingMeta] = useState(false);

  // hasEverGenerated + onFirstGenerate come from parent WorkspaceView props.
  // They survive child re-renders because the state lives in the parent.

  // Title state
  const [generatingTitle, setGeneratingTitle] = useState(false);
  const [titleSuggestions, setTitleSuggestions] = useState<TitleSuggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<TitleSuggestion | null>(null);
  const [acceptingTitle, setAcceptingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleEditValue, setTitleEditValue] = useState(product.title ?? '');

  // Description state
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [descResult, setDescResult] = useState<GenerateDescriptionResponse | null>(null);
  const [descError, setDescError] = useState<string | null>(null);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descEditValue, setDescEditValue] = useState(product.description ?? '');
  const [maxChars, setMaxChars] = useState(180);

  // Editable description fields
  // para1/para2/bullets are LIFTED to parent — use props directly.
  const para1 = liftedPara1;
  const setPara1 = setLiftedPara1;
  const para2 = liftedPara2;
  const setPara2 = setLiftedPara2;
  const bullets = liftedBullets;
  const setBullets = setLiftedBullets;

  // Load product types, collections, and settings
  useEffect(() => {
    import('@/lib/claude').then(({ listCollections }) => {
      Promise.all([
        getProductTypes().catch(() => [] as ProductType[]),
        getClaudeSettings().catch(() => ({ max_chars: 180 })),
        listCollections().catch(() => []),
      ]).then(([types, settings, cols]) => {
        const arr: ProductType[] = Array.isArray(types)
          ? types
          : Array.isArray((types as any)?.items)
          ? (types as any).items
          : [];
        setProductTypes(arr);
        const colArr = Array.isArray(cols)
          ? cols
          : Array.isArray((cols as any)?.items)
          ? (cols as any).items
          : [];
        setCollections(colArr);
        setMaxChars((settings as any)?.max_chars ?? (settings as any)?.description_max_chars ?? 180);
        setLoadingTypes(false);
      });
    });
  }, []);

  // Sync with product changes
  useEffect(() => {
    setSelectedProductType(product.product_type_slug ?? '');
    setSelectedCollection(product.collection ?? '');
    setTitleEditValue(product.title ?? '');
    setDescEditValue(product.description ?? '');
  }, [product]);

  // Save product type + collection to D1 when changed
  async function handleProductTypeSave(slug: string) {
    setSelectedProductType(slug);
    setSavingMeta(true);
    try {
      await updateProduct(product.id, { product_type_slug: slug } as any);
      onUpdated();
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message, variant: 'destructive' });
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleCollectionSave(name: string) {
    setSelectedCollection(name);
    setSavingMeta(true);
    try {
      await updateProduct(product.id, { collection: name || null } as any);
      onUpdated();
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message, variant: 'destructive' });
    } finally {
      setSavingMeta(false);
    }
  }

  const firstImage = product.images[0]?.url_or_key;

  async function handleGenerateTitle() {
    onFirstGenerate();
    setTitleError(null);
    setGeneratingTitle(true);
    setTitleSuggestions([]);
    setSelectedSuggestion(null);
    try {
      const response = await generateTitle(product.id, selectedProductType || undefined);
      setTitleSuggestions(response.suggestions);
      if (response.product_type_options?.length > 0) {
        setProductTypes(response.product_type_options);
      }
    } catch (e: any) {
      const msg = e?.message || 'Failed to generate titles';
      if (msg.includes('image')) {
        setTitleError(msg);
      } else {
        toast({ title: 'Error', description: msg, variant: 'destructive' });
      }
    } finally {
      setGeneratingTitle(false);
    }
  }

  async function handleAcceptTitle(suggestion: TitleSuggestion) {
    setAcceptingTitle(true);
    setSelectedSuggestion(suggestion);
    try {
      const slug =
        selectedProductType ||
        productTypes?.find((pt) => pt.name === suggestion.product_type)?.slug ||
        suggestion.product_type;
      await acceptTitle(
        product.id,
        suggestion.title,
        slug,
        suggestion.collection,
        suggestion.name_part,
      );
      toast({ title: 'Title saved — generating description…' });
      setTitleSuggestions([]);
      onUpdated();
      // Auto-trigger description generation with the newly accepted title
      setTimeout(() => handleGenerateDescription(), 300);
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message, variant: 'destructive' });
    } finally {
      setAcceptingTitle(false);
    }
  }

  async function handleSaveTitle() {
    try {
      await updateProduct(product.id, { title: titleEditValue });
      toast({ title: 'Title saved' });
      setEditingTitle(false);
      onUpdated();
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message, variant: 'destructive' });
    }
  }

  async function handleGenerateDescription() {
    onFirstGenerate();
    setDescError(null);
    setGeneratingDesc(true);
    setDescResult(null);
    try {
      const response = await generateDescription(product.id, selectedProductType || undefined);
      console.log('[ClaudePanel] description response:', JSON.stringify(response));
      console.log('[ClaudePanel] bullets raw value:', response.bullets);
      console.log('[ClaudePanel] bullets type:', typeof response.bullets);
      console.log('[ClaudePanel] warning:', (response as any).warning);
      setDescResult(response);
      setPara1(response.paragraph1 || '');
      setPara2(response.paragraph2 || '');
      // Backend returns bullets as a "\n"-joined string (e.g. "- Material: steel\n- Hypoallergenic")
      // OR as an array. Parse both forms.
      const rawBullets: any = response.bullets;
      let parsedBullets: string[] = [];
      if (Array.isArray(rawBullets)) {
        parsedBullets = rawBullets.map((b: string) => String(b).replace(/^-\s*/, '').trim()).filter(Boolean);
      } else if (typeof rawBullets === 'string' && rawBullets.trim()) {
        parsedBullets = rawBullets
          .split('\n')
          .map((b: string) => b.replace(/^-\s*/, '').trim())
          .filter(Boolean);
      }
      console.log('[ClaudePanel] parsed bullets:', parsedBullets);
      setBullets(parsedBullets);
    } catch (e: any) {
      const msg = e?.message || 'Failed to generate description';
      if (msg.includes('image')) {
        setDescError(msg);
      } else {
        toast({ title: 'Error', description: msg, variant: 'destructive' });
      }
    } finally {
      setGeneratingDesc(false);
    }
  }

  const [descSaved, setDescSaved] = useState(false);

  async function autoSaveDescription() {
    if (!para1 && !para2 && (!bullets || bullets.length === 0)) return;
    const fullDesc = `${para1}\n\n${para2}`.trim();
    try {
      await updateProduct(product.id, {
        description: fullDesc || undefined,
        bullet_list: bullets?.length ? bullets : undefined,
      } as any);
      setDescSaved(true);
      setTimeout(() => setDescSaved(false), 2000);
      onUpdated();
    } catch (e: any) {
      toast({ title: 'Auto-save failed', description: e?.message, variant: 'destructive' });
    }
  }

  async function handleSaveDescription() {
    try {
      await updateProduct(product.id, { description: descEditValue });
      toast({ title: 'Description saved' });
      setEditingDesc(false);
      onUpdated();
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message, variant: 'destructive' });
    }
  }

  const hasImage = !!firstImage;
  const titleAccepted = !!(product as any).title_accepted;
  const hasDescription = !!(product.description && product.description.trim());
  const generated = hasEverGenerated;
  const showCombinedGenerate = !generated && !titleAccepted && !hasDescription;
  const showTitleSection = generated || titleAccepted;
  const showDescSection = generated || hasDescription;

  return (
    <div className="space-y-4">

      {/* SECTION 1 — Image banner */}
      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-xl">
        {hasImage ? (
          <>
            <img src={firstImage} alt="" className="w-12 h-12 object-cover rounded border" />
            <p className="text-xs text-muted-foreground">This image will be sent to the Copywriting Tool</p>
          </>
        ) : (
          <>
            <div className="w-12 h-12 bg-muted rounded border flex items-center justify-center">
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">No image — add one before generating</p>
          </>
        )}
      </div>

      {/* SECTION 2 — Product Type + Collection */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Product Type</Label>
          <Select
            value={selectedProductType || '__none__'}
            onValueChange={(v) => handleProductTypeSave(v === '__none__' ? '' : v)}
            disabled={loadingTypes}
          >
            <SelectTrigger><SelectValue placeholder="Select product type…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No type selected</SelectItem>
              {productTypes?.filter((pt) => pt.slug).map((pt) => (
                <SelectItem key={pt.slug} value={pt.slug}>{pt.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {savingMeta && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Collection (optional)</Label>
          <Select
            value={selectedCollection || '__none__'}
            onValueChange={(v) => handleCollectionSave(v === '__none__' ? '' : v)}
            disabled={loadingTypes}
          >
            <SelectTrigger><SelectValue placeholder="No collection" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No collection</SelectItem>
              {collections?.map?.((c: any) => (
                <SelectItem key={c.id || c.name} value={c.name}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* SECTION 3 — One-click Generate (first run only) */}
      {showCombinedGenerate && (
        <Button
          onClick={handleGenerateTitle}
          disabled={!hasImage || generatingTitle}
          className="w-full"
          size="lg"
        >
          {generatingTitle ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating titles…</>
          ) : (
            <><Sparkles className="h-4 w-4 mr-2" /> Generate Titles</>
          )}
        </Button>
      )}

      {/* SECTION 4 — Title */}
      {showTitleSection && (
        <Card className="p-5 space-y-4">
          <h3 className="text-sm font-semibold tracking-tight">Title</h3>

          {titleAccepted && product.title && (
            <div className="p-3 bg-muted rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Current title</Label>
                {!editingTitle && (
                  <button onClick={() => setEditingTitle(true)} className="text-muted-foreground hover:text-foreground"><Pencil className="h-3 w-3" /></button>
                )}
              </div>
              {editingTitle ? (
                <div className="space-y-2">
                  <Input value={titleEditValue} onChange={(e) => setTitleEditValue(e.target.value)} placeholder="Product title…" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSaveTitle}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditingTitle(false); setTitleEditValue(product.title ?? ''); }}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm font-medium">{product.title}</p>
              )}
            </div>
          )}

          {titleError && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">{titleError}</p>
            </div>
          )}

          {titleSuggestions.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Suggestions</Label>
              {titleSuggestions?.map((suggestion, idx) => {
                const isSelected = selectedSuggestion === suggestion;
                return (
                  <button
                    key={idx}
                    onClick={() => handleAcceptTitle(suggestion)}
                    disabled={acceptingTitle}
                    className={cn(
                      'w-full text-left p-3 rounded-lg border-2 transition-all relative',
                      isSelected ? 'border-primary bg-primary/5' : 'border-transparent bg-muted hover:border-muted-foreground/20',
                      acceptingTitle && 'opacity-50 pointer-events-none',
                    )}
                  >
                    {suggestion.is_recommended && (
                      <Badge variant="secondary" className="text-xs absolute top-2 right-2">Recommended</Badge>
                    )}
                    {isSelected && <Check className="h-4 w-4 text-primary absolute top-2 left-2" />}
                    <p className={cn('text-sm font-semibold pr-20', isSelected && 'pl-6')}>{suggestion.title}</p>
                    <div className="flex gap-2 mt-2">
                      {suggestion.collection && <Badge variant="outline" className="text-xs">{suggestion.collection}</Badge>}
                      <Badge variant="outline" className="text-xs">{suggestion.product_type}</Badge>
                    </div>
                    {isSelected && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3" /> Saved &amp; blacklisted</p>}
                  </button>
                );
              })}
            </div>
          )}

          <Button
            onClick={handleGenerateTitle}
            disabled={!hasImage || generatingTitle}
            variant="outline"
            size="sm"
            className="w-full"
          >
            {generatingTitle ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
            ) : (
              <><RefreshCw className="h-4 w-4 mr-2" /> Regenerate titles</>
            )}
          </Button>
        </Card>
      )}

      {/* SECTION 5 — Description */}
      {showDescSection && (
        <Card className="p-5 space-y-4">
          <h3 className="text-sm font-semibold tracking-tight">Description</h3>

          {/* Prompt to select title first */}
          {generated && !titleAccepted && !hasDescription && !generatingDesc && (
            <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <Info className="h-4 w-4 text-blue-600 flex-shrink-0" />
              <p className="text-sm text-blue-800">Select a title above to automatically generate the description.</p>
            </div>
          )}

          {hasDescription && !generated && (
            <div className="p-3 bg-muted rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Current description</Label>
                {!editingDesc && (
                  <button onClick={() => setEditingDesc(true)} className="text-muted-foreground hover:text-foreground"><Pencil className="h-3 w-3" /></button>
                )}
              </div>
              {editingDesc ? (
                <div className="space-y-2">
                  <Textarea value={descEditValue} onChange={(e) => setDescEditValue(e.target.value)} rows={4} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSaveDescription}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditingDesc(false); setDescEditValue(product.description ?? ''); }}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{product.description}</p>
              )}
            </div>
          )}

          {descError && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">{descError}</p>
            </div>
          )}

          {generated && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label className="text-xs">Paragraph 1</Label>
                <Textarea value={para1} onChange={(e) => setPara1(e.target.value)} onBlur={autoSaveDescription} rows={3} />
                <p className="text-xs text-muted-foreground text-right">{para1.length}/{maxChars}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Paragraph 2</Label>
                <Textarea value={para2} onChange={(e) => setPara2(e.target.value)} onBlur={autoSaveDescription} rows={3} />
                <p className="text-xs text-muted-foreground text-right">{para2.length}/{maxChars}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Bullets</Label>
                {bullets?.map((bullet, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input
                      value={bullet}
                      onChange={(e) => { const nb = [...bullets]; nb[idx] = e.target.value; setBullets(nb); }}
                      onBlur={autoSaveDescription}
                      placeholder="Bullet point…"
                    />
                    <Button variant="ghost" size="icon" onClick={() => { setBullets(bullets.filter((_, i) => i !== idx)); setTimeout(autoSaveDescription, 50); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setBullets([...bullets, ''])} className="w-full">
                  <Plus className="h-4 w-4 mr-2" /> Add bullet
                </Button>
              </div>
              <Button onClick={autoSaveDescription} size="sm" className="w-full">
                {descSaved ? <><Check className="h-4 w-4 mr-2" /> Saved</> : 'Save Description'}
              </Button>
            </div>
          )}

          {(titleAccepted || hasDescription) && (
            <Button
              onClick={handleGenerateDescription}
              disabled={!hasImage || generatingDesc}
              variant="outline"
              size="sm"
              className="w-full"
            >
              {generatingDesc ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
              ) : (
                <><RefreshCw className="h-4 w-4 mr-2" /> Regenerate description</>
              )}
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}

