'use client';

import { useEffect, useState } from 'react';
import NeuroRunResultsReport, { type NeuroRunForReport } from '@/components/neurological/results/NeuroRunResultsReport';

export default function NeurologicalResultsPanel({ runId }: { runId: string }) {
  const [run, setRun] = useState<NeuroRunForReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/doctor/neurological-runs/${runId}`, { credentials: 'include' });
        if (!res.ok) { if (!cancelled) setError(true); return; }
        const data = await res.json();
        if (!cancelled) setRun(data);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [runId]);

  if (loading) return <p className="text-slate-400 text-sm">Loading neurological test results…</p>;
  if (error || !run) return <p className="text-slate-500 text-sm">Could not load neurological test results.</p>;

  return <NeuroRunResultsReport run={run} />;
}
