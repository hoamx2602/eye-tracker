'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FACIAL_SPEECH_METRICS,
  FACIAL_SPEECH_PROTOCOL_VERSION,
  FACIAL_SPEECH_TASKS,
  type MetricDefinition,
} from '@/lib/facialSpeechProtocol';

type CaptureState = 'ready' | 'recording' | 'complete' | 'error';
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
  const countdownTimerRef = useRef<number | null>(null);

  const [captureState, setCaptureState] = useState<CaptureState>('ready');
  const [taskPhase, setTaskPhase] = useState<TaskPhase>('instruction');
  const [countdown, setCountdown] = useState(3);
  const [taskIndex, setTaskIndex] = useState(0);
  const [completedTasks, setCompletedTasks] = useState<CompletedTask[]>([]);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [message, setMessage] = useState('Allow camera and microphone access, then begin the assessment.');

  const currentTask = FACIAL_SPEECH_TASKS[taskIndex];
  const isTaskActive = captureState === 'recording' && taskPhase === 'active';

  useEffect(() => {
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'auto';
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      if (countdownTimerRef.current !== null) window.clearInterval(countdownTimerRef.current);
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
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
      setVideoBlob(new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' }));
      setCaptureState('complete');
      setMessage('Capture complete. Download the paired video and metadata for offline processing.');
    };
    recorderRef.current = recorder;
    sessionStartRef.current = performance.now();
    captureStartedAtRef.current = new Date().toISOString();
    setTaskIndex(0);
    setTaskPhase('instruction');
    setCompletedTasks([]);
    setVideoBlob(null);
    recorder.start(1000);
    setCaptureState('recording');
    setMessage('The session is recording. Read the task guide, then start the timed task when ready.');
  }, [prepareCapture]);

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
    setCompletedTasks((previous) => [...previous, completed]);

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
    const sessionId = `facial-speech-${Date.now()}`;
    const stream = streamRef.current;
    const manifest = {
      protocol: 'facial-speech-screening',
      protocolVersion: FACIAL_SPEECH_PROTOCOL_VERSION,
      sessionId,
      captureStartedAt: captureStartedAtRef.current,
      media: {
        container: videoBlob.type || 'video/webm',
        video: getTrackSettings(stream?.getVideoTracks()[0]),
        audio: getTrackSettings(stream?.getAudioTracks()[0]),
      },
      // The source is deliberately a single continuous recording. The backend
      // uses these exact windows to decode only each task's valid frames/audio.
      segmentation: {
        source: 'single-continuous-video',
        taskWindowClock: 'MediaRecorder start / performance.now()',
        videoIncludesUntimedGuidance: true,
      },
      tasks: completedTasks,
      expectedTaskOrder: FACIAL_SPEECH_TASKS.map((task) => ({ id: task.id, domain: task.domain, durationSec: task.durationSec })),
      metricsRequested: FACIAL_SPEECH_METRICS.map((metric) => metric.id),
      qualityPolicy: {
        requireFrontalFace: true,
        requireStableHeadPose: true,
        requireAudioSnrGate: true,
        interpretation: 'screening-and-clinical-review, not standalone diagnosis',
      },
    };
    download(videoBlob, `${sessionId}.webm`);
    download(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), `${sessionId}.meta.json`);
  }, [completedTasks, videoBlob]);

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
                {captureState === 'recording' ? '● SESSION RECORDING' : captureState === 'complete' ? 'CAPTURE COMPLETE' : 'CAMERA PREVIEW'}
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

          <TaskGuide
            captureState={captureState}
            taskPhase={taskPhase}
            currentTask={currentTask}
            taskIndex={taskIndex}
            completedCount={completedTasks.length}
            onStart={startCurrentTask}
            onComplete={completeCurrentTask}
          />
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
