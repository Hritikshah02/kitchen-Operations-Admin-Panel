-- Phase 2: companies get several domains, addresses, a calendar and delivery defaults; employees get
-- permission flags, allergies and dietary preferences. Existing rows are carried over, not dropped.

-- CreateTable
CREATE TABLE "CompanyDomain" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,

    CONSTRAINT "CompanyDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyAddress" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "area" TEXT,
    "city" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyHoliday" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "CompanyHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagingType" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PackagingType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AllergenToEmployee" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_AllergenToEmployee_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_DietaryTagToEmployee" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_DietaryTagToEmployee_AB_pkey" PRIMARY KEY ("A","B")
);


-- Move each company's single email domain into CompanyDomain before dropping the column.
INSERT INTO "CompanyDomain" ("companyId", "domain") SELECT "id", lower("emailDomain") FROM "Company";
DROP INDEX "Company_emailDomain_key";

-- Add new company columns nullable, backfill existing rows, then enforce NOT NULL.
ALTER TABLE "Company"
ADD COLUMN     "billingContactEmail" TEXT,
ADD COLUMN     "billingContactName" TEXT,
ADD COLUMN     "billingContactPhone" TEXT,
ADD COLUMN     "defaultDeliveryTime" TEXT NOT NULL DEFAULT '12:30',
ADD COLUMN     "defaultDriverId" INTEGER,
ADD COLUMN     "defaultPackagingTypeId" INTEGER,
ADD COLUMN     "deliveryWindowEnd" TEXT NOT NULL DEFAULT '14:00',
ADD COLUMN     "deliveryWindowStart" TEXT NOT NULL DEFAULT '12:00',
ADD COLUMN     "dispatchLeadMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "driverInstructions" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ownerId" INTEGER,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[];

UPDATE "Company" SET
  "isActive" = ("status" = 'ACTIVE'),
  "billingContactName" = 'Billing contact (to be updated)',
  "billingContactEmail" = 'billing@' || lower("emailDomain"),
  "dispatchLeadMinutes" = COALESCE((SELECT "defaultDispatchLeadMinutes" FROM "KitchenSettings" WHERE "id" = 1), 60);

ALTER TABLE "Company"
ALTER COLUMN "billingContactName" SET NOT NULL,
ALTER COLUMN "billingContactEmail" SET NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT,
DROP COLUMN "emailDomain",
DROP COLUMN "status";

-- Employee email becomes globally unique (a domain maps to exactly one company).
DROP INDEX "Employee_companyId_email_key";
ALTER TABLE "Employee" ADD COLUMN     "canChangeDeliveryTime" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canChangePackaging" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canChooseAddress" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Employee" SET "email" = lower("email");
ALTER TABLE "Employee" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "CompanyDomain_domain_key" ON "CompanyDomain"("domain");

-- CreateIndex
CREATE INDEX "CompanyDomain_companyId_idx" ON "CompanyDomain"("companyId");

-- CreateIndex
CREATE INDEX "CompanyAddress_companyId_idx" ON "CompanyAddress"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyHoliday_companyId_date_key" ON "CompanyHoliday"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PackagingType_name_key" ON "PackagingType"("name");

-- CreateIndex
CREATE INDEX "_AllergenToEmployee_B_index" ON "_AllergenToEmployee"("B");

-- CreateIndex
CREATE INDEX "_DietaryTagToEmployee_B_index" ON "_DietaryTagToEmployee"("B");

-- CreateIndex
CREATE UNIQUE INDEX "Company_ownerId_key" ON "Company"("ownerId");

-- CreateIndex
CREATE INDEX "Company_isActive_name_idx" ON "Company"("isActive", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");

-- CreateIndex
CREATE INDEX "Employee_companyId_isActive_idx" ON "Employee"("companyId", "isActive");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_defaultPackagingTypeId_fkey" FOREIGN KEY ("defaultPackagingTypeId") REFERENCES "PackagingType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_defaultDriverId_fkey" FOREIGN KEY ("defaultDriverId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDomain" ADD CONSTRAINT "CompanyDomain_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAddress" ADD CONSTRAINT "CompanyAddress_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyHoliday" ADD CONSTRAINT "CompanyHoliday_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AllergenToEmployee" ADD CONSTRAINT "_AllergenToEmployee_A_fkey" FOREIGN KEY ("A") REFERENCES "Allergen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AllergenToEmployee" ADD CONSTRAINT "_AllergenToEmployee_B_fkey" FOREIGN KEY ("B") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DietaryTagToEmployee" ADD CONSTRAINT "_DietaryTagToEmployee_A_fkey" FOREIGN KEY ("A") REFERENCES "DietaryTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DietaryTagToEmployee" ADD CONSTRAINT "_DietaryTagToEmployee_B_fkey" FOREIGN KEY ("B") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one default address per company.
CREATE UNIQUE INDEX "CompanyAddress_one_default_per_company" ON "CompanyAddress"("companyId") WHERE "isDefault";
