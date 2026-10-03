import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { Authorize } from '../auth/authorize.decorator.js';
import { Capability } from '../auth/capabilities.js';
import { RequireCapabilities } from '../auth/require-capabilities.decorator.js';
import {
  CreateReferenceItemDto,
  ListReferenceQueryDto,
  ReferenceKindPipe,
  type ReferenceKind,
  UpdateReferenceItemDto,
} from './reference-data.dto.js';
import { ReferenceDataService } from './reference-data.service.js';

// Readable by every role (the kitchen filters by station); only admins edit. There is no DELETE:
// items are deactivated so catalogue rows that reference them stay valid.
@Controller('reference-data/:kind')
@Authorize()
export class ReferenceDataController {
  constructor(private readonly referenceData: ReferenceDataService) {}

  @Get()
  list(@Param('kind', ReferenceKindPipe) kind: ReferenceKind, @Query() query: ListReferenceQueryDto) {
    return this.referenceData.list(kind, query.includeInactive);
  }

  @Post()
  @RequireCapabilities(Capability.REFERENCE_DATA_MANAGE)
  create(@Param('kind', ReferenceKindPipe) kind: ReferenceKind, @Body() body: CreateReferenceItemDto) {
    return this.referenceData.create(kind, body);
  }

  @Patch(':id')
  @RequireCapabilities(Capability.REFERENCE_DATA_MANAGE)
  update(
    @Param('kind', ReferenceKindPipe) kind: ReferenceKind,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateReferenceItemDto,
  ) {
    return this.referenceData.update(kind, id, body);
  }
}
