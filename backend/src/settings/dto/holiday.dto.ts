import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { IsRealDate } from '../../common/validation.js';

export class CreateHolidayDto {
  @IsRealDate({ message: 'date must be a real date in YYYY-MM-DD format.' })
  date!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 80)
  name!: string;
}

export class HolidayQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class CutoffPreviewQueryDto {
  @IsOptional()
  @IsRealDate({ message: 'from must be a real date in YYYY-MM-DD format.' })
  from?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(31)
  days?: number;
}
