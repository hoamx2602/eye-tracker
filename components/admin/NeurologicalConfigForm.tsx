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
    memory_cards: { cardCount: 16, dwellMs: 800, symbolSize: 'lg' },
    anti_saccade: { trialCount: 12, movementDurationMs: 1500, intervalBetweenTrialsMs: 800, practiceRestartDelaySec: 3, dimRectOpacity: 0.1, showDimRect: true },
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

  const setParams = (testId: string, updates: Record<string, unknown>) => {
    setConfig((c) => ({
      ...c,
      testParameters: {
        ...c.testParameters,
        [testId]: { ...(c.testParameters[testId] ?? {}), ...updates },
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
                      <SelectNumber
                        label="Duration per direction (s)"
                        value={Number(params.durationPerDirectionSec) ?? 4}
                        onChange={(v) => setParam(id, 'durationPerDirectionSec', v)}
                        options={[2, 3, 4, 5, 6, 8, 10].map((n) => ({ value: n, label: `${n} s` }))}
                      />
                      <div className="text-slate-400 text-sm">Order: left, right, up, down (fixed)</div>
                    </>
                  )}
                  {id === 'visual_search' && (
                    <>
                      <SelectNumber
                        label="Number count"
                        value={Number(params.numberCount) ?? 8}
                        onChange={(v) => setParam(id, 'numberCount', v)}
                        options={[6, 7, 8, 9, 10].map((n) => ({ value: n, label: String(n) }))}
                      />
                      <SelectNumber
                        label="Practice count"
                        value={Number(params.practiceCount) ?? 4}
                        onChange={(v) => setParam(id, 'practiceCount', v)}
                        options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))}
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
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">Card count</label>
                        <select
                          value={String(params.cardCount ?? 16)}
                          onChange={(e) => setParam(id, 'cardCount', Number(e.target.value))}
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-slate-200 text-sm"
                        >
                          <option value={6}>6 cards</option>
                          <option value={8}>8 cards</option>
                          <option value={12}>12 cards</option>
                          <option value={16}>16 cards</option>
                          <option value={20}>20 cards</option>
                          <option value={24}>24 cards</option>
                          <option value={28}>28 cards</option>
                          <option value={32}>32 cards</option>
                        </select>
                      </div>
                      <SelectNumber
                        label="Dwell (ms)"
                        value={Number(params.dwellMs) ?? 800}
                        onChange={(v) => setParam(id, 'dwellMs', v)}
                        options={[400, 600, 800, 1000, 1200, 1500, 2000].map((n) => ({ value: n, label: `${n} ms` }))}
                      />
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">Symbol size</label>
                        <select
                          value={String(params.symbolSize ?? 'lg')}
                          onChange={(e) => setParam(id, 'symbolSize', e.target.value)}
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-slate-200 text-sm"
                        >
                          <option value="sm">Small</option>
                          <option value="md">Medium</option>
                          <option value="lg">Large</option>
                          <option value="xl">Extra large</option>
                        </select>
                      </div>
                      <p className="text-xs text-slate-500 -mt-1">Lưu rồi chọn Neurological để áp dụng.</p>
                    </>
                  )}
                  {id === 'anti_saccade' && (
                    <>
                      <SelectNumber
                        label="Trial count"
                        value={Number(params.trialCount) ?? 12}
                        onChange={(v) => setParam(id, 'trialCount', v)}
                        options={[8, 10, 12, 15, 18, 20, 24, 30].map((n) => ({ value: n, label: String(n) }))}
                      />
                      <SelectNumber
                        label="Movement duration (ms) — thời gian mỗi bước di chuyển; số lớn = chậm hơn"
                        value={Number(params.movementDurationMs) ?? 1500}
                        onChange={(v) => setParam(id, 'movementDurationMs', v)}
                        options={[800, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000].map((n) => ({ value: n, label: `${n} ms` }))}
                      />
                      <SelectNumber
                        label="Độ mờ rectangle dim (opacity)"
                        value={Number(params.dimRectOpacity) ?? 0.1}
                        onChange={(v) => setParam(id, 'dimRectOpacity', v)}
                        options={[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((n) => ({ value: n, label: `${Math.round(n * 100)}%` }))}
                      />
                      <div>
                        <label className="block text-slate-400 text-sm mb-0.5">Hiển thị rectangle mờ (dim)</label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={params.showDimRect !== false}
                            onChange={(e) => setParam(id, 'showDimRect', e.target.checked)}
                            className="rounded bg-slate-800 border-slate-600"
                          />
                          <span className="text-sm text-slate-300">Bật — khi tắt: ẩn hẳn rectangle mờ, người dùng tự nhìn bằng mắt</span>
                        </label>
                      </div>
                      <SelectNumber
                        label="Interval between trials (ms)"
                        value={Number(params.intervalBetweenTrialsMs) ?? 800}
                        onChange={(v) => setParam(id, 'intervalBetweenTrialsMs', v)}
                        options={[400, 600, 800, 1000, 1200, 1500, 2000, 3000].map((n) => ({ value: n, label: `${n} ms` }))}
                      />
                      <SelectNumber
                        label="Practice: thời gian chờ trước khi tự chạy lại (s)"
                        value={Number(params.practiceRestartDelaySec) ?? 3}
                        onChange={(v) => setParam(id, 'practiceRestartDelaySec', v)}
                        options={[1, 2, 3, 4].map((n) => ({ value: n, label: `${n} s` }))}
                      />
                    </>
                  )}
                  {id === 'saccadic' && (
                    <>
                      <SelectNumber
                        label="Target duration (ms)"
                        value={Number(params.targetDurationMs) ?? 1000}
                        onChange={(v) => setParam(id, 'targetDurationMs', v)}
                        options={[500, 700, 1000, 1500, 2000, 2500, 3000].map((n) => ({ value: n, label: `${n} ms` }))}
                      />
                      <SelectNumber
                        label="Total cycles"
                        value={Number(params.totalCycles) ?? 18}
                        onChange={(v) => setParam(id, 'totalCycles', v)}
                        options={[10, 12, 15, 18, 20, 24, 30, 36, 40].map((n) => ({ value: n, label: String(n) }))}
                      />
                    </>
                  )}
                  {id === 'fixation_stability' && (
                    <>
                      <SelectNumber
                        label="Duration (s)"
                        value={Number(params.durationSec) ?? 12}
                        onChange={(v) => setParam(id, 'durationSec', v)}
                        options={[10, 11, 12, 13, 14, 15].map((n) => ({ value: n, label: `${n} s` }))}
                      />
                      <SelectNumber
                        label="Blink interval (ms)"
                        value={Number(params.blinkIntervalMs) ?? 600}
                        onChange={(v) => setParam(id, 'blinkIntervalMs', v)}
                        options={[0, 300, 500, 600, 800, 1000, 1500, 2000].map((n) => ({ value: n, label: `${n} ms` }))}
                      />
                    </>
                  )}
                  {id === 'peripheral_vision' && (
                    <>
                      <SelectNumber
                        label="Trial count"
                        value={Number(params.trialCount) ?? 16}
                        onChange={(v) => setParam(id, 'trialCount', v)}
                        options={[8, 12, 16, 20, 24, 30, 40].map((n) => ({ value: n, label: String(n) }))}
                      />
                      <SelectNumber
                        label="Stimulus duration (ms)"
                        value={Number(params.stimulusDurationMs) ?? 300}
                        onChange={(v) => setParam(id, 'stimulusDurationMs', v)}
                        options={[100, 150, 200, 250, 300, 400, 500, 1000].map((n) => ({ value: n, label: `${n} ms` }))}
                      />
                      <SelectNumber
                        label="Min delay (ms)"
                        value={Number(params.minDelayMs) ?? 800}
                        onChange={(v) => {
                          const max = Number(params.maxDelayMs) ?? 2000;
                          if (v > max) setParams(id, { minDelayMs: v, maxDelayMs: v });
                          else setParam(id, 'minDelayMs', v);
                        }}
                        options={[500, 800, 1000, 1500, 2000, 3000].map((n) => ({ value: n, label: `${n} ms` }))}
                      />
                      <SelectNumber
                        label="Max delay (ms)"
                        value={Number(params.maxDelayMs) ?? 2000}
                        onChange={(v) => {
                          const min = Number(params.minDelayMs) ?? 800;
                          if (v < min) setParams(id, { minDelayMs: v, maxDelayMs: v });
                          else setParam(id, 'maxDelayMs', v);
                        }}
                        options={[1000, 1500, 2000, 2500, 3000, 4000, 5000, 10000].map((n) => ({ value: n, label: `${n} ms` }))}
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
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const clamped = (v: number) => {
    let n = Number(v);
    if (!Number.isFinite(n)) return value;
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    return n;
  };
  return (
    <div>
      <label className="block text-slate-400 text-sm mb-0.5">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(clamped(Number(e.target.value)))}
        onBlur={(e) => onChange(clamped(Number(e.target.value)))}
        min={min}
        max={max}
        step={step}
        className="w-full px-3 py-1.5 rounded bg-slate-800 border border-slate-600 text-white"
      />
    </div>
  );
}

function SelectNumber({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  options: { value: number; label: string }[];
}) {
  const v = options.some((o) => o.value === value) ? value : options[0]?.value ?? value;
  return (
    <div>
      <label className="block text-slate-400 text-sm mb-0.5">{label}</label>
      <select
        value={String(v)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full px-3 py-1.5 rounded bg-slate-800 border border-slate-600 text-white text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
