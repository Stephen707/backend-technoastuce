import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  deriveFromContent,
  publicArticleFilter,
  resolvePublishedAt,
  toArticleSummaryView,
  toArticleView,
} from './articles.service';
import { ArticleRecord } from './articles.types';
import {
  AdminListArticlesQueryDto,
  CreateArticleDto,
  ListArticlesQueryDto,
  UpdateArticleDto,
} from './dto/articles.dto';
import { ArticleStatus } from './schemas/article.schema';

// Same options as the global pipe in main.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function body<T>(metatype: new () => T, value: unknown): Promise<T> {
  return pipe.transform(value, { type: 'body', metatype }) as Promise<T>;
}

function query<T>(metatype: new () => T, value: unknown): Promise<T> {
  return pipe.transform(value, { type: 'query', metatype }) as Promise<T>;
}

async function errorsOf(promise: Promise<unknown>): Promise<string[]> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return ((err as BadRequestException).getResponse() as { message: string[] })
      .message;
  }
  throw new Error('Expected a validation error');
}

const ID = '64b7f0c2a1b2c3d4e5f60718';
const valid = { title: 'Astuce Windows', content: '<p>Bonjour</p>' };

describe('Article DTOs', () => {
  describe('CreateArticleDto', () => {
    it('accepts, normalizes and sanitizes a valid body', async () => {
      const dto = await body(CreateArticleDto, {
        title: '  Désactiver   la télémétrie ',
        content: '<p onclick="x">Texte</p><script>alert(1)</script>',
        excerpt: ' Résumé ',
        coverImage: { url: 'https://cdn.example.com/c.webp', alt: ' Capture ' },
        categoryId: ID,
        tagIds: [ID],
        status: 'PUBLISHED',
        publishedAt: '2026-01-02T03:04:05.000Z',
        commentsEnabled: false,
      });
      expect(dto).toMatchObject({
        title: 'Désactiver la télémétrie',
        content: '<p>Texte</p>',
        excerpt: 'Résumé',
        coverImage: { url: 'https://cdn.example.com/c.webp', alt: 'Capture' },
        status: ArticleStatus.PUBLISHED,
        commentsEnabled: false,
      });
      expect(dto.publishedAt).toEqual(new Date('2026-01-02T03:04:05.000Z'));
    });

    it('rejects content that is empty once sanitized', async () => {
      const errors = await errorsOf(
        body(CreateArticleDto, {
          ...valid,
          content: '<script>alert(1)</script>',
        }),
      );
      expect(errors.join()).toMatch(/content must not be empty/);
    });

    it.each([
      { title: 'ab' },
      { title: 'x'.repeat(151) },
      { title: '<b>Gras</b>' },
      { title: 'Bip\u0007 sonore' }, // newlines are collapsed, others rejected
      { title: { $gt: '' } },
      { content: { $ne: null } },
      { content: 'x'.repeat(150_001) },
      { slug: 'Pas Un Slug' },
      { excerpt: '<i>x</i>' },
      { coverImage: { url: 'http://cdn.example.com/c.webp' } },
      { coverImage: { url: 'javascript:alert(1)' } },
      { coverImage: { url: 'https://user:pw@cdn.example.com/c.webp' } },
      { coverImage: { url: 'https://cdn.example.com/c.webp', extra: 1 } },
      { coverImage: 'https://cdn.example.com/c.webp' },
      { categoryId: 'nope' },
      { tagIds: [ID, ID] },
      {
        tagIds: Array.from({ length: 11 }, () =>
          new Types.ObjectId().toHexString(),
        ),
      },
      { tagIds: [{ $ne: null }] },
      { status: 'DELETED' },
      { publishedAt: 'yesterday' },
      { publishedAt: '1999-12-31T00:00:00Z' },
      { commentsEnabled: 'true' },
    ])('rejects %j', async (extra) => {
      await errorsOf(body(CreateArticleDto, { ...valid, ...extra }));
    });

    it('rejects unknown fields (mass assignment)', async () => {
      const errors = await errorsOf(
        body(CreateArticleDto, {
          ...valid,
          author: ID,
          commentCount: 1000,
          readingTimeMinutes: 1,
        }),
      );
      expect(errors).toEqual(
        expect.arrayContaining([
          'property author should not exist',
          'property commentCount should not exist',
          'property readingTimeMinutes should not exist',
        ]),
      );
    });
  });

  describe('UpdateArticleDto', () => {
    it('accepts null where it clears a value', async () => {
      const dto = await body(UpdateArticleDto, {
        coverImage: null,
        categoryId: null,
        publishedAt: null,
        tagIds: [],
        excerpt: '',
      });
      expect(dto).toMatchObject({
        coverImage: null,
        categoryId: null,
        publishedAt: null,
        tagIds: [],
        excerpt: '',
      });
    });

    it('rejects null for fields that cannot be cleared', async () => {
      for (const field of [
        'title',
        'slug',
        'content',
        'status',
        'tagIds',
        'commentsEnabled',
      ]) {
        await errorsOf(body(UpdateArticleDto, { [field]: null }));
      }
    });
  });

  describe('list queries', () => {
    it('applies defaults', async () => {
      await expect(query(ListArticlesQueryDto, {})).resolves.toMatchObject({
        page: 1,
        limit: 20,
        sort: '-publishedAt',
      });
      await expect(query(AdminListArticlesQueryDto, {})).resolves.toMatchObject(
        { sort: '-createdAt' },
      );
    });

    it('rejects operators, unknown sorts and bad filters', async () => {
      await errorsOf(query(ListArticlesQueryDto, { search: { $ne: '' } }));
      await errorsOf(query(ListArticlesQueryDto, { sort: 'title' }));
      await errorsOf(query(ListArticlesQueryDto, { category: 'Bad Slug' }));
      await errorsOf(query(ListArticlesQueryDto, { status: 'DRAFT' }));
      await errorsOf(query(AdminListArticlesQueryDto, { status: 'nope' }));
      await errorsOf(query(AdminListArticlesQueryDto, { tagId: 'x' }));
      await errorsOf(query(ListArticlesQueryDto, { limit: '101' }));
    });
  });
});

