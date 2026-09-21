-- Participant-supplied email, collected on the demographics screen.
-- Indexed so the same participant can be found across sessions.
ALTER TABLE "Session" ADD COLUMN "participantEmail" TEXT;

CREATE INDEX "Session_participantEmail_idx" ON "Session"("participantEmail");
