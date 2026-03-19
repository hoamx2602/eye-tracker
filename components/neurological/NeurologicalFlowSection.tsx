'use client';

import React from 'react';
import SymptomAssessment from '@/components/SymptomAssessment';
import type { SymptomScores } from '@/lib/symptomAssessment';
import {
  GuidePracticeTestFlow,
  NeuroHeadPoseProvider,
  NeuroGazeProvider,
  NeuroPanelLayoutContext,
  type TestResultPayload,
} from '@/components/neurological';
import HeadOrientationTest from '@/components/neurological/tests/headOrientation/HeadOrientationTest';
import { HEAD_ORIENTATION_GUIDE_STEPS } from '@/components/neurological/tests/headOrientation/constants';
import VisualSearchTest from '@/components/neurological/tests/visualSearch/VisualSearchTest';
import VisualSearchPractice from '@/components/neurological/tests/visualSearch/VisualSearchPractice';
import {
  VISUAL_SEARCH_GUIDE_STEPS,
  DEFAULT_NUMBER_COUNT,
  DEFAULT_AOI_RADIUS_PX,
  PRACTICE_COUNT,
} from '@/components/neurological/tests/visualSearch/constants';
import MemoryCardsTest from '@/components/neurological/tests/memoryCards/MemoryCardsTest';
import MemoryCardsPractice from '@/components/neurological/tests/memoryCards/MemoryCardsPractice';
import {
  MEMORY_CARDS_GUIDE_STEPS,
  DEFAULT_DWELL_MS,
} from '@/components/neurological/tests/memoryCards/constants';
import AntiSaccadeTest from '@/components/neurological/tests/antiSaccade/AntiSaccadeTest';
import AntiSaccadePractice from '@/components/neurological/tests/antiSaccade/AntiSaccadePractice';
import {
  ANTI_SACCADE_GUIDE_STEPS,
  DEFAULT_TRIAL_COUNT,
  DEFAULT_INTERVAL_BETWEEN_TRIALS_MS,
} from '@/components/neurological/tests/antiSaccade/constants';
import SaccadicTest from '@/components/neurological/tests/saccadic/SaccadicTest';
import SaccadicPractice from '@/components/neurological/tests/saccadic/SaccadicPractice';
import {
  SACCADIC_GUIDE_STEPS,
  DEFAULT_TARGET_DURATION_MS,
  DEFAULT_TOTAL_CYCLES,
} from '@/components/neurological/tests/saccadic/constants';
import FixationStabilityTest from '@/components/neurological/tests/fixationStability/FixationStabilityTest';
import FixationStabilityPractice from '@/components/neurological/tests/fixationStability/FixationStabilityPractice';
import {
  FIXATION_STABILITY_GUIDE_STEPS,
  DEFAULT_DURATION_SEC,
  DEFAULT_BLINK_INTERVAL_MS,
} from '@/components/neurological/tests/fixationStability/constants';
import PeripheralVisionTest from '@/components/neurological/tests/peripheralVision/PeripheralVisionTest';
import PeripheralVisionPractice from '@/components/neurological/tests/peripheralVision/PeripheralVisionPractice';
import {
  PERIPHERAL_VISION_GUIDE_STEPS,
  DEFAULT_TRIAL_COUNT as PERIPHERAL_DEFAULT_TRIAL_COUNT,
  DEFAULT_STIMULUS_DURATION_MS,
  DEFAULT_MIN_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
} from '@/components/neurological/tests/peripheralVision/constants';

type NeurologicalFlowSectionProps = {
  status: string;
  neuroRunStatus: 'idle' | 'creating' | 'ready' | 'error';
  neuroPhase: 'pre' | 'tests' | 'post' | 'done';
  currentNeuroTestId: string | null;
  neuroRunId: string | null;
  neuroTestOrder: string[];
  neuroConfigSnapshot: {
    testOrder: string[];
    testParameters: Record<string, Record<string, unknown>>;
    testEnabled: Record<string, boolean>;
  } | null;
  neuroHeadPose: { pitch: number; yaw: number; roll: number } | null;
  gazePos: { x: number; y: number };
  neuroTestResults: Record<string, TestResultPayload>;
  onPreSubmit: (scores: SymptomScores) => Promise<void>;
  onPostSubmit: (scores: SymptomScores) => Promise<void>;
  onExitRun: () => Promise<void>;
  onTestComplete: (testId: string, payload: TestResultPayload) => void;
  onDoneBack: () => void;
  showPostSubmitConfirm: boolean;
  onPostSubmitConfirmSave: () => Promise<void>;
  onPostSubmitConfirmRedo: () => void;
  onPostSubmitConfirmCancel: () => void;
};

