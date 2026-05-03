/**
 * Authentication and authorization middleware for Cloudflare Pages Functions
 *
 * Provides:
 * - requireAuth: Validates JWT from cookie or Authorization header
 * - requireRole: Validates user has specific role(s)
 * - Helper functions for JSON responses
 */

import { getSession } from './session.js';

/**
 * Extracts JWT token from request
 * Checks both Authorization header (Bearer token) and session cookie
 * @param {Request} request
 * @returns {string|null} Token or null
 */
function extractToken(request) {
  // Check Authorization header first
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Check session cookie
  const cookieHeader = request.headers.get('Cookie');
  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split('; ').map((c) => {
        const [key, ...v] = c.split('=');
        return [key, v.join('=')];
      })
    );
    return cookies.session || null;
  }

  return null;
}

/**
 * Requires authentication. Validates JWT and returns user object.
 * @param {object} context - Cloudflare Pages Function context { request, env }
 * @returns {Promise<object>} User object { id, email, role, name }
 * @throws {Response} 401 if not authenticated
 */
export async function requireAuth(context) {
  const { request, env } = context;

  const token = extractToken(request);
  if (!token) {
    throw errorJson('Authentication required', 401);
  }

  const user = await getSession(env, token);
  if (!user) {
    throw errorJson('Invalid or expired session', 401);
  }

  return user;
}

/**
 * Requires authentication AND specific role(s)
 * @param {object} context - Cloudflare Pages Function context
 * @param {...string} allowedRoles - Allowed roles (e.g., 'admin', 'product-researcher')
 * @returns {Promise<object>} User object if authorized
 * @throws {Response} 401 if not authenticated, 403 if not authorized
 */
export async function requireRole(context, ...allowedRoles) {
  const user = await requireAuth(context);

  if (!allowedRoles.includes(user.role)) {
    throw errorJson('Insufficient permissions', 403);
  }

  return user;
}

/**
 * Returns a JSON response
 * @param {object} data - Data to serialize
 * @param {number} status - HTTP status code
 * @param {object} headers - Additional headers
 * @returns {Response}
 */
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Returns a JSON error response
 * @param {string} message - Error message
 * @param {number} status - HTTP status code
 * @returns {Response}
 */
export function errorJson(message, status = 400) {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}
