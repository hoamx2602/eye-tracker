'use client';

/**
 * ResultsPageClient — full user-facing results page (Phase 5).
 * Sections A–F per mvp-plan.md.
 */

import React, { useMemo, useState } from 'react';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import {
  computeAllScores,
  calibrationQualityLabel,
  calibrationQualityColour,
  eyeTrackingAccuracyScore,
  selfAssessmentInsight,
  symptomTotal,
  DOMAIN_ICONS,
  DOMAIN_NAMES,
  SYMPTOM_LABELS,
} from '@/lib/resultScoring';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CalibrationGazeSample {
  screenX?: number;
  screenY?: number;
  x?: number;
  y?: number;
  timestamp?: number;
  t?: number;
}

interface RunData {
  id: string;
  status: string;
  createdAt: string;
  testOrderSnapshot: string[];
  configSnapshot: Record<string, unknown>;
  preSymptomScores: Record<string, number> | null;
  postSymptomScores: Record<string, number> | null;
  testResults: Record<string, Record<string, unknown>>;
  session: {
    id: string;
    meanErrorPx: number | null;
    demographics: Record<string, unknown> | null;
    createdAt: string | null;
    calibrationGazeSamples: unknown[];
  };
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-bold text-white">{title}</h2>
      {subtitle && <p className="text-sm text-gray-400 mt-1">{subtitle}</p>}
    </div>
  );
}

function ScoreBar({ score, disabled }: { score: number | null; disabled?: boolean }) {
  if (disabled || score === null) {
    return (
      <div className="w-full h-2 rounded-full bg-gray-800">
        <div className="h-full w-0 rounded-full" />
      </div>
    );
  }
  const pct = `${score}%`;
  const colour = score >= 70 ? 'from-emerald-500 to-green-400'
    : score >= 40 ? 'from-blue-500 to-cyan-400'
    : 'from-amber-500 to-yellow-400';
  return (
    <div className="w-full h-2 rounded-full bg-gray-800">
      <div
        className={`h-full rounded-full bg-gradient-to-r ${colour} transition-all duration-700`}
        style={{ width: pct }}
      />
    </div>
  );
}

/** Accuracy dial / gauge (SVG arc) */
function AccuracyDial({ score }: { score: number }) {
  const radius = 52;
  const cx = 70;
  const cy = 70;
  const strokeWidth = 10;
  const circumference = Math.PI * radius; // half circle
  const filled = (score / 100) * circumference;

  // Arc path: start at left, end at right (180° sweep)
  const startX = cx - radius;
  const startY = cy;
  const endX = cx + radius;
  const endY = cy;

  const arcPath = `M ${startX} ${startY} A ${radius} ${radius} 0 0 1 ${endX} ${endY}`;

  const colour = score >= 70 ? '#34d399' : score >= 40 ? '#60a5fa' : '#f59e0b';

  return (
    <svg viewBox="0 0 140 90" className="w-full max-w-[200px]">
      {/* Background arc */}
      <path d={arcPath} fill="none" stroke="#1f2937" strokeWidth={strokeWidth} strokeLinecap="round" />
      {/* Score arc */}
      <path
        d={arcPath}
        fill="none"
        stroke={colour}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
        style={{ filter: `drop-shadow(0 0 6px ${colour}88)` }}
      />
      {/* Score number */}
      <text x={cx} y={cy - 4} textAnchor="middle" fill="white" fontSize="22" fontWeight="bold">
        {score}
      </text>
      {/* Label */}
      <text x={cx} y={cy + 14} textAnchor="middle" fill="#9ca3af" fontSize="8.5">
        Eye Tracking Accuracy
      </text>
    </svg>
  );
}

