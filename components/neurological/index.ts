/**
 * Guide + Practice + Test framework for neurological experiments (ticket 04).
 * Use GuidePracticeTestFlow to run a full test with guide → (practice?) → test.
 * Individual tests (05–11) use useTestRunner() inside testContent to get config and completeTest().
 */

export { default as GuideSteps } from './GuideSteps';
export type { GuideStepsProps } from './GuideSteps';

export { default as PracticeGate } from './PracticeGate';
export type { PracticeGateProps } from './PracticeGate';

export { TestRunnerProvider, useTestRunner } from './TestRunnerContext';
export type { TestRunnerContextValue, TestRunnerProviderProps } from './TestRunnerContext';

export { useTestRecorder } from './useTestRecorder';

export { default as GuidePracticeTestFlow } from './GuidePracticeTestFlow';
export type { GuidePracticeTestFlowProps, GuidePracticeTestFlowPhase } from './GuidePracticeTestFlow';

export type {
  GuideStep,
  TestEvent,
  GazeSample,
  TestResultPayload,
} from './types';

export { NeuroHeadPoseProvider, useNeuroHeadPose } from './NeuroHeadPoseContext';
export type { NeuroHeadPoseContextValue } from './NeuroHeadPoseContext';

export { NeuroPanelLayoutContext, useNeuroPanelLayout } from './NeuroPanelLayoutContext';

export { NeuroGazeProvider, useNeuroGaze } from './NeuroGazeContext';
export type { NeuroGazeContextValue } from './NeuroGazeContext';
