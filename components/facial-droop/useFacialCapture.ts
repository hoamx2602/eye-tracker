'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { archiveFacialSpeechCapture, facialSpeechDeferAnalysisEnabled, type ArchivedCapture } from '@/lib/facialSpeechArchive';
import { facialSpeechHandlingEnabled, getFacialSpeechJob, startFacialSpeechProcessing, type FacialSpeechJob } from '@/lib/facialSpeechBackend';
import { buildCaptureManifest, downloadBlob, type CompletedTask } from '@/lib/facialSpeechManifest';
import { FACIAL_SPEECH_TASKS } from '@/lib/facialSpeechProtocol';

export type CaptureState = 'idle' | 'recording' | 'processing' | 'saving' | 'complete';
export type TaskPhase = 'instruction' | 'countdown' | 'active';

const COUNTDOWN_SECONDS = 3;

function chooseMimeType() {
  const choices = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return choices.find((value) => MediaRecorder.isTypeSupported(value)) ?? '';
}

/**
 * The recording itself: one continuous video, with a timed window per task,
 * then offline analysis, deferred archiving, or a local download.
 */
export function useFacialCapture(stream: MediaStream | null, consentAt: string | null) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sessionStartRef = useRef(0);
  const taskStartRef = useRef(0);
  const captureStartedAtRef = useRef<string | null>(null);
  const latencyRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const tasksRef = useRef<CompletedTask[]>([]);
  const manifestRef = useRef<Record<string, unknown> | null>(null);
  const cancelledRef = useRef(false);

  const [state, setState] = useState<CaptureState>('idle');
  const [phase, setPhase] = useState<TaskPhase>('instruction');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [taskIndex, setTaskIndex] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [video, setVideo] = useState<Blob | null>(null);
  const [job, setJob] = useState<FacialSpeechJob | null>(null);
  const [archived, setArchived] = useState<ArchivedCapture | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const task = FACIAL_SPEECH_TASKS[taskIndex];
  const active = state === 'recording' && phase === 'active';

  // Elapsed time drives when the Finish controls appear.
  useEffect(() => {
    if (!active) return setElapsedMs(0);
    const tick = () => setElapsedMs(performance.now() - taskStartRef.current);
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [active, taskIndex]);

  useEffect(() => () => {
    if (countdownRef.current !== null) window.clearInterval(countdownRef.current);
    cancelledRef.current = true;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const manifestFor = useCallback((blob: Blob) => {
    manifestRef.current ??= buildCaptureManifest({
      sessionId: `facial-speech-${Date.now()}`, video: blob, stream, captureStartedAt: captureStartedAtRef.current,
      consentAt, recorderStartLatencyMs: latencyRef.current, tasks: tasksRef.current,
    });
    return manifestRef.current;
  }, [consentAt, stream]);

  const analyse = useCallback(async (blob: Blob, manifest: Record<string, unknown>) => {
    setState('processing');
    setMessage('Uploading the capture to the analysis backend…');
    try {
      let current = await startFacialSpeechProcessing(blob, manifest);
      setJob(current);
      while (!cancelledRef.current && current.status !== 'complete' && current.status !== 'failed') {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 800));
        current = await getFacialSpeechJob(current.id);
        setJob(current);
        setMessage(current.message);
      }
      if (cancelledRef.current) return;
      if (current.status === 'failed') throw new Error(current.error || current.message);
      setMessage('Analysis complete.');
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : 'Unknown analysis error.';
      // No job exists when the upload never connected; synthesise one so the failure shows and can be retried.
      setJob((previous) => ({ ...(previous ?? { id: 'local', progress: 0 }), status: 'failed', phase: 'failed', message: detail, error: detail }));
      setMessage(`Analysis could not complete: ${detail}`);
    }
    setState('complete');
  }, []);

  const archive = useCallback(async (blob: Blob, manifest: Record<string, unknown>) => {
    setState('saving');
    setArchiveError(null);
    setMessage('Saving your recording…');
    try {
      setArchived(await archiveFacialSpeechCapture(blob, manifest, setMessage));
      setMessage('Your recording has been saved.');
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : 'Unknown error while saving.';
      setArchiveError(detail);
      setMessage(`The recording could not be saved: ${detail}`);
    }
    setState('complete');
  }, []);

  const deliver = useCallback((blob: Blob) => {
    const manifest = manifestFor(blob);
    if (facialSpeechDeferAnalysisEnabled()) return void archive(blob, manifest);
    if (facialSpeechHandlingEnabled()) return void analyse(blob, manifest);
    setState('complete');
    setMessage('Capture complete. Analysis is switched off here; download the video and metadata for later analysis.');
  }, [analyse, archive, manifestFor]);

  const begin = useCallback(() => {
    // Recording a face and a voice without recorded consent is never allowed.
    if (!consentAt || !stream || state !== 'idle') return;
    const mimeType = chooseMimeType();
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 2_500_000 });
    chunksRef.current = [];
    tasksRef.current = [];
    manifestRef.current = null;
    cancelledRef.current = false;
    recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
      setVideo(blob);
      deliver(blob);
    };
    // Task windows are timed from onstart (the first encoded moment), not from start().
    const requestedAt = performance.now();
    sessionStartRef.current = requestedAt;
    captureStartedAtRef.current = new Date().toISOString();
    latencyRef.current = null;
    recorder.onstart = () => {
      sessionStartRef.current = performance.now();
      latencyRef.current = Math.round(sessionStartRef.current - requestedAt);
      captureStartedAtRef.current = new Date().toISOString();
    };
    recorderRef.current = recorder;
    recorder.start(1000);
    setTaskIndex(0);
    setPhase('instruction');
    setCompletedCount(0);
    setState('recording');
  }, [consentAt, deliver, state, stream]);

  const startTask = useCallback(() => {
    if (state !== 'recording' || phase !== 'instruction') return;
    setPhase('countdown');
    setCountdown(COUNTDOWN_SECONDS);
    let remaining = COUNTDOWN_SECONDS;
    countdownRef.current = window.setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining > 0) return;
      if (countdownRef.current !== null) window.clearInterval(countdownRef.current);
      countdownRef.current = null;
      taskStartRef.current = performance.now();
      setPhase('active');
    }, 1000);
  }, [phase, state]);

  const finishTask = useCallback(() => {
    if (!active) return;
    const now = performance.now();
    const ms = now - taskStartRef.current;
    // Below the processor's minimum a window cannot be measured, so it is never accepted.
    if (ms < task.minimumSec * 1000) return;
    tasksRef.current = [...tasksRef.current, {
      id: task.id,
      startedAtMs: Math.round(taskStartRef.current - sessionStartRef.current),
      endedAtMs: Math.round(now - sessionStartRef.current),
      recordedDurationMs: Math.round(ms),
      expectedDurationSec: task.durationSec,
      endedEarly: ms < task.durationSec * 1000,
    }];
    setCompletedCount(tasksRef.current.length);
    if (taskIndex === FACIAL_SPEECH_TASKS.length - 1) {
      setMessage('Finalising the video…');
      setState('saving');
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      return;
    }
    setTaskIndex((index) => index + 1);
    setPhase('instruction');
  }, [active, task, taskIndex]);

  /** Stops without delivering anything (the participant chose to quit). */
  const abort = useCallback(() => {
    cancelledRef.current = true;
    if (countdownRef.current !== null) window.clearInterval(countdownRef.current);
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') {
      recorder.onstop = null;
      recorder.stop();
    }
    setState('idle');
  }, []);

  const canRetry = state === 'complete' && !!video && (archiveError !== null || (job?.status === 'failed' && facialSpeechHandlingEnabled()));
  const retry = useCallback(() => {
    if (!video) return;
    cancelledRef.current = false;
    if (facialSpeechDeferAnalysisEnabled()) return void archive(video, manifestFor(video));
    setJob(null);
    void analyse(video, manifestFor(video));
  }, [analyse, archive, manifestFor, video]);

  const download = useCallback(() => {
    if (!video) return;
    const manifest = manifestFor(video);
    downloadBlob(video, `${manifest.sessionId}.webm`);
    downloadBlob(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), `${manifest.sessionId}.meta.json`);
  }, [manifestFor, video]);

  return {
    state, phase, countdown, elapsedMs, task, taskIndex, completedCount, job, archived, archiveError, message,
    canRetry, begin, startTask, finishTask, abort, retry, download,
  };
}
