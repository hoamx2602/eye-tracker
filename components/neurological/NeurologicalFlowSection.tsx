'use client';

import React from 'react';
import EyeSpinner from '@/components/ui/EyeSpinner';
import SymptomAssessment from '@/components/SymptomAssessment';
import type { SymptomScores } from '@/lib/symptomAssessment';
import {
  GuidePracticeTestFlow,
  NeuroHeadPoseProvider,
  NeuroGazeProvider,
  NeuroPanelLayoutContext,
  type TestResultPayload,
} from '@/components/neurological';
import type { SelfAssessmentConfig } from '@/components/neurological/GuidePracticeTestFlow';
import HeadOrientationTest from '@/components/neurological/tests/headOrientation/HeadOrientationTest';
import { HEAD_ORIENTATION_GUIDE_STEPS } from '@/components/neurological/tests/headOrientation/constants';
import VisualSearchTest from '@/components/neurological/tests/visualSearch/VisualSearchTest';
import VisualSearchPractice from '@/components/neurological/tests/visualSearch/VisualSearchPractice';
import {
  VISUAL_SEARCH_GUIDE_STEPS,
  DEFAULT_NUMBER_COUNT,
  DEFAULT_AOI_RADIUS_PX,
  PRACTICE_COUNT,
  DEFAULT_CONFIRM_MODE,
  DEFAULT_CLICK_HOLD_DURATION_MS,
} from '@/components/neurological/tests/visualSearch/constants';
import MemoryCardsTest from '@/components/neurological/tests/memoryCards/MemoryCardsTest';
import MemoryCardsPractice from '@/components/neurological/tests/memoryCards/MemoryCardsPractice';
import {
  MEMORY_CARDS_GUIDE_STEPS,
  DEFAULT_DWELL_MS,
  DEFAULT_CARD_GAP_PX,
} from '@/components/neurological/tests/memoryCards/constants';
import AntiSaccadeTest from '@/components/neurological/tests/antiSaccade/AntiSaccadeTest';
import AntiSaccadePractice from '@/components/neurological/tests/antiSaccade/AntiSaccadePractice';
import {
  getAntiSaccadeGuideSteps,
  isDimRectInstructable,
  DEFAULT_TRIAL_COUNT,
  DEFAULT_INTERVAL_BETWEEN_TRIALS_MS,
  DIM_RECT_OPACITY_DEFAULT,
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
import NeurologicalRunResults from '@/components/neurological/results/NeurologicalRunResults';
import { DEFAULT_TEST_ORDER } from '@/lib/neurologicalConfig';

const TEST_LABELS: Record<string, string> = {
  head_orientation: 'Head Orientation',
  visual_search: 'Visual Search',
  memory_cards: 'Memory Cards',
  anti_saccade: 'Anti-Saccade',
  saccadic: 'Saccadic Eye Movement',
  fixation_stability: 'Fixation Stability',
  peripheral_vision: 'Peripheral Vision',
};

/** One line per test, for the break screen's "coming up next" and the real-test countdown. */
const TEST_SUMMARIES: Record<string, string> = {
  head_orientation: 'Turn your head slowly left, right, up and down, holding each position.',
  visual_search: 'Find the numbers scattered on screen and look at them in order, 1, 2, 3…',
  memory_cards: 'Turn cards over two at a time and find every matching pair.',
  anti_saccade: 'Two shapes move apart — look at the dim one, not the bright one.',
  saccadic: 'A target jumps between left and right. Look at it as soon as it appears.',
  fixation_stability: 'Hold your gaze on a single dot in the centre of the screen.',
  peripheral_vision: 'Keep looking at the centre and press space when you spot a flash at the edge.',
};

/**
 * Where a test sits in the battery, and what follows it.
 *
 * `neuroTestOrder` is empty until the run is created and again after a reload,
 * and an empty order used to make every test look like the last one — so the
 * break announced "that was the last step" and spoke the closing clip in the
 * middle of the session. Falls back to the canonical order, as every other
 * caller already did.
 */
export function neuroStepPosition(
  testId: string,
  neuroTestOrder: string[],
  testEnabled: Record<string, boolean>
): { index: number; total: number; nextId: string | null } {
  const source = neuroTestOrder.length > 0 ? neuroTestOrder : [...DEFAULT_TEST_ORDER];
  const order = source.filter((t) => testEnabled[t] !== false);
  const index = order.indexOf(testId);
  return {
    index,
    total: order.length,
    nextId: index >= 0 ? order[index + 1] ?? null : null,
  };
}

const DEFAULT_SELF_ASSESSMENT: SelfAssessmentConfig = {
  enabled: true,
  questionCount: 2,
  question1: 'How focused were you during this test?',
  question2: 'How accurately do you think you performed?',
};

function extractSelfAssessmentConfig(
  testParameters: Record<string, Record<string, unknown>> | undefined
): SelfAssessmentConfig {
  const raw = testParameters?.['_selfAssessment'] as Record<string, unknown> | undefined;
  if (!raw) return DEFAULT_SELF_ASSESSMENT;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SELF_ASSESSMENT.enabled,
    questionCount: (raw.questionCount === 1 ? 1 : 2) as 1 | 2,
    question1: typeof raw.question1 === 'string' ? raw.question1 : DEFAULT_SELF_ASSESSMENT.question1,
    question2: typeof raw.question2 === 'string' ? raw.question2 : DEFAULT_SELF_ASSESSMENT.question2,
  };
}

