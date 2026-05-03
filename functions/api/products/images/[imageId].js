/**
 * DELETE /api/products/images/:imageId — Delete product image
 */

import { requireAuth, errorJson } from '../../../lib/auth-middleware.js';
import { canMutateProduct } from '../../../lib/product-helpers.js';

export async function onRequest(context) {
  const { request } = context;

  try {
    if (request.method === 'DELETE') {
      return await handleDelete(context);
    } else {
      return errorJson('Method not allowed', 405);
    }
  } catch (error) {
    if (error instanceof Response) { return error; }
    console.error('Product image [imageId] API error:', error);
    return errorJson('Internal server error', 500);
  }
}

/**
 * DELETE /api/products/images/:imageId
 */
async function handleDelete(context) {
  const { env, params } = context;
  const user = await requireAuth(context);
  const imageId = parseInt(params.imageId);

  if (isNaN(imageId)) {
    return errorJson('Invalid image ID', 400);
  }

  // Load image and product
  const image = await env.DB
    .prepare('SELECT * FROM product_images WHERE id = ?')
    .bind(imageId)
    .first();

  if (!image) {
    return errorJson('Image not found', 404);
  }

  const product = await env.DB
    .prepare('SELECT * FROM products WHERE id = ?')
    .bind(image.product_id)
    .first();

  if (!product) {
    return errorJson('Product not found', 404);
  }

  // Check permission based on image role and product status
  let hasPermission = false;

  // Admin can always delete any image, no matter the status. Saves
  // having to repeat the role check inside every branch below.
  if (user.role === 'admin') {
    hasPermission = true;
  } else if (image.role === 'source') {
    // Creator can delete source images during draft/pending_validation
    // (the typical "I uploaded the wrong file" cleanup before the
    // admin validates).
    // FIX 28 — the assigned integrator can ALSO delete a source image
    // during validated_todo / in_progress. Source = the original brief
    // photo. The integrator routinely regenerates a cleaner version
    // from Image Studio results and wants to swap the original out
    // without bouncing back to the admin or the creator.
    hasPermission =
      (product.created_by === user.id &&
        ['draft', 'pending_validation'].includes(product.status)) ||
      (user.role === 'product-integrator' &&
        product.assigned_to === user.id &&
        ['validated_todo', 'in_progress'].includes(product.status));
  } else if (image.role === 'generated' || image.role === 'variant') {
    // Integrator can delete during in_progress
    hasPermission = product.assigned_to === user.id && product.status === 'in_progress';
  } else if (image.role === 'ad') {
    // Ads-creator can delete ad images
    hasPermission = canMutateProduct(user, product, 'add-image');
  }

  if (!hasPermission) {
    return errorJson('Access denied', 403);
  }

  // Delete image
  await env.DB
    .prepare('DELETE FROM product_images WHERE id = ?')
    .bind(imageId)
    .run();

  return new Response(null, { status: 204 });
}
