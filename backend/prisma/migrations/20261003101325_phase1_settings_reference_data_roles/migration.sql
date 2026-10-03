-- AlterTable: add columns nullable, backfill the four existing roles, then enforce NOT NULL.
ALTER TABLE "Role" ADD COLUMN     "capabilities" TEXT[],
ADD COLUMN     "label" TEXT;

UPDATE "Role" SET "label" = 'Admin', "capabilities" = ARRAY[
  'dashboard:view', 'staff:manage', 'settings:manage', 'reference-data:manage', 'companies:manage',
  'catalogue:manage', 'orders:manage', 'kitchen-board:view', 'kitchen-board:update',
  'dispatch-board:view', 'dispatch-board:update', 'driver-drops:view', 'driver-drops:update'
] WHERE "name" = 'ADMIN';
UPDATE "Role" SET "label" = 'Kitchen', "capabilities" = ARRAY['dashboard:view', 'kitchen-board:view', 'kitchen-board:update'] WHERE "name" = 'KITCHEN';
UPDATE "Role" SET "label" = 'Dispatch', "capabilities" = ARRAY['dashboard:view', 'dispatch-board:view', 'dispatch-board:update'] WHERE "name" = 'DISPATCH';
UPDATE "Role" SET "label" = 'Driver', "capabilities" = ARRAY['dashboard:view', 'driver-drops:view', 'driver-drops:update'] WHERE "name" = 'DRIVER';
UPDATE "Role" SET "label" = "name", "capabilities" = ARRAY[]::TEXT[] WHERE "label" IS NULL;

ALTER TABLE "Role" ALTER COLUMN "label" SET NOT NULL;

-- CreateTable
CREATE TABLE "KitchenSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "cutoffTime" TEXT NOT NULL DEFAULT '16:00',
    "cutoffWorkingDays" INTEGER NOT NULL DEFAULT 1,
    "kitchenReadyBufferMinutes" INTEGER NOT NULL DEFAULT 30,
    "defaultDispatchLeadMinutes" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitchenSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenHoliday" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KitchenHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allergen" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Allergen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DietaryTag" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DietaryTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenStation" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "KitchenStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortionSize" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PortionSize_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KitchenHoliday_date_key" ON "KitchenHoliday"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Allergen_name_key" ON "Allergen"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DietaryTag_name_key" ON "DietaryTag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenStation_name_key" ON "KitchenStation"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PortionSize_name_key" ON "PortionSize"("name");

-- The settings singleton must exist before anyone reads it.
INSERT INTO "KitchenSettings" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING;
