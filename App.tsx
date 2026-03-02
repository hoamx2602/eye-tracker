'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
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
  EXERCISE_KINDS,
  DEFAULT_CONFIG,
  TrackingMode,
  getPatternDisplayName,
  type EyeMovementKind
} from './types';
import { eyeTrackingService, HeadValidationResult } from './services/eyeTrackingService';
import { HybridRegressor, GazeSmoother, DataCleaner } from './services/mathUtils';
import { sessionsApi, uploadApi } from './services/api';
import CalibrationLayer from './components/CalibrationLayer';
import EyeMovementLayer from './components/EyeMovementLayer';
import GazeCursor from './components/GazeCursor';
import HeatmapLayer, { HeatmapRef } from './components/HeatmapLayer';
import SettingsModal from './components/SettingsModal';
import HeadPositionGuide from './components/HeadPositionGuide';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import ConsentModal from './components/ConsentModal';
import DemographicsForm, { type DemographicsData } from './components/DemographicsForm';
import RandomDotsOverlay from './components/RandomDotsOverlay';
import ArticleReadingOverlay from './components/ArticleReadingOverlay';
import StopSaveModal from './components/StopSaveModal';
import CapturedImageModal from './components/CapturedImageModal';
import { FaceLandmarkerResult, NormalizedLandmark } from "@mediapipe/tasks-vision";

// --- CONFIGURATION ---
const EDGE_PAD = 4;

/** When true (NEXT_PUBLIC_CALIBRATION_TEST_MODE=1): after first calibration phase (grid) only, save session and go to Tracking. For testing save/storage. */
const CALIBRATION_TEST_MODE =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_CALIBRATION_TEST_MODE === '1';

// --- DYNAMIC CALIBRATION POINTS GENERATOR ---
const generateCalibrationPoints = (count: number): CalibrationPoint[] => {
  const points: CalibrationPoint[] = [];
  
  // Always include corners and center (5 points) if count >= 5
  // But for a general approach, we can generate a grid that best fits 'count'
  // or use a specific distribution.
  
  // Strategy:
  // 1. Calculate grid dimensions (rows x cols) that approximate sqrt(count)
  // 2. Distribute points evenly
  
  // However, standard eye tracking grids are usually 3x3 (9), 4x4 (16), 5x4 (20), etc.
  
  let rows = Math.round(Math.sqrt(count));
  let cols = Math.ceil(count / rows);
  
  // Adjust to ensure we have enough points
  while (rows * cols < count) {
      cols++;
  }
  
  // Generate grid points
  const xStep = (100 - 2 * EDGE_PAD) / (cols - 1 || 1);
  const yStep = (100 - 2 * EDGE_PAD) / (rows - 1 || 1);
  
  let generatedCount = 0;
  
  for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
          if (generatedCount >= count) break;
          
          const x = EDGE_PAD + (c * xStep);
          const y = EDGE_PAD + (r * yStep);
          
          points.push({
              id: generatedCount + 1,
              x: x,
              y: y,
              completed: false
          });
          generatedCount++;
      }
  }
  
  // If we have fewer points than requested (due to grid logic), add random ones? 
  // No, the loop ensures we stop at count. 
  // But if rows*cols > count, we might miss the bottom-right if we just break.
  // Better to center the grid or pick specific points.
  
  // Let's refine:
  // If count is one of the standard presets, use specific logic?
  // Actually, the grid logic above fills row by row. 
  // For 5 points, it might do 2x3 grid and take first 5.
  // 2x3 grid:
  // (0,0) (0,1) (0,2)
  // (1,0) (1,1)
  // This is okay, but maybe not symmetric.
  
  // Alternative: Uniform distribution.
  // But for eye tracking, grid is preferred.
  
  return points;
};

const VALIDATION_POINTS: CalibrationPoint[] = [
  { id: 1001, x: 25, y: 25, completed: false },
  { id: 1002, x: 75, y: 75, completed: false },
  { id: 1003, x: 25, y: 75, completed: false },
  { id: 1004, x: 75, y: 25, completed: false }, 
  { id: 1005, x: 50, y: 50, completed: false }, 
];

interface GazeRecord {
  timestamp: number;
  x: number;
  y: number;
}

interface CapturedImage {
  url: string;
  timestamp: string;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const headPosCanvasRef = useRef<HTMLCanvasElement>(null);
  const currentFaceLandmarksRef = useRef<NormalizedLandmark[] | null>(null);

