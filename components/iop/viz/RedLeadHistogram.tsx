'use client';

import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { RED_DOMINANCE } from '@/lib/iop/features';
import type { EyeAnalysis } from '@/lib/iop/types';
import { CHART } from '@/lib/iop/viz/palette';
import { redLeadHistogram } from '@/lib/iop/viz/stats';
import ChartCard, { LegendKey } from './ChartCard';

/**
 * How red the sclera's pixels are, and where the RAP rule cuts: bars right
 * of the line are the pixels counted as reddish.
 */
export default function RedLeadHistogram({ eye }: { eye: EyeAnalysis }) {
  const bins = useMemo(() => redLeadHistogram(eye), [eye]);
  const thresholdBin = bins.find((bin) => bin.countsAsRed)?.lead;
  // Clean 5% ticks up to the tallest bar.
  const top = Math.max(0.05, Math.ceil(Math.max(...bins.map((b) => b.share)) * 20) / 20);
  const ticks = Array.from({ length: Math.round(top * 20) + 1 }, (_, k) => k / 20);
  return (
    <ChartCard
      title="Sclera colour and the RAP threshold"
      subtitle={`Share of sclera pixels by how far red leads green and blue, (R − max(G, B)) / R. Pixels right of the line (lead > ${RED_DOMINANCE}) count as reddish; with the green/blue balance check that gives RAP = ${(eye.features.rap * 100).toFixed(1)}%.`}
    >
      <div className="flex flex-wrap gap-4">
        <LegendKey colour={CHART.normal} label="Not counted" />
        <LegendKey colour={CHART.high} label="Counted as reddish" />
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bins} margin={{ top: 16, right: 12, bottom: 0, left: 0 }} barCategoryGap={2}>
            <CartesianGrid stroke={CHART.grid} strokeWidth={1} vertical={false} />
            <XAxis dataKey="lead" tick={{ fill: CHART.axis, fontSize: 10 }} stroke={CHART.grid} interval={4} />
            <YAxis tick={{ fill: CHART.axis, fontSize: 10 }} stroke={CHART.grid} width={40} domain={[0, top]} ticks={ticks}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
            <Tooltip
              cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
              contentStyle={{ background: '#0f172a', border: `1px solid ${CHART.grid}`, fontSize: 12, color: CHART.text }}
              labelFormatter={(lead) => `Red lead ≈ ${lead}`}
              formatter={(share) => [`${(Number(share) * 100).toFixed(1)}% of sclera`, 'Pixels']}
            />
            <Bar dataKey="share" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
              {bins.map((bin) => <Cell key={bin.lead} fill={bin.countsAsRed ? CHART.high : CHART.normal} />)}
            </Bar>
            {thresholdBin !== undefined && (
              <ReferenceLine x={thresholdBin} stroke={CHART.value} strokeWidth={1}
                label={{ value: 'RAP threshold', position: 'top', fill: CHART.value, fontSize: 10 }} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