/** Calibration gaze samples mini visualisation */
function CalibrationPatternViz({ samples }: { samples: unknown[] }) {
  const [hovered, setHovered] = useState<CalibrationGazeSample | null>(null);

  const points = useMemo(() => {
    return samples.map((s) => {
      const sample = s as CalibrationGazeSample;
      return {
        x: sample.screenX ?? sample.x ?? 0,
        y: sample.screenY ?? sample.y ?? 0,
        t: sample.timestamp ?? sample.t ?? 0,
      };
    });
  }, [samples]);

  if (points.length === 0) return <p className="text-gray-600 text-xs">No calibration data available.</p>;

  // Normalise to 0–100
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const VW = 280, VH = 180;
  const pad = 10;

  const norm = points.map((p) => ({
    px: pad + ((p.x - minX) / rangeX) * (VW - pad * 2),
    py: pad + ((p.y - minY) / rangeY) * (VH - pad * 2),
    t: p.t,
  }));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        className="w-full rounded-xl bg-gray-900/60 border border-gray-800"
        style={{ maxHeight: 200 }}
      >
        {/* Path line */}
        <polyline
          points={norm.map((p) => `${p.px},${p.py}`).join(' ')}
          fill="none"
          stroke="#3b82f680"
          strokeWidth="1"
        />
        {/* Sample dots */}
        {norm.map((p, i) => (
          <circle
            key={i}
            cx={p.px}
            cy={p.py}
            r={3}
            fill="#60a5fa"
            opacity={0.7}
            onMouseEnter={() => setHovered(samples[i] as CalibrationGazeSample)}
            onMouseLeave={() => setHovered(null)}
            className="cursor-pointer hover:opacity-100"
          />
        ))}
      </svg>
      {hovered && (
        <div className="absolute top-2 right-2 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300 pointer-events-none">
          x: {Math.round((hovered.screenX ?? hovered.x ?? 0))}px<br />
          y: {Math.round((hovered.screenY ?? hovered.y ?? 0))}px
          {(hovered.timestamp || hovered.t) ? <><br />t: {hovered.timestamp ?? hovered.t}ms</> : null}
        </div>
      )}
      <p className="text-xs text-gray-600 mt-2">How your eyes tracked the calibration targets.</p>
    </div>
  );
}

