import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsInt, IsOptional, IsString, Length, Matches, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../common/pagination.js';
import { Lowercase, Trim, TrimToNull } from '../common/validation.js';

const PHONE = /^\+?[0-9 ()-]{7,20}$/;
const PHONE_MESSAGE = 'phone must be a phone number such as +91 90000 01101.';
const toBool = ({ value }: { value: unknown }) => value === 'true' || value === true;

class EmployeeFields {
  @IsOptional() @TrimToNull() @Matches(PHONE, { message: PHONE_MESSAGE }) phone?: string | null;
  @IsOptional() @IsBoolean() canChooseAddress?: boolean;
  @IsOptional() @IsBoolean() canChangeDeliveryTime?: boolean;
  @IsOptional() @IsBoolean() canChangePackaging?: boolean;
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsInt({ each: true }) allergenIds?: number[];
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsInt({ each: true }) dietaryTagIds?: number[];
}

export class CreateEmployeeDto extends EmployeeFields {
  @IsInt() @Min(1) companyId!: number;
  @Trim() @IsString() @Length(2, 80) name!: string;
  @Lowercase() @IsEmail() @MaxLength(254) email!: string;
}

export class UpdateEmployeeDto extends EmployeeFields {
  @IsOptional() @Trim() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @Lowercase() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/** Permission flags belong to the new company's policy, so they are set afresh (default: none granted). */
export class MoveEmployeeDto {
  @IsInt() @Min(1) companyId!: number;
  @Lowercase() @IsEmail() @MaxLength(254) email!: string;
  @IsOptional() @IsBoolean() canChooseAddress?: boolean;
  @IsOptional() @IsBoolean() canChangeDeliveryTime?: boolean;
  @IsOptional() @IsBoolean() canChangePackaging?: boolean;
}

export class ListEmployeesQueryDto extends PaginationQueryDto {
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() companyId?: number;
  @IsOptional() @Trim() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @Transform(toBool) @IsBoolean() includeInactive?: boolean;
}
