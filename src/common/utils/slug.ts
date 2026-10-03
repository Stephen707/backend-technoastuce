export const SLUG_MAX_LENGTH = 80;

// Lowercase ASCII words joined by single hyphens: "windows-11-astuces".
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Builds a URL slug from a display name: accents are folded ("Réseau" ->
 * "reseau"), "+"/"#" are spelled out so "C", "C++" and "C#" don't collide,
 * and every other non-alphanumeric run becomes a single hyphen. Returns ''
 * when nothing usable is left (e.g. a name written only in CJK or emoji).
 */
export function slugify(value: string, maxLength = SLUG_MAX_LENGTH): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/#/g, ' sharp ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
}
