import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { IdPipe } from '../common/id.pipe.js';
import { Authorize } from '../auth/authorize.decorator.js';
import { Capability } from '../auth/capabilities.js';
import { RequireCapabilities } from '../auth/require-capabilities.decorator.js';
import { CreateCategoryDto, IdsDto, ItemDto, PreviewQueryDto, UpdateCategoryDto, VisibilityDto } from './menu.dto.js';
import { MenuService } from './menu.service.js';

@Controller('menu')
@Authorize()
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get('preview') @RequireCapabilities(Capability.ORDERS_MANAGE)
  preview(@Query() query: PreviewQueryDto) { return this.menu.employeeMenu(query.employeeId, query.search, query.dishIds); }

  @Get('categories') @RequireCapabilities(Capability.CATALOGUE_MANAGE)
  listCategories() { return this.menu.listCategories(); }

  @Post('categories') @RequireCapabilities(Capability.CATALOGUE_MANAGE)
  createCategory(@Body() body: CreateCategoryDto) { return this.menu.createCategory(body); }

  @Put('categories/order') @RequireCapabilities(Capability.CATALOGUE_MANAGE)
  reorder(@Body() body: IdsDto) { return this.menu.reorderCategories(body.ids); }

  @Patch('categories/:id') @RequireCapabilities(Capability.CATALOGUE_MANAGE)
  updateCategory(@Param('id', IdPipe) id: number, @Body() body: UpdateCategoryDto) { return this.menu.updateCategory(id, body); }

  @Put('categories/:id/items') @RequireCapabilities(Capability.CATALOGUE_MANAGE)
  setItems(@Param('id', IdPipe) id: number, @Body() body: IdsDto) { return this.menu.setItems(id, body.ids); }

  @Patch('items/:id') @RequireCapabilities(Capability.CATALOGUE_MANAGE)
  setItemActive(@Param('id', IdPipe) id: number, @Body() body: ItemDto) { return this.menu.setItemActive(id, body.isActive); }

  @Get('visibility/:companyId') @RequireCapabilities(Capability.COMPANIES_MANAGE)
  visibility(@Param('companyId', IdPipe) companyId: number) { return this.menu.visibility(companyId); }

  @Put('visibility/:companyId') @RequireCapabilities(Capability.COMPANIES_MANAGE)
  setVisibility(@Param('companyId', IdPipe) companyId: number, @Body() body: VisibilityDto) { return this.menu.setVisibility(companyId, body); }
}
