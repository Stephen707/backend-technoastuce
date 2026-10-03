import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { ArticlesService } from '../articles/articles.service';
import type { AuthUser } from '../auth/auth.types';
import { Paginated, toPage } from '../common/types/paginated';
import { parseSort } from '../taxonomy/taxonomy.utils';
import { AUTHOR_PROJECTION, toAuthorView } from '../users/author-view';
import { PRIVILEGED_ROLES } from '../users/schemas/user.schema';
import {
  CommentListFilters,
  CommentRecord,
  CommentView,
} from './comments.types';
import {
  AdminListCommentsQueryDto,
  CreateCommentDto,
  ListCommentsQueryDto,
  ListRepliesQueryDto,
  ModerateCommentDto,
  UpdateCommentDto,
} from './dto/comments.dto';
import {
  Comment,
  COMMENT_EDIT_WINDOW_MS,
  CommentStatus,
} from './schemas/comment.schema';

const COMMENT_PROJECTION =
  'article parent author content status replyCount editedAt createdAt updatedAt';

type CommentMeta = Pick<
  CommentRecord,
  '_id' | 'article' | 'parent' | 'status'
> & { author: Types.ObjectId; createdAt: Date };

const META_PROJECTION = 'article parent author status createdAt';

export function toCommentView(c: CommentRecord): CommentView {
  return {
    id: c._id.toHexString(),
    articleId: c.article.toHexString(),
    parentId: c.parent ? c.parent.toHexString() : null,
    author: toAuthorView(c.author),
    content: c.content,
    status: c.status,
    replyCount: c.replyCount,
    editedAt: c.editedAt,
    createdAt: c.createdAt,
  };
}

// Filter values are ObjectIds / enum values typed by the DTOs.
export function buildCommentListFilter(
  filters: CommentListFilters,
): QueryFilter<Comment> {
  const filter: QueryFilter<Comment> = {};
  if (filters.status) filter.status = filters.status;
  if (filters.article) filter.article = filters.article;
  return filter;
}

// Admins and super admins with a 2FA-verified session can moderate.
export function canModerate(user: AuthUser): boolean {
  return PRIVILEGED_ROLES.includes(user.role) && user.mfaVerified;
}

export function isEditable(createdAt: Date, now = Date.now()): boolean {
  return now - createdAt.getTime() <= COMMENT_EDIT_WINDOW_MS;
}

/**
 * Comments on published articles, one level of replies. Counters
 * (`article.commentCount`, `comment.replyCount`) count PUBLISHED comments
 * and are moved with atomic `$inc`-style updates on every transition.
 * The public only sees PUBLISHED comments of public articles.
 */
@Injectable()
export class CommentsService {
  private readonly audit = new Logger('Audit');

  constructor(
    @InjectModel(Comment.name) private readonly model: Model<Comment>,
    private readonly articles: ArticlesService,
  ) {}

  // ----------------------------------------------------------------- public

  async listForArticle(
    articleId: Types.ObjectId,
    query: ListCommentsQueryDto,
  ): Promise<Paginated<CommentView>> {
    await this.findArticleOrThrow(articleId);
    return this.findPage(
      { article: articleId, parent: null, status: CommentStatus.PUBLISHED },
      query.sort,
      query.page,
      query.limit,
    );
  }

  async listReplies(
    commentId: Types.ObjectId,
    query: ListRepliesQueryDto,
  ): Promise<Paginated<CommentView>> {
    const parent = await this.model
      .findOne({
        _id: commentId,
        parent: null,
        status: CommentStatus.PUBLISHED,
      })
      .select('article')
      .lean<Pick<CommentMeta, '_id' | 'article'>>()
      .exec();
    if (!parent) throw new NotFoundException('Comment not found');
    await this.findArticleOrThrow(parent.article);
    return this.findPage(
      { parent: commentId, status: CommentStatus.PUBLISHED },
      'createdAt',
      query.page,
      query.limit,
    );
  }

  // ---------------------------------------------------------------- authors

  async create(
    actor: AuthUser,
    articleId: Types.ObjectId,
    dto: CreateCommentDto,
  ): Promise<CommentView> {
    const article = await this.findArticleOrThrow(articleId);
    if (!article.commentsEnabled) {
      throw new ForbiddenException('Comments are closed for this article');
    }

    let parent: Types.ObjectId | null = null;
    if (dto.parentId !== undefined) {
      const found = await this.model
        .findOne({
          _id: new Types.ObjectId(dto.parentId),
          article: articleId,
          status: CommentStatus.PUBLISHED,
        })
        .select('parent')
        .lean<Pick<CommentMeta, '_id' | 'parent'>>()
        .exec();
      if (!found) throw new BadRequestException('Parent comment not found');
      if (found.parent) {
        throw new BadRequestException(
          'Replies can only be made to top-level comments',
        );
      }
      parent = found._id;
    }

    // Explicit field mapping: the DTO is never spread into the document.
    const doc = await this.model.create({
      article: articleId,
      author: new Types.ObjectId(actor.id),
      parent,
      content: dto.content,
    });
    await Promise.all([
      this.articles.adjustCommentCount(articleId, 1),
      parent ? this.adjustReplyCount(parent, 1) : undefined,
    ]);
    return this.getView(doc._id);
  }

