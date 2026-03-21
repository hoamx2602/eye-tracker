'use client';

import { useCallback } from 'react';
import { PATHS } from '@/lib/paths';
import { SYMPTOM_QUESTIONS, type SymptomScores } from '@/lib/symptomAssessment';
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
const NEURO_PRE_QUESTIONNAIRE_LS_KEY = 'neuro_pre_questionnaire_v1';
const NEURO_POST_QUESTIONNAIRE_LS_KEY = 'neuro_post_questionnaire_v1';

function buildQuestionnairePayload(variant: 'pre' | 'post', scores: SymptomScores) {
  return {
    variant,
    submittedAt: new Date().toISOString(),
    scores,
    questions: SYMPTOM_QUESTIONS.map((q) => ({
      id: q.id,
      category: q.category,
      question: q.question,
      score: scores[q.id] ?? null,
    })),
  };
}

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
      let nextResults: Record<string, TestResultPayload> = {};
      setNeuroTestResults((prev) => {
        nextResults = { ...prev, [testId]: payload };
        return nextResults;
      });
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
      const questionnaire = buildQuestionnairePayload('pre', scores);
      try {
        localStorage.setItem(NEURO_PRE_QUESTIONNAIRE_LS_KEY, JSON.stringify(questionnaire));
      } catch (_) {}
      if (neuroRunId) {
        try {
          await neurologicalRunsApi.patch(neuroRunId, { preSymptomScores: questionnaire as unknown as Record<string, number> });
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
      NEURO_PRE_QUESTIONNAIRE_LS_KEY,
    ]
  );

  const handleNeuroPostSubmit = useCallback(
    async (scores: SymptomScores) => {
      setPostSymptomScores(scores);
      const questionnaire = buildQuestionnairePayload('post', scores);
      try {
        localStorage.setItem(NEURO_POST_QUESTIONNAIRE_LS_KEY, JSON.stringify(questionnaire));
      } catch (_) {}
      if (neuroRunId) {
        try {
          await neurologicalRunsApi.patch(neuroRunId, {
            postSymptomScores: questionnaire as unknown as Record<string, number>,
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
    [
      neuroRunId,
      setPostSymptomScores,
      setNeuroPhase,
      pathSyncSourceRef,
      routerPush,
      NEURO_POST_QUESTIONNAIRE_LS_KEY,
    ]
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
