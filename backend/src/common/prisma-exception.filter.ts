import { ArgumentsHost, BadRequestException, Catch, ConflictException, ExceptionFilter, HttpException, NotFoundException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';

type PrismaError = Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientValidationError | Prisma.PrismaClientUnknownRequestError;

/** Maps database errors to the HTTP errors a client can act on, instead of a generic 500. */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientValidationError, Prisma.PrismaClientUnknownRequestError)
export class PrismaExceptionFilter extends BaseExceptionFilter implements ExceptionFilter {
  catch(error: PrismaError, host: ArgumentsHost) {
    super.catch(toHttpException(error) ?? error, host);
  }
}

// Unique-constraint targets (the columns involved) in words a person can act on.
const DUPLICATES: [string, string][] = [
  ['employeeId,deliveryDate', 'This employee already has an order for that delivery date.'],
  ['companyId,date', 'That date is already a holiday for this company.'],
  ['date', 'That date is already a kitchen holiday.'],
  ['sku', 'That SKU is already used by another dish.'],
  ['categoryId,dishId', 'That dish is already in this category.'],
  ['companyId,email', 'That email address is already in use.'],
  ['email', 'That email address is already in use.'],
  ['domain', 'That email domain already belongs to a company.'],
  ['emailDomain', 'That email domain already belongs to a company.'],
  ['name', 'That name is already in use.'],
];

export function toHttpException(error: PrismaError): HttpException | null {
  if (error instanceof Prisma.PrismaClientValidationError) {
    return /integer|too (large|big)|out of range/i.test(error.message) ? new BadRequestException('A number in the request is out of range.') : null;
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return /invalid byte sequence|out of range|unable to fit integer/i.test(error.message) ? new BadRequestException('The request contains a value the database can’t store.') : null;
  }
  switch (error.code) {
    case 'P2002': {
      const target = (error.meta?.target as string[] | string | undefined) ?? '';
      const key = (Array.isArray(target) ? target : [target]).flatMap((entry) => entry.split(',')).map((entry) => entry.trim()).sort().join(',');
      const found = DUPLICATES.find(([columns]) => columns.split(',').sort().join(',') === key);
      return new ConflictException(found?.[1] ?? 'That value is already in use.');
    }
    case 'P2003':
      return new ConflictException('This record is still referenced by other data.');
    case 'P2025':
      return new NotFoundException('Record not found.');
    case 'P2020':
    case 'P2000':
      return new BadRequestException('A value in the request is out of range.');
    default:
      return null;
  }
}
