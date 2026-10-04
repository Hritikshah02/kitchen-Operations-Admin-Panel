import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Min } from 'class-validator';
import { PaginationQueryDto } from '../common/pagination.js';
import { IsRealDate } from '../common/validation.js';

export class BoardQueryDto extends PaginationQueryDto {
  /** Defaults to today, or the next working day when the kitchen is closed today. */
  @IsOptional() @IsRealDate({ message: 'date must be a real date in YYYY-MM-DD format.' }) date?: string;
  /** A station id, or "unassigned" for dishes with no station. */
  @IsOptional() @Matches(/^(unassigned|\d+)$/, { message: 'station must be a station id or "unassigned".' }) station?: string;
  @IsOptional() @IsIn(['PENDING', 'STARTED', 'DONE']) state?: 'PENDING' | 'STARTED' | 'DONE';
  @IsOptional() @IsIn(['LATE', 'AT_RISK', 'ON_TRACK', 'DONE']) timing?: 'LATE' | 'AT_RISK' | 'ON_TRACK' | 'DONE';
}

export class IdParamDto {
  @Transform(({ value }) => Number(value)) @IsInt() @Min(1) id!: number;
}
