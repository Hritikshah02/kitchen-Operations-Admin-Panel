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
  'catalogue:manage', 'orders:manage', 'orders:override', 'kitchen-board:view', 'kitchen-board:update',
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

// Researched prices are in rupees; the app prices in USD. ₹85 = $1, rounded up to the next 5 cents.
const INR_PER_USD = 85;
const usdCents = (inr) => Math.ceil((inr * 100) / INR_PER_USD / 5) * 5;

async function seedCatalogue() {
  const byName = async (delegate) => Object.fromEntries((await delegate.findMany()).map((row) => [row.name, row.id]));
  const stations = await byName(prisma.kitchenStation);
  const allergens = await byName(prisma.allergen);
  const tags = await byName(prisma.dietaryTag);
  const sizes = await byName(prisma.portionSize);
  const stationName = Object.fromEntries(data.stations.map((station) => [station.code, station.name]));
  const tagName = Object.fromEntries(data.dietaryTags.map((tag) => [tag.code, tag.name]));
  const allergenIds = (codes) => codes.map((code) => allergens[allergenNames[code]]).filter(Boolean).map((id) => ({ id }));
  const tagIds = (codes) => codes.map((code) => tags[tagName[code]]).filter(Boolean).map((id) => ({ id }));

  const groupIds = {};
  for (const group of data.optionGroups) {
    const saved = await prisma.optionGroup.upsert({
      where: { name: group.name },
      update: {},
      create: { name: group.name, minSelect: group.minSelect, maxSelect: group.maxSelect, usesPortions: group.usesPortions },
    });
    groupIds[group.code] = saved.id;
    for (const [index, option] of group.options.entries()) {
      const savedOption = await prisma.option.upsert({
        where: { name: option.name },
        update: {},
        create: {
          name: option.name,
          costCents: usdCents(option.costINR),
          allergens: { connect: allergenIds(option.allergens) },
          dietaryTags: { connect: tagIds(option.dietaryTags) },
        },
      });
      await prisma.optionGroupItem.upsert({
        where: { groupId_optionId: { groupId: saved.id, optionId: savedOption.id } },
        update: {},
        create: { groupId: saved.id, optionId: savedOption.id, sortOrder: (index + 1) * 10 },
      });
      if (group.usesPortions) {
        for (const [size, inr] of [['Regular', 0], ['Large', group.largeSurchargeINR ?? 0]]) {
          await prisma.optionPortionSurcharge.upsert({
            where: { optionId_portionSizeId: { optionId: savedOption.id, portionSizeId: sizes[size] } },
            update: {},
            create: { optionId: savedOption.id, portionSizeId: sizes[size], surchargeCents: inr ? usdCents(inr) : 0 },
          });
        }
      }
    }
    if (group.usesPortions) {
      await prisma.optionGroupPortion.createMany({
        data: ['Regular', 'Large'].map((size) => ({ groupId: saved.id, portionSizeId: sizes[size] })),
        skipDuplicates: true,
      });
    }
  }

  for (const category of data.menu) {
    for (const dish of category.dishes) {
      const saved = await prisma.dish.upsert({
        where: { sku: dish.sku },
        update: {},
        create: {
          sku: dish.sku,
          name: dish.name,
          description: dish.description,
          temperature: dish.temperature === 'cold' ? 'COLD' : 'HOT',
          costCents: usdCents(dish.costPriceINR),
          stationId: stations[stationName[dish.station]] ?? null,
          minOrderQty: dish.minOrderQty ?? 1,
          allergens: { connect: allergenIds(dish.allergens) },
          dietaryTags: { connect: tagIds(dish.dietaryTags) },
        },
      });
      await prisma.dishOptionGroup.createMany({
        data: (dish.optionGroups ?? []).filter((code) => groupIds[code]).map((code, index) => ({ dishId: saved.id, groupId: groupIds[code], sortOrder: (index + 1) * 10 })),
        skipDuplicates: true,
      });
    }
  }
}

// Standard = researched list prices (typed), Enterprise = Standard − 8%, Partner = cost × 1.6 (both derived).
// Two deliberate gaps make the "no price → not on the menu" rule visible in the demo.
const UNPRICED_ON_STANDARD = 'BEV-005';
const NOT_SOLD_ON_ENTERPRISE = 'GUJ-005';

async function seedPricing() {
  const firstRun = (await prisma.priceTier.count()) === 0;
  const standard = await prisma.priceTier.upsert({ where: { name: 'Standard' }, update: {}, create: { name: 'Standard', isDefault: firstRun, rule: 'MANUAL' } });
  const enterprise = await prisma.priceTier.upsert({ where: { name: 'Enterprise' }, update: {}, create: { name: 'Enterprise', rule: 'TIER_PERCENT', ruleValueBps: -800, baseTierId: standard.id } });
  const partner = await prisma.priceTier.upsert({ where: { name: 'Partner' }, update: {}, create: { name: 'Partner', rule: 'COST_MULTIPLIER', ruleValueBps: 16000 } });

  const dishes = Object.fromEntries((await prisma.dish.findMany()).map((dish) => [dish.sku, dish.id]));
  const options = Object.fromEntries((await prisma.option.findMany()).map((option) => [option.name, option.id]));
  await prisma.dishPrice.createMany({
    data: data.menu.flatMap((category) => category.dishes)
      .filter((dish) => dish.sku !== UNPRICED_ON_STANDARD && dishes[dish.sku])
      .map((dish) => ({ tierId: standard.id, dishId: dishes[dish.sku], priceCents: usdCents(dish.sellingPriceINR) })),
    skipDuplicates: true,
  });
  await prisma.optionPrice.createMany({
    data: data.optionGroups.flatMap((group) => group.options)
      .filter((option, index, all) => options[option.name] && all.findIndex((other) => other.name === option.name) === index)
      .map((option) => ({ tierId: standard.id, optionId: options[option.name], priceCents: usdCents(option.priceAddOnINR) })),
    skipDuplicates: true,
  });
  if (dishes[NOT_SOLD_ON_ENTERPRISE]) {
    await prisma.dishPrice.createMany({ data: [{ tierId: enterprise.id, dishId: dishes[NOT_SOLD_ON_ENTERPRISE], isUnavailable: true }], skipDuplicates: true });
  }

  if (firstRun) {
    const tierIds = { Standard: null, Enterprise: enterprise.id, Partner: partner.id }; // Standard companies use the default (null)
    for (const company of data.companies) {
      const domain = await prisma.companyDomain.findUnique({ where: { domain: company.emailDomains[0] } });
      if (domain) await prisma.company.update({ where: { id: domain.companyId }, data: { priceTierId: tierIds[company.priceTier] ?? null } });
    }
  }
}

