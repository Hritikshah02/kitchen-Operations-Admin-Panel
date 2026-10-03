import { BadRequestException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateSettingsDto } from './dto/update-settings.dto.js';
import {
  addDays,
  cutoffFor,
  fromDbDate,
  isBeforeCutoff,
  isKitchenWorkingDay,
  kitchenToday,
  toDbDate,
  type IsoDate,
  type KitchenCalendar,
} from './kitchen-calendar.js';

const SETTINGS_ID = 1;

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const settings = await this.prisma.kitchenSettings.findUniqueOrThrow({ where: { id: SETTINGS_ID } });
    return { ...settings, workingDays: [...settings.workingDays].sort((a, b) => a - b), today: kitchenToday(settings.timezone) };
  }

  async update(data: UpdateSettingsDto) {
    await this.prisma.kitchenSettings.update({ where: { id: SETTINGS_ID }, data });
    return this.get();
  }

  async listHolidays(year?: number) {
    const where = year ? { date: { gte: toDbDate(`${year}-01-01`), lte: toDbDate(`${year}-12-31`) } } : {};
    const holidays = await this.prisma.kitchenHoliday.findMany({ where, orderBy: { date: 'asc' } });
    return holidays.map((holiday) => ({ id: holiday.id, name: holiday.name, date: fromDbDate(holiday.date) }));
  }

  async addHoliday(date: IsoDate, name: string) {
    if (!DateTime.fromISO(date).isValid) throw new BadRequestException(`${date} is not a real calendar date.`);
    const holiday = await this.prisma.kitchenHoliday.create({ data: { date: toDbDate(date), name } });
    return { id: holiday.id, name: holiday.name, date: fromDbDate(holiday.date) };
  }

  async removeHoliday(id: number) {
    await this.prisma.kitchenHoliday.delete({ where: { id } });
  }

  /** Everything needed to evaluate cut-offs. Holidays are loaded for a bounded window, not the whole table. */
  async calendar(from: IsoDate, to: IsoDate): Promise<KitchenCalendar & { cutoffTime: string; cutoffWorkingDays: number }> {
    const settings = await this.get();
    const holidays = await this.prisma.kitchenHoliday.findMany({
      where: { date: { gte: toDbDate(addDays(from, -60)), lte: toDbDate(to) } },
      select: { date: true },
    });
    return {
      timezone: settings.timezone,
      workingDays: settings.workingDays,
      holidays: new Set(holidays.map((holiday) => fromDbDate(holiday.date))),
      cutoffTime: settings.cutoffTime,
      cutoffWorkingDays: settings.cutoffWorkingDays,
    };
  }

  /**
   * Of the given open orders, the ids still before their cut-off (cancellable without an admin override).
   * Orders past cut-off are locked: cut-off processing confirms them and they become billable (4.6).
   */
  async idsBeforeCutoff(orders: { id: number; deliveryDate: Date }[], now: Date = new Date()): Promise<number[]> {
    if (!orders.length) return [];
    const dates = orders.map((order) => fromDbDate(order.deliveryDate)).sort();
    const calendar = await this.calendar(dates[0], dates[dates.length - 1]);
    return orders.filter((order) => isBeforeCutoff(fromDbDate(order.deliveryDate), calendar, calendar, now)).map((order) => order.id);
  }

  /** Upcoming delivery dates with their cut-off, so staff can see the effect of the settings before orders exist. */
  async cutoffPreview(from?: IsoDate, days = 10) {
    const settings = await this.get();
    const start = from ?? settings.today;
    const end = addDays(start, days - 1);
    const calendar = await this.calendar(start, end);
    const holidayNames = new Map((await this.listHolidays()).map((holiday) => [holiday.date, holiday.name]));
    const now = DateTime.now();

    return Array.from({ length: days }, (_, index) => {
      const deliveryDate = addDays(start, index);
      const workingDay = isKitchenWorkingDay(deliveryDate, calendar);
      const cutoff = workingDay ? cutoffFor(deliveryDate, calendar, calendar) : null;
      return {
        deliveryDate,
        weekday: DateTime.fromISO(deliveryDate).toFormat('cccc'),
        isKitchenWorkingDay: workingDay,
        holiday: holidayNames.get(deliveryDate) ?? null,
        cutoffAt: cutoff?.toISO() ?? null,
        isLocked: cutoff ? cutoff <= now : null,
      };
    });
  }
}
