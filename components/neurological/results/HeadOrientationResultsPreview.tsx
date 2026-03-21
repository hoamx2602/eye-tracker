'use client';

import React, { useMemo } from 'react';
import { RESULT_VIZ_OUTER, useResultVizInnerFrameStyle } from './resultVizLayout';

type HeadSample = { t: number; yaw: number; pitch: number; roll: number };

type Phase = {
  direction: string;
  startTime: number;
  endTime: number;
  headSamples: HeadSample[];
};

type Props = {
  phases: Phase[];
  /** When true, main area shows a hint — full table is intended for the parameters panel. */
  visualOnly?: boolean;
};

function phaseStats(samples: HeadSample[]) {
  if (samples.length === 0) {
    return { n: 0, yawMax: 0, pitchMax: 0, rollMax: 0 };
  }
  let yawMax = 0;
  let pitchMax = 0;
  let rollMax = 0;
  for (const s of samples) {
    yawMax = Math.max(yawMax, Math.abs(s.yaw));
    pitchMax = Math.max(pitchMax, Math.abs(s.pitch));
    rollMax = Math.max(rollMax, Math.abs(s.roll));
  }
  return { n: samples.length, yawMax, pitchMax, rollMax, durationMs: 0 };
}

/** Metrics table + caption — shown in the side parameters drawer. */
export function HeadOrientationParamsSection({ phases }: { phases: Phase[] }) {
  const rows = useMemo(() => {
    if (!phases?.length) return [];
    return phases.map((ph, i) => {
      const dur = ph.endTime - ph.startTime;
      const st = phaseStats(ph.headSamples);
      return {
        i: i + 1,
        direction: ph.direction,
        durationMs: dur,
        samples: st.n,
        yawMax: st.yawMax,
        pitchMax: st.pitchMax,
        rollMax: st.rollMax,
      };
    });
  }, [phases]);

  if (!rows.length) {
    return <p className="text-slate-500 text-sm">No head orientation data.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Max |angle| per axis over samples in each phase (units from head pose provider).
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full min-w-[520px] text-left text-xs text-slate-300">
          <thead className="bg-gray-900/80 text-slate-400">
            <tr>
              <th className="px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">Direction</th>
              <th className="px-2 py-2 font-medium">Duration</th>
              <th className="px-2 py-2 font-medium">Samples</th>
              <th className="px-2 py-2 font-medium">|yaw| max</th>
              <th className="px-2 py-2 font-medium">|pitch| max</th>
              <th className="px-2 py-2 font-medium">|roll| max</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.i} className="border-t border-gray-800">
                <td className="px-2 py-1.5 font-mono text-slate-500">{r.i}</td>
                <td className="px-2 py-1.5 font-medium capitalize text-white">{r.direction}</td>
                <td className="px-2 py-1.5 font-mono">{(r.durationMs / 1000).toFixed(2)} s</td>
                <td className="px-2 py-1.5 font-mono">{r.samples}</td>
                <td className="px-2 py-1.5 font-mono text-sky-300">{r.yawMax.toFixed(2)}</td>
                <td className="px-2 py-1.5 font-mono text-emerald-300">{r.pitchMax.toFixed(2)}</td>
                <td className="px-2 py-1.5 font-mono text-amber-300">{r.rollMax.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function HeadOrientationResultsPreview({ phases, visualOnly }: Props) {
  const innerFrame = useResultVizInnerFrameStyle();

  if (!phases?.length) {
    return <p className="text-slate-500 text-sm">No head orientation data.</p>;
  }

  if (visualOnly) {
    return (
      <div className={RESULT_VIZ_OUTER}>
        <div
          className={`${innerFrame.className} flex items-center justify-center px-4`}
          style={innerFrame.style}
        >
          <p className="text-center text-slate-500 text-sm">
            Không có đồ thị không gian cho bài này — xem bảng số liệu trong panel <strong>Tham số</strong>.
          </p>
        </div>
      </div>
    );
  }

  return <HeadOrientationParamsSection phases={phases} />;
}
