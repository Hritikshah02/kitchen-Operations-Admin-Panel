-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderEventType" ADD VALUE 'DRIVER_ASSIGNED';
ALTER TYPE "OrderEventType" ADD VALUE 'DISPATCH_READY';
ALTER TYPE "OrderEventType" ADD VALUE 'OUT_FOR_DELIVERY';

-- AlterTable
ALTER TABLE "KitchenSettings" ADD COLUMN     "onTimeGraceMinutes" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveredById" INTEGER,
ADD COLUMN     "deliveredOnTime" BOOLEAN,
ADD COLUMN     "deliveryLateMinutes" INTEGER,
ADD COLUMN     "deliveryNote" TEXT,
ADD COLUMN     "deliveryPhotoUrl" TEXT,
ADD COLUMN     "dispatchReadyAt" TIMESTAMP(3),
ADD COLUMN     "driverId" INTEGER,
ADD COLUMN     "outForDeliveryAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Order_driverId_deliveryDate_idx" ON "Order"("driverId", "deliveryDate");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

