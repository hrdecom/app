import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { listProducts, getProduct } from '@/lib/products';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PipelineStats } from '@/components/admin/PipelineStats';
import { PendingValidationCard } from '@/components/admin/PendingValidationCard';
import { AdsReviewPanel } from '@/components/admin/AdsReviewPanel';
import { ProductDetailDialog } from '@/components/admin/ProductDetailDialog';
import { DeleteProductButton } from '@/components/admin/DeleteProductButton';
import { NanoBananaSettings } from '@/components/admin/NanoBananaSettings';
import { ClaudeTools } from '@/components/admin/ClaudeTools';
import { VariantTemplatesPanel } from '@/components/admin/VariantTemplatesPanel';
import { ShopifySettingsPanel } from '@/components/admin/shopify/ShopifySettingsPanel';
import { AdsSettingsPanel } from '@/components/admin/AdsSettingsPanel';
import { SeedancePromptsPanel } from '@/components/admin/SeedancePromptsPanel';
import { SoundLibraryPanel } from '@/components/admin/SoundLibraryPanel';
import { LaunchAdsPanel } from '@/components/admin/facebook/LaunchAdsPanel';
import { ProductionQueuePanel } from '@/components/admin/personalizer/ProductionQueuePanel';
import { STATUS_META, type ProductListItem, type ProductStatus, type Product } from '@/types/product';
import { Badge } from '@/components/ui/badge';
import { Loader2, Package, User, ExternalLink } from 'lucide-react';

type AdminTab = 'products' | 'nano-banana' | 'claude' | 'variants' | 'shopify-settings' | 'ads-settings' | 'video-studio' | 'sound-library' | 'launch-ads' | 'production-queue';

