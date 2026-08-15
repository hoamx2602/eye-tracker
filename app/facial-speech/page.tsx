'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FACIAL_SPEECH_METRICS,
  FACIAL_SPEECH_PROTOCOL_VERSION,
  FACIAL_SPEECH_TASKS,
  type MetricDefinition,
} from '@/lib/facialSpeechProtocol';
import {
  facialSpeechHandlingEnabled,
  getFacialSpeechJob,
  startFacialSpeechProcessing,
  type FacialSpeechJob,
} from '@/lib/facialSpeechBackend';
import { AnalysisReport } from '@/components/facial-speech/AnalysisReport';
import { readFlowConsent, readFlowDemographics } from '@/lib/assessmentFlow';
import {
  archiveFacialSpeechCapture,
  facialSpeechDeferAnalysisEnabled,
  type ArchivedCapture,
} from '@/lib/facialSpeechArchive';
import EyeSpinner from '@/components/ui/EyeSpinner';

/** Bump when the wording of the consent notice changes materially, so a stored
 * capture records which notice the subject actually agreed to. */
const CONSENT_NOTICE_VERSION = '1.0.0';

type CaptureState = 'ready' | 'recording' | 'processing' | 'saving' | 'complete' | 'error';
type TaskPhase = 'instruction' | 'countdown' | 'active';

interface CompletedTask {
  id: string;
  startedAtMs: number;
  endedAtMs: number;
  recordedDurationMs: number;
  expectedDurationSec: number;
  endedEarly: boolean;
}

function chooseMimeType() {
  const choices = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return choices.find((value) => MediaRecorder.isTypeSupported(value)) ?? '';
}

function download(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(href);
}

function getTrackSettings(track: MediaStreamTrack | undefined) {
  if (!track) return null;
  return { label: track.label, settings: track.getSettings?.() ?? {} };
}

