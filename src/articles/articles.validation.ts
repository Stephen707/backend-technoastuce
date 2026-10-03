import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateBy,
} from 'class-validator';
import {
  hasRichTextContent,
  sanitizeRichText,
} from '../common/utils/rich-text';

// One line of plain text: no markup, no control characters (newlines
// included), so titles and alt texts are safe to render anywhere.
const SINGLE_LINE_TEXT = /^[^<>\p{Cc}]*$/u;

const normalizeLine = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value.normalize('NFC').trim().replace(/\s+/g, ' ')
    : value;

const sanitize = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? sanitizeRichText(value) : value;

export function IsSingleLineText(
  minLength: number,
  maxLength: number,
): PropertyDecorator {
  return applyDecorators(
    Transform(normalizeLine),
    IsString(),
    MinLength(minLength),
    MaxLength(maxLength),
    Matches(SINGLE_LINE_TEXT, {
      message: '$property must be a single line of plain text (no markup)',
    }),
  );
}

/**
 * Rich-text HTML: sanitized against an allowlist *before* validation, so
 * the length limit applies to what is stored, and it must still contain
 * text or an image once unsafe markup is gone.
 */
export function IsRichText(maxLength: number): PropertyDecorator {
  return applyDecorators(
    Transform(sanitize),
    IsString(),
    MaxLength(maxLength),
    ValidateBy({
      name: 'hasRichTextContent',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && hasRichTextContent(value),
        defaultMessage: () => '$property must not be empty',
      },
    }),
  );
}
