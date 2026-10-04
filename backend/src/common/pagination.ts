import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt({ message: 'page must be a whole number, 1 or more.' })
  @Min(1, { message: 'page must be a whole number, 1 or more.' })
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt({ message: 'pageSize must be a whole number from 1 to 100.' })
  @Min(1, { message: 'pageSize must be a whole number from 1 to 100.' })
  @Max(100, { message: 'pageSize must be a whole number from 1 to 100.' })
  pageSize = 25;
}

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export const pageArgs = ({ page, pageSize }: PaginationQueryDto) => ({ skip: (page - 1) * pageSize, take: pageSize });