export default function FacialSpeechPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sessionStartRef = useRef(0);
  const taskStartRef = useRef(0);
  const captureStartedAtRef = useRef<string | null>(null);
  const recorderStartLatencyRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const completedTasksRef = useRef<CompletedTask[]>([]);
  const captureManifestRef = useRef<Record<string, unknown> | null>(null);
  const processingCancelledRef = useRef(false);

  const [captureState, setCaptureState] = useState<CaptureState>('ready');
  const [taskPhase, setTaskPhase] = useState<TaskPhase>('instruction');
  const [countdown, setCountdown] = useState(3);
  const [taskElapsedMs, setTaskElapsedMs] = useState(0);
  const [taskIndex, setTaskIndex] = useState(0);
  const [completedTasks, setCompletedTasks] = useState<CompletedTask[]>([]);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [processingJob, setProcessingJob] = useState<FacialSpeechJob | null>(null);
  const [archivedCapture, setArchivedCapture] = useState<ArchivedCapture | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [consentAt, setConsentAt] = useState<string | null>(null);
  const consentAtRef = useRef<string | null>(null);
  consentAtRef.current = consentAt;
  // Consent carried in from the shared consent screen, when the subject reached
  // this route through the assessment flow. Kept distinct from `consentAt` so
  // the manifest can say which notice was actually agreed to.
  const [inheritedConsentAt, setInheritedConsentAt] = useState<string | null>(null);
  const inheritedConsentAtRef = useRef<string | null>(null);
  inheritedConsentAtRef.current = inheritedConsentAt;
  const needsOwnConsent = inheritedConsentAt === null;
  const [message, setMessage] = useState('Read the consent notice below, then allow camera and microphone access.');

  const currentTask = FACIAL_SPEECH_TASKS[taskIndex];
  const isTaskActive = captureState === 'recording' && taskPhase === 'active';

  // Elapsed time drives when the Finish controls appear, so a subject cannot
  // end a window so short the offline processor is certain to reject it - which
  // previously only surfaced after upload and analysis, wasting the capture.
  useEffect(() => {
    if (!isTaskActive) {
      setTaskElapsedMs(0);
      return;
    }
    const tick = () => setTaskElapsedMs(performance.now() - taskStartRef.current);
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [isTaskActive, taskIndex]);

  // Read after mount, not during render: sessionStorage is unavailable to the
  // server pass and reading it inline would hydrate two different trees.
  useEffect(() => {
    const acknowledgedAt = readFlowConsent();
    if (!acknowledgedAt) return;
    setInheritedConsentAt(acknowledgedAt);
    setConsentAt(acknowledgedAt);
    setMessage('Consent recorded on the previous screen. Allow camera and microphone access, then begin.');
  }, []);

  useEffect(() => {
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'auto';
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      if (countdownTimerRef.current !== null) window.clearInterval(countdownTimerRef.current);
      processingCancelledRef.current = true;
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const buildManifest = useCallback((sessionId: string, video: Blob) => {
    const stream = streamRef.current;
    return {
      protocol: 'facial-speech-screening',
      protocolVersion: FACIAL_SPEECH_PROTOCOL_VERSION,
      sessionId,
      captureStartedAt: captureStartedAtRef.current,
      // Part of the provenance record: a capture without recorded consent is
      // not usable as study data, whatever else it contains.
      consent: {
        acknowledgedAt: consentAtRef.current,
        // Which document was agreed to. On the flow route the subject read the
        // shared participant-consent screen and never saw this page's notice,
        // so claiming its version here would be a false provenance record.
        source: inheritedConsentAtRef.current ? 'assessment-flow-consent-screen' : 'facial-speech-capture-notice',
        noticeVersion: inheritedConsentAtRef.current ? null : CONSENT_NOTICE_VERSION,
      },
      // Present when the subject reached this route through the home-screen
      // flow, which collects demographics before the capture. Null for a direct
      // visit to /facial-speech, which stays usable on its own.
      subject: readFlowDemographics(),
      media: {
        container: video.type || 'video/webm',
        video: getTrackSettings(stream?.getVideoTracks()[0]),
        audio: getTrackSettings(stream?.getAudioTracks()[0]),
      },
      segmentation: {
        source: 'single-continuous-video',
        // Windows are milliseconds from the MediaRecorder onstart event, which
        // is the first encoded moment. The processor still reconciles this
        // against the container's own per-stream start times before slicing.
        taskWindowClock: 'MediaRecorder onstart / performance.now()',
        recorderStartLatencyMs: recorderStartLatencyRef.current,
        videoIncludesUntimedGuidance: true,
      },
      tasks: completedTasksRef.current,
      expectedTaskOrder: FACIAL_SPEECH_TASKS.map((task) => ({
        id: task.id,
        domain: task.domain,
        durationSec: task.durationSec,
        expectedSyllables: task.expectedSyllables ?? null,
      })),
      // Only what the processor actually computes. Listing planned metrics here
      // would make the manifest claim measurements the report will not contain.
      metricsRequested: FACIAL_SPEECH_METRICS.filter((metric) => metric.status === 'implemented').map((metric) => metric.id),
      // What the offline processor actually enforces. Keep this in step with
      // the backend gates: a manifest that claims a gate the processor does not
      // run is a false provenance record.
      qualityPolicy: {
        requireFrontalFace: true,
        requireStableHeadPose: true,
        requireAudioSnrGate: true,
        failClosed: true,
        interpretation: 'screening-and-clinical-review, not standalone diagnosis',
      },
    };
  }, []);

  const processCapture = useCallback(async (video: Blob, manifest: Record<string, unknown>) => {
    setCaptureState('processing');
    setMessage('Uploading the capture to the offline analysis backend…');
    try {
      let job = await startFacialSpeechProcessing(video, manifest);
      setProcessingJob(job);
      while (!processingCancelledRef.current && job.status !== 'complete' && job.status !== 'failed') {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 800));
        job = await getFacialSpeechJob(job.id);
        setProcessingJob(job);
        setMessage(job.message);
      }
      if (processingCancelledRef.current) return;
      if (job.status === 'failed') throw new Error(job.error || job.message);
      setCaptureState('complete');
      setMessage('Offline analysis complete. Review the quality gates and measurements below.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown offline-processing error.';
      // When the upload itself never connected there is no job yet. Synthesise
      // one so the failure is shown in the status card - and so the retry
      // control has a failed job to key off - instead of only in the caption.
      setProcessingJob((current) => ({
        ...(current ?? { id: 'local', progress: 0 }),
        status: 'failed',
        phase: 'failed',
        message: detail,
        error: detail,
      }));
      setCaptureState('complete');
      setMessage(`Offline analysis could not complete: ${detail}`);
    }
  }, []);

  /** Deferred mode: store the capture now, measure it later. */
  const archiveCapture = useCallback(async (video: Blob, manifest: Record<string, unknown>) => {
    setCaptureState('saving');
    setArchiveError(null);
    setMessage('Saving your capture…');
    try {
      const saved = await archiveFacialSpeechCapture(video, manifest, setMessage);
      setArchivedCapture(saved);
      setCaptureState('complete');
      setMessage('Your capture has been saved.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error while saving the capture.';
      setArchiveError(detail);
      setCaptureState('complete');
      setMessage(`The capture could not be saved: ${detail}`);
    }
  }, []);

  const prepareCapture = useCallback(async () => {
    if (streamRef.current) return streamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        // The browser or device may override these requests. Actual settings are
        // kept in metadata and the offline service applies quality gates.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCaptureState('ready');
      setMessage('Devices are ready. Centre your face, use even lighting, and choose a quiet room.');
      return stream;
    } catch (error) {
      console.error('[facial-speech] media permission failed', error);
      setCaptureState('error');
      setMessage('Camera or microphone access failed. Check browser permissions and try again.');
      return null;
    }
  }, []);

  const beginProtocol = useCallback(async () => {
    // Guarded here as well as on the button: recording a face and a voice
    // without recorded consent is not something to leave to a disabled prop.
    if (!consentAtRef.current) {
      setMessage('Acknowledge the consent notice before recording.');
      return;
    }
    const stream = await prepareCapture();
    if (!stream) return;

    const mimeType = chooseMimeType();
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 2_500_000,
    });
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const video = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
      const manifest = buildManifest(`facial-speech-${Date.now()}`, video);
      setVideoBlob(video);
      captureManifestRef.current = manifest;
      if (facialSpeechDeferAnalysisEnabled()) {
        void archiveCapture(video, manifest);
      } else if (facialSpeechHandlingEnabled()) {
        void processCapture(video, manifest);
      } else {
        setCaptureState('complete');
        setMessage('Capture complete. Offline processing is disabled; download the paired files for later analysis.');
      }
    };
    recorderRef.current = recorder;
    const startRequestedAt = performance.now();
    // t0 must be the moment the encoder actually started, not the moment we
    // asked it to. MediaRecorder.start() returns before encoding begins, and
    // the gap - camera warm-up, encoder init - shifted every task window by an
    // unknown amount, silently misaligning the offline analysis with the video.
    // The requested time is only a fallback for browsers that never fire onstart.
    sessionStartRef.current = startRequestedAt;
    captureStartedAtRef.current = new Date().toISOString();
    recorderStartLatencyRef.current = null;
    recorder.onstart = () => {
      sessionStartRef.current = performance.now();
      recorderStartLatencyRef.current = Math.round(sessionStartRef.current - startRequestedAt);
      captureStartedAtRef.current = new Date().toISOString();
    };
    setTaskIndex(0);
    setTaskPhase('instruction');
    setCompletedTasks([]);
    completedTasksRef.current = [];
    captureManifestRef.current = null;
    processingCancelledRef.current = false;
    setProcessingJob(null);
    setArchivedCapture(null);
    setArchiveError(null);
    setVideoBlob(null);
    recorder.start(1000);
    setCaptureState('recording');
    setMessage('The session is recording. Read the task guide, then start the timed task when ready.');
  }, [archiveCapture, buildManifest, prepareCapture, processCapture]);

  const startCurrentTask = useCallback(() => {
    if (captureState !== 'recording' || taskPhase !== 'instruction') return;
    setTaskPhase('countdown');
    setCountdown(3);
    let remaining = 3;
    countdownTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        if (countdownTimerRef.current !== null) window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
        taskStartRef.current = performance.now();
        setTaskPhase('active');
      }
    }, 1000);
  }, [captureState, taskPhase]);

  const completeCurrentTask = useCallback(() => {
    if (!isTaskActive) return;
    const now = performance.now();
    const elapsedMs = now - taskStartRef.current;
    // Guarded here as well as by hiding the control: a window below the
    // processor's own minimum cannot produce a measurement, so accepting one
    // would only defer the failure to after the upload.
    if (elapsedMs < currentTask.minimumSec * 1000) return;
    const completed: CompletedTask = {
      id: currentTask.id,
      startedAtMs: Math.round(taskStartRef.current - sessionStartRef.current),
      endedAtMs: Math.round(now - sessionStartRef.current),
      recordedDurationMs: Math.round(elapsedMs),
      expectedDurationSec: currentTask.durationSec,
      // Recorded so a short window is visible in the provenance rather than
      // being inferred from the timestamps.
      endedEarly: elapsedMs < currentTask.durationSec * 1000,
    };
    const updatedTasks = [...completedTasksRef.current, completed];
    completedTasksRef.current = updatedTasks;
    setCompletedTasks(updatedTasks);

    if (taskIndex === FACIAL_SPEECH_TASKS.length - 1) {
      recorderRef.current?.state === 'recording' && recorderRef.current.stop();
      setMessage('Finalising the video file…');
      return;
    }
    setTaskIndex((previous) => previous + 1);
    setTaskPhase('instruction');
    setMessage('Read the next task guide before you start its timed capture.');
  }, [currentTask, isTaskActive, taskIndex]);

  // Either half of the pipeline can fail on a capture that is otherwise fine,
  // and re-recording six poses to recover from that would be an absurd cost.
  const canRetry =
    captureState === 'complete' &&
    !!videoBlob &&
    (archiveError !== null || (processingJob?.status === 'failed' && facialSpeechHandlingEnabled()));

  const retryLastStep = useCallback(() => {
    if (!videoBlob) return;
    const manifest = captureManifestRef.current ?? buildManifest(`facial-speech-${Date.now()}`, videoBlob);
    captureManifestRef.current = manifest;
    if (facialSpeechDeferAnalysisEnabled()) {
      void archiveCapture(videoBlob, manifest);
      return;
    }
    processingCancelledRef.current = false;
    setProcessingJob(null);
    void processCapture(videoBlob, manifest);
  }, [archiveCapture, buildManifest, processCapture, videoBlob]);

  const exportArtifacts = useCallback(() => {
    if (!videoBlob) return;
    const manifest = captureManifestRef.current ?? buildManifest(`facial-speech-${Date.now()}`, videoBlob);
    const sessionId = String(manifest.sessionId);
    download(videoBlob, `${sessionId}.webm`);
    download(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), `${sessionId}.meta.json`);
  }, [buildManifest, videoBlob]);

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 border-b border-gray-800 pb-6">
          <h1 className="text-3xl font-semibold tracking-tight">Facial drooping &amp; speech assessment</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">
            A standardised video-and-audio capture for facial movement asymmetry and motor-speech screening. Automated findings require clinical review.
          </p>
        </header>

        {/* The camera is the whole stage. Guidance and controls sit on top of
            it rather than beside it, so the subject's gaze stays within a few
            degrees of the lens instead of tracking to a side panel and back -
            head and eye movement away from the camera is exactly what biases
            the landmark geometry these tasks are measured on. */}
        <section className="mx-auto max-w-4xl">
          <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl shadow-black/20">
            <div className="relative aspect-video bg-black">
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              {/* The one recording indicator on screen, so it has to be the one
                  that reads as live: red and pulsing while the camera is
                  actually capturing, neutral in every other state. */}
              <div
                className={`absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
                  captureState === 'recording' ? 'bg-red-600/90 text-white' : 'bg-black/70 text-white'
                }`}
              >
                {captureState === 'recording' ? (
                  <>
                    <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                    SESSION RECORDING
                  </>
                ) : captureState === 'processing' ? (
                  '● OFFLINE ANALYSIS'
                ) : captureState === 'saving' ? (
                  '● SAVING CAPTURE'
                ) : captureState === 'complete' ? (
                  'CAPTURE COMPLETE'
                ) : (
                  'CAMERA PREVIEW'
                )}
              </div>
              {captureState === 'recording' ? (
                <div className="absolute right-4 top-4 z-10 rounded-full bg-black/70 px-3 py-1 text-xs font-medium tabular-nums text-white">
                  Task {taskIndex + 1} / {FACIAL_SPEECH_TASKS.length}
                </div>
              ) : null}

              {captureState === 'recording' && taskPhase === 'instruction' ? (
                <GuideOverlay task={currentTask} taskIndex={taskIndex} onStart={startCurrentTask} />
              ) : null}

              {captureState === 'recording' && taskPhase === 'countdown' ? (
                <div className="absolute inset-0 z-20 grid place-items-center bg-black/60 text-center">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-[0.18em] text-blue-300">Look at the camera lens</p>
                    <p className="mt-2 text-8xl font-semibold tabular-nums">{countdown}</p>
                    <p className="mt-2 text-sm text-gray-400">{currentTask.title}</p>
                  </div>
                </div>
              ) : null}

              {isTaskActive ? (
                <ActiveTaskOverlay
                  task={currentTask}
                  isLast={taskIndex === FACIAL_SPEECH_TASKS.length - 1}
                  elapsedMs={taskElapsedMs}
                  onComplete={completeCurrentTask}
                />
              ) : null}

              {/* The upload can take a while on a long capture. Hold the stage
                  with the app's own loading indicator so it reads as work in
                  progress, not as a page that stopped responding. */}
              {captureState === 'saving' ? (
                <div className="absolute inset-0 z-20 grid place-items-center bg-gray-950/85 px-6 text-center backdrop-blur-sm">
                  {/* EyeSpinner renders its own label — the stage text belongs
                      there, not in a second line beside it. */}
                  <div className="flex flex-col items-center gap-4">
                    <EyeSpinner size="xl" label={message} />
                    <p className="max-w-sm text-xs text-gray-400">Keep this page open until the capture is stored.</p>
                  </div>
                </div>
              ) : null}

              {captureState === 'ready' || captureState === 'error' ? (
                <div className="absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-center gap-3 bg-gradient-to-t from-black/85 to-transparent px-4 pb-5 pt-12">
                  <button onClick={() => void prepareCapture()} className="rounded-lg border border-gray-500 bg-black/40 px-4 py-2 text-sm font-medium text-gray-100 backdrop-blur-sm transition hover:border-blue-400 hover:text-blue-300">
                    Check camera &amp; microphone
                  </button>
                  <button
                    onClick={() => void beginProtocol()}
                    disabled={!consentAt || captureState === 'error'}
                    className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition enabled:hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
                  >
                    {consentAt ? 'Begin assessment' : 'Consent required to begin'}
                  </button>
                </div>
              ) : null}
            </div>

            <TaskProgressStrip taskIndex={taskIndex} completedCount={completedTasks.length} captureState={captureState} />

            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <p className="text-sm text-gray-300">{message}</p>
              {captureState === 'complete' ? (
                <div className="flex shrink-0 flex-wrap gap-3">
                  {canRetry ? (
                    <button onClick={retryLastStep} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500">
                      {archiveError ? 'Retry saving' : 'Retry analysis'}
                    </button>
                  ) : null}
                  <button onClick={exportArtifacts} className="rounded-lg border border-gray-600 px-4 py-2 text-sm font-medium text-gray-100 transition hover:border-blue-400 hover:text-blue-300">
                    Download video + metadata
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {archivedCapture ? <SavedNotice capture={archivedCapture} /> : null}

        {archiveError ? (
          <section className="mt-6 rounded-2xl border border-red-900/80 bg-red-950/30 p-5">
            <h2 className="text-lg font-semibold text-red-100">Capture not saved</h2>
            <p className="mt-2 text-sm leading-6 text-red-200">{archiveError}</p>
            <p className="mt-2 text-sm leading-6 text-red-200/80">
              The recording is still held on this page. Use <strong>Retry saving</strong>, or download the video and metadata so nothing is lost.
            </p>
          </section>
        ) : null}

        {captureState === 'processing' || processingJob ? (
          <section className="mt-6">
            <ProcessingStatus job={processingJob} />
            {processingJob?.report ? (
              <div className="mt-5">
                <AnalysisReport report={processingJob.report} />
              </div>
            ) : null}
          </section>
        ) : null}

        {/* Only for a direct visit to this route. Reaching it through the
            assessment flow means consent was already given and recorded on the
            shared consent screen; asking again would be noise, not diligence. */}
        {needsOwnConsent && (captureState === 'ready' || captureState === 'error') ? (
          <ConsentPanel consentAt={consentAt} onChange={setConsentAt} />
        ) : null}

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <MetricPanel title="Facial metrics to be reported" metrics={FACIAL_SPEECH_METRICS.filter((metric) => metric.domain === 'face')} />
          <MetricPanel title="Speech metrics to be reported" metrics={FACIAL_SPEECH_METRICS.filter((metric) => metric.domain === 'speech')} />
        </section>
      </div>
    </main>
  );
}

