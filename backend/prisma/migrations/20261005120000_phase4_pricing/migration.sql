-- Phase 4: price tiers, typed/override prices per dish and option, company tier.
-- CreateEnum
CREATE TYPE "PriceRule" AS ENUM ('MANUAL', 'COST_MULTIPLIER', 'TIER_PERCENT');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "priceTierId" INTEGER;

-- CreateTable
CREATE TABLE "PriceTier" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "rule" "PriceRule" NOT NULL DEFAULT 'MANUAL',
    "ruleValueBps" INTEGER,
    "baseTierId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DishPrice" (
    "tierId" INTEGER NOT NULL,
    "dishId" INTEGER NOT NULL,
    "priceCents" INTEGER,
    "isUnavailable" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DishPrice_pkey" PRIMARY KEY ("tierId","dishId")
);

-- CreateTable
CREATE TABLE "OptionPrice" (
    "tierId" INTEGER NOT NULL,
    "optionId" INTEGER NOT NULL,
    "priceCents" INTEGER,
    "isUnavailable" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OptionPrice_pkey" PRIMARY KEY ("tierId","optionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceTier_name_key" ON "PriceTier"("name");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_priceTierId_fkey" FOREIGN KEY ("priceTierId") REFERENCES "PriceTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceTier" ADD CONSTRAINT "PriceTier_baseTierId_fkey" FOREIGN KEY ("baseTierId") REFERENCES "PriceTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DishPrice" ADD CONSTRAINT "DishPrice_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "PriceTier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DishPrice" ADD CONSTRAINT "DishPrice_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionPrice" ADD CONSTRAINT "OptionPrice_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "PriceTier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionPrice" ADD CONSTRAINT "OptionPrice_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "Option"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Exactly one default tier at most; the API keeps exactly one.
CREATE UNIQUE INDEX "PriceTier_single_default" ON "PriceTier"("isDefault") WHERE "isDefault";

-- A price row must say something: a price, or "not sold".
ALTER TABLE "DishPrice" ADD CONSTRAINT "DishPrice_has_value" CHECK ("priceCents" IS NOT NULL OR "isUnavailable");
ALTER TABLE "OptionPrice" ADD CONSTRAINT "OptionPrice_has_value" CHECK ("priceCents" IS NOT NULL OR "isUnavailable");
ALTER TABLE "DishPrice" ADD CONSTRAINT "DishPrice_non_negative" CHECK ("priceCents" IS NULL OR "priceCents" >= 0);
ALTER TABLE "OptionPrice" ADD CONSTRAINT "OptionPrice_non_negative" CHECK ("priceCents" IS NULL OR "priceCents" >= 0);
