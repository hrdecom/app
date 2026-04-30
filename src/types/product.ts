export type ProductStatus =
  | 'draft'
  | 'pending_validation'
  | 'rejected'
  | 'validated_todo'
  | 'in_progress'
  | 'pushed_to_shopify'
  | 'ads_in_progress'
  | 'ads_ready'
  | 'ads_rejected'
  | 'published';

export type ProductCategory =
  | 'small-rings'
  | 'large-rings'
  | 'custom-rings'
  | 'custom-necklaces'
  | 'bracelets'
  | 'boxed-sets';

export type LinkSource = '1688' | 'temu' | 'alizy' | 'facebook' | 'other';

export type LinkKind = 'source' | 'competitor';

export interface ProductLink {
  id: number;
  product_id: number;
  source: LinkSource;
  url: string;
  notes?: string;
  kind: LinkKind;
  created_at: string;
}

export interface ProductImage {
  id: number;
  product_id: number;
  role: 'source' | 'generated' | 'ad';
  url_or_key: string;
  prompt?: string;
  tool?: string;
  created_at: string;
}

export interface WorkflowEvent {
  id: number;
  product_id: number;
  actor_user_id?: number | null;
  actor_name?: string | null;
  from_status?: ProductStatus | null;
  to_status: ProductStatus;
  note?: string | null;
  created_at: string;
}

export interface Product {
  id: number;
  title: string;
  description?: string | null;
  category?: ProductCategory | null;
  product_type_slug?: string | null;
  collection?: string | null;
  title_accepted?: boolean | number;
  variant_template_slug?: string | null;
  status: ProductStatus;
  shopify_url?: string | null;
  shopify_admin_url?: string | null;
  shopify_product_id?: string | null;
  shopify_price?: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  links: ProductLink[];
  images: ProductImage[];
  creator_name?: string | null;
  creator_email?: string | null;
  assignee_name?: string | null;
  workflow_events?: WorkflowEvent[];
  supports_personalization?: number | boolean;
  first_image_url?: string | null;
  shopify_handle?: string | null;
}

export interface ProductListItem {
  id: number;
  title: string;
  description?: string | null;
  category?: ProductCategory | null;
  status: ProductStatus;
  shopify_url?: string | null;
  shopify_admin_url?: string | null;
  created_at: string;
  updated_at: string;
  links_count: number;
  images_count: number;
  first_image?: string | null;
  creator_name?: string | null;
  creator_email?: string | null;
  assignee_name?: string | null;
  latest_rejection_note?: string | null;
}

export const CATEGORIES: Record<ProductCategory, string> = {
  'small-rings': 'Small Rings',
  'large-rings': 'Large Rings',
  'custom-rings': 'Custom Rings',
  'custom-necklaces': 'Custom Necklaces',
  'bracelets': 'Bracelets',
  'boxed-sets': 'Boxed Sets',
};

export const LINK_SOURCES: Record<LinkSource, string> = {
  '1688': '1688',
  'temu': 'Temu',
  'alizy': 'Alizy',
  'facebook': 'Facebook',
  'other': 'Other',
};

export const STATUS_META: Record<
  ProductStatus,
  { label: string; className: string }
> = {
  draft: {
    label: 'Draft',
    className: 'bg-gray-100 text-gray-800 border-gray-200',
  },
  pending_validation: {
    label: 'Pending Validation',
    className: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-red-100 text-red-800 border-red-200',
  },
  validated_todo: {
    label: 'Validated',
    className: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  in_progress: {
    label: 'In Progress',
    className: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  },
  pushed_to_shopify: {
    label: 'Shopify Ready',
    className: 'bg-teal-100 text-teal-800 border-teal-200',
  },
  ads_in_progress: {
    label: 'Ads in Progress',
    className: 'bg-violet-100 text-violet-800 border-violet-200',
  },
  ads_ready: {
    label: 'Ads Ready',
    className: 'bg-purple-100 text-purple-800 border-purple-200',
  },
  ads_rejected: {
    label: 'Ads Rejected',
    className: 'bg-red-100 text-red-800 border-red-200',
  },
  published: {
    label: 'Published',
    className: 'bg-green-100 text-green-800 border-green-200',
  },
};
