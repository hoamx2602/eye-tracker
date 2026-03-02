-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "trajectories" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TestRun_sessionId_key" ON "TestRun"("sessionId");

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
