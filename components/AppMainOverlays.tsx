'use client';

import React from 'react';
import { AppState, CalibrationPhase, CalibrationMethod, EXERCISE_KINDS, TrackingMode, type AppConfig } from '../types';
import type { HeadValidationResult } from '../services/eyeTrackingService';
import CalibrationLayer from './CalibrationLayer';
import EyeMovementLayer from './EyeMovementLayer';
import GazeCursor from './GazeCursor';
import HeatmapLayer, { type HeatmapRef } from './HeatmapLayer';
import HeadPositionGuide from './HeadPositionGuide';
import DiagnosticsPanel from './DiagnosticsPanel';
import ConsentModal from './ConsentModal';
import DemographicsForm, { type DemographicsData } from './DemographicsForm';
import RandomDotsOverlay from './RandomDotsOverlay';
import ArticleReadingOverlay from './ArticleReadingOverlay';
import StopSaveModal from './StopSaveModal';
import CapturedImageModal from './CapturedImageModal';
import TrackingToolbar from './TrackingToolbar';
import HeadPositioningScreen from './HeadPositioningScreen';
import PostCalibrationChoiceScreen from './PostCalibrationChoiceScreen';
import SetupGuideScreen from './SetupGuideScreen';
import EyeSpinner from './ui/EyeSpinner';

type CapturedImage = {
  url: string;
  timestamp: string;
};

type AppMainOverlaysProps = {
  status: AppState;
  currentScreen?: string;
  headPosCanvasRef: React.RefObject<HTMLCanvasElement>;
  headValidation: HeadValidationResult | null;
  positionHoldTime: number | null;
  stableFrameCount: number;
  createdSessionId: string | null;
  recordedVideoUrl: string | null;
  capturedImages: CapturedImage[];
  capturedImageModalIndex: number | null;
  loadingMsg: string;
  accuracyScore: number | null;
  sessionSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  sessionSaveError: string | null;
  lastSavedCounts: { samples: number; images: number } | null;
  lightLevel: { value: number; status: 'too_dark' | 'low' | 'ok' | 'good' } | null;
  calibPhase: CalibrationPhase;
  calibPoints: { id: number; x: number; y: number; completed: boolean }[];
  currentCalibIndex: number;
  isCapturing: boolean;
  config: AppConfig;
  calibrationProgress: number;
  currentExerciseIndex: number;
  trackingMode: TrackingMode;
  hasCameraStream: boolean;
  gazePos: { x: number; y: number };
  showHeatmap: boolean;
  isRecording: boolean;
  showStopSaveModal: boolean;
  isBlinking: boolean;
  showCamera: boolean;
  heatmapRef: React.RefObject<HeatmapRef | null>;
  exerciseTargetRef: React.RefObject<{ x: number; y: number } | null>;
  trackingHistoryCount: number;
  onConsentAgree: () => void;
  onConsentDecline: () => void;
  onDemographicsSubmit: (data: DemographicsData) => void;
  onDemographicsBack: () => void;
  onSetupComplete: () => void;
  onSetupBack: () => void;
  onSetCapturedImageModalIndex: (index: number | null) => void;
  onSetRunMode: (mode: 'calibration' | 'test') => void;
  onStartCalibrationClick: () => void;
  onGoHome: () => void;
  onChooseRealTime: () => void;
  onChooseNeurological: () => Promise<void>;
  onPointMouseDown: () => void;
  onPointMouseUp: () => void;
  onExerciseComplete: () => void;
  onTrackingModeChange: (mode: TrackingMode) => void;
  onToggleHeatmap: () => void;
  onOpenStopSaveModal: () => void;
  onStopSaveConfirm: (options: { csv: boolean; video: boolean; images: boolean }) => Promise<void>;
  onStopSaveCancel: () => void;
  onSetShowCamera: (value: boolean) => void;
  rawFeatures: unknown;
  loocvErrors?: { ridge: number; hybrid: number } | null;
  loocvBaseline?: { ridge: number; hybrid: number } | null;
  onReEvaluate?: () => void;
};