/** Trait card */
function TraitCard({ icon, label, description }: { icon: string; label: string; description: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-gray-900/60 border border-gray-800 p-4">
      <span className="text-2xl">{icon}</span>
      <p className="text-sm font-semibold text-white">{label}</p>
      <p className="text-xs text-gray-400 leading-snug">{description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ResultsPageClient({ runData }: { runData: RunData }) {
  const { session, testOrderSnapshot, testResults, configSnapshot, preSymptomScores, postSymptomScores } = runData;
  const meanErrorPx = session.meanErrorPx;

  // Extract scoring config from configSnapshot
  const configSnap = configSnapshot as {
    testParameters?: Record<string, Record<string, unknown>>;
    testEnabled?: Record<string, boolean>;
  };
  const scoringConfig = (configSnap?.testParameters?.['_scoring'] as Record<string, Record<string, number>> | undefined) ?? undefined;
  const enabledTests: Record<string, boolean> = configSnap?.testEnabled ?? {};

  // Compute all domain scores
  const scores = useMemo(
    () => computeAllScores(testResults, testOrderSnapshot, enabledTests, scoringConfig),
    [testResults, testOrderSnapshot, enabledTests, scoringConfig]
  );

  // Eye tracking accuracy
  const etScore = meanErrorPx != null ? eyeTrackingAccuracyScore(meanErrorPx) : null;

  // Trait derivations
  const saccadicMetrics = (testResults.saccadic?.metrics ?? testResults.saccadic ?? {}) as Record<string, unknown>;
  const fixMetrics = (testResults.fixation_stability?.metrics ?? testResults.fixation_stability ?? {}) as Record<string, unknown>;

  const avgLatencyMs = typeof saccadicMetrics.avgLatencyMs === 'number' ? saccadicMetrics.avgLatencyMs
    : typeof saccadicMetrics.meanLatencyMs === 'number' ? saccadicMetrics.meanLatencyMs : null;
  const bcea95 = typeof fixMetrics.bcea95Px2 === 'number' ? fixMetrics.bcea95Px2
    : typeof fixMetrics.bceaPx2 === 'number' ? fixMetrics.bceaPx2 : null;

  const selfAssessInsight = selfAssessmentInsight(testResults, scores);
  const selfAssessConfig = configSnap?.testParameters?.['_selfAssessment'] as Record<string, unknown> | undefined;
  const selfAssessEnabled = selfAssessInsight !== null && (selfAssessConfig?.enabled !== false);

  const preTotal = symptomTotal(preSymptomScores);
  const postTotal = symptomTotal(postSymptomScores);
  const hasSymptoms = preSymptomScores !== null && postSymptomScores !== null;

  // Radar chart data
  const radarData = scores.map((s) => ({
    domain: s.domainName,
    score: s.score ?? 0,
    notAssessed: s.score === null,
  }));

  // Date
  const assessmentDate = runData.createdAt
    ? new Date(runData.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  // Demographics
  const demographics = session.demographics;
  const firstName = demographics
    ? (demographics.firstName as string | undefined) ?? (demographics.name as string | undefined) ?? null
    : null;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav bar */}
      <div className="sticky top-0 z-40 border-b border-gray-800/60 bg-gray-950/90 backdrop-blur-sm">
        <div className="mx-auto max-w-4xl flex items-center gap-3 px-4 py-3">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 20 20" fill="none" stroke="white" strokeWidth="1.5" className="w-4 h-4">
              <circle cx="10" cy="10" r="8" />
              <circle cx="10" cy="10" r="3.5" />
              <circle cx="10" cy="10" r="1" fill="white" stroke="none" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-white">Eye Assessment</span>
          <span className="ml-auto text-xs text-gray-500">{assessmentDate}</span>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-10 space-y-12">

        {/* ——————————————————————————————————————————————
            Section A — Header
        —————————————————————————————————————————————— */}
        <section>
          <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 sm:p-8">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-2 font-semibold">Assessment complete</p>
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">
              Your Assessment Results
              {firstName ? <span className="text-blue-400">, {firstName}</span> : null}
            </h1>
            <p className="text-sm text-gray-400 mb-5">{assessmentDate}</p>
            {meanErrorPx != null && (
              <div className={`inline-flex items-center gap-2 text-sm font-medium ${calibrationQualityColour(meanErrorPx)}`}>
                <span className="text-lg">●</span>
                <span>{calibrationQualityLabel(meanErrorPx)}</span>
              </div>
            )}
          </div>
        </section>

        {/* ——————————————————————————————————————————————
            Section B — Eye Tracking Profile
        —————————————————————————————————————————————— */}
        <section>
          <SectionHeader
            title="Eye Tracking Profile"
            subtitle="How accurately the eye tracker followed your gaze during calibration."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* B1 — Accuracy dial */}
            <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 flex flex-col items-center gap-4">
              <h3 className="text-sm font-semibold text-gray-300 self-start">Gaze Accuracy</h3>
              {etScore != null ? (
                <AccuracyDial score={etScore} />
              ) : (
                <p className="text-gray-600 text-sm">Calibration data unavailable.</p>
              )}
            </div>

            {/* B2 — Calibration pattern */}
            <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-gray-300">Calibration Gaze Path</h3>
              <CalibrationPatternViz samples={session.calibrationGazeSamples} />
            </div>
          </div>

          {/* B3 — Trait cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
            <TraitCard
              icon="🎯"
              label="Tracking Precision"
              description={
                meanErrorPx == null ? 'Calibration data unavailable.'
                : meanErrorPx < 30 ? 'Your gaze tracking was very precise throughout calibration.'
                : meanErrorPx < 60 ? 'Your gaze tracking was accurate across calibration targets.'
                : 'Some drift occurred during calibration — results are still informative.'
              }
            />
            <TraitCard
              icon="⚡"
              label="Response Speed"
              description={
                avgLatencyMs == null ? 'Run the Saccadic test to see response speed.'
                : avgLatencyMs < 250 ? 'Your eyes responded very quickly when targets appeared.'
                : avgLatencyMs < 450 ? 'Your eye response time was in the typical range.'
                : 'Your eye responses were a bit slower — fatigue can be a factor.'
              }
            />
            <TraitCard
              icon="🌊"
              label="Gaze Stability"
              description={
                bcea95 == null ? 'Run the Fixation Stability test to see gaze stability.'
                : bcea95 < 2000 ? 'Your gaze held very steady when fixating on a point.'
                : bcea95 < 6000 ? 'Your gaze stability was in the typical range.'
                : 'Your fixation showed some variability — micro-movements are normal.'
              }
            />
          </div>
        </section>

        {/* ——————————————————————————————————————————————
            Section C — Assessment Scores
        —————————————————————————————————————————————— */}
        <section>
          <SectionHeader
            title="Assessment Scores"
            subtitle="Your performance across all neurological assessment domains."
          />

          {/* Radar chart */}
          <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 mb-6">
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                <PolarGrid stroke="#374151" />
                <PolarAngleAxis
                  dataKey="domain"
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '12px' }}
                  labelStyle={{ color: '#f9fafb', fontWeight: 600 }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any, _name: any, props: any) => {
                    const notAssessed = props?.payload?.notAssessed;
                    return [notAssessed ? 'Not assessed' : `${value ?? 0} / 100`, ''];
                  }}
                />
                <Radar
                  name="Score"
                  dataKey="score"
                  stroke="#3b82f6"
                  fill="#3b82f6"
                  fillOpacity={0.25}
                  dot={{ fill: '#60a5fa', strokeWidth: 0, r: 4 }}
                />
              </RadarChart>
            </ResponsiveContainer>
            <p className="text-xs text-gray-600 text-center mt-1">Domains in amber scored below 40 — labelled "Room to grow".</p>
          </div>

          {/* Score cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {scores.map((s) => {
              const selfAssess = (testResults[s.testId]?.selfAssessment as {
                focusRating?: number;
                accuracyPrediction?: number;
              } | undefined);

              return (
                <div
                  key={s.testId}
                  className={[
                    'rounded-2xl border p-5 flex flex-col gap-3',
                    s.score === null
                      ? 'border-gray-800/50 bg-gray-900/30 opacity-60'
                      : s.score < 40
                      ? 'border-amber-800/40 bg-amber-950/20'
                      : 'border-gray-800 bg-gray-900/50',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{DOMAIN_ICONS[s.testId] ?? '●'}</span>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-white">{s.domainName}</p>
                      {s.score === null ? (
                        <p className="text-xs text-gray-500">Not assessed</p>
                      ) : (
                        <p className={`text-xs font-bold ${s.score >= 70 ? 'text-emerald-400' : s.score >= 40 ? 'text-blue-400' : 'text-amber-400'}`}>
                          {s.score < 40 ? 'Room to grow' : s.score >= 70 ? 'Strong' : 'Good'} · {s.score} / 100
                        </p>
                      )}
                    </div>
                  </div>

                  <ScoreBar score={s.score} disabled={s.score === null} />

                  <p className="text-xs text-gray-400 leading-snug">{s.observation}</p>

                  {/* Self-assessment comparison */}
                  {selfAssess?.accuracyPrediction != null && s.score !== null && (
                    <p className="text-xs text-gray-600 border-t border-gray-800 pt-2">
                      You predicted <span className="text-gray-400">{selfAssess.accuracyPrediction}/5</span> · Actual score: <span className="text-gray-400">{s.score}</span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ——————————————————————————————————————————————
            Section D — Self-Assessment Reflection
        —————————————————————————————————————————————— */}
        {selfAssessEnabled && selfAssessInsight && (
          <section>
            <SectionHeader
              title="Self-Assessment Reflection"
              subtitle="How your predictions compared to your actual results."
            />
            <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-800">
                      <th className="pb-3 font-medium">Test</th>
                      <th className="pb-3 font-medium">Your focus</th>
                      <th className="pb-3 font-medium">Your prediction</th>
                      <th className="pb-3 font-medium text-right">Actual score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {scores
                      .filter((s) => {
                        const sa = testResults[s.testId]?.selfAssessment as { focusRating?: number } | undefined;
                        return sa?.focusRating != null && s.score !== null;
                      })
                      .map((s) => {
                        const sa = testResults[s.testId]?.selfAssessment as {
                          focusRating?: number;
                          accuracyPrediction?: number;
                        };
                        return (
                          <tr key={s.testId} className="text-gray-300">
                            <td className="py-3 font-medium text-white">{DOMAIN_NAMES[s.testId] ?? s.testId}</td>
                            <td className="py-3">
                              {'★'.repeat(sa.focusRating ?? 0)}{'☆'.repeat(5 - (sa.focusRating ?? 0))}
                            </td>
                            <td className="py-3">
                              {sa.accuracyPrediction != null
                                ? `${'★'.repeat(sa.accuracyPrediction)}${'☆'.repeat(5 - sa.accuracyPrediction)}`
                                : '—'}
                            </td>
                            <td className="py-3 text-right font-semibold">{s.score} / 100</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              <div className={`mt-5 p-4 rounded-xl border text-sm ${
                selfAssessInsight.insight === 'well-calibrated' ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300'
                : selfAssessInsight.insight === 'under-confident' ? 'bg-blue-950/30 border-blue-800/40 text-blue-300'
                : 'bg-amber-950/30 border-amber-800/40 text-amber-300'
              }`}>
                {selfAssessInsight.text}
              </div>
            </div>
          </section>
        )}

        {/* ——————————————————————————————————————————————
            Section E — Symptom Change
        —————————————————————————————————————————————— */}
        {hasSymptoms && (
          <section>
            <SectionHeader
              title="Symptom Change"
              subtitle="Your reported symptoms before and after completing the assessment."
            />
            <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6">
              <p className="text-sm text-gray-300 mb-5">
                Your overall symptom score changed from{' '}
                <span className="font-bold text-white">{preTotal}</span>
                {' → '}
                <span className={`font-bold ${postTotal < preTotal ? 'text-emerald-400' : postTotal > preTotal ? 'text-red-400' : 'text-white'}`}>
                  {postTotal}
                </span>
                {' '}after completing the assessment.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Object.entries(SYMPTOM_LABELS).map(([key, label]) => {
                  const pre = preSymptomScores?.[key] ?? 0;
                  const post = postSymptomScores?.[key] ?? 0;
                  const delta = post - pre;
                  return (
                    <div key={key} className="flex items-center gap-3 text-xs rounded-lg px-3 py-2 bg-gray-900/60">
                      <span className="text-gray-500 w-5 shrink-0">{delta > 0 ? '↑' : delta < 0 ? '↓' : '='}</span>
                      <span className="flex-1 text-gray-300">{label}</span>
                      <span className="text-gray-500">{pre}</span>
                      <span className="text-gray-600">→</span>
                      <span className={delta > 0 ? 'text-red-400' : delta < 0 ? 'text-emerald-400' : 'text-gray-400'}>
                        {post}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-gray-600 mt-4 leading-relaxed">
                Symptom scores help us understand how you felt during the assessment. They do not constitute a medical assessment.
              </p>
            </div>
          </section>
        )}

        {/* ——————————————————————————————————————————————
            Section F — Download
        —————————————————————————————————————————————— */}
        <section>
          <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 text-center">
            <p className="text-gray-400 text-sm mb-4">Save a copy of your results for your personal records.</p>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white font-semibold text-sm transition shadow-[0_8px_24px_rgba(0,140,255,0.22)]"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 12v3a1 1 0 001 1h10a1 1 0 001-1v-3M10 3v9m0 0l-3-3m3 3l3-3" />
              </svg>
              Download My Results (PDF)
            </button>
            <p className="text-xs text-gray-600 mt-3">
              This report is for personal reference only and does not constitute a medical diagnosis.
              <br />Session: <span className="font-mono text-gray-700">{runData.id}</span>
            </p>
          </div>
        </section>

      </div>
    </div>
  );
}
