/**
 * The provenance record that travels with a facial-speech capture: consent,
 * media settings, the exact task windows and the quality policy. The offline
 * processor slices the video by these windows, so they are the ground truth.
 */
import {
  FACIAL_CONSENT_NOTICE_VERSION,
  FACIAL_SPEECH_METRICS,
  FACIAL_SPEECH_PROTOCOL_VERSION,
  FACIAL_SPEECH_TASKS,
} from './facialSpeechProtocol';

export interface CompletedTask {
  id: string;
  startedAtMs: number;
  endedAtMs: number;
  recordedDurationMs: number;
  expectedDurationSec: number;
  endedEarly: boolean;
}

export interface ManifestInput {
  sessionId: string;
  video: Blob;
  stream: MediaStream | null;
  captureStartedAt: string | null;
  consentAt: string | null;
  recorderStartLatencyMs: number | null;
  tasks: CompletedTask[];
}

function trackSettings(track: MediaStreamTrack | undefined) {
  if (!track) return null;
  return { label: track.label, settings: track.getSettings?.() ?? {} };
}

export function buildCaptureManifest(input: ManifestInput): Record<string, unknown> {
  return {
    protocol: 'facial-speech-screening',
    protocolVersion: FACIAL_SPEECH_PROTOCOL_VERSION,
    sessionId: input.sessionId,
    captureStartedAt: input.captureStartedAt,
    // Part of the provenance record: a capture without recorded consent is
    // not usable as study data, whatever else it contains.
    consent: {
      acknowledgedAt: input.consentAt,
      // /facial-droop is standalone, so it is always this page's own notice.
      source: 'facial-speech-capture-notice',
      noticeVersion: FACIAL_CONSENT_NOTICE_VERSION,
    },
    // Kept in the manifest schema; /facial-droop collects no demographics.
    subject: null,
    media: {
      container: input.video.type || 'video/webm',
      video: trackSettings(input.stream?.getVideoTracks()[0]),
      audio: trackSettings(input.stream?.getAudioTracks()[0]),
      // The raw camera stream is recorded, so left and right in the video are
      // the camera's. The on-screen preview is mirrored with CSS only.
      mirrored: false,
      previewMirrored: true,
    },
    segmentation: {
      source: 'single-continuous-video',
      // Windows are milliseconds from the MediaRecorder onstart event, which
      // is the first encoded moment. The processor still reconciles this
      // against the container's own per-stream start times before slicing.
      taskWindowClock: 'MediaRecorder onstart / performance.now()',
      recorderStartLatencyMs: input.recorderStartLatencyMs,
      // Spoken guides play between tasks, never inside a window.
      videoIncludesUntimedGuidance: true,
    },
    tasks: input.tasks,
    expectedTaskOrder: FACIAL_SPEECH_TASKS.map((task) => ({
      id: task.id,
      domain: task.domain,
      durationSec: task.durationSec,
      expectedSyllables: task.expectedSyllables ?? null,
    })),
    // Only what the processor actually computes.
    metricsRequested: FACIAL_SPEECH_METRICS.filter((metric) => metric.status === 'implemented').map((metric) => metric.id),
    // What the offline processor actually enforces; keep in step with the backend gates.
    qualityPolicy: {
      requireFrontalFace: true,
      requireStableHeadPose: true,
      requireAudioSnrGate: true,
      failClosed: true,
      interpretation: 'screening-and-clinical-review, not standalone diagnosis',
    },
  };
}

export function downloadBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(href);
}
