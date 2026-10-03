// Idempotent seed for an Ahmedabad corporate-lunch kitchen. Safe to re-run against any environment:
// - roles and the four review accounts are always restored to their defined state;
// - everything else is created only if missing, so edits made in the admin panel survive a re-seed.
// Source data (researched, with citations for holidays) lives in prisma/seed-data/ahmedabad.json.
import { readFileSync } from 'node:fs';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const data = JSON.parse(readFileSync(new URL('./seed-data/ahmedabad.json', import.meta.url), 'utf8'));

const ALL = [
  'dashboard:view', 'staff:manage', 'settings:manage', 'reference-data:manage', 'companies:manage',
  'catalogue:manage', 'orders:manage', 'kitchen-board:view', 'kitchen-board:update',
  'dispatch-board:view', 'dispatch-board:update', 'driver-drops:view', 'driver-drops:update',
];

// Adding a role = adding a row here (or via the database). No code checks role names.
const roles = [
  { name: 'ADMIN', label: 'Admin', capabilities: ALL },
  { name: 'KITCHEN', label: 'Kitchen', capabilities: ['dashboard:view', 'kitchen-board:view', 'kitchen-board:update'] },
  { name: 'DISPATCH', label: 'Dispatch', capabilities: ['dashboard:view', 'dispatch-board:view', 'dispatch-board:update'] },
  { name: 'DRIVER', label: 'Driver', capabilities: ['dashboard:view', 'driver-drops:view', 'driver-drops:update'] },
];

// The four review accounts (exact credentials required by the brief) plus extra realistic staff.
const reviewAccounts = [
  { name: 'Priya Mehta', email: 'admin@test.com', role: 'ADMIN' },
  { name: 'Ramesh Patel', email: 'kitchen@test.com', role: 'KITCHEN' },
  { name: 'Harsh Desai', email: 'dispatch@test.com', role: 'DISPATCH' },
  { name: data.drivers[0].name, email: 'driver@test.com', role: 'DRIVER' },
];
const extraStaff = [
  ...data.drivers.slice(1).map((driver) => ({
    name: driver.name,
    email: `${driver.name.split(' ')[0].toLowerCase()}.driver@test.com`,
    role: 'DRIVER',
  })),
  { name: 'Bhavna Solanki', email: 'bhavna.kitchen@test.com', role: 'KITCHEN' },
  { name: 'Imran Shaikh', email: 'imran.dispatch@test.com', role: 'DISPATCH' },
];

// Short display names for the UI; descriptions keep the researched detail.
const allergenNames = {
  MILK: 'Milk / Dairy', GLUTEN: 'Gluten (wheat)', PEANUT: 'Peanuts', TREENUT: 'Tree nuts', SESAME: 'Sesame',
  MUSTARD: 'Mustard', SOY: 'Soy', SULPHITE: 'Sulphites', EGG: 'Egg',
};

async function createMissing(delegate, items) {
  for (const [index, item] of items.entries()) {
    await delegate.upsert({
      where: { name: item.name },
      update: {},
      create: { name: item.name, description: item.description ?? null, sortOrder: (index + 1) * 10 },
    });
  }
}

async function main() {
  const roleIds = {};
  for (const role of roles) {
    const saved = await prisma.role.upsert({ where: { name: role.name }, update: role, create: role });
    roleIds[role.name] = saved.id;
  }

  const passwordHash = await argon2.hash('Test@1234', { type: argon2.argon2id });
  for (const account of reviewAccounts) {
    await prisma.staff.upsert({
      where: { email: account.email },
      update: { name: account.name, passwordHash, roleId: roleIds[account.role], isActive: true },
      create: { name: account.name, email: account.email, passwordHash, roleId: roleIds[account.role] },
    });
  }
  for (const account of extraStaff) {
    await prisma.staff.upsert({
      where: { email: account.email },
      update: {},
      create: { name: account.name, email: account.email, passwordHash, roleId: roleIds[account.role] },
    });
  }

  // Defaults come from the migration (Mon-Fri, 16:00, 1 working day, 30 min buffer, 60 min lead).
  await prisma.kitchenSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  for (const holiday of data.holidays.filter((entry) => entry.closesKitchen)) {
    const name = holiday.status === 'tentative' ? `${holiday.name} (tentative)` : holiday.name;
    await prisma.kitchenHoliday.upsert({
      where: { date: new Date(`${holiday.date}T00:00:00.000Z`) },
      update: {},
      create: { date: new Date(`${holiday.date}T00:00:00.000Z`), name },
    });
  }

  await createMissing(prisma.kitchenStation, data.stations);
  await createMissing(
    prisma.allergen,
    data.allergens.map((allergen) => ({ name: allergenNames[allergen.code] ?? allergen.name, description: allergen.description })),
  );
  await createMissing(prisma.dietaryTag, data.dietaryTags.map((tag) => ({ name: tag.name, description: tag.definition })));
  await createMissing(
    prisma.portionSize,
    data.portionSizes.filter((size) => !size.optional).map((size) => ({ name: size.name, description: size.description })),
  );
}

main()
  .then(() => console.log('Seeded roles, staff, settings, holidays and reference data.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