describe('Article helpers', () => {
  it('publicArticleFilter only matches published, already-due articles', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(publicArticleFilter(now)).toEqual({
      status: ArticleStatus.PUBLISHED,
      publishedAt: { $lte: now },
    });
  });

  it('resolvePublishedAt dates publications and keeps explicit dates', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const later = new Date('2026-06-01T00:00:00Z');
    expect(resolvePublishedAt(ArticleStatus.PUBLISHED, undefined, now)).toBe(
      now,
    );
    expect(resolvePublishedAt(ArticleStatus.PUBLISHED, later, now)).toBe(later);
    expect(resolvePublishedAt(ArticleStatus.DRAFT, null, now)).toBeNull();
    expect(resolvePublishedAt(ArticleStatus.DRAFT, later, now)).toBe(later);
  });

  it('deriveFromContent builds an excerpt and a reading time', () => {
    const words = Array(450).fill('mot').join(' ');
    const derived = deriveFromContent(`<h2>Titre</h2><p>${words}</p>`);
    expect(derived.readingTimeMinutes).toBe(3);
    expect(derived.excerpt.length).toBeLessThanOrEqual(200);
    expect(derived.excerpt.startsWith('Titre mot mot')).toBe(true);
    expect(derived.excerpt.endsWith('…')).toBe(true);
  });

  it('maps records to an allowlisted view, skipping deleted refs', () => {
    const tagId = new Types.ObjectId();
    const record: ArticleRecord = {
      _id: new Types.ObjectId(),
      title: 'T',
      slug: 't',
      excerpt: 'E',
      content: '<p>C</p>',
      coverImage: { url: 'https://cdn.example.com/c.webp' },
      author: { _id: new Types.ObjectId(), firstName: 'Ada' },
      category: null,
      tags: [{ _id: tagId, name: 'Linux', slug: 'linux' }, null],
      status: ArticleStatus.PUBLISHED,
      publishedAt: new Date(),
      readingTimeMinutes: 1,
      commentsEnabled: true,
      commentCount: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const summary = toArticleSummaryView(record);
    expect(summary).not.toHaveProperty('content');
    expect(summary).not.toHaveProperty('_id');
    expect(summary.author).toEqual({
      id: record.author!._id.toHexString(),
      name: 'Ada',
    });
    expect(summary.coverImage).toEqual({
      url: 'https://cdn.example.com/c.webp',
      alt: null,
    });
    expect(summary.tags).toEqual([
      { id: tagId.toHexString(), name: 'Linux', slug: 'linux' },
    ]);
    expect(toArticleView(record).content).toBe('<p>C</p>');
  });
});
