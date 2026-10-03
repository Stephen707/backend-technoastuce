import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ArticlesModule } from '../articles/articles.module';
import { AuthModule } from '../auth/auth.module';
import {
  ArticleCommentsController,
  CommentsController,
} from './comments.controller';
import { CommentsService } from './comments.service';
import { Comment, CommentSchema } from './schemas/comment.schema';

// ArticlesModule tells whether an article is public / open to comments and
// owns its comment counter.
@Module({
  imports: [
    AuthModule,
    ArticlesModule,
    MongooseModule.forFeature([{ name: Comment.name, schema: CommentSchema }]),
  ],
  controllers: [ArticleCommentsController, CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
