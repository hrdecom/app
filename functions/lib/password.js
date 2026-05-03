/**
 * Password hashing and verification using PBKDF2 via WebCrypto API
 *
 * This implementation is optimized for Cloudflare Workers which support
 * WebCrypto but not Node.js bcrypt. PBKDF2 with 100k iterations provides
 * strong security against brute-force attacks.
 *
 * Format: pbkdf2$<iterations>$<saltB64>$<hashB64>
 */

const ALGORITHM = 'SHA-256';
const ITERATIONS = 100000;
const KEY_LENGTH = 32; // 256 bits

/**
 * Hashes a plain text password using PBKDF2
 * @param {string} plain - Plain text password
 * @returns {Promise<string>} Hash string in format pbkdf2$iterations$saltB64$hashB64
 */
export async function hashPassword(plain) {
  // Generate random salt (16 bytes = 128 bits)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Import password as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(plain),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  // Derive key using PBKDF2
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: ITERATIONS,
      hash: ALGORITHM,
    },
    keyMaterial,
    KEY_LENGTH * 8 // bits
  );

  // Convert to base64
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));

  return `pbkdf2$${ITERATIONS}$${saltB64}$${hashB64}`;
}

/**
 * Verifies a plain text password against a stored hash
 * Uses constant-time comparison to prevent timing attacks
 * @param {string} plain - Plain text password to verify
 * @param {string} stored - Stored hash string
 * @returns {Promise<boolean>} True if password matches
 */
export async function verifyPassword(plain, stored) {
  try {
    // Parse stored hash
    const parts = stored.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
      return false;
    }

    const iterations = parseInt(parts[1], 10);
    const saltB64 = parts[2];
    const storedHashB64 = parts[3];

    // Decode salt
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));

    // Import password as key material
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(plain),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    // Derive key using same parameters
    const hashBuffer = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: iterations,
        hash: ALGORITHM,
      },
      keyMaterial,
      KEY_LENGTH * 8
    );

    const computedHashB64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));

    // Constant-time comparison
    return timingSafeEqual(storedHashB64, computedHashB64);
  } catch (error) {
    console.error('Password verification error:', error);
    return false;
  }
}

/**
 * Constant-time string comparison to prevent timing attacks
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings are equal
 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