// Two meeting trays (not in the research menu) make up a secret category, reachable only by search.
const meetingTrays = [
  { sku: 'MTG-001', name: 'Khaman Dhokla Party Tray (serves 10)', description: 'Steamed khaman with green chutney and fried chillies, foil tray.', station: 'FARSAN', costINR: 380, priceINR: 750, allergens: ['MUSTARD', 'SESAME'], tags: ['VEG', 'EGGLESS'] },
  { sku: 'MTG-002', name: 'Kesar Shrikhand Tray (serves 12)', description: 'Saffron-cardamom shrikhand with pistachio, chilled tray.', station: 'SWEETS', costINR: 520, priceINR: 1100, allergens: ['MILK', 'TREENUT'], tags: ['VEG', 'EGGLESS', 'GF'], temperature: 'COLD' },
];

async function seedMenu() {
  if ((await prisma.menuCategory.count()) > 0) return; // menu is curated in the admin panel after the first seed
  const stationName = Object.fromEntries(data.stations.map((station) => [station.code, station.name]));
  const stations = Object.fromEntries((await prisma.kitchenStation.findMany()).map((row) => [row.name, row.id]));
  const allergens = Object.fromEntries((await prisma.allergen.findMany()).map((row) => [row.name, row.id]));
  const tagName = Object.fromEntries(data.dietaryTags.map((tag) => [tag.code, tag.name]));
  const tags = Object.fromEntries((await prisma.dietaryTag.findMany()).map((row) => [row.name, row.id]));
  const standard = await prisma.priceTier.findUniqueOrThrow({ where: { name: 'Standard' } });

  for (const tray of meetingTrays) {
    const dish = await prisma.dish.upsert({
      where: { sku: tray.sku },
      update: {},
      create: {
        sku: tray.sku, name: tray.name, description: tray.description, temperature: tray.temperature ?? 'HOT',
        costCents: usdCents(tray.costINR), stationId: stations[stationName[tray.station]] ?? null, minOrderQty: 2,
        allergens: { connect: tray.allergens.map((code) => ({ id: allergens[allergenNames[code]] })) },
        dietaryTags: { connect: tray.tags.map((code) => ({ id: tags[tagName[code]] })).filter((entry) => entry.id) },
      },
    });
    await prisma.dishPrice.createMany({ data: [{ tierId: standard.id, dishId: dish.id, priceCents: usdCents(tray.priceINR) }], skipDuplicates: true });
  }

  const dishes = Object.fromEntries((await prisma.dish.findMany()).map((dish) => [dish.sku, dish.id]));
  const categories = [
    ...data.menu.map((category) => ({ name: category.category, skus: category.dishes.map((dish) => dish.sku), isSecret: false })),
    { name: 'Meeting & bulk trays', skus: meetingTrays.map((tray) => tray.sku), isSecret: true, description: 'Not listed: staff find these by searching when ordering for meetings.' },
  ];
  const ids = {};
  for (const [index, category] of categories.entries()) {
    const saved = await prisma.menuCategory.create({
      data: {
        name: category.name, description: category.description ?? null, isSecret: category.isSecret, sortOrder: (index + 1) * 10,
        items: { create: category.skus.filter((sku) => dishes[sku]).map((sku, position) => ({ dishId: dishes[sku], sortOrder: (position + 1) * 10 })) },
      },
    });
    ids[category.name] = saved.id;
  }

  // Realistic per-company hiding: the GIFT City fintech only takes lunch; the gems firm (largely Jain staff) hides the garlic-heavy box.
  const companyByDomain = async (domain) => (await prisma.companyDomain.findUnique({ where: { domain } }))?.companyId;
  const ledgerkite = await companyByDomain('ledgerkite.in');
  if (ledgerkite && ids['Breakfast & Farsan']) await prisma.companyHiddenCategory.create({ data: { companyId: ledgerkite, categoryId: ids['Breakfast & Farsan'] } });
  const hiranyaprabha = await companyByDomain('hiranyaprabha.com');
  if (hiranyaprabha && dishes['GUJ-003']) await prisma.companyHiddenDish.create({ data: { companyId: hiranyaprabha, dishId: dishes['GUJ-003'] } });
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
  await seedCatalogue();
  await seedPricing();
  await seedMenu();
}

main()
  .then(() => console.log('Seeded roles, staff, settings, holidays, reference data, companies, employees, catalogue, pricing and menu.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
