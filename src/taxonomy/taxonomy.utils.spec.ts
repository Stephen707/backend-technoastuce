import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  buildCategoryListFilter,
  parseParentFilter,
} from './categories/categories.service';
import { buildTagListFilter } from './tags/tags.service';
import { parseSort, resolveSlug, rethrowDuplicate } from './taxonomy.utils';

describe('taxonomy utils', () => {
  describe('resolveSlug', () => {
    it('prefers the explicit slug', () => {
      expect(resolveSlug('custom', 'Windows 11')).toBe('custom');
    });

    it('derives the slug from the name', () => {
      expect(resolveSlug(undefined, 'Windows 11')).toBe('windows-11');
    });

    it('rejects names that yield no slug', () => {
      expect(() => resolveSlug(undefined, '日本語')).toThrow(
        BadRequestException,
      );
    });
  });

  it('parseSort adds _id as a stable tie-breaker', () => {
    expect(parseSort('-createdAt')).toEqual({ createdAt: -1, _id: -1 });
    expect(parseSort('position')).toEqual({ position: 1, _id: 1 });
  });

  describe('rethrowDuplicate', () => {
    const messages = { slug: 'slug taken', name: 'name taken' };

    it('maps a duplicate key error to a 409 by field', () => {
      expect(() =>
        rethrowDuplicate(
          { code: 11000, keyPattern: { parent: 1, name: 1 } },
          messages,
        ),
      ).toThrow(new ConflictException('name taken'));
      expect(() =>
        rethrowDuplicate({ code: 11000, keyPattern: { slug: 1 } }, messages),
      ).toThrow(new ConflictException('slug taken'));
    });

    it('rethrows any other error unchanged', () => {
      const err = new Error('boom');
      expect(() => rethrowDuplicate(err, messages)).toThrow(err);
    });
  });

  describe('list filters', () => {
    it('escapes the search term (no regex injection)', () => {
      expect(buildTagListFilter('c++ (.*)')).toEqual({
        name: { $regex: '^c\\+\\+ \\(\\.\\*\\)', $options: 'i' },
      });
    });

    it('filters categories by parent, including roots', () => {
      const id = new Types.ObjectId();
      expect(buildCategoryListFilter({ parent: null })).toEqual({
        parent: null,
      });
      expect(buildCategoryListFilter({ parent: id })).toEqual({ parent: id });
      expect(buildCategoryListFilter({})).toEqual({});
    });

    it('parses the parent query value', () => {
      const id = new Types.ObjectId();
      expect(parseParentFilter(undefined)).toBeUndefined();
      expect(parseParentFilter('root')).toBeNull();
      expect(parseParentFilter('ROOT')).toBeNull();
      expect(parseParentFilter(id.toHexString())?.equals(id)).toBe(true);
    });
  });
});
