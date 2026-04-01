'use client';

import React, { useEffect, useMemo, useState } from 'react';
import EyeSpinner from '@/components/ui/EyeSpinner';
import type { TestResultPayload } from '../types';
import type { AntiSaccadeTrialResult } from '../tests/antiSaccade/AntiSaccadeTest';
import type { PeripheralVisionTrialResult } from '../tests/peripheralVision/PeripheralVisionTest';
import type { SaccadicCycleResult } from '../tests/saccadic/SaccadicTest';
import MemoryCardsGazePathPreview from './MemoryCardsGazePathPreview';
import AntiSaccadeGazeDirectionPreview from './AntiSaccadeGazeDirectionPreview';
import FixationBceaPreview from './FixationBceaPreview';
import HeadOrientationResultsPreview from './HeadOrientationResultsPreview';
import VisualSearchResultsPreview from './VisualSearchResultsPreview';
import SaccadicResultsPreview from './SaccadicResultsPreview';
import PeripheralVisionResultsPreview from './PeripheralVisionResultsPreview';
import NeurologicalResultParamsDrawer from './NeurologicalResultParamsDrawer';
import { RESULT_CHART_PANEL_MIN, ResultVizSessionViewportProvider } from './resultVizLayout';
import { NeurologicalResultsViewProvider, useNeurologicalResultsViewOptions } from './neuroResultsViewOptions';

const DEFAULT_ORDER = [
  'head_orientation',
  'visual_search',
  'memory_cards',
  'anti_saccade',
  'saccadic',
  'fixation_stability',
  'peripheral_vision',
] as const;

const TEST_LABELS: Record<string, string> = {
  head_orientation: 'Head Orientation',
  visual_search: 'Visual Search',
  memory_cards: 'Memory Cards',
  anti_saccade: 'Anti-Saccade',
  saccadic: 'Saccadic Eye Movement',
  fixation_stability: 'Fixation Stability',
  peripheral_vision: 'Peripheral Vision',
};

function NeurologicalResultsChartToolbar() {
  const { showStimulusReplay, setShowStimulusReplay, showGazeHeatmap, setShowGazeHeatmap } =
    useNeurologicalResultsViewOptions();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-4 rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2 text-xs text-slate-300 sm:text-sm">
      <label className="flex cursor-pointer items-center gap-2 select-none">
        <input
          type="checkbox"
          className="rounded border-gray-600 bg-gray-900"
          checked={showStimulusReplay}
          onChange={(e) => setShowStimulusReplay(e.target.checked)}
        />
        <span>Show stimulus</span>
      </label>
      <label className="flex cursor-pointer items-center gap-2 select-none">
        <input
          type="checkbox"
          className="rounded border-gray-600 bg-gray-900"
          checked={showGazeHeatmap}
          onChange={(e) => setShowGazeHeatmap(e.target.checked)}
        />
        <span>Gaze heatmap</span>
      </label>
    </div>
  );
}

type Props = {
  neuroTestOrder: string[];
  neuroTestResults: Record<string, TestResultPayload>;
  neuroRunId?: string | null;
  loading: boolean;
  loadError: string | null;
  onRetry: () => void;
  /** Mở step tương ứng testId (vd. verify sau một bài). */
  initialFocusTestId?: string;
};

function asRecord(r: TestResultPayload): Record<string, unknown> {
  return r as Record<string, unknown>;
}

