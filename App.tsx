import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera } from '@mediapipe/camera_utils';
import { 
  AppState, 
  CalibrationPhase,
  CalibrationPoint, 
  EyeFeatures, 
  TrainingSample 
} from './types';
import { eyeTrackingService } from './services/eyeTrackingService';
import { Matrix, KalmanSmoother } from './services/mathUtils';
import CalibrationLayer from './components/CalibrationLayer';
import GazeCursor from './components/GazeCursor';
import HeatmapLayer, { HeatmapRef } from './components/HeatmapLayer';

// --- CONFIGURATION ---
const EDGE_PAD = 3; // 3% padding (Very close to edge)
const P_MIN = EDGE_PAD;
const P_MAX = 100 - EDGE_PAD;
const P_MID_1 = 33; // ~1/3 screen
const P_MID_2 = 67; // ~2/3 screen

// --- DEFINING THE 3 STEPS ---

// Step 1: Core Mapping (5 Points) - Center + Cardinal Directions
// Establish the main axes first.
const STEP_1_POINTS: CalibrationPoint[] = [
  { id: 1, x: 50, y: 50, completed: false }, // Center
  { id: 2, x: 50, y: P_MIN, completed: false }, // Top Edge
  { id: 3, x: 50, y: P_MAX, completed: false }, // Bot Edge
  { id: 4, x: P_MIN, y: 50, completed: false }, // Left Edge
  { id: 5, x: P_MAX, y: 50, completed: false }, // Right Edge
];

// Step 2: Dense Grid (16 Points) - Covers Corners and Intermediate zones
// Total Training Points = 5 + 16 = 21 Points
const STEP_2_POINTS: CalibrationPoint[] = [
  // Row 1 (Top)
  { id: 6, x: P_MIN, y: P_MIN, completed: false },
  { id: 7, x: P_MID_1, y: P_MIN, completed: false },
  { id: 8, x: P_MID_2, y: P_MIN, completed: false },
  { id: 9, x: P_MAX, y: P_MIN, completed: false },
  
  // Row 2 (Upper Mid)
  { id: 10, x: P_MIN, y: P_MID_1, completed: false },
  { id: 11, x: P_MID_1, y: P_MID_1, completed: false },
  { id: 12, x: P_MID_2, y: P_MID_1, completed: false },
  { id: 13, x: P_MAX, y: P_MID_1, completed: false },

  // Row 3 (Lower Mid)
  { id: 14, x: P_MIN, y: P_MID_2, completed: false },
  { id: 15, x: P_MID_1, y: P_MID_2, completed: false },
  { id: 16, x: P_MID_2, y: P_MID_2, completed: false },
  { id: 17, x: P_MAX, y: P_MID_2, completed: false },

  // Row 4 (Bottom)
  { id: 18, x: P_MIN, y: P_MAX, completed: false },
  { id: 19, x: P_MID_1, y: P_MAX, completed: false },
  { id: 20, x: P_MID_2, y: P_MAX, completed: false },
  { id: 21, x: P_MAX, y: P_MAX, completed: false },
];

