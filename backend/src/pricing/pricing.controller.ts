import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { IdPipe } from '../common/id.pipe.js';
import { Authorize } from '../auth/authorize.decorator.js';
import { Capability } from '../auth/capabilities.js';
import { CreateTierDto, GridQueryDto, SavePricesDto, UpdateTierDto } from './pricing.dto.js';
import { PricingService } from './pricing.service.js';

@Controller('pricing')
@Authorize(Capability.CATALOGUE_MANAGE)
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get('tiers') listTiers() { return this.pricing.listTiers(); }
  @Post('tiers') createTier(@Body() body: CreateTierDto) { return this.pricing.createTier(body); }
  @Patch('tiers/:id') updateTier(@Param('id', IdPipe) id: number, @Body() body: UpdateTierDto) { return this.pricing.updateTier(id, body); }
  @Post('tiers/:id/make-default') makeDefault(@Param('id', IdPipe) id: number) { return this.pricing.makeDefault(id); }
  @Get('tiers/:id/grid') grid(@Param('id', IdPipe) id: number, @Query() query: GridQueryDto) { return this.pricing.grid(id, query); }
  @Put('tiers/:id/prices') savePrices(@Param('id', IdPipe) id: number, @Body() body: SavePricesDto) { return this.pricing.savePrices(id, body); }
}
