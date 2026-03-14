'use client';

import React, { useState, useEffect } from 'react';

const TEST_LABELS: Record<string, string> = {
  head_orientation: 'Head Orientation',
  visual_search: 'Visual Search',
  memory_cards: 'Memory Cards',
  anti_saccade: 'Anti-Saccade',
  saccadic: 'Saccadic',
  fixation_stability: 'Fixation Stability',
  peripheral_vision: 'Peripheral Vision',
};

const ALL_TEST_IDS = [
  'head_orientation',
  'visual_search',
  'memory_cards',
  'anti_saccade',
  'saccadic',
  'fixation_stability',
  'peripheral_vision',
];

export type NeurologicalConfigState = {
  testOrder: string[];
  testParameters: Record<string, Record<string, unknown>>;
  testEnabled: Record<string, boolean>;
};

function ensureParams(id: string, params: Record<string, Record<string, unknown>>): Record<string, unknown> {
  const defaults: Record<string, Record<string, unknown>> = {
    head_orientation: { durationPerDirectionSec: 4, order: ['left', 'right', 'up', 'down'] },
    visual_search: { numberCount: 8, practiceCount: 4, aoiRadiusPx: 80 },
    memory_cards: { gridSize: 4, dwellMs: 800 },
    anti_saccade: { trialCount: 12, movementDurationMs: 1500, intervalBetweenTrialsMs: 800 },
    saccadic: { targetDurationMs: 1000, totalCycles: 18 },
    fixation_stability: { durationSec: 12, blinkIntervalMs: 600 },
    peripheral_vision: { trialCount: 16, stimulusDurationMs: 300, minDelayMs: 800, maxDelayMs: 2000 },
  };
  return { ...defaults[id], ...(params[id] ?? {}) };
}

