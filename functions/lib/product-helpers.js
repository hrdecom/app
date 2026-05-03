/**
 * Product authorization and data loading helpers
 * Used by all product API endpoints to enforce role-based access control
 */

/**
 * Check if user can read a product
 * @param {object} user - { id, role, ... }
 * @param {object} product - Product row with created_by, assigned_to, status
 * @returns {boolean}
 */
export function canReadProduct(user, product) {
  // Admin can read everything
  if (user.role === 'admin') {
    return true;
  }

  // Creator can always read their own products
  if (product.created_by === user.id) {
    return true;
  }

  // Assigned user can read products assigned to them
  if (product.assigned_to === user.id) {
    return true;
  }

  // Product integrators can see validated/in-progress/pushed products
  if (user.role === 'product-integrator') {
    return ['validated_todo', 'in_progress', 'pushed_to_shopify'].includes(product.status);
  }

  // Ads creators can see products that reached Shopify, plus ones the admin
  // bounced back to them (`ads_rejected`) so they can iterate.
  if (user.role === 'ads-creator') {
    return [
      'pushed_to_shopify',
      'ads_in_progress',
      'ads_ready',
      'ads_rejected',
      'published',
    ].includes(product.status);
  }

  return false;
}

/**
 * Check if user can mutate a product
 * @param {object} user - { id, role, ... }
 * @param {object} product - Product row
 * @param {string} kind - Mutation kind: 'edit-meta' | 'add-link' | 'add-image' | 'delete'
 * @returns {boolean}
 */
export function canMutateProduct(user, product, kind) {
  // Admin can do anything
  if (user.role === 'admin') {
    return true;
  }

  const isCreator = product.created_by === user.id;
  const isAssigned = product.assigned_to === user.id;

  switch (kind) {
    case 'delete':
      // Creator (or admin) can delete before the product has entered the integrator pipeline.
      // Allowed statuses: draft, pending_validation.
      return isCreator && ['draft', 'pending_validation', 'rejected'].includes(product.status);

    case 'edit-meta':
      // Creator can edit draft/pending_validation
      if (isCreator && ['draft', 'pending_validation', 'rejected'].includes(product.status)) {
        return true;
      }
      // Assigned integrator can edit validated_todo/in_progress
      if (isAssigned && ['validated_todo', 'in_progress'].includes(product.status)) {
        return true;
      }
      // Assigned ads-creator can edit ads_in_progress AND ads_rejected
      // (the admin bounced the package back, so the creator iterates).
      if (isAssigned && ['ads_in_progress', 'ads_rejected'].includes(product.status)) {
        return true;
      }
      return false;

    case 'add-link':
      // Creator can add links during draft/pending_validation
      if (isCreator && ['draft', 'pending_validation', 'rejected'].includes(product.status)) {
        return true;
      }
      // Assigned integrator can add links during in_progress
      if (isAssigned && product.status === 'in_progress') {
        return true;
      }
      return false;

    case 'add-image':
      // Creator can add source images during draft/pending_validation
      if (isCreator && ['draft', 'pending_validation', 'rejected'].includes(product.status)) {
        return true;
      }
      // Integrator can add generated/variant images during in_progress
      if (isAssigned && product.status === 'in_progress') {
        return true;
      }
      // Ads-creator can add ad images during ads_in_progress / ads_ready /
      // ads_rejected (when iterating after an admin bounce).
      if (
        user.role === 'ads-creator' &&
        ['pushed_to_shopify', 'ads_in_progress', 'ads_ready', 'ads_rejected'].includes(product.status)
      ) {
        return true;
      }
      return false;

    default:
      return false;
  }
}

/**
 * Validate a status transition
 * @param {object} user - { id, role, ... }
 * @param {object} product - Current product state
 * @param {string} toStatus - Target status
 * @returns {{ ok: boolean, error?: string, requiresAssignedTo?: boolean }}
 */
