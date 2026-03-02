'use client';

import { useMemo } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  LineChart,
  Line,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { FEATURE_DIMENSION_NAMES } from '@/lib/featureAnalytics';

type CalibrationSample = {
  screenX?: number;
  screenY?: number;
  features?: number[];
  timestamp?: number;
  head?: {
    valid: boolean;
    message: string;
    faceWidth?: number;
  };
};

type TestTrajectoryPoint = { t: number; targetX: number; targetY: number; gazeX: number; gazeY: number };
export type TestTrajectorySegment = { patternName: string; points: TestTrajectoryPoint[] };

type Props = {
  samples: CalibrationSample[];
  validationErrors?: number[];
  meanErrorPx?: number | null;
  /** From Test mode: target vs gaze recorded during exercises (config.testTrajectories) */
  testTrajectories?: TestTrajectorySegment[] | null;
};

function DarkTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ name?: string; value?: unknown; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 shadow-xl text-left">
      {label != null && <p className="text-slate-200 text-xs font-medium mb-1">{String(label)}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="text-xs" style={{ color: entry.color ?? '#94a3b8' }}>
          {entry.name}: <span className="font-mono">{typeof entry.value === 'number' ? entry.value.toFixed(3) : String(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-5">
      <h3 className="text-sm font-semibold text-white mb-0.5">{title}</h3>
      {subtitle && <p className="text-[11px] text-slate-500 mb-3">{subtitle}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function StatBox({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div className="rounded-lg bg-slate-800 border border-slate-600/50 px-3 py-2 text-center">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="text-lg font-mono font-bold tabular-nums mt-0.5" style={{ color: color ?? '#e2e8f0' }}>
        {value}
        {unit && <span className="text-xs text-slate-500 ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

export default function SessionAnalytics({ samples, validationErrors, meanErrorPx, testTrajectories }: Props) {
  const samplesWithFeatures = useMemo(
    () => samples.filter((s) => Array.isArray(s.features) && s.features.length >= FEATURE_DIMENSION_NAMES.length),
    [samples],
  );

  const eyeData = useMemo(() => {
    return samplesWithFeatures.map((s, i) => {
      const f = s.features!;
      return {
        idx: i,
        leftX: f[1], leftY: f[2],
        rightX: f[3], rightY: f[4],
        leftR: f[5], leftTheta: f[6],
        rightR: f[7], rightTheta: f[8],
        pitch: (f[9] * 180) / Math.PI,
        yaw: (f[10] * 180) / Math.PI,
        roll: (f[11] * 180) / Math.PI,
        faceWidth: s.head?.faceWidth,
        headValid: s.head?.valid,
      };
    });
  }, [samplesWithFeatures]);

  const stats = useMemo(() => {
    if (eyeData.length === 0) return null;
    const vals = (key: keyof typeof eyeData[0]) => eyeData.map((d) => d[key]).filter((v): v is number => typeof v === 'number');
    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const std = (arr: number[]) => {
      if (arr.length < 2) return 0;
      const m = avg(arr);
      return Math.sqrt(arr.reduce((a, v) => a + (v - m) ** 2, 0) / (arr.length - 1));
    };

    const pitches = vals('pitch');
    const yaws = vals('yaw');
    const rolls = vals('roll');
    const leftRs = vals('leftR');
    const rightRs = vals('rightR');
    const faceWidths = vals('faceWidth');
    const headValidCount = eyeData.filter((d) => d.headValid === true).length;

    return {
      count: eyeData.length,
      headValidRate: eyeData.length ? (headValidCount / eyeData.length) * 100 : 0,
      pitch: { mean: avg(pitches), std: std(pitches), min: Math.min(...pitches), max: Math.max(...pitches) },
      yaw: { mean: avg(yaws), std: std(yaws), min: Math.min(...yaws), max: Math.max(...yaws) },
      roll: { mean: avg(rolls), std: std(rolls), min: Math.min(...rolls), max: Math.max(...rolls) },
      leftR: { mean: avg(leftRs), std: std(leftRs) },
      rightR: { mean: avg(rightRs), std: std(rightRs) },
      faceWidth: faceWidths.length ? { mean: avg(faceWidths), std: std(faceWidths) } : null,
    };
  }, [eyeData]);

  const validationData = useMemo(() => {
    if (!validationErrors?.length) return null;
    return validationErrors.map((err, i) => ({ index: i + 1, error: err }));
  }, [validationErrors]);

  const errorBuckets = useMemo(() => {
    if (!validationErrors?.length) return null;
    const buckets = [
      { range: '0–2', from: 0, to: 2, count: 0 },
      { range: '2–5', from: 2, to: 5, count: 0 },
      { range: '5–10', from: 5, to: 10, count: 0 },
      { range: '10–20', from: 10, to: 20, count: 0 },
      { range: '20+', from: 20, to: Infinity, count: 0 },
    ];
    for (const e of validationErrors) {
      const b = buckets.find((b) => e >= b.from && e < b.to);
      if (b) b.count++;
    }
    return buckets;
  }, [validationErrors]);

  const eyePositionScatter = useMemo(() => {
    return eyeData.flatMap((d, i) => [
      { x: d.leftX, y: d.leftY, eye: 'Left', idx: i },
      { x: d.rightX, y: d.rightY, eye: 'Right', idx: i },
    ]);
  }, [eyeData]);

  const headPoseOverTime = useMemo(() => {
    return eyeData.map((d, i) => ({
      sample: i + 1,
      pitch: d.pitch,
      yaw: d.yaw,
      roll: d.roll,
    }));
  }, [eyeData]);

  const headPoseRadar = useMemo(() => {
    if (!stats) return [];
    return [
      { axis: 'Pitch range', value: Math.abs(stats.pitch.max - stats.pitch.min) },
      { axis: 'Yaw range', value: Math.abs(stats.yaw.max - stats.yaw.min) },
      { axis: 'Roll range', value: Math.abs(stats.roll.max - stats.roll.min) },
      { axis: 'Pitch σ', value: stats.pitch.std * 3 },
      { axis: 'Yaw σ', value: stats.yaw.std * 3 },
      { axis: 'Roll σ', value: stats.roll.std * 3 },
    ];
  }, [stats]);

  const featureDimStats = useMemo(() => {
    if (samplesWithFeatures.length === 0) return [];
    const dimCount = FEATURE_DIMENSION_NAMES.length;
    return Array.from({ length: dimCount }, (_, i) => {
      const values = samplesWithFeatures.map((s) => s.features![i]).filter((v) => typeof v === 'number');
      const n = values.length;
      const mean = n ? values.reduce((a, b) => a + b, 0) / n : 0;
      const variance = n > 1 ? values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1) : 0;
      return {
        name: FEATURE_DIMENSION_NAMES[i],
        mean,
        std: Math.sqrt(variance),
        min: n ? Math.min(...values) : 0,
        max: n ? Math.max(...values) : 0,
        n,
      };
    });
  }, [samplesWithFeatures]);

  if (samples.length === 0) return null;

  const BUCKET_COLORS = ['#22c55e', '#3b82f6', '#eab308', '#f97316', '#ef4444'];

  return (
    <div className="space-y-6">
      {/* Test mode: Target vs Gaze (from config.testTrajectories) */}
      {testTrajectories && testTrajectories.length > 0 && (
        <SectionCard
          title="Test mode: Target vs Eye tracking"
          subtitle="Target position (%) and predicted gaze (%) over time — each exercise step recorded in Test mode."
        >
          <div className="space-y-6">
            {testTrajectories.map((seg, i) => (
              <details key={i} className="rounded-lg border border-slate-700 bg-slate-900/40 overflow-hidden" open={i === 0}>
                <summary className="cursor-pointer select-none px-3 py-2 flex items-center justify-between gap-3 hover:bg-slate-800/50">
                  <span className="text-sm font-medium text-slate-200">{seg.patternName}</span>
                  <span className="text-[10px] text-slate-500">{seg.points.length} points</span>
                </summary>
                <div className="px-3 pb-3 pt-1 grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] text-slate-500 mb-1">X — Position (%)</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={seg.points} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="t" tick={{ fill: '#64748b', fontSize: 10 }} name="Time (s)" />
                        <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} />
                        <Tooltip content={<DarkTooltip />} />
                        <ReferenceLine y={50} stroke="#334155" />
                        <Line type="monotone" dataKey="targetX" stroke="#86efac" strokeWidth={2} dot={false} name="Target X" />
                        <Line type="monotone" dataKey="gazeX" stroke="#a78bfa" strokeWidth={2} dot={false} name="Eye X" />
                      </LineChart>
                    </ResponsiveContainer>
                    <div className="flex gap-4 mt-1">
                      <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-300" /> Target</span>
                      <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-400" /> Eye</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 mb-1">Y — Position (%)</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={seg.points} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="t" tick={{ fill: '#64748b', fontSize: 10 }} name="Time (s)" />
                        <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} />
                        <Tooltip content={<DarkTooltip />} />
                        <ReferenceLine y={50} stroke="#334155" />
                        <Line type="monotone" dataKey="targetY" stroke="#86efac" strokeWidth={2} dot={false} name="Target Y" />
                        <Line type="monotone" dataKey="gazeY" stroke="#a78bfa" strokeWidth={2} dot={false} name="Eye Y" />
                      </LineChart>
                    </ResponsiveContainer>
                    <div className="flex gap-4 mt-1">
                      <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-300" /> Target</span>
                      <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-400" /> Eye</span>
                    </div>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Summary stats */}
      {stats && (
        <SectionCard title="Summary" subtitle={`${stats.count} samples with features · ${samples.length} total samples`}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatBox label="Samples" value={String(samples.length)} />
            <StatBox label="With features" value={String(stats.count)} />
            <StatBox label="Head valid" value={`${stats.headValidRate.toFixed(0)}%`} color={stats.headValidRate > 80 ? '#22c55e' : '#eab308'} />
            <StatBox label="Mean error" value={meanErrorPx != null ? meanErrorPx.toFixed(1) : '—'} unit="px" color={meanErrorPx != null && meanErrorPx < 10 ? '#22c55e' : '#eab308'} />
            <StatBox label="Avg pupil R" value={((stats.leftR.mean + stats.rightR.mean) / 2).toFixed(4)} />
            {stats.faceWidth && <StatBox label="Avg face width" value={stats.faceWidth.mean.toFixed(3)} />}
          </div>
        </SectionCard>
      )}

      {/* Validation errors */}
      {validationData && errorBuckets && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard title="Validation error per point" subtitle="Error in pixels for each calibration point">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={validationData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="index" tick={{ fill: '#64748b', fontSize: 10 }} label={{ value: 'Point #', fill: '#64748b', fontSize: 10, position: 'insideBottom', offset: -2 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} label={{ value: 'Error (px)', fill: '#64748b', fontSize: 10, angle: -90, position: 'insideLeft' }} />
                {meanErrorPx != null && <ReferenceLine y={meanErrorPx} stroke="#f59e0b" strokeDasharray="6 3" label={{ value: `Mean ${meanErrorPx.toFixed(1)}`, fill: '#f59e0b', fontSize: 10, position: 'right' }} />}
                <Tooltip content={<DarkTooltip />} />
                <Bar dataKey="error" radius={[3, 3, 0, 0]}>
                  {validationData.map((d, i) => (
                    <Cell key={i} fill={d.error < 5 ? '#22c55e' : d.error < 10 ? '#3b82f6' : d.error < 20 ? '#eab308' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>

          <SectionCard title="Error distribution" subtitle="How many calibration points fall in each error bucket">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={errorBuckets} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="range" tick={{ fill: '#64748b', fontSize: 10 }} label={{ value: 'Error range (px)', fill: '#64748b', fontSize: 10, position: 'insideBottom', offset: -2 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} allowDecimals={false} />
                <Tooltip content={<DarkTooltip />} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {errorBuckets.map((_, i) => (
                    <Cell key={i} fill={BUCKET_COLORS[i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>
        </div>
      )}

      {/* Eye position scatter + Head pose over time */}
      {eyeData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard title="Pupil position distribution" subtitle="Left (blue) and Right (green) eye normalized positions">
            <ResponsiveContainer width="100%" height={260}>
              <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" dataKey="x" name="X" tick={{ fill: '#64748b', fontSize: 10 }} label={{ value: 'X', fill: '#64748b', fontSize: 10, position: 'insideBottom', offset: -5 }} />
                <YAxis type="number" dataKey="y" name="Y" tick={{ fill: '#64748b', fontSize: 10 }} label={{ value: 'Y', fill: '#64748b', fontSize: 10, angle: -90, position: 'insideLeft' }} />
                <Tooltip content={<DarkTooltip />} />
                <Scatter
                  data={eyePositionScatter.filter((d) => d.eye === 'Left')}
                  fill="#3b82f6"
                  fillOpacity={0.6}
                  r={3}
                  name="Left eye"
                />
                <Scatter
                  data={eyePositionScatter.filter((d) => d.eye === 'Right')}
                  fill="#22c55e"
                  fillOpacity={0.6}
                  r={3}
                  name="Right eye"
                />
              </ScatterChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-6 mt-1">
              <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Left eye</span>
              <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Right eye</span>
            </div>
          </SectionCard>

          <SectionCard title="Head pose over samples" subtitle="Pitch, Yaw, Roll (degrees) across calibration samples">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={headPoseOverTime} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="sample" tick={{ fill: '#64748b', fontSize: 10 }} label={{ value: 'Sample #', fill: '#64748b', fontSize: 10, position: 'insideBottom', offset: -5 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} label={{ value: 'Degrees', fill: '#64748b', fontSize: 10, angle: -90, position: 'insideLeft' }} />
                <ReferenceLine y={0} stroke="#475569" />
                <Tooltip content={<DarkTooltip />} />
                <Line type="monotone" dataKey="pitch" stroke="#22d3ee" strokeWidth={1.5} dot={false} name="Pitch" />
                <Line type="monotone" dataKey="yaw" stroke="#22c55e" strokeWidth={1.5} dot={false} name="Yaw" />
                <Line type="monotone" dataKey="roll" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Roll" />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-6 mt-1">
              <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" /> Pitch</span>
              <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Yaw</span>
              <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Roll</span>
            </div>
          </SectionCard>
        </div>
      )}

      {/* Head pose stability radar + Pupil radius over time */}
      {eyeData.length > 0 && stats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard title="Head pose stability" subtitle="Range and variability (3σ) of each rotation axis — smaller = more stable">
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart data={headPoseRadar} cx="50%" cy="50%" outerRadius="70%">
                <PolarGrid stroke="#334155" />
                <PolarAngleAxis dataKey="axis" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <PolarRadiusAxis tick={{ fill: '#64748b', fontSize: 9 }} />
                <Tooltip content={<DarkTooltip />} />
                <Radar dataKey="value" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.25} strokeWidth={2} name="°" />
              </RadarChart>
            </ResponsiveContainer>
          </SectionCard>

          <SectionCard title="Pupil radius over samples" subtitle="Distance of pupil from iris center for each eye">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart
                data={eyeData.map((d, i) => ({ sample: i + 1, leftR: d.leftR, rightR: d.rightR }))}
                margin={{ top: 10, right: 10, left: 0, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="sample" tick={{ fill: '#64748b', fontSize: 10 }} label={{ value: 'Sample #', fill: '#64748b', fontSize: 10, position: 'insideBottom', offset: -5 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} label={{ value: 'R', fill: '#64748b', fontSize: 10, angle: -90, position: 'insideLeft' }} />
                <Tooltip content={<DarkTooltip />} />
                <Line type="monotone" dataKey="leftR" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Left R" />
                <Line type="monotone" dataKey="rightR" stroke="#22c55e" strokeWidth={1.5} dot={false} name="Right R" />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-6 mt-1">
              <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Left R</span>
              <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Right R</span>
            </div>
          </SectionCard>
        </div>
      )}

      {/* Feature dimension statistics table */}
      {featureDimStats.length > 0 && (
        <SectionCard title="Feature dimension statistics" subtitle="Statistical summary of all 18 feature dimensions across samples">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left text-slate-500 font-medium py-2 px-2">#</th>
                  <th className="text-left text-slate-500 font-medium py-2 px-2">Feature</th>
                  <th className="text-right text-slate-500 font-medium py-2 px-2">Mean</th>
                  <th className="text-right text-slate-500 font-medium py-2 px-2">Std</th>
                  <th className="text-right text-slate-500 font-medium py-2 px-2">Min</th>
                  <th className="text-right text-slate-500 font-medium py-2 px-2">Max</th>
                  <th className="text-right text-slate-500 font-medium py-2 px-2">N</th>
                </tr>
              </thead>
              <tbody>
                {featureDimStats.map((dim, i) => (
                  <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                    <td className="text-slate-500 py-1.5 px-2 tabular-nums">{i}</td>
                    <td className="text-slate-300 py-1.5 px-2 font-medium">{dim.name}</td>
                    <td className="text-right font-mono text-slate-200 py-1.5 px-2 tabular-nums">{dim.mean.toFixed(4)}</td>
                    <td className="text-right font-mono text-slate-400 py-1.5 px-2 tabular-nums">{dim.std.toFixed(4)}</td>
                    <td className="text-right font-mono text-slate-400 py-1.5 px-2 tabular-nums">{dim.min.toFixed(4)}</td>
                    <td className="text-right font-mono text-slate-400 py-1.5 px-2 tabular-nums">{dim.max.toFixed(4)}</td>
                    <td className="text-right text-slate-500 py-1.5 px-2 tabular-nums">{dim.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
