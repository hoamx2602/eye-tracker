'use client';

import React, { useState } from 'react';
import {
  AppState,
  CalibrationPhase,
  CalibrationMethod,
  EXERCISE_KINDS,
  EXERCISE_KIND_LABELS,
  EXERCISE_KIND_DESCRIPTIONS,
  TrackingMode,
  type AppConfig,
  type EyeMovementKind,
} from '../types';
import StepBreak, { type StepBreakSaveState } from './StepBreak';
import { exerciseVoiceKey } from '@/lib/voice/scripts';
import type { SelfAssessmentConfig } from './neurological/GuidePracticeTestFlow';
import { InlineStarRow } from './neurological/GuidePracticeTestFlow';
import type { HeadValidationResult } from '../services/eyeTrackingService';
import CalibrationLayer from './CalibrationLayer';
import EyeMovementLayer from './EyeMovementLayer';
import GazeCursor from './GazeCursor';
import HeatmapLayer, { type HeatmapRef } from './HeatmapLayer';
import HeadPositionGuide from './HeadPositionGuide';
import DiagnosticsPanel, { DIAGNOSTICS_ENABLED } from './DiagnosticsPanel';
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
  /** 'test' finishes right after the exercises (no validation); 'calibration' — the real participant flow — goes on to Validation, then the neurological tests. */
  runMode: 'calibration' | 'test';
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
  stepSaveState?: StepBreakSaveState;
  stepSaveError?: string | null;
  onAssessmentContinue?: () => void;
  onAssessmentRedo?: () => void;
  /**
   * Manual retry for the calibration save badge — shown during the neuro
   * flow while the final calibration write (started in the background so
   * the participant isn't stuck waiting for it) is still pending or failed.
   */
  onRetryCalibrationSave?: () => void;
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
    runMode,
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
    stepSaveState = 'idle',
    stepSaveError,
    onAssessmentContinue,
    onAssessmentRedo,
    onRetryCalibrationSave,
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

  // What the break announces as coming up. Always the specific exercise by
  // name — "eye-movement exercises" told a participant nothing about what they
  // were about to be asked to do, and the clip that played with it described
  // the block rather than the task.
  const nextExerciseKind: EyeMovementKind | null =
    assessmentPending?.type === 'grid'
      ? EXERCISE_KINDS[0] ?? null
      : assessmentPending?.type === 'exercise'
        ? EXERCISE_KINDS[assessmentPending.index + 1] ?? null
        : null;
  const nextExerciseNumber =
    nextExerciseKind != null ? EXERCISE_KINDS.indexOf(nextExerciseKind) + 1 : 0;

  // The break after the last exercise (h_pattern) is not the end of the
  // session — in the real participant flow it is followed by Validation,
  // then the neurological tests. nextExerciseKind is null there (there is no
  // *next exercise*), which used to fall straight through to StepBreak's
  // "that was the last step" copy — wrong for everyone except a 'test'-mode
  // run, which genuinely does stop there (see advanceExercise in App.tsx).
  const isLastExerciseComplete =
    assessmentPending?.type === 'exercise' && nextExerciseKind == null;
  const validationIsNext = isLastExerciseComplete && runMode !== 'test';

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
          sittingDistanceCm={config.faceDistance}
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
                    {lastSavedCounts.samples} samples, {lastSavedCounts.images} images.
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

      {/*
        Invalid head position during a neuro test uses the exact same
        HEAD_POSITIONING screen as CALIBRATION — App.tsx changes `status`,
        and the block just above already renders HeadPositioningScreen for
        any reason `status` is HEAD_POSITIONING, calibration-resume or
        neuro-resume alike. Nothing neuro-specific to render here.
      */}

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
          voicePaused={!!assessmentPending}
        />
      )}

      {status === 'CALIBRATION' && calibPhase === CalibrationPhase.EXERCISES && (
        <EyeMovementLayer
          key={`exercise-${currentExerciseIndex}-${exerciseRetryCount}`}
          kind={EXERCISE_KINDS[currentExerciseIndex]}
          targetRef={exerciseTargetRef}
          onComplete={onExerciseComplete}
          voicePaused={!!assessmentPending}
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

      {DIAGNOSTICS_ENABLED && (status === 'CALIBRATION' || status === 'TRACKING') && (
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
        <StepBreak
          stepLabel={assessmentLabel}
          stepIndex={assessmentPending.type === 'exercise' ? assessmentPending.index + 1 : undefined}
          stepTotal={assessmentPending.type === 'exercise' ? EXERCISE_KINDS.length : undefined}
          nextLabel={
            nextExerciseKind
              ? `${EXERCISE_KIND_LABELS[nextExerciseKind]} — exercise ${nextExerciseNumber} of ${EXERCISE_KINDS.length}`
              : validationIsNext
                ? 'Validation'
                : null
          }
          nextDescription={
            nextExerciseKind
              ? `${EXERCISE_KIND_DESCRIPTIONS[nextExerciseKind]}${
                  assessmentPending.type === 'grid'
                    ? ` It is the first of ${EXERCISE_KINDS.length} short exercises, with a break after each one.`
                    : ''
                }`
              : validationIsNext
                ? 'A short series of points, like the very first step, checks how accurate the calibration turned out. Nothing here trains the tracker further — it only measures it.'
                : null
          }
          nextVoiceKey={
            nextExerciseKind
              ? exerciseVoiceKey(nextExerciseKind)
              : validationIsNext
                ? 'validation.next'
                : null
          }
          saveState={stepSaveState}
          saveError={stepSaveError}
          onNext={() => onAssessmentContinue?.()}
          onRedo={() => onAssessmentRedo?.()}
          canContinue={canContinue}
          blockedReason={
            saQ2Visible ? 'Answer both questions to continue' : 'Answer the question above to continue'
          }
        >
          {saEnabled && selfAssessmentConfig && (
            <div className="rounded-2xl border border-gray-800/70 bg-gray-900/50 p-5 flex flex-col gap-4">
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
            </div>
          )}
        </StepBreak>
      )}

      {/*
        Calibration's final save now happens in the background once the neuro
        flow has already started (see completeCalibrationAndStartTracking).
        Silent while it's just working — nothing for the participant to do
        about it either way — but surfaced the moment the automatic retries
        are exhausted, since that's the one case where calibration data is
        actually at risk of being lost with nobody the wiser.
      */}
      {status === 'NEURO_FLOW' && sessionSaveStatus === 'error' && (
        <div
          className="fixed bottom-4 left-4 z-[190] flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs font-medium shadow-lg backdrop-blur-sm bg-red-950/90 border-red-700/60 text-red-200"
          role="status"
        >
          <span className="max-w-xs">Calibration save failed{sessionSaveError ? `: ${sessionSaveError}` : ''}</span>
          {onRetryCalibrationSave && (
            <button
              type="button"
              onClick={onRetryCalibrationSave}
              className="shrink-0 px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition"
            >
              Retry
            </button>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
