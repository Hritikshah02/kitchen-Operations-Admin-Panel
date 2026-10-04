ALTER TABLE "KitchenSettings" ALTER COLUMN "workingDays" SET DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[];
UPDATE "KitchenSettings" SET "workingDays" = ARRAY[1, 2, 3, 4, 5, 6] WHERE "workingDays" = ARRAY[1, 2, 3, 4, 5];
