import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';
import { Category, CategorySchema } from './categories/schemas/category.schema';
import { Tag, TagSchema } from './tags/schemas/tag.schema';
import { TagsController } from './tags/tags.controller';
import { TagsService } from './tags/tags.service';

// Categories (hierarchical) and tags (flat). AuthModule provides the guards
// for the admin routes. The services are exported so future content modules
// can resolve categories and tags.
@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Category.name, schema: CategorySchema },
      { name: Tag.name, schema: TagSchema },
    ]),
  ],
  controllers: [CategoriesController, TagsController],
  providers: [CategoriesService, TagsService],
  exports: [CategoriesService, TagsService],
})
export class TaxonomyModule {}
