import {
  hasRichTextContent,
  readingTimeMinutes,
  richTextToPlainText,
  sanitizeRichText,
  truncatePlainText,
} from './rich-text';

describe('sanitizeRichText', () => {
  it('keeps the formatting an article needs', () => {
    const html =
      '<h2>Titre</h2><p>Du <strong>gras</strong>, de l\'<em>italique</em> et <code class="language-powershell">Get-Process</code>.</p>' +
      '<ul><li>un</li></ul><pre class="language-bash"><code>ls -la</code></pre>' +
      '<table><thead><tr><th scope="col">A</th></tr></thead><tbody><tr><td colspan="2">1</td></tr></tbody></table>';
    expect(sanitizeRichText(html)).toBe(html);
  });

  it.each([
    ['<script>alert(1)</script><p>ok</p>', '<p>ok</p>'],
    ['<style>p{}</style><p>ok</p>', '<p>ok</p>'],
    ['<p onclick="alert(1)" style="color:red">ok</p>', '<p>ok</p>'],
    ['<a href="javascript:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="//evil.example/x">x</a>', '<a>x</a>'],
    ['<img src="data:image/png;base64,AAAA">', '<img loading="lazy" />'],
    ['<img src="http://cdn.example.com/a.png">', '<img loading="lazy" />'],
    ['<iframe src="https://evil.example"></iframe><p>ok</p>', '<p>ok</p>'],
    ['<svg><script>alert(1)</script></svg>', ''],
    ['<form><input name="password"></form>', ''],
  ])('neutralizes %s', (input, expected) => {
    expect(sanitizeRichText(input)).toBe(expected);
  });

  it('turns <h1> into <h2> (the page title is the only <h1>)', () => {
    expect(sanitizeRichText('<h1>Titre</h1>')).toBe('<h2>Titre</h2>');
  });

  it('drops unknown code classes and keeps language-*', () => {
    expect(sanitizeRichText('<code class="language-c++ evil">x</code>')).toBe(
      '<code class="language-c++">x</code>',
    );
  });

  it('only keeps target="_blank" on links, always with a safe rel', () => {
    expect(
      sanitizeRichText(
        '<a href="https://example.com" target="_blank" rel="opener">x</a>',
      ),
    ).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>',
    );
    expect(
      sanitizeRichText(
        '<a href="/articles/x" target="_top" rel="opener">x</a>',
      ),
    ).toBe('<a href="/articles/x">x</a>');
  });

  it('keeps https images with numeric dimensions only', () => {
    expect(
      sanitizeRichText(
        '<img src="https://cdn.example.com/a.png" alt="A" width="640" height="100%" onerror="x">',
      ),
    ).toBe(
      '<img loading="lazy" src="https://cdn.example.com/a.png" alt="A" width="640" />',
    );
  });

  it('escapes text so stored HTML stays well-formed', () => {
    expect(sanitizeRichText('<p>a < b & "c"</p>')).toBe(
      '<p>a &lt; b &amp; "c"</p>',
    );
  });
});

describe('richTextToPlainText', () => {
  it('separates blocks, decodes entities and collapses whitespace', () => {
    const html = sanitizeRichText(
      '<h2>Intro</h2><p>a &lt; b&nbsp;&amp; c&#39;s &#x263A;</p>\n\n<ul><li>un</li><li>deux</li></ul>',
    );
    expect(richTextToPlainText(html)).toBe("Intro a < b & c's ☺ un deux");
  });
});

describe('hasRichTextContent', () => {
  it('is true for text or an image, false for empty markup', () => {
    expect(hasRichTextContent('<p>x</p>')).toBe(true);
    expect(
      hasRichTextContent(
        '<img loading="lazy" src="https://a.example/x.png" />',
      ),
    ).toBe(true);
    expect(hasRichTextContent('<p> </p><br />')).toBe(false);
    expect(hasRichTextContent('')).toBe(false);
  });
});

describe('readingTimeMinutes', () => {
  it('rounds up at 200 words per minute, at least 1 minute', () => {
    expect(readingTimeMinutes('')).toBe(1);
    expect(readingTimeMinutes(Array(200).fill('mot').join(' '))).toBe(1);
    expect(readingTimeMinutes(Array(201).fill('mot').join(' '))).toBe(2);
  });
});

describe('truncatePlainText', () => {
  it('keeps short text and cuts long text at a word boundary', () => {
    expect(truncatePlainText('court', 10)).toBe('court');
    expect(truncatePlainText('un deux trois quatre', 12)).toBe('un deux…');
  });

  it('removes markup characters and control chars', () => {
    expect(truncatePlainText('a < b > c\u0007', 50)).toBe('a  b  c');
  });
});
