'use client';

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PATHS, parsePathname } from '@/lib/paths';
import { neuroDebugLog, neuroPersistWarn } from '@/lib/neuroDebugLog';
import { neuroLiveGazeRef } from '@/lib/neuroLiveGaze';
import { gazeFrameStream, GazeFrameQuality } from '@/lib/gazeFrameStream';
import { NEURO_VERIFY_META_KEY, NEURO_VERIFY_SNAPSHOT_KEY } from '@/lib/neuroVerifyMode';
import {
  NEURO_PREVIEW_RUN_ID,
  getNeuroResultsPreviewMock,
  neuroDevPreviewEnabled,
  DEFAULT_NEURO_TEST_ORDER,
} from '@/lib/neuroDevPreviewMock';
import { 
  AppState, 
  CalibrationPhase,
  CalibrationPoint, 
  EyeFeatures, 
  TrainingSample,
  HeadSnapshot,
  EyeLandmarkIndices,
  AppConfig,
  CalibrationMethod,
  RegressionMethod,
  EXERCISE_KINDS,
  DEFAULT_CONFIG,
  TrackingMode,
  getPatternDisplayName,
  type EyeMovementKind,
  OutlierMethod,
  type SampleQuality
} from './types';
import { eyeTrackingService, HeadValidationResult } from './services/eyeTrackingService';
import { HybridRegressor, GazeSmoother } from './services/mathUtils';
import {
  sessionsApi,
  uploadApi,
  neurologicalRunsApi,
  getNeurologicalConfig,
  type CreateSessionPayload,
  type RawEyeFeaturesPayload,
  type UploadOwner,
} from './services/api';
import CalibrationLayer from './components/CalibrationLayer';
import EyeMovementLayer from './components/EyeMovementLayer';
import GazeCursor from './components/GazeCursor';
import HeatmapLayer, { HeatmapRef } from './components/HeatmapLayer';
import HeadPositionGuide from './components/HeadPositionGuide';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import ConsentModal from './components/ConsentModal';
import DemographicsForm, { type DemographicsData } from './components/DemographicsForm';
import RandomDotsOverlay from './components/RandomDotsOverlay';
import ArticleReadingOverlay from './components/ArticleReadingOverlay';
import StopSaveModal from './components/StopSaveModal';
import CapturedImageModal from './components/CapturedImageModal';
import TrackingToolbar from './components/TrackingToolbar';
import HeadPositioningScreen from './components/HeadPositioningScreen';

