'use client';

import React, { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FEATURE_LABELS, PAPER_TABLE4 } from '@/lib/iop/classifier';
import { CHART } from '@/lib/iop/viz/palette';
import { gaussian } from '@/lib/iop/viz/stats';
import { FEATURE_ORDER, type IopFeatures } from '@/lib/iop/types';
import ChartCard, { LegendKey } from './ChartCard';

interface FeatureDistributionChartProps {
  features: IopFeatures;
}

const SAMPLES = 80;

function curve(key: keyof IopFeatures, value: number) {
  const { normal, high } = PAPER_TABLE4[key];
  const rawLo = Math.min(normal.mean - 3 * normal.std, high.mean - 3 * high.std, value);
  const rawHi = Math.max(normal.mean + 3 * normal.std, high.mean + 3 * high.std, value);
  // Pad so this eye's line and its label never sit on the plot edge.
  const pad = (rawHi - rawLo) * 0.12;
  const lo = rawLo - pad;
  const hi = rawHi + pad;
  return Array.from({ length: SAMPLES + 1 }, (_, k) => {
    const x = lo + ((hi - lo) * k) / SAMPLES;
    return { x: +x.toFixed(4), normal: gaussian(x, normal.mean, normal.std), high: gaussian(x, high.mean, high.std) };
  });
}

function FeaturePanel({ featureKey, value }: { featureKey: keyof IopFeatures; value: number }) {
  const data = useMemo(() => curve(featureKey, value), [featureKey, value]);
  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-300">{FEATURE_LABELS[featureKey]}</p>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 16, right: 12, bottom: 0, left: 12 }}>
            <CartesianGrid stroke={CHART.grid} strokeWidth={1} vertical={false} />
            <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tick={{ fill: CHART.axis, fontSize: 10 }}
              tickFormatter={(v: number) => v.toFixed(2)} stroke={CHART.grid} tickCount={5} />
            <YAxis hide />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: `1px solid ${CHART.grid}`, fontSize: 12, color: CHART.text }}
              labelFormatter={(x) => `Value ${Number(x).toFixed(3)}`}
              formatter={(density, name) => [Number(density).toFixed(2), name === 'normal' ? 'Paper normal (density)' : 'Paper high (density)']}
            />
            <Area type="monotone" dataKey="normal" stroke={CHART.normal} strokeWidth={2} fill={CHART.normal} fillOpacity={0.1} dot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="high" stroke={CHART.high} strokeWidth={2} fill={CHART.high} fillOpacity={0.1} dot={false} isAnimationActive={false} />
            <ReferenceLine x={value} stroke={CHART.value} strokeWidth={2}
              label={{ value: `This eye ${value.toFixed(2)}`, position: 'top', fill: CHART.value, fontSize: 10 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * Where this eye's five features fall against the paper's per-class
 * distributions (Table 4 mean and STD, drawn as normal curves).
 */
export default function FeatureDistributionChart({ features }: FeatureDistributionChartProps) {
  const finite = FEATURE_ORDER.filter((key) => Number.isFinite(features[key]));
  return (
    <ChartCard
      title="This eye against the paper's two classes"
      subtitle="Curves: normal distributions from the paper's Table 4 (mean, STD) for normal-IOP and high-IOP eyes. White line: this eye. Orientation only - the paper's RAP threshold and active-contour settings are unpublished, so RAP and the contour features are not on its exact scale."
    >
      <div className="flex flex-wrap gap-4">
        <LegendKey colour={CHART.normal} label="Paper: normal IOP" />
        <LegendKey colour={CHART.high} label="Paper: high IOP" />
        <LegendKey colour={CHART.value} label="This eye" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {finite.map((key) => <FeaturePanel key={key} featureKey={key} value={features[key]} />)}
      </div>
    </ChartCard>
  );
}
