import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { TaxonomyModule } from '../taxonomy/taxonomy.module';
import { Video, VideoSchema } from './schemas/video.schema';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

// Videos (YouTube/Vimeo). TaxonomyModule resolves categories/tags,
// AuthModule provides the guards; CacheService comes from the global
// AppCacheModule.
@Module({
  imports: [
    AuthModule,
    TaxonomyModule,
    MongooseModule.forFeature([{ name: Video.name, schema: VideoSchema }]),
  ],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule {}