  // --- STATE ---
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState<AppState>('IDLE');
  const [loadingMsg, setLoadingMsg] = useState('');
  const [sessionSaveStatus, setSessionSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [sessionSaveError, setSessionSaveError] = useState<string | null>(null);
  const [lastSavedCounts, setLastSavedCounts] = useState<{ samples: number; images: number } | null>(null);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [showDemographicsForm, setShowDemographicsForm] = useState(false);
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

  const statusRef = useRef<AppState>('IDLE');
  const configRef = useRef<AppConfig>(DEFAULT_CONFIG); 

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => {
    if (status !== 'CALIBRATION' && status !== 'TRACKING') setLightLevel(null);
  }, [status]);
  useEffect(() => {
    if (status !== 'HEAD_POSITIONING') setStableFrameCount(0);
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
  const exerciseDataRef = useRef<{ screenX: number; screenY: number; features: number[]; head?: HeadSnapshot }[]>([]);
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
  
  const [gazePos, setGazePos] = useState({ x: 0, y: 0 });
  const [rawFeatures, setRawFeatures] = useState<EyeFeatures | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [trackingMode, setTrackingMode] = useState<TrackingMode>('free_gaze');
  const [showStopSaveModal, setShowStopSaveModal] = useState(false);
  const [isBlinking, setIsBlinking] = useState(false);
  
  const [showCamera, setShowCamera] = useState(false);
  const showCameraRef = useRef(false);
  useEffect(() => { showCameraRef.current = showCamera; }, [showCamera]);
  
  // Initialize with Defaults
  const smootherRef = useRef(new GazeSmoother(DEFAULT_CONFIG.minCutoff, DEFAULT_CONFIG.beta)); 
  const requestRef = useRef<number>(0);
  const heatmapRef = useRef<HeatmapRef>(null);
  
  const lastVideoTimeRef = useRef(-1);
  const isCollectingRef = useRef(false);
  const collectionBufferRef = useRef<number[][]>([]);
  const trainingSamplesRef = useRef<TrainingSample[]>([]);
  const validationErrorsRef = useRef<number[]>([]); 
  const timerRef = useRef<(number | ReturnType<typeof setTimeout>)[]>([]);
  const trackingHistoryRef = useRef<GazeRecord[]>([]);

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

  // --- LOAD CONFIG ---
  useEffect(() => {
    const saved = localStorage.getItem('eye_tracker_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setConfig(parsed);
        configRef.current = parsed;
        // Apply to smoother immediately
        smootherRef.current.updateConfig(parsed.smoothingMethod, parsed);
      } catch (e) {
        console.error("Failed to parse config", e);
      }
    }
  }, []);

  const handleSaveConfig = (newConfig: AppConfig) => {
    setConfig(newConfig);
    configRef.current = newConfig;
    localStorage.setItem('eye_tracker_config', JSON.stringify(newConfig));
    // Update live objects
    smootherRef.current.updateConfig(newConfig.smoothingMethod, newConfig);
    setShowSettings(false);
  };

  useEffect(() => {
    const init = async () => {
      setStatus('LOADING_MODEL');
      setLoadingMsg('Initializing Computer Vision Models...');
      try {
        await eyeTrackingService.initialize();
        setLoadingMsg('Models Ready.');
        setStatus('IDLE');
      } catch (err) {
        console.error(err);
        setLoadingMsg('Failed to load models. Check console.');
      }
    };
    init();
  }, []);

  const startCamera = async () => {
    if (!videoRef.current) return;
    try {
      // Prefer 720p for performance; avoid 4K on weak devices. Face landmarker works well at 720p.
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      });
      videoRef.current.srcObject = stream;
      await new Promise((resolve) => {
        if(videoRef.current) videoRef.current.onloadedmetadata = resolve;
      });
      videoRef.current.play();
      processVideo();
    } catch (err) {
      alert("Camera permission denied.");
    }
  };

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
      
      const results = eyeTrackingService.detect(videoRef.current, now);
      
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
            const bctx = bc.getContext('2d');
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
              const validation = eyeTrackingService.validateHeadPosition(landmarks, configRef.current.faceDistance);
              setHeadValidation(validation);
              headValidationRef.current = validation;
              isHeadValidRef.current = validation.valid;

              // Debug log (throttled) during Head Positioning so user can see values in Console
              if (statusRef.current === 'HEAD_POSITIONING' && validation.debug && now - lastHeadDebugLogRef.current > 500) {
                lastHeadDebugLogRef.current = now;
                console.log('[Head Position]', validation.valid ? 'OK' : validation.message, '| faceWidth:', validation.debug.faceWidth.toFixed(3), 'min:', validation.debug.minFaceWidth.toFixed(3), 'max:', validation.debug.maxFaceWidth.toFixed(3), 'target:', validation.debug.targetDistanceCm + 'cm');
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
              if (statusRef.current === 'CALIBRATION' && !validation.valid) {
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

                  if (shouldShowMesh || shouldShowDebug) {
                      ctx.lineWidth = 0.5;
                      ctx.fillStyle = validation.valid ? "#4ade80" : "#ef4444"; 
                      
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
                const features = eyeTrackingService.extractEyeFeatures(landmarks);
                
                if (features) {
                  setRawFeatures(features);
                  const currentStatus = statusRef.current;
                  
                  // 1. Data Collection (grid points)
                  if (currentStatus === 'CALIBRATION' && isCollectingRef.current) {
                    const inputVector = eyeTrackingService.prepareFeatureVector(features);
                    collectionBufferRef.current.push(inputVector);
                  }

                  // 1b. Data Collection (eye movement exercises)
                  if (currentStatus === 'CALIBRATION' && exerciseActiveRef.current) {
                    const target = exerciseTargetRef.current;
                    if (target) {
                      const inputVector = eyeTrackingService.prepareFeatureVector(features);
                      if (runModeRef.current === 'test') {
                        // Test mode: record target vs predicted gaze for deviation charts (throttle ~50ms)
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
                      } else {
                        const len = exerciseDataRef.current.length;
                        exerciseDataRef.current.push({
                          screenX: target.x,
                          screenY: target.y,
                          features: inputVector,
                          head: toHeadSnapshot(headValidationRef.current),
                        });
                        if (len % 5 === 0) {
                          captureCurrentFrameAsBlob().then((b) => b && exerciseBlobsRef.current.push(b));
                        }
                      }
                    }
                  }
                  
                  // 2. Real-time Prediction
                  if (currentStatus === 'TRACKING') {
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
    }
    
    setCalibrationProgress(0);
  };

  const processClickHoldData = () => {
    const rawBuffer = collectionBufferRef.current;
    
    // TEMPORAL TRIMMING: Remove first 20% and last 20% of frames
    // This removes jitter from the click action and the release anticipation
    if (rawBuffer.length > 5) {
        const cutAmount = Math.floor(rawBuffer.length * 0.2);
        // Ensure we have data left after cutting 40%
        if (rawBuffer.length - (cutAmount * 2) > 2) {
             const trimmedBuffer = rawBuffer.slice(cutAmount, rawBuffer.length - cutAmount);
             // Now process this trimmed buffer using standard logic
             processCalibBuffer(trimmedBuffer);
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
      isCollectingRef.current = true;
      setIsCapturing(true);
    }, prepTime);

    const tEnd = setTimeout(() => {
      isCollectingRef.current = false;
      setIsCapturing(false);

      const buffer = collectionBufferRef.current;
      // Use standard cleaning for timer method
      const cleanBuffer = DataCleaner.clean(buffer, configRef.current.outlierMethod, configRef.current.outlierThreshold);
      processCalibBuffer(cleanBuffer);

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

  // Common function to process buffer and advance state
  const processCalibBuffer = (buffer: number[][]) => {
     const point = calibPoints[currentCalibIndex];
     
     if (buffer.length > 2) { 
        const numFeatures = buffer[0].length;
        const avgVector = new Array(numFeatures).fill(0);
        for (const vec of buffer) {
          for (let i = 0; i < numFeatures; i++) {
            avgVector[i] += vec[i];
          }
        }
        for (let i = 0; i < numFeatures; i++) {
          avgVector[i] /= buffer.length;
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

    // Downsample to ~30 training samples per exercise
    const targetCount = 30;
    const step = Math.max(1, Math.floor(trimmed.length / targetCount));
    let added = 0;
    const kindName = EXERCISE_KINDS[currentExerciseIndex] || 'unknown';
    const patternLabel = getPatternDisplayName(kindName as EyeMovementKind);

    for (let i = 0; i < trimmed.length; i += step) {
      const windowEnd = Math.min(i + step, trimmed.length);
      const window = trimmed.slice(i, windowEnd);
      if (window.length === 0) continue;

      const numFeatures = window[0].features.length;
      const avgFeatures = new Array(numFeatures).fill(0);
      let avgX = 0, avgY = 0;

      for (const sample of window) {
        avgX += sample.screenX;
        avgY += sample.screenY;
        for (let j = 0; j < numFeatures; j++) {
          avgFeatures[j] += sample.features[j];
        }
      }

      avgX /= window.length;
      avgY /= window.length;
      for (let j = 0; j < numFeatures; j++) {
        avgFeatures[j] /= window.length;
      }

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
      if (runModeRef.current === 'test') {
        testSegmentStartTimeRef.current = performance.now();
        currentTestSegmentRef.current = [];
      }
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

    const success = hybridRegressorRef.current.train(X, Y);
    if (!success) {
      alert("Calibration failed (Math error). Please try again.");
      reset();
      return;
    }

    console.log(`[Calibration] Trained regressor with ${data.length} total samples (grid + exercises)`);

    setCalibPhase(CalibrationPhase.VALIDATION);
    setCalibPoints(VALIDATION_POINTS);
    setCurrentCalibIndex(0);
    validationErrorsRef.current = [];
  };

  const handleExerciseComplete = useCallback(() => {
    if (runModeRef.current === 'test') {
      testTrajectoryRef.current.push({
        patternName: getPatternDisplayName(exerciseKindRef.current),
        points: [...currentTestSegmentRef.current],
      });
      advanceExercise();
    } else {
      processExerciseData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentExerciseIndex]);

  const finishCurrentPhase = () => {
    if (calibPhase === CalibrationPhase.INITIAL_MAPPING) {
        const data = trainingSamplesRef.current;
        if (data.length < 5) {
            alert("Insufficient data points. Please restart calibration.");
            reset();
            return;
        }

        const X = data.map(d => d.features);
        const Y = data.map(d => [d.screenX, d.screenY]);
        const success = hybridRegressorRef.current.train(X, Y);
        if (!success) {
            alert("Calibration failed (Math error). Please try again.");
            reset();
            return;
        }

        // Test mode: skip EXERCISES + VALIDATION, save session and go to Tracking after first phase
        if (CALIBRATION_TEST_MODE) {
            completeCalibrationAndStartTracking([]);
            return;
        }

        if (configRef.current.enableExercises) {
            console.log(`[Calibration] Grid mapping done with ${data.length} samples, starting exercises...`);
            setCalibPhase(CalibrationPhase.EXERCISES);
            setCurrentExerciseIndex(0);
      exerciseDataRef.current = [];
      exerciseBlobsRef.current = [];
      exerciseKindRef.current = EXERCISE_KINDS[0];
      exerciseActiveRef.current = true;
      if (runModeRef.current === 'test') {
        testSegmentStartTimeRef.current = performance.now();
        currentTestSegmentRef.current = [];
      }
        } else {
            setCalibPhase(CalibrationPhase.VALIDATION);
            setCalibPoints(VALIDATION_POINTS);
            setCurrentCalibIndex(0);
            validationErrorsRef.current = [];
        }
    }
    else if (calibPhase === CalibrationPhase.VALIDATION) {
        completeCalibrationAndStartTracking(validationErrorsRef.current);
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
      const blobToBase64 = (b: Blob): Promise<string> =>
        new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res((r.result as string).split(',')[1] || '');
          r.onerror = rej;
          r.readAsDataURL(b);
        });

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
            ? blobToBase64(videoBlob).then((data) =>
                uploadApi.upload(data, `calibration-${timestamp}.webm`, 'video/webm')
              )
            : Promise.resolve(null),
          runWithConcurrency(
            imageUploads,
            IMAGE_CONCURRENCY,
            async ({ blob, sampleIndex }) => {
              const data = await blobToBase64(blob);
              const url = await uploadApi.upload(
                data,
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
          setStatus('TRACKING');
          statusRef.current = 'TRACKING';
          smootherRef.current.reset();
          if (heatmapRef.current) heatmapRef.current.reset();
          trackingHistoryRef.current = [];
          if (configRef.current.enableVideoRecording) {
            startVideoRecording();
          }
        }, 1200);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setSessionSaveStatus('error');
        setSessionSaveError(msg);
        console.warn('[Session save]', e);
        alert(`Không lưu được session: ${msg}\n\n• Chạy "npm run dev" (Next.js) — API /api chạy cùng origin, không cần set biến môi trường.\n• Nếu dùng host khác: set NEXT_PUBLIC_API_URL trong .env.local.\n• Kiểm tra DB + S3 đã cấu hình đúng (.env.local).`);
      }
    })();
  };

  const predictGaze = (features: EyeFeatures, timestamp: number) => {
    const inputVector = eyeTrackingService.prepareFeatureVector(features);
    
    // Pass the configured method to the regressor
    const prediction = hybridRegressorRef.current.predict(inputVector, configRef.current.regressionMethod);
    
    // Smoother has config injected already
    const smoothed = smootherRef.current.process(prediction.x, prediction.y, timestamp);
    setGazePos(smoothed);

    if (statusRef.current === 'TRACKING') {
      trackingHistoryRef.current.push({
        timestamp: Date.now(),
        x: Math.round(smoothed.x),
        y: Math.round(smoothed.y)
      });
    }
  };

  const handleStartProcess = async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch (e) {
      console.warn("Fullscreen denied", e);
    }
    await startCamera();
    setShowDemographicsForm(false);
    setStatus('HEAD_POSITIONING');
  };

  const handleStartCalibrationClick = () => {
    setShowConsentModal(true);
  };

  const handleConsentAgree = () => {
    setShowConsentModal(false);
    setShowDemographicsForm(true);
  };

  const handleConsentDecline = () => {
    setShowConsentModal(false);
  };

  const handleDemographicsSubmit = (data: DemographicsData) => {
    demographicsRef.current = data;
    handleStartProcess();
  };

  const startActualCalibration = () => {
    setCurrentCalibIndex(0);
    trainingSamplesRef.current = [];
    setTrainingData([]);
    hybridRegressorRef.current = new HybridRegressor();
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

    // Trigger downloads after a short delay so state has settled
    setTimeout(() => {
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
    }, 100);
  };

  const reset = () => {
    stopVideoRecording();
    setStatus('IDLE');
    demographicsRef.current = null;
    setTrainingData([]);
    trainingSamplesRef.current = [];
    trackingHistoryRef.current = [];
    hybridRegressorRef.current = new HybridRegressor();
    setShowHeatmap(false);
    // Reset exercise state
    setCurrentExerciseIndex(0);
    exerciseDataRef.current = [];
    exerciseBlobsRef.current = [];
    exerciseActiveRef.current = false;
    exerciseTargetRef.current = null;
    if (document.fullscreenElement) document.exitFullscreen();
  };

  return (
    <div className="relative w-full h-screen bg-gray-900 text-white overflow-hidden selection:bg-none">
      {/* 
        Video & Canvas Logic:
        1. IDLE: Video hidden, Canvas hidden.
        2. HEAD_POSITIONING: Video VISIBLE (opacity 1), Canvas VISIBLE.
        3. CALIBRATION/TRACKING: Video hidden (unless showCamera), Canvas VISIBLE if invalid head.
        4. MODE: 'object-contain' is used to ensure NO CROP (Full Camera), even if it results in black bars.
      */}
      <video 
        ref={videoRef} 
        className={`fixed top-0 left-0 w-full h-full object-contain transition-opacity duration-300 scale-x-[-1] 
          ${showCamera && status !== 'HEAD_POSITIONING' ? 'opacity-30' : 'opacity-0 pointer-events-none'}
        `} 
        playsInline 
        muted 
      />
      <canvas
        ref={debugCanvasRef}
        className={`fixed top-0 left-0 w-full h-full object-contain transition-opacity duration-300 pointer-events-none scale-x-[-1] 
           ${(showCamera || (headValidation && !headValidation.valid && status !== 'IDLE' && status !== 'HEAD_POSITIONING')) ? 'opacity-100' : 'opacity-0'}
        `}
      />

      {showSettings && (
        <SettingsModal 
          config={config} 
          onSave={handleSaveConfig} 
          onClose={() => setShowSettings(false)} 
        />
      )}

      {showConsentModal && (
        <ConsentModal
          open={showConsentModal}
          onAgree={handleConsentAgree}
          onDecline={handleConsentDecline}
        />
      )}

      {showDemographicsForm && (
        <DemographicsForm
          onSubmit={handleDemographicsSubmit}
          onBack={() => setShowDemographicsForm(false)}
        />
      )}

      {status === 'IDLE' && (
        <div className="flex flex-col items-center justify-center h-full space-y-8 p-4 z-10 relative">
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
            EYE TRACKER
          </h1>

          {/* RECORDED VIDEO DOWNLOAD LINK */}
          {recordedVideoUrl && (
             <div className="bg-gray-800 p-4 rounded-xl border border-green-700 flex flex-col items-center space-y-2 animate-bounce-in">
                <div className="text-green-400 font-bold text-sm uppercase">Last Session Recording Ready</div>
                <a 
                    href={recordedVideoUrl} 
                    download={`eye_tracking_session_${new Date().toISOString()}.webm`}
                    className="px-6 py-2 bg-green-600 hover:bg-green-500 rounded-full font-bold text-white transition-all text-sm"
                >
                    Download Video
                </a>
             </div>
          )}

           {/* CAPTURED IMAGES GALLERY (Simple Grid) */}
           {capturedImages.length > 0 && (
              <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 max-w-2xl w-full">
                  <div className="text-xs font-bold text-gray-400 uppercase mb-2">Captured Faces ({capturedImages.length})</div>
                  <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-thin">
                      {capturedImages.map((img, i) => (
                          <button
                              key={i}
                              type="button"
                              onClick={() => setCapturedImageModalIndex(i)}
                              className="flex-shrink-0 relative group rounded overflow-hidden border-2 border-transparent hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition"
                          >
                              <img src={img.url} alt={`Face ${i + 1}`} className="h-20 w-auto rounded border border-gray-600 pointer-events-none"/>
                              <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-70 text-[8px] p-0.5 text-center text-white">{img.timestamp}</div>
                          </button>
                      ))}
                  </div>
              </div>
           )}

           {capturedImageModalIndex !== null && capturedImages[capturedImageModalIndex] && (
             <CapturedImageModal
               image={capturedImages[capturedImageModalIndex]}
               index={capturedImageModalIndex}
               total={capturedImages.length}
               onClose={() => setCapturedImageModalIndex(null)}
               onPrev={capturedImageModalIndex > 0 ? () => setCapturedImageModalIndex(capturedImageModalIndex - 1) : undefined}
               onNext={capturedImageModalIndex < capturedImages.length - 1 ? () => setCapturedImageModalIndex(capturedImageModalIndex + 1) : undefined}
             />
           )}


          <div className="flex flex-wrap items-center justify-center gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setRunMode('calibration'); setShowConsentModal(true); }}
                className="group relative px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-full transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(37,99,235,0.5)]"
              >
                Start Calibration
              </button>
              <button
                onClick={() => { setRunMode('test'); setShowConsentModal(true); }}
                className="px-8 py-4 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-full transition-all hover:scale-105 active:scale-95 border border-violet-500/50"
              >
                Start Test
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="p-2.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 border border-gray-700 hover:border-gray-600 transition"
              title="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {status === 'LOADING_MODEL' && (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center space-y-4">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <p className={`animate-pulse font-bold ${accuracyScore && accuracyScore > 400 ? 'text-orange-400' : 'text-blue-300'}`}>
              {loadingMsg}
            </p>
            {sessionSaveStatus === 'saving' && (
              <p className="text-sm text-gray-400">You can relax for a moment.</p>
            )}
            {sessionSaveStatus === 'saved' && (
              <p className="text-sm text-green-400">
                Session saved.
                {lastSavedCounts && (
                  <span className="block text-gray-400 text-xs mt-0.5">
                    {lastSavedCounts.samples} samples, {lastSavedCounts.images} images. Go to Admin → Sessions (refresh to see).
                    {lastSavedCounts.samples === 0 && ' — No calibration data.'}
                  </span>
                )}
              </p>
            )}
            {sessionSaveStatus === 'error' && sessionSaveError && (
              <p className="text-sm text-red-400 max-w-md text-center">{sessionSaveError}</p>
            )}
          </div>
        </div>
      )}
      
      {/* HEAD_POSITIONING: Contained camera view (like frontend HeadPoseStep) */}
      {status === 'HEAD_POSITIONING' && (
        <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col items-center justify-center gap-6 p-8">
          <div className="text-center">
            <h2 className="text-xl font-bold text-white uppercase tracking-widest">Head Positioning</h2>
            <p className="text-sm text-gray-500 mt-1">Center your face inside the box</p>
          </div>

          <div className="relative w-full max-w-3xl aspect-video rounded-2xl overflow-hidden border-2 border-gray-700 bg-black shadow-2xl">
            <canvas ref={headPosCanvasRef} className="w-full h-full" />
            
            {positionHoldTime != null && positionHoldTime > 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30">
                <div className="text-8xl font-black text-white drop-shadow-lg animate-pulse">
                  {Math.ceil(positionHoldTime / 1000)}
                </div>
              </div>
            )}
          </div>

          <div className="text-center bg-gray-900 bg-opacity-90 px-6 py-3 rounded-xl border border-gray-800 max-w-lg mx-auto">
            <p className={`text-xl font-bold transition-colors duration-300 ${headValidation?.valid ? 'text-green-400' : 'text-red-400'}`}>
              {headValidation?.message || 'Detecting face...'}
            </p>
            <p className="text-cyan-300 text-sm mt-2 font-mono">
              {headValidation?.debug
                ? `faceWidth: ${headValidation.debug.faceWidth.toFixed(3)} (min: ${headValidation.debug.minFaceWidth.toFixed(3)}, max: ${headValidation.debug.maxFaceWidth.toFixed(3)}) · target ${headValidation.debug.targetDistanceCm}cm`
                : 'Debug: center face in frame to see values (or check Console)'}
            </p>
            <p className="text-gray-300 text-sm mt-1.5 font-mono">
              Stable frames: <span className={headValidation?.valid ? 'text-green-400 font-semibold' : 'text-gray-500'}>{stableFrameCount}</span> / 60
            </p>
          </div>
        </div>
      )}

      {/* Head invalid warning during CALIBRATION / TRACKING */}
      {((status === 'CALIBRATION' || status === 'TRACKING') && headValidation && !headValidation.valid) && (
         <HeadPositionGuide 
            validation={headValidation} 
            countdown={null} 
         />
      )}

      {/* Light level: warning when too dark (value + status shown in DiagnosticsPanel) */}
      {(status === 'CALIBRATION' || status === 'TRACKING') && lightLevel?.status === 'too_dark' && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[181] px-4 py-2 rounded-lg bg-red-900/95 border border-red-500 text-red-100 text-sm font-medium shadow-lg flex items-center gap-2 max-w-md text-center">
          <span aria-hidden>💡</span>
          <span>Lighting is too low for accurate tracking. Add front light or move to a brighter area.</span>
        </div>
      )}
      {status === 'CALIBRATION' && calibPhase !== CalibrationPhase.EXERCISES && (
        <CalibrationLayer
          points={calibPoints}
          currentPointIndex={currentCalibIndex}
          isCapturing={isCapturing}
          phase={calibPhase} 
          method={config.calibrationMethod}
          progress={calibrationProgress}
          onPointMouseDown={handlePointMouseDown}
          onPointMouseUp={() => handlePointMouseUp(false)}
        />
      )}

      {status === 'CALIBRATION' && calibPhase === CalibrationPhase.EXERCISES && (
        <EyeMovementLayer
          key={`exercise-${currentExerciseIndex}`}
          kind={EXERCISE_KINDS[currentExerciseIndex]}
          targetRef={exerciseTargetRef}
          onComplete={handleExerciseComplete}
        />
      )}

      {status === 'TRACKING' && (
        <>
           {/* Gaze cursor & heatmap — always visible when head is valid */}
           {headValidation && headValidation.valid && (
               <>
                <HeatmapLayer ref={heatmapRef} x={gazePos.x} y={gazePos.y} enabled={showHeatmap && trackingMode === 'free_gaze'} />
                <GazeCursor x={gazePos.x} y={gazePos.y} />
               </>
           )}

           {/* Mode-specific overlays */}
           {trackingMode === 'random_dots' && (
             <RandomDotsOverlay gazeX={gazePos.x} gazeY={gazePos.y} />
           )}
           {trackingMode === 'article_reading' && (
             <ArticleReadingOverlay gazeX={gazePos.x} gazeY={gazePos.y} />
           )}
          
          {/* TOOLBAR — fixed layout, no jump when switching modes */}
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-2 bg-gray-900 bg-opacity-90 p-2 rounded-lg border border-gray-700 shadow-xl">
             {/* REC INDICATOR */}
             {isRecording && (
                <div className="flex items-center space-x-1.5 px-2 flex-shrink-0">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse shadow-[0_0_8px_red]"></div>
                    <span className="text-[10px] font-bold text-red-200">REC</span>
                </div>
             )}
             <div className="w-px h-6 bg-gray-700 flex-shrink-0" />

             {/* MODE SELECTOR — fixed width buttons to prevent text jump */}
             <div className="flex items-center bg-gray-800 rounded-md p-0.5 flex-shrink-0">
               <button
                 onClick={() => setTrackingMode('free_gaze')}
                 className={`w-[4.75rem] py-1.5 text-xs font-bold rounded transition-colors ${trackingMode === 'free_gaze' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
               >
                 Free Gaze
               </button>
               <button
                 onClick={() => setTrackingMode('random_dots')}
                 className={`w-[4.25rem] py-1.5 text-xs font-bold rounded transition-colors ${trackingMode === 'random_dots' ? 'bg-emerald-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
               >
                 Dot Test
               </button>
               <button
                 onClick={() => setTrackingMode('article_reading')}
                 className={`w-[4rem] py-1.5 text-xs font-bold rounded transition-colors ${trackingMode === 'article_reading' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
               >
                 Article
               </button>
             </div>
             <div className="w-px h-6 bg-gray-700 flex-shrink-0" />

             {/* HEATMAP SWITCHER — always visible; enabled only when Free Gaze */}
             <div className="flex items-center gap-2 min-w-[11rem] flex-shrink-0">
               <span className={`text-xs font-medium whitespace-nowrap ${trackingMode === 'free_gaze' ? 'text-gray-300' : 'text-gray-500'}`}>
                 Heatmap
               </span>
               <button
                 role="switch"
                 aria-checked={showHeatmap}
                 onClick={() => trackingMode === 'free_gaze' && setShowHeatmap(!showHeatmap)}
                 disabled={trackingMode !== 'free_gaze'}
                 className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900
                   ${trackingMode !== 'free_gaze' ? 'cursor-not-allowed bg-gray-700 opacity-50' : showHeatmap ? 'bg-orange-600' : 'bg-gray-600 hover:bg-gray-500'}`}
               >
                 <span
                   className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5 ${showHeatmap ? 'translate-x-4' : 'translate-x-0'}`}
                 />
               </button>
               <button
                 onClick={() => heatmapRef.current?.reset()}
                 disabled={trackingMode !== 'free_gaze' || !showHeatmap}
                 className={`px-3 py-1 text-xs font-bold rounded-md flex-shrink-0 transition-colors ${
                   trackingMode === 'free_gaze' && showHeatmap
                     ? 'bg-gray-700 text-gray-300 hover:bg-red-900 hover:text-white cursor-pointer'
                     : 'bg-gray-700 text-gray-500 opacity-50 cursor-not-allowed'
                 }`}
               >
                 Clear
               </button>
             </div>
             <div className="w-px h-6 bg-gray-700 flex-shrink-0" />

             <button onClick={() => setShowStopSaveModal(true)} className="px-4 py-1.5 text-xs font-bold rounded-md bg-gray-800 border border-gray-600 hover:bg-gray-700 transition text-red-300 flex-shrink-0">Stop & Save</button>
          </div>

          {/* Stop & Save modal: choose what to download */}
          {showStopSaveModal && (
            <StopSaveModal
              hasCsvData={trackingHistoryRef.current.length > 0}
              hasVideo={isRecording || !!recordedVideoUrl}
              hasImages={capturedImages.length > 0}
              onConfirm={handleStopSaveConfirm}
              onCancel={() => setShowStopSaveModal(false)}
            />
          )}
          
          {/* TRACKING SIDEBAR: CAPTURED IMAGES */}
          {config.faceCaptureInterval > 0 && capturedImages.length > 0 && (
              <div className="fixed right-4 top-1/2 -translate-y-1/2 flex flex-col space-y-2 z-[200] max-h-[60vh] overflow-y-auto scrollbar-thin">
                  {capturedImages.slice(-4).map((img, i) => (
                      <div key={i} className="relative w-24 h-24 border-2 border-gray-700 rounded-lg overflow-hidden bg-black shadow-lg">
                          <img src={img.url} className="w-full h-full object-cover" alt="face" />
                      </div>
                  ))}
              </div>
          )}
          
          {accuracyScore !== null && (
             <div className={`fixed top-20 left-1/2 -translate-x-1/2 bg-opacity-90 text-xs px-4 py-2 rounded-full pointer-events-none font-bold border ${accuracyScore < 300 ? 'bg-green-900 text-green-300 border-green-700' : 'bg-red-900 text-red-300 border-red-700'}`}>
                {accuracyScore < 300 ? 'Good Accuracy' : 'Low Accuracy'} (Mean Error: {accuracyScore.toFixed(0)}px)
             </div>
          )}
        </>
      )}

      {/* Diagnostics Panel (Now Draggable) — only when calibrating or tracking, not during load */}
      {(status === 'CALIBRATION' || status === 'TRACKING') && (
         <DiagnosticsPanel 
            showCamera={showCamera}
            setShowCamera={setShowCamera}
            headValidation={headValidation}
            rawFeatures={rawFeatures}
            capturedImagesCount={capturedImages.length}
            isBlinking={isBlinking}
            status={status}
            lightLevel={lightLevel}
         />
      )}
    </div>
  );
}

export default App;