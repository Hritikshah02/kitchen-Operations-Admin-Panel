import { Transform } from 'class-transformer';
import { Injectable, NotFoundException, type PipeTransform } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

export const REFERENCE_KINDS = ['allergens', 'dietary-tags', 'stations', 'portion-sizes'] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

@Injectable()
export class ReferenceKindPipe implements PipeTransform<string, ReferenceKind> {
  transform(value: string): ReferenceKind {
    if ((REFERENCE_KINDS as readonly string[]).includes(value)) return value as ReferenceKind;
    throw new NotFoundException(`Unknown reference list "${value}". Use one of: ${REFERENCE_KINDS.join(', ')}.`);
  }
}

export class CreateReferenceItemDto {
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name!: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(240)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}

export class UpdateReferenceItemDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name?: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(240)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListReferenceQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;
}
