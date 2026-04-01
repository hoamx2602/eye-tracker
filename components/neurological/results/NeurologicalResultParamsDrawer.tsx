'use client';

import React from 'react';
import { computeBceaForSamples } from '@/lib/bivariateEllipse';
import type { AntiSaccadeTrialResult } from '../tests/antiSaccade/AntiSaccadeTest';
import type { PeripheralVisionTrialResult } from '../tests/peripheralVision/PeripheralVisionTest';
import type { SaccadicCycleResult } from '../tests/saccadic/SaccadicTest';
import { AntiSaccadeParamsSection } from './AntiSaccadeGazeDirectionPreview';
import { FixationParamsSection } from './FixationBceaPreview';
import { HeadOrientationParamsSection } from './HeadOrientationResultsPreview';
import { MemoryCardsParamsSection } from './MemoryCardsGazePathPreview';
import { PeripheralParamsSection } from './PeripheralVisionResultsPreview';
import { SaccadicParamsSection } from './SaccadicResultsPreview';
import { VisualSearchParamsSection, type VisualSearchFixationPt } from './VisualSearchResultsPreview';
import { RESULT_CHART_PANEL_MIN_LG } from './resultVizLayout';

const TEST_LABELS: Record<string, string> = {
  head_orientation: 'Head Orientation',
  visual_search: 'Visual Search',
  memory_cards: 'Memory Cards',
  anti_saccade: 'Anti-Saccade',
  saccadic: 'Saccadic Eye Movement',
  fixation_stability: 'Fixation Stability',
  peripheral_vision: 'Peripheral Vision',
};

function renderParamsForTest(testId: string, r: Record<string, unknown>): React.ReactNode {
  if (testId === 'head_orientation') {
    const phases =
      (r.phases as Array<{
        direction: string;
        startTime: number;
        endTime: number;
        headSamples: Array<{ t: number; yaw: number; pitch: number; roll: number }>;
      }>) ?? [];
    return <HeadOrientationParamsSection phases={phases} />;
  }

  if (testId === 'visual_search') {
    const gazeFixationPerNumber = (r.gazeFixationPerNumber as Record<number, number>) ?? {};
    const sequence = (r.sequence as number[]) ?? (r.gazeSequence as number[]) ?? [];
    const completionTimeMs = Number(r.completionTimeMs ?? 0);
    const fixations = (r.fixations as VisualSearchFixationPt[]) ?? [];
    const allowClickTargets = r.allowClickTargets as boolean | undefined;
    const clickHoldDurationMs = r.clickHoldDurationMs as number | undefined;
    return (
      <VisualSearchParamsSection
        completionTimeMs={completionTimeMs}
        sequence={sequence}
        gazeFixationPerNumber={gazeFixationPerNumber}
        fixations={fixations}
        allowClickTargets={allowClickTargets}
        clickHoldDurationMs={clickHoldDurationMs}
      />
    );
  }

  if (testId === 'memory_cards') {
    const gazePath = (r.gazePath as Array<{ t: number; x: number; y: number }>) ?? [];
    const moves = (r.moves as Array<{ match: boolean }>) ?? [];
    const matchedCount = moves.filter((m) => m.match).length;
    const wrongCount = moves.length - matchedCount;
    return <MemoryCardsParamsSection sampleCount={gazePath.length} moveCount={moves.length} matchedCount={matchedCount} wrongCount={wrongCount} />;
  }

  if (testId === 'anti_saccade') {
    const trials = (r.trials as AntiSaccadeTrialResult[]) ?? [];
    const scanningPath =
      (r.scanningPath as Array<{ t: number; x: number; y: number }> | undefined) ??
      (r.gazePath as Array<{ t: number; x: number; y: number }> | undefined);
    return <AntiSaccadeParamsSection trials={trials} scanningPath={scanningPath} />;
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
      <SaccadicParamsSection
        cycles={cycles}
        saccadeLatencyMs={r.saccadeLatencyMs as number[] | undefined}
        fixationAccuracy={r.fixationAccuracy as number | undefined}
        correctiveSaccades={r.correctiveSaccades as number | undefined}
        metrics={metrics}
        scanningPath={scanningPath}
      />
    );
  }

  if (testId === 'fixation_stability') {
    const gazeSamples = (r.gazeSamples as Array<{ t: number; x: number; y: number }>) ?? [];
    if (gazeSamples.length < 2) {
      return <p className="text-slate-500 text-sm">Not enough samples to compute BCEA.</p>;
    }
    const xy = gazeSamples.map((s) => ({ x: s.x, y: s.y }));
    const b68 = computeBceaForSamples(xy, '68');
    const b95 = computeBceaForSamples(xy, '95');
    const bcea68 = r.bcea68Px2 as number | undefined;
    const bcea95 = r.bcea95Px2 as number | undefined;
    const area68 = bcea68 ?? b68.areaPx2;
    const area95 = bcea95 ?? b95.areaPx2;
    return <FixationParamsSection area68={area68} area95={area95} />;
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
    return (
      <PeripheralParamsSection
        trials={trials}
        metrics={metrics}
        viewportWidth={r.viewportWidth as number | undefined}
        viewportHeight={r.viewportHeight as number | undefined}
      />
    );
  }

  return <p className="text-slate-500 text-sm">No parameters for this test.</p>;
}

export type NeurologicalResultParamsDrawerProps = {
  testId: string;
  raw: Record<string, unknown>;
  onCollapse?: () => void;
  /** Khi khung biểu đồ dùng aspect viewport — bỏ min-height cố định để cột tham số stretch theo chiều cao thật. */
  omitFixedMinHeightLg?: boolean;
};

/**
 * Panel hẹp: bảng số / metrics — có nút thu gọn để xem full vùng kết quả.
 */
export default function NeurologicalResultParamsDrawer({
  testId,
  raw,
  onCollapse,
  omitFixedMinHeightLg = false,
}: NeurologicalResultParamsDrawerProps) {
  const label = TEST_LABELS[testId] ?? testId;

  return (
    <aside
      className={`flex h-full min-h-0 w-full max-w-full shrink-0 flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-950/80 lg:max-w-[min(18rem,34vw)] lg:min-w-[14rem] ${omitFixedMinHeightLg ? '' : RESULT_CHART_PANEL_MIN_LG}`}
      aria-label="Result parameters"
    >
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-gray-800 px-3 py-2 sm:px-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Parameters</h3>
          <p className="mt-0.5 truncate text-sm font-medium text-slate-200">{label}</p>
        </div>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-gray-800 hover:text-white"
            title="Collapse — show full chart"
            aria-label="Collapse parameters panel"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4">
        {renderParamsForTest(testId, raw)}
      </div>
    </aside>
  );
}
