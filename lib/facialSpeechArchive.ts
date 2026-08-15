/**
 * Store a facial-speech capture for later analysis.
 *
 * The measurement backend needs a GPU-class host and is not always available
 * where captures are collected. In that setting the useful thing is not a
 * report on the spot but an intact capture in the system: the video, the exact
 * task windows that were recorded, and who it belongs to. Analysis can then be
 * run over the stored captures whenever the backend is up.
 *
 * Nothing here is facial-speech specific in its storage: the capture is written
 * to the same S3 bucket and Session table the eye-tracking flow already uses,
 * so it shows up in the existing admin views without a schema change.
 */

import { sessionsApi, uploadApi, type CreateSessionPayload } from '@/services/api';

/** Marks a Session row as a capture that has been stored but not yet measured. */
export const FACIAL_SPEECH_PENDING_STATUS = 'facial_speech_captured';

/** Bucket folder, kept apart from the eye-tracking captures so a later batch
 * analysis can enumerate exactly these objects. */
const S3_PREFIX = 'facial-speech';

export interface ArchivedCapture {
  sessionId: string;
  videoUrl: string | null;
  metadataUrl: string | null;
}

export function facialSpeechDeferAnalysisEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_FACIAL_SPEECH_DEFER_ANALYSIS;
  if (raw === undefined || raw.trim() === '') return false;
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

/**
 * Upload the capture and record it. `onProgress` reports the stage so the
 * caller can keep the subject informed while a large video uploads.
 */
export async function archiveFacialSpeechCapture(
  video: Blob,
  manifest: Record<string, unknown>,
  onProgress?: (message: string) => void,
): Promise<ArchivedCapture> {
  if (!video.size) throw new Error('No capture video is available to save.');
  const captureId = String(manifest.sessionId ?? `facial-speech-${Date.now()}`);

  onProgress?.('Uploading the recording…');
  const videoUrl = await uploadApi.uploadBlob(video, `${captureId}.webm`, video.type || 'video/webm', S3_PREFIX);

  // The manifest goes up as its own object as well as into the row: the task
  // windows are what makes the video analysable at all, and a file beside the
  // video keeps a batch re-analysis from having to read the database.
  onProgress?.('Uploading the capture metadata…');
  const metadataBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const metadataUrl = await uploadApi.uploadBlob(metadataBlob, `${captureId}.meta.json`, 'application/json', S3_PREFIX);

  onProgress?.('Recording the capture in the system…');
  const subject = manifest.subject;
  const session = await sessionsApi.create({
    status: FACIAL_SPEECH_PENDING_STATUS,
    ...(videoUrl ? { videoUrl } : {}),
    ...(subject && typeof subject === 'object' ? { demographics: subject as CreateSessionPayload['demographics'] } : {}),
    config: {
      protocol: 'facial-speech-screening',
      captureId,
      analysis: 'deferred',
      metadataUrl,
      manifest,
    },
  });

  return { sessionId: session.id, videoUrl, metadataUrl };
}
