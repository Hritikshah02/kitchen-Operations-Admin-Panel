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

const packagingNames = {
  BAGASSE: 'Bagasse compartment box',
  STEEL_TIFFIN: 'Steel tiffin (reusable)',
  PP_TRAY: 'Sealed PP tray',
  PAPER_BOWL: 'Kraft paper bowl',
  TRAY_BULK: 'Foil tray (bulk)',
};
const WEEKDAY = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7 };

// Per-company extras the research does not cover: realistic driver notes and one company holiday each.
const companyExtras = {
  'kesarloop.in': { instructions: 'Gate 2 on Sindhu Bhavan Road. Visitor entry at reception, lift to 7th floor; hand over to pantry staff.', holiday: ['2026-11-20', 'Annual offsite'] },
  'narmavedha.com': { instructions: 'Deliver to the cafeteria on the ground floor. R&D wing is restricted; do not go upstairs.', holiday: ['2026-12-18', 'Founders day'] },
  'ledgerkite.in': { instructions: 'GIFT City entry needs the e-pass shared by the billing contact each morning. Long run: leave on time.', holiday: ['2026-12-31', 'Year-end closing'], packaging: 'PP_TRAY', lead: 90 },
  'kalamtantu.com': { instructions: 'Ashram Road traffic is heavy at noon; use the service lane behind the building. Ask for Nilesh at the front desk.', holiday: ['2026-11-27', 'Mill maintenance day'], packaging: 'STEEL_TIFFIN' },
  'gearvardhan.in': { instructions: 'Security logs every delivery; carry the order slip. Engineering floor has a separate pantry on level 3.', holiday: ['2026-12-11', 'Plant safety day'] },
  'hiranyaprabha.com': { instructions: 'High-security premises: wait at the lobby, staff will collect. No bags beyond the lobby.', holiday: ['2026-11-13', 'Labh Pancham stock-taking'] },
};

// Deterministic pseudo-random so every environment seeds the same demo data.
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const emailFor = (name, domain) => `${name.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.')}@${domain}`;

async function seedCompanies(roleIds) {
  const packaging = Object.fromEntries((await prisma.packagingType.findMany()).map((row) => [row.name, row.id]));
  const allergens = await prisma.allergen.findMany({ where: { isActive: true } });
  const tags = await prisma.dietaryTag.findMany({ where: { isActive: true } });
  const drivers = await prisma.staff.findMany({ where: { roleId: roleIds.DRIVER, isActive: true } });
  const driverFor = (area) => {
    const research = data.drivers.find((driver) => driver.route.toLowerCase().includes(area.toLowerCase()));
    return drivers.find((driver) => driver.name === research?.name)?.id ?? null;
  };
  const allergenPool = ['Peanuts', 'Milk / Dairy', 'Gluten (wheat)', 'Tree nuts', 'Sesame'];
  const tagPool = ['Jain', 'Jain', 'Swaminarayan', 'Vegan', 'Gluten-free', 'Low-oil / Diabetic-friendly', 'High-protein'];
  const random = seededRandom(42);
  let nameIndex = 0;

  for (const research of data.companies) {
    const [primaryDomain] = research.emailDomains;
    if (await prisma.companyDomain.findUnique({ where: { domain: primaryDomain } })) {
      nameIndex += research.employeeCountToSeed; // keep name allocation stable across re-runs
      continue;
    }
    const extras = companyExtras[primaryDomain] ?? {};
    const [windowStart, windowEnd] = research.lunchDeliveryWindow.split(/[\u2013-]/).map((part) => part.trim());
    const people = [
      { name: research.billingContact.name, phone: research.billingContact.phone },
      ...data.employeeNames.slice(nameIndex, nameIndex + research.employeeCountToSeed - 1).map((person) => ({ name: `${person.firstName} ${person.lastName}` })),
    ];
    nameIndex += research.employeeCountToSeed;

    await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: research.name,
          billingContactName: research.billingContact.name,
          billingContactEmail: research.billingContact.email,
          billingContactPhone: research.billingContact.phone,
          workingDays: research.workingDays.map((day) => WEEKDAY[day]),
          defaultDeliveryTime: windowStart,
          deliveryWindowStart: windowStart,
          deliveryWindowEnd: windowEnd,
          dispatchLeadMinutes: extras.lead ?? 60,
          defaultPackagingTypeId: packaging[packagingNames[extras.packaging ?? 'BAGASSE']] ?? null,
          driverInstructions: extras.instructions ?? null,
          defaultDriverId: driverFor(research.deliveryAddresses[0].area),
          domains: { create: research.emailDomains.map((domain) => ({ domain })) },
          addresses: {
            create: research.deliveryAddresses.map((address, index) => ({
              label: address.label,
              line1: address.line1.replace(' (fictional)', ''),
              line2: address.road ?? null,
              area: address.area,
              city: address.city,
              pincode: address.pincode,
              isDefault: index === 0,
            })),
          },
          holidays: extras.holiday ? { create: { date: new Date(`${extras.holiday[0]}T00:00:00.000Z`), name: extras.holiday[1] } } : undefined,
        },
      });

      const twoAddresses = research.deliveryAddresses.length > 1;
      let ownerId = null;
      for (const [index, person] of people.entries()) {
        const email = index === 0 ? research.billingContact.email : emailFor(person.name, primaryDomain);
        const pick = (pool) => allergens.concat(tags).find((row) => row.name === pool[Math.floor(random() * pool.length)]);
        const allergy = random() < 0.2 ? pick(allergenPool) : null;
        const preference = random() < 0.35 ? pick(tagPool) : null;
        const employee = await tx.employee.create({
          data: {
            name: person.name,
            email,
            phone: person.phone ?? null,
            companyId: company.id,
            canChooseAddress: twoAddresses && (index === 0 || random() < 0.4),
            canChangeDeliveryTime: index === 0 || random() < 0.2,
            canChangePackaging: index === 0 || random() < 0.15,
            allergens: allergy ? { connect: { id: allergy.id } } : undefined,
            dietaryTags: preference ? { connect: { id: preference.id } } : undefined,
          },
        });
        if (index === 0) ownerId = employee.id;
      }
      await tx.company.update({ where: { id: company.id }, data: { ownerId } });
    });
  }
}

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
    prisma.packagingType,
    data.packagingTypes.map((type) => ({ name: packagingNames[type.code] ?? type.name, description: type.notes })),
  );
  await createMissing(
    prisma.portionSize,
    data.portionSizes.filter((size) => !size.optional).map((size) => ({ name: size.name, description: size.description })),
  );

  await seedCompanies(roleIds);
}

main()
  .then(() => console.log('Seeded roles, staff, settings, holidays, reference data, companies and employees.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
