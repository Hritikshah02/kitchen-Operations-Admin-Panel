import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const staffAccounts = [
  { name: 'Admin', email: 'admin@test.com', role: 'ADMIN' },
  { name: 'Kitchen', email: 'kitchen@test.com', role: 'KITCHEN' },
  { name: 'Dispatch', email: 'dispatch@test.com', role: 'DISPATCH' },
  { name: 'Driver', email: 'driver@test.com', role: 'DRIVER' },
];

async function main() {
  const passwordHash = await argon2.hash('Test@1234', { type: argon2.argon2id });

  for (const account of staffAccounts) {
    const role = await prisma.role.upsert({
      where: { name: account.role },
      update: {},
      create: { name: account.role },
    });

    await prisma.staff.upsert({
      where: { email: account.email },
      update: { name: account.name, passwordHash, roleId: role.id, isActive: true },
      create: {
        name: account.name,
        email: account.email,
        passwordHash,
        roleId: role.id,
      },
    });
  }
}

main()
  .then(() => console.log('Seeded required staff accounts.'))
  .finally(async () => prisma.$disconnect());
