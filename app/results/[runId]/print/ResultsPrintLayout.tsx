'use client';

import React, { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine,
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar
} from 'recharts';
import {
  computeAllScores,
  eyeTrackingAccuracyScore,
  angularErrorDeg,
  DOMAIN_NAMES,
} from '@/lib/resultScoring';

import { 
  smoothSegment, 
  type ChartSmoothingConfig 
} from '@/lib/smoothing';

interface PrintData {
  id: string;
  status: string;
  createdAt: string;
  testOrderSnapshot: string[];
  configSnapshot: Record<string, any>;
  testResults: Record<string, any>;
  trajectories: any[] | null;
  chartSmoothing?: ChartSmoothingConfig | null;
  session: {
    id: string;
    meanErrorPx: number | null;
    demographics: Record<string, any> | null;
    createdAt: string | null;
  };
}

function ScoreBar({ score }: { score: number | null }) {
  const pct = score ?? 0;
  const color = pct >= 70 ? '#16a34a' : pct >= 40 ? '#d97706' : '#dc2626';
  return (
    <div className="w-full bg-gray-200 rounded-full h-2">
      <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

function ScoreLabel({ score }: { score: number | null }) {
  if (score === null) return <span className="text-gray-400 font-bold">N/A</span>;
  const color = score >= 70 ? 'text-green-600' : score >= 40 ? 'text-amber-600' : 'text-red-500';
  return <span className={`font-black text-lg ${color}`}>{score}</span>;
}

export default function ResultsPrintLayout({ data }: { data: PrintData }) {
  const { session, testOrderSnapshot, testResults, configSnapshot, trajectories, chartSmoothing } = data;

  const configSnap = configSnapshot as {
    testParameters?: Record<string, Record<string, unknown>>;
    testEnabled?: Record<string, boolean>;
  };
  const scoringConfig = (configSnap?.testParameters?.['_scoring'] as Record<string, Record<string, number>> | undefined) ?? undefined;
  const enabledTests: Record<string, boolean> = configSnap?.testEnabled ?? {};

  const scores = useMemo(
    () => computeAllScores(testResults, testOrderSnapshot, enabledTests, scoringConfig),
    [testResults, testOrderSnapshot, enabledTests, scoringConfig]
  );

  const etScore = session.meanErrorPx != null ? eyeTrackingAccuracyScore(session.meanErrorPx) : null;

  const radarData = scores.map((s) => ({
    domain: s.domainName,
    score: s.score ?? 0,
  }));

  const assessmentDate = data.createdAt
    ? new Date(data.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  const demographics = session.demographics;
  const firstName = demographics
    ? (demographics.firstName as string | undefined) ?? (demographics.name as string | undefined) ?? 'Participant'
    : 'Participant';
  const lastName = demographics ? (demographics.lastName as string | undefined) : undefined;
  const fullName = [firstName, lastName].filter(Boolean).join(' ');


  const trajectoryList = useMemo(() => {
    const raw = Array.isArray(trajectories) ? trajectories as Array<{
      patternName: string;
      points: Array<{ t: number; targetX: number; targetY: number; gazeX: number; gazeY: number }>;
    }> : [];
    if (!chartSmoothing) return raw;
    return raw.map(seg => smoothSegment(seg, chartSmoothing));
  }, [trajectories, chartSmoothing]);

  return (
    <div className="bg-white text-black font-sans" style={{ maxWidth: 900, margin: '0 auto', padding: '40px 48px' }}>

      {/* ═══════════════════════════════════════════════════
          PAGE 1: Header + Overview + Radar
      ═══════════════════════════════════════════════════ */}
      
      {/* Header */}
      <div style={{ borderBottom: '3px solid #1e3a8a', paddingBottom: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: '#1e3a8a', margin: 0, letterSpacing: '-0.5px' }}>
              Precision Eye Tracker
            </h1>
            <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0', fontWeight: 500 }}>
              Assessment Report
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>{fullName}</p>
            <p style={{ fontSize: 12, color: '#64748b', margin: '3px 0 0' }}>Assessment Date: {assessmentDate}</p>
            <p style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', margin: '3px 0 0' }}>
              Report ID: {data.id.slice(-12).toUpperCase()}
            </p>
          </div>
        </div>
      </div>

      {/* Overview strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 12, padding: '16px 20px' }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#0369a1', textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>Eye Tracking Accuracy</p>
          <p style={{ fontSize: 40, fontWeight: 900, color: '#0c4a6e', margin: '6px 0 0', lineHeight: 1 }}>
            {etScore !== null ? etScore : '—'}
          </p>
          <p style={{ fontSize: 10, color: '#64748b', margin: '4px 0 0' }}>out of 100</p>
        </div>
        <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 12, padding: '16px 20px' }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>Mean Pixel Error</p>
          <p style={{ fontSize: 40, fontWeight: 900, color: '#4c1d95', margin: '6px 0 0', lineHeight: 1 }}>
            {session.meanErrorPx != null ? Math.round(session.meanErrorPx) : '—'}
          </p>
          <p style={{ fontSize: 10, color: '#64748b', margin: '4px 0 0' }}>pixels deviation</p>
        </div>
        <div style={{ background: '#fff7ed', border: '1px solid #ffedd5', borderRadius: 12, padding: '16px 20px' }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#9a3412', textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>Visual Angular</p>
          <p style={{ fontSize: 40, fontWeight: 900, color: '#7c2d12', margin: '6px 0 0', lineHeight: 1 }}>
            {session.meanErrorPx != null 
              ? angularErrorDeg(session.meanErrorPx, (configSnapshot as any)?.faceDistance ?? 60).toFixed(1) 
              : '—'}
            <span style={{ fontSize: 18, fontWeight: 600 }}>°</span>
          </p>
          <p style={{ fontSize: 10, color: '#64748b', margin: '4px 0 0' }}>degrees error</p>
        </div>
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '16px 20px' }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#15803d', textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>Tests Completed</p>
          <p style={{ fontSize: 40, fontWeight: 900, color: '#14532d', margin: '6px 0 0', lineHeight: 1 }}>
            {Object.keys(testResults).length}<span style={{ fontSize: 18 }}>/7</span>
          </p>
          <p style={{ fontSize: 10, color: '#64748b', margin: '4px 0 0' }}>assessment domains</p>
        </div>
      </div>

      {/* Domain Scores Radar Chart */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24, marginBottom: 28 }}>
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 16, padding: '24px' }}>
          <h2 style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #e2e8f0', paddingBottom: 10 }}>
            Neurological Domain Profile
          </h2>
          <div style={{ height: 350, width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
                <PolarGrid stroke="#cbd5e1" />
                <PolarAngleAxis dataKey="domain" tick={{ fill: '#475569', fontSize: 10, fontWeight: 600 }} />
                <Radar
                  name="Score"
                  dataKey="score"
                  stroke="#2563eb"
                  fill="#3b82f6"
                  fillOpacity={0.6}
                  isAnimationActive={false}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <p style={{ fontSize: 10, color: '#64748b', textAlign: 'center', marginTop: 12 }}>
            Scores are normalized to a 0–100 scale, where 100 represents peak performance.
          </p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════
          PAGE 2: Detailed Domain Scores
      ═══════════════════════════════════════════════════ */}
      <div style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1e293b', margin: '0 0 4px', borderBottom: '2px solid #e2e8f0', paddingBottom: 10 }}>
          Detailed Domain Scores
        </h2>
        <p style={{ fontSize: 12, color: '#64748b', margin: '8px 0 24px' }}>
          Performance metrics across individual assessment domains. Each score is out of 100.
        </p>

        {(() => {
          const selfAssessRows = scores.filter((s) => {
            const sa = testResults[s.testId]?.selfAssessment as { focusRating?: number } | undefined;
            return sa?.focusRating != null && s.score !== null;
          });
          if (selfAssessRows.length === 0) return null;
          return (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#475569', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Test</th>
                  <th style={{ textAlign: 'center', padding: '8px 12px', color: '#475569', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Focus Rating</th>
                  <th style={{ textAlign: 'center', padding: '8px 12px', color: '#475569', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Accuracy Prediction</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: '#475569', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Actual Score</th>
                </tr>
              </thead>
              <tbody>
                {selfAssessRows.map((s, idx) => {
                  const sa = testResults[s.testId]?.selfAssessment as { focusRating?: number; accuracyPrediction?: number } | undefined;
                  const isEven = idx % 2 === 0;
                  return (
                    <tr key={s.testId} style={{ background: isEven ? '#f8fafc' : 'white', borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: '#0f172a' }}>{s.domainName}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{ color: '#eab308' }}>{'★'.repeat(sa?.focusRating ?? 0)}</span><span style={{ color: '#d1d5db' }}>{'☆'.repeat(5 - (sa?.focusRating ?? 0))}</span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {sa?.accuracyPrediction != null ? (
                          <><span style={{ color: '#eab308' }}>{'★'.repeat(sa.accuracyPrediction)}</span><span style={{ color: '#d1d5db' }}>{'☆'.repeat(5 - sa.accuracyPrediction)}</span></>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <span style={{ fontWeight: 800, color: (s.score ?? 0) >= 70 ? '#15803d' : (s.score ?? 0) >= 40 ? '#d97706' : '#dc2626' }}>{s.score}</span>
                        <span style={{ color: '#94a3b8', fontSize: 11, marginLeft: 4 }}>/ 100</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        })()}


      </div>

      {/* ═══════════════════════════════════════════════════
          PAGE 3+: Eye Gaze Trajectories (Chunked into 3 per page)
      ═══════════════════════════════════════════════════ */}
      {(() => {
        const chunks: any[][] = [];
        for (let i = 0; i < trajectoryList.length; i += 3) {
          chunks.push(trajectoryList.slice(i, i + 3));
        }

        return chunks.map((chunk, groupIdx) => (
          <div key={groupIdx} style={{ 
            pageBreakBefore: 'always', 
            breakBefore: 'page', 
            paddingTop: 40 
          }}>
            {groupIdx === 0 && (
              <>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1e293b', margin: '0 0 4px', borderBottom: '2px solid #e2e8f0', paddingBottom: 10 }}>
                  Eye Gaze Trajectories
                </h2>
                <p style={{ fontSize: 12, color: '#64748b', margin: '8px 0 24px' }}>
                  Target path (green) vs. recorded eye gaze (purple) for each exercise pattern.
                </p>
              </>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {chunk.map((seg, i) => (
                <div key={i} style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  overflow: 'hidden',
                  pageBreakInside: 'avoid',
                  breakInside: 'avoid',
                }}>
                  {/* Segment header */}
                  <div style={{ background: '#f1f5f9', padding: '10px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: 0 }}>{seg.patternName}</h3>
                    <span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>
                      {seg.points.length.toLocaleString()} points
                    </span>
                  </div>

                  {/* Charts */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '16px 16px 16px 4px', background: 'white' }}>
                    {/* X axis */}
                    <div>
                      <p style={{ fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 8px' }}>
                        Horizontal (X-axis)
                      </p>
                      <div style={{ height: 140 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={seg.points} margin={{ top: 10, right: 15, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" vertical={false} />
                            <XAxis 
                              dataKey="t" 
                              tick={{ fill: '#94a3b8', fontSize: 7 }} 
                              tickLine={false} 
                              interval="preserveStartEnd" 
                              minTickGap={25}
                              tickFormatter={(val) => Number(val).toFixed(1)}
                            />
                            <YAxis 
                              width={30}
                              tick={{ fill: '#94a3b8', fontSize: 7 }} 
                              tickLine={false} 
                              axisLine={false}
                              tickFormatter={(val) => Math.round(Number(val)).toLocaleString()}
                            />
                            <ReferenceLine y={50} stroke="#f1f5f9" strokeDasharray="4 4" />
                            <Line type="monotone" dataKey="targetX" stroke="#10b981" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="gazeX" stroke="#8b5cf6" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Y axis */}
                    <div>
                      <p style={{ fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 8px' }}>
                        Vertical (Y-axis)
                      </p>
                      <div style={{ height: 140 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={seg.points} margin={{ top: 10, right: 15, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" vertical={false} />
                            <XAxis 
                              dataKey="t" 
                              tick={{ fill: '#94a3b8', fontSize: 7 }} 
                              tickLine={false} 
                              interval="preserveStartEnd" 
                              minTickGap={25}
                              tickFormatter={(val) => Number(val).toFixed(1)}
                            />
                            <YAxis 
                              width={30}
                              tick={{ fill: '#94a3b8', fontSize: 7 }} 
                              tickLine={false} 
                              axisLine={false}
                              tickFormatter={(val) => Math.round(Number(val)).toLocaleString()}
                            />
                            <ReferenceLine y={50} stroke="#f1f5f9" strokeDasharray="4 4" />
                            <Line type="monotone" dataKey="targetY" stroke="#10b981" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="gazeY" stroke="#8b5cf6" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  {/* Legend */}
                  <div style={{ background: '#f8fafc', padding: '6px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ display: 'inline-block', width: 16, height: 2, background: '#10b981', borderRadius: 1 }} />
                      <span style={{ fontSize: 9, color: '#475569', fontWeight: 500 }}>Target</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ display: 'inline-block', width: 16, height: 2, background: '#8b5cf6', borderRadius: 1 }} />
                      <span style={{ fontSize: 9, color: '#475569', fontWeight: 500 }}>Gaze</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ));
      })()}

      {/* Footer */}
      <div style={{ marginTop: 40, paddingTop: 16, borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: 10, color: '#94a3b8', margin: 0 }}>
          This report is for personal reference only and does not constitute a medical diagnosis.
        </p>
        <p style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', margin: 0 }}>
          {data.id}
        </p>
      </div>
    </div>
  );
}
