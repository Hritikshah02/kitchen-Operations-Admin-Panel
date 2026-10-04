import { ArrayNotEmpty, ArrayUnique, IsArray, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty({ message: 'Pick at least one kitchen working day.' })
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  workingDays?: number[];

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'cutoffTime must be a 24-hour time such as 16:00.' })
  cutoffTime?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(14)
  cutoffWorkingDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  kitchenReadyBufferMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(480)
  defaultDispatchLeadMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  onTimeGraceMinutes?: number;
}
