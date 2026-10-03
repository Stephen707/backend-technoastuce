import { BadRequestException, ConflictException } from '@nestjs/common';
import { SortOrder } from 'mongoose';
import { slugify } from '../common/utils/slug';

// An explicit slug wins; otherwise it is derived from the name.
export function resolveSlug(slug: string | undefined, name: string): string {
  const resolved = slug ?? slugify(name);
  if (!resolved) {
    throw new BadRequestException(
      'Could not derive a slug from the name, please provide one',
    );
  }
  return resolved;
}

// "-createdAt" -> { createdAt: -1, _id: -1 }; _id keeps paging stable.
export function parseSort(sort: string): Record<string, SortOrder> {
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  const order: SortOrder = desc ? -1 : 1;
  return { [field]: order, _id: order };
}

interface MongoDuplicateKeyError {
  code: 11000;
  keyPattern?: Record<string, unknown>;
}

function isDuplicateKeyError(err: unknown): err is MongoDuplicateKeyError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 11000
  );
}

/**
 * Turns a unique-index violation into a 409 with a readable message picked
 * by the violated field (`slug`, `name`); rethrows anything else as is.
 * The unique indexes, not a prior lookup, are the source of truth, so two
 * concurrent creates can't both succeed.
 */
export function rethrowDuplicate(
  err: unknown,
  messages: Record<string, string>,
): never {
  if (isDuplicateKeyError(err)) {
    const fields = Object.keys(err.keyPattern ?? {});
    const field = Object.keys(messages).find((f) => fields.includes(f));
    throw new ConflictException(
      field ? messages[field] : 'This value is already used',
    );
  }
  throw err;
}