import type { SymptomScores } from '@/lib/symptomAssessment';
import { SYMPTOM_QUESTIONS } from '@/lib/symptomAssessment';
import SymptomAssessment from '@/components/SymptomAssessment';
import type { TestResultPayload } from '@/components/neurological';
import NeurologicalFlowSection from '@/components/neurological/NeurologicalFlowSection';
import { useNeuroFlowHandlers } from '@/components/neurological/useNeuroFlowHandlers';
import AppMainOverlays from '@/components/AppMainOverlays';
import { DEFAULT_TEST_ORDER } from '@/lib/neurologicalConfig';
import { CapturedImage, GazeRecord, VALIDATION_POINTS, generateCalibrationPoints, effectiveCalibrationPointCount, QUICK_CALIBRATION_POINTS, roundedRect } from '@/lib/appHelpers';
import { CalibrationMetaRecorder, type SessionMeta } from '@/lib/calibrationMeta';
import { CONSENT_VERSION } from '@/lib/consentText';
import { ChunkedVideoUploader } from '@/lib/chunkedUpload';
import { NEURO_RECORD_VIDEO_ENABLED, RECORDER_TIMESLICE_MS, VIDEO_BITS_PER_SECOND } from '@/lib/recordingConfig';
import {
  DEFAULT_FIXATION_OPTIONS,
  FixationCollector,
  FixationNoiseModel,
  buildExerciseSamples,
  isBetterResult,
  residualOutliers,
  shuffled,
  timerFixationOptions,
  type ExerciseFrame,
  type FixationResult,
} from '@/lib/fixationSampling';
import { PartialBlinkGate, isPlausibleGaze } from '@/lib/gazePostprocess';
import { isOfflineMetaExportEnabled } from '@/lib/offlineExportMeta';
import { offlineBackendUrl, offlineHandlingEnabled, processOfflineGaze, type OfflineGazeProcessResponse } from '@/lib/offlineGazeBackend';
import { FaceLandmarkerResult, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { SelfAssessmentConfig } from '@/components/neurological/GuidePracticeTestFlow';

/** When true (NEXT_PUBLIC_CALIBRATION_TEST_MODE=1): after first calibration phase (grid) only, save session and show choice screen (Real-time vs Neurological). Choice is always required. */
const CALIBRATION_TEST_MODE =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_CALIBRATION_TEST_MODE === '1';

/**
 * Quick test mode (NEXT_PUBLIC_NEURO_QUICK_MODE=1/true/yes/on). Shrinks the
 * one-time calibration to the smallest run the offline pipeline still accepts —
 * a 6-dot grid (backend minimum) at FAST speed, glasses-16 bump bypassed — so
 * the calibration + validation video + meta.json can be produced in ~10s to
 * smoke-test the offline reprocess. The same flag (read server-side) also
 * collapses the 7 neuro tests. Off for real sessions. See lib/neurologicalConfig.
 */
const NEURO_QUICK_MODE =
  typeof process !== 'undefined' &&
  ['1', 'true', 'yes', 'on'].includes(
    (process.env.NEXT_PUBLIC_NEURO_QUICK_MODE ?? '').trim().toLowerCase(),
  );

/** Run up to `concurrency` promises at a time. */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const worker = async (): Promise<void> => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const headPosCanvasRef = useRef<HTMLCanvasElement>(null);
  const currentFaceLandmarksRef = useRef<NormalizedLandmark[] | null>(null);

  // --- STATE ---
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<AppState>('IDLE');
  const [loadingMsg, setLoadingMsg] = useState('');
  const [sessionSaveStatus, setSessionSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [sessionSaveError, setSessionSaveError] = useState<string | null>(null);
  const [lastSavedCounts, setLastSavedCounts] = useState<{ samples: number; images: number } | null>(null);
  /** Session id after calibration save; used for post-calibration choice and neurological run. */
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);
  /** Orchestrator (ticket 12): pre → tests → post → done. */
  const [neuroPhase, setNeuroPhase] = useState<'pre' | 'tests' | 'post' | 'done'>('pre');
  const neuroPhaseRef = useRef(neuroPhase);
  useEffect(() => { neuroPhaseRef.current = neuroPhase; }, [neuroPhase]);
  /**
   * The same "leave, hold a valid position for 2s, come back" loop
   * CALIBRATION already uses for invalid head position — same status change,
   * same HEAD_POSITIONING screen, same 500ms debounce. The test that was
   * running unmounts and, on return, remounts from scratch: whatever
   * trials/progress it had are gone, same as CALIBRATION losing an
   * in-progress dwell on a grid point. What it does not do is send the
   * participant further back than where they actually were —
   * neuroResumeTestId/neuroResumePhase name the test and the exact phase
   * (guide, practice, or test) to resume into, captured from
   * neuroCurrentPhaseRef at the moment the interruption fires. Someone
   * interrupted mid-practice comes back to practice, not to a test they had
   * not reached yet.
   */
  const neuroFlowResumeRef = useRef(false);
  const [neuroResumeTestId, setNeuroResumeTestId] = useState<string | null>(null);
  const [neuroResumePhase, setNeuroResumePhase] = useState<
    'guide' | 'practice' | 'realIntro' | 'test' | null
  >(null);
  /** Live phase of whichever test's GuidePracticeTestFlow is currently mounted — kept current via onPhaseChange. */
  const neuroCurrentPhaseRef = useRef<'guide' | 'practice' | 'realIntro' | 'test'>('guide');
  const [neuroRunId, setNeuroRunId] = useState<string | null>(null);
  const [neuroRunStatus, setNeuroRunStatus] = useState<'idle' | 'creating' | 'ready' | 'error'>('idle');
  const [neuroTestOrder, setNeuroTestOrder] = useState<string[]>([]);
  const [neuroConfigSnapshot, setNeuroConfigSnapshot] = useState<{
    testOrder: string[];
    testParameters: Record<string, Record<string, unknown>>;
    testEnabled: Record<string, boolean>;
  } | null>(null);
  const NEURO_CONFIG_LS_KEY = 'neuro_config_snapshot_v1';
  const NEURO_TEST_PROGRESS_LS_KEY = 'neuro_test_progress_v1';
  /** Survives full page reload so /neuro/done can re-fetch run results. */
  const NEURO_LAST_RUN_ID_SS_KEY = 'neuro_last_run_id';
  const [currentNeuroTestIndex, setCurrentNeuroTestIndex] = useState(0);
  const [preSymptomScores, setPreSymptomScores] = useState<SymptomScores | null>(null);
  /** Show pre-questionnaire overlay between setup and calibration. */
  const [showPreQBeforeCalib, setShowPreQBeforeCalib] = useState(false);
  const [postSymptomScores, setPostSymptomScores] = useState<SymptomScores | null>(null);
  const [pendingPostSymptomScores, setPendingPostSymptomScores] = useState<SymptomScores | null>(null);
  const [showPostSubmitConfirm, setShowPostSubmitConfirm] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(true);
  /** Which neurological test is running; null when between tests or in post/done. */
  const [currentNeuroTestId, setCurrentNeuroTestId] = useState<string | null>(null);
  const currentNeuroTestIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentNeuroTestIdRef.current = currentNeuroTestId;
  }, [currentNeuroTestId]);
  const [neuroTestResults, setNeuroTestResults] = useState<Record<string, TestResultPayload>>({});
  /** Refetch trigger for /neuro/done screen */
  const [neuroResultsFetchKey, setNeuroResultsFetchKey] = useState(0);
  const [neuroResultsLoading, setNeuroResultsLoading] = useState(false);
  const [neuroResultsLoadError, setNeuroResultsLoadError] = useState<string | null>(null);
  /** Head pose during NEURO_FLOW for tests that need it (e.g. Head Orientation). Throttled ~15 Hz. */
  const [neuroHeadPose, setNeuroHeadPose] = useState<{ pitch: number; yaw: number; roll: number } | null>(null);
  const lastNeuroHeadPoseTimeRef = useRef<number>(0);

  const demographicsRef = useRef<DemographicsData | null>(null);
  /** When and to which text version consent was given — set once, at the Agree click. */
  const consentRef = useRef<{ agreedAt: string; version: string } | null>(null);

  // Head Positioning State
  const [headValidation, setHeadValidation] = useState<HeadValidationResult | null>(null);
  const headValidationRef = useRef<HeadValidationResult | null>(null);
  useEffect(() => { headValidationRef.current = headValidation; }, [headValidation]);
  const [positionHoldTime, setPositionHoldTime] = useState<number | null>(null);
  const [stableFrameCount, setStableFrameCount] = useState(0);
  const headPosStartTimeRef = useRef<number | null>(null);
  const lastHeadDebugLogRef = useRef<number>(0);
  const calibrationResumeRef = useRef(false); // true when we returned to HEAD_POSITIONING from CALIBRATION (resume same step)
  const headInvalidSinceRef = useRef<number | null>(null); // debounce: head invalid start time
  /**
   * True while the active neuro test's post-test break/review screen is
   * showing — its trials are done and its result is already banked, so
   * there is nothing left being recorded. Set from GuidePracticeTestFlow's
   * onBreakActiveChange. A head-position interruption here would unmount
   * that break screen along with everything else and force a full redo of
   * a test that had already finished — worse than not checking at all.
   */
  const neuroTestBreakActiveRef = useRef(false);
  
  const hybridRegressorRef = useRef<HybridRegressor>(new HybridRegressor());
  const [calibPhase, setCalibPhase] = useState<CalibrationPhase>(CalibrationPhase.INITIAL_MAPPING);
  
  type AssessmentPendingType = { type: 'grid' } | { type: 'exercise'; kind: EyeMovementKind; index: number };
  const [assessmentPending, setAssessmentPendingState] = useState<AssessmentPendingType | null>(null);
  const assessmentPendingRef = useRef<AssessmentPendingType | null>(null);
  const setAssessmentPending = useCallback((val: AssessmentPendingType | null) => {
    assessmentPendingRef.current = val;
    setAssessmentPendingState(val);
  }, []);
  const [exerciseRetryCount, setExerciseRetryCount] = useState(0);

  // --- Incremental save during breaks ---
  // The face captures for a finished step are uploaded while the participant
  // rests, so the wait at the end is short and an abandoned session has
  // already banked everything up to the last completed step.
  const [stepSaveState, setStepSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [stepSaveError, setStepSaveError] = useState<string | null>(null);
  /** Sample index → uploaded image URL. Seeds the final save so nothing uploads twice. */
  const uploadedImageUrlsRef = useRef<Map<number, string>>(new Map());
  /** trainingSamples length when the current exercise began — lets Redo drop just that exercise. */
  const exerciseSampleStartRef = useRef(0);

  // --- Session row: created early, patched at every break ---
  // The DB row exists from the moment demographics are submitted — well
  // before calibration produces anything — so a participant who never
  // finishes still leaves a real, inspectable record instead of nothing.
  /** The session id once created. Null before the first successful create. */
  const sessionIdRef = useRef<string | null>(null);
  /** Dedupes concurrent create attempts; cleared after each attempt settles so a later one can retry. */
  const sessionCreatePromiseRef = useRef<Promise<string | null> | null>(null);
  /** Serializes PATCH calls so two in-flight requests can never race and have the older one win. */
  const sessionPatchChainRef = useRef<Promise<void>>(Promise.resolve());

  const statusRef = useRef<AppState>('IDLE');
  const configRef = useRef<AppConfig>(DEFAULT_CONFIG);

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const routerPush = useCallback(
    (url: string) => {
      console.log('[App] routerPush:', url);
      if (typeof window !== 'undefined') {
        if (url.startsWith('/results/')) {
          router.push(url);
        } else {
          window.history.pushState(null, '', url);
        }
      }
    },
    [router]
  );

  const currentScreen = useMemo(() => {
    return parsePathname(typeof pathname === 'string' ? pathname : '/').screen;
  }, [pathname]);

  const pathnameRef = useRef<string>(typeof pathname === 'string' ? pathname : '/');
  pathnameRef.current = typeof pathname === 'string' ? pathname : '/';
  /** Persistent reference to the camera stream to ensure it can be closed even if videoRef is nulled. */
  const streamRef = useRef<MediaStream | null>(null);
  /** When we push a path from internal transition we skip one pathname sync to avoid overwriting state. */
  const pathSyncSourceRef = useRef<'url' | 'internal'>('url');

  // `?exportMeta=1` is only present on the first URL. The assessment flow uses
  // route transitions like /consent -> /setup -> /calibration, which drop the
  // query string before `maybeExportOfflineMeta()` runs. Latch it for this tab so
  // offline export survives the whole run without affecting normal sessions.
  useEffect(() => {
    if (isOfflineMetaExportEnabled()) {
      console.log('[offline] exportMeta enabled for this browser tab');
    }
  }, []);

  // Warn before an accidental tab close/refresh once there is a session on
  // the server this participant is the only source of more data for.
  // sessionIdRef is set right after demographics and cleared by reset(), so
  // this naturally turns itself off before the flow starts and once the
  // participant restarts — no separate condition needed for either.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (sessionIdRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => {
    if (status !== 'CALIBRATION' && status !== 'TRACKING') setLightLevel(null);
  }, [status]);
  useEffect(() => {
    if (status !== 'HEAD_POSITIONING') setStableFrameCount(0);
  }, [status]);
  useEffect(() => {
    if (status !== 'NEURO_FLOW') setNeuroHeadPose(null);
  }, [status]);

  const [calibPoints, setCalibPoints] = useState<CalibrationPoint[]>([]);
  const [currentCalibIndex, setCurrentCalibIndex] = useState(0);
  // Dummy state to force re-run of calibration effect for retries. Defined here to be available for useEffect.
  const [retryCount, setRetryCount] = useState(0);

  const [trainingData, setTrainingData] = useState<TrainingSample[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0); // 0-1 for click hold progress

  // Exercise state
  const [currentExerciseIndex, setCurrentExerciseIndex] = useState(0);
  const exerciseTargetRef = useRef<{ x: number; y: number } | null>(null);
  const exerciseDataRef = useRef<{ t: number; screenX: number; screenY: number; features: number[]; head?: HeadSnapshot; rawEyeFeatures: EyeFeatures }[]>([]);
  /** Blink frames seen during the current exercise, for blink padding. */
  const exerciseBlinkTimesRef = useRef<number[]>([]);
  const exerciseBlobsRef = useRef<Blob[]>([]);
  const exerciseActiveRef = useRef(false);
  const exerciseKindRef = useRef<EyeMovementKind>('wiggling');

  // Test mode: record target vs predicted gaze during exercises for deviation charts
  const [runMode, setRunMode] = useState<'calibration' | 'test'>('calibration');
  const runModeRef = useRef<'calibration' | 'test'>('calibration');
  useEffect(() => { runModeRef.current = runMode; }, [runMode]);
  const testTrajectoryRef = useRef<{ patternName: string; points: { t: number; targetX: number; targetY: number; gazeX: number; gazeY: number }[] }[]>([]);
  const currentTestSegmentRef = useRef<{ t: number; targetX: number; targetY: number; gazeX: number; gazeY: number }[]>([]);
  const testSegmentStartTimeRef = useRef<number>(0);
  const lastTestRecordTimeRef = useRef<number>(0);

  const [accuracyScore, setAccuracyScore] = useState<number | null>(null);
  const [loocvErrors, setLoocvErrors] = useState<{ ridge: number; hybrid: number } | null>(null);
  /** Frozen LOOCV from the very first train — baseline for comparing flag improvements. */
  const [loocvBaseline, setLoocvBaseline] = useState<{ ridge: number; hybrid: number } | null>(null);
  
  const [gazePos, setGazePos] = useState({ x: 0, y: 0 });
  /** Regressor đã train — nếu false, predictGaze không có tọa độ thật, chỉ (0,0). */
  const [gazeModelReady, setGazeModelReady] = useState(false);
  const [rawFeatures, setRawFeatures] = useState<EyeFeatures | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [trackingMode, setTrackingMode] = useState<TrackingMode>('free_gaze');
  const [showStopSaveModal, setShowStopSaveModal] = useState(false);
  const [isBlinking, setIsBlinking] = useState(false);
  
  const [showCamera, setShowCamera] = useState(false);
  const showCameraRef = useRef(false);
  useEffect(() => { showCameraRef.current = showCamera; }, [showCamera]);
  /** True after startCamera() has run (so /tracking opened via flow has video; direct open does not). */
  const [hasCameraStream, setHasCameraStream] = useState(false);
  
  // Initialize with Defaults
  const smootherRef = useRef(new GazeSmoother(DEFAULT_CONFIG.minCutoff, DEFAULT_CONFIG.beta));
  /** Drops partial-blink frames from the live gaze stream (zero lag; see lib/gazePostprocess). */
  const partialBlinkGateRef = useRef(new PartialBlinkGate()); 
  const requestRef = useRef<number>(0);
  const heatmapRef = useRef<HeatmapRef>(null);
  
  const lastVideoTimeRef = useRef(-1);
  /**
   * Capture time of the newest camera frame, from requestVideoFrameCallback.
   * The rAF loop runs on display refresh, not on camera frames, so its own
   * `now` is up to a frame late and jitters; the neuro tests' latency needs
   * the time the frame was actually taken. Null where the API is missing.
   */
  const frameMetaRef = useRef<{ mediaTime: number; t: number } | null>(null);
  /** Capture time of the frame being processed in this pass of processVideo. */
  const frameTimeRef = useRef(0);
  const detectionFrameCounterRef = useRef(0);
  const detectionStrideRef = useRef(1);
  const detectionAvgMsRef = useRef(0);
  const isCollectingRef = useRef(false);
  /** Gaze-contingent collector for the dot on screen; null between dots. Fed by processVideo. */
  const pointCollectorRef = useRef<FixationCollector | null>(null);
  /** The participant's fixation noise, learnt from accepted dots; scales every stability radius. */
  const fixationNoiseRef = useRef(new FixationNoiseModel());
  /** Best attempt per dot (key `cal:<id>` / `val:<id>`) and where its sample sits in trainingSamplesRef. */
  const dotAttemptsRef = useRef(new Map<string, { result: FixationResult; sampleIndex: number }>());
  /** Presentations per dot key, successful or not — caps re-queuing. */
  const dotAttemptCountRef = useRef(new Map<string, number>());
  /** Grid dots queued by the residual review; their next stable result replaces the old one. */
  const recollectKeysRef = useRef(new Set<string>());
  const residualReviewDoneRef = useRef(false);
  /** Validation error (px) per validation dot id; a re-presented dot overwrites its entry. */
  const validationErrorByIdRef = useRef(new Map<number, number>());
  const trainingSamplesRef = useRef<TrainingSample[]>([]);
  const validationErrorsRef = useRef<number[]>([]); 
  const timerRef = useRef<(number | ReturnType<typeof setTimeout>)[]>([]);
  const trackingHistoryRef = useRef<GazeRecord[]>([]);
  const zoomLockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs for click hold logic
  const holdStartTimeRef = useRef<number>(0);
  const clickAnimationRef = useRef<number>(0);

  // Ref to hold the current validity for async access in loops
  const isHeadValidRef = useRef<boolean>(true);

  // --- RECORDING STATE ---
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingResolveRef = useRef<((b: Blob | null) => void) | null>(null);
  // Sends the video to S3 as it is recorded, so the end of the session is not
  // spent waiting for the whole file. Null when no recording is in progress.
  const videoUploaderRef = useRef<ChunkedVideoUploader | null>(null);
  // Records per-dot [t_start,t_end] windows on the video clock for offline reprocessing.
  const metaRecorderRef = useRef(new CalibrationMetaRecorder());
  const [isRecording, setIsRecording] = useState(false);

  // --- NEUROLOGICAL TEST RECORDING STATE ---
  // A second, independent recorder/uploader pair, reusing the same camera
  // stream and the same streaming-upload mechanism as calibration's video —
  // but scoped to the NeurologicalRun rather than the Session, and driven by
  // neuroPhase instead of an explicit start/stop call site. See the effect
  // near the other NEURO_FLOW camera-lifecycle effects below.
  const neuroMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const neuroRecordedChunksRef = useRef<Blob[]>([]);
  const neuroVideoUploaderRef = useRef<ChunkedVideoUploader | null>(null);
  // Which run the in-progress recording belongs to — captured at start time
  // so finishNeuroVideoRecording still knows where to PATCH even if
  // neuroRunId has already moved on by the time it resolves.
  const neuroRecordingRunIdRef = useRef<string | null>(null);
  const [lightLevel, setLightLevel] = useState<{ value: number; status: 'too_dark' | 'low' | 'ok' | 'good' } | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  
  // --- FACE CAPTURE STATE ---
  const [capturedImages, setCapturedImages] = useState<CapturedImage[]>([]);
  const [capturedImageModalIndex, setCapturedImageModalIndex] = useState<number | null>(null);
  const lastCaptureTimeRef = useRef<number>(0);
  const lastBrightnessCheckTimeRef = useRef<number>(0);
  const brightnessCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // --- LOAD CONFIG (from admin API; fallback to localStorage then DEFAULT) ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/app-config', { credentials: 'include' });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          const merged = { ...DEFAULT_CONFIG, ...data };
          setConfig(merged);
          configRef.current = merged;
          smootherRef.current.updateConfig(merged.smoothingMethod, merged);
          return;
        }
      } catch (_) {}
      const saved = localStorage.getItem('eye_tracker_config');
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as Partial<AppConfig>;
          const merged = { ...DEFAULT_CONFIG, ...parsed };
          if (!cancelled) {
            setConfig(merged);
            configRef.current = merged;
            smootherRef.current.updateConfig(merged.smoothingMethod, merged);
          }
        } catch (e) {
          console.error('Failed to parse stored config', e);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    // Initial check
    handleFsChange();
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  useEffect(() => {
    const init = async () => {
      // Only show loading on home so /choice, /tracking etc. don't get overwritten
      const initialPath = pathnameRef.current;
      if (parsePathname(initialPath).screen === 'home') {
        setStatus('LOADING_MODEL');
      }
      setLoadingMsg('Initializing Computer Vision Models...');
      try {
        await eyeTrackingService.initialize();
        setLoadingMsg('Models Ready.');

        const currentPath = pathnameRef.current;
        const parsed = parsePathname(currentPath);

        // Session Re-hydration: if sessionId is in URL, fetch it to enable tracking immediately
        const sid = searchParams?.get('sessionId');
        if (sid) {
          try {
            const session = await sessionsApi.get(sid);
            if (session && session.calibrationGazeSamples) {
              const samples: TrainingSample[] = (session.calibrationGazeSamples as any[]).map(s => ({
                screenX: s.screenX,
                screenY: s.screenY,
                features: s.features || [],
                timestamp: s.timestamp || Date.now(),
              }));
              if (samples.length > 0) {
                console.log(`[App] Re-hydrating session ${sid} with ${samples.length} samples`);
                trainingSamplesRef.current = samples;
                const inputs = samples.map(s => s.features);
                const outputs = samples.map(s => [s.screenX, s.screenY]);
                hybridRegressorRef.current.train(inputs, outputs);
                setCreatedSessionId(sid);
              }
            }
          } catch (e) {
            console.error('[App] Failed to re-hydrate session:', e);
          }
        }

        // Don't overwrite path-driven state: only set IDLE when we're on home
        // Sync state from URL on initial load
        if (parsed.screen === 'home' || parsed.screen === 'setup' || parsed.screen === 'consent' || parsed.screen === 'demographics') {
          setStatus('IDLE');
        } else {
          // Keep current path's screen so /tracking etc. don't flash back to home
          if (parsed.screen === 'tracking') {
            setStatus('TRACKING');
            statusRef.current = 'TRACKING';
            smootherRef.current.reset();
            if (heatmapRef.current) heatmapRef.current.reset();
            trackingHistoryRef.current = [];
          } else if (parsed.screen === 'calibration') {
            setStatus('HEAD_POSITIONING');
          } else if (parsed.screen === 'choice') {
            setStatus('IDLE');
          } else if (parsed.screen === 'neuro_pre' || parsed.screen === 'neuro_post' || parsed.screen === 'neuro_done' || parsed.screen === 'neuro_test') {
            setStatus('NEURO_FLOW');
            statusRef.current = 'NEURO_FLOW';
            if (parsed.screen === 'neuro_pre') {
              setNeuroPhase('pre');
              setCurrentNeuroTestId(null);
            } else if (parsed.screen === 'neuro_post') {
              setNeuroPhase('post');
              setCurrentNeuroTestId(null);
            } else if (parsed.screen === 'neuro_done') {
              setNeuroPhase('done');
              setCurrentNeuroTestId(null);
            } else {
              setNeuroPhase('tests');
              setCurrentNeuroTestId(parsed.testId);
              const order = neuroTestOrder.length > 0 ? neuroTestOrder : [...DEFAULT_TEST_ORDER];
              setCurrentNeuroTestIndex(Math.max(0, order.indexOf(parsed.testId)));
            }
          }
        }
      } catch (err) {
        console.error(err);
        setLoadingMsg('Failed to load models. Check console.');
        const parsed = parsePathname(pathnameRef.current);
        if (parsed.screen === 'home') setStatus('IDLE');
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (pathSyncSourceRef.current === 'internal' || status === 'LOADING_MODEL') {
      if (pathSyncSourceRef.current === 'internal') {
        pathSyncSourceRef.current = 'url';
      }
      return;
    }
    const parsed = parsePathname(typeof pathname === 'string' ? pathname : '/');
    switch (parsed.screen) {
      case 'home':
      case 'choice':
      case 'consent':
      case 'demographics':
      case 'setup':
        if (status !== 'IDLE') {
          setStatus('IDLE');
          statusRef.current = 'IDLE';
        }
        break;
      case 'calibration':
        if (status !== 'HEAD_POSITIONING' && status !== 'CALIBRATION') {
          handleStartProcess();
        }
        break;
      case 'tracking':
        if (status !== 'TRACKING') {
          if (process.env.NODE_ENV === 'development') console.log('[App] pathname sync → setting TRACKING');
          setStatus('TRACKING');
          statusRef.current = 'TRACKING';
          smootherRef.current.reset();
          if (heatmapRef.current) heatmapRef.current.reset();
          trackingHistoryRef.current = [];
        }
        // Auto-start camera & link session if coming from e.g. results page with a sid
        const sid = searchParams.get('sessionId');
        if (sid && sid !== createdSessionId) {
          setCreatedSessionId(sid);
        }
        if (!hasCameraStream) {
          startCamera().catch(() => {});
        }
        break;
      case 'neuro_pre':
        if (status !== 'NEURO_FLOW') setStatus('NEURO_FLOW');
        statusRef.current = 'NEURO_FLOW';
        setNeuroPhase('pre');
        setCurrentNeuroTestId(null);
        // Allow direct-open for testing: show pre form even without a run (patch will no-op if no runId)
        if (neuroRunStatus === 'idle') setNeuroRunStatus('ready');
        break;
      case 'neuro_test':
        if (status !== 'NEURO_FLOW') setStatus('NEURO_FLOW');
        statusRef.current = 'NEURO_FLOW';
        setNeuroPhase('tests');
        setCurrentNeuroTestId(parsed.testId);
        const order = neuroTestOrder.length > 0 ? neuroTestOrder : [...DEFAULT_TEST_ORDER];
        const idx = order.indexOf(parsed.testId);
        setCurrentNeuroTestIndex(idx >= 0 ? idx : 0);
        break;
      case 'neuro_post':
        if (status !== 'NEURO_FLOW') setStatus('NEURO_FLOW');
        statusRef.current = 'NEURO_FLOW';
        setNeuroPhase('post');
        setCurrentNeuroTestId(null);
        if (neuroRunStatus === 'idle') setNeuroRunStatus('ready');
        break;
      case 'neuro_done':
        if (status !== 'NEURO_FLOW') setStatus('NEURO_FLOW');
        statusRef.current = 'NEURO_FLOW';
        setNeuroPhase('done');
        setCurrentNeuroTestId(null);
        break;
    }
  }, [pathname, searchParams, hasCameraStream]);

  // Debug: log status & pathname when they change (helps when tracking screen is blank)
  useEffect(() => {
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
      console.log('[App] status=', status, 'pathname=', typeof pathname === 'string' ? pathname : pathname);
    }
  }, [status, pathname]);

  // Load cached neuro config snapshot for this browser session, then always
  // refresh it from the DB on mount — not just once already on a /neuro/*
  // route. selfAssessmentConfig (the "Quick check-in" prompt) is read off
  // this same snapshot for the CALIBRATION exercise breaks too (see
  // AppMainOverlays), which happen long before a participant ever reaches a
  // /neuro/* URL; gating the fetch on the route meant a normal participant —
  // who starts at "/", not a deep link — never had a real snapshot during
  // calibration at all, so exercise breaks silently ignored whatever the
  // admin had actually configured and fell back to the hardcoded default.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(NEURO_CONFIG_LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as any;
        if (parsed && typeof parsed === 'object' && parsed.testParameters && parsed.testEnabled) {
          setNeuroConfigSnapshot(parsed);
        }
      }
    } catch (_) {}

    (async () => {
      try {
        const latest = await getNeurologicalConfig();
        setNeuroConfigSnapshot({
          testOrder: latest.testOrder,
          testParameters: (latest.testParameters as Record<string, Record<string, unknown>>) ?? {},
          testEnabled: (latest.testEnabled as Record<string, boolean>) ?? {},
        });
        localStorage.setItem(NEURO_CONFIG_LS_KEY, JSON.stringify(latest));
      } catch (e) {
        console.error('[App] Failed to fetch fresh neuro config', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After nav to /tracking Next may remount App → hasCameraStream resets. If we have a session (came from calibration), re-start camera.
  const hasTriedRestartCameraRef = useRef(false);
  useEffect(() => {
    if (status !== 'TRACKING' || !createdSessionId || hasCameraStream) {
      if (status !== 'TRACKING') hasTriedRestartCameraRef.current = false;
      return;
    }
    if (hasTriedRestartCameraRef.current) return;
    hasTriedRestartCameraRef.current = true;
    startCamera();
  }, [status, createdSessionId, hasCameraStream]);

  // Neurological flow needs camera for Head Orientation (and other tests). Start camera when entering NEURO_FLOW if not already running.
  // Do NOT start on neuro_done — tests are finished, camera should stay off.
  const hasTriedStartCameraNeuroRef = useRef(false);
  useEffect(() => {
    // Start camera if we are in neuro flow (uncompleted) OR if we are in tracking (with session) OR if we are in normal setup flows
    const shouldStart = (status === 'NEURO_FLOW' && neuroPhase !== 'done') || 
                       (status === 'TRACKING' && createdSessionId) ||
                       (status === 'CALIBRATION') ||
                       (status === 'HEAD_POSITIONING');
    
    if (!shouldStart || hasCameraStream) {
      if (status !== 'NEURO_FLOW' && status !== 'TRACKING' && status !== 'CALIBRATION' && status !== 'HEAD_POSITIONING') {
        hasTriedStartCameraNeuroRef.current = false;
      }
      return;
    }
    if (hasTriedStartCameraNeuroRef.current) return;
    hasTriedStartCameraNeuroRef.current = true;
    startCamera();
  }, [status, hasCameraStream, neuroPhase, createdSessionId]);

  // Clean up camera stream on component unmount
  useEffect(() => {
    return () => {
      // Use the video element's srcObject directly to stop tracks on unmount
      if (videoRef.current?.srcObject) {
         console.log('[App] Unmounting -> stopping camera');
         const stream = videoRef.current.srcObject as MediaStream;
         stream.getTracks().forEach(t => t.stop());
         videoRef.current.srcObject = null;
      }
      if (zoomLockIntervalRef.current) {
        clearInterval(zoomLockIntervalRef.current);
      }
    };
  }, []);

  const startCamera = async () => {
    if (!videoRef.current) return;

    // Absolute safeguard: Do not start the camera on non-eye-tracking pages.
    const p = typeof window !== 'undefined' ? window.location.pathname : '/';
    const parsed = parsePathname(p);
    const noCameraScreens = ['home', 'choice', 'consent', 'demographics', 'setup', 'results'];
    if (noCameraScreens.includes(parsed.screen)) {
       if (process.env.NODE_ENV === 'development') {
         console.warn('[App] Aborting startCamera - on non-camera screen:', parsed.screen);
       }
       return;
    }

    if (zoomLockIntervalRef.current) {
      clearInterval(zoomLockIntervalRef.current);
      zoomLockIntervalRef.current = null;
    }
    try {
      const supports = typeof navigator !== 'undefined' && navigator.mediaDevices?.getSupportedConstraints?.();
      const wantsZoom = supports && (supports as { zoom?: boolean }).zoom === true;
      // Prefer 720p; request PTZ so we can lock zoom (reduces auto-zoom when user moves).
      const videoConstraints: MediaTrackConstraints & { zoom?: boolean } = {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        // Request a stable frame rate: erratic fps makes the OneEuro dt jittery,
        // which corrupts smoothing and reaction-time measurements in saccade tests.
        frameRate: { ideal: 30, min: 24 },
        ...(wantsZoom ? { zoom: true } : {}),
      };
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const caps = videoTrack.getCapabilities() as { zoom?: { min?: number; max?: number } };
        const minZoom = typeof caps?.zoom?.min === 'number' ? caps.zoom.min : null;
        if (minZoom !== null) {
          try {
            await videoTrack.applyConstraints({ advanced: [{ zoom: minZoom }] as unknown as MediaTrackConstraintSet[] });
          } catch (_) {}
          // Re-apply min zoom periodically — some drivers (e.g. face framing) keep overriding it.
          zoomLockIntervalRef.current = setInterval(() => {
            const v = videoRef.current?.srcObject as MediaStream | undefined;
            const track = v?.getVideoTracks?.()?.[0];
            if (!track) {
              if (zoomLockIntervalRef.current) {
                clearInterval(zoomLockIntervalRef.current);
                zoomLockIntervalRef.current = null;
              }
              return;
            }
            const c = track.getCapabilities() as { zoom?: { min?: number } };
            const min = typeof c?.zoom?.min === 'number' ? c.zoom.min : null;
            if (min === null) return;
            const cur = (track.getSettings() as { zoom?: number }).zoom;
            if (typeof cur === 'number' && cur !== min) {
              track.applyConstraints({ advanced: [{ zoom: min }] as unknown as MediaTrackConstraintSet[] }).catch(() => {});
            }
          }, 2000);
        }
      }
      videoRef.current.srcObject = stream;
      streamRef.current = stream;
      setHasCameraStream(true);
      await new Promise((resolve) => {
        if (videoRef.current) videoRef.current.onloadedmetadata = resolve;
      });
      videoRef.current.play();
      watchFrameCaptureTimes(videoRef.current);
      processVideo();
    } catch (err) {
      console.error('[Camera] getUserMedia failed:', err);
      // Exit fullscreen so the user can see the in-app error, then send
      // them back to the setup guide to re-grant camera access.
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      pathSyncSourceRef.current = 'internal';
      router.push('/setup');
    }
  };

  const stopCamera = useCallback(() => {
    // Cancel the animation-frame loop so processVideo stops calling itself.
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = 0;
    }
    // Stop the zoom-lock interval.
    if (zoomLockIntervalRef.current) {
      clearInterval(zoomLockIntervalRef.current);
      zoomLockIntervalRef.current = null;
    }
    // Stop all media tracks so the OS camera indicator turns off.
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setHasCameraStream(false);
    // Allow the camera to restart if the user redoes tests later.
    hasTriedStartCameraNeuroRef.current = false;
  }, []);

  // Stop camera when entering 'done' phase (after all tests and questionnaires)
  useEffect(() => {
    if (status === 'NEURO_FLOW' && neuroPhase === 'done' && hasCameraStream) {
      neuroDebugLog('Neuro phase done -> stopping camera');
      stopCamera();
    }
  }, [status, neuroPhase, hasCameraStream, stopCamera]);

  // Automated camera cleanup when navigating away from active tracking/neuro logic (e.g. going home)
  useEffect(() => {
    const isFlowActive = (status === 'NEURO_FLOW' && neuroPhase !== 'done') || 
                         (status === 'TRACKING' && createdSessionId) ||
                         (status === 'CALIBRATION') ||
                         (status === 'HEAD_POSITIONING');
                         
    if (!isFlowActive && hasCameraStream) {
      neuroDebugLog('[App] Navigation/State change -> stopping camera automatically');
      stopCamera();
    }
  }, [status, neuroPhase, hasCameraStream, createdSessionId, stopCamera]);

  // SAFETY: Force stop camera on screens that don't need it
  useEffect(() => {
    const parsed = parsePathname(typeof pathname === 'string' ? pathname : '/');
    const noCameraScreens = ['home', 'choice', 'consent', 'demographics', 'setup', 'results'];
    if (noCameraScreens.includes(parsed.screen)) {
      if (hasCameraStream) {
        if (process.env.NODE_ENV === 'development') console.log('[App] Safety Stop Camera for screen:', parsed.screen);
        stopCamera();
      }
    }
  }, [pathname, hasCameraStream, stopCamera]);

  // --- VIDEO RECORDING FUNCTIONS ---
  const startVideoRecording = () => {
    if (!videoRef.current || !videoRef.current.srcObject) return;
    const stream = videoRef.current.srcObject as MediaStream;
    
    // Choose the best available codec. VP9 gives better quality-per-bit than VP8/the
    // generic webm fallback, so the iris texture survives compression for offline analysis.
    const codecPriority = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mimeType = codecPriority.find(t => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';

    // Bitrate matters for offline accuracy — the browser default (~1-2 Mbps at
    // 720p) blurs the ~15-25px iris, which is exactly the detail gaze inference
    // needs. It also decides how long the participant waits at the end, because
    // a recording made faster than the connection can send it can only be
    // caught up on after calibration. `lib/recordingConfig.ts` explains the
    // trade-off and holds the number. See docs/EXPERT_ACCURACY_ASSESSMENT.md §1.1.
    try {
        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        });
        recordedChunksRef.current = [];

        // Start streaming this recording to S3 now. Anything that goes wrong in
        // here is handled inside the uploader: it marks itself failed and the
        // save path falls back to uploading the finished blob.
        //
        // The uploader needs a real session id to prove ownership at `create`
        // time (see lib/s3Server.ts's validateUploadOwner) — normally already
        // set by ensureSessionCreated() fired right after demographics, well
        // before the participant reaches calibration. In the rare case it
        // hasn't resolved yet, skip the streaming optimization for this
        // recording rather than block camera start on a network round trip;
        // the full blob still gets uploaded at the end once the session
        // exists (see finishVideoUpload in completeCalibrationAndStartTracking).
        void videoUploaderRef.current?.abort();
        videoUploaderRef.current = null;
        const recordingSessionId = sessionIdRef.current;
        if (recordingSessionId) {
          const uploader = new ChunkedVideoUploader(
            `calibration-${Date.now()}.webm`,
            'video/webm',
            { type: 'session', id: recordingSessionId }
          );
          uploader.start();
          videoUploaderRef.current = uploader;
        } else {
          console.warn('[ChunkedUpload] no session id yet at recording start — streaming upload skipped for this recording');
        }

        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                // Kept in full as well: the offline gaze backend and the
                // ?exportMeta=1 download both need the complete blob locally.
                recordedChunksRef.current.push(event.data);
                videoUploaderRef.current?.add(event.data);
            }
        };

        recorder.onstop = () => {
            const blob = new Blob(recordedChunksRef.current, { type: mimeType });
            if (recordingResolveRef.current) {
              recordingResolveRef.current(blob);
              recordingResolveRef.current = null;
            }
            const url = URL.createObjectURL(blob);
            setRecordedVideoUrl(url);
            recordedChunksRef.current = [];
        };

        // The timeslice is what makes streaming possible: with no argument,
        // ondataavailable fires once at stop and the whole file is stuck in
        // memory until the session ends.
        recorder.start(RECORDER_TIMESLICE_MS);
        metaRecorderRef.current.startRecording();   // t=0 for offline dot windows
        mediaRecorderRef.current = recorder;
        setIsRecording(true);
        setRecordedVideoUrl(null); // Clear previous video
        setCapturedImages([]); // Clear previous photos
    } catch (e) {
        console.error("Recording failed to start", e);
    }
  };

  const stopVideoRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        setIsRecording(false);
    }
  };

  const stopVideoRecordingAndGetBlob = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
        resolve(null);
        return;
      }
      recordingResolveRef.current = resolve;
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    });
  };

  // --- NEUROLOGICAL TEST VIDEO RECORDING ---
  // One continuous recording spanning the 7 tests, started/stopped by the
  // effect below rather than an explicit call site — see that effect's
  // comment for why (redo, dev verify-mode, and a HEAD_POSITIONING
  // interruption mid-test all have to be able to enter/leave neuroPhase
  // 'tests' without producing a fresh video or cutting the one in progress).
  const startNeuroVideoRecording = (runId: string) => {
    if (!videoRef.current || !videoRef.current.srcObject) return;
    if (neuroMediaRecorderRef.current) return; // already recording

    const stream = videoRef.current.srcObject as MediaStream;
    const codecPriority = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mimeType = codecPriority.find(t => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';

    try {
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      });
      neuroRecordedChunksRef.current = [];
      neuroRecordingRunIdRef.current = runId;

      const uploader = new ChunkedVideoUploader(
        `neuro-${runId}-${Date.now()}.webm`,
        'video/webm',
        { type: 'run', id: runId }
      );
      uploader.start();
      neuroVideoUploaderRef.current = uploader;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          neuroRecordedChunksRef.current.push(event.data);
          neuroVideoUploaderRef.current?.add(event.data);
        }
      };

      recorder.start(RECORDER_TIMESLICE_MS);
      neuroMediaRecorderRef.current = recorder;
    } catch (e) {
      console.error('[NeuroVideo] failed to start', e);
    }
  };

  /**
   * Stop whatever neuro recording is in progress and save it against the run
   * it was started for — not necessarily the run currently in state, if a
   * redo has already moved on. Soft-fails like every other upload in this
   * flow: a lost video never blocks or interrupts the participant, it just
   * means that run has no raw-video fallback.
   */
  const finishNeuroVideoRecording = useCallback(async (): Promise<void> => {
    const recorder = neuroMediaRecorderRef.current;
    const runId = neuroRecordingRunIdRef.current;
    const uploader = neuroVideoUploaderRef.current;
    neuroMediaRecorderRef.current = null;
    neuroRecordingRunIdRef.current = null;
    neuroVideoUploaderRef.current = null;
    if (!recorder || recorder.state === 'inactive') return;

    try {
      const mimeType = recorder.mimeType || 'video/webm';
      const blob = await new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          resolve(new Blob(neuroRecordedChunksRef.current, { type: mimeType }));
        };
        recorder.stop();
      });
      neuroRecordedChunksRef.current = [];
      if (!blob || blob.size === 0 || !runId) return;

      let videoUrl: string | null = uploader ? await uploader.finish() : null;
      if (!videoUrl) {
        videoUrl = await uploadApi.uploadBlob(
          blob,
          `neuro-${runId}-${Date.now()}.webm`,
          'video/webm',
          { type: 'run', id: runId }
        );
      }
      if (videoUrl) {
        await neurologicalRunsApi.patch(runId, { videoUrl });
      }
    } catch (e) {
      console.warn('[NeuroVideo] finalize failed — no video saved for this run', e);
    }
  }, []);

  /**
   * Drives neuro video recording from state rather than any single handler —
   * the same reasoning as the camera start/stop effects above. neuroPhase
   * 'tests' is entered and left from several places (the pre-questionnaire
   * submit, the skip-questionnaire fast path in handleChooseNeurological, a
   * "redo tests" restart, and the dev verify-after-each-test mode), and a
   * status flip to HEAD_POSITIONING mid-test does NOT change neuroPhase — so
   * gating on neuroPhase alone, rather than status, is what keeps a head
   * repositioning from cutting the recording into pieces.
   */
  useEffect(() => {
    if (!NEURO_RECORD_VIDEO_ENABLED) return;
    const shouldRecord =
      (status === 'NEURO_FLOW' || status === 'HEAD_POSITIONING') &&
      neuroPhase === 'tests' &&
      !!neuroRunId &&
      hasCameraStream;
    if (shouldRecord && !neuroMediaRecorderRef.current) {
      startNeuroVideoRecording(neuroRunId!);
    } else if (!shouldRecord && neuroMediaRecorderRef.current) {
      void finishNeuroVideoRecording();
    }
  }, [status, neuroPhase, neuroRunId, hasCameraStream, finishNeuroVideoRecording]);

  const captureCurrentFrameAsBlob = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) {
        resolve(null);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(video, 0, 0);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
    });
  };

  // --- FACE CAPTURE LOGIC ---
  const captureFaceArea = (landmarks: NormalizedLandmark[]) => {
      if (!videoRef.current) return;

      const video = videoRef.current;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      
      // Calculate Bounding Box from Landmarks
      let minX = 1, minY = 1, maxX = 0, maxY = 0;
      landmarks.forEach(lm => {
          if (lm.x < minX) minX = lm.x;
          if (lm.x > maxX) maxX = lm.x;
          if (lm.y < minY) minY = lm.y;
          if (lm.y > maxY) maxY = lm.y;
      });

      // Add Padding (e.g. 15%)
      const padX = (maxX - minX) * 0.15;
      const padY = (maxY - minY) * 0.25; // More padding on top/bottom for full head

      // Convert to pixels & Clamp
      const pixelX = Math.max(0, (minX - padX) * vw);
      const pixelY = Math.max(0, (minY - padY) * vh);
      const pixelW = Math.min(vw - pixelX, ((maxX - minX) + 2 * padX) * vw);
      const pixelH = Math.min(vh - pixelY, ((maxY - minY) + 2 * padY) * vh);

      // Draw to Temp Canvas
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = pixelW;
      tempCanvas.height = pixelH;
      const ctx = tempCanvas.getContext('2d');
      if (ctx) {
          ctx.drawImage(video, pixelX, pixelY, pixelW, pixelH, 0, 0, pixelW, pixelH);
          const url = tempCanvas.toDataURL('image/jpeg', 0.8);
          const timeStr = new Date().toLocaleTimeString();
          setCapturedImages(prev => [...prev, { url, timestamp: timeStr }]);
      }
  };

  /** Keep frameMetaRef on the newest camera frame for as long as this video element plays. */
  const watchFrameCaptureTimes = (video: HTMLVideoElement) => {
    type FrameMeta = { mediaTime: number; captureTime?: number; presentationTime: number };
    const v = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number;
    };
    if (typeof v.requestVideoFrameCallback !== 'function') return;
    const onFrame = (_now: number, meta: FrameMeta) => {
      // captureTime is only reported for camera streams (and not by every
      // browser); presentationTime is the next best thing on the same clock.
      frameMetaRef.current = { mediaTime: meta.mediaTime, t: meta.captureTime ?? meta.presentationTime };
      if (videoRef.current === video && video.srcObject) v.requestVideoFrameCallback!(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
  };

  /** One entry of the per-frame gaze stream (lib/gazeFrameStream) for this pass's frame. */
  const recordGazeFrame = (
    q: GazeFrameQuality,
    gaze?: { x: number; y: number; sx: number; sy: number },
    pose?: { yaw: number; pitch: number },
  ) => {
    if (!gazeFrameStream.recording) return;
    const toDeg = 180 / Math.PI;
    gazeFrameStream.push({
      t: frameTimeRef.current,
      x: gaze?.x ?? NaN,
      y: gaze?.y ?? NaN,
      sx: gaze?.sx ?? NaN,
      sy: gaze?.sy ?? NaN,
      q,
      ...(pose && { yaw: pose.yaw * toDeg, pitch: pose.pitch * toDeg }),
    });
  };

  const processVideo = useCallback(() => {
    if (!videoRef.current) return;
    
    const now = performance.now();
    if (videoRef.current.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = videoRef.current.currentTime;
      const meta = frameMetaRef.current;
      frameTimeRef.current =
        meta && Math.abs(meta.mediaTime - videoRef.current.currentTime) < 0.002 && meta.t <= now ? meta.t : now;
      const currentStatus = statusRef.current;
      // Only exercises trade detections for smooth dot motion; a static dot does
      // not move, so while one is being collected every frame is worth keeping.
      const shouldAdaptDetectionLoad =
        currentStatus === 'CALIBRATION' && exerciseActiveRef.current;
      let skipDetectionThisFrame = false;

      if (shouldAdaptDetectionLoad) {
        detectionFrameCounterRef.current += 1;
        const stride = Math.max(1, detectionStrideRef.current);
        if (detectionFrameCounterRef.current % stride !== 0) {
          skipDetectionThisFrame = true;
        }
      } else {
        detectionFrameCounterRef.current = 0;
        detectionStrideRef.current = 1;
        detectionAvgMsRef.current = 0;
      }

      // On weak devices during calibration, intentionally skip heavy processing
      // for non-detection frames to keep visual dot movement smoother.
      if (skipDetectionThisFrame) {
        requestRef.current = requestAnimationFrame(processVideo);
        return;
      }

      let results = null;
      if (!skipDetectionThisFrame) {
        const detectStart = performance.now();
        results = eyeTrackingService.detect(videoRef.current, now);
        const detectElapsed = performance.now() - detectStart;
        if (shouldAdaptDetectionLoad) {
          detectionAvgMsRef.current = detectionAvgMsRef.current === 0
            ? detectElapsed
            : detectionAvgMsRef.current * 0.8 + detectElapsed * 0.2;
          if (detectionAvgMsRef.current > 26) detectionStrideRef.current = 3;
          else if (detectionAvgMsRef.current > 16) detectionStrideRef.current = 2;
          else detectionStrideRef.current = 1;
        }
      }
      
      // --- DRAWING LOGIC (Debug & Head Position) ---
      const ctx = debugCanvasRef.current?.getContext('2d');
      const canvas = debugCanvasRef.current;
      const video = videoRef.current;
      
      if (ctx && canvas && video) {
          // --- PERIODIC BRIGHTNESS CHECK (measure light for accuracy feedback) ---
          if (video.readyState >= 2 && video.videoWidth > 0 && (now - lastBrightnessCheckTimeRef.current) > 2000) {
            lastBrightnessCheckTimeRef.current = now;
            if (!brightnessCanvasRef.current) brightnessCanvasRef.current = document.createElement('canvas');
            const bc = brightnessCanvasRef.current;
            bc.width = 100;
            bc.height = 100;
            const bctx = bc.getContext('2d', { willReadFrequently: true });
            if (bctx) {
              bctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, 100, 100);
              const img = bctx.getImageData(0, 0, 100, 100).data;
              let sum = 0;
              for (let i = 0; i < img.length; i += 4)
                sum += 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
              const value = Math.round(sum / (100 * 100)); // 0–255
              const status: 'too_dark' | 'low' | 'ok' | 'good' =
                value < 45 ? 'too_dark' : value < 70 ? 'low' : value < 110 ? 'ok' : 'good';
              setLightLevel({ value, status });
            }
          }

          // Sync size
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
          }

          // Clear previous frame
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (results && results.faceLandmarks.length > 0) {
              const landmarks = results.faceLandmarks[0];
              currentFaceLandmarksRef.current = landmarks;

              // --- CONTINUOUS HEAD VALIDATION ---
              const validation = eyeTrackingService.validateHeadPosition(
                landmarks,
                configRef.current.faceDistance,
                configRef.current.faceWidthScale ?? 1,
                configRef.current.headDistanceTolerance ?? 2
              );
              setHeadValidation(validation);
              headValidationRef.current = validation;
              isHeadValidRef.current = validation.valid;

              // Debug log (throttled) during Head Positioning so user can see values in Console
              if (statusRef.current === 'HEAD_POSITIONING' && validation.debug && now - lastHeadDebugLogRef.current > 500) {
                lastHeadDebugLogRef.current = now;
                console.log('[Head Position]', validation.valid ? 'OK' : validation.message, '| faceWidth:', validation.debug.faceWidth.toFixed(3), 'min:', validation.debug.minFaceWidth.toFixed(3), 'max:', validation.debug.maxFaceWidth.toFixed(3), 'target:', validation.debug.targetDistanceCm + 'cm');
              }

              // --- HEAD POSE FOR NEURO TESTS (throttled ~15 Hz) ---
              if (statusRef.current === 'NEURO_FLOW' && now - lastNeuroHeadPoseTimeRef.current > 66) {
                lastNeuroHeadPoseTimeRef.current = now;
                setNeuroHeadPose(eyeTrackingService.calculateGeometricHeadPose(landmarks));
              }

              // --- PERIODIC FACE CAPTURE (Only during Tracking) ---
              if (statusRef.current === 'TRACKING' && configRef.current.faceCaptureInterval > 0) {
                  const intervalMs = configRef.current.faceCaptureInterval * 1000;
                  if (now - lastCaptureTimeRef.current > intervalMs) {
                      lastCaptureTimeRef.current = now;
                      captureFaceArea(landmarks);
                  }
              }

              // --- SPECIFIC LOGIC PER STATUS ---
              
              // "Hold a valid position for 2s" — the one timer that clears
              // HEAD_POSITIONING however we got there: back to CALIBRATION,
              // into it fresh the first time, or back to NEURO_FLOW.
              if (statusRef.current === 'HEAD_POSITIONING') {
                  if (validation.valid) {
                      setStableFrameCount(c => c + 1);
                      if (!headPosStartTimeRef.current) {
                          headPosStartTimeRef.current = now;
                      }
                      const elapsed = now - headPosStartTimeRef.current;
                      const remaining = Math.max(0, 2000 - elapsed);
                      setPositionHoldTime(remaining);

                      if (remaining === 0) {
                          headPosStartTimeRef.current = null;
                          setPositionHoldTime(null);
                          if (neuroFlowResumeRef.current) {
                              neuroFlowResumeRef.current = false;
                              setStatus('NEURO_FLOW');
                          } else if (calibrationResumeRef.current) {
                              calibrationResumeRef.current = false;
                              setStatus('CALIBRATION');
                          } else {
                              startActualCalibration();
                          }
                      }
                  } else {
                      setStableFrameCount(0);
                      headPosStartTimeRef.current = null;
                      setPositionHoldTime(null);
                  }
              }

              // During CALIBRATION: if head invalid (wrong distance / off-center), return to Head Positioning after short debounce
              // Do NOT return to HEAD_POSITIONING if we are showing an assessment modal or saving samples,
              // to avoid interrupting the user.
              if (
                statusRef.current === 'CALIBRATION' &&
                !validation.valid &&
                !assessmentPendingRef.current
              ) {
                  if (headInvalidSinceRef.current === null) headInvalidSinceRef.current = now;
                  else if (now - headInvalidSinceRef.current > 500) {
                      headInvalidSinceRef.current = null;
                      calibrationResumeRef.current = true;
                      setStatus('HEAD_POSITIONING');
                  }
              } else if (statusRef.current === 'CALIBRATION' && validation.valid) {
                  headInvalidSinceRef.current = null;
              }

              // During the recorded portion of a neuro test specifically
              // (neuroCurrentPhaseRef === 'test', not the guide/practice/
              // realIntro that come before it): the same loop CALIBRATION
              // uses — same debounce, same HEAD_POSITIONING screen, same 2s
              // hold to clear. The test that was running unmounts and, on
              // return, starts over: trials collected before the
              // interruption are gone, same as CALIBRATION losing an
              // in-progress dwell on a grid point. Resuming always lands
              // back on 'test' (never replays guide/practice) precisely
              // because this can only ever fire once already there — see
              // NeurologicalFlowSection's flowPropsFor.
              //
              // Pre/post questionnaires don't need the camera at all, so
              // they are deliberately excluded — interrupting someone
              // answering a symptom survey would be pure friction with
              // nothing to protect. head_orientation is also excluded, and
              // has to be: its whole instruction is to turn the head away
              // from the camera in each direction, which is exactly what
              // validateHeadPosition's centring and tilt checks read as
              // "invalid". Triggering on that would fire the instant the
              // participant does what the test just asked them to do.
              //
              // Also excluded: the active test's own post-test break screen
              // (neuroTestBreakActiveRef). Its trials are done and its
              // result already banked — there is nothing left being
              // recorded, so interrupting there would only unmount that
              // break screen and force a full redo of a test that had
              // already finished, which is worse than not checking at all.
              //
              // And excluded: guide, practice, and the realIntro countdown
              // (neuroCurrentPhaseRef !== 'test') — nothing is recorded in
              // any of them either (practice says so on screen), so there is
              // no data at risk, only a participant trying to read and
              // understand the task who gets yanked into HEAD_POSITIONING
              // for it. The check exists to protect the recorded trials,
              // which only start once phase is actually 'test'.
              if (
                statusRef.current === 'NEURO_FLOW' &&
                neuroPhaseRef.current === 'tests' &&
                neuroCurrentPhaseRef.current === 'test' &&
                currentNeuroTestIdRef.current !== 'head_orientation' &&
                !neuroTestBreakActiveRef.current &&
                !validation.valid
              ) {
                  if (headInvalidSinceRef.current === null) headInvalidSinceRef.current = now;
                  else if (now - headInvalidSinceRef.current > 500) {
                      headInvalidSinceRef.current = null;
                      neuroFlowResumeRef.current = true;
                      setNeuroResumeTestId(currentNeuroTestIdRef.current);
                      setNeuroResumePhase(neuroCurrentPhaseRef.current);
                      setStatus('HEAD_POSITIONING');
                  }
              } else if (
                statusRef.current === 'NEURO_FLOW' &&
                (validation.valid ||
                  currentNeuroTestIdRef.current === 'head_orientation' ||
                  neuroTestBreakActiveRef.current ||
                  neuroCurrentPhaseRef.current !== 'test')
              ) {
                  // Also reset while head_orientation is running, or the
                  // break screen is up (not just when valid) — otherwise a
                  // debounce timer left mid-count from the test just before
                  // would carry a stale, already-elapsed start time into
                  // whatever test comes after, skipping that test's own
                  // 500ms debounce.
                  headInvalidSinceRef.current = null;
              }

              // Draw Face Mesh on debugCanvas (skip during HEAD_POSITIONING or LOADING_MODEL)
              if (statusRef.current !== 'HEAD_POSITIONING' && statusRef.current !== 'LOADING_MODEL') {
                  const shouldShowMesh = !validation.valid;
                  const shouldShowDebug = showCameraRef.current;
                  const isHeadOrientationStep =
                    statusRef.current === 'NEURO_FLOW' &&
                    currentNeuroTestIdRef.current === 'head_orientation';

                  if (shouldShowMesh || shouldShowDebug) {
                      ctx.lineWidth = 0.5;
                      // During Head Orientation test, keep face dots green for clearer user feedback.
                      ctx.fillStyle = isHeadOrientationStep ? "#4ade80" : (validation.valid ? "#4ade80" : "#ef4444");
                      
                      for (let i = 0; i < landmarks.length; i++) {
                          const lm = landmarks[i];
                          ctx.beginPath();
                          ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 0.8, 0, 2 * Math.PI);
                          ctx.fill();
                      }
                  }
              }
          } else {
             currentFaceLandmarksRef.current = null;
             isHeadValidRef.current = false;
             setHeadValidation({ valid: false, message: "No Face Detected" });
             // No landmarks at all this frame — the gaze-processing block
             // below never runs, so the {0,0} reset there doesn't fire.
             // Same reasoning applies: don't leave a stale coordinate on
             // the ref while nothing is confirming it is still correct.
             if (statusRef.current === 'TRACKING' || statusRef.current === 'NEURO_FLOW') {
               neuroLiveGazeRef.current = { x: 0, y: 0 };
               recordGazeFrame(GazeFrameQuality.NO_FACE);
             }
          }
      }

      if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];
        
        // --- ONLY PROCESS GAZE IF HEAD IS VALID ---
        if (isHeadValidRef.current) {
            const blinking = eyeTrackingService.isBlinking(landmarks);
            setIsBlinking(blinking);
            // Blink frames never reach the collectors, but their timing does: the
            // frames around a blink are dropped too (lid moving, eye recovering).
            if (blinking && statusRef.current === 'CALIBRATION') {
              pointCollectorRef.current?.addBlink(now);
              if (exerciseActiveRef.current) exerciseBlinkTimesRef.current.push(now);
            }
            if (blinking) recordGazeFrame(GazeFrameQuality.BLINK);

            if (!blinking) {
                // Pass optional MediaPipe outputs for richer feature extraction
                const features = eyeTrackingService.extractEyeFeatures(
                  landmarks,
                  results.faceBlendshapes?.[0]?.categories as { categoryName: string; score: number }[] | undefined,
                  results.facialTransformationMatrixes?.[0] as { data: number[] | Float32Array } | undefined
                );

                if (features) {
                  setRawFeatures(features);
                  const currentStatus = statusRef.current;

                  // 1. Data Collection (calibration / validation dots). The collector,
                  // not the clock, decides which of these frames the dot is built from.
                  if (currentStatus === 'CALIBRATION' && isCollectingRef.current) {
                    pointCollectorRef.current?.addFrame(now, features);
                  }

                  // 1b. Data Collection (eye movement exercises)
                  if (currentStatus === 'CALIBRATION' && exerciseActiveRef.current) {
                    const target = exerciseTargetRef.current;
                    if (target) {
                      const inputVector = eyeTrackingService.prepareFeatureVector(features, configRef.current);
                      // Always record target vs predicted gaze for deviation charts
                      if (now - lastTestRecordTimeRef.current >= 50) {
                        lastTestRecordTimeRef.current = now;
                        const t = (now - testSegmentStartTimeRef.current) / 1000;
                        const targetX = (target.x / window.innerWidth) * 100;
                        const targetY = (target.y / window.innerHeight) * 100;
                        const pred = hybridRegressorRef.current.predict(inputVector, configRef.current.regressionMethod);
                        const gazeX = (pred.x / window.innerWidth) * 100;
                        const gazeY = (pred.y / window.innerHeight) * 100;
                        currentTestSegmentRef.current.push({ t, targetX, targetY, gazeX, gazeY });
                      }
                      
                      if (runModeRef.current !== 'test') {
                        const len = exerciseDataRef.current.length;
                        exerciseDataRef.current.push({
                          t: now,
                          screenX: target.x,
                          screenY: target.y,
                          features: inputVector,
                          head: toHeadSnapshot(headValidationRef.current),
                          rawEyeFeatures: features, // stored for re-evaluation with different flags
                        });
                        if (len % 5 === 0) {
                          captureCurrentFrameAsBlob().then((b) => b && exerciseBlobsRef.current.push(b));
                        }
                      }
                    }
                  }
                  
                  // 2. Real-time Prediction (TRACKING and NEURO_FLOW for gaze during neuro tests)
                  if (currentStatus === 'TRACKING' || currentStatus === 'NEURO_FLOW') {
                    predictGaze(features, now);
                  }
                }
            }
        } else if (statusRef.current === 'TRACKING' || statusRef.current === 'NEURO_FLOW') {
          // Head position invalid (too close/far, off to one side, or no
          // face): predictGaze() above never runs, so neuroLiveGazeRef would
          // otherwise just sit frozen at wherever gaze last was — every one
          // of the seven tests samples that ref on its own interval, so a
          // frozen coordinate gets recorded as though it were live data for
          // as long as the position stays invalid. {0,0} is the sentinel
          // several tests already treat as "not real" (MemoryCardsTest's
          // dwell check, for one) — reusing it here means a bad stretch
          // shows up as an obviously-placeholder value instead of a
          // plausible-looking but wrong one.
          neuroLiveGazeRef.current = { x: 0, y: 0 };
          recordGazeFrame(GazeFrameQuality.HEAD_INVALID);
        }
      }
    }
    requestRef.current = requestAnimationFrame(processVideo);
  }, []); 

  // --- HEAD POSITIONING CANVAS: draws video + face mesh + target box in a contained view ---
  useEffect(() => {
    if (status !== 'HEAD_POSITIONING') return;
    const canvas = headPosCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    let rafId: number;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx || video.readyState < 2 || video.videoWidth === 0) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      const W = canvas.width;
      const H = canvas.height;

      // Draw mirrored video frame
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, W, H);
      ctx.restore();

      const valid = isHeadValidRef.current;
      const color = valid ? '#22c55e' : '#ef4444';

      // Target box (matches frontend HeadPoseStep proportions)
      const bw = 0.26, bh = 0.48;
      const bx = (1 - bw) / 2 * W;
      const by = (1 - bh) / 2 * H;
      const boxW = bw * W;
      const boxH = bh * H;

      // Rounded target box
      ctx.lineWidth = 2;
      ctx.strokeStyle = valid ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)';
      roundedRect(ctx, bx, by, boxW, boxH, 16);
      ctx.stroke();

      // Corner brackets
      const cLen = 25;
      ctx.lineWidth = 4;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      // TL
      ctx.beginPath();
      ctx.moveTo(bx, by + cLen); ctx.lineTo(bx, by); ctx.lineTo(bx + cLen, by);
      ctx.stroke();
      // TR
      ctx.beginPath();
      ctx.moveTo(bx + boxW - cLen, by); ctx.lineTo(bx + boxW, by); ctx.lineTo(bx + boxW, by + cLen);
      ctx.stroke();
      // BL
      ctx.beginPath();
      ctx.moveTo(bx, by + boxH - cLen); ctx.lineTo(bx, by + boxH); ctx.lineTo(bx + cLen, by + boxH);
      ctx.stroke();
      // BR
      ctx.beginPath();
      ctx.moveTo(bx + boxW - cLen, by + boxH); ctx.lineTo(bx + boxW, by + boxH); ctx.lineTo(bx + boxW, by + boxH - cLen);
      ctx.stroke();

      // Crosshairs
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W / 2, by); ctx.lineTo(W / 2, by + boxH);
      ctx.moveTo(bx, H / 2); ctx.lineTo(bx + boxW, H / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Center dot
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Draw face mesh: all 478 landmarks — always green; only the box shows pass/fail (red/green)
      const lm = currentFaceLandmarksRef.current;
      if (lm && lm.length > 0) {
        ctx.fillStyle = 'rgba(34, 197, 94, 0.95)';
        const r = 1.5;
        // Batch all 478 dots into ONE path + ONE fill (was 478 separate beginPath/fill
        // calls per frame). moveTo before each arc prevents connecting lines between dots.
        ctx.beginPath();
        for (let i = 0; i < lm.length; i++) {
          const p = lm[i];
          const x = (1 - p.x) * W;
          const y = p.y * H;
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [status]);

  // --- CALIBRATION INTERACTION LOGIC (CLICK & HOLD) ---
  const handlePointMouseDown = () => {
    if (config.calibrationMethod !== CalibrationMethod.CLICK_HOLD) return;

    const now = performance.now();
    pointCollectorRef.current = new FixationCollector(now, clickHoldFixationOptions(), fixationNoiseRef.current);
    isCollectingRef.current = true;
    holdStartTimeRef.current = now;
    
    const updateProgress = () => {
        const elapsed = (performance.now() - holdStartTimeRef.current) / 1000; // seconds
        const progress = Math.min(1, elapsed / config.clickDuration);
        setCalibrationProgress(progress);
        
        if (progress < 1) {
            clickAnimationRef.current = requestAnimationFrame(updateProgress);
        } else {
            // Completed!
            handlePointMouseUp(true);
        }
    };
    
    clickAnimationRef.current = requestAnimationFrame(updateProgress);
  };

  const handlePointMouseUp = (success: boolean = false) => {
    if (config.calibrationMethod !== CalibrationMethod.CLICK_HOLD) return;
    
    isCollectingRef.current = false;
    cancelAnimationFrame(clickAnimationRef.current);
    const collector = pointCollectorRef.current;
    pointCollectorRef.current = null;

    // Check if we held long enough
    if ((success === true || calibrationProgress >= 1) && collector) {
        const point = calibPoints[currentCalibIndex];
        if (point) handleDotResult(point, collector.finalize(performance.now()));
    } else {
        // Failed / Released early
        console.warn("Released too early");
    }
    
    setCalibrationProgress(0);
  };

  /** k for the final MAD rejection, from the Data Hygiene setting (TRIM_TAILS keeps the default). */
  const outlierMadK = (): number => {
    const c = configRef.current;
    if (c.outlierMethod === OutlierMethod.NONE) return Infinity;
    if (c.outlierMethod === OutlierMethod.STD_DEV) return c.outlierThreshold;
    return DEFAULT_FIXATION_OPTIONS.madK;
  };

  /** Click & Hold: the hold length caps the window; the settle floor still applies. */
  const clickHoldFixationOptions = () => {
    const holdMs = configRef.current.clickDuration * 1000;
    return { ...timerFixationOptions(1, outlierMadK()), collectMs: Math.min(700, holdMs / 2), maxMs: holdMs };
  };

  // --- CALIBRATION LOGIC ENGINE (TIMER BASED, GAZE-CONTINGENT) ---
  // A dot is collected only once the gaze has settled on it (FixationCollector,
  // lib/fixationSampling.ts): the dot's capturing state switches on when a stable
  // fixation begins, and the dot completes as soon as the stable run is long
  // enough — or after a timeout with the best run seen. The EXERCISES phase has
  // its own layer and must not run this: it used to record one more sample,
  // labelled as the last grid dot, while the participant watched the exercise
  // countdown at the center.
  useEffect(() => {
    if (status !== 'CALIBRATION') {
      timerRef.current.forEach(clearTimeout);
      timerRef.current = [];
      isCollectingRef.current = false;
      pointCollectorRef.current = null;
      return;
    }

    // Skip timer logic if we are in Click & Hold mode
    if (config.calibrationMethod === CalibrationMethod.CLICK_HOLD) {
        return;
    }
    if (calibPhase === CalibrationPhase.EXERCISES) return;

    const point = calibPoints[currentCalibIndex];
    if (!point) return;

    setIsCapturing(false);

    // Speed only scales how long a dot collects and how long we wait for a stable
    // fixation; the settle floor is physiological. Quick mode forces FAST.
    const speedMultiplier = NEURO_QUICK_MODE
      ? 0.5
      : config.calibrationSpeed === 'FAST' ? 0.5 : config.calibrationSpeed === 'SLOW' ? 1.5 : 1.0;
    const opts = timerFixationOptions(speedMultiplier, outlierMadK());
    const onset = performance.now();
    const collector = new FixationCollector(onset, opts, fixationNoiseRef.current);
    pointCollectorRef.current = collector;
    isCollectingRef.current = true;
    let capturing = false;

    const poll = setInterval(() => {
      const now = performance.now();
      const state = collector.evaluate(now);
      if (state.capturing && !capturing) {
        capturing = true;
        setIsCapturing(true);
      }
      if (!state.complete && now - onset < opts.maxMs) return;
      clearInterval(poll);
      isCollectingRef.current = false;
      pointCollectorRef.current = null;
      setIsCapturing(false);
      handleDotResult(point, collector.finalize(now));
    }, 50);

    return () => {
      clearInterval(poll);
      if (pointCollectorRef.current === collector) {
        pointCollectorRef.current = null;
        isCollectingRef.current = false;
      }
    };

  }, [currentCalibIndex, status, calibPoints, calibPhase, config.calibrationSpeed, config.calibrationMethod, retryCount]);

  const toHeadSnapshot = (v: HeadValidationResult | null): HeadSnapshot | undefined => {
    if (!v) return undefined;
    return {
      valid: v.valid,
      message: v.message,
      ...(v.debug && {
        faceWidth: v.debug.faceWidth,
        minFaceWidth: v.debug.minFaceWidth,
        maxFaceWidth: v.debug.maxFaceWidth,
        targetDistanceCm: v.debug.targetDistanceCm,
      }),
    };
  };

  /** A dot is shown at most this many times (first try + re-queues) before its best attempt stands. */
  const MAX_DOT_ATTEMPTS = 3;

  const resetDotBookkeeping = () => {
    dotAttemptsRef.current.clear();
    dotAttemptCountRef.current.clear();
    recollectKeysRef.current.clear();
    residualReviewDoneRef.current = false;
    validationErrorByIdRef.current.clear();
  };

  /** Precision of a validation dot: spread of its individually mapped frames (px). */
  const validationPrecisionPx = (result: FixationResult): Pick<SampleQuality, 'precisionRmsS2SPx' | 'precisionSdPx'> => {
    const pts = result.frames.map((fr) =>
      hybridRegressorRef.current.predict(
        eyeTrackingService.prepareFeatureVector(fr.f, configRef.current),
        configRef.current.regressionMethod,
      ));
    if (pts.length < 3) return {};
    let s2s = 0;
    for (let i = 1; i < pts.length; i++) s2s += (pts[i]!.x - pts[i - 1]!.x) ** 2 + (pts[i]!.y - pts[i - 1]!.y) ** 2;
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const sd = Math.sqrt(pts.reduce((s, p) => s + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / pts.length);
    return { precisionRmsS2SPx: Math.sqrt(s2s / (pts.length - 1)), precisionSdPx: sd };
  };

  /** Write (or overwrite) the training/validation sample for a dot from its fixation result. */
  const storeDotSample = (point: CalibrationPoint, key: string, result: FixationResult, attempts: number, isValidation: boolean) => {
    const screenX = (point.x / 100) * window.innerWidth;
    const screenY = (point.y / 100) * window.innerHeight;
    const features = eyeTrackingService.prepareFeatureVector(result.center, configRef.current);

    // This dot's fixation window on the video clock, for offline reprocessing.
    metaRecorderRef.current.putDot(key, screenX, screenY, isValidation, result.tStart, result.tEnd);

    const quality: SampleQuality = {
      method: result.ok ? 'fixation' : 'fixation_fallback',
      nFrames: result.frames.length,
      spanMs: Math.round(result.spanMs),
      settleMs: Math.round(result.settleMs),
      dispersion: result.dispersion,
      attempts,
    };
    if (isValidation) {
      const prediction = hybridRegressorRef.current.predict(features, configRef.current.regressionMethod);
      const err = Math.hypot(prediction.x - screenX, prediction.y - screenY);
      validationErrorByIdRef.current.set(point.id, err);
      Object.assign(quality, validationPrecisionPx(result));
      console.log(`Validation dot ${point.id - 1000}: error ${err.toFixed(1)}px, precision RMS-S2S ${quality.precisionRmsS2SPx?.toFixed(1) ?? 'n/a'}px`);
    }

    const sample: TrainingSample = {
      screenX,
      screenY,
      features,
      timestamp: Date.now(),
      head: toHeadSnapshot(headValidationRef.current),
      patternName: isValidation ? `Validation point ${point.id - 1000}` : `Calibration point ${point.id}`,
      rawEyeFeatures: result.center,
      quality,
    };
    const sampleIndex = dotAttemptsRef.current.get(key)?.sampleIndex ?? trainingSamplesRef.current.length;
    trainingSamplesRef.current[sampleIndex] = sample;
    // A re-collected dot replaces its sample; the old face capture no longer belongs to it.
    uploadedImageUrlsRef.current.delete(sampleIndex);
    dotAttemptsRef.current.set(key, { result, sampleIndex });
    setTrainingData([...trainingSamplesRef.current]);
    captureCurrentFrameAsBlob().then((b) => { if (b) sample.blobForUpload = b; });
  };

  /**
   * Tobii calibration steps 8–9: after the grid, check each dot's held-out
   * error and show the dots that stand out once more. Returns the dots to queue.
   */
  const reviewGridResiduals = (): CalibrationPoint[] => {
    const entries = [...dotAttemptsRef.current.entries()].filter(([key]) => key.startsWith('cal:'));
    const pts = entries.map(([, a]) => {
      const s = trainingSamplesRef.current[a.sampleIndex]!;
      const c = a.result.center;
      return {
        screenX: s.screenX,
        screenY: s.screenY,
        gx: (c.leftRelative.x + c.rightRelative.x) / 2,
        gy: (c.leftRelative.y + c.rightRelative.y) / 2,
      };
    });
    const { indices, residualsPx } = residualOutliers(pts);
    const byId = new Map(calibPoints.map((p) => [p.id, p]));
    const queue: CalibrationPoint[] = [];
    for (const i of indices) {
      const key = entries[i]![0];
      const point = byId.get(Number(key.slice(4)));
      if (!point) continue;
      recollectKeysRef.current.add(key);
      queue.push({ ...point });
      console.log(`[Calibration] Re-collecting ${key}: held-out error ${residualsPx[i]!.toFixed(0)}px`);
    }
    return queue;
  };

  /** Next dot, appending re-queued dots; at the end of the grid, one residual review. */
  const advanceDot = (requeue: CalibrationPoint[]) => {
    const queueLength = calibPoints.length + requeue.length;
    if (requeue.length) setCalibPoints((prev) => [...prev, ...requeue]);
    if (currentCalibIndex < queueLength - 1) {
      setCurrentCalibIndex((prev) => prev + 1);
      return;
    }
    // Quick mode is a pipeline smoke test; it skips the review to stay fast.
    if (calibPhase === CalibrationPhase.INITIAL_MAPPING && !residualReviewDoneRef.current && !NEURO_QUICK_MODE) {
      residualReviewDoneRef.current = true;
      const review = reviewGridResiduals();
      if (review.length) {
        setCalibPoints((prev) => [...prev, ...review]);
        setCurrentCalibIndex((prev) => prev + 1);
        return;
      }
    }
    finishCurrentPhase();
  };

  /**
   * What a dot's collection produced: keep the best attempt per dot, and show a
   * dot again at the end of the queue when it gave no complete stable fixation
   * — at most MAX_DOT_ATTEMPTS times, after which its best attempt stands (or
   * the dot is skipped). Never blocks the participant.
   */
  const handleDotResult = (point: CalibrationPoint, result: FixationResult | null) => {
    const isValidation = calibPhase === CalibrationPhase.VALIDATION;
    const key = `${isValidation ? 'val' : 'cal'}:${point.id}`;
    const attempts = (dotAttemptCountRef.current.get(key) ?? 0) + 1;
    dotAttemptCountRef.current.set(key, attempts);

    // A dot flagged by the residual review is replaced by its new stable fixation.
    const recollecting = recollectKeysRef.current.delete(key);
    const previous = dotAttemptsRef.current.get(key)?.result;
    if (result && (recollecting ? result.ok || !previous : isBetterResult(result, previous))) {
      storeDotSample(point, key, result, attempts, isValidation);
    }

    if (!result) console.warn(`[Calibration] ${key}: no usable fixation (attempt ${attempts})`);
    else if (!result.ok) console.warn(`[Calibration] ${key}: no stable fixation, best run ${result.frames.length} frames (attempt ${attempts})`);

    const haveStable = dotAttemptsRef.current.get(key)?.result.ok ?? false;
    const requeue = !haveStable && !recollecting && attempts < MAX_DOT_ATTEMPTS;
    advanceDot(requeue ? [{ ...point }] : []);
  };

  /**
   * What kind of machine this session's data came from — nothing here is
   * ever asked of the participant, it is read straight from the browser.
   *
   * Worth having once the data is being kept for a future algorithm
   * revisit: a systematic error that turns out to be one camera resolution,
   * one OS, or one devicePixelRatio is invisible without it, and there is no
   * way to go back and ask a past participant what hardware they used.
   *
   * Called once early (camera not open yet, so cameraWidth/Height are
   * absent) and again at the final save, where the camera has definitely
   * been running for minutes and its real resolution is known.
   */
  const buildDeviceInfo = useCallback((): Record<string, unknown> => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return {};
    const video = videoRef.current;
    return {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform
        ?? navigator.platform
        ?? undefined,
      screenWidthPx: window.screen?.width,
      screenHeightPx: window.screen?.height,
      viewportWidthPx: window.innerWidth,
      viewportHeightPx: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      ...(video && video.videoWidth > 0
        ? { cameraWidthPx: video.videoWidth, cameraHeightPx: video.videoHeight }
        : {}),
    };
  }, []);

  /**
   * The current calibrationGazeSamples/calibrationImageUrls the server would
   * see if we saved right now — built fresh from whatever has been collected
   * so far. Used both for a break's partial patch and for the final save, so
   * the two can never disagree about the shape of a sample.
   *
   * Sends `rawEyeFeatures` alongside the flattened `features` vector — see
   * the comment on RawEyeFeaturesPayload for why both are worth keeping.
   */
  const buildCalibrationSamplesPayload = useCallback(
    (imageUrlByIndex: Map<number, string>) => {
      const samples = trainingSamplesRef.current;
      const calibrationGazeSamples = samples.map((s, i) => ({
        screenX: s.screenX,
        screenY: s.screenY,
        features: s.features,
        rawEyeFeatures: s.rawEyeFeatures as unknown as RawEyeFeaturesPayload | undefined,
        timestamp: s.timestamp,
        head: s.head,
        imageUrl: imageUrlByIndex.get(i) ?? undefined,
        ...(s.patternName != null && { patternName: s.patternName }),
        ...(s.quality && { quality: s.quality }),
      }));
      const calibrationImageUrls = calibrationGazeSamples
        .map((s) => s.imageUrl)
        .filter((u): u is string => Boolean(u));
      return { calibrationGazeSamples, calibrationImageUrls };
    },
    []
  );

  /**
   * Create the session row if it does not exist yet. Safe to call many
   * times — concurrent callers share one in-flight attempt, and a failed
   * attempt is retried by whichever caller asks next (the promise is
   * cleared once it settles either way).
   *
   * Deliberately minimal at this point: just enough that the row exists and
   * is attributable to this participant. Breaks fill it in from here.
   */
  const ensureSessionCreated = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!sessionCreatePromiseRef.current) {
      sessionCreatePromiseRef.current = (async () => {
        try {
          const created = await sessionsApi.create({
            config: {
              ...(configRef.current as unknown as Record<string, unknown>),
              deviceInfo: buildDeviceInfo(),
              ...(consentRef.current ? { consent: consentRef.current } : {}),
            },
            demographics: demographicsRef.current
              ? {
                  ...demographicsRef.current,
                  age: demographicsRef.current.age === '' ? undefined : demographicsRef.current.age,
                }
              : undefined,
            participantEmail: demographicsRef.current?.email || undefined,
            status: 'in_progress',
          });
          sessionIdRef.current = created.id;
          return created.id;
        } catch (e) {
          console.warn('[Session] early create failed — will retry at the next break', e);
          return null;
        } finally {
          sessionCreatePromiseRef.current = null;
        }
      })();
    }
    return sessionCreatePromiseRef.current;
  }, [buildDeviceInfo]);

  /**
   * "Take the assessment again" from the results screen lands here
   * (/setup?redoFrom=<old session id>) with the consent-and-fullscreen click
   * already done on that page — this only has to copy the old session's
   * demographics and consent onto a brand-new one, the same fields
   * handleDemographicsSubmit would have set from a freshly filled-in form,
   * so nothing downstream (glasses optimization, the final save payload,
   * participant history in admin) can tell the difference from a normal
   * sitting except that this participant has done it before.
   *
   * Deliberately does not reuse the old session id or copy its calibration
   * data forward: this is a full new sitting, not a resume, matching the
   * "no cross-session continuation" decision already made for the admin
   * participant-history view.
   */
  const redoPrefillStartedRef = useRef(false);
  useEffect(() => {
    const redoFrom = searchParams.get('redoFrom');
    if (!redoFrom || redoPrefillStartedRef.current) return;
    redoPrefillStartedRef.current = true;
    (async () => {
      try {
        const prior = await sessionsApi.get(redoFrom);
        const priorConsent = (prior.config as { consent?: { agreedAt: string; version: string } } | null)
          ?.consent;
        if (!prior.demographics || !priorConsent) {
          // Nothing safe to skip past without both on file — send them
          // through the real flow instead of starting a session with no
          // recorded consent.
          pathSyncSourceRef.current = 'internal';
          router.push('/consent');
          return;
        }
        const d = prior.demographics;
        demographicsRef.current = {
          age: typeof d.age === 'number' ? d.age : '',
          gender: d.gender ?? '',
          email: d.email || prior.participantEmail || '',
          country: d.country ?? '',
          device: d.device ?? 'not_specified',
          eyeConditions: Array.isArray(d.eyeConditions) && d.eyeConditions.length > 0 ? d.eyeConditions : ['none'],
          wearsGlasses: d.wearsGlasses === true,
        };
        consentRef.current = priorConsent;
        void ensureSessionCreated();
      } catch (e) {
        console.warn('[Redo] could not load prior session — falling back to the full flow', e);
        pathSyncSourceRef.current = 'internal';
        router.push('/consent');
      }
    })();
  }, [searchParams, router, ensureSessionCreated]);

  /**
   * Patch the session with everything collected so far. Called at every
   * break. Serialized through sessionPatchChainRef so two of these can never
   * be in flight together — each one sends the complete current state, so an
   * older request finishing after a newer one would otherwise overwrite it
   * with stale data.
   *
   * Soft-fails like the image uploads it runs alongside: a break that could
   * not reach the server leaves the session exactly as it was after the last
   * one that could, and the final save is still the authoritative write.
   */
  const patchSessionProgress = useCallback(
    async (extra?: Partial<CreateSessionPayload>): Promise<void> => {
      const run = async () => {
        const id = await ensureSessionCreated();
        if (!id) return; // nothing to patch onto yet; final save will create it
        try {
          const { calibrationGazeSamples, calibrationImageUrls } = buildCalibrationSamplesPayload(
            uploadedImageUrlsRef.current
          );
          await sessionsApi.update(id, {
            calibrationGazeSamples,
            calibrationImageUrls,
            calibrationMeta: buildOfflineSessionMeta() as unknown as Record<string, unknown>,
            status: 'in_progress',
            ...extra,
          });
        } catch (e) {
          console.warn('[Session] break patch failed — will retry at the next break', e);
        }
      };
      sessionPatchChainRef.current = sessionPatchChainRef.current.then(run, run);
      return sessionPatchChainRef.current;
    },
    [ensureSessionCreated, buildCalibrationSamplesPayload]
  );

  /**
   * Upload the face captures collected so far that have not been uploaded yet.
   *
   * Called on every break, where the participant is resting anyway. Failures
   * are deliberately soft: an image that does not upload here is simply left
   * for the final save, so a flaky connection never blocks the session.
   */
  const flushPendingImageUploads = useCallback(async () => {
    const samples = trainingSamplesRef.current;
    const uploaded = uploadedImageUrlsRef.current;

    const pending: { sampleIndex: number; blob: Blob }[] = [];
    for (let i = 0; i < samples.length; i++) {
      if (uploaded.has(i)) continue;
      const blob = samples[i]?.blobForUpload ?? null;
      if (blob) pending.push({ sampleIndex: i, blob });
    }

    if (pending.length === 0) {
      setStepSaveState('saved');
      setStepSaveError(null);
      // Nothing new to upload, but the session row may still be missing
      // samples banked since the last checkpoint (e.g. the grid's very
      // first break, before any patch has run yet).
      void patchSessionProgress();
      return;
    }

    setStepSaveState('saving');
    setStepSaveError(null);

    // Every upload needs proof of ownership — see the same reasoning in
    // completeCalibrationAndStartTracking. Normally already resolved by now
    // (calibration is well underway), so this just returns the cached id.
    const ownerSessionId = sessionIdRef.current ?? (await ensureSessionCreated());
    const sessionOwner: UploadOwner | null = ownerSessionId
      ? { type: 'session', id: ownerSessionId }
      : null;

    const stamp = Date.now();
    const CONCURRENCY = 4;
    let cursor = 0;
    let failures = 0;

    const worker = async (): Promise<void> => {
      while (cursor < pending.length) {
        const { sampleIndex, blob } = pending[cursor++]!;
        if (!sessionOwner) {
          failures++;
          continue;
        }
        try {
          const url = await uploadApi.uploadBlob(
            blob,
            `calibration-sample-${stamp}-${sampleIndex}.jpg`,
            'image/jpeg',
            sessionOwner
          );
          if (url) uploaded.set(sampleIndex, url);
        } catch (e) {
          failures++;
          console.warn('[Break upload] sample', sampleIndex, e);
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker())
    );

    if (failures > 0) {
      setStepSaveState('error');
      setStepSaveError(
        `${failures} of ${pending.length} images could not be sent yet — they will be saved at the end.`
      );
    } else {
      setStepSaveState('saved');
    }

    // Checkpoint the session row with whatever did upload — including a
    // partial batch. This is what makes the break an actual save, not just
    // an image upload: an abandoned session now has a DB row reflecting
    // everything banked up to this point.
    void patchSessionProgress();
  }, [patchSessionProgress, ensureSessionCreated]);

  const processExerciseData = () => {
    const data = exerciseDataRef.current;
    const blobs = exerciseBlobsRef.current.slice();
    const blinkTimes = exerciseBlinkTimesRef.current.slice();
    exerciseDataRef.current = [];
    exerciseBlobsRef.current = [];
    exerciseBlinkTimesRef.current = [];
    exerciseActiveRef.current = false;

    const kindName = EXERCISE_KINDS[currentExerciseIndex] || 'unknown';

    // Zooming a dot on a flat screen changes neither vergence nor accommodation —
    // the screen stays where it is — so forward/backward only adds copies of the
    // center dot. It is still shown, but not trained on.
    if (kindName === 'forward_backward') {
      console.log('[Exercise:forward_backward] not used for training (no new gaze positions)');
      advanceExercise();
      return;
    }

    if (data.length < 10) {
      console.warn(`[Exercise] Insufficient data (${data.length} frames), skipping`);
      return;
    }

    // Endpoint pauses become static dots; moving segments become latency-
    // compensated pursuit bins (lib/fixationSampling.buildExerciseSamples). The
    // count stays small per exercise so the grid is not outweighed.
    const frames: ExerciseFrame[] = data.map((d) => ({ t: d.t, targetX: d.screenX, targetY: d.screenY, f: d.rawEyeFeatures }));
    const { samples, lagMs, lagEstimated } = buildExerciseSamples(frames, blinkTimes, fixationNoiseRef.current);
    const patternLabel = getPatternDisplayName(kindName as EyeMovementKind);

    for (const s of samples) {
      const blobForUpload = blobs[Math.floor(s.frameIndex / 5)];
      trainingSamplesRef.current.push({
        screenX: s.screenX,
        screenY: s.screenY,
        features: eyeTrackingService.prepareFeatureVector(s.center, configRef.current),
        timestamp: Date.now(),
        head: data[s.frameIndex]?.head,
        patternName: patternLabel,
        rawEyeFeatures: s.center,
        quality: {
          method: s.kind,
          nFrames: s.nFrames,
          spanMs: Math.round(s.spanMs),
          dispersion: s.dispersion,
          ...(s.kind === 'pursuit' && { lagMs }),
        },
        ...(blobForUpload && { blobForUpload }),
      });
    }

    const pauses = samples.filter((s) => s.kind === 'pause').length;
    console.log(`[Exercise:${kindName}] ${pauses} pause + ${samples.length - pauses} pursuit samples from ${data.length} frames (lag ${lagMs} ms${lagEstimated ? '' : ', default'})`);
    setTrainingData([...trainingSamplesRef.current]);
  };

  const advanceExercise = () => {
    const nextIndex = currentExerciseIndex + 1;
    if (nextIndex < EXERCISE_KINDS.length) {
      setCurrentExerciseIndex(nextIndex);
      exerciseDataRef.current = [];
      exerciseBlobsRef.current = [];
      exerciseSampleStartRef.current = trainingSamplesRef.current.length;
      exerciseBlinkTimesRef.current = [];
      exerciseKindRef.current = EXERCISE_KINDS[nextIndex];
      exerciseActiveRef.current = true;
      testSegmentStartTimeRef.current = performance.now();
      currentTestSegmentRef.current = [];
    } else {
      if (runModeRef.current === 'test') {
        completeCalibrationAndStartTracking([], testTrajectoryRef.current);
      } else {
        trainAndValidate();
      }
    }
  };

  const trainAndValidate = () => {
    const data = trainingSamplesRef.current;
    if (data.length < 5) {
      alert("Insufficient data points. Please restart calibration.");
      reset();
      return;
    }

    const X = data.map(d => d.features);
    const Y = data.map(d => [d.screenX, d.screenY]);

    const cfg = configRef.current;
    const glassesActive = !!(demographicsRef.current?.wearsGlasses && cfg.glassesOptimization);
    const sampleWeights = glassesActive
      ? data.map(d => {
          const ear = d.rawEyeFeatures ? (d.rawEyeFeatures.leftEAR + d.rawEyeFeatures.rightEAR) / 2 : 0.25;
          return ear < cfg.glassesEarThreshold ? 0.1 : Math.min(1, (ear - cfg.glassesEarThreshold) / 0.15);
        })
      : undefined;

    const success = hybridRegressorRef.current.train(X, Y, sampleWeights);
    if (!success) {
      alert("Calibration failed (Math error). Please try again.");
      reset();
      return;
    }
    setGazeModelReady(true);

    console.log(`[Calibration] Trained regressor with ${data.length} total samples (grid + exercises)`);

    setCalibPhase(CalibrationPhase.VALIDATION);
    setCalibPoints(shuffled(VALIDATION_POINTS));
    setCurrentCalibIndex(0);
    validationErrorsRef.current = [];
    validationErrorByIdRef.current.clear();
  };

  /**
   * An exercise has finished. Bank its data, start uploading it, and hand the
   * participant a break — the next exercise begins only when they say so.
   *
   * The data is processed here rather than on Continue so the upload has the
   * whole break to run. Redo discards it again by truncating back to
   * exerciseSampleStartRef.
   */
  const handleExerciseComplete = useCallback(() => {
    testTrajectoryRef.current.push({
        patternName: getPatternDisplayName(exerciseKindRef.current),
        points: [...currentTestSegmentRef.current],
    });
    if (runModeRef.current !== 'test') {
        processExerciseData();
        void flushPendingImageUploads();
    }
    setAssessmentPending({ type: 'exercise', kind: exerciseKindRef.current, index: currentExerciseIndex });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentExerciseIndex, flushPendingImageUploads]);

  const finishCurrentPhase = () => {
    if (calibPhase === CalibrationPhase.INITIAL_MAPPING) {
        // Break after the calibration grid: rest the eyes, upload the grid
        // captures, and let the participant start the exercises when ready.
        if (!assessmentPending) {
            setAssessmentPending({ type: 'grid' });
            void flushPendingImageUploads();
            return;
        }

        setLoadingMsg('Finalizing gaze data and training model...');
        setStatus('LOADING_MODEL');

        const data = trainingSamplesRef.current;
        if (data.length < 5) {
            alert("Insufficient data points. Please restart calibration.");
            reset();
            return;
        }

        const X = data.map(d => d.features);
        const Y = data.map(d => [d.screenX, d.screenY]);

        const cfgFin = configRef.current;
        const glassesActiveFin = !!(demographicsRef.current?.wearsGlasses && cfgFin.glassesOptimization);
        const sampleWeightsFin = glassesActiveFin
          ? data.map(d => {
              const ear = d.rawEyeFeatures ? (d.rawEyeFeatures.leftEAR + d.rawEyeFeatures.rightEAR) / 2 : 0.25;
              return ear < cfgFin.glassesEarThreshold ? 0.1 : Math.min(1, (ear - cfgFin.glassesEarThreshold) / 0.15);
            })
          : undefined;

        const success = hybridRegressorRef.current.train(X, Y, sampleWeightsFin);
        if (!success) {
            alert("Calibration failed (Math error). Please try again.");
            reset();
            return;
        }

        // --- Phase 2: LOOCV Overfitting Detection ---
        const cvHybrid = hybridRegressorRef.current.lastMeanCVErrorHybrid;
        const cvRidge = hybridRegressorRef.current.lastMeanCVErrorRidge;
        setLoocvErrors({ ridge: cvRidge, hybrid: cvHybrid });
        // Freeze baseline on first train so we can compare flag improvements later
        setLoocvBaseline(prev => prev ?? { ridge: cvRidge, hybrid: cvHybrid });
        console.log(`[Calibration] Hybrid CV: ${cvHybrid.toFixed(1)}, Ridge CV: ${cvRidge.toFixed(1)}`);
        
        setGazeModelReady(true);

        // Test mode: skip EXERCISES + VALIDATION, save session and go to Tracking after first phase
        if (CALIBRATION_TEST_MODE) {
            completeCalibrationAndStartTracking([]);
            return;
        }

        // Option 2 ('test' mode) and quick mode: skip Eye Movement Exercises
        // (wiggling / horizontal / …), go directly to Validation. Quick mode keeps
        // validation so the offline export still has held-out dots for the accuracy A/B.
        if (configRef.current.enableExercises && runModeRef.current !== 'test' && !NEURO_QUICK_MODE) {
            console.log(`[Calibration] Grid mapping done with ${data.length} samples, starting exercises...`);
            setStatus('CALIBRATION');
            setCalibPhase(CalibrationPhase.EXERCISES);
            setCurrentExerciseIndex(0);
      exerciseDataRef.current = [];
      exerciseBlobsRef.current = [];
      exerciseSampleStartRef.current = trainingSamplesRef.current.length;
      exerciseBlinkTimesRef.current = [];
      exerciseKindRef.current = EXERCISE_KINDS[0];
      exerciseActiveRef.current = true;
      currentTestSegmentRef.current = [];
      testSegmentStartTimeRef.current = performance.now();
        } else {
            setStatus('CALIBRATION');
            setCalibPhase(CalibrationPhase.VALIDATION);
            setCalibPoints(shuffled(VALIDATION_POINTS));
            setCurrentCalibIndex(0);
            validationErrorsRef.current = [];
            validationErrorByIdRef.current.clear();
        }
    }
    else if (calibPhase === CalibrationPhase.VALIDATION) {
        validationErrorsRef.current = [...validationErrorByIdRef.current.values()];
        completeCalibrationAndStartTracking(validationErrorsRef.current, testTrajectoryRef.current);
    }
  };

  // --- BACKGROUND CALIBRATION SAVE ---
  // Uploading the video/images and writing the final session record used to
  // block the transition into the neuro flow. On a real participant's
  // connection that PATCH alone measured several seconds (see the earlier
  // payload-size/latency investigation) — time spent staring at "Saving
  // samples" for no reason: the session row already exists
  // (ensureSessionCreated ran right after demographics) and the gaze model
  // is already trained in memory, so nothing the neuro flow itself needs
  // depends on this finishing. completeCalibrationAndStartTracking now moves
  // on as soon as it has a session id, and everything below runs in the
  // background, reporting through sessionSaveStatus/sessionSaveError — shown
  // as a small non-blocking badge during the neuro flow (CalibrationSaveBadge
  // in AppMainOverlays) instead of a screen that blocks the participant.

  type CalibrationUploadParams = {
    videoBlob: Blob | null;
    offlineGazeReport: OfflineGazeProcessResponse | null;
    errors: number[];
    avgError: number;
    testTrajectories?: { patternName: string; points: { t: number; targetX: number; targetY: number; gazeX: number; gazeY: number }[] }[];
    deviceInfo: Record<string, unknown>;
    sessionOwner: UploadOwner | null;
    timestamp: number;
  };

  /** What's left once media is uploaded — small enough to retry on its own without re-sending video/images. */
  const pendingFinalSaveRef = useRef<{
    payload: CreateSessionPayload;
    counts: { samples: number; images: number };
  } | null>(null);
  /** Original params, kept so a retry can redo the upload too, if that (not just the write) is what actually failed. */
  const backgroundSaveParamsRef = useRef<CalibrationUploadParams | null>(null);

  /**
   * Write pendingFinalSaveRef's payload, retrying automatically twice.
   * `mode: 'blocking'` additionally loops on a confirm() dialog until it
   * succeeds or the participant gives up — the original behavior, kept for
   * the rare case there is still no session id to move on into. `'background'`
   * gives up quietly after the automatic retries and leaves the failure
   * visible in sessionSaveStatus/sessionSaveError for the badge's Retry button.
   */
  const persistPendingCalibrationSave = useCallback(
    async (mode: 'background' | 'blocking'): Promise<{ id: string } | null> => {
      const pending = pendingFinalSaveRef.current;
      if (!pending) return null;
      setSessionSaveStatus('saving');
      setSessionSaveError(null);

      const attempt = async (): Promise<{ id: string }> => {
        const id = sessionIdRef.current ?? (await ensureSessionCreated());
        return id ? sessionsApi.update(id, pending.payload) : sessionsApi.create(pending.payload);
      };

      const RETRY_DELAYS_MS = [1500, 4000];
      let created: { id: string } | null = null;
      let lastErr: unknown = null;
      for (let i = 0; !created && i <= RETRY_DELAYS_MS.length; i++) {
        try {
          created = await attempt();
        } catch (e) {
          lastErr = e;
          if (i < RETRY_DELAYS_MS.length) {
            if (mode === 'blocking') {
              setLoadingMsg(`Connection trouble — retrying save (${i + 1}/${RETRY_DELAYS_MS.length})…`);
            }
            await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
          }
        }
      }

      if (!created && mode === 'blocking') {
        while (!created) {
          const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
          const savedSoFar = sessionIdRef.current
            ? 'Everything up to the last break is already saved — only this final step failed.'
            : 'Nothing has been saved yet for this session.';
          const tryAgain =
            typeof window !== 'undefined' &&
            window.confirm(`Could not save: ${reason}\n\n${savedSoFar}\n\nCheck the connection and retry?`);
          if (!tryAgain) {
            setSessionSaveStatus('error');
            setSessionSaveError(reason);
            return null;
          }
          try {
            created = await attempt();
          } catch (e) {
            lastErr = e;
          }
        }
      }

      if (!created) {
        const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
        setSessionSaveStatus('error');
        setSessionSaveError(msg);
        return null;
      }

      pendingFinalSaveRef.current = null;
      backgroundSaveParamsRef.current = null;
      setLastSavedCounts(pending.counts);
      setSessionSaveStatus('saved');
      return created;
    },
    [ensureSessionCreated]
  );

  /** Upload the calibration video + images, build the final payload, then persist it. */
  const uploadAndPersistCalibration = useCallback(
    async (params: CalibrationUploadParams, mode: 'background' | 'blocking'): Promise<{ id: string } | null> => {
      const { videoBlob, offlineGazeReport, errors, avgError, testTrajectories, deviceInfo, sessionOwner, timestamp } = params;
      try {
        const samples = trainingSamplesRef.current;
        const imageUploads: { sampleIndex: number; blob: Blob }[] = [];
        for (let i = 0; i < samples.length; i++) {
          if (uploadedImageUrlsRef.current.has(i)) continue;
          const blob = samples[i]?.blobForUpload ?? null;
          if (blob) imageUploads.push({ sampleIndex: i, blob });
        }

        const IMAGE_CONCURRENCY = 6;
        const finishVideoUpload = async (): Promise<string | null> => {
          if (!videoBlob || videoBlob.size === 0) return null;
          const uploader = videoUploaderRef.current;
          videoUploaderRef.current = null;
          if (uploader) {
            const streamedUrl = await uploader.finish();
            if (streamedUrl) return streamedUrl;
            if (mode === 'blocking') setLoadingMsg('Uploading calibration video…');
          }
          if (!sessionOwner) return null;
          return uploadApi.uploadBlob(videoBlob, `calibration-${timestamp}.webm`, 'video/webm', sessionOwner);
        };

        const [videoUrlResult, imageUrlsByOrder] = await Promise.all([
          finishVideoUpload(),
          runWithConcurrency(
            imageUploads,
            IMAGE_CONCURRENCY,
            async ({ blob, sampleIndex }) => {
              if (!sessionOwner) return { sampleIndex, url: null as string | null };
              const url = await uploadApi.uploadBlob(
                blob,
                `calibration-sample-${timestamp}-${sampleIndex}.jpg`,
                'image/jpeg',
                sessionOwner
              );
              return { sampleIndex, url };
            }
          ),
        ]);

        const videoUrl = videoUrlResult ?? undefined;
        const imageUrlByIndex = new Map<number, string>(uploadedImageUrlsRef.current);
        imageUrlsByOrder.forEach(({ sampleIndex, url }) => {
          if (url) imageUrlByIndex.set(sampleIndex, url);
        });

        const { calibrationGazeSamples, calibrationImageUrls } = buildCalibrationSamplesPayload(imageUrlByIndex);
        const sampleCount = calibrationGazeSamples.length;
        const imageCount = calibrationImageUrls.length;
        if (process.env.NODE_ENV === 'development') {
          console.log('[Session save] Sending:', { sampleCount, imageCount, hasVideo: Boolean(videoUrl) });
        }

        const finalPayload: CreateSessionPayload = {
          config: {
            ...(configRef.current as unknown as Record<string, unknown>),
            ...(demographicsRef.current ? { demographics: demographicsRef.current } : {}),
            ...(offlineGazeReport ? {
              offlineGaze: {
                status: 'completed',
                processedAt: new Date().toISOString(),
                backendUrl: offlineBackendUrl(),
                report: offlineGazeReport,
              },
            } : offlineHandlingEnabled() ? {
              offlineGaze: {
                status: 'not_run',
                reason: 'offline handling enabled but no report was produced',
              },
            } : {}),
            ...(testTrajectories && testTrajectories.length > 0 ? { testTrajectories, isTestSession: true } : {}),
            deviceInfo,
            ...(consentRef.current ? { consent: consentRef.current } : {}),
          } as unknown as Record<string, unknown>,
          demographics: demographicsRef.current
            ? { ...demographicsRef.current, age: demographicsRef.current.age === '' ? undefined : demographicsRef.current.age }
            : undefined,
          participantEmail: demographicsRef.current?.email || undefined,
          validationErrors: errors,
          meanErrorPx: errors.length > 0 ? avgError : undefined,
          status: 'completed',
          videoUrl,
          calibrationImageUrls: calibrationImageUrls.length > 0 ? calibrationImageUrls : undefined,
          calibrationGazeSamples,
          // Always built now, not only under ?exportMeta=1 — this is what lets
          // the recorded video be re-aligned to what the participant was
          // looking at if the gaze algorithm is revisited later.
          calibrationMeta: buildOfflineSessionMeta() as unknown as Record<string, unknown>,
        };

        pendingFinalSaveRef.current = { payload: finalPayload, counts: { samples: sampleCount, images: imageCount } };
        return await persistPendingCalibrationSave(mode);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setSessionSaveStatus('error');
        setSessionSaveError(msg);
        if (mode === 'blocking') {
          const savedSoFar = sessionIdRef.current
            ? '\n\nThe good news: everything up to the last break was already saved before this happened — only the video/image upload or final write failed.'
            : '\n\nNothing was saved for this session.';
          alert(`Could not save session: ${msg}${savedSoFar}\n\n• Run "npm run dev" (Next.js) — API runs on same origin, no env needed.\n• On Vercel: do not set NEXT_PUBLIC_API_URL (same domain). Configure S3 bucket CORS: add app domain to AllowedOrigins, AllowedMethods: PUT, GET.\n• Ensure DB and S3 env vars are set correctly on Vercel.`);
        }
        return null;
      }
    },
    [buildCalibrationSamplesPayload, persistPendingCalibrationSave]
  );

  /** Manual retry for the badge shown during the neuro flow while a background save is pending/failed. */
  const retryBackgroundCalibrationSave = useCallback(async () => {
    if (pendingFinalSaveRef.current) {
      await persistPendingCalibrationSave('background');
    } else if (backgroundSaveParamsRef.current) {
      await uploadAndPersistCalibration(backgroundSaveParamsRef.current, 'background');
    }
  }, [persistPendingCalibrationSave, uploadAndPersistCalibration]);

  const completeCalibrationAndStartTracking = (errors: number[], testTrajectories?: { patternName: string; points: { t: number; targetX: number; targetY: number; gazeX: number; gazeY: number }[] }[]) => {
    const avgError = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;
    setAccuracyScore(avgError);
    const isAccuracyGood = avgError < 300;
    setLoadingMsg('Saving samples');
    setStatus('LOADING_MODEL');

    // Captured now, before stopVideoRecordingAndGetBlob() runs below — the
    // camera is still attached to videoRef at this exact point, which is the
    // only reliable moment left to read its real resolution.
    const deviceInfo = buildDeviceInfo();

    (async () => {
      setSessionSaveStatus('saving');
      setSessionSaveError(null);

      try {
        const videoBlob = await stopVideoRecordingAndGetBlob();
        maybeExportOfflineMeta(videoBlob);   // ?exportMeta=1 → local video+meta.json for offline reprocess
        let offlineGazeReport: OfflineGazeProcessResponse | null = null;
        if (offlineHandlingEnabled()) {
          if (!videoBlob || videoBlob.size === 0) {
            throw new Error('Offline handling is enabled, but no calibration video was recorded.');
          }
          const offlineMeta = buildOfflineSessionMeta();
          setLoadingMsg(`Processing gaze offline on ${offlineBackendUrl()}…`);
          console.log('[offline] sending calibration video + metadata to gaze backend', {
            backend: offlineBackendUrl(),
            videoBytes: videoBlob.size,
            calibrationDots: offlineMeta.calibration_dots.length,
            validationDots: offlineMeta.validation_dots.length,
          });
          offlineGazeReport = await processOfflineGaze(videoBlob, offlineMeta);
          const offlineValidation = offlineGazeReport.validation;
          const offlineMsg = offlineValidation
            ? `Offline processing complete: ${offlineValidation.overall_deg.toFixed(2)}° validation error`
            : `Offline processing complete: ${Math.round(offlineGazeReport.calibration_loocv_px)}px LOOCV`;
          setLoadingMsg(offlineMsg);
          console.log('[offline] gaze backend report', offlineGazeReport);
        }

        const timestamp = Date.now();
        // Same session id the streaming uploader was validated against (or,
        // in the rare case that hadn't resolved yet at recording start, the
        // first chance to get one) — every upload below needs it as proof of
        // ownership, and it is also what tells us whether we can move on
        // into the neuro flow right now (fast path) or have to wait for one
        // to exist first (slow path — see below).
        const ownerSessionId = sessionIdRef.current ?? (await ensureSessionCreated());
        const sessionOwner: UploadOwner | null = ownerSessionId
          ? { type: 'session', id: ownerSessionId }
          : null;

        const statusMsg = isAccuracyGood
          ? `Calibration Success! Mean Error: ${Math.round(avgError)}px`
          : errors.length > 0 ? `Calibration Complete (Accuracy: ${Math.round(avgError)}px)` : 'Calibration complete (test mode)';

        const uploadParams: CalibrationUploadParams = {
          videoBlob, offlineGazeReport, errors, avgError, testTrajectories, deviceInfo, sessionOwner, timestamp,
        };

        if (ownerSessionId) {
          // FAST PATH — the session row already exists and the gaze model is
          // already trained in memory, so nothing about starting the neuro
          // flow depends on the upload below finishing. Move on now; the
          // upload + final write keep going in the background (see
          // uploadAndPersistCalibration above).
          setLoadingMsg(statusMsg);
          backgroundSaveParamsRef.current = uploadParams;
          setTimeout(() => {
            pathSyncSourceRef.current = 'internal';
            setCreatedSessionId(ownerSessionId);
            handleChooseNeurological(ownerSessionId);
          }, 600);
          void uploadAndPersistCalibration(uploadParams, 'background');
          return;
        }

        // SLOW PATH — no session id anywhere yet (the early create right
        // after demographics never landed, and retrying it here also
        // failed). There is nothing to move on into without one, so this
        // stays fully blocking: wait for the upload, retry the final write
        // with a confirm() if it keeps failing, and only then transition —
        // the original behavior, for what should be a rare case.
        const created = await uploadAndPersistCalibration(uploadParams, 'blocking');
        if (!created) return; // already alerted / confirm()-declined inside
        setLoadingMsg(statusMsg);
        setTimeout(() => {
          pathSyncSourceRef.current = 'internal';
          setCreatedSessionId(created.id);
          handleChooseNeurological(created.id);
        }, 1200);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setSessionSaveStatus('error');
        setSessionSaveError(msg);
        console.warn('[Session save]', e);
        const savedSoFar = sessionIdRef.current
          ? '\n\nThe good news: everything up to the last break was already saved before this happened — only the video/image upload or final write failed.'
          : '\n\nNothing was saved for this session.';
        alert(`Could not save session: ${msg}${savedSoFar}\n\n• Run "npm run dev" (Next.js) — API runs on same origin, no env needed.\n• On Vercel: do not set NEXT_PUBLIC_API_URL (same domain). Configure S3 bucket CORS: add app domain to AllowedOrigins, AllowedMethods: PUT, GET.\n• Ensure DB and S3 env vars are set correctly on Vercel.`);
      }
    })();
  };
 
  const reset = useCallback(() => {
    stopCamera();
    stopVideoRecording();
    setStatus('IDLE');
    setCreatedSessionId(null);
    setNeuroPhase('pre');
    setPreSymptomScores(null);
    setCurrentNeuroTestId(null);
    setNeuroTestResults({});
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(NEURO_LAST_RUN_ID_SS_KEY);
      }
    } catch (_) {}
    demographicsRef.current = null;
    setTrainingData([]);
    trainingSamplesRef.current = [];
    uploadedImageUrlsRef.current.clear();
    setStepSaveState('idle');
    setStepSaveError(null);
    // A fresh run gets a fresh session row — the next handleDemographicsSubmit
    // creates it again from scratch.
    sessionIdRef.current = null;
    sessionCreatePromiseRef.current = null;
    sessionPatchChainRef.current = Promise.resolve();
    trackingHistoryRef.current = [];
    hybridRegressorRef.current = new HybridRegressor();
    setGazeModelReady(false);
    setLoocvErrors(null);
    setLoocvBaseline(null);
    neuroLiveGazeRef.current = { x: 0, y: 0 };
    setShowHeatmap(false);
    setCurrentExerciseIndex(0);
    exerciseDataRef.current = [];
    exerciseBlobsRef.current = [];
    exerciseActiveRef.current = false;
    exerciseTargetRef.current = null;
    exerciseBlinkTimesRef.current = [];
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      document.exitFullscreen();
    }
  }, [stopVideoRecording]);


  const startRealTimeTracking = useCallback(() => {
    if (process.env.NODE_ENV === 'development') console.log('[App] startRealTimeTracking: resetting and going to HOME');
    reset();
    router.push('/');
  }, [reset, router]);

  const {
    isSaving: isSavingNeuroTest,
    testSaveState: neuroTestSaveState,
    handleNeuroTestResultReady,
    handleNeuroTestComplete,
    handleNeuroPreSubmit,
    handleNeuroPostSubmit,
  } = useNeuroFlowHandlers({
    neuroRunId,
    neuroTestOrder,
    neuroConfigSnapshot,
    currentNeuroTestIndex,
    neuroTestResults,
    NEURO_TEST_PROGRESS_LS_KEY,
    setNeuroTestResults,
    setCurrentNeuroTestIndex,
    setCurrentNeuroTestId,
    setNeuroPhase,
    setPreSymptomScores,
    setPostSymptomScores,
    pathSyncSourceRef,
    routerPush,
    setStatus,
    setLoadingMsg,
  });

  /** Sau màn /neuro/done?verify=1 — tiếp tục bài tiếp hoặc post-test (meta trong sessionStorage). */
  const handleNeuroVerifyContinue = useCallback(() => {
    try {
      const raw = sessionStorage.getItem(NEURO_VERIFY_META_KEY);
      try {
        sessionStorage.removeItem(NEURO_VERIFY_SNAPSHOT_KEY);
        sessionStorage.removeItem(NEURO_VERIFY_META_KEY);
      } catch (_) {}
      if (!raw) {
        pathSyncSourceRef.current = 'internal';
        if (typeof window !== 'undefined') window.history.replaceState(null, '', PATHS.NEURO_DONE);
        return;
      }
      const meta = JSON.parse(raw) as { nextIdx: number; order: string[]; goToPost?: boolean };
      const order =
        Array.isArray(meta.order) && meta.order.length > 0 ? meta.order : neuroTestOrder.length > 0 ? neuroTestOrder : [...DEFAULT_NEURO_TEST_ORDER];
      if (meta.goToPost === true || meta.nextIdx < 0) {
        setNeuroPhase('post');
        setCurrentNeuroTestId(null);
        pathSyncSourceRef.current = 'internal';
        if (typeof window !== 'undefined') window.history.replaceState(null, '', PATHS.NEURO_POST);
        return;
      }
      setNeuroPhase('tests');
      setCurrentNeuroTestIndex(meta.nextIdx);
      setCurrentNeuroTestId(order[meta.nextIdx]);
      pathSyncSourceRef.current = 'internal';
      if (typeof window !== 'undefined') window.history.replaceState(null, '', PATHS.NEURO_TEST(order[meta.nextIdx]));
    } catch (e) {
      neuroPersistWarn('verify continue failed', e);
      pathSyncSourceRef.current = 'internal';
      if (typeof window !== 'undefined') window.history.replaceState(null, '', PATHS.NEURO_DONE);
    }
  }, [router, neuroTestOrder, setNeuroPhase, setCurrentNeuroTestIndex, setCurrentNeuroTestId]);

  const handleChooseNeurological = useCallback(async (sid?: string) => {
    const sessionId = sid || createdSessionId;
    if (!sessionId) {
      console.warn('[App] handleChooseNeurological: no sessionId available');
      return;
    }

    setStatus('NEURO_FLOW');
    statusRef.current = 'NEURO_FLOW';
    setNeuroRunStatus('creating');
    setNeuroPhase('pre');
    setPreSymptomScores(null);
    setPostSymptomScores(null);
    setNeuroTestResults({});
    setCurrentNeuroTestId(null);
    setCurrentNeuroTestIndex(0);
    try {
      localStorage.removeItem(NEURO_TEST_PROGRESS_LS_KEY);
    } catch (_) {}
    try {
      const configSnapshot = await getNeurologicalConfig();
      const source = (configSnapshot as { _source?: string })._source;
      const memParams = configSnapshot?.testParameters?.memory_cards as Record<string, unknown> | undefined;
      console.log('[Neuro] Config source:', source ?? 'unknown', '| memory_cards.cardCount =', memParams?.cardCount, '| Save from Admin first if source=default');
      try {
        localStorage.setItem(NEURO_CONFIG_LS_KEY, JSON.stringify(configSnapshot));
      } catch (_) {}
      const run = await neurologicalRunsApi.create(sessionId, configSnapshot);
      setNeuroRunId(run.id);
      try {
        sessionStorage.setItem(NEURO_LAST_RUN_ID_SS_KEY, run.id);
      } catch (_) {}
      const order = Array.isArray(run.testOrderSnapshot) ? run.testOrderSnapshot : [];
      setNeuroTestOrder(order);
      const snap = run.configSnapshot as { testOrder: string[]; testParameters: Record<string, Record<string, unknown>>; testEnabled: Record<string, boolean> } | undefined;
      console.log('[Neuro] Run created; snapshot memory_cards =', snap?.testParameters?.memory_cards);
      const chosen = configSnapshot as any;
      setNeuroConfigSnapshot({
        testOrder: Array.isArray(chosen.testOrder) ? chosen.testOrder : order,
        testParameters: (chosen.testParameters as Record<string, Record<string, unknown>>) ?? {},
        testEnabled: (chosen.testEnabled as Record<string, boolean>) ?? {},
      });
      setNeuroRunStatus('ready');
      pathSyncSourceRef.current = 'internal';

      // Pre-questionnaire already done before calibration (or skipped)?
      const skipQ = process.env.NEXT_PUBLIC_SKIP_NEURO_QUESTIONNAIRE === 'true';
      const preAlreadyDone = Boolean(preSymptomScores);

      if (skipQ || preAlreadyDone) {
        // Patch pre scores if they exist
        if (preAlreadyDone && preSymptomScores) {
          const questionnaire = {
            variant: 'pre' as const,
            submittedAt: new Date().toISOString(),
            scores: preSymptomScores,
            questions: SYMPTOM_QUESTIONS.map((q) => ({
              id: q.id,
              category: q.category,
              question: q.question,
              score: preSymptomScores[q.id] ?? null,
            })),
          };
          try {
            await neurologicalRunsApi.patch(run.id, { preSymptomScores: questionnaire as unknown as Record<string, number> });
          } catch (e) {
            console.error('Patch pre scores failed', e);
          }
        }
        // Go straight to first test
        const enabled = (configSnapshot as any)?.testEnabled as Record<string, boolean> | undefined ?? {};
        let firstIdx = 0;
        for (let i = 0; i < order.length; i++) {
          if (enabled[order[i]] !== false) { firstIdx = i; break; }
        }
        setNeuroPhase('tests');
        setCurrentNeuroTestId(order[firstIdx] || null);
        setCurrentNeuroTestIndex(firstIdx);
        if (typeof window !== 'undefined') window.history.pushState(null, '', PATHS.NEURO_TEST(order[firstIdx]));
      } else {
        if (typeof window !== 'undefined') window.history.pushState(null, '', PATHS.NEURO_PRE);
      }
    } catch (e) {
      console.error('Create neuro run failed', e);
      setNeuroRunStatus('error');
    }
  }, [NEURO_CONFIG_LS_KEY, NEURO_TEST_PROGRESS_LS_KEY, createdSessionId, preSymptomScores, router]);

  /** Progress LS stores merged testResults during the run — use if React state is empty at final save. */
  const readNeuroTestResultsFromProgressLs = useCallback((): Record<string, TestResultPayload> | null => {
    try {
      const raw = localStorage.getItem(NEURO_TEST_PROGRESS_LS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as { testResults?: Record<string, TestResultPayload> };
      if (p.testResults && typeof p.testResults === 'object' && Object.keys(p.testResults).length > 0) {
        return p.testResults;
      }
    } catch (_) {}
    return null;
  }, [NEURO_TEST_PROGRESS_LS_KEY]);

  /** sessionStorage trước, rồi runId trong neuro_test_progress — để PATCH không bị bỏ qua sau refresh / điều hướng. */
  const resolveNeuroRunIdFromStorage = useCallback((): string | null => {
    try {
      const ss = sessionStorage.getItem(NEURO_LAST_RUN_ID_SS_KEY);
      if (ss) return ss;
    } catch (_) {}
    try {
      const raw = localStorage.getItem(NEURO_TEST_PROGRESS_LS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as { runId?: string | null };
      if (typeof p.runId === 'string' && p.runId.length > 0) return p.runId;
    } catch (_) {}
    return null;
  }, [NEURO_LAST_RUN_ID_SS_KEY, NEURO_TEST_PROGRESS_LS_KEY]);

  /** Khôi phục run id trên mọi màn neuro (refresh giữa flow thường làm mất state). */
  useEffect(() => {
    const parsed = parsePathname(typeof pathname === 'string' ? pathname : '/');
    const isNeuroScreen =
      parsed.screen === 'neuro_pre' ||
      parsed.screen === 'neuro_test' ||
      parsed.screen === 'neuro_post' ||
      parsed.screen === 'neuro_done';
    if (!isNeuroScreen) return;
    if (neuroRunId) return;
    if (typeof window !== 'undefined' && neuroDevPreviewEnabled()) {
      try {
        const q = new URLSearchParams(window.location.search);
        if (q.get('preview') === '1') return;
      } catch (_) {}
    }
    const id = resolveNeuroRunIdFromStorage();
    if (id) {
      setNeuroRunId(id);
      try {
        sessionStorage.setItem(NEURO_LAST_RUN_ID_SS_KEY, id);
      } catch (_) {}
    }
  }, [pathname, neuroRunId, resolveNeuroRunIdFromStorage]);

  /** Dev only: /neuro/done?preview=1 — mock data, skip DB (needs NEXT_PUBLIC_NEURO_DEV_PREVIEW=1). */
  useEffect(() => {
    if (typeof window === 'undefined' || !neuroDevPreviewEnabled()) return;
    if (searchParams.get('preview') !== '1') return;
    const parsed = parsePathname(typeof pathname === 'string' ? pathname : '/');
    if (parsed.screen !== 'neuro_done') return;
    neuroDebugLog('dev preview (?preview=1): mock only, no DB fetch');
    setStatus('NEURO_FLOW');
    statusRef.current = 'NEURO_FLOW';
    setNeuroRunStatus('ready');
    setNeuroPhase('done');
    setNeuroRunId(NEURO_PREVIEW_RUN_ID);
    setNeuroTestOrder([...DEFAULT_NEURO_TEST_ORDER]);
    setNeuroTestResults(getNeuroResultsPreviewMock());
    setNeuroResultsLoading(false);
    setNeuroResultsLoadError(null);
  }, [pathname, searchParams]);

  /** Done screen: load test results from DB (source of truth for UI). */
  useLayoutEffect(() => {
    if (neuroPhase !== 'done') {
      setNeuroResultsLoading(false);
      setNeuroResultsLoadError(null);
      return;
    }
    if (searchParams.get('verify') === '1' && typeof window !== 'undefined') {
      try {
        const snap = sessionStorage.getItem(NEURO_VERIFY_SNAPSHOT_KEY);
        if (snap) {
          const parsed = JSON.parse(snap) as Record<string, TestResultPayload>;
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            setNeuroTestResults(parsed);
            setNeuroResultsLoading(false);
            setNeuroResultsLoadError(null);
            neuroDebugLog('verify: snapshot → state', Object.keys(parsed));
            return;
          }
        }
      } catch (e) {
        neuroPersistWarn('verify: snapshot failed', e);
      }
    }
    if (!neuroRunId) {
      const resolved = resolveNeuroRunIdFromStorage();
      if (resolved) {
        neuroDebugLog('done screen: recovered runId from storage → will GET', resolved);
        setNeuroRunId(resolved);
        return;
      }
      setNeuroResultsLoading(false);
      const fromLsNoId = readNeuroTestResultsFromProgressLs();
      if (fromLsNoId && Object.keys(fromLsNoId).length > 0) {
        neuroPersistWarn('done screen: no run id — showing temporary data from localStorage (not synced to DB)', {
          keys: Object.keys(fromLsNoId),
        });
        setNeuroTestResults(fromLsNoId);
      } else {
        neuroPersistWarn('done screen: no run id and no neuro_test_progress_v1 — cannot load results');
      }
      return;
    }
    if (neuroRunId === NEURO_PREVIEW_RUN_ID) {
      setNeuroResultsLoading(false);
      setNeuroResultsLoadError(null);
      neuroDebugLog('skip DB fetch (preview run id)');
      return;
    }
    let cancelled = false;
    setNeuroResultsLoading(true);
    setNeuroResultsLoadError(null);
    neuroDebugLog('fetch run from DB', neuroRunId);
    (async () => {
      try {
        const run = await neurologicalRunsApi.get(neuroRunId);
        if (cancelled) return;
        const raw = run.testResults;
        const tr: Record<string, TestResultPayload> =
          raw && typeof raw === 'object' && !Array.isArray(raw)
            ? (raw as Record<string, TestResultPayload>)
            : {};
        neuroDebugLog('GET run testResults keys', Object.keys(tr));
        if (Object.keys(tr).length > 0) {
          setNeuroTestResults(tr);
        } else {
          const fromLs = readNeuroTestResultsFromProgressLs();
          if (fromLs && Object.keys(fromLs).length > 0) {
            neuroDebugLog('GET run testResults empty — using local progress fallback');
            setNeuroTestResults(fromLs);
            try {
              await neurologicalRunsApi.patch(neuroRunId, { testResults: fromLs });
              neuroDebugLog('GET empty DB — synced LS fallback to DB ok', { runId: neuroRunId });
            } catch (syncErr) {
              neuroPersistWarn('GET empty DB — could not sync localStorage fallback to DB', syncErr);
            }
          } else if (neuroDevPreviewEnabled()) {
            neuroDebugLog(
              'DB testResults empty — showing dev mock. Tip: use /neuro/done?preview=1 to skip DB entirely.'
            );
            setNeuroTestResults(getNeuroResultsPreviewMock());
          } else {
            setNeuroTestResults({});
          }
        }
      } catch (e) {
        neuroPersistWarn('GET neurological run failed', e);
        neuroDebugLog('GET run failed (detail)', e);
        if (!cancelled) {
          const fromLs = readNeuroTestResultsFromProgressLs();
          if (fromLs && Object.keys(fromLs).length > 0) {
            neuroDebugLog('GET failed — showing local progress fallback', Object.keys(fromLs));
            setNeuroTestResults(fromLs);
            setNeuroResultsLoadError(null);
          } else {
            setNeuroResultsLoadError(e instanceof Error ? e.message : 'Failed to load results');
          }
        }
      } finally {
        if (!cancelled) setNeuroResultsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    neuroPhase,
    neuroRunId,
    neuroResultsFetchKey,
    readNeuroTestResultsFromProgressLs,
    resolveNeuroRunIdFromStorage,
    searchParams,
  ]);

  const handlePostSubmitRequested = useCallback(async (scores: SymptomScores) => {
    setPendingPostSymptomScores(scores);
    setShowPostSubmitConfirm(true);
  }, []);

  const buildQuestionnairePayload = useCallback((variant: 'pre' | 'post', scores: SymptomScores) => {
    return {
      variant,
      submittedAt: new Date().toISOString(),
      scores,
      questions: SYMPTOM_QUESTIONS.map((q) => ({
        id: q.id,
        category: q.category,
        question: q.question,
        score: scores[q.id] ?? null,
      })),
    };
  }, []);

  const handlePostSubmitSave = useCallback(async () => {
    if (!pendingPostSymptomScores) return;
    const preQuestionnaire = preSymptomScores ? buildQuestionnairePayload('pre', preSymptomScores) : null;
    const postQuestionnaire = buildQuestionnairePayload('post', pendingPostSymptomScores);

    try {
      localStorage.setItem('neuro_post_questionnaire_v1', JSON.stringify(postQuestionnaire));
      if (preQuestionnaire) {
        localStorage.setItem('neuro_pre_questionnaire_v1', JSON.stringify(preQuestionnaire));
      }
    } catch (_) {}

    setPostSymptomScores(pendingPostSymptomScores);

    const mergedResults =
      Object.keys(neuroTestResults).length > 0
        ? neuroTestResults
        : readNeuroTestResultsFromProgressLs() ?? neuroTestResults;
    neuroDebugLog('post-save: keys in memory/LS merge', Object.keys(mergedResults));
    if (Object.keys(mergedResults).length > 0) {
      setNeuroTestResults(mergedResults);
    }

    const runIdForSave = neuroRunId ?? resolveNeuroRunIdFromStorage();
    if (runIdForSave && !neuroRunId) {
      neuroDebugLog('post-save: recovered runId from storage', runIdForSave);
      setNeuroRunId(runIdForSave);
      try {
        sessionStorage.setItem(NEURO_LAST_RUN_ID_SS_KEY, runIdForSave);
      } catch (_) {}
    }

    if (runIdForSave) {
      neuroDebugLog('post-save: PATCH start', {
        runId: runIdForSave,
        testResultKeys: Object.keys(mergedResults),
        testResultCount: Object.keys(mergedResults).length,
      });
      try {
        setLoadingMsg('Saving final results...');
        setStatus('LOADING_MODEL');
        const updated = await neurologicalRunsApi.patch(runIdForSave, {
          preSymptomScores: (preQuestionnaire ?? preSymptomScores ?? {}) as unknown as Record<string, number>,
          postSymptomScores: postQuestionnaire as unknown as Record<string, number>,
          testResults: mergedResults,
          status: 'completed',
        });
        neuroDebugLog(
          'post-save: PATCH returned testResults keys',
          updated.testResults ? Object.keys(updated.testResults as object) : []
        );
        if (updated.testResults && Object.keys(updated.testResults as object).length > 0) {
          setNeuroTestResults(updated.testResults as Record<string, TestResultPayload>);
        }
      } catch (e) {
        neuroPersistWarn('post-save: PATCH failed — could not write to DB', e);
        alert(
          'Could not save results to the server (network or server error). Check your connection and tap Save results again. (See console [Neuro])'
        );
        return;
      }
    } else {
      neuroPersistWarn('post-save: no run id — skipping PATCH; local data only if present in LS', {
        mergedKeys: Object.keys(mergedResults),
      });
    }
    // Stop camera now that the run is saved — the OS indicator should turn off.
    stopCamera();
    routerPush(`/results/${neuroRunId}`);
    setShowPostSubmitConfirm(false);
    setPendingPostSymptomScores(null);
  }, [
    pendingPostSymptomScores,
    preSymptomScores,
    neuroRunId,
    neuroTestResults,
    readNeuroTestResultsFromProgressLs,
    resolveNeuroRunIdFromStorage,
    buildQuestionnairePayload,
    stopCamera,
    routerPush,
    router,
  ]);

  const handlePostSubmitRedoTests = useCallback(() => {
    const order = neuroTestOrder.length > 0 ? neuroTestOrder : [...DEFAULT_TEST_ORDER];
    const enabled = neuroConfigSnapshot?.testEnabled ?? {};
    let idx = -1;
    for (let i = 0; i < order.length; i++) {
      if (enabled[order[i]] !== false) {
        idx = i;
        break;
      }
    }
    setShowPostSubmitConfirm(false);
    setPendingPostSymptomScores(null);
    setPostSymptomScores(null);
    setNeuroTestResults({});
    try {
      localStorage.removeItem(NEURO_TEST_PROGRESS_LS_KEY);
    } catch (_) {}
    if (idx < 0) {
      setNeuroPhase('post');
      setCurrentNeuroTestId(null);
      pathSyncSourceRef.current = 'internal';
      if (typeof window !== 'undefined') window.history.pushState(null, '', PATHS.NEURO_POST);
      return;
    }
    setNeuroPhase('tests');
    setCurrentNeuroTestIndex(idx);
    setCurrentNeuroTestId(order[idx]);
    pathSyncSourceRef.current = 'internal';
    if (typeof window !== 'undefined') window.history.pushState(null, '', PATHS.NEURO_TEST(order[idx]));
  }, [neuroTestOrder, neuroConfigSnapshot?.testEnabled, NEURO_TEST_PROGRESS_LS_KEY, router]);

  const predictGaze = (features: EyeFeatures, timestamp: number) => {
    // Both gates drop the frame and hold the last output — they never delay one,
    // so saccade latency / velocity in the neuro tests are unaffected.
    // A partial blink drags the iris landmark down without crossing the blink threshold.
    const pose = features.matrixHeadPose ?? features.headPose;
    if (partialBlinkGateRef.current.isPartialBlink(features, timestamp)) {
      recordGazeFrame(GazeFrameQuality.PARTIAL_BLINK, undefined, pose);
      return;
    }

    const inputVector = eyeTrackingService.prepareFeatureVector(features, configRef.current);

    // Pass the configured method to the regressor
    const prediction = hybridRegressorRef.current.predict(inputVector, configRef.current.regressionMethod);

    // Far outside the screen the mapping is extrapolating, not measuring gaze.
    if (!isPlausibleGaze(prediction.x, prediction.y, window.innerWidth, window.innerHeight)) {
      recordGazeFrame(GazeFrameQuality.IMPLAUSIBLE, undefined, pose);
      return;
    }

    // Compute frame quality for glasses mode: average EAR as proxy for glare/blink artifacts
    const cfg = configRef.current;
    let frameQuality: number | undefined;
    if (demographicsRef.current?.wearsGlasses && cfg.glassesOptimization) {
      const ear = (features.leftEAR + features.rightEAR) / 2;
      // EAR < threshold → artifact (glare/blink); scale 0–1 above threshold
      const earQuality = ear < cfg.glassesEarThreshold ? 0 : Math.min(1, (ear - cfg.glassesEarThreshold) / 0.15);
      frameQuality = earQuality;
    }

    const smoothed = smootherRef.current.process(prediction.x, prediction.y, timestamp, frameQuality);
    if (Math.random() < 0.05) { // throttle log
      console.log(`[NeuroGaze] inputVector len=${inputVector.length}, method=${configRef.current.regressionMethod}, pred=`, prediction, ` smoothed=`, smoothed, ` hasModel=`, hybridRegressorRef.current.hasTrainedModel());
    }
    neuroLiveGazeRef.current = { x: smoothed.x, y: smoothed.y };
    recordGazeFrame(GazeFrameQuality.OK, { x: prediction.x, y: prediction.y, sx: smoothed.x, sy: smoothed.y }, pose);
    setGazePos(smoothed);

    if (statusRef.current === 'TRACKING') {
      trackingHistoryRef.current.push({
        timestamp: Date.now(),
        x: Math.round(smoothed.x),
        y: Math.round(smoothed.y)
      });
    }
  };

  /**
   * Re-extract feature vectors from stored rawEyeFeatures using current AppConfig flags,
   * then re-train the regressor and recompute LOOCV — without requiring re-calibration.
   *
   * Only samples that have rawEyeFeatures stored (grid calibration points) are used.
   * Updates the live regressor so predictions immediately reflect the new flags.
   */
  const reEvaluateWithCurrentFlags = useCallback(() => {
    const samples = trainingSamplesRef.current.filter(s => !!s.rawEyeFeatures);
    if (samples.length < 5) {
      console.warn('[reEvaluate] Not enough samples with rawEyeFeatures (need ≥5, have', samples.length, ')');
      return;
    }

    const newX = samples.map(s => eyeTrackingService.prepareFeatureVector(s.rawEyeFeatures!, configRef.current));
    const Y    = samples.map(s => [s.screenX, s.screenY]);

    const cfgRe = configRef.current;
    const glassesActiveRe = !!(demographicsRef.current?.wearsGlasses && cfgRe.glassesOptimization);
    const weightsRe = glassesActiveRe
      ? samples.map(s => {
          const ear = s.rawEyeFeatures ? (s.rawEyeFeatures.leftEAR + s.rawEyeFeatures.rightEAR) / 2 : 0.25;
          return ear < cfgRe.glassesEarThreshold ? 0.1 : Math.min(1, (ear - cfgRe.glassesEarThreshold) / 0.15);
        })
      : undefined;

    const tempRegressor = new HybridRegressor();
    const success = tempRegressor.train(newX, Y, weightsRe);
    if (!success) {
      console.warn('[reEvaluate] Training failed (singular matrix). Try a different flag combination.');
      return;
    }

    const newRidge  = tempRegressor.lastMeanCVErrorRidge;
    const newHybrid = tempRegressor.lastMeanCVErrorHybrid;
    console.log(`[reEvaluate] LOOCV → Ridge: ${newRidge.toFixed(1)}px | Hybrid: ${newHybrid.toFixed(1)}px (${samples.length} grid samples)`);

    setLoocvErrors({ ridge: newRidge, hybrid: newHybrid });
    hybridRegressorRef.current = tempRegressor;
    smootherRef.current.reset();
  }, []);

  const handleStartProcess = async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch (e) {
      console.warn("Fullscreen denied", e);
    }
    await startCamera();
    setStatus('HEAD_POSITIONING');
  };

  const handleStartCalibrationClick = () => {
    router.push('/consent');
  };

  const handleConsentAgree = () => {
    // The one moment this is provably true: the participant just clicked
    // Agree on exactly this text. Recorded, not assumed from the fact the UI
    // wouldn't let them past without it.
    consentRef.current = { agreedAt: new Date().toISOString(), version: CONSENT_VERSION };
    pathSyncSourceRef.current = 'internal';
    router.push('/demographics');
  };

  const handleConsentDecline = () => {
    pathSyncSourceRef.current = 'internal';
    router.push('/');
  };

  const handleDemographicsBack = () => {
    pathSyncSourceRef.current = 'internal';
    router.push('/consent');
  };

  const handleDemographicsSubmit = (data: DemographicsData) => {
    demographicsRef.current = data;

    // Create the session row now, before calibration has produced anything.
    // Everything that follows — every break, the final save — patches this
    // same row rather than writing one for the first time at the very end.
    // Fire-and-forget: calibration must not wait on this, and a failure here
    // is retried automatically at the first break.
    void ensureSessionCreated();

    // Activate glasses optimization if participant wears glasses and the feature is enabled
    const cfg = configRef.current;
    if (data.wearsGlasses && cfg.glassesOptimization) {
      smootherRef.current.updateConfig(cfg.smoothingMethod, {
        ...cfg,
        glassesMode: true,
        glassesMaxJumpPx: cfg.glassesMaxJumpPx,
        glassesKalmanRMultiplier: cfg.glassesKalmanRMultiplier,
        glassesMaxOutputJumpPx: cfg.glassesMaxOutputJumpPx,
        glassesMaxHoldFrames: cfg.glassesMaxHoldFrames,
      });
      console.log('[Glasses] Optimization enabled for this session');
    }

    // Enter fullscreen immediately on this user gesture so setup guide
    // runs inside fullscreen. By the time we reach /calibration, camera
    // permission is already granted → no dialog → fullscreen stays intact.
    document.documentElement.requestFullscreen().catch((e) => {
      console.warn('Fullscreen denied', e);
    });
    pathSyncSourceRef.current = 'internal';
    router.push('/setup');
  };

  const handleSetupComplete = () => {
    const skipQ = process.env.NEXT_PUBLIC_SKIP_NEURO_QUESTIONNAIRE === 'true';
    if (skipQ || preSymptomScores) {
      // Pre-questionnaire already done or skipped → go straight to calibration
      pathSyncSourceRef.current = 'internal';
      router.push('/calibration');
      setTimeout(() => handleStartProcess(), 300);
    } else {
      // Show pre-questionnaire before calibration
      setShowPreQBeforeCalib(true);
    }
  };

  /** Called when user submits pre-questionnaire shown before calibration. */
  const handlePreQBeforeCalibSubmit = (scores: SymptomScores) => {
    setPreSymptomScores(scores);
    setShowPreQBeforeCalib(false);
    try {
      const questionnaire = {
        variant: 'pre' as const,
        submittedAt: new Date().toISOString(),
        scores,
        questions: SYMPTOM_QUESTIONS.map((q) => ({
          id: q.id,
          category: q.category,
          question: q.question,
          score: scores[q.id] ?? null,
        })),
      };
      localStorage.setItem('neuro_pre_questionnaire_v1', JSON.stringify(questionnaire));
    } catch (_) {}
    // Proceed to calibration
    pathSyncSourceRef.current = 'internal';
    router.push('/calibration');
    setTimeout(() => handleStartProcess(), 300);
  };

  const handleSetupBack = () => {
    pathSyncSourceRef.current = 'internal';
    router.push('/demographics');
  };

  const startActualCalibration = () => {
    setCurrentCalibIndex(0);
    trainingSamplesRef.current = [];
    setTrainingData([]);
    hybridRegressorRef.current = new HybridRegressor();
    setGazeModelReady(false);
    neuroLiveGazeRef.current = { x: 0, y: 0 };
    smootherRef.current.reset();
    validationErrorsRef.current = [];
    setAccuracyScore(null);
    trackingHistoryRef.current = []; 
    setCapturedImages([]); // Reset images
    setRecordedVideoUrl(null); // Reset video
    
    // Reset exercise state
    setCurrentExerciseIndex(0);
    exerciseDataRef.current = [];
    exerciseBlobsRef.current = [];
    exerciseActiveRef.current = false;
    exerciseTargetRef.current = null;
    exerciseBlinkTimesRef.current = [];
    testTrajectoryRef.current = [];

    setCalibPhase(CalibrationPhase.INITIAL_MAPPING);

    // Generate points based on config (denser grid for glasses wearers — see appHelpers).
    // Quick mode overrides both with the backend-minimum 6-dot grid for fast offline testing.
    // Random order: no anticipating the next dot, no predictable row-change jumps.
    const points = shuffled(generateCalibrationPoints(
      NEURO_QUICK_MODE
        ? QUICK_CALIBRATION_POINTS
        : effectiveCalibrationPointCount(
            configRef.current.calibrationPointsCount,
            !!demographicsRef.current?.wearsGlasses,
          ),
    ));
    setCalibPoints(points);
    
    resetDotBookkeeping();
    fixationNoiseRef.current.reset();
    startVideoRecording();
    setSessionSaveStatus('idle');
    setSessionSaveError(null);
    setStatus('CALIBRATION');
  };

  const handleDownloadCSV = () => {
    const data = trackingHistoryRef.current;
    if (data.length === 0) {
      alert("No data collected yet!");
      return;
    }
    let csvContent = "data:text/csv;charset=utf-8,Timestamp,ScreenX,ScreenY\n";
    data.forEach(row => {
      csvContent += `${row.timestamp},${row.x},${row.y}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const date = new Date().toISOString().replace(/[:.]/g, "-");
    link.setAttribute("download", `eye_tracking_data_${date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const buildOfflineSessionMeta = (): SessionMeta => {
    return metaRecorderRef.current.build({
      widthPx: window.innerWidth,
      heightPx: window.innerHeight,
      widthCm: 34.5,   // TODO: set to your monitor's real physical width (cm) for accurate degree units
      viewingDistanceCm: configRef.current.faceDistance,
      glasses: !!demographicsRef.current?.wearsGlasses,
    });
  };

  // Offline reprocessing export. With ?exportMeta=1 in the URL, downloads the
  // recorded calibration video + its meta.json (per-dot windows on the video
  // clock) so they can be dropped into backend/data and run through
  // `python -m app.reprocess`. Off by default — zero effect on normal sessions.
  const maybeExportOfflineMeta = (videoBlob: Blob | null) => {
    try {
      if (typeof window === 'undefined') return;
      if (!isOfflineMetaExportEnabled()) return;
      const rec = metaRecorderRef.current;
      if (rec.counts.calibration === 0) return;
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const metaBlob = new Blob([JSON.stringify(buildOfflineSessionMeta(), null, 2)], { type: 'application/json' });
      downloadBlob(metaBlob, `session-${ts}.meta.json`);
      if (videoBlob && videoBlob.size > 0) downloadBlob(videoBlob, `session-${ts}.webm`);
      console.log(`[offline] exported meta (${rec.counts.calibration} calib / ${rec.counts.validation} valid dots) + video`);
    } catch (e) {
      console.warn('[offline] exportMeta failed', e);
    }
  };

  const downloadVideoBlob = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `eye_tracking_session_${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadCapturedImages = (images: CapturedImage[]) => {
    images.forEach((img, i) => {
      const link = document.createElement("a");
      link.href = img.url;
      link.download = `face_capture_${img.timestamp}_${i}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  };

  const handleStopSaveConfirm = async (options: { csv: boolean; video: boolean; images: boolean }) => {
    stopCamera(); 
    const csvSnapshot = options.csv ? [...trackingHistoryRef.current] : [];
    const imagesSnapshot = options.images ? [...capturedImages] : [];
    let videoBlob: Blob | null = null;
    if (options.video && mediaRecorderRef.current?.state !== 'inactive') {
      videoBlob = await stopVideoRecordingAndGetBlob();
    } else if (options.video && recordedVideoUrl) {
      // Recording already stopped but we have URL - fetch as blob and download
      try {
        const res = await fetch(recordedVideoUrl);
        videoBlob = await res.blob();
      } catch (_) {
        videoBlob = null;
      }
    }
    if (!videoBlob && options.video) {
      stopVideoRecording();
    } else if (!options.video) {
      stopVideoRecording();
    }
    reset();
    setShowStopSaveModal(false);

    // Trigger downloads immediately
    if (options.csv && csvSnapshot.length > 0) {
      let csvContent = "data:text/csv;charset=utf-8,Timestamp,ScreenX,ScreenY\n";
      csvSnapshot.forEach(row => { csvContent += `${row.timestamp},${row.x},${row.y}\n`; });
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `eye_tracking_data_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    if (videoBlob) downloadVideoBlob(videoBlob);
    if (options.images && imagesSnapshot.length > 0) downloadCapturedImages(imagesSnapshot);

    // Short delay before home, to ensure downloads are registered by browser
    setTimeout(() => {
      pathSyncSourceRef.current = 'internal';
      router.push('/');
    }, 150);
  };



  return (
    <div className={`relative w-full h-screen bg-gray-900 text-white selection:bg-none ${
      currentScreen === 'consent' || currentScreen === 'demographics' ? 'overflow-y-scroll' : 'overflow-hidden'
    }`}>
      {/* 
        Video & Canvas Logic:
        1. IDLE: Video hidden, Canvas hidden.
        2. HEAD_POSITIONING: Video VISIBLE (opacity 1), Canvas VISIBLE.
        3. CALIBRATION/TRACKING: Video hidden (unless showCamera), Canvas VISIBLE if invalid head.
        4. MODE: 'object-contain' is used to ensure NO CROP (Full Camera), even if it results in black bars.
      */}
      {/* Camera + face landmarks: full screen by default; large centered frame during Head Orientation */}
      {(() => {
        const isHeadOrientation = status === 'NEURO_FLOW' && currentNeuroTestId === 'head_orientation';
        const videoVisible = isHeadOrientation || (showCamera && status !== 'HEAD_POSITIONING');
        const canvasVisible = isHeadOrientation || showCamera || (headValidation && !headValidation.valid && status !== 'IDLE' && status !== 'HEAD_POSITIONING');
        return (
          <div
            className={
              isHeadOrientation
                ? 'fixed inset-0 flex items-center justify-center z-40 bg-gray-950'
                : 'fixed inset-0 pointer-events-none'
            }
          >
            <div className={isHeadOrientation ? 'w-full max-w-5xl aspect-video rounded-2xl overflow-hidden border-2 border-white/30 shadow-2xl bg-black relative mx-4' : 'absolute inset-0'}>
              <video
                ref={videoRef}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 scale-x-[-1]
                  ${videoVisible || status === 'TRACKING' ? 'opacity-100' : 'opacity-0 pointer-events-none'}
                `}
                playsInline
                muted
              />
              <canvas
                ref={debugCanvasRef}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 pointer-events-none scale-x-[-1]
                  ${canvasVisible ? 'opacity-100' : 'opacity-0'}
                `}
              />
            </div>
          </div>
        );
      })()}

      <AppMainOverlays
        status={status}
        currentScreen={currentScreen}
        headPosCanvasRef={headPosCanvasRef}
        headValidation={headValidation}
        positionHoldTime={positionHoldTime}
        stableFrameCount={stableFrameCount}
        createdSessionId={createdSessionId}
        recordedVideoUrl={recordedVideoUrl}
        capturedImages={capturedImages}
        capturedImageModalIndex={capturedImageModalIndex}
        loadingMsg={loadingMsg}
        accuracyScore={accuracyScore}
        sessionSaveStatus={sessionSaveStatus}
        sessionSaveError={sessionSaveError}
        lastSavedCounts={lastSavedCounts}
        lightLevel={lightLevel}
        calibPhase={calibPhase}
        calibPoints={calibPoints}
        currentCalibIndex={currentCalibIndex}
        isCapturing={isCapturing}
        config={config}
        calibrationProgress={calibrationProgress}
        currentExerciseIndex={currentExerciseIndex}
        trackingMode={trackingMode}
        hasCameraStream={hasCameraStream}
        gazePos={gazePos}
        showHeatmap={showHeatmap}
        isRecording={isRecording}
        showStopSaveModal={showStopSaveModal}
        isBlinking={isBlinking}
        showCamera={showCamera}
        heatmapRef={heatmapRef}
        exerciseTargetRef={exerciseTargetRef}
        trackingHistoryCount={trackingHistoryRef.current.length}
        onConsentAgree={handleConsentAgree}
        onConsentDecline={handleConsentDecline}
        onDemographicsSubmit={handleDemographicsSubmit}
        onDemographicsBack={handleDemographicsBack}
        onSetupComplete={handleSetupComplete}
        onSetupBack={handleSetupBack}
        onSetCapturedImageModalIndex={setCapturedImageModalIndex}
        runMode={runMode}
        onSetRunMode={setRunMode}
        onStartCalibrationClick={handleStartCalibrationClick}
        onGoHome={() => {
          pathSyncSourceRef.current = 'internal';
          router.push('/');
        }}
        onChooseRealTime={startRealTimeTracking}
        onChooseNeurological={handleChooseNeurological}
        onPointMouseDown={handlePointMouseDown}
        onPointMouseUp={() => handlePointMouseUp(false)}
        onExerciseComplete={handleExerciseComplete}
        onTrackingModeChange={setTrackingMode}
        onToggleHeatmap={() => setShowHeatmap(!showHeatmap)}
        onOpenStopSaveModal={() => setShowStopSaveModal(true)}
        onStopSaveConfirm={handleStopSaveConfirm}
        onStopSaveCancel={() => setShowStopSaveModal(false)}
        onSetShowCamera={setShowCamera}
        rawFeatures={rawFeatures}
        loocvErrors={loocvErrors}
        loocvBaseline={loocvBaseline}
        onReEvaluate={reEvaluateWithCurrentFlags}
        selfAssessmentConfig={(neuroConfigSnapshot?.testParameters?.['_selfAssessment'] || { enabled: false, questionCount: 2 }) as unknown as SelfAssessmentConfig}
        assessmentPending={assessmentPending}
        exerciseRetryCount={exerciseRetryCount}
        stepSaveState={stepSaveState}
        stepSaveError={stepSaveError}
        onAssessmentContinue={() => {
            const currentPending = assessmentPendingRef.current;
            setAssessmentPending(null);
            setStepSaveState('idle');
            setStepSaveError(null);
            if (currentPending?.type === 'grid') {
                finishCurrentPhase();
            } else if (currentPending?.type === 'exercise') {
                // The trajectory and samples were banked when the exercise
                // finished; all that is left is to move on.
                advanceExercise();
            }
        }}
        onAssessmentRedo={() => {
            const currentPending = assessmentPendingRef.current;
            setAssessmentPending(null);
            setStepSaveState('idle');
            setStepSaveError(null);
            if (currentPending?.type === 'grid') {
                // The grid's images are already on S3 (uploaded during the break
                // that just ended) and nothing in Postgres will ever point at
                // them once this attempt is replaced — clean them up rather
                // than leave them as orphans for the life of the bucket.
                void uploadApi.deleteBlobs([...uploadedImageUrlsRef.current.values()]);
                setCalibPoints(shuffled(generateCalibrationPoints(
                  NEURO_QUICK_MODE
                    ? QUICK_CALIBRATION_POINTS
                    : effectiveCalibrationPointCount(
                        configRef.current.calibrationPointsCount,
                        !!demographicsRef.current?.wearsGlasses,
                      ),
                )));
                setCurrentCalibIndex(0);
                trainingSamplesRef.current = [];
                uploadedImageUrlsRef.current.clear();
                resetDotBookkeeping();
                setCalibrationProgress(0);
                setRetryCount(0); // restarts grid
            } else if (currentPending?.type === 'exercise') {
                // Drop the samples this exercise produced — the repeat replaces them.
                const start = exerciseSampleStartRef.current;
                if (trainingSamplesRef.current.length > start) {
                    trainingSamplesRef.current = trainingSamplesRef.current.slice(0, start);
                    setTrainingData([...trainingSamplesRef.current]);
                    const orphaned: string[] = [];
                    for (const [index, url] of [...uploadedImageUrlsRef.current.entries()]) {
                        if (index >= start) {
                            orphaned.push(url);
                            uploadedImageUrlsRef.current.delete(index);
                        }
                    }
                    void uploadApi.deleteBlobs(orphaned);
                }
                exerciseDataRef.current = [];
                exerciseBlobsRef.current = [];
                testTrajectoryRef.current.pop();
                currentTestSegmentRef.current = [];
                testSegmentStartTimeRef.current = performance.now();
                setExerciseRetryCount(c => c + 1); // unmounts/remounts EyeMovementLayer
            }
        }}
        onRetryCalibrationSave={() => { void retryBackgroundCalibrationSave(); }}
      />

      <NeurologicalFlowSection
        status={status}
        neuroRunStatus={neuroRunStatus}
        neuroPhase={neuroPhase}
        currentNeuroTestId={currentNeuroTestId}
        neuroResumeTestId={neuroResumeTestId}
        neuroResumePhase={neuroResumePhase}
        neuroRunId={neuroRunId}
        neuroTestOrder={neuroTestOrder}
        neuroConfigSnapshot={neuroConfigSnapshot}
        neuroHeadPose={neuroHeadPose}
        gazePos={gazePos}
        gazeModelReady={gazeModelReady}
        neuroTestResults={neuroTestResults}
        neuroResultsLoading={neuroResultsLoading}
        neuroResultsLoadError={neuroResultsLoadError}
        onNeuroResultsRetry={() => setNeuroResultsFetchKey((k) => k + 1)}
        onPreSubmit={handleNeuroPreSubmit}
        onPostSubmit={handlePostSubmitRequested}
        onTestComplete={handleNeuroTestComplete}
        onTestResultReady={handleNeuroTestResultReady}
        onBreakActiveChange={(active) => { neuroTestBreakActiveRef.current = active; }}
        onPhaseChange={(phase) => { neuroCurrentPhaseRef.current = phase; }}
        testSaveState={neuroTestSaveState}
        isSavingTest={isSavingNeuroTest}
        onDoneBack={startRealTimeTracking}
        showPostSubmitConfirm={showPostSubmitConfirm}
        onPostSubmitConfirmSave={handlePostSubmitSave}
        onPostSubmitConfirmRedo={handlePostSubmitRedoTests}
        onPostSubmitConfirmCancel={() => {
          setShowPostSubmitConfirm(false);
          setPendingPostSymptomScores(null);
        }}
        neuroVerifyBanner={
          neuroPhase === 'done' && searchParams.get('verify') === '1'
            ? {
                focusTestId: searchParams.get('focus') ?? '',
                onContinue: handleNeuroVerifyContinue,
              }
            : null
        }
        resultsInitialFocusTestId={searchParams.get('verify') === '1' ? searchParams.get('focus') : null}
      />

      {/* Pre-questionnaire shown before calibration */}
      {showPreQBeforeCalib && (
        <div className="fixed inset-0 z-[60] bg-gray-950 overflow-y-auto">
          <SymptomAssessment
            variant="pre"
            onSubmit={handlePreQBeforeCalibSubmit}
          />
        </div>
      )}

      {/* Fullscreen Guard Overlay */}
      {['HEAD_POSITIONING', 'CALIBRATION', 'TRACKING', 'NEURO_FLOW'].includes(status) && !isFullscreen && (
        <div 
          onClick={() => {
            document.documentElement.requestFullscreen().catch(e => console.warn(e));
          }}
          className="fixed inset-0 z-[99999] bg-[#0a0c10] flex flex-col items-center justify-center cursor-pointer transition-all hover:bg-[#0d1016] text-white p-6 text-center select-none"
        >
          <div className="w-24 h-24 bg-blue-600/20 rounded-full flex items-center justify-center mb-8 animate-pulse">
            <svg viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" className="w-12 h-12">
              <path strokeLinecap="round" strokeLinejoin="round" 
                d="M15 3h6m0 0v6m0-6L14 10M9 21H3m0 0v-6m0 6l7-7M3 9V3m0 0h6m0 0L10 14M21 15v6m0 0h-6m0 0l7-7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-3">Fullscreen Mode Required</h2>
          <p className="text-base text-gray-400 opacity-90 max-w-sm">
            The assessment must be conducted in fullscreen mode to ensure data accuracy and integrity.
          </p>
          <div className="mt-8 px-8 py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold text-base shadow-xl shadow-blue-900/40 animate-bounce transition-colors flex items-center gap-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" 
                d="M7 11.5V14a5 5 0 1010 0v-5.5a1.5 1.5 0 10-3 0V12m-3-4V12m-3-1.5V12" />
            </svg>
            Click here to continue testing
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
