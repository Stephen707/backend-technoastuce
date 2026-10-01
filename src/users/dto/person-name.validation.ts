import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const PERSON_NAME_MAX_LENGTH = 50;

// Letters (any script), combining marks, spaces, apostrophes, dots and
// hyphens: "Jean-Luc", "O'Brien", "Zoë". Rejects markup and control chars.
const PERSON_NAME = /^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u;

// Trims and collapses inner whitespace before validating.
const normalizeName = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export function IsPersonName(): PropertyDecorator {
  return applyDecorators(
    Transform(normalizeName),
    IsString(),
    MinLength(1),
    MaxLength(PERSON_NAME_MAX_LENGTH),
    Matches(PERSON_NAME, {
      message:
        '$property may only contain letters, spaces, apostrophes, dots and hyphens',
    }),
  );
}
