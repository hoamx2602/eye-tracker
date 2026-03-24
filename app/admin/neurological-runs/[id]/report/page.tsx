'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';

// ── Types (mirrors admin detail page) ──────────────────────────────────────────

type Demographics = {
  age?: number;
  gender?: string;
  country?: string;
  eyeConditions?: string[];
};

type SessionContext = {
  id: string;
  meanErrorPx: number | null;
  demographics: Demographics | null;
};

type SymptomPayload = {
  scores?: Record<string, number>;
  submittedAt?: string;
};

type NeuroRunDetail = {
  id: string;
  sessionId: string;
  status: string | null;
  createdAt: string;
  updatedAt: string;
  testOrderSnapshot: string[] | null;
  preSymptomScores: SymptomPayload | null;
  postSymptomScores: SymptomPayload | null;
  testResults: Record<string, unknown> | null;
  session: SessionContext | null;
};

// ── Constants ──────────────────────────────────────────────────────────────────

const SYMPTOM_QUESTIONS = [
  { id: 'Q1',  category: 'Headache',          question: 'Headache or head pressure' },
  { id: 'Q2',  category: 'Dizziness',         question: 'Dizziness or lightheadedness' },
  { id: 'Q3',  category: 'Nausea',            question: 'Nausea' },
  { id: 'Q4',  category: 'Vision Clarity',    question: 'Blurry or less clear vision' },
  { id: 'Q5',  category: 'Eye Strain',        question: 'Tired or strained eyes' },
  { id: 'Q6',  category: 'Visual Focus',      question: 'Difficulty focusing eyes' },
  { id: 'Q7',  category: 'Light Sensitivity', question: 'Light sensitivity' },
  { id: 'Q8',  category: 'Concentration',     question: 'Difficulty concentrating' },
  { id: 'Q9',  category: 'Mental Fatigue',    question: 'Mental fatigue' },
  { id: 'Q10', category: 'Neck',              question: 'Neck pain or stiffness' },
  { id: 'Q11', category: 'Double Vision',     question: 'Double vision' },
  { id: 'Q12', category: 'Balance',           question: 'Unsteady or balance difficulty' },
];

const SYMPTOM_LABELS = ['None', 'Mild', 'Moderate', 'Strong', 'Severe'];

const TEST_LABELS: Record<string, string> = {
  head_orientation:   'Head Orientation',
  visual_search:      'Visual Search',
  memory_cards:       'Memory Cards',
  anti_saccade:       'Anti-Saccade',
  saccadic:           'Saccadic Eye Movement',
  fixation_stability: 'Fixation Stability',
  peripheral_vision:  'Peripheral Vision',
};

// ── Metric extraction helpers ──────────────────────────────────────────────────

type MetricRow = { label: string; value: string; note?: string; flag?: 'good' | 'warn' | 'bad' | 'neutral' };

