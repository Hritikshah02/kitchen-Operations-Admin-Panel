import { Module } from '@nestjs/common';
import { CatalogueController } from './catalogue.controller.js';
import { DishesService } from './dishes.service.js';
import { ImagesService } from './images.service.js';
import { OptionsService } from './options.service.js';

@Module({
  controllers: [CatalogueController],
  providers: [DishesService, OptionsService, ImagesService],
  exports: [DishesService, OptionsService],
})
export class CatalogueModule {}
