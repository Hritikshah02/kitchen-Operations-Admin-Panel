import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../common/pagination.js';
import { IsRealDate, TIME_HH_MM, TIME_MESSAGE, TrimToNull } from '../common/validation.js';

export class DropKeyDto {
  @IsRealDate({ message: 'deliveryDate must be a real date in YYYY-MM-DD format.' }) deliveryDate!: string;
  @IsInt() @Min(1) companyId!: number;
  @IsInt() @Min(1) addressId!: number;
  @Matches(TIME_HH_MM, { message: `deliveryTime ${TIME_MESSAGE}` }) deliveryTime!: string;
}

export class AssignDriverDto extends DropKeyDto {
  @IsInt() @Min(1) driverId!: number;
}

export class DeliverDto extends DropKeyDto {
  @TrimToNull() @IsOptional() @IsString() @MaxLength(500) note?: string | null;
  @IsOptional() @Matches(/^https:\/\/res\.cloudinary\.com\/.+/, { message: 'photoUrl must be an uploaded photo.' }) photoUrl?: string | null;
}

export class DispatchBoardQueryDto extends PaginationQueryDto {
  /** Defaults to today, or the next working day when the kitchen is closed today. */
  @IsOptional() @IsRealDate({ message: 'date must be a real date in YYYY-MM-DD format.' }) date?: string;
  @IsOptional() @Transform(({ value }) => (value === 'none' ? 0 : Number(value))) @IsInt() driverId?: number; // 0 = unassigned
  @IsOptional() @Matches(/^(NOT_STARTED|COOKING|KITCHEN_READY|DISPATCH_READY|OUT_FOR_DELIVERY|DELIVERED)$/) stage?: string;
}
