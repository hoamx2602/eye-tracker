-- AlterTable: add calibration capture and gaze fields to Session
--
-- videoUrl: 1 URL (TEXT) — link tới video calibration trên S3
--
-- calibrationImageUrls: JSONB — mảng URL ảnh chụp từng frame trong lúc calibration.
--   Ví dụ: ["https://bucket.s3.../calibration/xxx-0.jpg", "https://.../calibration/xxx-1.jpg", ...]
--   Mỗi phần tử là 1 string (URL ảnh đã upload lên S3).
--
-- calibrationGazeSamples: JSONB — mảng các mẫu eye-tracking trong lúc calibration.
--   Mỗi phần tử: { "screenX": number, "screenY": number, "features"?: number[], "timestamp"?: number }
--   Dùng để lưu toàn bộ (screenX, screenY, feature vector, thời điểm) mỗi lần thu mẫu (grid + exercises).
--
ALTER TABLE "Session" ADD COLUMN "videoUrl" TEXT;
ALTER TABLE "Session" ADD COLUMN "calibrationImageUrls" JSONB;
ALTER TABLE "Session" ADD COLUMN "calibrationGazeSamples" JSONB;
