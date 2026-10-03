import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Temperature } from '@prisma/client';
import { PaginationQueryDto } from '../common/pagination.js';
import { Trim, TrimToNull } from '../common/validation.js';

const MAX_CENTS = 1_000_000; // $10,000: guards against typos such as entering cents as dollars twice
const toBool = ({ value }: { value: unknown }) => value === 'true' || value === true;
const ids = () => [IsArray(), ArrayUnique(), ArrayMaxSize(50), IsInt({ each: true })];
const apply = (decorators: PropertyDecorator[]): PropertyDecorator => (target, key) => decorators.forEach((decorator) => decorator(target, key));

/** Optional fields shared by create and update (required ones are declared separately on each). */
class DishCommon {
  @IsOptional() @Trim() @IsString() @Length(0, 500) description?: string;
  @IsOptional() @TrimToNull() @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'imageUrl must be an https URL.' }) imageUrl?: string | null;
  @IsOptional() @IsInt() stationId?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(500) minOrderQty?: number;
  @IsOptional() @apply(ids()) allergenIds?: number[];
  @IsOptional() @apply(ids()) dietaryTagIds?: number[];
}

export class CreateDishDto extends DishCommon {
  @Trim() @Matches(/^[A-Z0-9][A-Z0-9-]{1,19}$/, { message: 'sku must be 2-20 capital letters, digits or dashes, e.g. GUJ-001.' }) sku!: string;
  @Trim() @IsString() @Length(2, 120) name!: string;
  @IsEnum(Temperature) temperature!: Temperature;
  @IsInt() @Min(0) @Max(MAX_CENTS) costCents!: number;
}

export class UpdateDishDto extends DishCommon {
  @IsOptional() @Trim() @Matches(/^[A-Z0-9][A-Z0-9-]{1,19}$/, { message: 'sku must be 2-20 capital letters, digits or dashes, e.g. GUJ-001.' }) sku?: string;
  @IsOptional() @Trim() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsEnum(Temperature) temperature?: Temperature;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) costCents?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class DishGroupsDto {
  @IsArray() @ArrayUnique() @ArrayMaxSize(10) @IsInt({ each: true }) groupIds!: number[];
}

export class SurchargeDto {
  @IsInt() portionSizeId!: number;
  @IsInt() @Min(0) @Max(MAX_CENTS) surchargeCents!: number;
}

class OptionCommon {
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @apply(ids()) allergenIds?: number[];
  @IsOptional() @apply(ids()) dietaryTagIds?: number[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SurchargeDto) surcharges?: SurchargeDto[];
}

export class CreateOptionDto extends OptionCommon {
  @Trim() @IsString() @Length(2, 80) name!: string;
  @IsInt() @Min(0) @Max(MAX_CENTS) costCents!: number;
}

export class UpdateOptionDto extends OptionCommon {
  @IsOptional() @Trim() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) costCents?: number;
}

class OptionGroupCommon {
  @IsOptional() @IsInt() @Min(0) @Max(10) minSelect?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) maxSelect?: number;
  @IsOptional() @IsBoolean() usesPortions?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @apply(ids()) portionSizeIds?: number[];
  @IsOptional() @apply(ids()) optionIds?: number[]; // in display order
}

export class CreateOptionGroupDto extends OptionGroupCommon {
  @Trim() @IsString() @Length(2, 80) name!: string;
}

export class UpdateOptionGroupDto extends OptionGroupCommon {
  @IsOptional() @Trim() @IsString() @Length(2, 80) name?: string;
}

export class CatalogueQueryDto extends PaginationQueryDto {
  @IsOptional() @Trim() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @Transform(toBool) @IsBoolean() includeInactive?: boolean;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() stationId?: number;
}
