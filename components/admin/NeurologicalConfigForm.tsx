'use client';

import React, { useState, useEffect } from 'react';
import {
  STIMULUS_SHAPE_OPTIONS,
  resolveAntiSaccadeRectHex,
  type AntiSaccadeRectColor,
  type AntiSaccadeRectColorToken,
} from '@/components/neurological/tests/antiSaccade/constants';
import { HexColorPicker } from 'react-colorful';

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
    visual_search: {
      numberCount: 8,
      practiceCount: 4,
      aoiRadiusPx: 80,
      allowClickTargets: false,
      clickHoldDurationMs: 300,
    },
    memory_cards: { cardCount: 16, dwellMs: 800, symbolSize: 'lg', cardGapPx: 8 },
    anti_saccade: {
      trialCount: 12,
      movementSpeedPxPerSec: 120,
      fixationPauseMs: 1000,
      intervalBetweenTrialsMs: 800,
      practiceRestartDelaySec: 3,
      dimRectOpacity: 0.1,
      showDimRect: true,
      stimulusShape: 'rectangle',
      primaryRectColor: 'red',
      dimRectColor: 'blue',
    },
    saccadic: { targetDurationMs: 1000, totalCycles: 18, targetDotSizePx: 64, targetDotColor: '#f59e0b' },
    fixation_stability: { durationSec: 5, blinkIntervalMs: 600, centerDotSizePx: 12, centerDotColor: '#f59e0b' },
    peripheral_vision: { trialCount: 16, stimulusDurationMs: 300, minDelayMs: 800, maxDelayMs: 2000, centerDotSizePx: 8, centerDotColor: '#f59e0b', stimulusDotSizePx: 16, stimulusDotColor: '#ffffff' },
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
        const rawParams = (data.testParameters ?? {}) as Record<string, Record<string, unknown>>;
        const params: Record<string, Record<string, unknown>> = {};
        // Load global settings (stored under _global key)
        params['_global'] = { edgePaddingPx: 80, ...((rawParams['_global'] as Record<string, unknown>) ?? {}) };
        // Load self-assessment config (stored under _selfAssessment key)
        params['_selfAssessment'] = {
          enabled: true,
          questionCount: 2,
          question1: 'How focused were you during this test?',
          question2: 'How accurately do you think you performed?',
          ...((rawParams['_selfAssessment'] as Record<string, unknown>) ?? {}),
        };
        for (const id of ALL_TEST_IDS) {
          params[id] = ensureParams(id, rawParams);
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
      <div className="text-slate-400 py-8">Loading neurological config…</div>
    );
  }

  return (
    <div className="space-y-6">
      {message && (
        <p className={`text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-4 border-b border-slate-700 pb-4">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-lg transition"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <section className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-4">
        <h3 className="text-sm font-bold text-slate-300">Global settings</h3>
        <p className="text-slate-400 text-xs">
          Applies to all tests. Stimuli and moving objects will stay at least this many pixels from
          the screen edge — matching the calibration area boundary (~4% of screen width/height ≈ 77 px
          on 1920 px wide). Keeping this consistent avoids asking the gaze model to extrapolate
          outside its trained region.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <SelectNumber
            label="Edge padding (px)"
            value={Number((config.testParameters['_global'] ?? {}).edgePaddingPx) || 80}
            onChange={(v) => setParam('_global', 'edgePaddingPx', v)}
            options={[40, 60, 80, 100, 120, 150, 200].map((n) => ({ value: n, label: `${n} px` }))}
          />
        </div>
      </section>

      {/* Self-assessment config */}
      <section className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-4">
        <h3 className="text-sm font-bold text-slate-300">Post-test self-assessment</h3>
        <p className="text-slate-400 text-xs">
          After each test completes, the user is shown a brief rating modal before moving on.
          Configure the questions here. Setting &ldquo;Questions shown&rdquo; to 1 hides the second question.
        </p>
        {(() => {
          const sa = (config.testParameters['_selfAssessment'] ?? {}) as Record<string, unknown>;
          const enabled = sa.enabled !== false;
          const questionCount = (sa.questionCount as number) === 1 ? 1 : 2;
          const question1 = typeof sa.question1 === 'string' ? sa.question1 : 'How focused were you during this test?';
          const question2 = typeof sa.question2 === 'string' ? sa.question2 : 'How accurately do you think you performed?';
          return (
            <div className="space-y-4">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setParam('_selfAssessment', 'enabled', e.target.checked)}
                  className="rounded border-slate-500 bg-slate-800 h-4 w-4"
                />
                <span className="text-white text-sm font-medium">Enable post-test self-assessment</span>
              </label>
              {enabled && (
                <div className="space-y-4 pl-2 border-l-2 border-blue-600/30">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-slate-300">Questions shown (1 or 2)</label>
                    <div className="flex gap-3">
                      {[1, 2].map((n) => (
                        <label key={n} className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="radio"
                            name="questionCount"
                            checked={questionCount === n}
                            onChange={() => setParam('_selfAssessment', 'questionCount', n)}
                            className="accent-blue-500"
                          />
                          <span className="text-white text-sm">{n}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-slate-300">Question 1 (Focus) 😴→🎯</label>
                    <input
                      type="text"
                      value={question1}
                      onChange={(e) => setParam('_selfAssessment', 'question1', e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  {questionCount === 2 && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-slate-300">Question 2 (Accuracy prediction) 🤔→✅</label>
                      <input
                        type="text"
                        value={question2}
                        onChange={(e) => setParam('_selfAssessment', 'question2', e.target.value)}
                        className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </section>

      <section className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-4">
        <h3 className="text-sm font-bold text-slate-300">Test order</h3>
        <p className="text-slate-400 text-xs">Order in which tests run. Use arrows to reorder.</p>
        <ul className="space-y-1">
          {config.testOrder.map((id, index) => (
            <li key={id} className="flex items-center gap-2 py-1.5">
              <span className="text-slate-500 w-6 tabular-nums">{index + 1}.</span>
              <span className="text-white flex-1">{TEST_LABELS[id] ?? id}</span>
              <button
                type="button"
                onClick={() => moveTest(index, 'up')}
                disabled={index === 0}
                className="px-2 py-1 rounded-lg bg-slate-700 border border-slate-600 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium hover:bg-slate-600"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveTest(index, 'down')}
                disabled={index === config.testOrder.length - 1}
                className="px-2 py-1 rounded-lg bg-slate-700 border border-slate-600 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium hover:bg-slate-600"
              >
                ↓
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-bold text-slate-300">Tests & parameters</h3>
        <div className="space-y-4">
          {ALL_TEST_IDS.map((id) => {
            const params = config.testParameters[id] ?? {};
            const enabled = config.testEnabled[id] !== false;
            return (
              <div key={id} className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-4">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id={`enabled-${id}`}
                    checked={enabled}
                    onChange={(e) => setEnabled(id, e.target.checked)}
                    className="rounded border-slate-500 bg-slate-800"
                  />
                  <label htmlFor={`enabled-${id}`} className="font-semibold text-white">
                    {TEST_LABELS[id]}
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pl-6">
                  {id === 'head_orientation' && (
                    <>
                      <SelectNumber
                        label="Duration per direction (s)"
                        value={Number(params.durationPerDirectionSec) ?? 4}
                        onChange={(v) => setParam(id, 'durationPerDirectionSec', v)}
                        options={[2, 3, 4, 5, 6, 8, 10].map((n) => ({ value: n, label: `${n} s` }))}
                      />
                      <p className="text-xs text-slate-500">Order: left, right, up, down (fixed)</p>
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
                      <div className="sm:col-span-2 lg:col-span-3 flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
                          <input
                            type="checkbox"
                            checked={Boolean(params.allowClickTargets)}
                            onChange={(e) => setParam(id, 'allowClickTargets', e.target.checked)}
                            className="rounded border-slate-500 bg-slate-800"
                          />
                          Allow hold-and-click on targets
                        </label>
                        <p className="text-xs text-slate-500">
                          When on, participants press and hold each number, then release to log pointer position with gaze — useful to compare gaze vs touch/mouse.
                        </p>
                        <LabelInput
                          label="Min hold before release (ms)"
                          value={Number(params.clickHoldDurationMs ?? 300)}
                          onChange={(v) => setParam(id, 'clickHoldDurationMs', v)}
                          min={0}
                          max={2000}
                        />
                        <p className="text-xs text-slate-500">0 = single tap/click counts without a minimum hold.</p>
                      </div>
                      <SelectNumber
                        label="Gaze sample interval (ms)"
                        value={Number(params.gazeSampleIntervalMs) || 100}
                        onChange={(v) => setParam(id, 'gazeSampleIntervalMs', v)}
                        options={[50, 100, 150, 200, 250, 300].map((n) => ({ value: n, label: `${n} ms` }))}
                      />
                    </>
                  )}
                  {id === 'memory_cards' && (
                    <>
                      <div>
                        <label className="block text-slate-400 text-sm mb-0.5">Card count</label>
                        <select
                          value={String(params.cardCount ?? 16)}
                          onChange={(e) => setParam(id, 'cardCount', Number(e.target.value))}
                          className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
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
                        <label className="block text-slate-400 text-sm mb-0.5">Symbol size</label>
                        <select
                          value={String(params.symbolSize ?? 'lg')}
                          onChange={(e) => setParam(id, 'symbolSize', e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
                        >
                          <option value="sm">Small</option>
                          <option value="md">Medium</option>
                          <option value="lg">Large</option>
                          <option value="xl">Extra large</option>
                        </select>
                      </div>
                      <p className="text-xs text-slate-500">Save then select Neurological to apply.</p>
                      <SelectNumber
                        label="Gaze sample interval (ms)"
                        value={Number(params.gazeSampleIntervalMs) || 100}
                        onChange={(v) => setParam(id, 'gazeSampleIntervalMs', v)}
                        options={[50, 100, 150, 200, 250, 300].map((n) => ({ value: n, label: `${n} ms` }))}
                      />
                      <SelectNumber
                        label="Card gap (px)"
                        value={Number(params.cardGapPx) || 8}
                        onChange={(v) => setParam(id, 'cardGapPx', v)}
                        options={[0, 4, 6, 8, 10, 12, 16, 20, 24].map((n) => ({ value: n, label: `${n} px` }))}
                      />
                    </>
                  )}
                  {id === 'anti_saccade' && (
                    <>
                      <SelectNumber
                        label="Trial count"
                        value={Number(params.trialCount) ?? 12}
                        onChange={(v) => setParam(id, 'trialCount', v)}
                        options={[2, 4, 6, 8, 10, 12, 15, 18, 20, 24, 30].map((n) => ({ value: n, label: String(n) }))}
                      />
                      <SelectNumber
                        label="Movement speed (px/s)"
                        value={Number(params.movementSpeedPxPerSec) ?? 120}
                        onChange={(v) => setParam(id, 'movementSpeedPxPerSec', v)}
                        options={[80, 100, 120, 150, 200, 250, 300].map((n) => ({ value: n, label: `${n} px/s` }))}
                      />
                      <div>
                        <label className="block text-slate-400 text-sm mb-0.5">Stimulus shape</label>
                        <select
                          value={String(params.stimulusShape ?? 'rectangle')}
                          onChange={(e) => setParam(id, 'stimulusShape', e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
                        >
                          {STIMULUS_SHAPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-slate-400 text-sm mb-0.5">Primary rectangle color</label>
                        <RectColorPicker
                          value={params.primaryRectColor}
                          fallback="red"
                          variant="primary"
                          onChange={(v) => setParam(id, 'primaryRectColor', v)}
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 text-sm mb-0.5">Dim rectangle color</label>
                        <RectColorPicker
                          value={params.dimRectColor}
                          fallback="blue"
                          variant="dim"
                          onChange={(v) => setParam(id, 'dimRectColor', v)}
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 text-sm mb-0.5">Dim rectangle opacity</label>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-slate-500">Opacity</span>
                          <span className="font-mono text-slate-200">
                            {Math.round(
                              Math.max(
                                0,
                                Math.min(
                                  0.9,
                                  Number(params.dimRectOpacity) ?? 0.1
                                )
                              ) * 100
                            )}
                            %
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={0.9}
                          step={0.01}
                          value={Math.max(0, Math.min(0.9, Number(params.dimRectOpacity) ?? 0.1))}
                          onChange={(e) => {
                            const raw = Number(e.target.value);
                            const v = Math.max(0, Math.min(0.9, Math.round(raw * 100) / 100));
                            setParam(id, 'dimRectOpacity', v);
                          }}
                          className="w-full accent-blue-500 h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                      <SelectNumber
                        label="Fixation pause (ms)"
                        value={Number(params.fixationPauseMs) || 1000}
                        onChange={(v) => setParam(id, 'fixationPauseMs', v)}
                        options={[0, 300, 500, 750, 1000, 1500, 2000].map((n) => ({ value: n, label: n === 0 ? 'Off' : `${n} ms` }))}
                      />
                      <SelectNumber
                        label="Interval between trials (ms)"
                        value={Number(params.intervalBetweenTrialsMs) ?? 800}
                        onChange={(v) => setParam(id, 'intervalBetweenTrialsMs', v)}
                        options={[400, 600, 800, 1000, 1200, 1500, 2000, 3000].map((n) => ({ value: n, label: `${n} ms` }))}
                      />
                      <SelectNumber
                        label="Practice: delay before auto-restart (s)"
                        value={Number(params.practiceRestartDelaySec) ?? 3}
                        onChange={(v) => setParam(id, 'practiceRestartDelaySec', v)}
                        options={[1, 2, 3, 4].map((n) => ({ value: n, label: `${n} s` }))}
                      />
                      <SelectNumber
                        label="Gaze sample interval (ms)"
                        value={Number(params.gazeSampleIntervalMs) || 100}
                        onChange={(v) => setParam(id, 'gazeSampleIntervalMs', v)}
                        options={[50, 100, 150, 200, 250, 300].map((n) => ({ value: n, label: `${n} ms` }))}
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
                        options={[2, 4, 6, 8, 10, 12, 15, 18, 20, 24, 30, 36, 40].map((n) => ({ value: n, label: String(n) }))}
                      />
                      <SelectNumber
                        label="Target dot size (px)"
                        value={Number(params.targetDotSizePx) ?? 64}
                        onChange={(v) => setParam(id, 'targetDotSizePx', v)}
                        options={[32, 40, 48, 56, 64].map((n) => ({ value: n, label: `${n} px` }))}
                      />
                      <div>
                        <label className="block text-slate-400 text-sm mb-0.5">Target dot color (hex)</label>
                        <DotColorPicker
                          value={params.targetDotColor}
                          fallback="#f59e0b"
                          onChange={(v) => setParam(id, 'targetDotColor', v)}
                        />
                      </div>
                      <SelectNumber
                        label="Gaze sample interval (ms)"
                        value={Number(params.gazeSampleIntervalMs) || 100}
                        onChange={(v) => setParam(id, 'gazeSampleIntervalMs', v)}
                        options={[50, 100, 150, 200, 250, 300].map((n) => ({ value: n, label: `${n} ms` }))}
                      />
                    </>
                  )}
                  {id === 'fixation_stability' && (
                    <>
                      <SelectNumber
                        label="Duration (s)"
                        value={Number(params.durationSec) ?? 5}
                        onChange={(v) => setParam(id, 'durationSec', v)}
                        options={[5, 6, 8, 10, 12, 15].map((n) => ({ value: n, label: `${n} s` }))}
                      />
                      <SelectNumber
                        label="Blink interval (ms)"
                        value={Number(params.blinkIntervalMs) ?? 600}
                        onChange={(v) => setParam(id, 'blinkIntervalMs', v)}
                        options={[0, 300, 500, 600, 800, 1000, 1500, 2000].map((n) => ({ value: n, label: `${n} ms` }))}
                      />
                      <SelectNumber
                        label="Center dot size (px)"
                        value={Number(params.centerDotSizePx) ?? 12}
                        onChange={(v) => setParam(id, 'centerDotSizePx', v)}
                        options={[8, 10, 12, 14, 16, 20, 24, 32, 48, 64].map((n) => ({ value: n, label: `${n} px` }))}
                      />
                      <div>
                        <label className="block text-slate-400 text-sm mb-0.5">Center dot color (hex)</label>
                        <DotColorPicker
                          value={params.centerDotColor}
                          fallback="#f59e0b"
                          onChange={(v) => setParam(id, 'centerDotColor', v)}
                        />
                      </div>
                      <SelectNumber
                        label="Gaze sample interval (ms)"
                        value={Number(params.gazeSampleIntervalMs) || 100}
                        onChange={(v) => setParam(id, 'gazeSampleIntervalMs', v)}
                        options={[50, 100, 150, 200, 250, 300].map((n) => ({ value: n, label: `${n} ms` }))}
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
                        label="Center dot size (px)"
                        value={Number(params.centerDotSizePx) ?? 8}
                        onChange={(v) => setParam(id, 'centerDotSizePx', v)}
                        options={[6, 8, 10, 12, 16, 24, 32, 48, 64].map((n) => ({ value: n, label: `${n} px` }))}
                      />
                      <div>
                        <label className="block text-slate-400 text-sm mb-0.5">Center dot color (hex)</label>
                        <DotColorPicker
                          value={params.centerDotColor}
                          fallback="#f59e0b"
                          onChange={(v) => setParam(id, 'centerDotColor', v)}
                        />
                      </div>
                      <SelectNumber
                        label="Stimulus dot size (px)"
                        value={Number(params.stimulusDotSizePx) ?? 16}
                        onChange={(v) => setParam(id, 'stimulusDotSizePx', v)}
                        options={[12, 16, 20, 24, 32, 48, 64].map((n) => ({ value: n, label: `${n} px` }))}
                      />
                      <div>
                        <label className="block text-slate-400 text-sm mb-0.5">Stimulus dot color (hex)</label>
                        <DotColorPicker
                          value={params.stimulusDotColor}
                          fallback="#ffffff"
                          onChange={(v) => setParam(id, 'stimulusDotColor', v)}
                        />
                      </div>
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
                      <SelectNumber
                        label="Gaze sample interval (ms)"
                        value={Number(params.gazeSampleIntervalMs) || 100}
                        onChange={(v) => setParam(id, 'gazeSampleIntervalMs', v)}
                        options={[50, 100, 150, 200, 250, 300].map((n) => ({ value: n, label: `${n} ms` }))}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
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
        className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
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
        className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
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

function RectColorPicker({
  value,
  fallback,
  variant,
  onChange,
}: {
  value: unknown;
  fallback: AntiSaccadeRectColorToken;
  variant: 'primary' | 'dim';
  onChange: (v: AntiSaccadeRectColor) => void;
}) {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);

  const resolved = resolveAntiSaccadeRectHex(
    (value as AntiSaccadeRectColor | undefined) ?? fallback,
    variant,
    fallback
  );

  const [open, setOpen] = React.useState(false);
  const [localHex, setLocalHex] = React.useState(resolved.fillHex);

  React.useEffect(() => {
    if (!open) setLocalHex(resolved.fillHex);
  }, [resolved.fillHex, open]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = wrapperRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const hex = localHex;
  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm flex items-center justify-between gap-3"
      >
        <span className="flex items-center gap-2">
          <span className="w-4 h-4 rounded border border-slate-400" style={{ backgroundColor: hex }} />
          <span className="font-mono text-[12px] text-slate-200">{hex.toUpperCase()}</span>
        </span>
        <span className="text-slate-400 text-xs">{open ? 'Close' : 'Pick'}</span>
      </button>

      {open && (
        <div className="absolute z-30 top-full mt-2 left-0 right-0 bg-slate-900 border border-slate-700 rounded-xl p-3 shadow-xl">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-xs text-slate-300 font-semibold">
              {variant === 'primary' ? 'Primary' : 'Dim'} color
            </div>
            <div className="font-mono text-[11px] text-slate-400">{hex.toUpperCase()}</div>
          </div>
          <div className="w-full">
            <HexColorPicker color={hex} onChange={setLocalHex} />
          </div>
          <div className="flex items-center justify-between gap-3 mt-3">
            <button
              type="button"
              onClick={() => {
                setLocalHex(resolved.fillHex);
                setOpen(false);
              }}
              className="flex-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(hex as AntiSaccadeRectColor);
                setOpen(false);
              }}
              className="flex-1 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DotColorPicker({
  value,
  fallback,
  onChange,
}: {
  value: unknown;
  fallback: string;
  onChange: (v: `#${string}`) => void;
}) {
  const isHex = (v: unknown): v is `#${string}` =>
    typeof v === 'string' && /^#([0-9A-Fa-f]{6})$/.test(v.trim());

  const initial = isHex(value) ? value.trim().toLowerCase() : fallback.toLowerCase();
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = React.useState(false);
  const [localHex, setLocalHex] = React.useState(initial);

  React.useEffect(() => {
    if (!open) setLocalHex(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, open]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = wrapperRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const hex = localHex;
  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm flex items-center justify-between gap-3"
      >
        <span className="flex items-center gap-2">
          <span className="w-4 h-4 rounded border border-slate-400" style={{ backgroundColor: hex }} />
          <span className="font-mono text-[12px] text-slate-200">{hex.toUpperCase()}</span>
        </span>
        <span className="text-slate-400 text-xs">{open ? 'Close' : 'Pick'}</span>
      </button>

      {open && (
        <div className="absolute z-30 top-full mt-2 left-0 right-0 bg-slate-900 border border-slate-700 rounded-xl p-3 shadow-xl">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-xs text-slate-300 font-semibold">Dot color</div>
            <div className="font-mono text-[11px] text-slate-400">{hex.toUpperCase()}</div>
          </div>
          <div className="w-full">
            <HexColorPicker color={hex} onChange={setLocalHex} />
          </div>
          <div className="flex items-center justify-between gap-3 mt-3">
            <button
              type="button"
              onClick={() => {
                setLocalHex(initial);
                setOpen(false);
              }}
              className="flex-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(hex as `#${string}`);
                setOpen(false);
              }}
              className="flex-1 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
