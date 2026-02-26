-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "config" JSONB,
    "validationErrors" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "meanErrorPx" DOUBLE PRECISION,
    "status" TEXT DEFAULT 'completed',

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
