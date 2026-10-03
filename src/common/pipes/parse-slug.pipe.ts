import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '../utils/slug';

// Rejects malformed slugs in route params before they reach a query.
@Injectable()
export class ParseSlugPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (
      typeof value !== 'string' ||
      value.length > SLUG_MAX_LENGTH ||
      !SLUG_PATTERN.test(value)
    ) {
      throw new BadRequestException('Invalid slug');
    }
    return value;
  }
}
