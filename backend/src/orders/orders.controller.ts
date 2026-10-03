import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { Authorize } from '../auth/authorize.decorator.js';
import { Capability } from '../auth/capabilities.js';
import { RequireCapabilities } from '../auth/require-capabilities.decorator.js';
import { CutoffService } from './cutoff.service.js';
import { CreateOrderDto, CutoffRunDto, DeliveryOverrideDto, ListOrdersQueryDto, QuoteOrderDto, ReasonDto, RejectDto, UpdateOrderDto, VersionDto } from './orders.dto.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
@Authorize(Capability.ORDERS_MANAGE)
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly cutoff: CutoffService,
  ) {}

  @Get() list(@Query() query: ListOrdersQueryDto) { return this.orders.list(query); }
  @Post('quote') quote(@Body() body: QuoteOrderDto) { return this.orders.quote(body); }
  @Post() create(@Body() body: CreateOrderDto, @Req() request: AuthenticatedRequest) { return this.orders.create(body, request.user); }

  @Get('cutoff') cutoffOverview() { return this.cutoff.overview(); }
  @Post('cutoff/run') @RequireCapabilities(Capability.ORDERS_MANAGE, Capability.ORDERS_OVERRIDE)
  runCutoff(@Body() body: CutoffRunDto, @Req() request: AuthenticatedRequest) { return this.cutoff.runManually(body.deliveryDate, request.user.id); }

  @Get(':id') get(@Param('id', ParseIntPipe) id: number, @Req() request: AuthenticatedRequest) { return this.orders.get(id, request.user); }
  @Put(':id') update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateOrderDto, @Req() request: AuthenticatedRequest) { return this.orders.update(id, body, request.user); }
  @Post(':id/place') place(@Param('id', ParseIntPipe) id: number, @Body() body: VersionDto, @Req() request: AuthenticatedRequest) { return this.orders.place(id, body, request.user); }
  @Post(':id/cancel') cancel(@Param('id', ParseIntPipe) id: number, @Body() body: ReasonDto, @Req() request: AuthenticatedRequest) { return this.orders.cancel(id, body, request.user); }
  @Post(':id/reject') reject(@Param('id', ParseIntPipe) id: number, @Body() body: RejectDto, @Req() request: AuthenticatedRequest) { return this.orders.reject(id, body, request.user); }
  @Patch(':id/delivery') overrideDelivery(@Param('id', ParseIntPipe) id: number, @Body() body: DeliveryOverrideDto, @Req() request: AuthenticatedRequest) { return this.orders.overrideDelivery(id, body, request.user); }
}
