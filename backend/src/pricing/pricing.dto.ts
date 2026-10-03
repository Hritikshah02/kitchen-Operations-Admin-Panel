import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PriceRule } from '@prisma/client';
import { Trim } from '../common/validation.js';

class TierCommon {
  @IsOptional() @IsEnum(PriceRule) rule?: PriceRule;
  @IsOptional() @IsInt() @Min(-9_999) @Max(1_000_000) ruleValueBps?: number | null;
  @IsOptional() @IsInt() baseTierId?: number | null;
}

export class CreateTierDto extends TierCommon {
  @Trim() @IsString() @Length(2, 40) name!: string;
}

export class UpdateTierDto extends TierCommon {
  @IsOptional() @Trim() @IsString() @Length(2, 40) name?: string;
}

export class PriceCellDto {
  @IsInt() id!: number;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) priceCents?: number | null; // null/absent = clear (use derived, or missing)
  @IsOptional() @IsBoolean() isUnavailable?: boolean;
}

export class SavePricesDto {
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => PriceCellDto) dishes?: PriceCellDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => PriceCellDto) options?: PriceCellDto[];
}

export class GridQueryDto {
  @IsIn(['dishes', 'options']) kind!: 'dishes' | 'options';
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() missingOnly?: boolean;
  @IsOptional() @Trim() @IsString() @MaxLength(80) search?: string;
}