export default function AppMainOverlays(props: AppMainOverlaysProps) {
  const {
    status,
    currentScreen,
    headPosCanvasRef,
    headValidation,
    positionHoldTime,
    stableFrameCount,
    createdSessionId,
    recordedVideoUrl,
    capturedImages,
    capturedImageModalIndex,
    loadingMsg,
    accuracyScore,
    sessionSaveStatus,
    sessionSaveError,
    lastSavedCounts,
    lightLevel,
    calibPhase,
    calibPoints,
    currentCalibIndex,
    isCapturing,
    config,
    calibrationProgress,
    currentExerciseIndex,
    trackingMode,
    hasCameraStream,
    gazePos,
    showHeatmap,
    isRecording,
    showStopSaveModal,
    isBlinking,
    showCamera,
    heatmapRef,
    exerciseTargetRef,
    trackingHistoryCount,
    onConsentAgree,
    onConsentDecline,
    onDemographicsSubmit,
    onDemographicsBack,
    onSetupComplete,
    onSetupBack,
    onSetCapturedImageModalIndex,
    onSetRunMode,
    onStartCalibrationClick,
    onGoHome,
    onChooseRealTime,
    onChooseNeurological,
    onPointMouseDown,
    onPointMouseUp,
    onExerciseComplete,
    onTrackingModeChange,
    onToggleHeatmap,
    onOpenStopSaveModal,
    onStopSaveConfirm,
    onStopSaveCancel,
    onSetShowCamera,
    rawFeatures,
    loocvErrors,
    loocvBaseline,
    onReEvaluate,
  } = props;

  return (
    <div className="absolute inset-0 pointer-events-none font-sans">
      <div className={`relative w-full h-full pointer-events-auto transition-colors duration-300 ${
        (currentScreen === 'consent' || currentScreen === 'demographics') ? 'bg-gray-950 flex items-center justify-center p-4' : ''
      } ${currentScreen === 'setup' ? 'bg-gray-900 overflow-y-auto' : ''}`}>
      {currentScreen === 'consent' && (
        <ConsentModal
          open={currentScreen === 'consent'}
          onAgree={onConsentAgree}
          onDecline={onConsentDecline}
          isPage={true}
        />
      )}

      {currentScreen === 'demographics' && (
        <DemographicsForm
          onSubmit={onDemographicsSubmit}
          onBack={onDemographicsBack}
          isPage={true}
        />
      )}

      {currentScreen === 'setup' && (
        <SetupGuideScreen
          onComplete={onSetupComplete}
          onBack={onSetupBack}
        />
      )}

      {/* Brief loading gap while camera initialises after setup guide */}
      {status === 'IDLE' && currentScreen === 'calibration' && (
        <div className="flex items-center justify-center h-full">
          <EyeSpinner size="xl" label="Starting camera…" />
        </div>
      )}

      {status === 'IDLE' && currentScreen !== 'consent' && currentScreen !== 'demographics' && currentScreen !== 'setup' && currentScreen !== 'calibration' && (
        <div className="flex flex-col items-center justify-center h-full space-y-8 p-4 z-10 relative">
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
            EYE TRACKER
          </h1>

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

          {capturedImages.length > 0 && (
            <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 max-w-2xl w-full">
              <div className="text-xs font-bold text-gray-400 uppercase mb-2">Captured Faces ({capturedImages.length})</div>
              <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-thin">
                {capturedImages.map((img, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onSetCapturedImageModalIndex(i)}
                    className="flex-shrink-0 relative group rounded overflow-hidden border-2 border-transparent hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition"
                  >
                    <img src={img.url} alt={`Face ${i + 1}`} className="h-20 w-auto rounded border border-gray-600 pointer-events-none" />
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
              onClose={() => onSetCapturedImageModalIndex(null)}
              onPrev={capturedImageModalIndex > 0 ? () => onSetCapturedImageModalIndex(capturedImageModalIndex - 1) : undefined}
              onNext={capturedImageModalIndex < capturedImages.length - 1 ? () => onSetCapturedImageModalIndex(capturedImageModalIndex + 1) : undefined}
            />
          )}

          <div className="flex flex-wrap items-center justify-center gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => { onSetRunMode('calibration'); onStartCalibrationClick(); }}
                className="group relative px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-full transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(37,99,235,0.5)]"
              >
                Start Calibration
              </button>
              <button
                onClick={() => { onSetRunMode('test'); onStartCalibrationClick(); }}
                className="px-8 py-4 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-full transition-all hover:scale-105 active:scale-95 border border-violet-500/50"
              >
                Start Test
              </button>
            </div>
          </div>
        </div>
      )}

      {status === 'LOADING_MODEL' && (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center space-y-4">
            <EyeSpinner size="lg" />
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

      {status === 'HEAD_POSITIONING' && (
        <HeadPositioningScreen
          headPosCanvasRef={headPosCanvasRef}
          headValidation={headValidation}
          positionHoldTime={positionHoldTime}
          stableFrameCount={stableFrameCount}
        />
      )}

      {status === 'POST_CALIBRATION_CHOICE' && createdSessionId && (
        <PostCalibrationChoiceScreen
          sessionId={createdSessionId}
          onChooseRealTime={onChooseRealTime}
          onChooseNeurological={onChooseNeurological}
        />
      )}

      {status === 'POST_CALIBRATION_CHOICE' && !createdSessionId && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-gray-950 p-6">
          <p className="text-gray-400 text-center max-w-md">
            No session yet. Complete calibration first to choose Real-time tracking or Neurological tests.
          </p>
          <button
            type="button"
            onClick={onGoHome}
            className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium transition"
          >
            Go to home
          </button>
        </div>
      )}

      {((status === 'CALIBRATION' || status === 'TRACKING') && headValidation && !headValidation.valid) && (
        <HeadPositionGuide validation={headValidation} countdown={null} />
      )}

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
          method={config.calibrationMethod as CalibrationMethod}
          progress={calibrationProgress}
          onPointMouseDown={onPointMouseDown}
          onPointMouseUp={onPointMouseUp}
        />
      )}

      {status === 'CALIBRATION' && calibPhase === CalibrationPhase.EXERCISES && (
        <EyeMovementLayer
          key={`exercise-${currentExerciseIndex}`}
          kind={EXERCISE_KINDS[currentExerciseIndex]}
          targetRef={exerciseTargetRef}
          onComplete={onExerciseComplete}
        />
      )}

      {status === 'TRACKING' && (
        <>
          {!hasCameraStream && (
            <div className="fixed inset-0 z-[250] flex flex-col items-center justify-center gap-4 bg-gray-950/95 p-6">
              <p className="text-gray-300 text-center max-w-md">
                Camera is not on. Complete the calibration step before using real-time tracking.
              </p>
              <button
                type="button"
                onClick={onGoHome}
                className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium transition"
              >
                Go to home to start
              </button>
            </div>
          )}

          {headValidation && headValidation.valid && (
            <>
              <HeatmapLayer ref={heatmapRef as React.RefObject<HeatmapRef>} x={gazePos.x} y={gazePos.y} enabled={showHeatmap && trackingMode === 'free_gaze'} />
              <GazeCursor x={gazePos.x} y={gazePos.y} />
            </>
          )}

          {trackingMode === 'random_dots' && (
            <RandomDotsOverlay gazeX={gazePos.x} gazeY={gazePos.y} />
          )}
          {trackingMode === 'article_reading' && (
            <ArticleReadingOverlay gazeX={gazePos.x} gazeY={gazePos.y} />
          )}

          <TrackingToolbar
            isRecording={isRecording}
            trackingMode={trackingMode}
            onTrackingModeChange={onTrackingModeChange}
            showHeatmap={showHeatmap}
            onToggleHeatmap={onToggleHeatmap}
            canToggleHeatmap={trackingMode === 'free_gaze'}
            onClearHeatmap={() => heatmapRef.current?.reset()}
            canClearHeatmap={trackingMode === 'free_gaze' && showHeatmap}
            onStopSave={onOpenStopSaveModal}
          />

          {showStopSaveModal && (
            <StopSaveModal
              hasCsvData={trackingHistoryCount > 0}
              hasVideo={isRecording || !!recordedVideoUrl}
              hasImages={capturedImages.length > 0}
              onConfirm={onStopSaveConfirm}
              onCancel={onStopSaveCancel}
            />
          )}

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

      {(status === 'CALIBRATION' || status === 'TRACKING') && (
        <DiagnosticsPanel
          showCamera={showCamera}
          setShowCamera={onSetShowCamera}
          headValidation={headValidation}
          rawFeatures={rawFeatures as any}
          capturedImagesCount={capturedImages.length}
          isBlinking={isBlinking}
          status={status}
          lightLevel={lightLevel}
          loocvErrors={loocvErrors}
          loocvBaseline={loocvBaseline}
          onReEvaluate={onReEvaluate}
        />
      )}
      </div>
    </div>
  );
}
