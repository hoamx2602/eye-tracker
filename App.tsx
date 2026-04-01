'use client';

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PATHS, parsePathname } from '@/lib/paths';
import { neuroDebugLog, neuroPersistWarn } from '@/lib/neuroDebugLog';
import { neuroLiveGazeRef } from '@/lib/neuroLiveGaze';
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
  type EyeMovementKind
} from './types';
import { eyeTrackingService, HeadValidationResult } from './services/eyeTrackingService';
import { HybridRegressor, GazeSmoother, DataCleaner } from './services/mathUtils';
import { sessionsApi, uploadApi, neurologicalRunsApi, getNeurologicalConfig } from './services/api';
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
import type { TestResultPayload } from '@/components/neurological';
import NeurologicalFlowSection from '@/components/neurological/NeurologicalFlowSection';
import { useNeuroFlowHandlers } from '@/components/neurological/useNeuroFlowHandlers';
import AppMainOverlays from '@/components/AppMainOverlays';
import ExitConfirmModal from '@/components/neurological/ExitConfirmModal';
import { CapturedImage, GazeRecord, VALIDATION_POINTS, generateCalibrationPoints, roundedRect } from '@/lib/appHelpers';
import { FaceLandmarkerResult, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { SelfAssessmentConfig } from '@/components/neurological/GuidePracticeTestFlow';

/** When true (NEXT_PUBLIC_CALIBRATION_TEST_MODE=1): after first calibration phase (grid) only, save session and show choice screen (Real-time vs Neurological). Choice is always required. */
const CALIBRATION_TEST_MODE =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_CALIBRATION_TEST_MODE === '1';

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
  const [postSymptomScores, setPostSymptomScores] = useState<SymptomScores | null>(null);
  const [pendingPostSymptomScores, setPendingPostSymptomScores] = useState<SymptomScores | null>(null);
  const [showPostSubmitConfirm, setShowPostSubmitConfirm] = useState(false);
  /** Which neurological test is running; null when between tests or in post/done. */
  const [currentNeuroTestId, setCurrentNeuroTestId] = useState<string | null>(null);
  const [showNeuroExitConfirm, setShowNeuroExitConfirm] = useState(false);
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
  /** When we push a path from internal transition we skip one pathname sync to avoid overwriting state. */
  const pathSyncSourceRef = useRef<'url' | 'internal'>('url');

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
  const exerciseDataRef = useRef<{ screenX: number; screenY: number; features: number[]; head?: HeadSnapshot; rawEyeFeatures?: EyeFeatures }[]>([]);
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
  const requestRef = useRef<number>(0);
  const heatmapRef = useRef<HeatmapRef>(null);
  
  const lastVideoTimeRef = useRef(-1);
  const detectionFrameCounterRef = useRef(0);
  const detectionStrideRef = useRef(1);
  const detectionAvgMsRef = useRef(0);
  const isCollectingRef = useRef(false);
  const collectionBufferRef = useRef<number[][]>([]);
  /** Parallel raw-features buffer — same lifecycle as collectionBufferRef. Used to store
   *  EyeFeatures per frame so the averaged result can be saved in TrainingSample.rawEyeFeatures,
   *  enabling flag re-evaluation without re-calibrating. */
  const rawCollectionBufferRef = useRef<EyeFeatures[]>([]);
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
  const [isRecording, setIsRecording] = useState(false);
  const [lightLevel, setLightLevel] = useState<{ value: number; status: 'too_dark' | 'low' | 'ok' | 'good' } | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const calibrationImagesRef = useRef<Blob[]>([]);
  
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
              const order = neuroTestOrder.length > 0 ? neuroTestOrder : ['head_orientation', 'visual_search', 'memory_cards', 'anti_saccade', 'saccadic', 'fixation_stability', 'peripheral_vision'];
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

  // Sync URL path → state so direct navigation / refresh shows the right screen
  useEffect(() => {
    if (pathSyncSourceRef.current === 'internal') {
      pathSyncSourceRef.current = 'url';
      return;
    }
    const parsed = parsePathname(typeof pathname === 'string' ? pathname : '/');
    switch (parsed.screen) {
      case 'home':
        // Don't override status when at / (could be IDLE, HEAD_POSITIONING, CALIBRATION, or CHOICE)
        break;
      case 'choice':
        setStatus('IDLE');
        break;
      case 'consent':
      case 'demographics':
      case 'setup':
        // UI is purely driven by `currentScreen` derived from URL pathname
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
        const order = neuroTestOrder.length > 0 ? neuroTestOrder : ['head_orientation', 'visual_search', 'memory_cards', 'anti_saccade', 'saccadic', 'fixation_stability', 'peripheral_vision'];
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

  // Load cached neuro config snapshot for this browser session.
  // If we are on a neuro route but have no snapshot, try to fetch it from the API.
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

    // If we're on a neuro route, fetch the latest from DB to ensure developer-convenience
    // (so admin changes reflect on refresh of the test page).
    const parsed = parsePathname(typeof pathname === 'string' ? pathname : '/');
    if (parsed.screen.startsWith('neuro')) {
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
    }
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
      setHasCameraStream(true);
      await new Promise((resolve) => {
        if (videoRef.current) videoRef.current.onloadedmetadata = resolve;
      });
      videoRef.current.play();
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

  // --- VIDEO RECORDING FUNCTIONS ---
  const startVideoRecording = () => {
    if (!videoRef.current || !videoRef.current.srcObject) return;
    const stream = videoRef.current.srcObject as MediaStream;
    
    // Choose appropriate mime type
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm'; 
    }
    
    try {
        const recorder = new MediaRecorder(stream, { mimeType });
        recordedChunksRef.current = [];
        
        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunksRef.current.push(event.data);
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

        recorder.start();
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

  const processVideo = useCallback(() => {
    if (!videoRef.current) return;
    
    const now = performance.now();
    if (videoRef.current.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = videoRef.current.currentTime;
      const currentStatus = statusRef.current;
      const shouldAdaptDetectionLoad =
        currentStatus === 'CALIBRATION' && (exerciseActiveRef.current || isCollectingRef.current);
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
                          if (calibrationResumeRef.current) {
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
              // Do NOT return to HEAD_POSITIONING if we are showing an assessment modal, 
              // to avoid interrupting the user answering questions.
              if (statusRef.current === 'CALIBRATION' && !validation.valid && !assessmentPendingRef.current) {
                  if (headInvalidSinceRef.current === null) headInvalidSinceRef.current = now;
                  else if (now - headInvalidSinceRef.current > 500) {
                      headInvalidSinceRef.current = null;
                      calibrationResumeRef.current = true;
                      setStatus('HEAD_POSITIONING');
                  }
              } else if (statusRef.current === 'CALIBRATION' && validation.valid) {
                  headInvalidSinceRef.current = null;
              }

              // Draw Face Mesh on debugCanvas (skip during HEAD_POSITIONING — handled by headPosCanvas)
              if (statusRef.current !== 'HEAD_POSITIONING') {
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
          }
      }

      if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];
        
        // --- ONLY PROCESS GAZE IF HEAD IS VALID ---
        if (isHeadValidRef.current) {
            const blinking = eyeTrackingService.isBlinking(landmarks);
            setIsBlinking(blinking);

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

                  // 1. Data Collection (grid points)
                  if (currentStatus === 'CALIBRATION' && isCollectingRef.current) {
                    const inputVector = eyeTrackingService.prepareFeatureVector(features, configRef.current);
                    collectionBufferRef.current.push(inputVector);
                    rawCollectionBufferRef.current.push(features);
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
        for (let i = 0; i < lm.length; i++) {
          const p = lm[i];
          const x = (1 - p.x) * W;
          const y = p.y * H;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [status]);

  // --- CALIBRATION INTERACTION LOGIC (CLICK & HOLD) ---
  const handlePointMouseDown = () => {
    if (config.calibrationMethod !== CalibrationMethod.CLICK_HOLD) return;

    collectionBufferRef.current = [];
    rawCollectionBufferRef.current = [];
    isCollectingRef.current = true;
    holdStartTimeRef.current = performance.now();
    
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
    
    // Check if we held long enough
    if (success === true || calibrationProgress >= 1) {
        processClickHoldData();
    } else {
        // Failed / Released early
        console.warn("Released too early");
        collectionBufferRef.current = []; // Discard bad data
        rawCollectionBufferRef.current = [];
    }
    
    setCalibrationProgress(0);
  };

  const processClickHoldData = () => {
    const rawBuffer = collectionBufferRef.current;
    const rawFeatBuffer = rawCollectionBufferRef.current;

    // TEMPORAL TRIMMING: Remove first 20% and last 20% of frames
    // This removes jitter from the click action and the release anticipation
    if (rawBuffer.length > 5) {
        const cutAmount = Math.floor(rawBuffer.length * 0.2);
        // Ensure we have data left after cutting 40%
        if (rawBuffer.length - (cutAmount * 2) > 2) {
             const trimmedBuffer = rawBuffer.slice(cutAmount, rawBuffer.length - cutAmount);
             // Apply same temporal trim to raw features for re-evaluation support
             const trimmedRawFeat = rawFeatBuffer.slice(cutAmount, rawFeatBuffer.length - cutAmount);
             processCalibBuffer(trimmedBuffer, trimmedRawFeat);
             return;
        }
    }

    // Fallback if data is too short
    console.warn("Buffer too short after trimming");
    setRetryCount(c => c + 1);
  };


  // --- CALIBRATION LOGIC ENGINE (TIMER BASED) ---
  useEffect(() => {
    if (status !== 'CALIBRATION') {
      timerRef.current.forEach(clearTimeout);
      timerRef.current = [];
      isCollectingRef.current = false;
      return;
    }

    // Skip timer logic if we are in Click & Hold mode
    if (config.calibrationMethod === CalibrationMethod.CLICK_HOLD) {
        return;
    }

    const point = calibPoints[currentCalibIndex];
    if (!point) return;

    setIsCapturing(false);
    timerRef.current.forEach(clearTimeout);
    timerRef.current = [];

    // Speed configuration logic
    const speedMultiplier = config.calibrationSpeed === 'FAST' ? 0.5 : config.calibrationSpeed === 'SLOW' ? 1.5 : 1.0;
    const prepTime = 800 * speedMultiplier;
    const captureTime = 1200 * speedMultiplier;

    const tStart = setTimeout(() => {
      collectionBufferRef.current = [];
      rawCollectionBufferRef.current = [];
      isCollectingRef.current = true;
      setIsCapturing(true);
    }, prepTime);

    const tEnd = setTimeout(() => {
      isCollectingRef.current = false;
      setIsCapturing(false);

      const buffer = collectionBufferRef.current;
      const rawFeatBuffer = rawCollectionBufferRef.current;
      // Use standard cleaning for timer method
      const cleanBuffer = DataCleaner.clean(buffer, configRef.current.outlierMethod, configRef.current.outlierThreshold);
      processCalibBuffer(cleanBuffer, rawFeatBuffer);

    }, prepTime + captureTime);

    timerRef.current.push(tStart, tEnd);

    return () => {
      timerRef.current.forEach(clearTimeout);
      timerRef.current = [];
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

  /** Average a buffer of EyeFeatures frames into a single representative sample. */
  const averageEyeFeatures = (feats: EyeFeatures[]): EyeFeatures => {
    const n = feats.length;
    const avgN = (fn: (f: EyeFeatures) => number): number =>
      feats.reduce((s, f) => s + fn(f), 0) / n;
    const gazeBlendshapeKeys = ['eyeLookDownLeft','eyeLookDownRight','eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight','eyeLookUpLeft','eyeLookUpRight'];
    const hasBlendshapes = !!feats[0]?.blendshapes;
    const hasMatrixPose  = !!feats[0]?.matrixHeadPose;
    return {
      leftPupil:      { x: avgN(f=>f.leftPupil.x),      y: avgN(f=>f.leftPupil.y) },
      rightPupil:     { x: avgN(f=>f.rightPupil.x),     y: avgN(f=>f.rightPupil.y) },
      leftEyeCenter:  { x: avgN(f=>f.leftEyeCenter.x),  y: avgN(f=>f.leftEyeCenter.y) },
      rightEyeCenter: { x: avgN(f=>f.rightEyeCenter.x), y: avgN(f=>f.rightEyeCenter.y) },
      leftRelative:   { x: avgN(f=>f.leftRelative.x),   y: avgN(f=>f.leftRelative.y) },
      rightRelative:  { x: avgN(f=>f.rightRelative.x),  y: avgN(f=>f.rightRelative.y) },
      headPose: {
        pitch: avgN(f=>f.headPose.pitch),
        yaw:   avgN(f=>f.headPose.yaw),
        roll:  avgN(f=>f.headPose.roll),
      },
      zDistance: avgN(f=>f.zDistance),
      leftEAR:  avgN(f=>f.leftEAR),
      rightEAR: avgN(f=>f.rightEAR),
      blendshapes: hasBlendshapes
        ? Object.fromEntries(gazeBlendshapeKeys.map(k => [k, avgN(f => f.blendshapes?.[k] ?? 0)]))
        : undefined,
      matrixHeadPose: hasMatrixPose ? {
        pitch: avgN(f=>f.matrixHeadPose?.pitch ?? 0),
        yaw:   avgN(f=>f.matrixHeadPose?.yaw   ?? 0),
        roll:  avgN(f=>f.matrixHeadPose?.roll  ?? 0),
      } : undefined,
    };
  };

  // Common function to process buffer and advance state
  const processCalibBuffer = (buffer: number[][], rawFeatBuffer?: EyeFeatures[]) => {
     const point = calibPoints[currentCalibIndex];

     if (buffer.length > 2) {
        // Average raw EyeFeatures first (when available), then recompute the feature vector
        // from the averaged coordinates. This is the correct approach: avg(lx) * avg(yaw)
        // is more accurate than avg(lx * yaw) for cross-terms and quadratic features.
        const avgRaw = (rawFeatBuffer && rawFeatBuffer.length > 1)
          ? averageEyeFeatures(rawFeatBuffer)
          : undefined;

        // Primary feature vector: derive from averaged raw features when possible,
        // fall back to averaging the processed vectors if rawFeatBuffer is missing.
        let avgVector: number[];
        if (avgRaw) {
          avgVector = eyeTrackingService.prepareFeatureVector(avgRaw, configRef.current);
        } else {
          const numFeatures = buffer[0].length;
          avgVector = new Array(numFeatures).fill(0);
          for (const vec of buffer) {
            for (let i = 0; i < numFeatures; i++) avgVector[i] += vec[i];
          }
          for (let i = 0; i < numFeatures; i++) avgVector[i] /= buffer.length;
        }

        const screenX = (point.x / 100) * window.innerWidth;
        const screenY = (point.y / 100) * window.innerHeight;

        if (calibPhase !== CalibrationPhase.VALIDATION) {
            const newSample: TrainingSample = {
              screenX,
              screenY,
              features: avgVector,
              timestamp: Date.now(),
              head: toHeadSnapshot(headValidationRef.current),
              patternName: `Calibration point ${point.id}`,
              rawEyeFeatures: avgRaw,
            };
            trainingSamplesRef.current.push(newSample);
            setTrainingData([...trainingSamplesRef.current]);
            captureCurrentFrameAsBlob().then((b) => b && calibrationImagesRef.current.push(b));
        } else {
            const prediction = hybridRegressorRef.current.predict(avgVector, configRef.current.regressionMethod);
            const err = Math.sqrt(Math.pow(prediction.x - screenX, 2) + Math.pow(prediction.y - screenY, 2));
            validationErrorsRef.current.push(err);
            const validationSample: TrainingSample = {
              screenX,
              screenY,
              features: avgVector,
              timestamp: Date.now(),
              head: toHeadSnapshot(headValidationRef.current),
              patternName: `Validation point ${currentCalibIndex + 1}`,
              rawEyeFeatures: avgRaw,
            };
            trainingSamplesRef.current.push(validationSample);
            setTrainingData([...trainingSamplesRef.current]);
            console.log(`Validation Point ${currentCalibIndex + 1}: Error ${err.toFixed(1)}px`);
        }

        // Advance only if successful
        if (currentCalibIndex < calibPoints.length - 1) {
            setCurrentCalibIndex(prev => prev + 1);
        } else {
            finishCurrentPhase();
        }

      } else {
          console.warn(`Point ${currentCalibIndex} skipped/retrying: Insufficient data`);
          setRetryCount(c => c + 1); 
      }
  };

  const processExerciseData = () => {
    const data = exerciseDataRef.current;
    const blobs = exerciseBlobsRef.current.slice();
    exerciseDataRef.current = [];
    exerciseBlobsRef.current = [];
    exerciseActiveRef.current = false;

    if (data.length < 10) {
      console.warn(`[Exercise] Insufficient data (${data.length} frames), skipping`);
      advanceExercise();
      return;
    }

    // Trim first/last 10% (transition noise from countdown/completion)
    const startIdx = Math.floor(data.length * 0.1);
    const endIdx = Math.floor(data.length * 0.9);
    const trimmed = data.slice(startIdx, endIdx);

    if (trimmed.length === 0) {
      advanceExercise();
      return;
    }

    // Downsample to ~10 training samples per exercise.
    // Keeping this low prevents exercise data from overwhelming the 9-point calibration grid.
    // With 6 exercises × 10 = 60 exercise samples vs ~9 grid samples, ratio is ~6.7:1 instead of ~20:1.
    // More importantly, exercises like "horizontal" produce samples with Y ≈ 0.5 (center) only —
    // over-representing them biases regression toward center-Y predictions.
    const targetCount = 10;
    const step = Math.max(1, Math.floor(trimmed.length / targetCount));
    let added = 0;
    const kindName = EXERCISE_KINDS[currentExerciseIndex] || 'unknown';
    const patternLabel = getPatternDisplayName(kindName as EyeMovementKind);

    for (let i = 0; i < trimmed.length; i += step) {
      const windowEnd = Math.min(i + step, trimmed.length);
      const window = trimmed.slice(i, windowEnd);
      if (window.length === 0) continue;

      let avgX = 0, avgY = 0;
      for (const sample of window) {
        avgX += sample.screenX;
        avgY += sample.screenY;
      }
      avgX /= window.length;
      avgY /= window.length;

      // Average raw EyeFeatures (when available), then recompute feature vector correctly.
      // Falls back to averaging processed vectors if rawEyeFeatures are missing.
      const rawFeatWindow = window.map(s => s.rawEyeFeatures).filter(Boolean) as EyeFeatures[];
      let avgFeatures: number[];
      if (rawFeatWindow.length === window.length) {
        const avgRaw = averageEyeFeatures(rawFeatWindow);
        avgFeatures = eyeTrackingService.prepareFeatureVector(avgRaw, configRef.current);
      } else {
        const numFeatures = window[0].features.length;
        avgFeatures = new Array(numFeatures).fill(0);
        for (const sample of window) {
          for (let j = 0; j < numFeatures; j++) avgFeatures[j] += sample.features[j];
        }
        for (let j = 0; j < numFeatures; j++) avgFeatures[j] /= window.length;
      }

      // Also store avgRaw on the TrainingSample so re-evaluate covers exercise data too
      const avgRawForSample = rawFeatWindow.length > 0 ? averageEyeFeatures(rawFeatWindow) : undefined;

      const originalIndex = startIdx + i;
      const blobIdx = Math.floor(originalIndex / 5);
      const blobForUpload = blobIdx < blobs.length ? blobs[blobIdx] : undefined;

      trainingSamplesRef.current.push({
        screenX: avgX,
        screenY: avgY,
        features: avgFeatures,
        timestamp: Date.now(),
        head: window[0].head,
        patternName: patternLabel,
        rawEyeFeatures: avgRawForSample,
        ...(blobForUpload && { blobForUpload }),
      });
      added++;
    }

    console.log(`[Exercise:${kindName}] Added ${added} samples from ${data.length} raw frames`);
    setTrainingData([...trainingSamplesRef.current]);
    advanceExercise();
  };

  const advanceExercise = () => {
    const nextIndex = currentExerciseIndex + 1;
    if (nextIndex < EXERCISE_KINDS.length) {
      setCurrentExerciseIndex(nextIndex);
      exerciseDataRef.current = [];
      exerciseBlobsRef.current = [];
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
    setCalibPoints(VALIDATION_POINTS);
    setCurrentCalibIndex(0);
    validationErrorsRef.current = [];
  };

  const handleExerciseComplete = useCallback(() => {
    const saEnabled = (neuroConfigSnapshot?.testParameters?.['_selfAssessment'] as any)?.enabled !== false;
    if (saEnabled) {
        setAssessmentPending({ type: 'exercise', kind: exerciseKindRef.current, index: currentExerciseIndex });
    } else {
        testTrajectoryRef.current.push({
            patternName: getPatternDisplayName(exerciseKindRef.current),
            points: [...currentTestSegmentRef.current],
        });
        if (runModeRef.current === 'test') {
            advanceExercise();
        } else {
            processExerciseData();
        }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentExerciseIndex, neuroConfigSnapshot]);

  const finishCurrentPhase = () => {
    if (calibPhase === CalibrationPhase.INITIAL_MAPPING) {
        // If self-assessment is enabled and we haven't shown it yet for this phase, trigger it now.
        const saEnabled = (neuroConfigSnapshot?.testParameters?.['_selfAssessment'] as any)?.enabled !== false;
        if (!assessmentPending && saEnabled) {
            setAssessmentPending({ type: 'grid' });
            return;
        }

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

        // Option 2 ('test' mode): Skip Eye Movement Exercises, go directly to Validation to compute Mean Accuracy.
        if (configRef.current.enableExercises && runModeRef.current !== 'test') {
            console.log(`[Calibration] Grid mapping done with ${data.length} samples, starting exercises...`);
            setCalibPhase(CalibrationPhase.EXERCISES);
            setCurrentExerciseIndex(0);
      exerciseDataRef.current = [];
      exerciseBlobsRef.current = [];
      exerciseKindRef.current = EXERCISE_KINDS[0];
      exerciseActiveRef.current = true;
      currentTestSegmentRef.current = [];
      testSegmentStartTimeRef.current = performance.now();
        } else {
            setCalibPhase(CalibrationPhase.VALIDATION);
            setCalibPoints(VALIDATION_POINTS);
            setCurrentCalibIndex(0);
            validationErrorsRef.current = [];
        }
    }
    else if (calibPhase === CalibrationPhase.VALIDATION) {
        completeCalibrationAndStartTracking(validationErrorsRef.current, testTrajectoryRef.current);
    }
  };

  const completeCalibrationAndStartTracking = (errors: number[], testTrajectories?: { patternName: string; points: { t: number; targetX: number; targetY: number; gazeX: number; gazeY: number }[] }[]) => {
    const avgError = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;
    setAccuracyScore(avgError);
    const isAccuracyGood = avgError < 300;
    setLoadingMsg('Saving samples');
    setStatus('LOADING_MODEL');

    (async () => {
      setSessionSaveStatus('saving');
      setSessionSaveError(null);

      /** Run up to `concurrency` promises at a time. */
      const runWithConcurrency = async <T, R>(
        items: T[],
        concurrency: number,
        fn: (item: T, index: number) => Promise<R>
      ): Promise<R[]> => {
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
      };

      try {
        const videoBlob = await stopVideoRecordingAndGetBlob();
        const gridImageCount = calibrationImagesRef.current.length;
        const samples = trainingSamplesRef.current;
        const timestamp = Date.now();

        // Build list of image uploads: { sampleIndex, blob }
        const imageUploads: { sampleIndex: number; blob: Blob }[] = [];
        for (let i = 0; i < samples.length; i++) {
          const blob = i < gridImageCount
            ? calibrationImagesRef.current[i] ?? null
            : (samples[i]!.blobForUpload ?? null);
          if (blob) imageUploads.push({ sampleIndex: i, blob });
        }

        // Upload video and all images in parallel (images with concurrency limit 6)
        const IMAGE_CONCURRENCY = 6;

        const [videoUrlResult, imageUrlsByOrder] = await Promise.all([
          videoBlob && videoBlob.size > 0
            ? uploadApi.uploadBlob(videoBlob, `calibration-${timestamp}.webm`, 'video/webm')
            : Promise.resolve(null),
          runWithConcurrency(
            imageUploads,
            IMAGE_CONCURRENCY,
            async ({ blob, sampleIndex }) => {
              const url = await uploadApi.uploadBlob(
                blob,
                `calibration-sample-${timestamp}-${sampleIndex}.jpg`,
                'image/jpeg'
              );
              return { sampleIndex, url };
            }
          ),
        ]);

        const videoUrl = videoUrlResult ?? undefined;
        const imageUrlByIndex = new Map<number, string>();
        imageUrlsByOrder.forEach(({ sampleIndex, url }) => {
          if (url) imageUrlByIndex.set(sampleIndex, url);
        });

        const calibrationGazeSamples: Array<{
          screenX: number;
          screenY: number;
          features?: number[];
          timestamp?: number;
          head?: HeadSnapshot;
          imageUrl?: string | null;
          patternName?: string;
        }> = samples.map((s, i) => ({
          screenX: s.screenX,
          screenY: s.screenY,
          features: s.features,
          timestamp: s.timestamp,
          head: s.head,
          imageUrl: imageUrlByIndex.get(i) ?? undefined,
          ...(s.patternName != null && { patternName: s.patternName }),
        }));
        const calibrationImageUrls = calibrationGazeSamples
          .map((s) => s.imageUrl)
          .filter((u): u is string => Boolean(u));
        const sampleCount = calibrationGazeSamples.length;
        const imageCount = calibrationImageUrls.length;
        if (process.env.NODE_ENV === 'development') {
          console.log('[Session save] Sending:', { sampleCount, imageCount, hasVideo: Boolean(videoUrl) });
        }
        const created = await sessionsApi.create({
          config: {
            ...(configRef.current as unknown as Record<string, unknown>),
            ...(demographicsRef.current ? { demographics: demographicsRef.current } : {}),
            ...(testTrajectories && testTrajectories.length > 0 ? { testTrajectories, isTestSession: true } : {}),
          } as unknown as Record<string, unknown>,
          demographics: demographicsRef.current
            ? { ...demographicsRef.current, age: demographicsRef.current.age === '' ? undefined : demographicsRef.current.age }
            : undefined,
          validationErrors: errors,
          meanErrorPx: errors.length > 0 ? avgError : undefined,
          status: 'completed',
          videoUrl,
          calibrationImageUrls: calibrationImageUrls.length > 0 ? calibrationImageUrls : undefined,
          calibrationGazeSamples,
        });
        if (process.env.NODE_ENV === 'development') {
          console.log('[Session save] Created session:', created.id);
        }
        setLastSavedCounts({ samples: sampleCount, images: imageCount });
        setSessionSaveStatus('saved');
        const statusMsg = isAccuracyGood
          ? `Calibration Success! Mean Error: ${Math.round(avgError)}px`
          : errors.length > 0 ? `Calibration Complete (Accuracy: ${Math.round(avgError)}px)` : 'Calibration complete (test mode)';
        setLoadingMsg(statusMsg);
        setTimeout(() => {
          pathSyncSourceRef.current = 'internal';
          setCreatedSessionId(created.id);
          // Auto-start neurological flow instead of showing choice screen
          handleChooseNeurological(created.id);
        }, 1200);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setSessionSaveStatus('error');
        setSessionSaveError(msg);
        console.warn('[Session save]', e);
        alert(`Could not save session: ${msg}\n\n• Run "npm run dev" (Next.js) — API runs on same origin, no env needed.\n• On Vercel: do not set NEXT_PUBLIC_API_URL (same domain). Configure S3 bucket CORS: add app domain to AllowedOrigins, AllowedMethods: PUT, GET.\n• Ensure DB and S3 env vars are set correctly on Vercel.`);
      }
    })();
  };
 
  const reset = useCallback(() => {
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
    handleNeuroTestComplete,
    handleNeuroPreSubmit,
    handleNeuroPostSubmit,
    handleNeuroExitRun,
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
    onStartRealTimeTracking: startRealTimeTracking,
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
      if (process.env.NEXT_PUBLIC_SKIP_NEURO_QUESTIONNAIRE === 'true') {
        setNeuroPhase('tests');
        setCurrentNeuroTestId(order[0] || null);
        setCurrentNeuroTestIndex(0);
        if (typeof window !== 'undefined') window.history.pushState(null, '', PATHS.NEURO_TEST(order[0]));
      } else {
        if (typeof window !== 'undefined') window.history.pushState(null, '', PATHS.NEURO_PRE);
      }
    } catch (e) {
      console.error('Create neuro run failed', e);
      setNeuroRunStatus('error');
    }
  }, [NEURO_CONFIG_LS_KEY, NEURO_TEST_PROGRESS_LS_KEY, createdSessionId, router]);

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
    const order = neuroTestOrder.length > 0 ? neuroTestOrder : ['head_orientation', 'visual_search', 'memory_cards', 'anti_saccade', 'saccadic', 'fixation_stability', 'peripheral_vision'];
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
    const inputVector = eyeTrackingService.prepareFeatureVector(features, configRef.current);

    // Pass the configured method to the regressor
    const prediction = hybridRegressorRef.current.predict(inputVector, configRef.current.regressionMethod);

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
    pathSyncSourceRef.current = 'internal';
    router.push('/calibration');
    // Defer handleStartProcess so React has time to unmount SetupGuideScreen
    // and stop its preview stream before we call getUserMedia again.
    // Without this delay the two getUserMedia calls overlap → camera denied.
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
    testTrajectoryRef.current = [];

    setCalibPhase(CalibrationPhase.INITIAL_MAPPING);
    
    // Generate points based on config
    const points = generateCalibrationPoints(configRef.current.calibrationPointsCount);
    setCalibPoints(points);
    
    calibrationImagesRef.current = [];
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
        selfAssessmentConfig={(neuroConfigSnapshot?.testParameters?.['_selfAssessment'] || { enabled: true, questionCount: 2 }) as unknown as SelfAssessmentConfig}
        assessmentPending={assessmentPending}
        exerciseRetryCount={exerciseRetryCount}
        onAssessmentContinue={() => {
            const currentPending = assessmentPendingRef.current;
            setAssessmentPending(null);
            if (currentPending?.type === 'grid') {
                finishCurrentPhase();
            } else if (currentPending?.type === 'exercise') {
                testTrajectoryRef.current.push({
                    patternName: getPatternDisplayName(exerciseKindRef.current),
                    points: [...currentTestSegmentRef.current],
                });
                if (runModeRef.current === 'test') {
                    advanceExercise();
                } else {
                    processExerciseData();
                }
            }
        }}
        onAssessmentRedo={() => {
            const currentPending = assessmentPendingRef.current;
            setAssessmentPending(null);
            if (currentPending?.type === 'grid') {
                setCalibPoints(generateCalibrationPoints(configRef.current.calibrationPointsCount));
                setCurrentCalibIndex(0);
                trainingSamplesRef.current = [];
                calibrationImagesRef.current = [];
                setCalibrationProgress(0);
                setRetryCount(0); // restarts grid
            } else if (currentPending?.type === 'exercise') {
                exerciseDataRef.current = [];
                exerciseBlobsRef.current = [];
                if (runModeRef.current === 'test') {
                    currentTestSegmentRef.current = [];
                    testSegmentStartTimeRef.current = performance.now();
                }
                setExerciseRetryCount(c => c + 1); // unmounts/remounts EyeMovementLayer
            }
        }}
      />

      <NeurologicalFlowSection
        status={status}
        neuroRunStatus={neuroRunStatus}
        neuroPhase={neuroPhase}
        currentNeuroTestId={currentNeuroTestId}
        neuroRunId={neuroRunId}
        neuroTestOrder={neuroTestOrder}
        neuroConfigSnapshot={neuroConfigSnapshot}
        neuroHeadPose={neuroHeadPose}
        gazePos={gazePos}
        gazeModelReady={gazeModelReady}
        neuroTestResults={neuroTestResults}
        onExitRun={async () => setShowNeuroExitConfirm(true)}
        neuroResultsLoading={neuroResultsLoading}
        neuroResultsLoadError={neuroResultsLoadError}
        onNeuroResultsRetry={() => setNeuroResultsFetchKey((k) => k + 1)}
        onPreSubmit={handleNeuroPreSubmit}
        onPostSubmit={handlePostSubmitRequested}
        onTestComplete={handleNeuroTestComplete}
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

      <ExitConfirmModal
        open={showNeuroExitConfirm}
        onConfirm={() => {
          setShowNeuroExitConfirm(false);
          handleNeuroExitRun();
        }}
        onCancel={() => setShowNeuroExitConfirm(false)}
      />

    </div>
  );
}

export default App;