function renderTestPanel(testId: string, r: Record<string, unknown>, visualOnly = false): React.ReactNode {
  if (testId === 'head_orientation') {
    const phases =
      (r.phases as Array<{
        direction: string;
        startTime: number;
        endTime: number;
        headSamples: Array<{ t: number; yaw: number; pitch: number; roll: number }>;
      }>) ?? [];
    return <HeadOrientationResultsPreview phases={phases} visualOnly={visualOnly} />;
  }

  if (testId === 'visual_search') {
    const scanningPath =
      (r.scanningPath as Array<{ t: number; x: number; y: number }>) ??
      (r.gazePath as Array<{ t: number; x: number; y: number }>) ??
      [];
    const numberPositions = (r.numberPositions as Array<{ number: number; x: number; y: number }>) ?? [];
    console.log('[Neuro][Results] visual_search payload keys:', Object.keys(r), 'scanningPath.length:', scanningPath.length, 'numberPositions.length:', numberPositions.length, 'first 3 gaze samples:', scanningPath.slice(0, 3));
    const gazeFixationPerNumber = (r.gazeFixationPerNumber as Record<number, number>) ?? {};
    const sequence = (r.sequence as number[]) ?? (r.gazeSequence as number[]) ?? [];
    const completionTimeMs = Number(r.completionTimeMs ?? 0);
    const fixations = (r.fixations as Array<{ number: number; timestamp: number; gazeX: number; gazeY: number }>) ?? [];
    const stimulusBounds = r.stimulusBounds as
      | { left: number; top: number; width: number; height: number }
      | undefined;
    const startTime = r.startTime as number | undefined;
    const endTime = r.endTime as number | undefined;
    const allowClickTargets = r.allowClickTargets as boolean | undefined;
    const clickHoldDurationMs = r.clickHoldDurationMs as number | undefined;
    return (
      <VisualSearchResultsPreview
        completionTimeMs={completionTimeMs}
        numberPositions={numberPositions}
        scanningPath={scanningPath}
        gazeFixationPerNumber={gazeFixationPerNumber}
        sequence={sequence}
        fixations={fixations}
        viewportWidth={r.viewportWidth as number | undefined}
        viewportHeight={r.viewportHeight as number | undefined}
        stimulusBounds={stimulusBounds}
        startTime={startTime}
        endTime={endTime}
        visualOnly={visualOnly}
        allowClickTargets={allowClickTargets}
        clickHoldDurationMs={clickHoldDurationMs}
      />
    );
  }

  if (testId === 'memory_cards') {
    const gazePath = (r.gazePath as Array<{ t: number; x: number; y: number }>) ?? [];
    const board = (r.board as number[] | undefined) ?? undefined;
    const cols = r.cols as number | undefined;
    const rows = r.rows as number | undefined;
    const gridRect = r.gridRect as
      | { left: number; top: number; width: number; height: number }
      | undefined;
    const moves = r.moves as
      | Array<{ card1Index: number; card2Index: number; match: boolean; timestamp: number }>
      | undefined;
    const startTime = r.startTime as number | undefined;
    const completionTimeMs = r.completionTimeMs as number | undefined;
    return (
      <MemoryCardsGazePathPreview
        gazePath={gazePath}
        board={board}
        cols={cols}
        rows={rows}
        viewportWidth={r.viewportWidth as number | undefined}
        viewportHeight={r.viewportHeight as number | undefined}
        gridRect={gridRect}
        moves={moves}
        startTime={startTime}
        completionTimeMs={completionTimeMs}
        visualOnly={visualOnly}
      />
    );
  }

  if (testId === 'anti_saccade') {
    const trials = (r.trials as AntiSaccadeTrialResult[]) ?? [];
    const scanningPath =
      (r.scanningPath as Array<{ t: number; x: number; y: number }> | undefined) ??
      (r.gazePath as Array<{ t: number; x: number; y: number }> | undefined);
    return (
      <AntiSaccadeGazeDirectionPreview
        trials={trials}
        scanningPath={scanningPath}
        viewportWidth={r.viewportWidth as number | undefined}
        viewportHeight={r.viewportHeight as number | undefined}
        visualOnly={visualOnly}
      />
    );
  }

  if (testId === 'saccadic') {
    const cycles = (r.cycles as SaccadicCycleResult[]) ?? [];
    const metrics = r.metrics as
      | { avgLatency?: number; fixationAccuracy?: number; correctiveSaccadeCount?: number }
      | undefined;
    const scanningPath =
      (r.scanningPath as Array<{ t: number; x: number; y: number }> | undefined) ??
      (r.gazePath as Array<{ t: number; x: number; y: number }> | undefined);
    return (
      <SaccadicResultsPreview
        cycles={cycles}
        startTime={r.startTime as number | undefined}
        endTime={r.endTime as number | undefined}
        scanningPath={scanningPath}
        saccadeLatencyMs={r.saccadeLatencyMs as number[] | undefined}
        fixationAccuracy={r.fixationAccuracy as number | undefined}
        correctiveSaccades={r.correctiveSaccades as number | undefined}
        metrics={metrics}
        viewportWidth={r.viewportWidth as number | undefined}
        viewportHeight={r.viewportHeight as number | undefined}
        visualOnly={visualOnly}
      />
    );
  }

  if (testId === 'fixation_stability') {
    const gazeSamples = (r.gazeSamples as Array<{ t: number; x: number; y: number }>) ?? [];
    return (
      <FixationBceaPreview
        gazeSamples={gazeSamples}
        viewportWidth={r.viewportWidth as number | undefined}
        viewportHeight={r.viewportHeight as number | undefined}
        bcea68Px2={r.bcea68Px2 as number | undefined}
        bcea95Px2={r.bcea95Px2 as number | undefined}
        startTime={r.startTime as number | undefined}
        endTime={r.endTime as number | undefined}
        durationMs={r.durationMs as number | undefined}
        visualOnly={visualOnly}
      />
    );
  }

  if (testId === 'peripheral_vision') {
    const trials = (r.trials as PeripheralVisionTrialResult[]) ?? [];
    const metrics = r.metrics as
      | {
          avgRT?: number;
          accuracy?: number;
          centerStability?: number;
          avgCenteringDistancePx?: number;
          avgCenteringStdPx?: number;
        }
      | undefined;
    const scanningPath =
      (r.scanningPath as Array<{ t: number; x: number; y: number }> | undefined) ??
      (r.gazePath as Array<{ t: number; x: number; y: number }> | undefined);
    return (
      <PeripheralVisionResultsPreview
        trials={trials}
        startTime={r.startTime as number | undefined}
        endTime={r.endTime as number | undefined}
        scanningPath={scanningPath}
        stimulusDurationMs={r.stimulusDurationMs as number | undefined}
        metrics={metrics}
        viewportWidth={r.viewportWidth as number | undefined}
        viewportHeight={r.viewportHeight as number | undefined}
        visualOnly={visualOnly}
      />
    );
  }

  return null;
}

