import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Min } from 'class-validator';
import { PaginationQueryDto } from '../common/pagination.js';
import { ISO_DATE } from '../common/validation.js';

export class BoardQueryDto extends PaginationQueryDto {
  @Matches(ISO_DATE, { message: 'date must be in YYYY-MM-DD format.' }) date!: string;
  /** A station id, or "unassigned" for dishes with no station. */
  @IsOptional() @Matches(/^(unassigned|\d+)$/, { message: 'station must be a station id or "unassigned".' }) station?: string;
  @IsOptional() @IsIn(['PENDING', 'STARTED', 'DONE']) state?: 'PENDING' | 'STARTED' | 'DONE';
  @IsOptional() @IsIn(['LATE', 'AT_RISK', 'ON_TRACK', 'DONE']) timing?: 'LATE' | 'AT_RISK' | 'ON_TRACK' | 'DONE';
}

export class IdParamDto {
  @Transform(({ value }) => Number(value)) @IsInt() @Min(1) id!: number;
}
