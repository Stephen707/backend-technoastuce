import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '../common/utils/slug';

export const CATEGORY_NAME_MAX_LENGTH = 60;
export const TAG_NAME_MAX_LENGTH = 40;
export const DESCRIPTION_MAX_LENGTH = 500;

// Letters, digits and the punctuation tech names use: "C++", "C#", ".NET",
// "Node.js", "Hardware & Réseau", "Wi-Fi 6/6E". Rejects markup and control
// chars, so names are safe to render anywhere.
const TAXONOMY_NAME = /^[\p{L}\p{N}.#][\p{L}\p{M}\p{N} '’&.+#/(),:-]*$/u;

// Plain text only: no "<" / ">" (no HTML to sanitize downstream) and no
// control characters other than newlines and tabs.
const PLAIN_TEXT = /^(?:[^<>\p{Cc}]|[\n\t])*$/u;

const normalizeName = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value.normalize('NFC').trim().replace(/\s+/g, ' ')
    : value;

const normalizeText = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value.normalize('NFC').replace(/\r\n?/g, '\n').trim()
    : value;

const normalizeSlug = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * Like @IsOptional, but only skips `undefined`: an explicit `null` still
 * runs (and fails) the other validators. Use it for fields that can be
 * omitted but never cleared, so `{ "name": null }` can't unset them.
 */
export const IsOptionalNotNull = () =>
  ValidateIf((_object: object, value: unknown) => value !== undefined);

export function IsTaxonomyName(maxLength: number): PropertyDecorator {
  return applyDecorators(
    Transform(normalizeName),
    IsString(),
    MinLength(1),
    MaxLength(maxLength),
    Matches(TAXONOMY_NAME, {
      message:
        "$property may only contain letters, digits, spaces and . # + & ' / ( ) , : -",
    }),
  );
}

export function IsSlug(): PropertyDecorator {
  return applyDecorators(
    Transform(normalizeSlug),
    IsString(),
    MaxLength(SLUG_MAX_LENGTH),
    Matches(SLUG_PATTERN, {
      message:
        '$property must be lowercase letters and digits separated by single hyphens',
    }),
  );
}

export function IsPlainText(maxLength: number): PropertyDecorator {
  return applyDecorators(
    Transform(normalizeText),
    IsString(),
    MaxLength(maxLength),
    Matches(PLAIN_TEXT, {
      message: '$property must be plain text (no markup or control characters)',
    }),
  );
}
