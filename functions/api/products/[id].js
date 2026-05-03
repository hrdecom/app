/**
 * GET /api/products/:id — Get single product with full relations
 * PATCH /api/products/:id — Update product metadata (not status)
 * DELETE /api/products/:id — Delete product
 */

import { requireAuth, requireRole, json, errorJson } from '../../lib/auth-middleware.js';
import { canReadProduct, canMutateProduct, loadProductWithChildren } from '../../lib/product-helpers.js';

export async function onRequest(context) {
  const { request } = context;

  try {
    if (request.method === 'GET') {
      return await handleGet(context);
    } else if (request.method === 'PATCH') {
      return await handlePatch(context);
    } else if (request.method === 'DELETE') {
      return await handleDelete(context);
    } else {
      return errorJson('Method not allowed', 405);
    }
  } catch (error) {
    if (error instanceof Response) { return error; }
    console.error('Product [id] API error:', error);
    // FIX 25b — surface the real error message instead of a generic 500.
    // The previous "Internal server error" string masked a SQLite cascade
    // failure (typo'd FK in migration 0134) and made the bug invisible
    // for weeks. This route is admin-only, so leaking the internal
    // message is acceptable and the debugging payoff is large.
    return errorJson(`Internal server error: ${error?.message || error}`, 500);
  }
}

/**
 * GET /api/products/:id
 */
async function handleGet(context) {
  const { env, params } = context;
  const user = await requireAuth(context);
  const productId = parseInt(params.id);

  if (isNaN(productId)) {
    return errorJson('Invalid product ID', 400);
  }

  const product = await loadProductWithChildren(env, productId);

  if (!product) {
    return errorJson('Product not found', 404);
  }

  // Check read permission
  if (!canReadProduct(user, product)) {
    return errorJson('Access denied', 403);
  }

  return json(product);
}

/**
 * PATCH /api/products/:id
 * Body: { title?, description?, category?, assigned_to?, shopify_product_id?, shopify_url?, product_type_slug?, collection?, bullet_list? }
 * Note: status changes go through /api/products/:id/transition
 */
async function handlePatch(context) {
  const { request, env, params } = context;
  const user = await requireAuth(context);
  const productId = parseInt(params.id);

  if (isNaN(productId)) {
    return errorJson('Invalid product ID', 400);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorJson('Invalid JSON body', 400);
  }

  const product = await env.DB
    .prepare('SELECT * FROM products WHERE id = ?')
    .bind(productId)
    .first();

  if (!product) {
    return errorJson('Product not found', 404);
  }

  // Check edit permission
  if (!canMutateProduct(user, product, 'edit-meta')) {
    return errorJson('Access denied', 403);
  }

  // Build update query dynamically
  const updates = [];
  const bindings = [];

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      return errorJson('Title must be a non-empty string', 400);
    }
    updates.push('title = ?');
    bindings.push(body.title.trim());
  }

  if (body.description !== undefined) {
    updates.push('description = ?');
    bindings.push(body.description);
  }

  if (body.category !== undefined) {
    const validCategories = ['small-rings', 'large-rings', 'custom-rings', 'custom-necklaces', 'bracelets', 'boxed-sets'];
    if (body.category && !validCategories.includes(body.category)) {
      return errorJson(`Invalid category. Must be one of: ${validCategories.join(', ')}`, 400);
    }
    updates.push('category = ?');
    bindings.push(body.category);
  }

  // Claude AI fields
  if (body.product_type_slug !== undefined) {
    updates.push('product_type_slug = ?');
    bindings.push(body.product_type_slug);
  }

  if (body.collection !== undefined) {
    updates.push('collection = ?');
    bindings.push(body.collection);
  }

  if (body.bullet_list !== undefined) {
    if (!Array.isArray(body.bullet_list)) {
      return errorJson('bullet_list must be an array', 400);
    }
    updates.push('bullet_list = ?');
    bindings.push(JSON.stringify(body.bullet_list));
  }

  // Only admin can update assigned_to
  if (body.assigned_to !== undefined) {
    if (user.role !== 'admin') {
      return errorJson('Only admin can change assigned_to', 403);
    }
    updates.push('assigned_to = ?');
    bindings.push(body.assigned_to ? parseInt(body.assigned_to) : null);
  }

  // Shopify fields can be updated by integrator or admin
  if (body.shopify_product_id !== undefined) {
    updates.push('shopify_product_id = ?');
    bindings.push(body.shopify_product_id);
  }

  if (body.shopify_url !== undefined) {
    updates.push('shopify_url = ?');
    bindings.push(body.shopify_url);
  }

  if (updates.length === 0) {
    return errorJson('No valid fields to update', 400);
  }

  // Always update updated_at
  updates.push('updated_at = datetime("now")');

  const updateQuery = `
    UPDATE products
    SET ${updates.join(', ')}
    WHERE id = ?
    RETURNING *
  `;

  bindings.push(productId);

  const updated = await env.DB
    .prepare(updateQuery)
    .bind(...bindings)
    .first();

  if (!updated) {
    return errorJson('Failed to update product', 500);
  }

  // Parse bullet_list before returning
  if (updated.bullet_list) {
    try {
      updated.bullet_list = JSON.parse(updated.bullet_list);
    } catch (e) {
      // Keep as string if parse fails
    }
  }

  return json(updated);
}

/**
 * DELETE /api/products/:id
 * Only admin or creator of draft products
 */
async function handleDelete(context) {
  const { env, params } = context;
  const user = await requireAuth(context);
  const productId = parseInt(params.id);

  if (isNaN(productId)) {
    return errorJson('Invalid product ID', 400);
  }

  const product = await env.DB
    .prepare('SELECT * FROM products WHERE id = ?')
    .bind(productId)
    .first();

  if (!product) {
    return errorJson('Product not found', 404);
  }

  // Check delete permission
  if (!canMutateProduct(user, product, 'delete')) {
    return errorJson('Access denied. Only the creator can delete draft products.', 403);
  }

  // FIX 25b — explicit cleanup of child rows that DON'T have ON DELETE
  // CASCADE on their FK. Two cases:
  //   • customization_orders.product_id was added (migration 0144) as a
  //     bare INTEGER with no FK at all, so cascade can never fire.
  //   • Belt-and-suspenders for any future child table that drifts —
  //     cleaning up here costs one round-trip and protects the DELETE
  //     from blowing up if FK cascade hits a schema-drift problem.
  // Wrapped in a single batch() so the whole delete is atomic.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM customization_orders WHERE product_id = ?').bind(productId),
    env.DB.prepare('DELETE FROM products WHERE id = ?').bind(productId),
  ]);

  return new Response(null, { status: 204 });
}
