-- CreateTable
CREATE TABLE "NeurologicalTestConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'default',
    "testOrder" JSONB NOT NULL,
    "testParameters" JSONB NOT NULL,
    "testEnabled" JSONB,

    CONSTRAINT "NeurologicalTestConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NeurologicalRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sessionId" TEXT NOT NULL,
    "configSnapshot" JSONB,
    "preSymptomScores" JSONB,
    "postSymptomScores" JSONB,
    "testOrderSnapshot" JSONB,
    "testResults" JSONB,
    "status" TEXT NOT NULL DEFAULT 'in_progress',

    CONSTRAINT "NeurologicalRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NeurologicalTestConfig_name_key" ON "NeurologicalTestConfig"("name");

-- CreateIndex
CREATE UNIQUE INDEX "NeurologicalRun_sessionId_key" ON "NeurologicalRun"("sessionId");

-- AddForeignKey
ALTER TABLE "NeurologicalRun" ADD CONSTRAINT "NeurologicalRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
