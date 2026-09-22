'use client';

import { useCallback, useState } from 'react';
import { PATHS } from '@/lib/paths';
import {
  NEURO_VERIFY_META_KEY,
  NEURO_VERIFY_SNAPSHOT_KEY,
  neuroVerifyAfterEachEnabled,
} from '@/lib/neuroVerifyMode';
import { SYMPTOM_QUESTIONS, type SymptomScores } from '@/lib/symptomAssessment';
import { neurologicalRunsApi } from '@/services/api';
import { neuroDebugLog, neuroPersistWarn } from '@/lib/neuroDebugLog';
import type { TestResultPayload } from '@/components/neurological';
import { DEFAULT_TEST_ORDER } from '@/lib/neurologicalConfig';

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
  setStatus: (s: any) => void;
  setLoadingMsg: (msg: string) => void;
};


const NEURO_PRE_QUESTIONNAIRE_LS_KEY = 'neuro_pre_questionnaire_v1';
const NEURO_POST_QUESTIONNAIRE_LS_KEY = 'neuro_post_questionnaire_v1';

/**
 * Retry a run patch a couple of times before giving up.
 *
 * Every write here is a small JSON payload — a test's result, a
 * questionnaire — not a media upload, so a short automatic retry is cheap
 * and turns a transient network blip into nothing instead of a silently
 * lost test. Still soft-fails after retrying: a participant mid-assessment
 * should never be blocked or interrupted by a save that will not go through.
 */
const RUN_PATCH_RETRY_DELAYS_MS = [800, 2000];

