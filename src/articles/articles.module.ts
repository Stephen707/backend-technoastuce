import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Comment, CommentSchema } from '../comments/schemas/comment.schema';
import { TaxonomyModule } from '../taxonomy/taxonomy.module';
import { ArticlesController } from './articles.controller';
import { ArticlesService } from './articles.service';
import { Article, ArticleSchema } from './schemas/article.schema';

// Articles. TaxonomyModule resolves categories/tags, AuthModule provides the
// guards (and registers the User model used to populate authors). The
// Comment model is registered here too, only to delete an article's comments
// with it; CommentsModule imports this module, never the reverse.
@Module({
  imports: [
    AuthModule,
    TaxonomyModule,
    MongooseModule.forFeature([
      { name: Article.name, schema: ArticleSchema },
      { name: Comment.name, schema: CommentSchema },
    ]),
  ],
  controllers: [ArticlesController],
  providers: [ArticlesService],
  exports: [ArticlesService],
})
export class ArticlesModule {}
