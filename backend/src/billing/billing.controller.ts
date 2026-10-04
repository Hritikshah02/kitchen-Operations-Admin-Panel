import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { IdPipe } from '../common/id.pipe.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { Authorize } from '../auth/authorize.decorator.js';
import { Capability } from '../auth/capabilities.js';
import { CreateInvoiceDto, InvoiceListQueryDto, ShortDeliveryDto, UninvoicedQueryDto, VoidInvoiceDto } from './billing.dto.js';
import { BillingService } from './billing.service.js';

@Controller('billing')
@Authorize(Capability.BILLING_MANAGE)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('companies') companies() { return this.billing.companies(); }
  @Get('companies/:id/uninvoiced') uninvoiced(@Param('id', IdPipe) id: number, @Query() query: UninvoicedQueryDto) { return this.billing.uninvoiced(id, query); }
  @Get('invoices') list(@Query() query: InvoiceListQueryDto) { return this.billing.list(query); }
  @Post('invoices') create(@Body() body: CreateInvoiceDto, @Req() request: AuthenticatedRequest) { return this.billing.createInvoice(body, request.user); }
  @Get('invoices/:id') get(@Param('id', IdPipe) id: number) { return this.billing.get(id); }
  @Post('invoices/:id/pay') pay(@Param('id', IdPipe) id: number, @Req() request: AuthenticatedRequest) { return this.billing.pay(id, request.user); }
  @Post('invoices/:id/void') voidInvoice(@Param('id', IdPipe) id: number, @Body() body: VoidInvoiceDto, @Req() request: AuthenticatedRequest) { return this.billing.voidInvoice(id, body.reason, request.user); }
  @Post('orders/:id/short-delivery') shortDelivery(@Param('id', IdPipe) id: number, @Body() body: ShortDeliveryDto, @Req() request: AuthenticatedRequest) { return this.billing.shortDelivery(id, body, request.user); }
}
