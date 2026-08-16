-- AlterTable
ALTER TABLE "Calendar" ADD COLUMN     "creationKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Calendar_creationKey_key" ON "Calendar"("creationKey");