export default function NeurologicalFlowSection({
  status,
  neuroRunStatus,
  neuroPhase,
  currentNeuroTestId,
  neuroRunId,
  neuroConfigSnapshot,
  neuroHeadPose,
  gazePos,
  neuroTestResults,
  onPreSubmit,
  onPostSubmit,
  onExitRun,
  onTestComplete,
  onDoneBack,
  showPostSubmitConfirm,
  onPostSubmitConfirmSave,
  onPostSubmitConfirmRedo,
  onPostSubmitConfirmCancel,
}: NeurologicalFlowSectionProps) {
  return (
    <>
      {status === 'NEURO_FLOW' && neuroRunStatus === 'creating' && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-gray-950">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400">Starting neurological run...</p>
        </div>
      )}
      {status === 'NEURO_FLOW' && neuroRunStatus === 'error' && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 p-6 bg-gray-950">
          <p className="text-red-400 text-center">Could not start run. Check connection and try again.</p>
          <button type="button" onClick={onDoneBack} className="px-6 py-3 rounded-xl bg-gray-700 text-white">
            Back to real-time tracking
          </button>
        </div>
      )}
      {status === 'NEURO_FLOW' && neuroRunStatus === 'ready' && neuroPhase === 'pre' && (
        <SymptomAssessment
          variant="pre"
          onSubmit={onPreSubmit}
          onBack={onExitRun}
        />
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'tests' && currentNeuroTestId === 'head_orientation' && (
        <NeuroPanelLayoutContext.Provider value={{ inPanel: true }}>
          <NeuroHeadPoseProvider headPose={neuroHeadPose}>
            <GuidePracticeTestFlow
              testId="head_orientation"
              guideSteps={HEAD_ORIENTATION_GUIDE_STEPS}
              enablePractice={false}
              testContent={<HeadOrientationTest />}
              config={(neuroConfigSnapshot?.testParameters?.head_orientation as Record<string, unknown>) ?? { durationPerDirectionSec: 4, order: ['left', 'right', 'up', 'down'] }}
              onTestComplete={(payload) => onTestComplete('head_orientation', payload)}
            />
          </NeuroHeadPoseProvider>
        </NeuroPanelLayoutContext.Provider>
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'tests' && currentNeuroTestId === 'visual_search' && (
        <NeuroGazeProvider gaze={gazePos}>
          <GuidePracticeTestFlow
            testId="visual_search"
            guideSteps={VISUAL_SEARCH_GUIDE_STEPS}
            enablePractice={true}
            practiceContent={<VisualSearchPractice />}
            practiceTitle="Practice: Visual Search"
            testContent={<VisualSearchTest />}
            config={(neuroConfigSnapshot?.testParameters?.visual_search as Record<string, unknown>) ?? { numberCount: DEFAULT_NUMBER_COUNT, practiceCount: PRACTICE_COUNT, aoiRadiusPx: DEFAULT_AOI_RADIUS_PX }}
            onTestComplete={(payload) => onTestComplete('visual_search', payload)}
          />
        </NeuroGazeProvider>
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'tests' && currentNeuroTestId === 'memory_cards' && (
        <NeuroGazeProvider gaze={gazePos}>
          <GuidePracticeTestFlow
            testId="memory_cards"
            guideSteps={MEMORY_CARDS_GUIDE_STEPS}
            enablePractice={true}
            practiceContent={<MemoryCardsPractice />}
            practiceTitle="Practice: Memory Cards (2x2)"
            testContent={<MemoryCardsTest />}
            config={(neuroConfigSnapshot?.testParameters?.memory_cards as Record<string, unknown>) ?? { cardCount: 16, dwellMs: DEFAULT_DWELL_MS, symbolSize: 'lg' }}
            onTestComplete={(payload) => onTestComplete('memory_cards', payload)}
          />
        </NeuroGazeProvider>
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'tests' && currentNeuroTestId === 'anti_saccade' && (
        <NeuroGazeProvider gaze={gazePos}>
          <GuidePracticeTestFlow
            testId="anti_saccade"
            guideSteps={ANTI_SACCADE_GUIDE_STEPS}
            enablePractice={true}
            practiceContent={(config) => <AntiSaccadePractice config={config} />}
            practiceTitle="Practice: Anti-Saccade"
            testContent={<AntiSaccadeTest />}
            config={
              (neuroConfigSnapshot?.testParameters?.anti_saccade as Record<string, unknown>) ?? {
                trialCount: DEFAULT_TRIAL_COUNT,
                movementSpeedPxPerSec: 120,
                intervalBetweenTrialsMs: DEFAULT_INTERVAL_BETWEEN_TRIALS_MS,
                practiceRestartDelaySec: 3,
                showDimRect: true,
                stimulusShape: 'rectangle',
                primaryRectColor: 'red',
                dimRectColor: 'blue',
              }
            }
            onTestComplete={(payload) => onTestComplete('anti_saccade', payload)}
          />
        </NeuroGazeProvider>
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'tests' && currentNeuroTestId === 'saccadic' && (
        <NeuroGazeProvider gaze={gazePos}>
          <GuidePracticeTestFlow
            testId="saccadic"
            guideSteps={SACCADIC_GUIDE_STEPS}
            enablePractice={true}
            practiceContent={<SaccadicPractice />}
            practiceTitle="Practice: Saccadic"
            testContent={<SaccadicTest />}
            config={(neuroConfigSnapshot?.testParameters?.saccadic as Record<string, unknown>) ?? { targetDurationMs: DEFAULT_TARGET_DURATION_MS, totalCycles: DEFAULT_TOTAL_CYCLES }}
            onTestComplete={(payload) => onTestComplete('saccadic', payload)}
          />
        </NeuroGazeProvider>
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'tests' && currentNeuroTestId === 'fixation_stability' && (
        <NeuroGazeProvider gaze={gazePos}>
          <GuidePracticeTestFlow
            testId="fixation_stability"
            guideSteps={FIXATION_STABILITY_GUIDE_STEPS}
            enablePractice={true}
            practiceContent={<FixationStabilityPractice />}
            practiceTitle="Practice: Fixation Stability"
            testContent={<FixationStabilityTest />}
            config={(neuroConfigSnapshot?.testParameters?.fixation_stability as Record<string, unknown>) ?? { durationSec: DEFAULT_DURATION_SEC, blinkIntervalMs: DEFAULT_BLINK_INTERVAL_MS }}
            onTestComplete={(payload) => onTestComplete('fixation_stability', payload)}
          />
        </NeuroGazeProvider>
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'tests' && currentNeuroTestId === 'peripheral_vision' && (
        <NeuroGazeProvider gaze={gazePos}>
          <GuidePracticeTestFlow
            testId="peripheral_vision"
            guideSteps={PERIPHERAL_VISION_GUIDE_STEPS}
            enablePractice={true}
            practiceContent={<PeripheralVisionPractice />}
            practiceTitle="Practice: Peripheral Vision"
            testContent={<PeripheralVisionTest />}
            config={(neuroConfigSnapshot?.testParameters?.peripheral_vision as Record<string, unknown>) ?? { trialCount: PERIPHERAL_DEFAULT_TRIAL_COUNT, stimulusDurationMs: DEFAULT_STIMULUS_DURATION_MS, minDelayMs: DEFAULT_MIN_DELAY_MS, maxDelayMs: DEFAULT_MAX_DELAY_MS }}
            onTestComplete={(payload) => onTestComplete('peripheral_vision', payload)}
          />
        </NeuroGazeProvider>
      )}
      {status === 'NEURO_FLOW' && (neuroPhase === 'pre' || neuroPhase === 'tests') && (
        <button
          type="button"
          onClick={onExitRun}
          className="fixed top-4 right-4 z-[60] px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white text-sm transition"
        >
          Exit run
        </button>
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'tests' && currentNeuroTestId === null && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-gray-950">
          <p className="text-gray-400">All tests complete. Preparing post-test...</p>
        </div>
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'post' && (
        <SymptomAssessment
          variant="post"
          onSubmit={onPostSubmit}
          onBack={onExitRun}
        />
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'post' && showPostSubmitConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-950 p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Post-test submitted</h3>
            <p className="mt-2 text-sm text-gray-400">
              Bạn muốn lưu kết quả và hoàn tất run, hay làm lại neurological tests?
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={onPostSubmitConfirmSave}
                className="w-full rounded-xl bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-500 transition"
              >
                Lưu kết quả
              </button>
              <button
                type="button"
                onClick={onPostSubmitConfirmRedo}
                className="w-full rounded-xl bg-amber-600 px-4 py-2.5 font-medium text-white hover:bg-amber-500 transition"
              >
                Làm lại neurological tests
              </button>
              <button
                type="button"
                onClick={onPostSubmitConfirmCancel}
                className="w-full rounded-xl bg-gray-800 px-4 py-2.5 font-medium text-gray-200 hover:bg-gray-700 transition"
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'done' && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 p-6 bg-gray-950">
          <h2 className="text-xl font-bold text-white">Neurological run complete</h2>
          <p className="text-gray-400 text-sm text-center max-w-md">
            Pre-test and post-test scores and all test results have been saved.
          </p>
          {neuroRunId && (
            <p className="text-slate-500 text-xs font-mono">Run ID: {neuroRunId}</p>
          )}
          <p className="text-green-500 text-xs">
            Tests completed: {Object.keys(neuroTestResults).length}
          </p>
          <button
            type="button"
            onClick={onDoneBack}
            className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium transition"
          >
            Back to real-time tracking
          </button>
        </div>
      )}
    </>
  );
}
