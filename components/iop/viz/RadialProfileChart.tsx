'use client';

import React, { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { EyeAnalysis } from '@/lib/iop/types';
import { CHART } from '@/lib/iop/viz/palette';
import { radialProfile } from '@/lib/iop/viz/stats';
import ChartCard from './ChartCard';

/**
 * Mean red-layer brightness on circles of growing radius around the pupil:
 * the signal the circle search reads. The two steep rises are the pupil edge
 * and the iris edge, and their ratio is the pupil/iris feature.
 */
export default function RadialProfileChart({ eye }: { eye: EyeAnalysis }) {
  const data = useMemo(() => radialProfile(eye), [eye]);
  const pupilEdge = eye.pupil.r / eye.iris.r;
  return (
    <ChartCard
      title="How the pupil and iris edges were found"
      subtitle={`Mean red-layer brightness (highlights removed) at each distance from the pupil centre, in iris radii, along the lateral arcs. The steepest rises are the edges: pupil at ${pupilEdge.toFixed(2)}, iris at 1.00, so pupil/iris = ${eye.features.pupilIrisRatio.toFixed(3)}.`}
    >
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={CHART.grid} strokeWidth={1} vertical={false} />
            <XAxis dataKey="radius" type="number" domain={[0, 'dataMax']} tick={{ fill: CHART.axis, fontSize: 10 }}
              stroke={CHART.grid} tickFormatter={(v: number) => v.toFixed(1)} />
            <YAxis tick={{ fill: CHART.axis, fontSize: 10 }} stroke={CHART.grid} width={36} domain={[0, 255]} ticks={[0, 64, 128, 192, 255]} />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: `1px solid ${CHART.grid}`, fontSize: 12, color: CHART.text }}
              labelFormatter={(r) => `${Number(r).toFixed(2)} iris radii`}
              formatter={(v) => [`${v}`, 'Brightness']}
            />
            <ReferenceLine x={pupilEdge} stroke={CHART.value} strokeWidth={1}
              label={{ value: 'Pupil edge', position: 'top', fill: CHART.value, fontSize: 10 }} />
            <ReferenceLine x={1} stroke={CHART.value} strokeWidth={1}
              label={{ value: 'Iris edge', position: 'top', fill: CHART.value, fontSize: 10 }} />
            <Line type="monotone" dataKey="intensity" stroke={CHART.normal} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
