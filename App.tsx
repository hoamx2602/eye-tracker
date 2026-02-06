import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  AppState, 
  CalibrationPhase,
  CalibrationPoint, 
  EyeFeatures, 
  TrainingSample,
  EyeLandmarkIndices,
  AppConfig,
  DEFAULT_CONFIG
} from './types';
import { eyeTrackingService, HeadValidationResult } from './services/eyeTrackingService';
import { HybridRegressor, GazeSmoother, DataCleaner } from './services/mathUtils';
import CalibrationLayer from './components/CalibrationLayer';
import GazeCursor from './components/GazeCursor';
import HeatmapLayer, { HeatmapRef } from './components/HeatmapLayer';
import SettingsModal from './components/SettingsModal';
import HeadPositionGuide from './components/HeadPositionGuide';
import { FaceLandmarkerResult, NormalizedLandmark } from "@mediapipe/tasks-vision";

// --- CONFIGURATION ---
const EDGE_PAD = 4;
const P_MIN = EDGE_PAD;
const P_MAX = 100 - EDGE_PAD;
const P_MID_1 = 33; 
const P_MID_2 = 67; 

// --- DEFINING THE 3 STEPS ---
const STEP_1_POINTS: CalibrationPoint[] = [
  { id: 1, x: 50, y: 50, completed: false }, 
  { id: 2, x: 50, y: P_MIN, completed: false }, 
  { id: 3, x: 50, y: P_MAX, completed: false }, 
  { id: 4, x: P_MIN, y: 50, completed: false }, 
  { id: 5, x: P_MAX, y: 50, completed: false }, 
];

const STEP_2_POINTS: CalibrationPoint[] = [
  { id: 6, x: P_MIN, y: P_MIN, completed: false },
  { id: 7, x: P_MID_1, y: P_MIN, completed: false },
  { id: 8, x: P_MID_2, y: P_MIN, completed: false },
  { id: 9, x: P_MAX, y: P_MIN, completed: false },
  { id: 10, x: P_MIN, y: P_MID_1, completed: false },
  { id: 11, x: P_MID_1, y: P_MID_1, completed: false },
  { id: 12, x: P_MID_2, y: P_MID_1, completed: false },
  { id: 13, x: P_MAX, y: P_MID_1, completed: false },
  { id: 14, x: P_MIN, y: P_MID_2, completed: false },
  { id: 15, x: P_MID_1, y: P_MID_2, completed: false },
  { id: 16, x: P_MID_2, y: P_MID_2, completed: false },
  { id: 17, x: P_MAX, y: P_MID_2, completed: false },
  { id: 18, x: P_MIN, y: P_MAX, completed: false },
  { id: 19, x: P_MID_1, y: P_MAX, completed: false },
  { id: 20, x: P_MID_2, y: P_MAX, completed: false },
  { id: 21, x: P_MAX, y: P_MAX, completed: false },
];