function extractMetrics(testId: string, raw: Record<string, unknown>): MetricRow[] {
  const rows: MetricRow[] = [];

  const n = (v: unknown, decimals = 1) =>
    typeof v === 'number' && isFinite(v) ? v.toFixed(decimals) : '—';

  if (testId === 'saccadic') {
    const metrics = raw.metrics as { avgLatency?: number; fixationAccuracy?: number; correctiveSaccadeCount?: number } | undefined;
    const avgLat = metrics?.avgLatency ?? null;
    const acc    = (metrics?.fixationAccuracy ?? raw.fixationAccuracy) as number | undefined;
    const corr   = (metrics?.correctiveSaccadeCount ?? raw.correctiveSaccades) as number | undefined;
    rows.push({ label: 'Avg saccadic latency', value: avgLat != null ? `${avgLat.toFixed(0)} ms` : '—',
      note: 'Typical: 150–350 ms',
      flag: avgLat == null ? 'neutral' : avgLat < 100 ? 'warn' : avgLat <= 350 ? 'good' : 'warn' });
    rows.push({ label: 'Fixation hit rate', value: acc != null ? `${acc.toFixed(1)}%` : '—',
      note: 'Higher = better',
      flag: acc == null ? 'neutral' : acc >= 70 ? 'good' : acc >= 40 ? 'warn' : 'bad' });
    if (corr != null)
      rows.push({ label: 'Corrective saccades (heuristic)', value: String(corr),
        note: 'Lower = more accurate first saccade',
        flag: corr === 0 ? 'good' : corr <= 3 ? 'warn' : 'bad' });
    const cycles = (raw.cycles as Array<{ latencyMs?: number; targetSide?: string }>) ?? [];
    if (cycles.length > 0)
      rows.push({ label: 'Total cycles', value: String(cycles.length), flag: 'neutral' });
  }

  else if (testId === 'fixation_stability') {
    const area68 = (raw.bcea68Px2 ?? null) as number | null;
    const area95 = (raw.bcea95Px2 ?? null) as number | null;
    const samples = (raw.gazeSamples as unknown[])?.length ?? 0;
    rows.push({ label: 'BCEA 68%', value: area68 != null ? `${area68.toFixed(0)} px²` : '—',
      note: 'Lower = more stable fixation',
      flag: area68 == null ? 'neutral' : area68 < 3000 ? 'good' : area68 < 10000 ? 'warn' : 'bad' });
    rows.push({ label: 'BCEA 95%', value: area95 != null ? `${area95.toFixed(0)} px²` : '—',
      note: 'Lower = more stable fixation',
      flag: area95 == null ? 'neutral' : area95 < 10000 ? 'good' : area95 < 30000 ? 'warn' : 'bad' });
    rows.push({ label: 'Gaze samples', value: String(samples), flag: 'neutral' });
  }

  else if (testId === 'peripheral_vision') {
    const metrics = raw.metrics as { avgRT?: number; accuracy?: number; centerStability?: number } | undefined;
    rows.push({ label: 'Detection accuracy', value: metrics?.accuracy != null ? `${metrics.accuracy.toFixed(1)}%` : '—',
      note: 'Higher = better',
      flag: metrics?.accuracy == null ? 'neutral' : metrics.accuracy >= 80 ? 'good' : metrics.accuracy >= 50 ? 'warn' : 'bad' });
    rows.push({ label: 'Avg reaction time', value: metrics?.avgRT != null ? `${metrics.avgRT.toFixed(0)} ms` : '—',
      note: 'Typical: 200–400 ms',
      flag: metrics?.avgRT == null ? 'neutral' : metrics.avgRT <= 400 ? 'good' : metrics.avgRT <= 600 ? 'warn' : 'bad' });
    if (metrics?.centerStability != null)
      rows.push({ label: 'Center gaze stability', value: `${metrics.centerStability.toFixed(1)}%`,
        note: 'Higher = better', flag: metrics.centerStability >= 70 ? 'good' : 'warn' });
    const trials = (raw.trials as unknown[]) ?? [];
    rows.push({ label: 'Trials completed', value: String(trials.length), flag: 'neutral' });
  }

  else if (testId === 'visual_search') {
    const completionTimeMs = typeof raw.completionTimeMs === 'number' ? raw.completionTimeMs : null;
    const sequence = (raw.sequence as number[] ?? raw.gazeSequence as number[] ?? []);
    const fixations = (raw.fixations as unknown[]) ?? [];
    rows.push({ label: 'Completion time', value: completionTimeMs != null ? `${(completionTimeMs / 1000).toFixed(1)} s` : '—', flag: 'neutral' });
    rows.push({ label: 'Targets found', value: String(sequence.length), flag: 'neutral' });
    rows.push({ label: 'Fixation events', value: String(fixations.length), flag: 'neutral' });
  }

  else if (testId === 'memory_cards') {
    const moves = (raw.moves as Array<{ match: boolean }>) ?? [];
    const matched = moves.filter((m) => m.match).length;
    const wrong   = moves.length - matched;
    const compMs  = typeof raw.completionTimeMs === 'number' ? raw.completionTimeMs : null;
    rows.push({ label: 'Total moves', value: String(moves.length), flag: 'neutral' });
    rows.push({ label: 'Correct pairs', value: String(matched),
      flag: matched > 0 ? 'good' : 'neutral' });
    rows.push({ label: 'Wrong pairs', value: String(wrong),
      flag: wrong === 0 ? 'good' : wrong <= 3 ? 'warn' : 'bad' });
    if (compMs != null)
      rows.push({ label: 'Completion time', value: `${(compMs / 1000).toFixed(1)} s`, flag: 'neutral' });
  }

  else if (testId === 'anti_saccade') {
    const trials = (raw.trials as Array<{ correct?: boolean; latencyMs?: number }>) ?? [];
    const correct = trials.filter((t) => t.correct).length;
    const errorRate = trials.length > 0 ? ((trials.length - correct) / trials.length * 100) : null;
    const withLat   = trials.filter((t) => typeof t.latencyMs === 'number');
    const avgLat    = withLat.length > 0
      ? withLat.reduce((s, t) => s + (t.latencyMs ?? 0), 0) / withLat.length
      : null;
    rows.push({ label: 'Correct responses', value: `${correct} / ${trials.length}`,
      flag: trials.length > 0 ? (correct / trials.length >= 0.8 ? 'good' : correct / trials.length >= 0.5 ? 'warn' : 'bad') : 'neutral' });
    rows.push({ label: 'Error rate', value: errorRate != null ? `${errorRate.toFixed(1)}%` : '—',
      note: 'Lower = better',
      flag: errorRate == null ? 'neutral' : errorRate < 20 ? 'good' : errorRate < 40 ? 'warn' : 'bad' });
    if (avgLat != null)
      rows.push({ label: 'Avg latency', value: `${avgLat.toFixed(0)} ms`, flag: 'neutral' });
    rows.push({ label: 'Trials', value: String(trials.length), flag: 'neutral' });
  }

  else if (testId === 'head_orientation') {
    const phases = (raw.phases as unknown[]) ?? [];
    rows.push({ label: 'Phases recorded', value: String(phases.length), flag: 'neutral' });
    const samples = (raw.gazeSamples as unknown[])?.length ?? (raw.headSamples as unknown[])?.length ?? 0;
    if (samples > 0) rows.push({ label: 'Samples', value: String(samples), flag: 'neutral' });
  }

  if (rows.length === 0) {
    rows.push({ label: 'Status', value: 'Data recorded', flag: 'neutral' });
  }

  return rows;
}