/** Deferred mode has no report to show, so the confirmation is the outcome:
 * say plainly that the capture is stored and what happens to it next. */
function SavedNotice({ capture }: { capture: ArchivedCapture }) {
  return (
    <section className="mt-6 rounded-2xl border border-emerald-800/70 bg-emerald-950/30 p-5">
      <div className="flex items-start gap-3">
        <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400">
          <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.6 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z" />
        </svg>
        <div>
          <h2 className="text-lg font-semibold text-emerald-100">Capture saved</h2>
          <p className="mt-1 text-sm leading-6 text-emerald-200/90">
            Your recording and its task timings are stored in the system. The measurement analysis is run later, so there is no report on this screen. You can close this page.
          </p>
          <p className="mt-3 font-mono text-xs text-emerald-300/80">Reference: {capture.sessionId}</p>
        </div>
      </div>
    </section>
  );
}

function ConsentPanel({ consentAt, onChange }: { consentAt: string | null; onChange: (value: string | null) => void }) {
  return (
    <section className="mt-6 rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <h2 className="text-lg font-semibold">Before you start</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-6 text-gray-400">
        <li>This records your face and your voice. Both identify you personally, and in the EU they are special-category biometric data.</li>
        <li>The recording is sent to the analysis backend configured for this deployment. In local development that is your own machine; confirm where it points before using real subject data.</li>
        <li>The video is deleted as soon as analysis finishes. The derived measurements are discarded after the backend retention window, and you can discard them sooner.</li>
        <li>This is a measurement tool for clinician review. It does not diagnose anything, and it is not a NIHSS score.</li>
        <li>Sudden facial droop or new speech difficulty is an emergency. Seek urgent medical help now rather than completing this assessment.</li>
      </ul>
      <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-gray-200">
        <input
          type="checkbox"
          checked={consentAt !== null}
          onChange={(event) => onChange(event.target.checked ? new Date().toISOString() : null)}
          className="mt-1 h-4 w-4 shrink-0 accent-blue-500"
        />
        <span>I understand the above and consent to this recording being made and analysed.</span>
      </label>
    </section>
  );
}

