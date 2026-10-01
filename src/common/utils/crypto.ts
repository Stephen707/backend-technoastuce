import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Opaque, URL-safe random token (default 256 bits of entropy).
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// Tokens are high-entropy, so a fast hash is enough (no need for argon2):
// a DB leak doesn't reveal usable tokens, and lookups stay indexable.
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
