import { BadRequestException, Injectable, NotFoundException, type PipeTransform } from '@nestjs/common';

const INT4_MAX = 2_147_483_647;

/** A route id: 400 if it is not a whole number, 404 if it can't exist (larger than the database's integer column). */
@Injectable()
export class IdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    if (!/^\d+$/.test(value)) throw new BadRequestException('Validation failed (numeric string is expected).');
    const id = Number(value);
    if (id < 1 || id > INT4_MAX) throw new NotFoundException('Not found.');
    return id;
  }
}