const STEP_3_POINTS: CalibrationPoint[] = [
  { id: 22, x: 25, y: 25, completed: false },
  { id: 23, x: 75, y: 75, completed: false },
  { id: 24, x: 25, y: 75, completed: false },
  { id: 25, x: 75, y: 25, completed: false }, 
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

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null); 

  // --- STATE ---
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState<AppState>('IDLE');
  const [loadingMsg, setLoadingMsg] = useState('');
  
  // Head Positioning State
  const [headValidation, setHeadValidation] = useState<HeadValidationResult | null>(null);
  const [positionHoldTime, setPositionHoldTime] = useState<number | null>(null);
  const headPosStartTimeRef = useRef<number | null>(null);
  
  const hybridRegressorRef = useRef<HybridRegressor>(new HybridRegressor());
  const [calibPhase, setCalibPhase] = useState<CalibrationPhase>(CalibrationPhase.INITIAL_MAPPING);

  const statusRef = useRef<AppState>('IDLE');
  const configRef = useRef<AppConfig>(DEFAULT_CONFIG); 

  useEffect(() => { statusRef.current = status; }, [status]);
  
  const [calibPoints, setCalibPoints] = useState<CalibrationPoint[]>(STEP_1_POINTS);
  const [currentCalibIndex, setCurrentCalibIndex] = useState(0);
  // Dummy state to force re-run of calibration effect for retries. Defined here to be available for useEffect.
  const [retryCount, setRetryCount] = useState(0);

  const [trainingData, setTrainingData] = useState<TrainingSample[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [accuracyScore, setAccuracyScore] = useState<number | null>(null);
  
  const [gazePos, setGazePos] = useState({ x: 0, y: 0 });
  const [rawFeatures, setRawFeatures] = useState<EyeFeatures | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
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
  const timerRef = useRef<number[]>([]);
  const trackingHistoryRef = useRef<GazeRecord[]>([]);

  // Ref to hold the current validity for async access in loops
  const isHeadValidRef = useRef<boolean>(true);

  // --- RECORDING STATE ---
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  
  // --- FACE CAPTURE STATE ---
  const [capturedImages, setCapturedImages] = useState<CapturedImage[]>([]);
  const lastCaptureTimeRef = useRef<number>(0);

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
      // Use default camera constraints for native resolution
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'user' 
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
          // Note: The video element is usually mirrored via CSS (scale-x-[-1]), 
          // but the raw video data is NOT mirrored. 
          // We must mirror the drawing if we want the output to match the screen view,
          // OR keep it raw. Usually raw is better for data, but mirrored is better for UI.
          // Let's keep it raw (true to camera) for now to avoid complexity.
          
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
          // Sync size
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
          }

          // Clear previous frame
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (results && results.faceLandmarks.length > 0) {
              const landmarks = results.faceLandmarks[0];

              // --- CONTINUOUS HEAD VALIDATION ---
              // We run this ALWAYS when a face is found
              const validation = eyeTrackingService.validateHeadPosition(landmarks);
              setHeadValidation(validation);
              isHeadValidRef.current = validation.valid;

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
                  // Initial Step Countdown Logic
                  if (validation.valid) {
                      if (!headPosStartTimeRef.current) {
                          headPosStartTimeRef.current = now;
                      }
                      const elapsed = now - headPosStartTimeRef.current;
                      const remaining = Math.max(0, 2000 - elapsed);
                      setPositionHoldTime(remaining);
                      
                      if (remaining === 0) {
                          headPosStartTimeRef.current = null;
                          setPositionHoldTime(null);
                          startActualCalibration();
                      }
                  } else {
                      headPosStartTimeRef.current = null;
                      setPositionHoldTime(null);
                  }
              }

              // Draw Face Mesh
              const shouldShowMesh = statusRef.current === 'HEAD_POSITIONING' || !validation.valid;
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
          } else {
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
                  
                  // 1. Data Collection
                  if (currentStatus === 'CALIBRATION' && isCollectingRef.current) {
                    const inputVector = eyeTrackingService.prepareFeatureVector(features);
                    collectionBufferRef.current.push(inputVector);
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

  // --- CALIBRATION LOGIC ENGINE ---
  useEffect(() => {
    if (status !== 'CALIBRATION') {
      timerRef.current.forEach(clearTimeout);
      timerRef.current = [];
      isCollectingRef.current = false;
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
      
      // Clean data
      const cleanBuffer = DataCleaner.clean(buffer, configRef.current.outlierMethod, configRef.current.outlierThreshold);

      if (cleanBuffer.length > 5) { 
        const numFeatures = cleanBuffer[0].length;
        const avgVector = new Array(numFeatures).fill(0);
        for (const vec of cleanBuffer) {
          for (let i = 0; i < numFeatures; i++) {
            avgVector[i] += vec[i];
          }
        }
        for (let i = 0; i < numFeatures; i++) {
          avgVector[i] /= cleanBuffer.length;
        }

        const screenX = (point.x / 100) * window.innerWidth;
        const screenY = (point.y / 100) * window.innerHeight;

        if (calibPhase !== CalibrationPhase.VALIDATION) {
            const newSample: TrainingSample = { screenX, screenY, features: avgVector };
            trainingSamplesRef.current.push(newSample);
            setTrainingData([...trainingSamplesRef.current]);
        } else {
            const prediction = hybridRegressorRef.current.predict(avgVector, configRef.current.regressionMethod);
            const err = Math.sqrt(Math.pow(prediction.x - screenX, 2) + Math.pow(prediction.y - screenY, 2));
            validationErrorsRef.current.push(err);
            console.log(`Validation Point ${currentCalibIndex}: Error ${err.toFixed(1)}px`);
        }

        // Advance only if successful
        if (currentCalibIndex < calibPoints.length - 1) {
            setCurrentCalibIndex(prev => prev + 1);
        } else {
            finishCurrentPhase();
        }

      } else {
          console.warn(`Point ${currentCalibIndex} skipped/retrying: Insufficient clean data`);
          setRetryCount(c => c + 1); 
      }
    }, prepTime + captureTime);

    timerRef.current.push(tStart, tEnd);

    return () => {
      timerRef.current.forEach(clearTimeout);
      timerRef.current = [];
    };

  }, [currentCalibIndex, status, calibPoints, calibPhase, config.calibrationSpeed, retryCount]);

  const finishCurrentPhase = () => {
    if (calibPhase === CalibrationPhase.INITIAL_MAPPING || calibPhase === CalibrationPhase.FINE_TUNING) {
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

        if (calibPhase === CalibrationPhase.INITIAL_MAPPING) {
            setCalibPhase(CalibrationPhase.FINE_TUNING);
            setCalibPoints(STEP_2_POINTS);
            setCurrentCalibIndex(0);
        } else {
            setCalibPhase(CalibrationPhase.VALIDATION);
            setCalibPoints(STEP_3_POINTS);
            setCurrentCalibIndex(0);
            validationErrorsRef.current = []; 
        }
    } 
    else if (calibPhase === CalibrationPhase.VALIDATION) {
        const errors = validationErrorsRef.current;
        const avgError = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 999;
        
        setAccuracyScore(avgError);
        const isAccuracyGood = avgError < 300; 
        
        const statusMsg = isAccuracyGood 
          ? `Calibration Success! Mean Error: ${Math.round(avgError)}px` 
          : `Calibration Complete (Accuracy: ${Math.round(avgError)}px)`;

        setLoadingMsg(statusMsg);
        setStatus('LOADING_MODEL'); 
        
        setTimeout(() => {
            // --- START TRACKING & RECORDING ---
            setStatus('TRACKING');
            statusRef.current = 'TRACKING';
            smootherRef.current.reset();
            if(heatmapRef.current) heatmapRef.current.reset();
            trackingHistoryRef.current = [];
            
            if (configRef.current.enableVideoRecording) {
                startVideoRecording();
            }
        }, 1500);
    }
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
    setStatus('HEAD_POSITIONING');
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
    
    setCalibPhase(CalibrationPhase.INITIAL_MAPPING);
    setCalibPoints(STEP_1_POINTS);
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

  const reset = () => {
    stopVideoRecording();
    setStatus('IDLE');
    setTrainingData([]);
    trainingSamplesRef.current = [];
    trackingHistoryRef.current = [];
    hybridRegressorRef.current = new HybridRegressor();
    setShowHeatmap(false);
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
          ${status === 'HEAD_POSITIONING' ? 'opacity-50' : (showCamera ? 'opacity-30' : 'opacity-0 pointer-events-none')}
        `} 
        playsInline 
        muted 
      />
      <canvas
        ref={debugCanvasRef}
        className={`fixed top-0 left-0 w-full h-full object-contain transition-opacity duration-300 pointer-events-none scale-x-[-1] 
           ${status === 'HEAD_POSITIONING' || showCamera || (headValidation && !headValidation.valid && status !== 'IDLE') ? 'opacity-100' : 'opacity-0'}
        `}
      />

      {showSettings && (
        <SettingsModal 
          config={config} 
          onSave={handleSaveConfig} 
          onClose={() => setShowSettings(false)} 
        />
      )}

      {status === 'IDLE' && (
        <div className="flex flex-col items-center justify-center h-full space-y-8 p-4 z-10 relative">
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
            EYE TRACKER
          </h1>
          <p className="max-w-md text-center text-gray-400">
            Precision Hybrid Calibration (TPS + Ridge).
          </p>

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
                          <div key={i} className="flex-shrink-0 relative group">
                              <img src={img.url} alt="capture" className="h-20 w-auto rounded border border-gray-600"/>
                              <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-70 text-[8px] p-0.5 text-center">{img.timestamp}</div>
                          </div>
                      ))}
                  </div>
              </div>
           )}


          <div className="flex space-x-4">
            <button
                onClick={handleStartProcess}
                className="group relative px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-full transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(37,99,235,0.5)]"
            >
                Start Calibration
            </button>
            <button 
                onClick={() => setShowSettings(true)}
                className="px-8 py-4 bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold rounded-full transition-all hover:scale-105 border border-gray-600"
            >
                Settings
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
          </div>
        </div>
      )}
      
      {/* 
        Head Guide shows:
        1. In HEAD_POSITIONING mode (Setup)
        2. In CALIBRATION mode IF head is INVALID (Interruption)
        3. In TRACKING mode IF head is INVALID (Interruption)
      */}
      {(status === 'HEAD_POSITIONING' || ((status === 'CALIBRATION' || status === 'TRACKING') && headValidation && !headValidation.valid)) && (
         <HeadPositionGuide 
            validation={headValidation} 
            countdown={status === 'HEAD_POSITIONING' ? positionHoldTime : null} 
         />
      )}

      {status === 'CALIBRATION' && (
        <CalibrationLayer
          points={calibPoints}
          currentPointIndex={currentCalibIndex}
          isCapturing={isCapturing}
          phase={calibPhase} 
        />
      )}

      {status === 'TRACKING' && (
        <>
           {/* Only show tracking feedback if head is valid to prevent garbage data display */}
           {headValidation && headValidation.valid && (
               <>
                <HeatmapLayer ref={heatmapRef} x={gazePos.x} y={gazePos.y} enabled={showHeatmap} />
                <GazeCursor x={gazePos.x} y={gazePos.y} />
               </>
           )}
          
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex items-center space-x-2 bg-gray-900 bg-opacity-90 p-2 rounded-lg border border-gray-700 shadow-xl">
             {/* REC INDICATOR */}
             {isRecording && (
                <div className="flex items-center space-x-1.5 px-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse shadow-[0_0_8px_red]"></div>
                    <span className="text-[10px] font-bold text-red-200">REC</span>
                </div>
             )}
             <div className="w-px h-6 bg-gray-700 mx-1"></div>

             <button
               onClick={() => setShowHeatmap(!showHeatmap)}
               className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${showHeatmap ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
             >
               {showHeatmap ? 'Hide Heatmap' : 'Show Heatmap'}
             </button>
             {showHeatmap && (
                <button onClick={() => heatmapRef.current?.reset()} className="px-4 py-1.5 text-xs font-bold rounded-md bg-gray-700 text-gray-300 hover:bg-red-900 hover:text-white transition-colors">Clear Map</button>
             )}
             <div className="w-px h-6 bg-gray-700 mx-2"></div>
             <button onClick={handleDownloadCSV} className="px-4 py-1.5 text-xs font-bold rounded-md bg-green-700 text-white hover:bg-green-600 transition-colors shadow-sm">
                Download CSV
             </button>
             <div className="w-px h-6 bg-gray-700 mx-2"></div>
             <button onClick={() => setShowSettings(true)} className="px-4 py-1.5 text-xs font-bold rounded-md bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">
                Settings
             </button>
             <div className="w-px h-6 bg-gray-700 mx-2"></div>
             <button onClick={reset} className="px-4 py-1.5 text-xs font-bold rounded-md bg-gray-800 border border-gray-600 hover:bg-gray-700 transition text-red-300">Stop & Save</button>
          </div>
          
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

      {/* Diagnostics Panel */}
      {status !== 'HEAD_POSITIONING' && (
        <div className="fixed bottom-4 left-4 bg-black bg-opacity-80 p-3 rounded border border-gray-800 z-[200]">
            <h4 className="text-gray-500 text-[10px] uppercase tracking-wider mb-2">Diagnostics</h4>
            
            <div className="flex items-center space-x-2 mb-2">
                <button 
                    onClick={() => setShowCamera(!showCamera)}
                    className={`w-3 h-3 rounded-full ${showCamera ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]' : 'bg-gray-600'}`}
                />
                <span className="text-[10px] text-gray-400">Show Debug View</span>
            </div>
            
            {/* Show detailed head status in diagnostics */}
            {headValidation && (
                <div className={`text-xs font-bold mb-1 ${headValidation.valid ? 'text-green-500' : 'text-red-500'}`}>
                    Head: {headValidation.message}
                </div>
            )}

            {rawFeatures && rawFeatures.headPose && (
            <div className="text-[9px] text-gray-400 font-mono space-y-1 mb-2">
                <div>Pitch: {(rawFeatures.headPose.pitch * 180 / Math.PI).toFixed(1)}°</div>
                <div>Yaw:   {(rawFeatures.headPose.yaw * 180 / Math.PI).toFixed(1)}°</div>
                <div>Roll:  {(rawFeatures.headPose.roll * 180 / Math.PI).toFixed(1)}°</div>
            </div>
            )}
            
            <div className="text-[9px] text-gray-500">
                Imgs Captured: {capturedImages.length}
            </div>

            {isBlinking && <div className="text-red-500 font-bold text-xs mb-1">BLINK DETECTED</div>}
            <div className="text-[10px] text-gray-600">Status: {status}</div>
        </div>
      )}
    </div>
  );
}

export default App;