type NeurologicalFlowSectionProps = {
  status: string;
  neuroRunStatus: 'idle' | 'creating' | 'ready' | 'error';
  neuroPhase: 'pre' | 'tests' | 'post' | 'done';
  currentNeuroTestId: string | null;
  /**
   * Set by App.tsx after an invalid-head-position interruption — the test
   * and exact phase (guide/practice/test) to resume into, captured from
   * wherever the participant actually was. See App.tsx's neuroFlowResumeRef.
   */
  neuroResumeTestId?: string | null;
  neuroResumePhase?: 'guide' | 'practice' | 'realIntro' | 'test' | null;
  neuroRunId: string | null;
  neuroTestOrder: string[];
  neuroConfigSnapshot: {
    testOrder: string[];
    testParameters: Record<string, Record<string, unknown>>;
    testEnabled: Record<string, boolean>;
  } | null;
  neuroHeadPose: { pitch: number; yaw: number; roll: number } | null;
  gazePos: { x: number; y: number };
  /** HybridRegressor đã train — nếu false, gaze trong neuro là (0,0). */
  gazeModelReady: boolean;
  neuroTestResults: Record<string, TestResultPayload>;
  neuroResultsLoading: boolean;
  neuroResultsLoadError: string | null;
  onNeuroResultsRetry: () => void;
  onPreSubmit: (scores: SymptomScores) => Promise<void>;
  onPostSubmit: (scores: SymptomScores) => Promise<void>;
  onTestComplete: (testId: string, payload: TestResultPayload) => void;
  /** Banks a finished test while the participant is on the break screen. */
  onTestResultReady?: (testId: string, payload: TestResultPayload) => void;
  /** True while the active test's post-test break/review screen is showing — see GuidePracticeTestFlow's onBreakActiveChange. */
  onBreakActiveChange?: (active: boolean) => void;
  /** Live phase of whichever test is currently mounted — see GuidePracticeTestFlow's onPhaseChange. */
  onPhaseChange?: (phase: 'guide' | 'practice' | 'realIntro' | 'test') => void;
  /** Progress of that early save. */
  testSaveState?: 'idle' | 'saving' | 'saved' | 'error';
  /** True while Continue is writing the final result and moving on. */
  isSavingTest?: boolean;
  onDoneBack: () => void;
  showPostSubmitConfirm: boolean;
  onPostSubmitConfirmSave: () => Promise<void>;
  onPostSubmitConfirmRedo: () => void;
  onPostSubmitConfirmCancel: () => void;
  /** /neuro/done?verify=1 — banner + focus bài vừa xong. */
  neuroVerifyBanner?: { focusTestId: string; onContinue: () => void } | null;
  /** Mở đúng step trong NeurologicalRunResults (testId). */
  resultsInitialFocusTestId?: string | null;
};

