import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export const pageArgs = ({ page, pageSize }: PaginationQueryDto) => ({ skip: (page - 1) * pageSize, take: pageSize });
