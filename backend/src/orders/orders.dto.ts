import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrderStatus } from '@prisma/client';
import { PaginationQueryDto } from '../common/pagination.js';
import { ISO_DATE, TIME_HH_MM, TIME_MESSAGE, Trim, TrimToNull } from '../common/validation.js';
import { MAX_QUANTITY } from './order-rules.js';

export class ChoiceDto {
  @IsInt() groupId!: number;
  @IsInt() optionId!: number;
  @IsOptional() @IsInt() portionSizeId?: number | null;
}

export class CombinationDto {
  @IsInt() @Min(1) @Max(MAX_QUANTITY) quantity!: number;
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ChoiceDto) choices!: ChoiceDto[];
}

export class LineDto {
  @IsInt() dishId!: number;
  @IsInt() @Min(1) @Max(MAX_QUANTITY) quantity!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => CombinationDto) combinations!: CombinationDto[];
}

/** Delivery details are optional: omitted ones use the company defaults (and may only differ where the employee is allowed). */
class OrderContentFields {
  @Matches(ISO_DATE, { message: 'deliveryDate must be in YYYY-MM-DD format.' }) deliveryDate!: string;
  @IsOptional() @Matches(TIME_HH_MM, { message: `deliveryTime ${TIME_MESSAGE}.` }) deliveryTime?: string;
  @IsOptional() @IsInt() addressId?: number;
  @IsOptional() @IsInt() packagingTypeId?: number;
  @IsArray() @ArrayMinSize(1, { message: 'Add at least one dish.' }) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => LineDto) lines!: LineDto[];
  @IsOptional() @TrimToNull() @IsString() @MaxLength(500) notes?: string | null;
  @IsOptional() @IsBoolean() allergyAcknowledged?: boolean;
}

export class QuoteOrderDto extends OrderContentFields {
  @IsInt() employeeId!: number;
  @IsOptional() @IsInt() orderId?: number; // when editing, so locked prices are reused
}

export class CreateOrderDto extends OrderContentFields {
  @IsInt() employeeId!: number;
  @IsOptional() @IsBoolean() place?: boolean; // false/omitted = save as draft
}

export class UpdateOrderDto extends OrderContentFields {
  @IsInt() version!: number;
}

export class VersionDto {
  @IsInt() version!: number;
  @IsOptional() @IsBoolean() allergyAcknowledged?: boolean;
}

export class ReasonDto {
  @IsInt() version!: number;
  @IsOptional() @Trim() @IsString() @MaxLength(300) reason?: string;
}

export class RejectDto {
  @IsInt() version!: number;
  @Trim() @IsString() @Length(3, 300, { message: 'Give a reason for the rejection (3-300 characters).' }) reason!: string;
}

export class DeliveryOverrideDto {
  @IsInt() version!: number;
  @IsOptional() @Matches(TIME_HH_MM, { message: `deliveryTime ${TIME_MESSAGE}.` }) deliveryTime?: string;
  @IsOptional() @IsInt() addressId?: number;
  @IsOptional() @IsInt() packagingTypeId?: number | null;
}

export class ListOrdersQueryDto extends PaginationQueryDto {
  @IsOptional() @Matches(ISO_DATE) from?: string;
  @IsOptional() @Matches(ISO_DATE) to?: string;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsArray()
  @IsIn(Object.values(OrderStatus), { each: true })
  status?: OrderStatus[];
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() companyId?: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() employeeId?: number;
  /** Whether the order is on an invoice (4.7 filter). */
  @IsOptional() @IsIn(['true', 'false']) invoiced?: 'true' | 'false';
  @IsOptional() @Trim() @IsString() @MaxLength(80) search?: string;
}

export class CutoffRunDto {
  @Matches(ISO_DATE, { message: 'deliveryDate must be in YYYY-MM-DD format.' }) deliveryDate!: string;
}
