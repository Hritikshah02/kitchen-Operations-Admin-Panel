-- Phase 6: real orders (lines, combinations, choices, timeline) replace the placeholder Order/OrderItem tables.
-- Orders could not be created through the app before this phase, so any existing rows are test data and are cleared.
DELETE FROM "OrderItem";
DELETE FROM "Order";

-- CreateEnum
CREATE TYPE "OrderEventType" AS ENUM ('CREATED', 'UPDATED', 'PLACED', 'CONFIRMED', 'CANCELLED', 'REJECTED', 'DELIVERY_CHANGED', 'ALLERGY_ACKNOWLEDGED', 'DELIVERED');

-- AlterEnum
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('DRAFT', 'PLACED', 'CONFIRMED', 'DELIVERED', 'CANCELLED', 'REJECTED');
ALTER TABLE "public"."Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "public"."OrderStatus_old";
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_orderId_fkey";

-- DropIndex
DROP INDEX "Order_status_deliveryDate_idx";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "total",
ADD COLUMN     "addressId" INTEGER NOT NULL,
ADD COLUMN     "allergyAcknowledged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" INTEGER NOT NULL,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryTime" TEXT NOT NULL,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "packagingTypeId" INTEGER,
ADD COLUMN     "placedAt" TIMESTAMP(3),
ADD COLUMN     "priceTierId" INTEGER NOT NULL,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "totalCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "deliveryDate" SET DATA TYPE DATE;

-- DropTable
DROP TABLE "OrderItem";

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "dishId" INTEGER NOT NULL,
    "dishName" TEXT NOT NULL,
    "dishSku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCombination" (
    "id" SERIAL NOT NULL,
    "lineId" INTEGER NOT NULL,
    "signature" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,

    CONSTRAINT "OrderCombination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderChoice" (
    "id" SERIAL NOT NULL,
    "combinationId" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,
    "groupName" TEXT NOT NULL,
    "optionId" INTEGER NOT NULL,
    "optionName" TEXT NOT NULL,
    "portionSizeId" INTEGER,
    "portionName" TEXT,
    "unitPriceCents" INTEGER NOT NULL,

    CONSTRAINT "OrderChoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "type" "OrderEventType" NOT NULL,
    "message" TEXT NOT NULL,
    "actorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CutoffRun" (
    "id" SERIAL NOT NULL,
    "deliveryDate" DATE NOT NULL,
    "trigger" TEXT NOT NULL,
    "actorId" INTEGER,
    "confirmedCount" INTEGER NOT NULL,
    "cancelledCount" INTEGER NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CutoffRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderCombination_lineId_signature_key" ON "OrderCombination"("lineId", "signature");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "CutoffRun_deliveryDate_idx" ON "CutoffRun"("deliveryDate");

-- CreateIndex
CREATE INDEX "Order_deliveryDate_status_idx" ON "Order"("deliveryDate", "status");

-- CreateIndex
CREATE INDEX "Order_employeeId_deliveryDate_idx" ON "Order"("employeeId", "deliveryDate");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "CompanyAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_packagingTypeId_fkey" FOREIGN KEY ("packagingTypeId") REFERENCES "PackagingType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_priceTierId_fkey" FOREIGN KEY ("priceTierId") REFERENCES "PriceTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCombination" ADD CONSTRAINT "OrderCombination_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderChoice" ADD CONSTRAINT "OrderChoice_combinationId_fkey" FOREIGN KEY ("combinationId") REFERENCES "OrderCombination"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One active order per employee per delivery date (cancelled and rejected ones don't count).
CREATE UNIQUE INDEX "Order_one_active_per_employee_date" ON "Order"("employeeId", "deliveryDate") WHERE "status" NOT IN ('CANCELLED', 'REJECTED');

-- Money is never negative; a combination's total is its unit price times its quantity.
ALTER TABLE "Order" ADD CONSTRAINT "Order_total_non_negative" CHECK ("totalCents" >= 0);
ALTER TABLE "OrderCombination" ADD CONSTRAINT "OrderCombination_total_matches" CHECK ("totalCents" = "unitPriceCents" * "quantity" AND "quantity" > 0);

-- New capability for after-cut-off changes, rejections and delivery overrides; granted to the existing admin role.
UPDATE "Role" SET "capabilities" = array_append("capabilities", 'orders:override')
WHERE "name" = 'ADMIN' AND NOT ('orders:override' = ANY("capabilities"));
