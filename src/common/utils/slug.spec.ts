import { SLUG_MAX_LENGTH, SLUG_PATTERN, slugify } from './slug';

describe('slugify', () => {
  it.each([
    ['Windows 11', 'windows-11'],
    ['Réseaux & Sécurité', 'reseaux-securite'],
    ['  Trucs   et  astuces  ', 'trucs-et-astuces'],
    ['C++', 'c-plus-plus'],
    ['C#', 'c-sharp'],
    ['.NET', 'net'],
    ['Node.js', 'node-js'],
    ['Œuvre çà', 'uvre-ca'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('returns an empty string when nothing usable is left', () => {
    expect(slugify('日本語')).toBe('');
    expect(slugify('---')).toBe('');
  });

  it('truncates without leaving a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(SLUG_MAX_LENGTH - 1)} bcd`);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug).toMatch(SLUG_PATTERN);
  });

  it('always produces a slug matching SLUG_PATTERN', () => {
    for (const name of ['Hardware / Réseau (2025)', 'A -- B', 'x']) {
      expect(slugify(name)).toMatch(SLUG_PATTERN);
    }
  });
});
