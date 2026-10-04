import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { Authorize } from '../auth/authorize.decorator.js';
import { Capability } from '../auth/capabilities.js';
import { BoardQueryDto, IdParamDto } from './kitchen.dto.js';
import { KitchenService } from './kitchen.service.js';

@Controller('kitchen')
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  @Get('board') @Authorize(Capability.KITCHEN_BOARD_VIEW)
  board(@Query() query: BoardQueryDto) { return this.kitchen.board(query); }

  @Post('units/:id/start') @Authorize(Capability.KITCHEN_BOARD_UPDATE)
  start(@Param() params: IdParamDto, @Req() request: AuthenticatedRequest) { return this.kitchen.start(params.id, request.user); }

  @Post('units/:id/finish') @Authorize(Capability.KITCHEN_BOARD_UPDATE)
  finish(@Param() params: IdParamDto, @Req() request: AuthenticatedRequest) { return this.kitchen.finish(params.id, request.user); }

  @Post('orders/:id/force-complete') @Authorize(Capability.KITCHEN_BOARD_UPDATE, Capability.ORDERS_OVERRIDE)
  forceComplete(@Param() params: IdParamDto, @Req() request: AuthenticatedRequest) { return this.kitchen.forceComplete(params.id, request.user); }
}
