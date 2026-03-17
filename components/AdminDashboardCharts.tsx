'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import type { FeatureAnalytics } from '@/lib/featureAnalytics';

const CHART_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#8b5cf6'];
const PIE_COLORS = ['#3b82f6', '#64748b'];

/** Dark tooltip background, no white box */
const TOOLTIP_WRAPPER_STYLE = { backgroundColor: 'transparent', border: 'none' };

function DarkTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ name?: string; value?: unknown }>;
  label?: string | number;
  formatter?: (value: unknown) => [string, string];
}) {
  if (!active || !payload?.length) return null;
  const fmt = formatter ?? ((v: unknown) => [String(v), (payload?.[0] as { name?: string })?.name ?? 'Value']);
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 shadow-xl text-left">
      {label != null && <p className="text-slate-200 text-xs font-medium mb-1">{String(label)}</p>}
      {payload.map((entry, i) => {
        const [value, name] = fmt(entry.value);
        return (
          <p key={i} className="text-slate-300 text-xs">
            {name}: <span className="text-blue-300 font-mono">{value}</span>
          </p>
        );
      })}
    </div>
  );
}

type SessionsByDay = { date: string; count: number; label: string };

type DashboardStats = {
  total: number;
  last7: number;
  last14: number;
  withVideo: number;
  withCalibrationImages: number;
  meanErrorAvg: number | null;
  sessionsByDay: SessionsByDay[];
  sessionsByAge?: { range: string; count: number }[];
  sessionsByCountry?: { country: string; count: number }[];
  topEyeConditions?: { condition: string; count: number }[];
  featureAnalytics?: FeatureAnalytics;
};