export function validateTransition(user, product, toStatus) {
  const from = product.status;

  // Draft OR rejected → pending_validation (researcher submits / resubmits)
  if ((from === 'draft' || from === 'rejected') && toStatus === 'pending_validation') {
    if (user.role === 'product-researcher' && product.created_by === user.id) {
      return { ok: true };
    }
    if (user.role === 'admin') {
      return { ok: true };
    }
    return { ok: false, error: 'Only the creator or admin can submit for validation' };
  }

  // pending_validation → validated_todo (admin validates)
  if (from === 'pending_validation' && toStatus === 'validated_todo') {
    if (user.role !== 'admin') {
      return { ok: false, error: 'Only admin can validate products' };
    }
    return { ok: true, requiresAssignedTo: true };
  }

  // pending_validation → rejected (admin rejects, note is required)
  if (from === 'pending_validation' && toStatus === 'rejected') {
    if (user.role !== 'admin') {
      return { ok: false, error: 'Only admin can reject products' };
    }
    return { ok: true };
  }

  // validated_todo → in_progress (integrator claims)
  if (from === 'validated_todo' && toStatus === 'in_progress') {
    if (user.role !== 'product-integrator' && user.role !== 'admin') {
      return { ok: false, error: 'Only product-integrator can claim tasks' };
    }
    return { ok: true };
  }

  // in_progress → pushed_to_shopify (integrator completes)
  if (from === 'in_progress' && toStatus === 'pushed_to_shopify') {
    if (user.role !== 'product-integrator' && user.role !== 'admin') {
      return { ok: false, error: 'Only product-integrator can mark as pushed to Shopify' };
    }
    if (product.assigned_to !== user.id && user.role !== 'admin') {
      return { ok: false, error: 'Only the assigned integrator can mark as pushed' };
    }
    return { ok: true };
  }

  // pushed_to_shopify → ads_in_progress (ads-creator starts)
  if (from === 'pushed_to_shopify' && toStatus === 'ads_in_progress') {
    if (user.role !== 'ads-creator' && user.role !== 'admin') {
      return { ok: false, error: 'Only ads-creator can start working on ads' };
    }
    return { ok: true };
  }

  // ads_in_progress → ads_ready (ads-creator completes)
  if (from === 'ads_in_progress' && toStatus === 'ads_ready') {
    if (user.role !== 'ads-creator' && user.role !== 'admin') {
      return { ok: false, error: 'Only ads-creator can mark ads as ready' };
    }
    return { ok: true };
  }

  // ads_ready → published (admin publishes)
  if (from === 'ads_ready' && toStatus === 'published') {
    if (user.role !== 'admin') {
      return { ok: false, error: 'Only admin can publish ads' };
    }
    return { ok: true };
  }

  // ads_ready → ads_in_progress (admin requests revisions)
  if (from === 'ads_ready' && toStatus === 'ads_in_progress') {
    if (user.role !== 'admin') {
      return { ok: false, error: 'Only admin can request revisions' };
    }
    return { ok: true };
  }

  // FIX 11 — ads_ready → ads_rejected (admin rejects the asset package and
  // the creator must iterate). Companion to ad_assets.status='rejected' set
  // in PATCH /api/ads/assets/:id.
  if (from === 'ads_ready' && toStatus === 'ads_rejected') {
    if (user.role !== 'admin') {
      return { ok: false, error: 'Only admin can reject ad assets' };
    }
    return { ok: true };
  }

  // FIX 11 — ads_rejected → ads_in_progress (creator opens the bounced
  // package and starts editing). Triggered automatically when the creator
  // re-enters the workspace, mirroring pushed_to_shopify→ads_in_progress.
  if (from === 'ads_rejected' && toStatus === 'ads_in_progress') {
    if (user.role !== 'ads-creator' && user.role !== 'admin') {
      return { ok: false, error: 'Only ads-creator can resume work' };
    }
    return { ok: true };
  }

  // FIX 11 — ads_rejected → ads_ready (creator resubmits after iterating).
  // The PreviewSendPanel UPSERT handles the asset row; this transition just
  // mirrors the asset moving back to `ready_for_review`.
  if (from === 'ads_rejected' && toStatus === 'ads_ready') {
    if (user.role !== 'ads-creator' && user.role !== 'admin') {
      return { ok: false, error: 'Only ads-creator can resubmit' };
    }
    return { ok: true };
  }

  // FIX 14 — published → ads_ready (creator iterates on an already-approved
  // package). The POST /api/ads/assets UPSERT resets the asset row to
  // `ready_for_review` whenever content changes; we mirror that on the
  // product side so the ad moves out of the creator's Done bucket and
  // back into Pending Review. Symmetric with ads_rejected → ads_ready.
  if (from === 'published' && toStatus === 'ads_ready') {
    if (user.role !== 'ads-creator' && user.role !== 'admin') {
      return { ok: false, error: 'Only ads-creator can re-submit' };
    }
    return { ok: true };
  }


  // Default: invalid transition
  return { ok: false, error: `Invalid transition from ${from} to ${toStatus}` };
}

/**
 * Load product with all child relations (links, images, workflow_events)
 * @param {object} env - Cloudflare env with DB binding
 * @param {number} id - Product ID
 * @returns {Promise<object|null>} Product with links[], images[], workflow_events[], creator_name, assignee_name or null if not found
 */
export async function loadProductWithChildren(env, id) {
  // Load product with creator and assignee names
  const product = await env.DB
    .prepare(`
      SELECT
        p.*,
        creator.name as creator_name,
        creator.email as creator_email,
        assignee.name as assignee_name
      FROM products p
      LEFT JOIN users creator ON p.created_by = creator.id
      LEFT JOIN users assignee ON p.assigned_to = assignee.id
      WHERE p.id = ?
    `)
    .bind(id)
    .first();

  if (!product) {
    return null;
  }

  // Load links
  const { results: links } = await env.DB
    .prepare('SELECT * FROM product_links WHERE product_id = ? ORDER BY created_at')
    .bind(id)
    .all();

  // Load images
  const { results: images } = await env.DB
    .prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id')
    .bind(id)
    .all();

  // Load workflow events (last 50, newest first, with actor names)
  const { results: workflow_events } = await env.DB
    .prepare(`
      SELECT
        w.*,
        u.name as actor_name
      FROM workflow_events w
      LEFT JOIN users u ON w.actor_user_id = u.id
      WHERE w.product_id = ?
      ORDER BY w.created_at DESC
      LIMIT 50
    `)
    .bind(id)
    .all();

  return {
    ...product,
    links: links || [],
    images: images || [],
    workflow_events: workflow_events || [],
  };
}
