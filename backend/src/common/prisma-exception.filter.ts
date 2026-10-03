import { ArgumentsHost, Catch, ConflictException, ExceptionFilter, HttpException, NotFoundException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';

/** Maps database constraint errors to the HTTP errors a client can act on, instead of a generic 500. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter extends BaseExceptionFilter implements ExceptionFilter {
  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    super.catch(toHttpException(error) ?? error, host);
  }
}

export function toHttpException(error: Prisma.PrismaClientKnownRequestError): HttpException | null {
  switch (error.code) {
    case 'P2002': {
      const target = (error.meta?.target as string[] | string | undefined) ?? 'value';
      const fields = Array.isArray(target) ? target.join(', ') : target;
      return new ConflictException(`A record with this ${fields} already exists.`);
    }
    case 'P2003':
      return new ConflictException('This record is still referenced by other data.');
    case 'P2025':
      return new NotFoundException('Record not found.');
    default:
      return null;
  }
}
