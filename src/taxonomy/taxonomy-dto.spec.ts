import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from './categories/dto/categories.dto';
import {
  CreateTagDto,
  ListTagsQueryDto,
  UpdateTagDto,
} from './tags/dto/tags.dto';

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
    const res = (err as BadRequestException).getResponse() as {
      message: string[];
    };
    return res.message;
  }
  throw new Error('Expected a validation error');
}

describe('Taxonomy DTOs', () => {
  describe('CreateCategoryDto', () => {
    it('accepts and normalizes a valid body', async () => {
      const dto = await body(CreateCategoryDto, {
        name: '  Hardware   &  Réseau ',
        slug: ' Hardware-Reseau ',
        description: 'Line 1\r\nLine 2  ',
        parentId: '64b7f0c2a1b2c3d4e5f60718',
        position: 3,
      });
      expect(dto).toMatchObject({
        name: 'Hardware & Réseau',
        slug: 'hardware-reseau',
        description: 'Line 1\nLine 2',
        position: 3,
      });
    });

    it.each(['C++', 'C#', '.NET', 'Node.js', 'Wi-Fi 6/6E', "L'astuce (v2)"])(
      'accepts the tech name %s',
      async (name) => {
        await expect(body(CreateCategoryDto, { name })).resolves.toBeDefined();
      },
    );

    it.each([
      '<script>alert(1)</script>',
      'a<b',
      '-leading',
      '',
      '   ',
      'x'.repeat(61),
      'nul\u0000byte',
    ])('rejects the name %j', async (name) => {
      await errorsOf(body(CreateCategoryDto, { name }));
    });

    it('rejects markup and control characters in descriptions', async () => {
      for (const description of ['<b>bold</b>', 'bell\u0007']) {
        const errors = await errorsOf(
          body(CreateCategoryDto, { name: 'Ok', description }),
        );
        expect(errors.join()).toMatch(/plain text/);
      }
    });

    it('rejects malformed slugs and parent ids', async () => {
      for (const extra of [
        { slug: 'Not A Slug' },
        { slug: 'double--hyphen' },
        { slug: 'x'.repeat(81) },
        { parentId: 'not-an-id' },
        { position: -1 },
        { position: '3' }, // body numbers are never coerced from strings
        { position: 1.5 },
      ]) {
        await errorsOf(body(CreateCategoryDto, { name: 'Ok', ...extra }));
      }
    });

    it('rejects Mongo operators instead of strings (NoSQL injection)', async () => {
      await errorsOf(body(CreateCategoryDto, { name: { $gt: '' } }));
      await errorsOf(
        body(CreateCategoryDto, { name: 'Ok', parentId: { $ne: null } }),
      );
    });

    it('rejects unknown fields (mass assignment)', async () => {
      const errors = await errorsOf(
        body(CreateCategoryDto, {
          name: 'Ok',
          ancestors: [],
          _id: '64b7f0c2a1b2c3d4e5f60718',
          createdAt: '2020-01-01',
        }),
      );
      expect(errors).toEqual(
        expect.arrayContaining([
          'property ancestors should not exist',
          'property _id should not exist',
          'property createdAt should not exist',
        ]),
      );
    });
  });

  describe('UpdateCategoryDto', () => {
    it('accepts parentId: null (move to root)', async () => {
      const dto = await body(UpdateCategoryDto, { parentId: null });
      expect(dto.parentId).toBeNull();
    });

    it('accepts an empty description (clears it)', async () => {
      const dto = await body(UpdateCategoryDto, { description: '  ' });
      expect(dto.description).toBe('');
    });

    it('rejects null for fields that cannot be cleared', async () => {
      for (const field of ['name', 'slug', 'position', 'description']) {
        await errorsOf(body(UpdateCategoryDto, { [field]: null }));
      }
    });
  });

  describe('Tag DTOs', () => {
    it('validates names like categories, with a shorter limit', async () => {
      await expect(body(CreateTagDto, { name: 'PowerShell' })).resolves.toEqual(
        expect.objectContaining({ name: 'PowerShell' }),
      );
      await errorsOf(body(CreateTagDto, { name: 'x'.repeat(41) }));
      await errorsOf(body(UpdateTagDto, { name: null }));
      await errorsOf(body(CreateTagDto, { name: 'Ok', color: 'red' }));
    });
  });

  describe('list queries', () => {
    it('applies defaults and coerces paging values', async () => {
      const q = await query(ListCategoriesQueryDto, { page: '2', limit: '5' });
      expect(q).toMatchObject({ page: 2, limit: 5, sort: 'position' });
      const t = await query(ListTagsQueryDto, {});
      expect(t).toMatchObject({ page: 1, limit: 20, sort: 'name' });
    });

    it('caps the page size and validates sort and parent', async () => {
      await errorsOf(query(ListTagsQueryDto, { limit: '101' }));
      await errorsOf(query(ListTagsQueryDto, { sort: 'passwordHash' }));
      await errorsOf(query(ListCategoriesQueryDto, { parent: 'nope' }));
      await errorsOf(query(ListCategoriesQueryDto, { search: { $ne: '' } }));
      await expect(
        query(ListCategoriesQueryDto, { parent: 'root' }),
      ).resolves.toMatchObject({ parent: 'root' });
    });
  });
});
