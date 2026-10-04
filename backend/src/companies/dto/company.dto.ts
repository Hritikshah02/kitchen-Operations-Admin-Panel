import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsFQDN,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';
import { IsRealDate, Lowercase, TIME_HH_MM, TIME_MESSAGE, Trim, TrimToNull } from '../../common/validation.js';
import { isPublicEmailDomain } from '../public-email-domains.js';

@ValidatorConstraint({ name: 'notPublicEmailDomain' })
class NotPublicEmailDomain implements ValidatorConstraintInterface {
  validate(value: unknown) {
    const values = Array.isArray(value) ? value : [value];
    return values.every((domain) => typeof domain === 'string' && !isPublicEmailDomain(domain));
  }
  defaultMessage() {
    return 'Public email providers such as gmail.com cannot be a company domain.';
  }
}

const DOMAIN_MESSAGE = 'Each domain must look like acme.com.';
const PHONE = /^\+?[0-9 ()-]{7,20}$/;

export class DomainDto {
  @Lowercase()
  @IsFQDN({ require_tld: true }, { message: DOMAIN_MESSAGE })
  @Validate(NotPublicEmailDomain)
  domain!: string;
}

export class AddressDto {
  @Trim() @IsString() @Length(1, 40) label!: string;
  @Trim() @IsString() @Length(3, 120) line1!: string;
  @IsOptional() @TrimToNull() @IsString() @MaxLength(120) line2?: string | null;
  @IsOptional() @TrimToNull() @IsString() @MaxLength(60) area?: string | null;
  @Trim() @IsString() @Length(2, 60) city!: string;
  @Trim() @Matches(/^[0-9]{6}$/, { message: 'pincode must be a 6-digit Indian PIN code.' }) pincode!: string;
}

export class UpdateAddressDto {
  @IsOptional() @Trim() @IsString() @Length(1, 40) label?: string;
  @IsOptional() @Trim() @IsString() @Length(3, 120) line1?: string;
  @IsOptional() @TrimToNull() @IsString() @MaxLength(120) line2?: string | null;
  @IsOptional() @TrimToNull() @IsString() @MaxLength(60) area?: string | null;
  @IsOptional() @Trim() @IsString() @Length(2, 60) city?: string;
  @IsOptional() @Trim() @Matches(/^[0-9]{6}$/, { message: 'pincode must be a 6-digit Indian PIN code.' }) pincode?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class OwnerDto {
  @Trim() @IsString() @Length(2, 80) name!: string;
  @Lowercase() @IsEmail() @MaxLength(254) email!: string;
}

/** Optional fields shared by create and update. */
class CompanyDefaultsFields {
  @IsOptional() @TrimToNull() @Matches(PHONE, { message: 'billingContactPhone must be a phone number such as +91 90000 01101.' }) billingContactPhone?: string | null;

  @IsOptional() @IsArray() @ArrayNotEmpty({ message: 'Pick at least one delivery day.' }) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true })
  workingDays?: number[];

  @IsOptional() @Matches(TIME_HH_MM, { message: `defaultDeliveryTime ${TIME_MESSAGE}.` }) defaultDeliveryTime?: string;
  @IsOptional() @Matches(TIME_HH_MM, { message: `deliveryWindowStart ${TIME_MESSAGE}.` }) deliveryWindowStart?: string;
  @IsOptional() @Matches(TIME_HH_MM, { message: `deliveryWindowEnd ${TIME_MESSAGE}.` }) deliveryWindowEnd?: string;
  @IsOptional() @IsInt() @Min(0) @Max(480) dispatchLeadMinutes?: number;
  @IsOptional() @IsInt() defaultPackagingTypeId?: number | null;
  @IsOptional() @TrimToNull() @IsString() @MaxLength(500) driverInstructions?: string | null;
  @IsOptional() @IsInt() defaultDriverId?: number | null;
  @IsOptional() @IsInt() priceTierId?: number | null; // null = default tier
}

export class CreateCompanyDto extends CompanyDefaultsFields {
  @Trim() @IsString() @Length(2, 120) name!: string;
  @Trim() @IsString() @Length(2, 80) billingContactName!: string;
  @Lowercase() @IsEmail() @MaxLength(254) billingContactEmail!: string;

  @IsArray() @ArrayMinSize(1, { message: 'Add at least one email domain.' }) @ArrayMaxSize(10) @ArrayUnique()
  @Lowercase()
  @IsFQDN({ require_tld: true }, { each: true, message: DOMAIN_MESSAGE })
  @Validate(NotPublicEmailDomain)
  domains!: string[];

  @ValidateNested() @Type(() => AddressDto) address!: AddressDto;
  @ValidateNested() @Type(() => OwnerDto) owner!: OwnerDto;
}

export class UpdateCompanyDto extends CompanyDefaultsFields {
  @IsOptional() @Trim() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @Trim() @IsString() @Length(2, 80) billingContactName?: string;
  @IsOptional() @Lowercase() @IsEmail() @MaxLength(254) billingContactEmail?: string;
  @IsOptional() @IsInt() ownerId?: number;
}

export class CompanyHolidayDto {
  @IsRealDate({ message: 'date must be a real date in YYYY-MM-DD format.' }) date!: string;
  @Trim() @IsString() @Length(2, 80) name!: string;
}

export class ListCompaniesQueryDto extends PaginationQueryDto {
  @IsOptional() @Trim() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() includeInactive?: boolean;
}
