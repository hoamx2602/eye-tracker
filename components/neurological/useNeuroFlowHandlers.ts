'use client';

import { useCallback } from 'react';
import { PATHS } from '@/lib/paths';
import type { SymptomScores } from '@/lib/symptomAssessment';
import { neurologicalRunsApi } from '@/services/api';
import type { TestResultPayload } from '@/components/neurological';

type NeuroConfigSnapshot = {
  testOrder: string[];
  testParameters: Record<string, Record<string, unknown>>;
  testEnabled: Record<string, boolean>;
} | null;

type UseNeuroFlowHandlersParams = {
  neuroRunId: string | null;
  neuroTestOrder: string[];
  neuroConfigSnapshot: NeuroConfigSnapshot;
  currentNeuroTestIndex: number;
  neuroTestResults: Record<string, TestResultPayload>;
  NEURO_TEST_PROGRESS_LS_KEY: string;
  setNeuroTestResults: React.Dispatch<React.SetStateAction<Record<string, TestResultPayload>>>;
  setCurrentNeuroTestIndex: React.Dispatch<React.SetStateAction<number>>;
  setCurrentNeuroTestId: React.Dispatch<React.SetStateAction<string | null>>;
  setNeuroPhase: React.Dispatch<React.SetStateAction<'pre' | 'tests' | 'post' | 'done'>>;
  setPreSymptomScores: React.Dispatch<React.SetStateAction<SymptomScores | null>>;
  setPostSymptomScores: React.Dispatch<React.SetStateAction<SymptomScores | null>>;
  pathSyncSourceRef: React.MutableRefObject<'url' | 'internal'>;
  routerPush: (href: string) => void;
  onStartRealTimeTracking: () => void;
};

const DEFAULT_TEST_ORDER = [
  'head_orientation',
  'visual_search',
  'memory_cards',
  'anti_saccade',
  'saccadic',
  'fixation_stability',
  'peripheral_vision',
];

export function useNeuroFlowHandlers({
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
  onStartRealTimeTracking,
}: UseNeuroFlowHandlersParams) {
  const handleNeuroTestComplete = useCallback(
    async (testId: string, payload: TestResultPayload) => {
      const nextResults = { ...neuroTestResults, [testId]: payload };
      setNeuroTestResults(nextResults);
      if (neuroRunId) {
        try {
          await neurologicalRunsApi.patch(neuroRunId, {
            testResults: { [testId]: payload },
          });
        } catch (e) {
          console.error('Patch test result failed', e);
        }
      }
      const order = neuroTestOrder.length > 0 ? neuroTestOrder : DEFAULT_TEST_ORDER;
      const enabled = neuroConfigSnapshot?.testEnabled ?? {};
      let nextIdx = -1;
      for (let i = currentNeuroTestIndex + 1; i < order.length; i++) {
        if (enabled[order[i]] !== false) {
          nextIdx = i;
          break;
        }
      }
      try {
        localStorage.setItem(
          NEURO_TEST_PROGRESS_LS_KEY,
          JSON.stringify({
            runId: neuroRunId,
            phase: nextIdx >= 0 ? 'tests' : 'post',
            currentTestId: nextIdx >= 0 ? order[nextIdx] : null,
            currentTestIndex: nextIdx >= 0 ? nextIdx : order.length,
            testResults: nextResults,
            savedAt: new Date().toISOString(),
          })
        );
      } catch (_) {}
      if (nextIdx >= 0) {
        setCurrentNeuroTestIndex(nextIdx);
        setCurrentNeuroTestId(order[nextIdx]);
        pathSyncSourceRef.current = 'internal';
        routerPush(PATHS.NEURO_TEST(order[nextIdx]));
      } else {
        setNeuroPhase('post');
        setCurrentNeuroTestId(null);
        pathSyncSourceRef.current = 'internal';
        routerPush(PATHS.NEURO_POST);
      }
    },
    [
      neuroRunId,
      neuroTestOrder,
      neuroConfigSnapshot?.testEnabled,
      currentNeuroTestIndex,
      neuroTestResults,
      NEURO_TEST_PROGRESS_LS_KEY,
      setNeuroTestResults,
      setCurrentNeuroTestIndex,
      setCurrentNeuroTestId,
      setNeuroPhase,
      pathSyncSourceRef,
      routerPush,
    ]
  );

  const handleNeuroPreSubmit = useCallback(
    async (scores: SymptomScores) => {
      setPreSymptomScores(scores);
      if (neuroRunId) {
        try {
          await neurologicalRunsApi.patch(neuroRunId, { preSymptomScores: scores });
        } catch (e) {
          console.error('Patch pre scores failed', e);
        }
      }
      const order = neuroTestOrder.length > 0 ? neuroTestOrder : DEFAULT_TEST_ORDER;
      const enabled = neuroConfigSnapshot?.testEnabled ?? {};
      let idx = -1;
      for (let i = 0; i < order.length; i++) {
        if (enabled[order[i]] !== false) {
          idx = i;
          break;
        }
      }
      if (idx < 0) {
        setNeuroPhase('post');
        setCurrentNeuroTestId(null);
        pathSyncSourceRef.current = 'internal';
        routerPush(PATHS.NEURO_POST);
      } else {
        setNeuroPhase('tests');
        setCurrentNeuroTestIndex(idx);
        setCurrentNeuroTestId(order[idx]);
        pathSyncSourceRef.current = 'internal';
        routerPush(PATHS.NEURO_TEST(order[idx]));
      }
    },
    [
      neuroRunId,
      neuroTestOrder,
      neuroConfigSnapshot?.testEnabled,
      setPreSymptomScores,
      setNeuroPhase,
      setCurrentNeuroTestIndex,
      setCurrentNeuroTestId,
      pathSyncSourceRef,
      routerPush,
    ]
  );

  const handleNeuroPostSubmit = useCallback(
    async (scores: SymptomScores) => {
      setPostSymptomScores(scores);
      if (neuroRunId) {
        try {
          await neurologicalRunsApi.patch(neuroRunId, {
            postSymptomScores: scores,
            status: 'completed',
          });
        } catch (e) {
          console.error('Patch post scores failed', e);
        }
      }
      setNeuroPhase('done');
      pathSyncSourceRef.current = 'internal';
      routerPush(PATHS.NEURO_DONE);
    },
    [neuroRunId, setPostSymptomScores, setNeuroPhase, pathSyncSourceRef, routerPush]
  );

  const handleNeuroExitRun = useCallback(async () => {
    if (neuroRunId) {
      try {
        await neurologicalRunsApi.patch(neuroRunId, { status: 'abandoned' });
      } catch (_) {}
    }
    onStartRealTimeTracking();
  }, [neuroRunId, onStartRealTimeTracking]);

  return {
    handleNeuroTestComplete,
    handleNeuroPreSubmit,
    handleNeuroPostSubmit,
    handleNeuroExitRun,
  };
}
