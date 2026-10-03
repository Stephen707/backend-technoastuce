import { redactUrl } from './redact';

describe('redactUrl', () => {
  it.each([
    ['/api/v1/articles', '/api/v1/articles'],
    ['/a?page=2&limit=10', '/a?page=2&limit=10'],
    [
      '/n/unsubscribe/one-click?token=abc123&x=1',
      '/n/unsubscribe/one-click?token=[REDACTED]&x=1',
    ],
    ['/a?Token=abc', '/a?Token=[REDACTED]'],
    ['/a?%74oken=abc', '/a?%74oken=[REDACTED]'], // encoded name
    ['/a?code=1&password=2&flag', '/a?code=[REDACTED]&password=[REDACTED]&flag'],
    ['/a?%E0%A4%A=1', '/a?%E0%A4%A=1'], // malformed encoding is kept
  ])('%s -> %s', (input, expected) => {
    expect(redactUrl(input)).toBe(expected);
  });
});
