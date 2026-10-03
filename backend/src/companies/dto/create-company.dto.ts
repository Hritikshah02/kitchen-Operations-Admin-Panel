import { Transform } from 'class-transformer';
import { IsFQDN, IsString, Length, Validate, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator';
import { isPublicEmailDomain } from '../public-email-domains.js';

@ValidatorConstraint({ name: 'notPublicEmailDomain' })
class NotPublicEmailDomain implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && !isPublicEmailDomain(value);
  }
  defaultMessage() {
    return 'emailDomain cannot be a public email provider such as gmail.com.';
  }
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateCompanyDto {
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase().replace(/^@/, '') : value))
  @IsFQDN({ require_tld: true }, { message: 'emailDomain must be a domain such as acme.com.' })
  @Validate(NotPublicEmailDomain)
  emailDomain!: string;
}
