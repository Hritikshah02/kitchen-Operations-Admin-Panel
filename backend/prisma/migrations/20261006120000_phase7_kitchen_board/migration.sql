-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderEventType" ADD VALUE 'KITCHEN_STARTED';
ALTER TYPE "OrderEventType" ADD VALUE 'KITCHEN_READY';
ALTER TYPE "OrderEventType" ADD VALUE 'FORCE_COMPLETED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "kitchenReadyAt" TIMESTAMP(3),
ADD COLUMN     "kitchenStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrderCombination" ADD COLUMN     "doneAt" TIMESTAMP(3),
ADD COLUMN     "doneById" INTEGER,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "startedById" INTEGER;

-- AddForeignKey
ALTER TABLE "OrderCombination" ADD CONSTRAINT "OrderCombination_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCombination" ADD CONSTRAINT "OrderCombination_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

