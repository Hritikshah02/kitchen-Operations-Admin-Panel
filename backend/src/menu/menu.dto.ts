import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsInt, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';
import { Trim, TrimToNull } from '../common/validation.js';

export class CreateCategoryDto {
  @Trim() @IsString() @Length(2, 60) name!: string;
  @IsOptional() @TrimToNull() @IsString() @MaxLength(200) description?: string | null;
  @IsOptional() @IsBoolean() isSecret?: boolean;
}

export class UpdateCategoryDto {
  @IsOptional() @Trim() @IsString() @Length(2, 60) name?: string;
  @IsOptional() @TrimToNull() @IsString() @MaxLength(200) description?: string | null;
  @IsOptional() @IsBoolean() isSecret?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class IdsDto {
  @IsArray() @ArrayUnique() @ArrayMaxSize(500) @IsInt({ each: true }) ids!: number[];
}

export class ItemDto {
  @IsBoolean() isActive!: boolean;
}

export class VisibilityDto {
  @IsArray() @ArrayUnique() @ArrayMaxSize(200) @IsInt({ each: true }) hiddenCategoryIds!: number[];
  @IsArray() @ArrayUnique() @ArrayMaxSize(500) @IsInt({ each: true }) hiddenDishIds!: number[];
}

export class PreviewQueryDto {
  @Transform(({ value }) => Number(value)) @IsInt() @Min(1) employeeId!: number;
  @IsOptional() @Trim() @IsString() @MaxLength(80) search?: string;
  // Dishes already on an order being edited (may be in a secret category): returned in `requested` if still orderable.
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean).map(Number) : value)) @IsArray() @IsInt({ each: true }) dishIds?: number[];
}