// ── UI Components ──────────────────────────────────────────────────────────────

function FlagBadge({ flag }: { flag?: MetricRow['flag'] }) {
  if (!flag || flag === 'neutral') return null;
  const map = {
    good:    { bg: '#d1fae5', color: '#065f46', text: 'Normal' },
    warn:    { bg: '#fef3c7', color: '#92400e', text: 'Borderline' },
    bad:     { bg: '#fee2e2', color: '#991b1b', text: 'Concern' },
  } as const;
  const s = map[flag];
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 4, fontSize: 10,
      fontWeight: 600, background: s.bg, color: s.color, marginLeft: 6, whiteSpace: 'nowrap',
    }}>
      {s.text}
    </span>
  );
}

// ── Main Report Component ──────────────────────────────────────────────────────

function NeurologicalRunReportInner() {
  const params       = useParams();
  const searchParams = useSearchParams();
  const id           = params?.id as string;
  const autoPrint    = searchParams?.get('print') === '1';

  const [run, setRun]         = useState<NeuroRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const didPrintRef = useRef(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/admin/neurological-runs/${id}`, { credentials: 'include' });
        if (res.status === 404) { if (!cancelled) setNotFound(true); return; }
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setRun(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  // Auto-trigger print dialog once data is loaded
  useEffect(() => {
    if (autoPrint && run && !didPrintRef.current) {
      didPrintRef.current = true;
      setTimeout(() => window.print(), 800);
    }
  }, [autoPrint, run]);

  const now    = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const runDate = run ? new Date(run.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  const demo        = run?.session?.demographics;
  const testOrder   = run
    ? (Array.isArray(run.testOrderSnapshot) ? run.testOrderSnapshot : run.testResults ? Object.keys(run.testResults) : [])
    : [];

  const preScores  = run?.preSymptomScores?.scores  ?? {};
  const postScores = run?.postSymptomScores?.scores ?? {};
  const hasPre  = Object.keys(preScores).length  > 0;
  const hasPost = Object.keys(postScores).length > 0;
  const totalPre  = SYMPTOM_QUESTIONS.reduce((s, q) => s + (preScores[q.id]  ?? 0), 0);
  const totalPost = SYMPTOM_QUESTIONS.reduce((s, q) => s + (postScores[q.id] ?? 0), 0);

  if (loading) {
    return (
      <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif', color: '#475569' }}>
        Loading report…
      </div>
    );
  }

  if (notFound || !run) {
    return (
      <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>
        <p style={{ color: '#dc2626' }}>Run not found.</p>
        <Link href="/admin/neurological-runs" style={{ color: '#2563eb' }}>← Back to runs</Link>
      </div>
    );
  }

  return (
    <>
      {/* Print stylesheet injected inline */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

        * { box-sizing: border-box; }

        body {
          margin: 0;
          background: #f8fafc;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          color: #1e293b;
          font-size: 14px;
          line-height: 1.5;
        }

        .report-toolbar {
          position: fixed;
          top: 0; left: 0; right: 0;
          z-index: 100;
          background: #1e293b;
          padding: 10px 20px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        }

        .report-page {
          max-width: 860px;
          margin: 72px auto 60px;
          background: #fff;
          border-radius: 8px;
          box-shadow: 0 1px 6px rgba(0,0,0,0.08);
          overflow: hidden;
        }

        .report-header {
          background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%);
          padding: 40px 48px 36px;
          color: #fff;
          position: relative;
        }
        .report-header::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 4px;
          background: linear-gradient(90deg, #3b82f6, #06b6d4, #8b5cf6);
        }

        .report-header-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 20px;
        }
        .report-header-logo svg {
          width: 32px; height: 32px;
          flex-shrink: 0;
        }
        .report-header-logo span {
          font-size: 18px;
          font-weight: 700;
          letter-spacing: -0.3px;
          color: #e2e8f0;
        }

        .report-title {
          font-size: 28px;
          font-weight: 700;
          color: #fff;
          margin: 0 0 6px;
          letter-spacing: -0.5px;
        }
        .report-subtitle {
          color: #94a3b8;
          font-size: 13px;
          margin: 0;
        }

        .report-body {
          padding: 0 48px 48px;
        }

        .section {
          margin-top: 36px;
        }
        .section-title {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          color: #64748b;
          margin: 0 0 14px;
          padding-bottom: 8px;
          border-bottom: 2px solid #e2e8f0;
        }

        .meta-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }
        .meta-item dt {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #94a3b8;
          margin: 0 0 3px;
        }
        .meta-item dd {
          margin: 0;
          font-size: 14px;
          color: #1e293b;
          font-weight: 500;
        }
        .meta-item dd.mono {
          font-family: 'Courier New', monospace;
          font-size: 12px;
          color: #475569;
        }

        .badge {
          display: inline-block;
          padding: 2px 10px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 600;
        }
        .badge-green  { background: #d1fae5; color: #065f46; }
        .badge-blue   { background: #dbeafe; color: #1e40af; }
        .badge-gray   { background: #f1f5f9; color: #475569; }

        /* Symptom table */
        table.symptom-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        table.symptom-table th {
          text-align: left;
          padding: 7px 10px;
          background: #f8fafc;
          color: #475569;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          border-bottom: 2px solid #e2e8f0;
        }
        table.symptom-table th:not(:first-child) { text-align: center; }
        table.symptom-table td {
          padding: 6px 10px;
          border-bottom: 1px solid #f1f5f9;
          color: #334155;
        }
        table.symptom-table td:not(:first-child) { text-align: center; }
        table.symptom-table tr:hover td { background: #f8fafc; }
        table.symptom-table tfoot td {
          font-weight: 700;
          background: #f8fafc;
          border-top: 2px solid #e2e8f0;
          border-bottom: none;
        }
        .delta-good { color: #059669; font-weight: 700; }
        .delta-bad  { color: #dc2626; font-weight: 700; }
        .delta-zero { color: #94a3b8; }

        .symptom-bar {
          display: inline-block;
          height: 8px;
          border-radius: 4px;
          background: #e2e8f0;
          vertical-align: middle;
          margin-right: 6px;
        }
        .symptom-bar-fill {
          display: block;
          height: 100%;
          border-radius: 4px;
        }

        /* Test result cards */
        .test-card {
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          overflow: hidden;
          margin-bottom: 16px;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .test-card-header {
          padding: 12px 20px;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .test-card-header h3 {
          margin: 0;
          font-size: 15px;
          font-weight: 700;
          color: #1e293b;
        }
        .test-card-body {
          padding: 16px 20px;
        }

        table.metrics-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        table.metrics-table td {
          padding: 6px 10px;
          border-bottom: 1px solid #f1f5f9;
        }
        table.metrics-table td:first-child {
          color: #64748b;
          font-weight: 500;
          width: 55%;
        }
        table.metrics-table td:nth-child(2) {
          font-weight: 700;
          color: #1e293b;
          font-family: 'Courier New', monospace;
        }
        table.metrics-table td:last-child {
          color: #94a3b8;
          font-size: 11px;
          text-align: right;
        }
        table.metrics-table tr:last-child td { border-bottom: none; }

        /* Test order pills */
        .test-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 12px;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          font-size: 12px;
          color: #475569;
          margin: 3px 3px 3px 0;
        }
        .test-pill-num { color: #94a3b8; font-weight: 600; }

        /* Score summary bar */
        .score-summary {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px 20px;
          background: linear-gradient(135deg, #f0f9ff, #f0fdf4);
          border: 1px solid #bae6fd;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        .score-box {
          text-align: center;
          flex: 1;
        }
        .score-box .val {
          font-size: 28px;
          font-weight: 800;
          line-height: 1;
          color: #1e293b;
        }
        .score-box .lbl {
          font-size: 11px;
          color: #64748b;
          margin-top: 4px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .score-divider {
          width: 1px;
          height: 40px;
          background: #bae6fd;
        }

        /* Footer */
        .report-footer {
          padding: 20px 48px;
          background: #f8fafc;
          border-top: 1px solid #e2e8f0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 11px;
          color: #94a3b8;
        }

        /* Print styles */
        @media print {
          body { background: #fff; font-size: 12px; }
          .report-toolbar { display: none !important; }
          .report-page {
            margin: 0;
            border-radius: 0;
            box-shadow: none;
            max-width: 100%;
          }
          .report-header { padding: 24px 36px 22px; }
          .report-body   { padding: 0 36px 36px; }
          .report-footer { padding: 14px 36px; }
          .meta-grid     { grid-template-columns: repeat(3, 1fr); }
          .test-card     { break-inside: avoid; page-break-inside: avoid; }
          .section { break-inside: auto; }
          @page {
            size: A4;
            margin: 12mm 10mm;
          }
        }
      `}</style>

      {/* ── Toolbar (screen only) ── */}
      <div className="report-toolbar">
        <Link
          href={`/admin/neurological-runs/${id}`}
          style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}
        >
          ← Back
        </Link>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => window.print()}
          style={{
            background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6,
            padding: '7px 18px', fontWeight: 600, fontSize: 13, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <PrintIcon />
          Print / Export PDF
        </button>
      </div>

      {/* ── Report page ── */}
      <div className="report-page">

        {/* ── Header ── */}
        <div className="report-header">
          <div className="report-header-logo">
            <EyeIcon />
            <span>Precision Eye Tracker</span>
          </div>
          <h1 className="report-title">Neurological Assessment Report</h1>
          <p className="report-subtitle">
            Generated {now}{autoPrint ? ' · Printed automatically' : ''}
          </p>
        </div>

        {/* ── Body ── */}
        <div className="report-body">

          {/* Symptom score summary bar */}
          {(hasPre || hasPost) && (
            <div className="score-summary" style={{ marginTop: 28 }}>
              {hasPre && (
                <>
                  <div className="score-box">
                    <div className="val" style={{ color: totalPre > 24 ? '#dc2626' : totalPre > 12 ? '#d97706' : '#059669' }}>
                      {totalPre}
                    </div>
                    <div className="lbl">Pre-test symptom total</div>
                  </div>
                  {hasPost && <div className="score-divider" />}
                </>
              )}
              {hasPost && (
                <>
                  <div className="score-box">
                    <div className="val" style={{ color: totalPost > 24 ? '#dc2626' : totalPost > 12 ? '#d97706' : '#059669' }}>
                      {totalPost}
                    </div>
                    <div className="lbl">Post-test symptom total</div>
                  </div>
                  {hasPre && (
                    <>
                      <div className="score-divider" />
                      <div className="score-box">
                        <div className="val" style={{ color: totalPost - totalPre > 0 ? '#dc2626' : totalPost - totalPre < 0 ? '#059669' : '#94a3b8' }}>
                          {totalPost - totalPre > 0 ? '+' : ''}{totalPost - totalPre}
                        </div>
                        <div className="lbl">Change (Δ Post − Pre)</div>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Section 1: Assessment Info */}
          <div className="section">
            <p className="section-title">Assessment Information</p>
            <dl className="meta-grid">
              <div className="meta-item">
                <dt>Run ID</dt>
                <dd className="mono">{run.id.slice(0, 20)}…</dd>
              </div>
              <div className="meta-item">
                <dt>Assessment Date</dt>
                <dd>{runDate}</dd>
              </div>
              <div className="meta-item">
                <dt>Status</dt>
                <dd>
                  <span className={`badge ${run.status === 'completed' ? 'badge-green' : run.status === 'in_progress' ? 'badge-blue' : 'badge-gray'}`}>
                    {run.status ?? 'unknown'}
                  </span>
                </dd>
              </div>
              {demo?.age != null && (
                <div className="meta-item">
                  <dt>Participant</dt>
                  <dd>
                    Age {demo.age}
                    {demo.gender ? ` · ${demo.gender}` : ''}
                    {demo.country ? ` · ${demo.country}` : ''}
                  </dd>
                </div>
              )}
              {demo?.eyeConditions && demo.eyeConditions.length > 0 && (
                <div className="meta-item">
                  <dt>Eye Conditions</dt>
                  <dd>{demo.eyeConditions.join(', ')}</dd>
                </div>
              )}
              {run.session?.meanErrorPx != null && (
                <div className="meta-item">
                  <dt>Calibration Error</dt>
                  <dd>{run.session.meanErrorPx.toFixed(1)} px
                    <span style={{ color: '#94a3b8', fontSize: 12, marginLeft: 4 }}>
                      {run.session.meanErrorPx < 30 ? '(Good)' : run.session.meanErrorPx < 60 ? '(Acceptable)' : '(Poor)'}
                    </span>
                  </dd>
                </div>
              )}
            </dl>

            {testOrder.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#94a3b8', marginBottom: 8 }}>
                  Test Protocol Order
                </p>
                <div>
                  {testOrder.map((tid, i) => (
                    <span key={tid} className="test-pill">
                      <span className="test-pill-num">{i + 1}.</span>
                      {TEST_LABELS[tid] ?? tid}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Symptom Assessment */}
          {(hasPre || hasPost) && (
            <div className="section">
              <p className="section-title">Symptom Assessment (Pre / Post)</p>
              <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
                Scale: 0 = None · 1 = Mild · 2 = Moderate · 3 = Strong · 4 = Severe · Δ = Post − Pre
              </p>
              <table className="symptom-table">
                <thead>
                  <tr>
                    <th>Symptom</th>
                    {hasPre  && <th>Pre</th>}
                    {hasPost && <th>Post</th>}
                    {hasPre && hasPost && <th>Δ Change</th>}
                    {hasPre && hasPost && <th style={{ minWidth: 60 }}>Visual</th>}
                  </tr>
                </thead>
                <tbody>
                  {SYMPTOM_QUESTIONS.map((q) => {
                    const pre  = preScores[q.id]  ?? null;
                    const post = postScores[q.id] ?? null;
                    const delta = pre != null && post != null ? post - pre : null;
                    return (
                      <tr key={q.id}>
                        <td>
                          <strong>{q.category}</strong>{' '}
                          <span style={{ color: '#94a3b8', fontSize: 12 }}>{q.question}</span>
                        </td>
                        {hasPre && (
                          <td>
                            {pre != null ? `${pre} – ${SYMPTOM_LABELS[pre]}` : '—'}
                          </td>
                        )}
                        {hasPost && (
                          <td>
                            {post != null ? `${post} – ${SYMPTOM_LABELS[post]}` : '—'}
                          </td>
                        )}
                        {hasPre && hasPost && (
                          <td className={delta == null ? '' : delta > 0 ? 'delta-bad' : delta < 0 ? 'delta-good' : 'delta-zero'}>
                            {delta != null ? (delta > 0 ? `+${delta}` : delta === 0 ? '0' : `${delta}`) : '—'}
                          </td>
                        )}
                        {hasPre && hasPost && (
                          <td>
                            {pre != null && post != null && (
                              <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                <div className="symptom-bar" style={{ width: 40 }}>
                                  <div className="symptom-bar-fill" style={{
                                    width: `${(pre / 4) * 100}%`,
                                    background: '#94a3b8',
                                  }} />
                                </div>
                                <div className="symptom-bar" style={{ width: 40 }}>
                                  <div className="symptom-bar-fill" style={{
                                    width: `${(post / 4) * 100}%`,
                                    background: post > pre ? '#f87171' : post < pre ? '#34d399' : '#94a3b8',
                                  }} />
                                </div>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total Symptom Score</td>
                    {hasPre  && <td>{totalPre}</td>}
                    {hasPost && <td>{totalPost}</td>}
                    {hasPre && hasPost && (
                      <td className={totalPost - totalPre > 0 ? 'delta-bad' : totalPost - totalPre < 0 ? 'delta-good' : 'delta-zero'}>
                        {totalPost - totalPre > 0 ? '+' : ''}{totalPost - totalPre}
                      </td>
                    )}
                    {hasPre && hasPost && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Section 3: Test Results */}
          {testOrder.length > 0 && run.testResults && (
            <div className="section">
              <p className="section-title">Individual Test Results</p>
              {testOrder.map((tid) => {
                const data = (run.testResults as Record<string, unknown>)[tid];
                const raw  = data && typeof data === 'object' ? data as Record<string, unknown> : {};
                const metrics = data ? extractMetrics(tid, raw) : [];
                return (
                  <div key={tid} className="test-card">
                    <div className="test-card-header">
                      <h3>{TEST_LABELS[tid] ?? tid}</h3>
                      {!data && (
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>No data recorded</span>
                      )}
                    </div>
                    {!!data && (
                      <div className="test-card-body">
                        <table className="metrics-table">
                          <tbody>
                            {metrics.map((m, i) => (
                              <tr key={i}>
                                <td>{m.label}</td>
                                <td>
                                  {m.value}
                                  <FlagBadge flag={m.flag} />
                                </td>
                                <td>{m.note ?? ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Section 4: Clinical Notes placeholder */}
          <div className="section" style={{ pageBreakInside: 'avoid' }}>
            <p className="section-title">Clinical Notes</p>
            <div style={{
              minHeight: 80,
              border: '1px dashed #cbd5e1',
              borderRadius: 6,
              padding: 12,
              color: '#94a3b8',
              fontSize: 12,
            }}>
              (Space reserved for clinician's notes — complete manually after printing)
            </div>
          </div>

          {/* Disclaimer */}
          <div style={{
            marginTop: 28,
            padding: '14px 16px',
            background: '#fefce8',
            border: '1px solid #fde68a',
            borderRadius: 6,
            fontSize: 11,
            color: '#92400e',
            lineHeight: 1.6,
          }}>
            <strong>Disclaimer:</strong> This report is generated from automated eye-tracking measurements and is intended
            for clinical research and screening purposes only. Results should be interpreted by a qualified healthcare
            professional in conjunction with clinical history. Webcam-based eye tracking has inherent accuracy limitations;
            calibration quality affects measurement reliability.
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="report-footer">
          <span>Precision Eye Tracker · Neurological Assessment</span>
          <span>Run ID: {run.id.slice(0, 12)}…</span>
          <span>Report date: {now}</span>
        </div>
      </div>
    </>
  );
}

// ── Inline SVG icons ───────────────────────────────────────────────────────────

function PrintIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v5a2 2 0 002 2h1v2a1 1 0 001 1h8a1 1 0 001-1v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a1 1 0 00-1-1H6a1 1 0 00-1 1zm2 0h6v3H7V4zm-1 9H5a1 1 0 110-2h1v2zm8 0h-1v-2h1a1 1 0 110 2zm-7 2v-2h6v2H8z" clipRule="evenodd" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="rgba(59,130,246,0.15)" />
      <path d="M4 16s4-8 12-8 12 8 12 8-4 8-12 8-12-8-12-8z" stroke="#60a5fa" strokeWidth="2" fill="none" />
      <circle cx="16" cy="16" r="3" fill="#60a5fa" />
      <circle cx="17" cy="15" r="1" fill="#bfdbfe" />
    </svg>
  );
}

// ── Page export with Suspense boundary (required for useSearchParams) ───────────

export default function NeurologicalRunReportPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading report…</div>}>
      <NeurologicalRunReportInner />
    </Suspense>
  );
}
