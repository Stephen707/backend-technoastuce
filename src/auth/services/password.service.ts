import { Injectable, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

// OWASP-recommended Argon2id parameters (64 MiB, 3 passes, 4 lanes).
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 4,
} satisfies argon2.HashOptions;

@Injectable()
export class PasswordService implements OnModuleInit {
  // Used when the email is unknown so the response takes as long as a real
  // password check (prevents user enumeration by timing).
  private dummyHash: string;

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash('dummy-password-for-timing');
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(hash: string | undefined, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash ?? this.dummyHash, password);
    } catch {
      return false;
    }
  }

  // True when a stored hash uses weaker params than today's; rehash on login.
  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }
}
