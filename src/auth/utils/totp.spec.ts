import { randomBytes } from 'node:crypto';
import {
  base32Decode,
  base32Encode,
  buildOtpAuthUrl,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  hotp,
  verifyTotp,
} from './totp';

// RFC 6238 Appendix B secret (ASCII "12345678901234567890").
const RFC_SECRET = Buffer.from('12345678901234567890');

describe('TOTP utils', () => {
  it('matches the RFC 6238 SHA-1 test vectors (last 6 digits)', () => {
    const vectors: [number, string][] = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
    ];
    for (const [time, expected] of vectors) {
      expect(hotp(RFC_SECRET, Math.floor(time / 30))).toBe(expected);
    }
  });

  it('round-trips base32', () => {
    const buf = randomBytes(20);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    expect(base32Encode(RFC_SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('verifies codes within ±1 step and rejects replays', () => {
    const secret = base32Encode(RFC_SECRET);
    const now = 1111111109 * 1000;

    expect(verifyTotp(secret, '081804', -1, now)).toBe(37037036);
    // previous step still accepted (clock drift)
    expect(verifyTotp(secret, '081804', -1, now + 30_000)).toBe(37037036);
    // same step already used -> rejected
    expect(verifyTotp(secret, '081804', 37037036, now)).toBeNull();
    expect(verifyTotp(secret, '000000', -1, now)).toBeNull();
    expect(verifyTotp(secret, 'abc', -1, now)).toBeNull();
  });

  it('encrypts secrets with AES-GCM and detects tampering', () => {
    const key = randomBytes(32);
    const secret = generateTotpSecret();
    const encrypted = encryptSecret(key, secret);

    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(key, encrypted)).toBe(secret);
    expect(() => decryptSecret(randomBytes(32), encrypted)).toThrow();

    const [v, iv, tag, data] = encrypted.split(':');
    const tampered = [v, iv, tag, Buffer.from('x' + data).toString('base64')];
    expect(() => decryptSecret(key, tampered.join(':'))).toThrow();
  });

  it('builds an otpauth URL for authenticator apps', () => {
    expect(buildOtpAuthUrl('Technoastuce', 'a@b.co', 'ABC')).toBe(
      'otpauth://totp/Technoastuce%3Aa%40b.co?secret=ABC&issuer=Technoastuce&algorithm=SHA1&digits=6&period=30',
    );
  });
});
