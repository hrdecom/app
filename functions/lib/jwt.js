/**
 * JWT signing and verification using jose library
 * HS256 algorithm with configurable TTL
 *
 * Payload structure:
 * {
 *   sub: user_id (string)
 *   role: user role
 *   sid: session ID (for KV lookup)
 *   iat: issued at
 *   exp: expiration
 * }
 */

import { SignJWT, jwtVerify } from 'jose';

/**
 * Signs a JWT token with HS256
 * @param {object} payload - { sub, role, sid }
 * @param {string} secret - JWT secret
 * @param {number} ttlSeconds - Time to live in seconds (default: 86400 = 24h)
 * @returns {Promise<string>} JWT token string
 */
export async function signToken(payload, secret, ttlSeconds = 86400) {
  const secretKey = new TextEncoder().encode(secret);

  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secretKey);

  return jwt;
}

/**
 * Verifies a JWT token and returns the payload
 * @param {string} token - JWT token string
 * @param {string} secret - JWT secret
 * @returns {Promise<object>} Decoded payload
 * @throws {Error} If token is invalid or expired
 */
export async function verifyToken(token, secret) {
  const secretKey = new TextEncoder().encode(secret);

  const { payload } = await jwtVerify(token, secretKey, {
    algorithms: ['HS256'],
  });

  return payload;
}