export default function NeurologicalFlowSection({
  status,
  neuroRunStatus,
  neuroPhase,
  currentNeuroTestId,
  neuroResumeTestId = null,
  neuroResumePhase = null,
  neuroRunId,
  neuroTestOrder,
  neuroConfigSnapshot,
  neuroHeadPose,
  gazePos,
  gazeModelReady,
  neuroTestResults,
  neuroResultsLoading,
  neuroResultsLoadError,
  onNeuroResultsRetry,
  onPreSubmit,
  onPostSubmit,
  onTestComplete,
  onTestResultReady,
  onBreakActiveChange,
  onPhaseChange,
  testSaveState = 'idle',
  isSavingTest = false,
  onDoneBack,
  showPostSubmitConfirm,
  onPostSubmitConfirmSave,
  onPostSubmitConfirmRedo,
  onPostSubmitConfirmCancel,
  neuroVerifyBanner,
  resultsInitialFocusTestId,
}: NeurologicalFlowSectionProps) {
  // Global parameters stored under _global key; merged into every test config so each test
  // can read globalParams like edgePaddingPx from its own config object.
  const globalParams: Record<string, unknown> =
    (neuroConfigSnapshot?.testParameters?.['_global'] as Record<string, unknown>) ?? {};

  // Self-assessment config: read from testParameters._selfAssessment; fall back to defaults.
  const selfAssessmentConfig = extractSelfAssessmentConfig(neuroConfigSnapshot?.testParameters);

  // Quick test mode (NEURO_QUICK_MODE env, surfaced via config): skip the practice
  // phase of every test so the battery can be walked through fast for pipeline
  // testing. head_orientation already has no practice.
  const quickMode =
    (neuroConfigSnapshot?.testParameters?.['_quickMode'] as { enabled?: boolean } | undefined)?.enabled === true;

  /**
   * Everything a test flow needs that is the same for all seven: where this
   * test sits in the battery, what follows it, and how its result is saved.
   */
  const flowPropsFor = (id: string) => {
    const enabled = neuroConfigSnapshot?.testEnabled ?? {};
    const { index: idx, total, nextId } = neuroStepPosition(id, neuroTestOrder, enabled);
    return {
      onTestComplete: (payload: TestResultPayload) => onTestComplete(id, payload),
      onTestResultReady: (payload: TestResultPayload) => onTestResultReady?.(id, payload),
      selfAssessmentConfig,
      testSummary: TEST_SUMMARIES[id] ?? null,
      stepIndex: idx >= 0 ? idx + 1 : undefined,
      stepTotal: total > 0 ? total : undefined,
      nextTestLabel: nextId ? TEST_LABELS[nextId] ?? nextId : null,
      nextTestDescription: nextId ? TEST_SUMMARIES[nextId] ?? null : null,
      nextTestId: nextId,
      saveState: testSaveState,
      saving: isSavingTest,
      // Resuming this exact test after a head-position interruption: land
      // back on the exact phase it was interrupted at (guide, practice, or
      // test) — not always 'test', so someone who hadn't finished practice
      // yet comes back to practice, not to a test they never reached.
      initialPhase: neuroResumeTestId === id ? neuroResumePhase ?? undefined : undefined,
      onBreakActiveChange,
      onPhaseChange,
    };
  };

  // Computed once so the guide steps and the test/practice config can never
  // disagree about whether the dim rectangle is worth mentioning — the guide
  // used to hardcode `true` regardless of the actual config, describing a
  // target the live screens then wouldn't (or would) talk about.
  const antiSaccadeConfig: Record<string, unknown> = {
    ...globalParams,
    ...((neuroConfigSnapshot?.testParameters?.anti_saccade as Record<string, unknown>) ?? {
      trialCount: DEFAULT_TRIAL_COUNT,
      movementSpeedPxPerSec: 120,
      intervalBetweenTrialsMs: DEFAULT_INTERVAL_BETWEEN_TRIALS_MS,
      practiceRestartDelaySec: 3,
      dimRectOpacity: DIM_RECT_OPACITY_DEFAULT,
      stimulusShape: 'rectangle',
      primaryRectColor: 'red',
      dimRectColor: 'blue',
    }),
  };

  return (
    <>
      {status === 'NEURO_FLOW' && neuroRunStatus === 'creating' && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-gray-950">
          <EyeSpinner size="lg" label="Starting neurological run…" />
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
        />
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'tests' && currentNeuroTestId === 'head_orientation' && (
        <NeuroPanelLayoutContext.Provider value={{ inPanel: true }}>
          <NeuroHeadPoseProvider headPose={neuroHeadPose}>
            <GuidePracticeTestFlow
              testId="head_orientation"
              testLabel={TEST_LABELS.head_orientation}
              guideSteps={HEAD_ORIENTATION_GUIDE_STEPS}
              enablePractice={false}
              testContent={<HeadOrientationTest />}
              repeatCue={false}
              config={{ ...globalParams, ...((neuroConfigSnapshot?.testParameters?.head_orientation as Record<string, unknown>) ?? { durationPerDirectionSec: 4, order: ['left', 'right', 'up', 'down'] }) }}
              {...flowPropsFor('head_orientation')}
            />
          </NeuroHeadPoseProvider>
        </NeuroPanelLayoutContext.Provider>
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'tests' && currentNeuroTestId === 'visual_search' && (
        <NeuroHeadPoseProvider headPose={neuroHeadPose}>
        <NeuroGazeProvider gaze={gazePos} gazeModelReady={gazeModelReady}>
          <GuidePracticeTestFlow
            testId="visual_search"
            testLabel={TEST_LABELS.visual_search}
            guideSteps={VISUAL_SEARCH_GUIDE_STEPS}
            enablePractice={!quickMode}
            practiceContent={(cfg) => <VisualSearchPractice config={cfg} />}
            practiceTitle="Visual Search"
            testContent={<VisualSearchTest />}
            config={{
              ...globalParams,
              ...((neuroConfigSnapshot?.testParameters?.visual_search as Record<string, unknown>) ?? {
                numberCount: DEFAULT_NUMBER_COUNT,
                practiceCount: PRACTICE_COUNT,
                aoiRadiusPx: DEFAULT_AOI_RADIUS_PX,
                confirmMode: DEFAULT_CONFIRM_MODE,
                clickHoldDurationMs: DEFAULT_CLICK_HOLD_DURATION_MS,
              }),
            }}
            {...flowPropsFor('visual_search')}
          />
        </NeuroGazeProvider>
        </NeuroHeadPoseProvider>
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'tests' && currentNeuroTestId === 'memory_cards' && (
        <NeuroHeadPoseProvider headPose={neuroHeadPose}>
        <NeuroGazeProvider gaze={gazePos} gazeModelReady={gazeModelReady}>
          <GuidePracticeTestFlow
            testId="memory_cards"
            testLabel={TEST_LABELS.memory_cards}
            guideSteps={MEMORY_CARDS_GUIDE_STEPS}
            enablePractice={!quickMode}
            practiceContent={<MemoryCardsPractice />}
            practiceTitle="Memory Cards (2x2)"
            testContent={<MemoryCardsTest />}
            config={{ 
              ...globalParams, 
              ...((neuroConfigSnapshot?.testParameters?.memory_cards as Record<string, unknown>) ?? { 
                cardCount: 16, 
                dwellMs: DEFAULT_DWELL_MS, 
                symbolSize: 'lg',
                cardGapPx: DEFAULT_CARD_GAP_PX
              }) 
            }}
            {...flowPropsFor('memory_cards')}
          />
        </NeuroGazeProvider>
        </NeuroHeadPoseProvider>
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'tests' && currentNeuroTestId === 'anti_saccade' && (
        <NeuroHeadPoseProvider headPose={neuroHeadPose}>
        <NeuroGazeProvider gaze={gazePos} gazeModelReady={gazeModelReady}>
          <GuidePracticeTestFlow
            testId="anti_saccade"
            testLabel={TEST_LABELS.anti_saccade}
            guideSteps={getAntiSaccadeGuideSteps(isDimRectInstructable(antiSaccadeConfig))}
            enablePractice={!quickMode}
            practiceContent={(config) => <AntiSaccadePractice config={config} />}
            practiceTitle="Anti-Saccade"
            testContent={<AntiSaccadeTest />}
            config={antiSaccadeConfig}
            {...flowPropsFor('anti_saccade')}
          />
        </NeuroGazeProvider>
        </NeuroHeadPoseProvider>
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'tests' && currentNeuroTestId === 'saccadic' && (
        <NeuroHeadPoseProvider headPose={neuroHeadPose}>
        <NeuroGazeProvider gaze={gazePos} gazeModelReady={gazeModelReady}>
          <GuidePracticeTestFlow
            testId="saccadic"
            testLabel={TEST_LABELS.saccadic}
            guideSteps={SACCADIC_GUIDE_STEPS}
            enablePractice={!quickMode}
            practiceContent={<SaccadicPractice />}
            practiceTitle="Saccadic"
            testContent={<SaccadicTest />}
            config={{ ...globalParams, ...((neuroConfigSnapshot?.testParameters?.saccadic as Record<string, unknown>) ?? { targetDurationMs: DEFAULT_TARGET_DURATION_MS, totalCycles: DEFAULT_TOTAL_CYCLES }) }}
            {...flowPropsFor('saccadic')}
          />
        </NeuroGazeProvider>
        </NeuroHeadPoseProvider>
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'tests' && currentNeuroTestId === 'fixation_stability' && (
        <NeuroHeadPoseProvider headPose={neuroHeadPose}>
        <NeuroGazeProvider gaze={gazePos} gazeModelReady={gazeModelReady}>
          <GuidePracticeTestFlow
            testId="fixation_stability"
            testLabel={TEST_LABELS.fixation_stability}
            guideSteps={FIXATION_STABILITY_GUIDE_STEPS}
            enablePractice={!quickMode}
            practiceContent={(cfg) => <FixationStabilityPractice config={cfg} />}
            practiceTitle="Fixation Stability"
            testContent={<FixationStabilityTest />}
            config={{ ...globalParams, ...((neuroConfigSnapshot?.testParameters?.fixation_stability as Record<string, unknown>) ?? { durationSec: DEFAULT_DURATION_SEC, blinkIntervalMs: DEFAULT_BLINK_INTERVAL_MS }) }}
            {...flowPropsFor('fixation_stability')}
          />
        </NeuroGazeProvider>
        </NeuroHeadPoseProvider>
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'tests' && currentNeuroTestId === 'peripheral_vision' && (
        <NeuroHeadPoseProvider headPose={neuroHeadPose}>
        <NeuroGazeProvider gaze={gazePos} gazeModelReady={gazeModelReady}>
          <GuidePracticeTestFlow
            testId="peripheral_vision"
            testLabel={TEST_LABELS.peripheral_vision}
            guideSteps={PERIPHERAL_VISION_GUIDE_STEPS}
            enablePractice={!quickMode}
            practiceContent={(cfg) => <PeripheralVisionPractice config={cfg} />}
            practiceTitle="Peripheral Vision"
            testContent={<PeripheralVisionTest />}
            config={{ ...globalParams, ...((neuroConfigSnapshot?.testParameters?.peripheral_vision as Record<string, unknown>) ?? { trialCount: PERIPHERAL_DEFAULT_TRIAL_COUNT, stimulusDurationMs: DEFAULT_STIMULUS_DURATION_MS, minDelayMs: DEFAULT_MIN_DELAY_MS, maxDelayMs: DEFAULT_MAX_DELAY_MS }) }}
            {...flowPropsFor('peripheral_vision')}
          />
        </NeuroGazeProvider>
        </NeuroHeadPoseProvider>
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
        />
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'post' && showPostSubmitConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-950 p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Post-test submitted</h3>
            <p className="mt-2 text-sm text-gray-400">
              Save results and finish this run, or redo the neurological tests?
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={onPostSubmitConfirmSave}
                className="w-full rounded-xl bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-500 transition"
              >
                Save results
              </button>
              <button
                type="button"
                onClick={onPostSubmitConfirmRedo}
                className="w-full rounded-xl bg-amber-600 px-4 py-2.5 font-medium text-white hover:bg-amber-500 transition"
              >
                Redo neurological tests
              </button>
              <button
                type="button"
                onClick={onPostSubmitConfirmCancel}
                className="w-full rounded-xl bg-gray-800 px-4 py-2.5 font-medium text-gray-200 hover:bg-gray-700 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {status === 'NEURO_FLOW' && neuroPhase === 'done' && (
        <div className="fixed inset-0 z-50 flex h-[100dvh] max-h-[100dvh] flex-col bg-gray-950">
          {neuroVerifyBanner && (
            <div className="shrink-0 border-b border-amber-500/40 bg-amber-950/50 px-3 py-3 text-sm text-amber-100 sm:px-4">
              <div className="mx-auto flex max-w-[min(96rem,100%)] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <strong className="text-amber-300">Verify mode:</strong> review results for the test you just finished. To keep this on:{' '}
                  <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs text-slate-300">
                    NEXT_PUBLIC_NEURO_VERIFY_AFTER_EACH=1
                  </code>{' '}
                  or in DevTools:{' '}
                  <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs text-slate-300">
                    sessionStorage.setItem(&apos;neuro_verify_after_each&apos;,&apos;1&apos;)
                  </code>
                </div>
                <button
                  type="button"
                  onClick={neuroVerifyBanner.onContinue}
                  className="shrink-0 rounded-xl bg-amber-600 px-4 py-2.5 font-medium text-white transition hover:bg-amber-500"
                >
                  Continue (next test or post-test)
                </button>
              </div>
            </div>
          )}
          <div className="min-h-0 flex flex-1 flex-col px-3 pb-4 pt-4 sm:px-6 sm:pb-5 sm:pt-5">
            <NeurologicalRunResults
              neuroTestOrder={neuroTestOrder}
              neuroTestResults={neuroTestResults}
              neuroRunId={neuroRunId}
              loading={neuroResultsLoading}
              loadError={neuroResultsLoadError}
              onRetry={onNeuroResultsRetry}
              initialFocusTestId={resultsInitialFocusTestId ?? undefined}
            />
          </div>
        </div>
      )}
    </>
  );
}
