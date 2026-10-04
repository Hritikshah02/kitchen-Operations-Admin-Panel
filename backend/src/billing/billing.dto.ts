import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PaginationQueryDto } from '../common/pagination.js';
import { ISO_DATE, Trim, TrimToNull } from '../common/validation.js';

export class CreateInvoiceDto {
  @IsInt() @Min(1) companyId!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsInt({ each: true }) @Min(1, { each: true }) orderIds!: number[];
  @TrimToNull() @IsOptional() @IsString() @MaxLength(300) notes?: string | null;
}

export class UninvoicedQueryDto extends PaginationQueryDto {
  @IsOptional() @Matches(ISO_DATE) from?: string;
  @IsOptional() @Matches(ISO_DATE) to?: string;
}

export class InvoiceListQueryDto extends PaginationQueryDto {
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() companyId?: number;
  @IsOptional() @IsIn(['UNPAID', 'PAID', 'VOID']) status?: 'UNPAID' | 'PAID' | 'VOID';
}

export class VoidInvoiceDto {
  @Trim() @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}

export class MissingItemDto {
  @IsInt() @Min(1) combinationId!: number;
  @IsInt() @Min(0) missingQuantity!: number;
}

export class ShortDeliveryDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => MissingItemDto) items!: MissingItemDto[];
  @Trim() @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}