export default function AdminPage() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('products');
  const [pendingProducts, setPendingProducts] = useState<ProductListItem[]>([]);
  const [allProducts, setAllProducts] = useState<ProductListItem[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [loadingAll, setLoadingAll] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<ProductStatus | undefined>();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    loadPendingProducts();
  }, []);

  useEffect(() => {
    if (showAllProducts) {
      loadAllProducts();
    }
  }, [showAllProducts, selectedStatus]);

  const loadPendingProducts = async () => {
    try {
      setLoadingPending(true);
      const data = await listProducts({ status: 'pending_validation' });
      setPendingProducts(data.items);
    } catch (error) {
      console.error('Failed to load pending products:', error);
    } finally {
      setLoadingPending(false);
    }
  };

  const loadAllProducts = async () => {
    try {
      setLoadingAll(true);
      const params: any = {};
      if (selectedStatus) {
        params.status = selectedStatus;
      }
      const data = await listProducts(params);
      setAllProducts(data.items);
    } catch (error) {
      console.error('Failed to load all products:', error);
    } finally {
      setLoadingAll(false);
    }
  };

  const handleStatusSelect = (status?: ProductStatus) => {
    setSelectedStatus(status);
    if (!showAllProducts) {
      setShowAllProducts(true);
    }
  };

  const handleProductClick = async (product: ProductListItem) => {
    try {
      const fullProduct = await getProduct(product.id);
      setSelectedProduct(fullProduct);
      setShowDetailDialog(true);
    } catch (error) {
      console.error('Failed to load product:', error);
    }
  };

  const handleUpdate = () => {
    loadPendingProducts();
    if (showAllProducts) {
      loadAllProducts();
    }
    setRefreshKey((k) => k + 1);
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            <h1 className="text-2xl font-semibold tracking-tight">
              Jewelry CRM — Admin
            </h1>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span>{user?.email}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={logout}>
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Tab navigation */}
          <div className="flex gap-6 -mb-px">
            <button
              onClick={() => setActiveTab('products')}
              className={`pb-3 px-1 text-sm font-medium tracking-tight transition-colors ${
                activeTab === 'products'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Products
            </button>
            <button
              onClick={() => setActiveTab('nano-banana')}
              className={`pb-3 px-1 text-sm font-medium tracking-tight transition-colors ${
                activeTab === 'nano-banana'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Image Studio
            </button>
            <button
              onClick={() => setActiveTab('claude')}
              className={`pb-3 px-1 text-sm font-medium tracking-tight transition-colors ${
                activeTab === 'claude'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Copywriting Tool
            </button>
            <button
              onClick={() => setActiveTab('variants')}
              className={`pb-3 px-1 text-sm font-medium tracking-tight transition-colors ${
                activeTab === 'variants'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Shopify Variants
            </button>
            <button
              onClick={() => setActiveTab('shopify-settings')}
              className={`pb-3 px-1 text-sm font-medium tracking-tight transition-colors ${
                activeTab === 'shopify-settings'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Shopify Settings
            </button>
            <button
              onClick={() => setActiveTab('ads-settings')}
              className={`pb-3 px-1 text-sm font-medium tracking-tight transition-colors ${
                activeTab === 'ads-settings'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Ads Settings
            </button>
            <button
              onClick={() => setActiveTab('video-studio')}
              className={`pb-3 px-1 text-sm font-medium tracking-tight transition-colors ${
                activeTab === 'video-studio'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Video Studio
            </button>
            <button
              onClick={() => setActiveTab('sound-library')}
              className={`pb-3 px-1 text-sm font-medium tracking-tight transition-colors ${
                activeTab === 'sound-library'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Sound Library
            </button>
            <button
              onClick={() => setActiveTab('launch-ads')}
              className={`pb-3 px-1 text-sm font-medium tracking-tight transition-colors ${
                activeTab === 'launch-ads'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Launch Ads
            </button>
            <button
              onClick={() => setActiveTab('production-queue')}
              className={`pb-3 px-1 text-sm font-medium tracking-tight transition-colors ${
                activeTab === 'production-queue'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Production Queue
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'production-queue' ? (
          <ProductionQueuePanel />
        ) : activeTab === 'launch-ads' ? (
          <LaunchAdsPanel />
        ) : activeTab === 'sound-library' ? (
          <SoundLibraryPanel />
        ) : activeTab === 'video-studio' ? (
          <SeedancePromptsPanel />
        ) : activeTab === 'ads-settings' ? (
          <AdsSettingsPanel />
        ) : activeTab === 'shopify-settings' ? (
          <ShopifySettingsPanel />
        ) : activeTab === 'variants' ? (
          <VariantTemplatesPanel />
        ) : activeTab === 'claude' ? (
          <ClaudeTools />
        ) : activeTab === 'nano-banana' ? (
          <NanoBananaSettings />
        ) : (
          <div className="space-y-8">
            {/* Pipeline Stats */}
            <section>
              <h2 className="text-lg font-semibold tracking-tight mb-4">Pipeline Overview</h2>
              <PipelineStats onSelect={handleStatusSelect} refreshKey={refreshKey} />
            </section>

            {/* Pending Validation */}
            <section>
              <h2 className="text-lg font-semibold tracking-tight mb-4">
                Pending Validation
                {!loadingPending && pendingProducts.length > 0 && (
                  <span className="ml-2 text-muted-foreground font-normal">
                    ({pendingProducts.length})
                  </span>
                )}
              </h2>

              {loadingPending ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : pendingProducts.length > 0 ? (
                <div className="space-y-4">
                  {pendingProducts.map((product) => (
                    <PendingValidationCard
                      key={product.id}
                      product={product}
                      onUpdate={handleUpdate}
                    />
                  ))}
                </div>
              ) : (
                <Card className="p-8 text-center">
                  <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-lg font-medium">All caught up</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    No products pending validation
                  </p>
                </Card>
              )}
            </section>

            {/* Ads Ready — asset packages awaiting admin review */}
            <section>
              <h2 className="text-lg font-semibold tracking-tight mb-4">
                Ads Ready for Review
              </h2>
              <AdsReviewPanel refreshKey={refreshKey} onChanged={handleUpdate} />
            </section>

            {/* All Products */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold tracking-tight">
                  All Products
                  {selectedStatus && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      — {STATUS_META[selectedStatus].label}
                    </span>
                  )}
                </h2>
                {!showAllProducts && (
                  <Button
                    variant="outline"
                    onClick={() => setShowAllProducts(true)}
                  >
                    Show All Products
                  </Button>
                )}
              </div>

              {showAllProducts && (
                <>
                  {loadingAll ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : allProducts.length > 0 ? (
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                      <table className="w-full">
                        <thead className="bg-muted/50 border-b border-gray-200">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              Product
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              Status
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              Creator
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              Assignee
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              Updated
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {allProducts.map((product) => (
                            <tr
                              key={product.id}
                              onClick={() => handleProductClick(product)}
                              className="hover:bg-muted/50 cursor-pointer transition-colors"
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                  {product.first_image ? (
                                    <img
                                      src={product.first_image}
                                      alt=""
                                      className="w-10 h-10 object-cover rounded"
                                    />
                                  ) : (
                                    <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                                      <Package className="h-5 w-5 text-muted-foreground" />
                                    </div>
                                  )}
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium text-sm flex-1">{product.title}</p>
                                      {(product.shopify_admin_url || product.shopify_url) && (
                                        <a
                                          href={product.shopify_admin_url || product.shopify_url || ''}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          className="text-teal-600 hover:text-teal-700 transition-colors"
                                          title="View on Shopify"
                                        >
                                          <ExternalLink className="h-4 w-4" />
                                        </a>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      {product.links_count} links, {product.images_count} images
                                    </p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <Badge className={STATUS_META[product.status].className}>
                                  {STATUS_META[product.status].label}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-sm">
                                {product.creator_name || product.creator_email || '—'}
                              </td>
                              <td className="px-4 py-3 text-sm">
                                {product.assignee_name || '—'}
                              </td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">
                                {relativeTime(product.updated_at)}
                              </td>
                              <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                <DeleteProductButton
                                  productId={product.id}
                                  productTitle={product.title}
                                  onDeleted={handleUpdate}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Card className="p-8 text-center">
                      <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                      <p className="text-lg font-medium">No products found</p>
                      {selectedStatus && (
                        <p className="text-sm text-muted-foreground mt-1">
                          No products with status "{STATUS_META[selectedStatus].label}"
                        </p>
                      )}
                    </Card>
                  )}
                </>
              )}
            </section>
          </div>
        )}
      </main>

      <ProductDetailDialog
        product={selectedProduct}
        open={showDetailDialog}
        onOpenChange={setShowDetailDialog}
      />
    </div>
  );
}
