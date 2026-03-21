'use client';

import React from 'react';
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

const DEFAULT_ORDER = [
  'head_orientation',
  'visual_search',
  'memory_cards',
  'anti_saccade',
  'saccadic',
  'fixation_stability',
  'peripheral_vision',
] as const;

type Props = {
  neuroTestOrder: string[];
  neuroTestResults: Record<string, TestResultPayload>;
  /** When set, empty results may be loading after refresh — show hint */
  neuroRunId?: string | null;
};

function asRecord(r: TestResultPayload): Record<string, unknown> {
  return r as Record<string, unknown>;
}

export default function NeurologicalRunResults({ neuroTestOrder, neuroTestResults, neuroRunId }: Props) {
  const order = neuroTestOrder.length > 0 ? neuroTestOrder : [...DEFAULT_ORDER];
  const resultCount = Object.keys(neuroTestResults).length;

  return (
    <div className="w-full max-w-3xl space-y-10 overflow-y-auto pr-1 max-h-[min(70vh,720px)] text-left">
      <h3 className="text-lg font-semibold text-white">Result details</h3>

      {resultCount === 0 && neuroRunId && (
        <p className="text-sm text-amber-400/95">
          Đang tải hoặc khôi phục kết quả… Nếu bạn vừa refresh trang, dữ liệu sẽ được lấy từ bộ nhớ trình duyệt hoặc máy chủ trong giây lát.
        </p>
      )}
      {resultCount === 0 && !neuroRunId && (
        <p className="text-sm text-slate-500">
          Chưa có dữ liệu bài test trong phiên này (ví dụ: chưa chạy neurological run, hoặc đã đóng tab trước khi lưu).
        </p>
      )}

      {order.map((testId) => {
        const raw = neuroTestResults[testId];
        if (!raw) return null;
        const r = asRecord(raw);

        if (testId === 'head_orientation') {
          const phases = (r.phases as Array<{
            direction: string;
            startTime: number;
            endTime: number;
            headSamples: Array<{ t: number; yaw: number; pitch: number; roll: number }>;
          }>) ?? [];
          return (
            <section key={testId} className="rounded-xl border border-gray-800 bg-gray-950/80 p-4">
              <h4 className="mb-3 text-base font-medium text-white">Head orientation</h4>
              <HeadOrientationResultsPreview phases={phases} />
            </section>
          );
        }

        if (testId === 'visual_search') {
          const scanningPath =
            (r.scanningPath as Array<{ t: number; x: number; y: number }>) ??
            (r.gazePath as Array<{ t: number; x: number; y: number }>) ??
            [];
          const numberPositions = (r.numberPositions as Array<{ number: number; x: number; y: number }>) ?? [];
          const gazeFixationPerNumber = (r.gazeFixationPerNumber as Record<number, number>) ?? {};
          const sequence = (r.sequence as number[]) ?? (r.gazeSequence as number[]) ?? [];
          const completionTimeMs = Number(r.completionTimeMs ?? 0);
          return (
            <section key={testId} className="rounded-xl border border-gray-800 bg-gray-950/80 p-4">
              <h4 className="mb-3 text-base font-medium text-white">Visual search</h4>
              <VisualSearchResultsPreview
                completionTimeMs={completionTimeMs}
                numberPositions={numberPositions}
                scanningPath={scanningPath}
                gazeFixationPerNumber={gazeFixationPerNumber}
                sequence={sequence}
                viewportWidth={r.viewportWidth as number | undefined}
                viewportHeight={r.viewportHeight as number | undefined}
              />
            </section>
          );
        }

        if (testId === 'memory_cards') {
          const gazePath = (r.gazePath as Array<{ t: number; x: number; y: number }>) ?? [];
          const viewportWidth = r.viewportWidth as number | undefined;
          const viewportHeight = r.viewportHeight as number | undefined;
          return (
            <section key={testId} className="rounded-xl border border-gray-800 bg-gray-950/80 p-4">
              <h4 className="mb-3 text-base font-medium text-white">Memory cards</h4>
              <MemoryCardsGazePathPreview gazePath={gazePath} viewportWidth={viewportWidth} viewportHeight={viewportHeight} />
            </section>
          );
        }

        if (testId === 'anti_saccade') {
          const trials = (r.trials as AntiSaccadeTrialResult[]) ?? [];
          return (
            <section key={testId} className="rounded-xl border border-gray-800 bg-gray-950/80 p-4">
              <h4 className="mb-3 text-base font-medium text-white">Anti-saccade — gaze direction</h4>
              <AntiSaccadeGazeDirectionPreview trials={trials} />
            </section>
          );
        }

        if (testId === 'saccadic') {
          const cycles = (r.cycles as SaccadicCycleResult[]) ?? [];
          const metrics = r.metrics as
            | { avgLatency?: number; fixationAccuracy?: number; correctiveSaccadeCount?: number }
            | undefined;
          return (
            <section key={testId} className="rounded-xl border border-gray-800 bg-gray-950/80 p-4">
              <h4 className="mb-3 text-base font-medium text-white">Saccadic</h4>
              <SaccadicResultsPreview
                cycles={cycles}
                saccadeLatencyMs={r.saccadeLatencyMs as number[] | undefined}
                fixationAccuracy={r.fixationAccuracy as number | undefined}
                correctiveSaccades={r.correctiveSaccades as number | undefined}
                metrics={metrics}
                viewportWidth={r.viewportWidth as number | undefined}
                viewportHeight={r.viewportHeight as number | undefined}
              />
            </section>
          );
        }

        if (testId === 'fixation_stability') {
          const gazeSamples = (r.gazeSamples as Array<{ t: number; x: number; y: number }>) ?? [];
          const viewportWidth = r.viewportWidth as number | undefined;
          const viewportHeight = r.viewportHeight as number | undefined;
          const bcea68Px2 = r.bcea68Px2 as number | undefined;
          const bcea95Px2 = r.bcea95Px2 as number | undefined;
          return (
            <section key={testId} className="rounded-xl border border-gray-800 bg-gray-950/80 p-4">
              <h4 className="mb-3 text-base font-medium text-white">Fixation stability — BCEA</h4>
              <FixationBceaPreview
                gazeSamples={gazeSamples}
                viewportWidth={viewportWidth}
                viewportHeight={viewportHeight}
                bcea68Px2={bcea68Px2}
                bcea95Px2={bcea95Px2}
              />
            </section>
          );
        }

        if (testId === 'peripheral_vision') {
          const trials = (r.trials as PeripheralVisionTrialResult[]) ?? [];
          const metrics = r.metrics as { avgRT?: number; accuracy?: number; centerStability?: number } | undefined;
          return (
            <section key={testId} className="rounded-xl border border-gray-800 bg-gray-950/80 p-4">
              <h4 className="mb-3 text-base font-medium text-white">Peripheral vision</h4>
              <PeripheralVisionResultsPreview
                trials={trials}
                metrics={metrics}
                viewportWidth={r.viewportWidth as number | undefined}
                viewportHeight={r.viewportHeight as number | undefined}
              />
            </section>
          );
        }

        return null;
      })}
    </div>
  );
}