async function patchRunWithRetry(
  id: string,
  data: Parameters<typeof neurologicalRunsApi.patch>[1]
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await neurologicalRunsApi.patch(id, data);
      return;
    } catch (e) {
      if (attempt >= RUN_PATCH_RETRY_DELAYS_MS.length) throw e;
      await new Promise((r) => setTimeout(r, RUN_PATCH_RETRY_DELAYS_MS[attempt]));
    }
  }
}

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
  setStatus,
  setLoadingMsg,
}: UseNeuroFlowHandlersParams) {
  const [isSaving, setIsSaving] = useState(false);
  const [testSaveState, setTestSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  /**
   * Write a finished test to the server as soon as it ends, before the
   * participant has pressed anything.
   *
   * The authoritative write still happens on Continue, once the check-in
   * ratings are attached. This early one exists so a session abandoned during
   * a break has already banked every completed test.
   */
  const handleNeuroTestResultReady = useCallback(
    async (testId: string, payload: TestResultPayload) => {
      if (!neuroRunId) {
        setTestSaveState('idle');
        return;
      }
      setTestSaveState('saving');
      try {
        await patchRunWithRetry(neuroRunId, { testResults: { [testId]: payload } });
        setTestSaveState('saved');
      } catch (e) {
        neuroPersistWarn(`PATCH interim result failed (${testId})`, e);
        setTestSaveState('error');
      }
    },
    [neuroRunId]
  );

  const handleNeuroTestComplete = useCallback(
    async (testId: string, payload: TestResultPayload) => {
      if (isSaving) return;
      setIsSaving(true);
      
      try {
        let nextResults: Record<string, TestResultPayload> = {};
        setNeuroTestResults((prev) => {
          nextResults = { ...prev, [testId]: payload };
          return nextResults;
        });
        neuroDebugLog('test complete', testId, '→ merged keys', Object.keys(nextResults));
        
        const order = neuroTestOrder.length > 0 ? neuroTestOrder : [...DEFAULT_TEST_ORDER];
        const enabled = neuroConfigSnapshot?.testEnabled ?? {};
        let nextIdx = -1;
        for (let i = currentNeuroTestIndex + 1; i < order.length; i++) {
          if (enabled[order[i]] !== false) {
            nextIdx = i;
            break;
          }
        }

        const skipQ = process.env.NEXT_PUBLIC_SKIP_NEURO_QUESTIONNAIRE === 'true';
        const isFinishing = nextIdx < 0 && skipQ;

        if (neuroRunId) {
          // The result itself was already written when the test ended, and the
          // break screen said so. This second write only adds the check-in
          // ratings, so it must not put a "Saving…" screen in front of someone
          // who has just been told their data is saved — it runs in the
          // background while we move on.
          const write = patchRunWithRetry(neuroRunId, {
            testResults: { [testId]: payload },
            ...(isFinishing ? { status: 'completed' } : {}),
          }).catch((e) => neuroPersistWarn(`PATCH test result failed (${testId})`, e));

          // Finishing the run is the exception: the results page reads the run
          // back, so that one write has to land before we navigate.
          if (isFinishing) {
            setLoadingMsg('Saving final results...');
            setStatus('LOADING_MODEL');
            await write;
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

        if (typeof window !== 'undefined' && neuroVerifyAfterEachEnabled()) {
          try {
            sessionStorage.setItem(NEURO_VERIFY_SNAPSHOT_KEY, JSON.stringify(nextResults));
            sessionStorage.setItem(
              NEURO_VERIFY_META_KEY,
              JSON.stringify({
                nextIdx,
                order,
                goToPost: nextIdx < 0,
              })
            );
          } catch (e) {
            neuroPersistWarn('verify mode: sessionStorage failed', e);
          }
          setNeuroPhase('done');
          routerPush(`${PATHS.NEURO_DONE}?verify=1&focus=${encodeURIComponent(testId)}`);
          return;
        }

        if (nextIdx >= 0) {
          setCurrentNeuroTestIndex(nextIdx);
          setCurrentNeuroTestId(order[nextIdx]);
          pathSyncSourceRef.current = 'internal';
          routerPush(PATHS.NEURO_TEST(order[nextIdx]));
        } else {
          if (skipQ) {
            routerPush(`/results/${neuroRunId}`);
          } else {
            setNeuroPhase('post');
            setCurrentNeuroTestId(null);
            pathSyncSourceRef.current = 'internal';
            routerPush(PATHS.NEURO_POST);
          }
        }
      } finally {
        setIsSaving(false);
      }
    },
    [
      isSaving,
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
      setLoadingMsg,
      setStatus,
    ]
  );

  const handleNeuroPreSubmit = useCallback(
    async (scores: SymptomScores) => {
      if (isSaving) return;
      setIsSaving(true);
      try {
        setPreSymptomScores(scores);
        const questionnaire = buildQuestionnairePayload('pre', scores);
        try {
          localStorage.setItem(NEURO_PRE_QUESTIONNAIRE_LS_KEY, JSON.stringify(questionnaire));
        } catch (_) {}
        if (neuroRunId) {
          try {
            await patchRunWithRetry(neuroRunId, { preSymptomScores: questionnaire as unknown as Record<string, number> });
          } catch (e) {
            neuroPersistWarn('PATCH pre scores failed', e);
          }
        }
        const order = neuroTestOrder.length > 0 ? neuroTestOrder : [...DEFAULT_TEST_ORDER];
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
      } finally {
        setIsSaving(false);
      }
    },
    [
      isSaving,
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
      if (isSaving) return;
      setIsSaving(true);
      try {
        setPostSymptomScores(scores);
        const questionnaire = buildQuestionnairePayload('post', scores);
        try {
          localStorage.setItem(NEURO_POST_QUESTIONNAIRE_LS_KEY, JSON.stringify(questionnaire));
        } catch (_) {}
        if (neuroRunId) {
          try {
            setLoadingMsg('Saving final results...');
            setStatus('LOADING_MODEL');
            await patchRunWithRetry(neuroRunId, {
              postSymptomScores: questionnaire as unknown as Record<string, number>,
              status: 'completed',
            });
          } catch (e) {
            neuroPersistWarn('PATCH post scores failed', e);
          }
        }
        routerPush(`/results/${neuroRunId}`);
      } finally {
        setIsSaving(false);
      }
    },
    [
      isSaving,
      neuroRunId,
      setPostSymptomScores,
      setLoadingMsg,
      setStatus,
      routerPush,
      NEURO_POST_QUESTIONNAIRE_LS_KEY,
    ]
  );

  return {
    isSaving,
    testSaveState,
    handleNeuroTestResultReady,
    handleNeuroTestComplete,
    handleNeuroPreSubmit,
    handleNeuroPostSubmit,
  };
}