export default function NeurologicalRunResults({
  neuroTestOrder,
  neuroTestResults,
  neuroRunId,
  loading,
  loadError,
  onRetry,
  initialFocusTestId,
}: Props) {
  const order = neuroTestOrder.length > 0 ? neuroTestOrder : [...DEFAULT_ORDER];
  const resultCount = Object.keys(neuroTestResults).length;

  const steps = useMemo(() => order.filter((testId) => neuroTestResults[testId] != null), [order, neuroTestResults]);

  const [stepIdx, setStepIdx] = useState(0);
  /** Thu gọn panel tham số để vùng kết quả (gaze path) dùng full chiều ngang. */
  const [paramsDrawerCollapsed, setParamsDrawerCollapsed] = useState(false);

  useEffect(() => {
    setStepIdx((i) => {
      if (steps.length === 0) return 0;
      return Math.min(i, steps.length - 1);
    });
  }, [steps.length]);

  useEffect(() => {
    if (!initialFocusTestId) return;
    const ix = steps.indexOf(initialFocusTestId);
    if (ix >= 0) setStepIdx(ix);
  }, [initialFocusTestId, steps]);

  const currentTestId = steps[stepIdx];
  const currentRaw = currentTestId ? neuroTestResults[currentTestId] : undefined;
  const currentRecord = currentRaw ? asRecord(currentRaw) : null;
  const vpW = currentRecord?.viewportWidth as number | undefined;
  const vpH = currentRecord?.viewportHeight as number | undefined;
  /** Có kích thước viewport lúc test → khung biểu đồ dùng aspect-ratio; cột rộng hơn khi đóng drawer thì cao theo. */
  const hasViewportAspect =
    typeof vpW === 'number' && typeof vpH === 'number' && vpW > 0 && vpH > 0;
  const totalSteps = steps.length;
  const isFirst = stepIdx <= 0;
  const isLast = stepIdx >= totalSteps - 1;

  return (
    <div className="flex h-full min-h-0 w-full max-w-[min(96rem,100%)] flex-col text-left">
      {loadError && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          <p>Could not load test results from the server: {loadError}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-lg bg-red-900/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800"
          >
            Retry
          </button>
        </div>
      )}

      {loading && !loadError && (
        <div className="mt-4 flex items-center gap-3 text-sm text-slate-400">
          <EyeSpinner size="sm" />
          <span>Loading test results from the database…</span>
        </div>
      )}

      {!loading && !loadError && resultCount === 0 && neuroRunId && (
        <p className="mt-4 text-sm text-slate-500">
          No per-test data is stored for this run in the database. Complete the neurological tests and use
          &quot;Save results&quot; after the post-test so results are saved.
        </p>
      )}
      {!loading && !loadError && resultCount === 0 && !neuroRunId && (
        <p className="mt-4 text-sm text-slate-500">No run id — cannot load results.</p>
      )}

      {!loading && !loadError && totalSteps > 0 && currentTestId && currentRaw && (
        <NeurologicalResultsViewProvider>
          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 sm:gap-4">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 pb-1 sm:pb-2">
            <h4 className="min-w-0 text-lg font-semibold text-white">
              {TEST_LABELS[currentTestId] ?? currentTestId}
            </h4>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
                disabled={isFirst}
                className="rounded-xl border border-gray-700 bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 sm:px-5 sm:py-2.5"
              >
                Previous
              </button>
              {isLast ? (
                <span className="text-sm text-slate-500">Last test</span>
              ) : (
                <button
                  type="button"
                  onClick={() => setStepIdx((i) => Math.min(totalSteps - 1, i + 1))}
                  className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-500 sm:px-6 sm:py-2.5"
                >
                  Next test
                </button>
              )}
            </div>
          </div>

          <NeurologicalResultsChartToolbar />

          <div className="flex min-h-0 flex-1 flex-col gap-2 sm:gap-3 lg:flex-row lg:items-stretch">
            <div
              className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-950/80 ${
                hasViewportAspect ? 'min-h-0' : RESULT_CHART_PANEL_MIN
              }`}
            >
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2 sm:p-4">
                <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center overflow-hidden">
                  <div className="flex min-h-0 max-h-full w-full min-w-0 flex-1 flex-col items-stretch justify-center overflow-hidden">
                    <ResultVizSessionViewportProvider viewportWidth={vpW} viewportHeight={vpH}>
                      {renderTestPanel(currentTestId, asRecord(currentRaw), true)}
                    </ResultVizSessionViewportProvider>
                  </div>
                </div>
              </div>
            </div>

            {paramsDrawerCollapsed ? (
              <button
                type="button"
                onClick={() => setParamsDrawerCollapsed(false)}
                className="flex w-full shrink-0 flex-row items-center justify-center gap-2 rounded-lg border border-gray-800 bg-gray-900/95 py-2.5 text-xs font-medium text-slate-400 hover:bg-gray-800 hover:text-slate-200 lg:w-10 lg:max-w-[2.75rem] lg:flex-col lg:self-stretch lg:rounded-l-lg lg:rounded-r-none lg:py-4 lg:text-[10px] lg:uppercase lg:tracking-wide"
                title="Open parameters panel"
              >
                <span className="text-base leading-none" aria-hidden>
                  ▼
                </span>
                <span className="lg:max-w-[2.5rem] lg:text-center lg:leading-tight">Params</span>
              </button>
            ) : (
              <NeurologicalResultParamsDrawer
                testId={currentTestId}
                raw={asRecord(currentRaw)}
                onCollapse={() => setParamsDrawerCollapsed(true)}
                omitFixedMinHeightLg={hasViewportAspect}
              />
            )}
          </div>

          <div className="flex shrink-0 justify-center px-2 pt-2 pb-1 sm:px-4 sm:pt-3">
            <div
              className="flex h-2 min-w-[140px] w-full max-w-md gap-1 rounded-full bg-gray-800 px-0.5 py-0.5 sm:max-w-lg"
              role="tablist"
              aria-label="Test steps"
            >
              {steps.map((id, i) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStepIdx(i)}
                  className={`h-full min-w-0 flex-1 rounded-full transition ${
                    i === stepIdx ? 'bg-sky-500' : i < stepIdx ? 'bg-slate-600' : 'bg-gray-700'
                  }`}
                  title={TEST_LABELS[id] ?? id}
                  aria-label={`Go to ${TEST_LABELS[id] ?? id}`}
                  aria-current={i === stepIdx ? 'step' : undefined}
                />
              ))}
            </div>
          </div>
        </div>
        </NeurologicalResultsViewProvider>
      )}
    </div>
  );
}
