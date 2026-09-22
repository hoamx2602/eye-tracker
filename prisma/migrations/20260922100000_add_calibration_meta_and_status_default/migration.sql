-- Session now gets created the moment demographics are submitted, and is
-- patched progressively at every break, instead of being written once at the
-- very end of calibration. A participant who does not finish now leaves a
-- real, inspectable row (status stays 'in_progress') instead of nothing.

-- calibrationMeta: per-dot [t_start, t_end] windows on the recorded video's
-- own clock, plus screen geometry. This is what backend/app/reprocess.py
-- needs to re-fit gaze from the raw video later; without it the video alone
-- cannot be re-aligned to what the participant was looking at.
ALTER TABLE "Session" ADD COLUMN "calibrationMeta" JSONB;

-- A freshly created row starts in_progress, not completed. Existing rows are
-- untouched by this default change.
ALTER TABLE "Session" ALTER COLUMN "status" SET DEFAULT 'in_progress';

CREATE INDEX "Session_status_idx" ON "Session"("status");
