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
import TestModeCharts, { TestTrajectorySegment } from '@/components/neurological/TestModeCharts';
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
    testTrajectories?: unknown[] | null;
  };
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6 print:break-after-avoid">
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
    <>
      <style>{`
        @media print {
          @page { margin: 0; }
          body {
            background-color: #030712 !important; /* bg-gray-950 */
          }
          /* Force exact identical rendering */
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
        }
      `}</style>
      <div 
        className="h-screen overflow-y-auto print:h-auto print:overflow-visible bg-gray-950 text-white scrollbar-thin"
      >
        {/* Nav bar */}
        <div className="sticky top-0 z-40 border-b border-gray-800/60 bg-gray-950/90 backdrop-blur-sm print:hidden">
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

      <div className="mx-auto max-w-4xl px-4 py-10 print:py-16 print:px-8 space-y-12">

        {/* ——————————————————————————————————————————————
            Section A — Header
        —————————————————————————————————————————————— */}
        <section>
          <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 sm:p-8 print:break-inside-avoid">
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
            subtitle="How accurately the eye tracker followed your gaze."
          />
          <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 flex flex-col items-center gap-4 mb-6 print:break-inside-avoid">
            <h3 className="text-sm font-semibold text-gray-300 self-start">Gaze Accuracy</h3>
            {etScore != null ? (
              <AccuracyDial score={etScore} />
            ) : (
              <p className="text-gray-600 text-sm">Calibration data unavailable.</p>
            )}
          </div>
          
          <TestModeCharts testTrajectories={session.testTrajectories as TestTrajectorySegment[] | null} />
        </section>

        {/* ——————————————————————————————————————————————
            Section C — Assessment Scores
        —————————————————————————————————————————————— */}
        <section>
          <SectionHeader
            title="Assessment Scores"
            subtitle="Your performance across all neurological assessment domains."
          />

          {/* Score cards */}
          <div className="flex flex-col gap-5">
            {scores.map((s) => {
              const selfAssess = (testResults[s.testId]?.selfAssessment as {
                focusRating?: number;
                accuracyPrediction?: number;
              } | undefined);

              return (
                <div
                  key={s.testId}
                  className={[
                    'rounded-2xl border p-6 flex flex-col gap-4 print:break-inside-avoid',
                    s.score === null
                      ? 'border-gray-800/50 bg-gray-900/30 opacity-60'
                      : s.score < 40
                      ? 'border-amber-800/40 bg-amber-950/20'
                      : 'border-gray-800 bg-gray-900/50',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gray-800/50 flex items-center justify-center text-2xl border border-gray-700/50">
                      {DOMAIN_ICONS[s.testId] ?? '●'}
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-base font-bold text-white">{s.domainName}</p>
                          {s.score !== null && (
                            <p className={`text-xs font-semibold mt-0.5 ${s.score >= 70 ? 'text-emerald-400' : s.score >= 40 ? 'text-blue-400' : 'text-amber-400'}`}>
                              {s.score < 40 ? 'Moderate performance - Room to grow' : s.score >= 70 ? 'Optimal processing' : 'Good performance'}
                            </p>
                          )}
                        </div>
                        {s.score !== null && (
                          <div className="text-right">
                            <span className={`text-2xl font-black ${s.score >= 70 ? 'text-emerald-400' : s.score >= 40 ? 'text-blue-400' : 'text-amber-400'}`}>
                              {s.score}
                            </span>
                            <span className="text-xs text-gray-500 font-bold ml-1">/ 100</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="px-1">
                    <ScoreBar score={s.score} disabled={s.score === null} />
                  </div>

                  <p className="text-sm text-gray-400 leading-relaxed px-1">
                    {s.observation}
                  </p>

                  {/* Self-assessment comparison */}
                  {selfAssess?.accuracyPrediction != null && s.score !== null && (
                    <div className="flex items-center gap-2 text-xs text-gray-500 border-t border-gray-800/50 pt-3 px-1">
                      <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>
                        Self-assessment check: You predicted <span className="text-gray-300 font-medium">{selfAssess.accuracyPrediction}/5</span>
                      </span>
                    </div>
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
            <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 print:break-inside-avoid">
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
            <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 print:break-inside-avoid">
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
        <section className="print:hidden">
          <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 text-center">
            <p className="text-gray-400 text-sm mb-4">Save a copy of your results for your personal records.</p>
            <a
              href={`/api/results/${runData.id}/pdf`}
              download
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white font-semibold text-sm transition shadow-[0_8px_24px_rgba(0,140,255,0.22)]"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 12v3a1 1 0 001 1h10a1 1 0 001-1v-3M10 3v9m0 0l-3-3m3 3l3-3" />
              </svg>
              Download My Results (PDF)
            </a>
            <p className="text-xs text-gray-600 mt-3">
              This report is for personal reference only and does not constitute a medical diagnosis.
              <br />Session: <span className="font-mono text-gray-700">{runData.id}</span>
            </p>
          </div>
        </section>

      </div>
    </div>
    </>
  );
}
