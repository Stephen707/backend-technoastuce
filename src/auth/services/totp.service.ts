import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Config } from '../../config/configuration';
import {
  buildOtpAuthUrl,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  verifyTotp,
} from '../utils/totp';

/**
 * TOTP two-factor auth. Secrets are stored encrypted (AES-256-GCM with
 * TWO_FACTOR_ENCRYPTION_KEY) so a DB leak alone can't generate codes.
 */
@Injectable()
export class TotpService {
  private readonly key: Buffer;
  private readonly issuer: string;

  constructor(config: ConfigService<Config, true>) {
    const auth = config.get('auth', { infer: true });
    this.key = Buffer.from(auth.twoFactorEncryptionKey, 'base64');
    this.issuer = auth.appName;
  }

  generateSecret(): string {
    return generateTotpSecret();
  }

  buildOtpAuthUrl(secret: string, accountName: string): string {
    return buildOtpAuthUrl(this.issuer, accountName, secret);
  }

  verify(secret: string, code: string, lastUsedStep?: number): number | null {
    return verifyTotp(secret, code, lastUsedStep);
  }

  encrypt(plain: string): string {
    return encryptSecret(this.key, plain);
  }

  decrypt(payload: string): string {
    return decryptSecret(this.key, payload);
  }
}
