import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuthUser } from '../auth/auth.types';
import { Role } from '../users/schemas/user.schema';
import {
  buildCommentListFilter,
  canModerate,
  isEditable,
  toCommentView,
} from './comments.service';
import {
  AdminListCommentsQueryDto,
  CreateCommentDto,
  ListCommentsQueryDto,
  ModerateCommentDto,
  UpdateCommentDto,
} from './dto/comments.dto';
import {
  COMMENT_EDIT_WINDOW_MS,
  CommentStatus,
} from './schemas/comment.schema';

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

async function expectInvalid(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(BadRequestException);
}

function user(role: Role, mfaVerified: boolean): AuthUser {
  return {
    id: new Types.ObjectId().toHexString(),
    email: 'x@test.local',
    role,
    sessionId: 's',
    mfaVerified,
  };
}

describe('Comment DTOs', () => {
  it('accepts and normalizes plain text', async () => {
    const dto = await body(CreateCommentDto, {
      content: '  Merci !\r\nTrès utile.  ',
      parentId: '64b7f0c2a1b2c3d4e5f60718',
    });
    expect(dto.content).toBe('Merci !\nTrès utile.');
  });

  it.each([
    { content: '' },
    { content: '   ' },
    { content: '<script>alert(1)</script>' },
    { content: 'x'.repeat(2001) },
    { content: { $ne: '' } },
    { content: 'ok', parentId: 'nope' },
    { content: 'ok', author: '64b7f0c2a1b2c3d4e5f60718' },
    { content: 'ok', status: 'PUBLISHED' },
  ])('rejects %j', async (value) => {
    await expectInvalid(body(CreateCommentDto, value));
  });

  it('only lets the content be edited', async () => {
    await expectInvalid(
      body(UpdateCommentDto, { content: 'ok', parentId: null }),
    );
    await expect(body(UpdateCommentDto, { content: 'ok' })).resolves.toEqual(
      expect.objectContaining({ content: 'ok' }),
    );
  });

  it('validates moderation statuses', async () => {
    await expectInvalid(body(ModerateCommentDto, { status: 'DELETED' }));
    await expect(
      body(ModerateCommentDto, { status: 'HIDDEN' }),
    ).resolves.toEqual(
      expect.objectContaining({ status: CommentStatus.HIDDEN }),
    );
  });

  it('caps comment pages at 50 and validates filters', async () => {
    await expect(query(ListCommentsQueryDto, {})).resolves.toMatchObject({
      page: 1,
      limit: 20,
      sort: '-createdAt',
    });
    await expectInvalid(query(ListCommentsQueryDto, { limit: '51' }));
    await expectInvalid(query(ListCommentsQueryDto, { sort: 'author' }));
    await expectInvalid(query(AdminListCommentsQueryDto, { articleId: 'x' }));
    await expectInvalid(
      query(AdminListCommentsQueryDto, { status: { $ne: 'HIDDEN' } }),
    );
  });
});

describe('Comment helpers', () => {
  it('only lets 2FA-verified admins moderate', () => {
    expect(canModerate(user(Role.USER, true))).toBe(false);
    expect(canModerate(user(Role.ADMIN, false))).toBe(false);
    expect(canModerate(user(Role.ADMIN, true))).toBe(true);
    expect(canModerate(user(Role.SUPER_ADMIN, true))).toBe(true);
  });

  it('allows edits within the edit window only', () => {
    const now = Date.now();
    expect(isEditable(new Date(now - 1000), now)).toBe(true);
    expect(isEditable(new Date(now - COMMENT_EDIT_WINDOW_MS - 1), now)).toBe(
      false,
    );
  });

  it('builds filters from typed values only', () => {
    const article = new Types.ObjectId();
    expect(buildCommentListFilter({})).toEqual({});
    expect(
      buildCommentListFilter({ status: CommentStatus.HIDDEN, article }),
    ).toEqual({ status: CommentStatus.HIDDEN, article });
  });

  it('maps a record to a view without the author email', () => {
    const view = toCommentView({
      _id: new Types.ObjectId(),
      article: new Types.ObjectId(),
      parent: null,
      author: null,
      content: 'x',
      status: CommentStatus.PUBLISHED,
      replyCount: 0,
      editedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(view).toMatchObject({ parentId: null, author: null });
    expect(view).not.toHaveProperty('updatedAt');
  });
});
