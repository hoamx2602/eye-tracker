'use client';

import React, { useState } from 'react';
import { AppState, CalibrationPhase, CalibrationMethod, EXERCISE_KINDS, EXERCISE_KIND_LABELS, TrackingMode, type AppConfig, type EyeMovementKind } from '../types';
import type { SelfAssessmentConfig } from './neurological/GuidePracticeTestFlow';
import { InlineStarRow } from './neurological/GuidePracticeTestFlow';
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
  selfAssessmentConfig?: SelfAssessmentConfig | null;
  assessmentPending?: { type: 'grid' } | { type: 'exercise'; kind: EyeMovementKind; index: number } | null;
  exerciseRetryCount?: number;
  onAssessmentContinue?: () => void;
  onAssessmentRedo?: () => void;
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
    selfAssessmentConfig,
    assessmentPending,
    exerciseRetryCount = 0,
    onAssessmentContinue,
    onAssessmentRedo,
  } = props;

  const [focusRating, setFocusRating] = useState<number | null>(null);
  const [accuracyRating, setAccuracyRating] = useState<number | null>(null);

  const saEnabled = selfAssessmentConfig?.enabled !== false;
  const saQ2Visible = saEnabled && (selfAssessmentConfig?.questionCount ?? 2) >= 2;
  const canContinue = !saEnabled
    || (focusRating !== null && (!saQ2Visible || accuracyRating !== null));

  React.useEffect(() => {
    if (assessmentPending) {
      setFocusRating(null);
      setAccuracyRating(null);
    }
  }, [assessmentPending]);

  const assessmentLabel = assessmentPending?.type === 'grid' 
    ? 'Calibration' 
    : (assessmentPending?.type === 'exercise' 
        ? (EXERCISE_KIND_LABELS[assessmentPending.kind] || assessmentPending.kind) 
        : '');

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

      {/* Legacy Home screen removed in favor of HomePage.tsx root component */}

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
          key={`exercise-${currentExerciseIndex}-${exerciseRetryCount}`}
          kind={EXERCISE_KINDS[currentExerciseIndex]}
          targetRef={exerciseTargetRef}
          onComplete={onExerciseComplete}
        />
      )}

      {status === 'TRACKING' && (
        <>
          {!hasCameraStream && (
            <div className="fixed inset-0 z-[250] flex flex-col items-center justify-center gap-4 bg-gray-950/95 p-6">
              {createdSessionId ? (
                <div className="flex flex-col items-center gap-4">
                  <EyeSpinner size="lg" />
                  <p className="text-blue-300 font-medium animate-pulse">Initializing camera & session...</p>
                </div>
              ) : (
                <>
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
                </>
              )}
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

      {assessmentPending && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 pointer-events-auto">
          <div className="bg-gray-800 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-sm flex flex-col gap-0 overflow-hidden">
            <div className="px-6 pt-5 pb-4 text-center border-b border-gray-700">
              <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold mb-1">Step Complete</p>
              <p className="text-white font-bold text-base">
                {assessmentLabel}
              </p>
            </div>

            {saEnabled && selfAssessmentConfig && (
              <div className="px-6 py-5 flex flex-col gap-4 border-b border-gray-700">
                <p className="text-xs text-gray-400 text-center uppercase tracking-widest font-semibold">
                  Quick check-in
                </p>
                <InlineStarRow
                  question={selfAssessmentConfig.question1}
                  emoji1="😴"
                  emoji5="🎯"
                  value={focusRating}
                  onChange={setFocusRating}
                />
                {saQ2Visible && (
                  <InlineStarRow
                    question={selfAssessmentConfig.question2}
                    emoji1="🤔"
                    emoji5="✅"
                    value={accuracyRating}
                    onChange={setAccuracyRating}
                  />
                )}
                {!canContinue && (
                  <p className="text-xs text-gray-500 text-center">
                    Answer {saQ2Visible ? 'both questions' : 'the question above'} to continue
                  </p>
                )}
              </div>
            )}

            <div className="px-6 py-5 flex gap-3">
              <button
                type="button"
                onClick={onAssessmentRedo}
                className="flex-1 px-4 py-3 font-semibold text-sm rounded-2xl border border-gray-600 bg-gray-700 hover:bg-gray-600 text-white transition active:translate-y-[1px]"
              >
                Redo
              </button>
              <button
                type="button"
                onClick={onAssessmentContinue}
                disabled={!canContinue}
                className={[
                  'group flex-1 px-4 py-3 font-semibold text-sm rounded-2xl transition active:translate-y-[1px] w-full',
                  canContinue
                    ? 'bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white shadow-[0_8px_24px_rgba(0,140,255,0.18)]'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed',
                ].join(' ')}
              >
                <span className="inline-flex items-center justify-center gap-1.5">
                  <span>Continue</span>
                  {canContinue && (
                    <span className="opacity-90 group-hover:translate-x-0.5 transition">→</span>
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
