-- Portal accounts are intentionally separate from system admins.
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PATIENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TestInvitation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "assessmentType" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TestInvitation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Session"
    ADD COLUMN "assessmentType" TEXT DEFAULT 'EYE_TRACKING',
    ADD COLUMN "doctorId" TEXT,
    ADD COLUMN "patientId" TEXT,
    ADD COLUMN "invitationId" TEXT;

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_role_idx" ON "users"("role");
CREATE UNIQUE INDEX "TestInvitation_code_key" ON "TestInvitation"("code");
CREATE INDEX "TestInvitation_doctorId_createdAt_idx" ON "TestInvitation"("doctorId", "createdAt");
CREATE INDEX "TestInvitation_active_expiresAt_idx" ON "TestInvitation"("active", "expiresAt");
CREATE INDEX "Session_doctorId_createdAt_idx" ON "Session"("doctorId", "createdAt");
CREATE INDEX "Session_patientId_createdAt_idx" ON "Session"("patientId", "createdAt");
CREATE INDEX "Session_invitationId_idx" ON "Session"("invitationId");

ALTER TABLE "TestInvitation" ADD CONSTRAINT "TestInvitation_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_invitationId_fkey"
    FOREIGN KEY ("invitationId") REFERENCES "TestInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
