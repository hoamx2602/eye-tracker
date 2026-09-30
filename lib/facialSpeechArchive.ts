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

/** Set once the deferred analysis has been run over a stored capture. */
export const FACIAL_SPEECH_ANALYSED_STATUS = 'facial_speech_analysed';

/** Every status that identifies a Session row as a facial-speech capture. Used
 * to route rows to the facial tab and away from the calibration list. */
export const FACIAL_SPEECH_STATUSES = [FACIAL_SPEECH_PENDING_STATUS, FACIAL_SPEECH_ANALYSED_STATUS];

/** Value of `config.protocol` on a stored capture. */
export const FACIAL_SPEECH_PROTOCOL_ID = 'facial-speech-screening';

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
 * Record the capture, then upload it. `onProgress` reports the stage so the
 * caller can keep the subject informed while a large video uploads.
 *
 * The Session row is created first because uploads are only signed for an
 * open Session or run (see lib/s3Server.ts). The objects land under that
 * session's folder; a batch analysis finds them through the Session rows with
 * a facial-speech status.
 */
export async function archiveFacialSpeechCapture(
  video: Blob,
  manifest: Record<string, unknown>,
  onProgress?: (message: string) => void,
): Promise<ArchivedCapture> {
  if (!video.size) throw new Error('No capture video is available to save.');
  const captureId = String(manifest.sessionId ?? `facial-speech-${Date.now()}`);
  const subject = manifest.subject;
  const baseConfig = { protocol: FACIAL_SPEECH_PROTOCOL_ID, captureId, analysis: 'deferred', manifest };

  onProgress?.('Recording the capture in the system…');
  const session = await sessionsApi.create({
    status: FACIAL_SPEECH_PENDING_STATUS,
    ...(subject && typeof subject === 'object' ? { demographics: subject as CreateSessionPayload['demographics'] } : {}),
    config: baseConfig,
  });
  const owner = { type: 'session' as const, id: session.id };

  onProgress?.('Uploading the recording…');
  const videoUrl = await uploadApi.uploadBlob(video, `${captureId}.webm`, video.type || 'video/webm', owner);

  // The manifest goes up as its own object as well as into the row: the task
  // windows are what makes the video analysable at all, and a file beside the
  // video keeps a batch re-analysis from having to read the database.
  onProgress?.('Uploading the capture metadata…');
  const metadataBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const metadataUrl = await uploadApi.uploadBlob(metadataBlob, `${captureId}.meta.json`, 'application/json', owner);

  await sessionsApi.update(session.id, { ...(videoUrl ? { videoUrl } : {}), config: { ...baseConfig, metadataUrl } });
  return { sessionId: session.id, videoUrl, metadataUrl };
}