export default function NeurologicalConfigForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [config, setConfig] = useState<NeurologicalConfigState>({
    testOrder: [...ALL_TEST_IDS],
    testParameters: {},
    testEnabled: ALL_TEST_IDS.reduce((acc, id) => ({ ...acc, [id]: true }), {} as Record<string, boolean>),
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/neurological-config', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to load config');
        const data = await res.json();
        if (cancelled) return;
        const order = Array.isArray(data.testOrder) ? data.testOrder : [...ALL_TEST_IDS];
        const params: Record<string, Record<string, unknown>> = {};
        for (const id of ALL_TEST_IDS) {
          params[id] = ensureParams(id, (data.testParameters ?? {}) as Record<string, Record<string, unknown>>);
        }
        const enabled: Record<string, boolean> = { ...data.testEnabled };
        ALL_TEST_IDS.forEach((id) => {
          if (enabled[id] === undefined) enabled[id] = true;
        });
        setConfig({ testOrder: order, testParameters: params, testEnabled: enabled });
      } catch (e) {
        if (!cancelled) setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Load failed' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const moveTest = (index: number, dir: 'up' | 'down') => {
    const order = [...config.testOrder];
    const newIndex = dir === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= order.length) return;
    [order[index], order[newIndex]] = [order[newIndex], order[index]];
    setConfig((c) => ({ ...c, testOrder: order }));
  };

  const setEnabled = (id: string, value: boolean) => {
    setConfig((c) => ({ ...c, testEnabled: { ...c.testEnabled, [id]: value } }));
  };

  const setParam = (testId: string, key: string, value: unknown) => {
    setConfig((c) => ({
      ...c,
      testParameters: {
        ...c.testParameters,
        [testId]: { ...(c.testParameters[testId] ?? {}), [key]: value },
      },
    }));
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/neurological-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          testOrder: config.testOrder,
          testParameters: config.testParameters,
          testEnabled: config.testEnabled,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Save failed: ${res.status}`);
      }
      setMessage({ type: 'success', text: 'Config saved.' });
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {message && (
        <div
          className={`px-4 py-2 rounded-lg text-sm ${message.type === 'success' ? 'bg-emerald-900/50 text-emerald-200' : 'bg-red-900/50 text-red-200'}`}
        >
          {message.text}
        </div>
      )}

      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Test order</h2>
        <p className="text-slate-400 text-sm mb-3">Order in which tests run. Use arrows to reorder.</p>
        <ul className="space-y-1">
          {config.testOrder.map((id, index) => (
            <li key={id} className="flex items-center gap-2 py-1">
              <span className="text-slate-500 w-6">{index + 1}.</span>
              <span className="text-white flex-1">{TEST_LABELS[id] ?? id}</span>
              <button
                type="button"
                onClick={() => moveTest(index, 'up')}
                disabled={index === 0}
                className="px-2 py-0.5 rounded bg-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveTest(index, 'down')}
                disabled={index === config.testOrder.length - 1}
                className="px-2 py-0.5 rounded bg-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ↓
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Tests & parameters</h2>
        <div className="space-y-6">
          {ALL_TEST_IDS.map((id) => {
            const params = config.testParameters[id] ?? {};
            const enabled = config.testEnabled[id] !== false;
            return (
              <div key={id} className="border border-slate-700 rounded-lg p-4 bg-slate-800/50">
                <div className="flex items-center gap-3 mb-3">
                  <input
                    type="checkbox"
                    id={`enabled-${id}`}
                    checked={enabled}
                    onChange={(e) => setEnabled(id, e.target.checked)}
                    className="rounded border-slate-500"
                  />
                  <label htmlFor={`enabled-${id}`} className="font-medium text-white">
                    {TEST_LABELS[id]}
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pl-6">
                  {id === 'head_orientation' && (
                    <>
                      <LabelInput
                        label="Duration per direction (s)"
                        value={Number(params.durationPerDirectionSec) ?? 4}
                        onChange={(v) => setParam(id, 'durationPerDirectionSec', v)}
                        min={1}
                        max={10}
                      />
                      <div className="text-slate-400 text-sm">Order: left, right, up, down (fixed)</div>
                    </>
                  )}
                  {id === 'visual_search' && (
                    <>
                      <LabelInput
                        label="Number count (6–10)"
                        value={Number(params.numberCount) ?? 8}
                        onChange={(v) => setParam(id, 'numberCount', v)}
                        min={6}
                        max={10}
                      />
                      <LabelInput
                        label="Practice count"
                        value={Number(params.practiceCount) ?? 4}
                        onChange={(v) => setParam(id, 'practiceCount', v)}
                        min={1}
                        max={10}
                      />
                      <LabelInput
                        label="AOI radius (px)"
                        value={Number(params.aoiRadiusPx) ?? 80}
                        onChange={(v) => setParam(id, 'aoiRadiusPx', v)}
                        min={20}
                        max={200}
                      />
                    </>
                  )}
                  {id === 'memory_cards' && (
                    <>
                      <LabelInput
                        label="Grid size (4|6|9)"
                        value={Number(params.gridSize) ?? 4}
                        onChange={(v) => setParam(id, 'gridSize', v)}
                        min={4}
                        max={9}
                      />
                      <LabelInput
                        label="Dwell (ms)"
                        value={Number(params.dwellMs) ?? 800}
                        onChange={(v) => setParam(id, 'dwellMs', v)}
                        min={200}
                        max={2000}
                      />
                    </>
                  )}
                  {id === 'anti_saccade' && (
                    <>
                      <LabelInput
                        label="Trial count"
                        value={Number(params.trialCount) ?? 12}
                        onChange={(v) => setParam(id, 'trialCount', v)}
                        min={4}
                        max={30}
                      />
                      <LabelInput
                        label="Movement duration (ms)"
                        value={Number(params.movementDurationMs) ?? 1500}
                        onChange={(v) => setParam(id, 'movementDurationMs', v)}
                        min={500}
                        max={5000}
                      />
                      <LabelInput
                        label="Interval between trials (ms)"
                        value={Number(params.intervalBetweenTrialsMs) ?? 800}
                        onChange={(v) => setParam(id, 'intervalBetweenTrialsMs', v)}
                        min={200}
                        max={3000}
                      />
                    </>
                  )}
                  {id === 'saccadic' && (
                    <>
                      <LabelInput
                        label="Target duration (ms)"
                        value={Number(params.targetDurationMs) ?? 1000}
                        onChange={(v) => setParam(id, 'targetDurationMs', v)}
                        min={400}
                        max={3000}
                      />
                      <LabelInput
                        label="Total cycles"
                        value={Number(params.totalCycles) ?? 18}
                        onChange={(v) => setParam(id, 'totalCycles', v)}
                        min={8}
                        max={40}
                      />
                    </>
                  )}
                  {id === 'fixation_stability' && (
                    <>
                      <LabelInput
                        label="Duration (s)"
                        value={Number(params.durationSec) ?? 12}
                        onChange={(v) => setParam(id, 'durationSec', v)}
                        min={10}
                        max={15}
                      />
                      <LabelInput
                        label="Blink interval (ms)"
                        value={Number(params.blinkIntervalMs) ?? 600}
                        onChange={(v) => setParam(id, 'blinkIntervalMs', v)}
                        min={0}
                        max={2000}
                      />
                    </>
                  )}
                  {id === 'peripheral_vision' && (
                    <>
                      <LabelInput
                        label="Trial count"
                        value={Number(params.trialCount) ?? 16}
                        onChange={(v) => setParam(id, 'trialCount', v)}
                        min={8}
                        max={40}
                      />
                      <LabelInput
                        label="Stimulus duration (ms)"
                        value={Number(params.stimulusDurationMs) ?? 300}
                        onChange={(v) => setParam(id, 'stimulusDurationMs', v)}
                        min={100}
                        max={1000}
                      />
                      <LabelInput
                        label="Min delay (ms)"
                        value={Number(params.minDelayMs) ?? 800}
                        onChange={(v) => setParam(id, 'minDelayMs', v)}
                        min={0}
                        max={5000}
                      />
                      <LabelInput
                        label="Max delay (ms)"
                        value={Number(params.maxDelayMs) ?? 2000}
                        onChange={(v) => setParam(id, 'maxDelayMs', v)}
                        min={500}
                        max={10000}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium"
        >
          {saving ? 'Saving…' : 'Save config'}
        </button>
      </div>
    </div>
  );
}

function LabelInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <label className="block text-slate-400 text-sm mb-0.5">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        className="w-full px-3 py-1.5 rounded bg-slate-800 border border-slate-600 text-white"
      />
    </div>
  );
}