function domainLabel(domain: (typeof FACIAL_SPEECH_TASKS)[number]['domain']) {
  return domain === 'face' ? 'Facial movement' : domain === 'quality' ? 'Recording quality' : 'Motor speech';
}

/** The between-tasks guide, laid over the camera so reading it does not move
 * the subject's head or eyes away from the lens. */
function GuideOverlay({
  task,
  taskIndex,
  onStart,
}: {
  task: (typeof FACIAL_SPEECH_TASKS)[number];
  taskIndex: number;
  onStart: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center overflow-y-auto bg-gray-950/85 px-6 py-6 backdrop-blur-sm">
      <div className="w-full max-w-xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-400">
          Step {taskIndex + 1} · {domainLabel(task.domain)}
        </p>
        <h2 className="mt-2 text-2xl font-semibold">{task.title}</h2>
        <p className="mt-4 text-lg leading-7 text-gray-100">{task.instruction}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-400">
          <span>Runs for {task.durationSec}s</span>
          <span className="text-gray-600">·</span>
          <span>{task.clinicalAnchor}</span>
        </div>
        <p className="mt-3 text-xs leading-5 text-gray-500">{task.captureNotes}</p>
        <button
          onClick={onStart}
          className="mt-6 rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
        >
          Start this task
        </button>
        <p className="mt-3 text-xs leading-5 text-gray-500">
          A three-second countdown runs first, then the task records for {task.durationSec}s and the finish button appears. Read this now;
          it disappears while recording.
        </p>
      </div>
    </div>
  );
}