export default function AdminDashboardCharts({ stats }: { stats: DashboardStats }) {
  const { total, last7, last14, withVideo, withCalibrationImages, meanErrorAvg, sessionsByDay, sessionsByAge, sessionsByCountry, topEyeConditions, featureAnalytics } =
    stats;

  const pieData = [
    { name: 'With video', value: withVideo, color: PIE_COLORS[0] },
    { name: 'No video', value: Math.max(0, total - withVideo), color: PIE_COLORS[1] },
  ].filter((d) => d.value > 0);

  const cardItems = [
    { label: 'Total sessions', value: total, sub: 'All time', accent: 'blue' },
    { label: 'Last 7 days', value: last7, sub: 'Recent activity', accent: 'green' },
    { label: 'Last 14 days', value: last14, sub: 'Trend period', accent: 'emerald' },
    { label: 'With video', value: withVideo, sub: `${total ? ((withVideo / total) * 100).toFixed(0) : 0}% of total`, accent: 'violet' },
    { label: 'With calibration images', value: withCalibrationImages, sub: `${total ? ((withCalibrationImages / total) * 100).toFixed(0) : 0}% of total`, accent: 'amber' },
    {
      label: 'Mean error (px)',
      value: meanErrorAvg !== null ? meanErrorAvg.toFixed(2) : '—',
      sub: 'Calibration quality',
      accent: 'rose',
    },
  ];

  const accentClasses: Record<string, string> = {
    blue: 'from-blue-500/20 to-blue-600/5 border-blue-500/30 text-blue-300',
    green: 'from-emerald-500/20 to-emerald-600/5 border-emerald-500/30 text-emerald-300',
    emerald: 'from-teal-500/20 to-teal-600/5 border-teal-500/30 text-teal-300',
    violet: 'from-violet-500/20 to-violet-600/5 border-violet-500/30 text-violet-300',
    amber: 'from-amber-500/20 to-amber-600/5 border-amber-500/30 text-amber-300',
    rose: 'from-rose-500/20 to-rose-600/5 border-rose-500/30 text-rose-300',
  };

  return (
    <div className="space-y-8">
      {/* Summary cards */}
      <div>
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">
          Overview
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {cardItems.map(({ label, value, sub, accent }) => (
            <div
              key={label}
              className={`rounded-xl bg-gradient-to-br ${accentClasses[accent]} border p-4 shadow-lg backdrop-blur-sm`}
            >
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{label}</p>
              <p className="text-2xl font-bold text-white mt-1 tabular-nums">{value}</p>
              <p className="text-slate-500 text-xs mt-1">{sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Sessions over time */}
      <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-5 shadow-xl">
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">
          Sessions over time (last 14 days)
        </h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sessionsByDay} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="fillSessions" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="label"
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                axisLine={{ stroke: '#475569' }}
                tickLine={{ stroke: '#475569' }}
              />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                axisLine={{ stroke: '#475569' }}
                tickLine={{ stroke: '#475569' }}
                allowDecimals={false}
              />
              <Tooltip
                cursor={false}
                wrapperStyle={TOOLTIP_WRAPPER_STYLE}
                content={({ active, payload, label }) => (
                  <DarkTooltip active={active} payload={payload} label={label} formatter={(v) => [String(v), 'Sessions']} />
                )}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#fillSessions)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Two columns: Bar chart + Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-5 shadow-xl">
          <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">
            Sessions by day (last 14 days)
          </h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sessionsByDay} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  axisLine={{ stroke: '#475569' }}
                  tickLine={{ stroke: '#475569' }}
                />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  axisLine={{ stroke: '#475569' }}
                  tickLine={{ stroke: '#475569' }}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={false}
                  wrapperStyle={TOOLTIP_WRAPPER_STYLE}
                  content={({ active, payload, label }) => (
                    <DarkTooltip active={active} payload={payload} label={label} formatter={(v) => [String(v), 'Sessions']} />
                  )}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-5 shadow-xl">
          <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">
            Sessions with video
          </h2>
          <div className="h-64 flex items-center justify-center">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) =>
                      `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                    }
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    cursor={false}
                    wrapperStyle={TOOLTIP_WRAPPER_STYLE}
                    content={({ active, payload, label }) => (
                      <DarkTooltip active={active} payload={payload} label={label} formatter={(v) => [String(v), 'Sessions']} />
                    )}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: '12px' }}
                    formatter={(value) => <span className="text-slate-300">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-slate-500 text-sm">No session data yet</p>
            )}
          </div>
        </div>
        </div>

      {/* Demographics: by age, country, eye conditions */}
      {(sessionsByAge?.length || sessionsByCountry?.length || topEyeConditions?.length) ? (
        <div className="space-y-6">
          <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
            Demographics (sessions with demographics)
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {sessionsByAge && sessionsByAge.length > 0 && (
              <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-5 shadow-xl">
                <h3 className="text-slate-300 font-medium mb-1">Sessions by age</h3>
                <p className="text-slate-500 text-xs mb-4">Age range (years)</p>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sessionsByAge} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                      <XAxis dataKey="range" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
                      <Tooltip cursor={false} wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={({ active, payload, label }) => <DarkTooltip active={active} payload={payload} label={label} />} />
                      <Bar dataKey="count" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
            {sessionsByCountry && sessionsByCountry.length > 0 && (
              <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-5 shadow-xl">
                <h3 className="text-slate-300 font-medium mb-1">Sessions by country</h3>
                <p className="text-slate-500 text-xs mb-4">Top countries</p>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sessionsByCountry.slice(0, 12)} layout="vertical" margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
                      <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <YAxis type="category" dataKey="country" tick={{ fill: '#94a3b8', fontSize: 10 }} width={100} />
                      <Tooltip cursor={false} wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={({ active, payload, label }) => <DarkTooltip active={active} payload={payload} label={label} />} />
                      <Bar dataKey="count" fill="#10b981" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
            {topEyeConditions && topEyeConditions.length > 0 && (
              <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-5 shadow-xl">
                <h3 className="text-slate-300 font-medium mb-1">Top eye conditions</h3>
                <p className="text-slate-500 text-xs mb-4">Most reported (sessions may have multiple)</p>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topEyeConditions.slice(0, 12)} layout="vertical" margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
                      <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <YAxis type="category" dataKey="condition" tick={{ fill: '#94a3b8', fontSize: 10 }} width={90} />
                      <Tooltip cursor={false} wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={({ active, payload, label }) => <DarkTooltip active={active} payload={payload} label={label} />} />
                      <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {featureAnalytics && (featureAnalytics.totalSamples > 0 || featureAnalytics.validationErrorBuckets.some((b) => b.count > 0) || featureAnalytics.sessionMeanErrorList.length > 0) && (
        <div className="space-y-6">
          <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
            Calibration features & accuracy
          </h2>
          {featureAnalytics.totalSamples > 0 && (
            <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-5 shadow-xl">
              <h3 className="text-slate-300 font-medium mb-1">Feature vector (mean per dimension)</h3>
              <p className="text-slate-500 text-xs mb-4">
                {featureAnalytics.totalSamples.toLocaleString()} samples from {featureAnalytics.sessionsWithFeatures} sessions.
              </p>
              <div className="h-80 overflow-x-auto">
                <ResponsiveContainer width={Math.max(800, featureAnalytics.dimensionStats.length * 44)} height="100%">
                  <BarChart data={featureAnalytics.dimensionStats} layout="vertical" margin={{ top: 4, right: 24, left: 90, bottom: 4 }}>
                    <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} width={88} />
                    <Tooltip cursor={false} wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={({ active, payload, label }) => <DarkTooltip active={active} payload={payload} label={label} />} />
                    <Bar dataKey="mean" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {featureAnalytics.validationErrorBuckets.some((b) => b.count > 0) && (
              <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-5 shadow-xl">
                <h3 className="text-slate-300 font-medium mb-1">Per-point validation error (px)</h3>
                <p className="text-slate-500 text-xs mb-4">Error at each calibration point</p>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={featureAnalytics.validationErrorBuckets} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <XAxis dataKey="range" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
                      <Tooltip cursor={false} wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={({ active, payload, label }) => <DarkTooltip active={active} payload={payload} label={label} />} />
                      <Bar dataKey="count" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
            {featureAnalytics.sessionMeanErrorList.length > 0 && (() => {
              const buckets = [
                { range: '0–2 px', from: 0, to: 2 },
                { range: '2–5 px', from: 2, to: 5 },
                { range: '5–10 px', from: 5, to: 10 },
                { range: '10–20 px', from: 10, to: 20 },
                { range: '20+ px', from: 20, to: Infinity },
              ];
              const data = buckets.map(({ range, from, to }) => ({
                range,
                count: featureAnalytics.sessionMeanErrorList.filter((e) => e >= from && e < to).length,
              }));
              return (
                <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-5 shadow-xl">
                  <h3 className="text-slate-300 font-medium mb-1">Session mean error (px)</h3>
                  <p className="text-slate-500 text-xs mb-4">Mean calibration error per session</p>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                        <XAxis dataKey="range" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
                        <Tooltip cursor={false} wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={({ active, payload, label }) => <DarkTooltip active={active} payload={payload} label={label} />} />
                        <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