// Step 3: Validation (Random spots inside to test accuracy)
const STEP_3_POINTS: CalibrationPoint[] = [
  { id: 22, x: 20, y: 20, completed: false },
  { id: 23, x: 80, y: 80, completed: false },
  { id: 24, x: 20, y: 80, completed: false },
  { id: 25, x: 80, y: 20, completed: false }, // Added a 4th validation point
];

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<AppState>('IDLE');
  const [loadingMsg, setLoadingMsg] = useState('');
  
  // Model & Phase
  const [regressionModel, setRegressionModel] = useState<number[][] | null>(null);
  const [calibPhase, setCalibPhase] = useState<CalibrationPhase>(CalibrationPhase.INITIAL_MAPPING);

  // Refs for loop
  const statusRef = useRef<AppState>('IDLE');
  const regressionModelRef = useRef<number[][] | null>(null);

  // Sync state to refs
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { regressionModelRef.current = regressionModel; }, [regressionModel]);
  
  // Calibration State
  const [calibPoints, setCalibPoints] = useState<CalibrationPoint[]>(STEP_1_POINTS);
  const [currentCalibIndex, setCurrentCalibIndex] = useState(0);
  const [trainingData, setTrainingData] = useState<TrainingSample[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [accuracyScore, setAccuracyScore] = useState<number | null>(null); // Validation Error in Pixels
  
  // Tracking State
  const [gazePos, setGazePos] = useState({ x: 0, y: 0 });
  const [rawFeatures, setRawFeatures] = useState<EyeFeatures | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [isBlinking, setIsBlinking] = useState(false);
  
  // Logic Refs
  const lastVideoTimeRef = useRef(-1);
  const smootherRef = useRef(new KalmanSmoother(0.15));
  const requestRef = useRef<number>(0);
  const heatmapRef = useRef<HeatmapRef>(null);
  
  // Data Collection Refs
  const isCollectingRef = useRef(false);
  const collectionBufferRef = useRef<number[][]>([]);
  const trainingSamplesRef = useRef<TrainingSample[]>([]); // Accumulates over steps
  const validationErrorsRef = useRef<number[]>([]); 
  const timerRef = useRef<number[]>([]);

  // Initialize MediaPipe
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

  // Setup Camera
  const startCamera = async () => {
    if (!videoRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 640, height: 480, facingMode: 'user' } 
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

  const processVideo = useCallback(() => {
    if (!videoRef.current) return;
    
    const now = performance.now();
    if (videoRef.current.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = videoRef.current.currentTime;
      
      const results = eyeTrackingService.detect(videoRef.current, now);
      
      if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];
        
        const blinking = eyeTrackingService.isBlinking(landmarks);
        setIsBlinking(blinking);

        if (blinking) {
           requestRef.current = requestAnimationFrame(processVideo);
           return;
        }

        const features = eyeTrackingService.extractEyeFeatures(landmarks);
        
        if (features) {
          setRawFeatures(features);
          
          const currentStatus = statusRef.current;
          const currentModel = regressionModelRef.current;

          // 1. Data Collection (Calibration or Validation)
          if (currentStatus === 'CALIBRATION' && isCollectingRef.current) {
             const inputVector = eyeTrackingService.prepareFeatureVector(features);
             collectionBufferRef.current.push(inputVector);
          }
          
          // 2. Real-time Prediction
          if (currentStatus === 'TRACKING' && currentModel) {
             predictGaze(features, currentModel);
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

    // 1. Wait 0.8s for eye movement (Faster paced since we have more points)
    const tStart = setTimeout(() => {
      collectionBufferRef.current = [];
      isCollectingRef.current = true;
      setIsCapturing(true);
    }, 800);

    // 2. Stop after 1.2s of data
    const tEnd = setTimeout(() => {
      isCollectingRef.current = false;
      setIsCapturing(false);

      // --- PROCESSING DATA ---
      const buffer = collectionBufferRef.current;
      if (buffer.length > 5) { 
        // Filter Outliers (IQR on X-axis feature)
        buffer.sort((a, b) => a[1] - b[1]); 
        const trimCount = Math.floor(buffer.length * 0.15); // Trim 15% from ends
        const cleanBuffer = buffer.slice(trimCount, buffer.length - trimCount);

        // Average
        const numFeatures = buffer[0].length;
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

        // Logic split based on PHASE
        if (calibPhase !== CalibrationPhase.VALIDATION) {
            // Training Phase: Add to dataset
            const newSample: TrainingSample = { screenX, screenY, features: avgVector };
            trainingSamplesRef.current.push(newSample);
            setTrainingData([...trainingSamplesRef.current]);
        } else {
            // Validation Phase: Check Error
            if (regressionModelRef.current) {
                // Predict using current model
                const model = regressionModelRef.current;
                let pX = 0, pY = 0;
                for(let k=0; k<avgVector.length; k++) {
                    pX += avgVector[k] * model[k][0];
                    pY += avgVector[k] * model[k][1];
                }
                const err = Math.sqrt(Math.pow(pX - screenX, 2) + Math.pow(pY - screenY, 2));
                validationErrorsRef.current.push(err);
                console.log(`Validation Point ${currentCalibIndex}: Error ${err.toFixed(1)}px`);
            }
        }
      }

      // Next Point
      if (currentCalibIndex < calibPoints.length - 1) {
        setCurrentCalibIndex(prev => prev + 1);
      } else {
        finishCurrentPhase();
      }
    }, 2000); // 2s per point total

    timerRef.current.push(tStart, tEnd);

    return () => {
      timerRef.current.forEach(clearTimeout);
      timerRef.current = [];
    };

  }, [currentCalibIndex, status, calibPoints, calibPhase]);

  const finishCurrentPhase = () => {
    // Phase 1 or 2 -> Train and Advance
    if (calibPhase === CalibrationPhase.INITIAL_MAPPING || calibPhase === CalibrationPhase.FINE_TUNING) {
        const data = trainingSamplesRef.current;
        if (data.length < 5) {
            alert("Insufficient data points. Please restart calibration.");
            reset();
            return;
        }

        // TRAIN
        const X = data.map(d => d.features);
        const Y = data.map(d => [d.screenX, d.screenY]);
        
        let weights;
        // Use RANSAC only if we have plenty of data (Step 2)
        if (data.length >= 9) {
            weights = Matrix.solveRANSAC(X, Y);
        } else {
            weights = Matrix.solveLeastSquares(X, Y);
        }

        if (!weights) {
            console.warn("Regression failed (Singular Matrix)");
            alert("Calibration failed. Please try again and ensure you look at the dots.");
            reset();
            return;
        }

        setRegressionModel(weights);
        regressionModelRef.current = weights;

        // Advance Phase
        if (calibPhase === CalibrationPhase.INITIAL_MAPPING) {
            setCalibPhase(CalibrationPhase.FINE_TUNING);
            setCalibPoints(STEP_2_POINTS);
            setCurrentCalibIndex(0);
        } else {
            setCalibPhase(CalibrationPhase.VALIDATION);
            setCalibPoints(STEP_3_POINTS);
            setCurrentCalibIndex(0);
            validationErrorsRef.current = []; // Reset validation metrics
        }
    } 
    // Phase 3 -> Validate
    else if (calibPhase === CalibrationPhase.VALIDATION) {
        const errors = validationErrorsRef.current;
        
        let avgError = 0;
        if (errors.length > 0) {
           avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
        } else {
           avgError = 999;
        }
        
        setAccuracyScore(avgError);

        const isAccuracyGood = avgError < 350;
        
        const statusMsg = isAccuracyGood 
          ? `Calibration Success! Error: ${Math.round(avgError)}px` 
          : `Calibration Complete (Low Accuracy: ${Math.round(avgError)}px)`;

        setLoadingMsg(statusMsg);
        setStatus('LOADING_MODEL'); 
        
        setTimeout(() => {
            setStatus('TRACKING');
            statusRef.current = 'TRACKING';
            smootherRef.current.reset();
            if(heatmapRef.current) heatmapRef.current.reset();
        }, 1500);
    }
  };

  const predictGaze = (features: EyeFeatures, model: number[][]) => {
    const inputVector = eyeTrackingService.prepareFeatureVector(features);
    let screenX = 0;
    let screenY = 0;
    
    for (let i = 0; i < inputVector.length; i++) {
      screenX += inputVector[i] * model[i][0];
      screenY += inputVector[i] * model[i][1];
    }
    
    const smoothed = smootherRef.current.process(screenX, screenY);
    setGazePos(smoothed);
  };

  const handleStartCalibration = async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch (e) {
      console.warn("Fullscreen denied", e);
    }
    await startCamera();
    
    // Reset Everything
    setCurrentCalibIndex(0);
    trainingSamplesRef.current = [];
    setTrainingData([]);
    setRegressionModel(null);
    smootherRef.current.reset();
    validationErrorsRef.current = [];
    setAccuracyScore(null);
    
    // Start Step 1
    setCalibPhase(CalibrationPhase.INITIAL_MAPPING);
    setCalibPoints(STEP_1_POINTS);
    setStatus('CALIBRATION');
  };

  const reset = () => {
    setStatus('IDLE');
    setTrainingData([]);
    trainingSamplesRef.current = [];
    setRegressionModel(null);
    setShowHeatmap(false);
    if (document.fullscreenElement) document.exitFullscreen();
  };

  return (
    <div className="relative w-full h-screen bg-gray-900 text-white overflow-hidden selection:bg-none">
      <video ref={videoRef} className="fixed top-0 left-0 opacity-0 pointer-events-none" width="640" height="480" playsInline muted />

      {status === 'IDLE' && (
        <div className="flex flex-col items-center justify-center h-full space-y-8 p-4 z-10">
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
            EYE TRACKER
          </h1>
          <p className="max-w-md text-center text-gray-400">
            Precision Eye Tracking with 21-Point High Density Calibration.
          </p>
          <button
            onClick={handleStartCalibration}
            className="group relative px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-full transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(37,99,235,0.5)]"
          >
            Start Calibration
          </button>
        </div>
      )}

      {status === 'LOADING_MODEL' && (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center space-y-4">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <p className={`animate-pulse font-bold ${accuracyScore && accuracyScore > 350 ? 'text-orange-400' : 'text-blue-300'}`}>
              {loadingMsg}
            </p>
          </div>
        </div>
      )}

      {status === 'CALIBRATION' && (
        <CalibrationLayer
          points={calibPoints}
          currentPointIndex={currentCalibIndex}
          isCapturing={isCapturing}
          phase={calibPhase} // Pass phase for UI text
        />
      )}

      {status === 'TRACKING' && (
        <>
           <HeatmapLayer ref={heatmapRef} x={gazePos.x} y={gazePos.y} enabled={showHeatmap} />
           <GazeCursor x={gazePos.x} y={gazePos.y} />
          
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex items-center space-x-2 bg-gray-900 bg-opacity-90 p-2 rounded-lg border border-gray-700 shadow-xl">
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
             <button onClick={reset} className="px-4 py-1.5 text-xs font-bold rounded-md bg-gray-800 border border-gray-600 hover:bg-gray-700 transition text-red-300">Reset</button>
          </div>
          
          {accuracyScore !== null && (
             <div className={`fixed top-20 left-1/2 -translate-x-1/2 bg-opacity-90 text-xs px-4 py-2 rounded-full pointer-events-none font-bold border ${accuracyScore < 350 ? 'bg-green-900 text-green-300 border-green-700' : 'bg-red-900 text-red-300 border-red-700'}`}>
                {accuracyScore < 350 ? 'Good Accuracy' : 'Low Accuracy'} (Error: {accuracyScore.toFixed(0)}px)
             </div>
          )}
        </>
      )}

      <div className="fixed bottom-4 left-4 bg-black bg-opacity-80 p-3 rounded border border-gray-800 z-[200] pointer-events-none">
        <h4 className="text-gray-500 text-[10px] uppercase tracking-wider mb-1">Diagnostics</h4>
        {isBlinking && <div className="text-red-500 font-bold text-xs">BLINK DETECTED</div>}
        <div className="text-[10px] text-gray-600 mt-1">Status: {status}</div>
      </div>
    </div>
  );
}

export default App;