/**
 * Controls during a live task. Deliberately sparse and anchored to the top of
 * the frame, next to the webcam, so the subject's gaze stays on the lens.
 *
 * The Finish control is withheld until the task has run its intended duration:
 * a subject who stops after a second produces a window the offline processor is
 * certain to reject, and previously found that out only after upload and
 * analysis. A quieter early exit unlocks at the processor's own minimum,
 * because some of the intended population cannot sustain a full window and
 * trapping them is worse than a capture flagged short.
 */
function ActiveTaskOverlay({
  task,
  isLast,
  elapsedMs,
  onComplete,
}: {
  task: (typeof FACIAL_SPEECH_TASKS)[number];
  isLast: boolean;
  elapsedMs: number;
  onComplete: () => void;
}) {
  const cue =
    task.domain === 'face'
      ? 'Look at the camera lens'
      : task.domain === 'quality'
        ? 'Stay silent and still'
        : 'Keep your face centred';
  const elapsedS = elapsedMs / 1000;
  const remaining = Math.max(0, Math.ceil(task.durationSec - elapsedS));
  const complete = elapsedS >= task.durationSec;
  const canEndEarly = elapsedS >= task.minimumSec;
  const progress = Math.min(1, elapsedS / task.durationSec);

  return (
    <>
      {task.nearLensPrompt ? (
        <div className="absolute left-1/2 top-2 z-20 max-w-[90%] -translate-x-1/2 rounded-lg bg-white px-4 py-2 text-center text-sm font-semibold leading-6 text-gray-950 shadow-lg">
          {task.nearLensPrompt}
        </div>
      ) : null}
      <div className={`absolute inset-x-0 z-20 flex flex-col items-center gap-2 px-4 ${task.nearLensPrompt ? 'top-16' : 'top-14'}`}>
        {/* Which pose is being held, not that recording is happening - the badge
            in the corner already says that, and saying it twice on the same
            screen just competes with the task name. */}
        <div className="rounded-full bg-black/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white backdrop-blur-sm">
          {task.title}
        </div>
        {/* A bar rather than large digits: during a facial task the subject is
            meant to be looking at the lens, and a counting number is the most
            attention-grabbing thing that could be put on screen. */}
        <div className="mt-1 w-56 max-w-[70%]">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
            <div
              className={`h-full rounded-full transition-[width] duration-100 ease-linear ${complete ? 'bg-emerald-400' : 'bg-blue-400'}`}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          {!complete ? (
            <p className="mt-1 text-center text-xs tabular-nums text-gray-300">
              keep going · {remaining}s
            </p>
          ) : null}
        </div>

        {complete ? (
          <button
            onClick={onComplete}
            className="mt-1 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-500"
          >
            {isLast ? 'Finish assessment' : 'Finish task'}
          </button>
        ) : canEndEarly ? (
          <button
            onClick={onComplete}
            className="mt-0.5 rounded px-3 py-1 text-[11px] text-gray-400 underline underline-offset-2 transition hover:text-gray-200"
          >
            {isLast ? 'Cannot continue — end here' : 'Cannot continue — end this task'}
          </button>
        ) : null}
      </div>

      {/* Held at the foot of the frame, clear of the task prompt and timer that
          share the top. It is a standing reminder for the whole task, so it
          does not need to sit where the subject is already reading. */}
      <p className="absolute inset-x-0 bottom-4 z-20 mx-auto w-fit max-w-[80%] rounded-full bg-black/60 px-3 py-1 text-center text-xs text-gray-200 backdrop-blur-sm">
        {cue}
      </p>
    </>
  );
}