  // Only the author, and only within COMMENT_EDIT_WINDOW_MS.
  async update(
    actor: AuthUser,
    id: Types.ObjectId,
    dto: UpdateCommentDto,
  ): Promise<CommentView> {
    const comment = await this.findMetaOrThrow(id);
    if (!comment.author.equals(actor.id)) {
      throw new ForbiddenException('You can only edit your own comments');
    }
    if (!isEditable(comment.createdAt)) {
      throw new ForbiddenException('This comment can no longer be edited');
    }

    const res = await this.model
      .updateOne(
        {
          _id: id,
          author: comment.author,
          createdAt: { $gte: new Date(Date.now() - COMMENT_EDIT_WINDOW_MS) },
        },
        { $set: { content: dto.content, editedAt: new Date() } },
        { runValidators: true },
      )
      .exec();
    if (res.matchedCount === 0)
      throw new NotFoundException('Comment not found');
    return this.getView(id);
  }

  // The author or a moderator. Deleting a top-level comment deletes its
  // replies as well.
  async remove(actor: AuthUser, id: Types.ObjectId): Promise<void> {
    const comment = await this.findMetaOrThrow(id);
    const isAuthor = comment.author.equals(actor.id);
    if (!isAuthor && !canModerate(actor)) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    const deleted = await this.model
      .findOneAndDelete({ _id: id })
      .select(META_PROJECTION)
      .lean<CommentMeta>()
      .exec();
    if (!deleted) throw new NotFoundException('Comment not found');

    let removed = deleted.status === CommentStatus.PUBLISHED ? 1 : 0;
    let replies = 0;
    if (deleted.parent === null) {
      const published = await this.model
        .deleteMany({ parent: id, status: CommentStatus.PUBLISHED })
        .exec();
      const others = await this.model.deleteMany({ parent: id }).exec();
      removed += published.deletedCount;
      replies = published.deletedCount + others.deletedCount;
    } else if (deleted.status === CommentStatus.PUBLISHED) {
      await this.adjustReplyCount(deleted.parent, -1);
    }
    await this.articles.adjustCommentCount(deleted.article, -removed);

    if (!isAuthor) {
      this.audit.log(
        `comment.deleted actor=${actor.id} id=${id.toHexString()} article=${deleted.article.toHexString()} replies=${replies}`,
      );
    }
  }

  // ------------------------------------------------------------- moderation

  async listAll(
    query: AdminListCommentsQueryDto,
  ): Promise<Paginated<CommentView>> {
    const filter = buildCommentListFilter({
      status: query.status,
      article: query.articleId
        ? new Types.ObjectId(query.articleId)
        : undefined,
    });
    return this.findPage(filter, query.sort, query.page, query.limit);
  }

  async moderate(
    actor: AuthUser,
    id: Types.ObjectId,
    dto: ModerateCommentDto,
  ): Promise<CommentView> {
    // Only matches a real transition, so concurrent identical requests
    // move the counters once.
    const before = await this.model
      .findOneAndUpdate(
        { _id: id, status: { $ne: dto.status } },
        { $set: { status: dto.status } },
        { returnDocument: 'before' },
      )
      .select(META_PROJECTION)
      .lean<CommentMeta>()
      .exec();

    if (before) {
      const delta = dto.status === CommentStatus.PUBLISHED ? 1 : -1;
      await Promise.all([
        this.articles.adjustCommentCount(before.article, delta),
        before.parent ? this.adjustReplyCount(before.parent, delta) : undefined,
      ]);
      this.audit.log(
        `comment.moderated actor=${actor.id} id=${id.toHexString()} status=${dto.status}`,
      );
    }
    // Not found, or already in that status (no-op).
    return this.getView(id);
  }

  // --------------------------------------------------------------- helpers

  private async findArticleOrThrow(id: Types.ObjectId) {
    const article = await this.articles.findCommentTarget(id);
    if (!article) throw new NotFoundException('Article not found');
    return article;
  }

  private async findMetaOrThrow(id: Types.ObjectId): Promise<CommentMeta> {
    const comment = await this.model
      .findById(id)
      .select(META_PROJECTION)
      .lean<CommentMeta>()
      .exec();
    if (!comment) throw new NotFoundException('Comment not found');
    return comment;
  }

  private async getView(id: Types.ObjectId): Promise<CommentView> {
    const comment = await this.model
      .findById(id)
      .select(COMMENT_PROJECTION)
      .populate({ path: 'author', select: AUTHOR_PROJECTION })
      .lean<CommentRecord>()
      .exec();
    if (!comment) throw new NotFoundException('Comment not found');
    return toCommentView(comment);
  }

  // One page + total in parallel; authors in a single `$in` query.
  private async findPage(
    filter: QueryFilter<Comment>,
    sort: string,
    page: number,
    limit: number,
  ): Promise<Paginated<CommentView>> {
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .select(COMMENT_PROJECTION)
        .sort(parseSort(sort))
        .skip((page - 1) * limit)
        .limit(limit)
        .populate({ path: 'author', select: AUTHOR_PROJECTION })
        .lean<CommentRecord[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return toPage(items.map(toCommentView), total, page, limit);
  }

  // Atomic, and never below zero.
  private async adjustReplyCount(
    id: Types.ObjectId,
    delta: number,
  ): Promise<void> {
    await this.model
      .updateOne(
        { _id: id },
        [
          {
            $set: {
              replyCount: { $max: [0, { $add: ['$replyCount', delta] }] },
            },
          },
        ],
        // `delta` is ±1 from this service, never user input.
        { updatePipeline: true },
      )
      .exec();
  }
}
