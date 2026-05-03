/**
 * Session management using Cloudflare KV + D1
 *
 * Sessions are stored in KV for fast access with user data snapshot.
 * Session audit log is written to D1 sessions table.
 *
 * KV key format: session:<sid>
 * KV value: JSON { userId, email, role, name, createdAt }
 */

import { signToken } from './jwt.js';

const SESSION_TTL_SECONDS = 86400; // 24 hours

/**
 * Creates a new session for a user
 * @param {object} env - Cloudflare env (DB, SESSIONS KV, JWT_SECRET)
 * @param {object} user - User object { id, email, role, name }
 * @returns {Promise<{ token: string, sid: string, expires: string }>}
 */
export async function createSession(env, user) {
  // Generate unique session ID
  const sid = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  // Create JWT token
  const token = await signToken(
    {
      sub: String(user.id),
      role: user.role,
      sid: sid,
    },
    env.JWT_SECRET,
    SESSION_TTL_SECONDS
  );

  // Store session snapshot in KV
  const sessionData = {
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    createdAt: now.toISOString(),
  };

  await env.SESSIONS.put(
    `session:${sid}`,
    JSON.stringify(sessionData),
    { expirationTtl: SESSION_TTL_SECONDS }
  );

  // Audit log in D1
  await env.DB.prepare(
    'INSERT INTO sessions (user_id, token_id, expires_at, last_activity_at) VALUES (?, ?, ?, ?)'
  )
    .bind(user.id, sid, expires.toISOString(), now.toISOString())
    .run();

  // Update user last_login_at
  await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    .bind(now.toISOString(), user.id)
    .run();

  return {
    token,
    sid,
    expires: expires.toISOString(),
  };
}

/**
 * Retrieves a session from KV and validates it
 * @param {object} env - Cloudflare env (SESSIONS KV, JWT_SECRET)
 * @param {string} token - JWT token
 * @returns {Promise<object|null>} User object or null if invalid
 */
export async function getSession(env, token) {
  try {
    // Verify JWT first (checks signature and expiration)
    const { verifyToken } = await import('./jwt.js');
    const payload = await verifyToken(token, env.JWT_SECRET);

    // Get session data from KV
    const sessionData = await env.SESSIONS.get(`session:${payload.sid}`, {
      type: 'json',
    });

    if (!sessionData) {
      return null;
    }

    // Return user object
    return {
      id: sessionData.userId,
      email: sessionData.email,
      role: sessionData.role,
      name: sessionData.name,
    };
  } catch (error) {
    console.error('Session validation error:', error);
    return null;
  }
}

/**
 * Destroys a session (logout)
 * @param {object} env - Cloudflare env (DB, SESSIONS KV, JWT_SECRET)
 * @param {string} token - JWT token
 * @returns {Promise<boolean>} True if session was destroyed
 */
export async function destroySession(env, token) {
  try {
    // Verify JWT to get session ID
    const { verifyToken } = await import('./jwt.js');
    const payload = await verifyToken(token, env.JWT_SECRET);

    // Delete from KV
    await env.SESSIONS.delete(`session:${payload.sid}`);

    // Update D1 audit log
    const now = new Date().toISOString();
    await env.DB.prepare(
      'UPDATE sessions SET expires_at = ?, last_activity_at = ? WHERE token_id = ?'
    )
      .bind(now, now, payload.sid)
      .run();

    return true;
  } catch (error) {
    console.error('Session destruction error:', error);
    return false;
  }
}

/**
 * Updates session activity timestamp
 * @param {object} env - Cloudflare env (DB)
 * @param {string} sid - Session ID
 * @returns {Promise<void>}
 */
export async function updateSessionActivity(env, sid) {
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE sessions SET last_activity_at = ? WHERE token_id = ?')
    .bind(now, sid)
    .run();
}
