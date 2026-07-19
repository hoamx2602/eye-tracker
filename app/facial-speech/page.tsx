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
  isSideMeasure,
  startFacialSpeechProcessing,
  type FaceMetricValue,
  type FacialSpeechJob,
} from '@/lib/facialSpeechBackend';

type CaptureState = 'ready' | 'recording' | 'processing' | 'complete' | 'error';
type TaskPhase = 'instruction' | 'countdown' | 'active';

interface CompletedTask {
  id: string;
  startedAtMs: number;
  endedAtMs: number;
  recordedDurationMs: number;
  expectedDurationSec: number;
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
  const [taskIndex, setTaskIndex] = useState(0);
  const [completedTasks, setCompletedTasks] = useState<CompletedTask[]>([]);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [processingJob, setProcessingJob] = useState<FacialSpeechJob | null>(null);
  const [message, setMessage] = useState('Allow camera and microphone access, then begin the assessment.');

  const currentTask = FACIAL_SPEECH_TASKS[taskIndex];
  const isTaskActive = captureState === 'recording' && taskPhase === 'active';

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
      expectedTaskOrder: FACIAL_SPEECH_TASKS.map((task) => ({ id: task.id, domain: task.domain, durationSec: task.durationSec })),
      metricsRequested: FACIAL_SPEECH_METRICS.map((metric) => metric.id),
      qualityPolicy: {
        requireFrontalFace: true,
        requireStableHeadPose: true,
        requireAudioSnrGate: true,
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
      setProcessingJob((current) => current ? { ...current, status: 'failed', phase: 'failed', message: detail, error: detail } : null);
      setCaptureState('complete');
      setMessage(`Offline analysis could not complete: ${detail}`);
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
      if (facialSpeechHandlingEnabled()) {
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
    setVideoBlob(null);
    recorder.start(1000);
    setCaptureState('recording');
    setMessage('The session is recording. Read the task guide, then start the timed task when ready.');
  }, [buildManifest, prepareCapture, processCapture]);

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
    const completed: CompletedTask = {
      id: currentTask.id,
      startedAtMs: Math.round(taskStartRef.current - sessionStartRef.current),
      endedAtMs: Math.round(now - sessionStartRef.current),
      recordedDurationMs: Math.round(now - taskStartRef.current),
      expectedDurationSec: currentTask.durationSec,
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
        <header className="mb-8 flex flex-col gap-4 border-b border-gray-800 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">Offline neurological assessment</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Facial drooping &amp; speech assessment</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">
              A standardised video-and-audio capture for facial movement asymmetry and motor-speech screening. Automated findings require clinical review.
            </p>
          </div>
          <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            Sudden facial droop or new speech difficulty is an emergency. Seek urgent medical help; do not wait for this assessment.
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl shadow-black/20">
            <div className="relative aspect-video bg-black">
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              <div className="absolute left-4 top-4 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
                {captureState === 'recording' ? '● SESSION RECORDING' : captureState === 'processing' ? '● OFFLINE ANALYSIS' : captureState === 'complete' ? 'CAPTURE COMPLETE' : 'CAMERA PREVIEW'}
              </div>
              {captureState === 'recording' && taskPhase === 'countdown' ? (
                <div className="absolute inset-0 grid place-items-center bg-black/55 text-center">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-[0.18em] text-blue-300">Position your face and look at the camera lens</p>
                    <p className="mt-2 text-7xl font-semibold tabular-nums">{countdown}</p>
                  </div>
                </div>
              ) : null}
              {isTaskActive ? (
                <div className="absolute inset-x-0 top-12 flex justify-center px-4 text-center">
                  <div className="max-w-lg rounded-xl border border-blue-400/30 bg-gray-950/80 px-4 py-3 backdrop-blur-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">Task recording in progress</p>
                    <p className="mt-1 text-sm font-medium text-white">
                      {currentTask.domain === 'face' ? 'Keep your eyes on the camera lens. Do not read the screen.' : 'Keep your face centred and complete the speech task.'}
                    </p>
                  </div>
                </div>
              ) : null}
              {isTaskActive && currentTask.nearLensPrompt ? (
                <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded-lg bg-white px-3 py-1.5 text-center text-xs font-semibold text-gray-950 shadow-lg">
                  {currentTask.nearLensPrompt}
                </div>
              ) : null}
            </div>
            <div className="p-5">
              <p className="text-sm text-gray-300">{message}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {captureState === 'ready' || captureState === 'error' ? (
                  <button onClick={() => void prepareCapture()} className="rounded-lg border border-gray-600 px-4 py-2 text-sm font-medium text-gray-100 transition hover:border-blue-400 hover:text-blue-300">
                    Check camera &amp; microphone
                  </button>
                ) : null}
                {captureState === 'ready' ? (
                  <button onClick={() => void beginProtocol()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500">
                    Begin assessment
                  </button>
                ) : null}
                {captureState === 'complete' ? (
                  <button onClick={exportArtifacts} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500">
                    Download video + metadata
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {captureState === 'processing' || processingJob ? (
            <AnalysisPanel job={processingJob} />
          ) : (
            <TaskGuide
              captureState={captureState}
              taskPhase={taskPhase}
              currentTask={currentTask}
              taskIndex={taskIndex}
              completedCount={completedTasks.length}
              onStart={startCurrentTask}
              onComplete={completeCurrentTask}
            />
          )}
        </section>

        <section className="mt-6 rounded-2xl border border-gray-800 bg-gray-900 p-5">
          <h2 className="text-lg font-semibold">How the offline processor identifies each task</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-gray-400">
            The browser creates one continuous video to avoid camera re-acquisition, codec boundaries, and lost frames. It writes an exact start/end timestamp for every timed task into the paired metadata file. The backend decodes only those task windows; guidance and countdown frames are excluded from all metrics. It may create derived clips internally for replay, but the original evidence remains one loss-minimised source file.
          </p>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <MetricPanel title="Facial metrics to be reported" metrics={FACIAL_SPEECH_METRICS.filter((metric) => metric.domain === 'face')} />
          <MetricPanel title="Speech metrics to be reported" metrics={FACIAL_SPEECH_METRICS.filter((metric) => metric.domain === 'speech')} />
        </section>
      </div>
    </main>
  );
}

function TaskGuide({
  captureState,
  taskPhase,
  currentTask,
  taskIndex,
  completedCount,
  onStart,
  onComplete,
}: {
  captureState: CaptureState;
  taskPhase: TaskPhase;
  currentTask: (typeof FACIAL_SPEECH_TASKS)[number];
  taskIndex: number;
  completedCount: number;
  onStart: () => void;
  onComplete: () => void;
}) {
  const active = captureState === 'recording' && taskPhase === 'active';
  const instructional = captureState === 'recording' && taskPhase === 'instruction';

  return (
    <aside className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-400">Task {Math.min(taskIndex + 1, FACIAL_SPEECH_TASKS.length)} / {FACIAL_SPEECH_TASKS.length}</p>
      {active ? (
        <div className="mt-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-400">Recording this task</p>
          <h2 className="mt-3 text-xl font-semibold">{currentTask.title}</h2>
          <p className="mt-5 text-sm leading-6 text-gray-400">
            {currentTask.domain === 'face'
              ? 'The instruction panel is intentionally hidden during facial capture. Look at the camera lens, not this panel.'
              : 'Complete the speech task. The fixed reading prompt, when required, is placed immediately below the camera preview.'}
          </p>
          <button onClick={onComplete} className="mt-8 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500">
            {taskIndex === FACIAL_SPEECH_TASKS.length - 1 ? 'Finish assessment' : 'Finish task'}
          </button>
        </div>
      ) : (
        <>
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-gray-500">{currentTask.domain === 'face' ? 'Facial movement' : 'Motor speech'}</p>
          <h2 className="mt-1 text-xl font-semibold">{currentTask.title}</h2>
          <p className="mt-4 min-h-24 text-base leading-7 text-gray-200">{currentTask.instruction}</p>
          <div className="mt-4 rounded-lg bg-gray-800 p-3 text-sm text-gray-400">
            <p><span className="text-gray-500">Suggested duration:</span> {currentTask.durationSec}s</p>
            <p className="mt-1"><span className="text-gray-500">Clinical anchor:</span> {currentTask.clinicalAnchor}</p>
            <p className="mt-1"><span className="text-gray-500">Capture note:</span> {currentTask.captureNotes}</p>
          </div>
          <p className="mt-4 text-xs leading-5 text-gray-500">
            Read and memorise the instructions first. A three-second camera-facing countdown begins only after you press Start task recording.
          </p>
          <button disabled={!instructional} onClick={onStart} className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition enabled:hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400">
            {captureState === 'recording' && taskPhase === 'countdown' ? 'Starting…' : 'Start task recording'}
          </button>
        </>
      )}
      <p className="mt-5 border-t border-gray-800 pt-4 text-xs text-gray-500">Completed task windows: {completedCount} / {FACIAL_SPEECH_TASKS.length}</p>
    </aside>
  );
}

function AnalysisPanel({ job }: { job: FacialSpeechJob | null }) {
  const report = job?.report;
  const metricEntries = report ? Object.entries(report.face.metrics) : [];
  const sustained = report?.speech.tasks.speech_sustained_a;
  const ddk = report?.speech.tasks.speech_ddk_patka;

  return (
    <aside className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-400">Offline analysis</p>
      <h2 className="mt-2 text-xl font-semibold">{job?.status === 'complete' ? 'Measurement report' : job?.status === 'failed' ? 'Analysis unavailable' : 'Processing capture'}</h2>
      <p className="mt-3 text-sm leading-6 text-gray-400">{job?.message ?? 'Preparing the analysis job…'}</p>

      {job?.status === 'processing' || job?.status === 'queued' ? (
        <div className="mt-6">
          <div className="flex justify-between text-xs text-gray-400"><span>{job.phase.replace(/_/g, ' ')}</span><span>{job.progress}%</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-800">
            <div className="h-full rounded-full bg-blue-500 transition-all duration-300" style={{ width: `${job.progress}%` }} />
          </div>
          <p className="mt-4 text-xs leading-5 text-gray-500">The backend is processing only the timestamped task windows, not the guide or countdown frames.</p>
        </div>
      ) : null}

      {job?.status === 'failed' ? (
        <div className="mt-6 rounded-lg border border-red-900/80 bg-red-950/30 p-3 text-sm text-red-200">
          {job.error || 'The backend did not return a report.'}
        </div>
      ) : null}

      {report ? (
        <div className="mt-5 space-y-4">
          <div className={`rounded-lg border p-3 text-sm ${report.quality.passed ? 'border-emerald-900 bg-emerald-950/30 text-emerald-100' : 'border-amber-800 bg-amber-950/30 text-amber-100'}`}>
            <p className="font-semibold">{report.quality.passed ? 'Capture quality passed' : 'Insufficient capture quality — no score reported'}</p>
            {report.quality.issues.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5">
                {report.quality.issues.map((issue) => (
                  <li key={`${issue.code}:${issue.scope}`}>
                    <span className="font-mono text-[11px] opacity-70">{issue.scope}</span> — {issue.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs">Face visibility, illumination, blur, task-window and audio gates all passed.</p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Facial movement measurements</p>
            {report.face.available ? (
              <div className="mt-2 space-y-2">
                {metricEntries.map(([name, value]) => (
                  <FaceMetricRow key={name} name={name} value={value} />
                ))}
              </div>
            ) : (
              <p className="mt-2 rounded bg-gray-800 px-3 py-2 text-xs leading-5 text-amber-200">
                Withheld: the video did not meet the measurement gates above. Re-capture rather than interpreting a partial result.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <ReportMetric label="Sustained /a/ F0" measure={trialMeasure(sustained, 'f0_hz_median')} unit="Hz" />
            <ReportMetric label="Sustained /a/ HNR" measure={trialMeasure(sustained, 'hnr_db_median')} unit="dB" />
            <ReportMetric label="Sustained /a/ jitter" measure={trialMeasure(sustained, 'jitter_local')} unit="" />
            <ReportMetric label="Max phonation time" measure={{ median: numberFrom(sustained, 'max_phonation_time_s'), nTrials: null }} unit="s" />
            <ReportMetric label="DDK peak rate (per run)" measure={trialMeasure(ddk, 'energy_peak_rate_hz')} unit="Hz" />
            <ReportMetric label="DDK timing CV" measure={trialMeasure(ddk, 'peak_interval_cv')} unit="" />
          </div>
          <p className="rounded-lg bg-gray-800 p-3 text-xs leading-5 text-gray-400">{report.interpretation}</p>
        </div>
      ) : null}
    </aside>
  );
}

function FaceMetricRow({ name, value }: { name: string; value: FaceMetricValue }) {
  const label = name.replace(/_/g, ' ');
  if (isSideMeasure(value)) {
    const ratio = value.ratio_weaker_over_stronger;
    return (
      <div className="rounded bg-gray-800 px-3 py-2 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-gray-400">{label}</span>
          <span className="font-mono text-gray-100">{ratio === null ? 'unavailable' : ratio.toFixed(4)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-gray-500">
          <span className="font-mono">L {value.left === null ? '—' : value.left.toFixed(4)} · R {value.right === null ? '—' : value.right.toFixed(4)}</span>
          {value.weaker_side ? <span className="text-amber-300">reduced on the {value.weaker_side}</span> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded bg-gray-800 px-3 py-2 text-xs">
      <span className="text-gray-400">{label}</span>
      <span className="font-mono text-gray-100">
        {typeof value === 'number' ? value.toFixed(4) : typeof value === 'string' ? value : 'unavailable'}
      </span>
    </div>
  );
}

function numberFrom(values: Record<string, unknown> | undefined, key: string) {
  const value = values?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Reads a per-trial aggregate, which the backend reports as a median plus the
 * spread across repetitions rather than a single pooled number. */
function trialMeasure(values: Record<string, unknown> | undefined, key: string) {
  const aggregate = values?.[key];
  if (typeof aggregate !== 'object' || aggregate === null) return { median: null, nTrials: null };
  const record = aggregate as Record<string, unknown>;
  return {
    median: typeof record.median === 'number' && Number.isFinite(record.median) ? record.median : null,
    nTrials: typeof record.n_trials === 'number' ? record.n_trials : null,
  };
}

function ReportMetric({
  label,
  measure,
  unit,
}: {
  label: string;
  measure: { median: number | null; nTrials: number | null };
  unit: string;
}) {
  return (
    <div className="rounded-lg bg-gray-800 p-3">
      <p className="text-gray-500">{label}</p>
      <p className="mt-1 font-mono text-sm text-gray-100">
        {measure.median === null ? 'unavailable' : `${measure.median.toFixed(2)}${unit ? ` ${unit}` : ''}`}
      </p>
      {measure.nTrials !== null ? <p className="mt-0.5 text-[11px] text-gray-500">median of {measure.nTrials} trial(s)</p> : null}
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
