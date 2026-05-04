/**
 * GET /api/products — List products with filtering
 * POST /api/products — Create new product
 */

import { requireAuth, requireRole, json, errorJson } from '../../lib/auth-middleware.js';

export async function onRequest(context) {
  const { request } = context;

  try {
    if (request.method === 'GET') {
      return await handleList(context);
    } else if (request.method === 'POST') {
      return await handleCreate(context);
    } else {
      return errorJson('Method not allowed', 405);
    }
  } catch (error) {
    // If error is already a Response (thrown by requireAuth/requireRole), return it
    if (error instanceof Response) { return error; }
    console.error('Products API error:', error);
    return errorJson('Internal server error', 500);
  }
}

/**
 * GET /api/products
 * Query params: status, assigned_to, created_by, category, q, limit, offset
 */
async function handleList(context) {
  const { request, env } = context;
  const user = await requireAuth(context);
  const url = new URL(request.url);

  // Parse query params
  const statusParam = url.searchParams.get('status');
  const assignedTo = url.searchParams.get('assigned_to');
  const createdBy = url.searchParams.get('created_by');
  // FIX 32 — `pushed_by` filters by the user who pushed the product to
  // Shopify, not the current assignee. Used by the integrator's "Done"
  // tab so a product still shows there after an ads-creator picks it up
  // and re-assigns it (which is the normal hand-off flow). Sourced from
  // workflow_events (actor_user_id of the in_progress→pushed_to_shopify
  // transition).
  const pushedBy = url.searchParams.get('pushed_by');
  const category = url.searchParams.get('category');
  const q = url.searchParams.get('q');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  // Build WHERE clause based on role and filters
  const conditions = [];
  const bindings = [];

  // Role-based default scoping (only if user didn't provide explicit filters)
  if (user.role === 'product-researcher' && !createdBy) {
    // Researcher sees only their own products by default
    conditions.push('created_by = ?');
    bindings.push(user.id);
  } else if (user.role === 'product-integrator' && !assignedTo && !statusParam) {
    // Integrator sees tasks assigned to them in relevant statuses by default
    conditions.push('assigned_to = ?');
    bindings.push(user.id);
    conditions.push('status IN (?, ?, ?)');
    bindings.push('validated_todo', 'in_progress', 'pushed_to_shopify');
  } else if (user.role === 'ads-creator' && !statusParam) {
    // Ads creator sees products in Shopify-ready statuses by default
    conditions.push('status IN (?, ?, ?, ?)');
    bindings.push('pushed_to_shopify', 'ads_in_progress', 'ads_ready', 'published');
  }
  // Admin has no default scoping

  // Apply explicit filters (override defaults)
  if (statusParam) {
    const statuses = statusParam.split(',').map(s => s.trim());
    const placeholders = statuses.map(() => '?').join(',');
    conditions.push(`status IN (${placeholders})`);
    bindings.push(...statuses);
  }

  if (assignedTo) {
    if (assignedTo === 'me') {
      conditions.push('assigned_to = ?');
      bindings.push(user.id);
    } else {
      conditions.push('assigned_to = ?');
      bindings.push(parseInt(assignedTo));
    }
  }

  if (createdBy) {
    if (createdBy === 'me') {
      conditions.push('created_by = ?');
      bindings.push(user.id);
    } else {
      conditions.push('created_by = ?');
      bindings.push(parseInt(createdBy));
    }
  }

  // FIX 32 — pushed_by filter (see docstring above the parse).
  // Sub-query against workflow_events finds products this user
  // transitioned to pushed_to_shopify at any point. Independent of the
  // current `assigned_to` so post-handoff products still show up.
  if (pushedBy) {
    const pushedByUserId = pushedBy === 'me' ? user.id : parseInt(pushedBy);
    if (Number.isFinite(pushedByUserId)) {
      // Unqualified `id` — the count query doesn't alias the products
      // table (see `FROM products ${whereClause}` below), so `p.id`
      // would fail there.
      conditions.push(
        'id IN (SELECT product_id FROM workflow_events WHERE actor_user_id = ? AND to_status = ?)',
      );
      bindings.push(pushedByUserId, 'pushed_to_shopify');
    }
  }

  if (category) {
    conditions.push('category = ?');
    bindings.push(category);
  }

  if (q) {
    conditions.push('title LIKE ?');
    bindings.push(`%${q}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total matching products
  const countQuery = `SELECT COUNT(*) as total FROM products ${whereClause}`;
  const { total } = await env.DB
    .prepare(countQuery)
    .bind(...bindings)
    .first();

  // Fetch products with link and image counts, creator/assignee names, rejection notes
  const query = `
    SELECT
      p.*,
      (SELECT COUNT(*) FROM product_links WHERE product_id = p.id) as links_count,
      (SELECT COUNT(*) FROM product_images WHERE product_id = p.id) as images_count,
      (SELECT url_or_key FROM product_images WHERE product_id = p.id ORDER BY created_at ASC LIMIT 1) as first_image,
      creator.name as creator_name,
      creator.email as creator_email,
      assignee.name as assignee_name,
      (SELECT note FROM workflow_events WHERE product_id = p.id AND to_status = 'rejected' ORDER BY created_at DESC LIMIT 1) as latest_rejection_note
    FROM products p
    LEFT JOIN users creator ON p.created_by = creator.id
    LEFT JOIN users assignee ON p.assigned_to = assignee.id
    ${whereClause}
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const { results: items } = await env.DB
    .prepare(query)
    .bind(...bindings, limit, offset)
    .all();

  return json({
    items: items || [],
    total: total || 0,
    limit,
    offset,
  });
}

/**
 * POST /api/products
 * Body: { title, category, description?, status?: 'draft'|'pending_validation' }
 */
async function handleCreate(context) {
  const { request, env } = context;
  const user = await requireRole(context, 'product-researcher', 'admin');

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorJson('Invalid JSON body', 400);
  }

  const { title, category, description, status } = body;

  // Validate required fields
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return errorJson('Title is required', 400);
  }

  // Validate category if provided
  const validCategories = ['small-rings', 'large-rings', 'custom-rings', 'custom-necklaces', 'bracelets', 'boxed-sets'];
  if (category && !validCategories.includes(category)) {
    return errorJson(`Invalid category. Must be one of: ${validCategories.join(', ')}`, 400);
  }

  // Validate status
  const validStatuses = ['draft', 'pending_validation'];
  const finalStatus = status || 'draft';
  if (!validStatuses.includes(finalStatus)) {
    return errorJson(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
  }

  // Insert product
  const insertQuery = `
    INSERT INTO products (title, category, description, status, created_by)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `;

  const product = await env.DB
    .prepare(insertQuery)
    .bind(
      title.trim(),
      category || null,
      description || null,
      finalStatus,
      user.id
    )
    .first();

  if (!product) {
    return errorJson('Failed to create product', 500);
  }

  // Write workflow event (initial creation)
  await env.DB
    .prepare(`
      INSERT INTO workflow_events (product_id, actor_user_id, from_status, to_status, note)
      VALUES (?, ?, NULL, ?, ?)
    `)
    .bind(product.id, user.id, finalStatus, 'Product created')
    .run();

  return json(product, 201);
}
