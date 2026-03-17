'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import AppConfigForm from '@/components/admin/AppConfigForm';
import NeurologicalConfigForm from '@/components/admin/NeurologicalConfigForm';

type ConfigTab = 'app' | 'neuro';

export default function AdminConfigPage() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<ConfigTab>('app');

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'neuro') setTab('neuro');
  }, [searchParams]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-2">Configuration</h1>
      <p className="text-slate-400 text-sm mb-6">
        App defaults (calibration, smoothing, recording) and neurological test settings. Saved values are used when users start a session.
      </p>

      <div className="flex gap-2 border-b border-slate-700 pb-4 mb-6">
        <button
          type="button"
          onClick={() => setTab('app')}
          className={`px-5 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 transition ${
            tab === 'app'
              ? 'bg-slate-700 border-slate-600 text-white -mb-px'
              : 'bg-slate-800 border-transparent text-slate-400 hover:text-white'
          }`}
        >
          App &amp; calibration
        </button>
        <button
          type="button"
          onClick={() => setTab('neuro')}
          className={`px-5 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 transition ${
            tab === 'neuro'
              ? 'bg-slate-700 border-slate-600 text-white -mb-px'
              : 'bg-slate-800 border-transparent text-slate-400 hover:text-white'
          }`}
        >
          Neurological tests
        </button>
      </div>

      {tab === 'app' && <AppConfigForm />}
      {tab === 'neuro' && <NeurologicalConfigForm />}
    </div>
  );
}