function TaskProgressStrip({
  taskIndex,
  completedCount,
  captureState,
}: {
  taskIndex: number;
  completedCount: number;
  captureState: CaptureState;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-gray-800 bg-gray-900/60 px-5 py-3">
      <div className="flex flex-1 gap-1">
        {FACIAL_SPEECH_TASKS.map((task, index) => (
          <div
            key={task.id}
            title={task.title}
            className={`h-1.5 flex-1 rounded-full ${
              index < completedCount
                ? 'bg-emerald-500'
                : index === taskIndex && captureState === 'recording'
                  ? 'bg-blue-500'
                  : 'bg-gray-700'
            }`}
          />
        ))}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-gray-500">
        {completedCount} / {FACIAL_SPEECH_TASKS.length} captured
      </span>
    </div>
  );
}

/** Job progress only. Everything the report contains is rendered by
 * AnalysisReport, which needs the full width the old side panel did not have. */
function ProcessingStatus({ job }: { job: FacialSpeechJob | null }) {
  const running = job?.status === 'processing' || job?.status === 'queued';
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-400">Offline analysis</p>
          <h2 className="mt-1 text-xl font-semibold">
            {job?.status === 'complete' ? 'Measurement report' : job?.status === 'failed' ? 'Analysis unavailable' : 'Processing capture'}
          </h2>
        </div>
        {running ? <span className="font-mono text-sm text-gray-400">{job.progress}%</span> : null}
      </div>
      <p className="mt-2 text-sm leading-6 text-gray-400">{job?.message ?? 'Preparing the analysis job…'}</p>

      {running ? (
        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-gray-800">
            <div className="h-full rounded-full bg-blue-500 transition-all duration-300" style={{ width: `${job.progress}%` }} />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {job.phase.replace(/_/g, ' ')} · only the timestamped task windows are decoded, not the guide or countdown frames.
          </p>
        </div>
      ) : null}

      {job?.status === 'failed' ? (
        <div className="mt-4 rounded-lg border border-red-900/80 bg-red-950/30 p-3 text-sm text-red-200">
          {job.error || 'The backend did not return a report.'}
        </div>
      ) : null}
    </div>
  );
}

function MetricPanel({ title, metrics }: { title: string; metrics: MetricDefinition[] }) {
  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4 space-y-3">
        {metrics.map((metric) => (
          <div key={metric.id} className="rounded-lg bg-gray-800/80 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-gray-200">{metric.label}</p>
              <span className="shrink-0 text-xs text-blue-300">{metric.unit}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-gray-500">{metric.purpose}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
