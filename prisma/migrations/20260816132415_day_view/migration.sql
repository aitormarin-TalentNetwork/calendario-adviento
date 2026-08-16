-- CreateTable
CREATE TABLE "DayView" (
    "id" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dayId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "DayView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DayView_dayId_userId_key" ON "DayView"("dayId", "userId");

-- AddForeignKey
ALTER TABLE "DayView" ADD CONSTRAINT "DayView_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "Day"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayView" ADD CONSTRAINT "DayView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
