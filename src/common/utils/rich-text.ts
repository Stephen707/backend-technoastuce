import sanitizeHtml from 'sanitize-html';

// Words per minute used for the "x min read" estimate.
const READING_WPM = 200;

const DIMENSION = /^\d{1,4}$/;
const CODE_LANGUAGE_CLASS = /^language-[a-z0-9+#-]{1,30}$/;

/**
 * Allowlist for article bodies written in a rich-text editor. Everything
 * else is dropped: scripts/styles (with their content), event handlers,
 * inline styles, iframes, forms, `javascript:` / `data:` URLs and
 * protocol-relative URLs. Images must be served over https.
 */
const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h2',
    'h3',
    'h4',
    'p',
    'br',
    'hr',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'mark',
    'sub',
    'sup',
    'blockquote',
    'ul',
    'ol',
    'li',
    'a',
    'code',
    'pre',
    'kbd',
    'img',
    'figure',
    'figcaption',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    code: ['class'],
    pre: ['class'],
    ol: ['start'],
    th: ['colspan', 'rowspan', 'scope'],
    td: ['colspan', 'rowspan'],
  },
  allowedClasses: {
    code: [CODE_LANGUAGE_CLASS],
    pre: [CODE_LANGUAGE_CLASS],
  },
  allowedSchemes: ['https', 'http', 'mailto'],
  allowedSchemesByTag: { img: ['https'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    // The page title is the only <h1>.
    h1: 'h2',
    // Only `target="_blank"` is kept, always with a safe `rel`.
    a: (tagName, attribs) => {
      const out: sanitizeHtml.Attributes = {};
      if (attribs.href) out.href = attribs.href;
      if (attribs.title) out.title = attribs.title;
      if (attribs.target === '_blank') {
        out.target = '_blank';
        out.rel = 'noopener noreferrer';
      }
      return { tagName, attribs: out };
    },
    img: (tagName, attribs) => {
      const out: sanitizeHtml.Attributes = { loading: 'lazy' };
      for (const key of ['src', 'alt', 'title'] as const) {
        if (attribs[key] !== undefined) out[key] = attribs[key];
      }
      for (const key of ['width', 'height'] as const) {
        if (DIMENSION.test(attribs[key] ?? '')) out[key] = attribs[key];
      }
      return { tagName, attribs: out };
    },
  },
};

/** Returns HTML that is safe to render as is (see RICH_TEXT_OPTIONS). */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, RICH_TEXT_OPTIONS).trim();
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const point =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * Plain text of HTML produced by sanitizeRichText (attribute values there
 * are escaped, so stripping tags with a regex is reliable). Blocks are
 * separated by spaces and whitespace is collapsed.
 */
export function richTextToPlainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the HTML has visible text or at least one image. */
export function hasRichTextContent(html: string): boolean {
  return richTextToPlainText(html).length > 0 || /<img\s/i.test(html);
}

export function readingTimeMinutes(text: string): number {
  const words = text ? text.split(' ').length : 0;
  return Math.max(1, Math.ceil(words / READING_WPM));
}

/**
 * Cuts plain text at a word boundary, adding an ellipsis when shortened.
 * Markup and control characters are removed so the result passes the
 * plain-text rules used for excerpts.
 */
export function truncatePlainText(text: string, maxLength: number): string {
  const clean = text.replace(/[<>\p{Cc}]/gu, '').trim();
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
