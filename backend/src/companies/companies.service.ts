import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CompaniesService {
  constructor(private prisma: PrismaService) {}

  create(data: { name: string; emailDomain: string }) {
    return this.prisma.company.create({ data });
  }

  findAll() {
    return this.prisma.company.findMany();
  }
}
