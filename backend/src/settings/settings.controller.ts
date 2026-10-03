import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { Authorize } from '../auth/authorize.decorator.js';
import { Capability } from '../auth/capabilities.js';
import { RequireCapabilities } from '../auth/require-capabilities.decorator.js';
import { CreateHolidayDto, CutoffPreviewQueryDto, HolidayQueryDto } from './dto/holiday.dto.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';
import { SettingsService } from './settings.service.js';

// Every role may read settings (kitchen, dispatch and drivers all depend on the calendar); only admins change them.
@Controller('settings')
@Authorize()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Patch()
  @RequireCapabilities(Capability.SETTINGS_MANAGE)
  update(@Body() body: UpdateSettingsDto) {
    return this.settings.update(body);
  }

  @Get('cutoff-preview')
  cutoffPreview(@Query() query: CutoffPreviewQueryDto) {
    return this.settings.cutoffPreview(query.from, query.days);
  }

  @Get('holidays')
  listHolidays(@Query() query: HolidayQueryDto) {
    return this.settings.listHolidays(query.year);
  }

  @Post('holidays')
  @RequireCapabilities(Capability.SETTINGS_MANAGE)
  addHoliday(@Body() body: CreateHolidayDto) {
    return this.settings.addHoliday(body.date, body.name);
  }

  @Delete('holidays/:id')
  @RequireCapabilities(Capability.SETTINGS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeHoliday(@Param('id', ParseIntPipe) id: number) {
    return this.settings.removeHoliday(id);
  }
}
