import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Authorize } from '../auth/authorize.decorator.js';
import { Capability } from '../auth/capabilities.js';
import {
  CatalogueQueryDto,
  CreateDishDto,
  CreateOptionDto,
  CreateOptionGroupDto,
  DishGroupsDto,
  UpdateDishDto,
  UpdateOptionDto,
  UpdateOptionGroupDto,
} from './catalogue.dto.js';
import { DishesService } from './dishes.service.js';
import { ImagesService } from './images.service.js';
import { OptionsService } from './options.service.js';

@Controller('catalogue')
@Authorize(Capability.CATALOGUE_MANAGE)
export class CatalogueController {
  constructor(
    private readonly dishes: DishesService,
    private readonly options: OptionsService,
    private readonly images: ImagesService,
  ) {}

  @Get('dishes') listDishes(@Query() query: CatalogueQueryDto) { return this.dishes.list(query); }
  @Get('dishes/:id') getDish(@Param('id', ParseIntPipe) id: number) { return this.dishes.get(id); }
  @Post('dishes') createDish(@Body() body: CreateDishDto) { return this.dishes.create(body); }
  @Patch('dishes/:id') updateDish(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateDishDto) { return this.dishes.update(id, body); }
  @Put('dishes/:id/option-groups') setDishGroups(@Param('id', ParseIntPipe) id: number, @Body() body: DishGroupsDto) { return this.dishes.setGroups(id, body.groupIds); }

  @Get('options') listOptions(@Query() query: CatalogueQueryDto) { return this.options.listOptions(query); }
  @Get('options/:id') getOption(@Param('id', ParseIntPipe) id: number) { return this.options.getOption(id); }
  @Post('options') createOption(@Body() body: CreateOptionDto) { return this.options.createOption(body); }
  @Patch('options/:id') updateOption(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateOptionDto) { return this.options.updateOption(id, body); }

  @Get('option-groups') listGroups(@Query() query: CatalogueQueryDto) { return this.options.listGroups(query.includeInactive); }
  @Get('option-groups/:id') getGroup(@Param('id', ParseIntPipe) id: number) { return this.options.getGroup(id); }
  @Post('option-groups') createGroup(@Body() body: CreateOptionGroupDto) { return this.options.createGroup(body); }
  @Patch('option-groups/:id') updateGroup(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateOptionGroupDto) { return this.options.updateGroup(id, body); }

  @Get('images/status') imageStatus() { return this.images.status(); }
  @Post('images/signature') signImageUpload() { return this.images.signUpload(); }
}
