'use client';

import React, { useState, useEffect } from 'react';
import {
  AppConfig,
  RegressionMethod,
  SmoothingMethod,
  ChartSmoothingMethod,
  OutlierMethod,
  CalibrationMethod,
  DEFAULT_CONFIG,
} from '@/types';

export default function AppConfigForm() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [localConfig, setLocalConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [activeTab, setActiveTab] = useState<'GENERAL' | 'SMOOTHING' | 'DATA' | 'RECORDING'>('GENERAL');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/app-config', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();
        if (cancelled) return;
        const cfg = { ...DEFAULT_CONFIG, ...(data.config ?? {}) } as AppConfig;
        setConfig(cfg);
        setLocalConfig(cfg);
      } catch (e) {
        if (!cancelled) {
          setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Load failed' });
          setLocalConfig(DEFAULT_CONFIG);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleChange = (key: keyof AppConfig, value: unknown) => {
    setLocalConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleReset = () => {
    setLocalConfig(DEFAULT_CONFIG);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/app-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(localConfig),
      });
      if (!res.ok) throw new Error('Save failed');
      setConfig(localConfig);
      setMessage({ type: 'success', text: 'Saved. App will use this config on next load.' });
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  if (config === null && !message) {
    return (
      <div className="text-slate-400 py-8">Loading app config…</div>
    );
  }

  return (
    <div className="space-y-6">
      {message && (
        <p className={`text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-700 pb-4">
        <div className="flex flex-wrap gap-2">
          {(['GENERAL', 'RECORDING', 'SMOOTHING', 'DATA'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-semibold rounded-lg border transition ${
                activeTab === tab
                  ? 'bg-slate-600 border-slate-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {tab === 'GENERAL' && 'General'}
              {tab === 'RECORDING' && 'Recording'}
              {tab === 'SMOOTHING' && 'Smoothing'}
              {tab === 'DATA' && 'Data Hygiene'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleReset}
            className="text-sm text-slate-400 hover:text-slate-200 underline"
          >
            Reset defaults
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-lg transition"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {activeTab === 'GENERAL' && (
          <>
            <section className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-4">
              <h3 className="text-sm font-bold text-green-300">Calibration method</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleChange('calibrationMethod', CalibrationMethod.TIMER)}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg border ${
                    localConfig.calibrationMethod === CalibrationMethod.TIMER
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-slate-800 border-slate-600 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  Auto timer
                </button>
                <button
                  type="button"
                  onClick={() => handleChange('calibrationMethod', CalibrationMethod.CLICK_HOLD)}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg border ${
                    localConfig.calibrationMethod === CalibrationMethod.CLICK_HOLD
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-slate-800 border-slate-600 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  Click & hold
                </button>
              </div>
              {localConfig.calibrationMethod === CalibrationMethod.CLICK_HOLD && (
                <div className="pt-2 border-t border-slate-700">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">Click duration (s)</span>
                    <span className="font-mono">{localConfig.clickDuration}s</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="3"
                    step="0.1"
                    value={localConfig.clickDuration}
                    onChange={(e) => handleChange('clickDuration', parseFloat(e.target.value))}
                    className="w-full accent-green-500 h-1 bg-slate-600 rounded-lg"
                  />
                </div>
              )}
              {localConfig.calibrationMethod === CalibrationMethod.TIMER && (
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Calibration speed</label>
                  <div className="flex gap-2">
                    {(['FAST', 'NORMAL', 'SLOW'] as const).map((speed) => (
                      <button
                        key={speed}
                        type="button"
                        onClick={() => handleChange('calibrationSpeed', speed)}
                        className={`flex-1 py-2 text-xs font-bold rounded-lg border ${
                          localConfig.calibrationSpeed === speed
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-slate-800 border-slate-600 text-slate-400 hover:bg-slate-700'
                        }`}
                      >
                        {speed}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="pt-2 border-t border-slate-700">
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-slate-400">Calibration points</span>
                  <span className="font-mono">{localConfig.calibrationPointsCount}</span>
                </div>
                <div className="flex gap-2 mb-2">
                  {[9, 16, 20, 52].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => handleChange('calibrationPointsCount', count)}
                      className={`flex-1 py-1.5 text-xs font-bold rounded border ${
                        localConfig.calibrationPointsCount === count
                          ? 'bg-purple-600 border-purple-600 text-white'
                          : 'bg-slate-700 border-slate-600 text-slate-300'
                      }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min="5"
                  max="134"
                  step="1"
                  value={localConfig.calibrationPointsCount}
                  onChange={(e) => handleChange('calibrationPointsCount', parseInt(e.target.value, 10))}
                  className="w-full accent-purple-500 h-1 bg-slate-600 rounded-lg"
                />
              </div>
            </section>

            <section className="flex items-center justify-between bg-slate-800/50 rounded-xl border border-slate-700 p-4">
              <div>
                <div className="font-semibold text-white">Eye movement exercises</div>
                <div className="text-xs text-slate-400">Extra patterns after grid for higher accuracy</div>
              </div>
              <button
                type="button"
                onClick={() => handleChange('enableExercises', !localConfig.enableExercises)}
                className={`relative w-12 h-6 rounded-full transition ${localConfig.enableExercises ? 'bg-cyan-500' : 'bg-slate-600'}`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${localConfig.enableExercises ? 'left-7' : 'left-1'}`}
                />
              </button>
            </section>

            <section className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-4">
              <h3 className="text-sm font-bold text-slate-300">Setup distance</h3>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Distance to screen (cm)</span>
                  <span className="font-mono">{localConfig.faceDistance} cm</span>
                </div>
                <input
                  type="range"
                  min="40"
                  max="90"
                  step="5"
                  value={localConfig.faceDistance}
                  onChange={(e) => handleChange('faceDistance', parseInt(e.target.value, 10))}
                  className="w-full accent-slate-500 h-1 bg-slate-600 rounded-lg"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Camera FOV (face size)</span>
                  <span className="font-mono">{localConfig.faceWidthScale.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="1"
                  step="0.05"
                  value={localConfig.faceWidthScale}
                  onChange={(e) => handleChange('faceWidthScale', parseFloat(e.target.value))}
                  className="w-full accent-slate-500 h-1 bg-slate-600 rounded-lg"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Distance tolerance (×)</span>
                  <span className="font-mono">×{(localConfig.headDistanceTolerance ?? 2).toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.25}
                  value={localConfig.headDistanceTolerance ?? 2}
                  onChange={(e) => handleChange('headDistanceTolerance', parseFloat(e.target.value))}
                  className="w-full accent-slate-500 h-1 bg-slate-600 rounded-lg"
                />
              </div>
            </section>

            <section>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Mapping algorithm</label>
              <select
                value={localConfig.regressionMethod}
                onChange={(e) => handleChange('regressionMethod', e.target.value)}
                className="w-full bg-slate-800 text-white rounded-lg px-3 py-2 text-sm border border-slate-600"
              >
                <option value={RegressionMethod.TPS}>Thin Plate Splines (TPS)</option>
                <option value={RegressionMethod.HYBRID}>Hybrid (Ridge + kNN)</option>
                <option value={RegressionMethod.RIDGE}>Ridge regression</option>
              </select>
            </section>
          </>
        )}

        {activeTab === 'RECORDING' && (
          <>
            <section className="flex items-center justify-between bg-slate-800/50 rounded-xl border border-slate-700 p-4">
              <div>
                <div className="font-semibold text-white">Full session video</div>
                <div className="text-xs text-slate-400">Record entire tracking (WebM)</div>
              </div>
              <button
                type="button"
                onClick={() => handleChange('enableVideoRecording', !localConfig.enableVideoRecording)}
                className={`relative w-12 h-6 rounded-full transition ${localConfig.enableVideoRecording ? 'bg-green-500' : 'bg-slate-600'}`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${localConfig.enableVideoRecording ? 'left-7' : 'left-1'}`}
                />
              </button>
            </section>
            <section className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-400">Face capture interval</span>
                <span className="font-mono">{localConfig.faceCaptureInterval === 0 ? 'OFF' : `${localConfig.faceCaptureInterval}s`}</span>
              </div>
              <input
                type="range"
                min={0}
                max={30}
                step={1}
                value={localConfig.faceCaptureInterval}
                onChange={(e) => handleChange('faceCaptureInterval', parseInt(e.target.value, 10))}
                className="w-full accent-blue-500 h-1 bg-slate-600 rounded-lg"
              />
            </section>
          </>
        )}

        {activeTab === 'SMOOTHING' && (
          <>
            <section>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Filter type</label>
              <select
                value={localConfig.smoothingMethod}
                onChange={(e) => handleChange('smoothingMethod', e.target.value)}
                className="w-full bg-slate-800 text-white rounded-lg px-3 py-2 text-sm border border-slate-600"
              >
                <option value={SmoothingMethod.ONE_EURO}>1€ filter</option>
                <option value={SmoothingMethod.MOVING_AVERAGE}>Moving average</option>
                <option value={SmoothingMethod.KALMAN}>Kalman</option>
                <option value={SmoothingMethod.NONE}>None</option>
              </select>
            </section>
            <section className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-400">Saccade jump threshold (px)</span>
                <span className="font-mono">{localConfig.saccadeThreshold}px</span>
              </div>
              <input
                type="range"
                min={10}
                max={200}
                step={10}
                value={localConfig.saccadeThreshold}
                onChange={(e) => handleChange('saccadeThreshold', parseInt(e.target.value, 10))}
                className="w-full accent-orange-500 h-1 bg-slate-600 rounded-lg"
              />
            </section>
            {localConfig.smoothingMethod === SmoothingMethod.ONE_EURO && (
              <section className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-4">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">MinCutoff</span>
                  <span className="font-mono">{localConfig.minCutoff}</span>
                </div>
                <input
                  type="range"
                  min={0.001}
                  max={0.1}
                  step={0.001}
                  value={localConfig.minCutoff}
                  onChange={(e) => handleChange('minCutoff', parseFloat(e.target.value))}
                  className="w-full accent-blue-500 h-1 bg-slate-600 rounded-lg"
                />
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Beta</span>
                  <span className="font-mono">{localConfig.beta}</span>
                </div>
                <input
                  type="range"
                  min={0.001}
                  max={0.1}
                  step={0.001}
                  value={localConfig.beta}
                  onChange={(e) => handleChange('beta', parseFloat(e.target.value))}
                  className="w-full accent-blue-500 h-1 bg-slate-600 rounded-lg"
                />
              </section>
            )}
            {localConfig.smoothingMethod === SmoothingMethod.MOVING_AVERAGE && (
              <section className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Window size</span>
                  <span className="font-mono">{localConfig.maWindow}</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={20}
                  step={1}
                  value={localConfig.maWindow}
                  onChange={(e) => handleChange('maWindow', parseInt(e.target.value, 10))}
                  className="w-full accent-blue-500 h-1 bg-slate-600 rounded-lg"
                />
              </section>
            )}
            {localConfig.smoothingMethod === SmoothingMethod.KALMAN && (
              <section className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-4">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Kalman Q</span>
                  <span className="font-mono">{localConfig.kalmanQ}</span>
                </div>
                <input
                  type="range"
                  min={0.001}
                  max={0.1}
                  step={0.001}
                  value={localConfig.kalmanQ}
                  onChange={(e) => handleChange('kalmanQ', parseFloat(e.target.value))}
                  className="w-full accent-blue-500 h-1 bg-slate-600 rounded-lg"
                />
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Kalman R</span>
                  <span className="font-mono">{localConfig.kalmanR}</span>
                </div>
                <input
                  type="range"
                  min={0.01}
                  max={1}
                  step={0.01}
                  value={localConfig.kalmanR}
                  onChange={(e) => handleChange('kalmanR', parseFloat(e.target.value))}
                  className="w-full accent-blue-500 h-1 bg-slate-600 rounded-lg"
                />
              </section>
            )}
            <section className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-4">
              <h3 className="text-sm font-bold text-slate-300">Chart smoothing (results page)</h3>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Algorithm</label>
                <select
                  value={localConfig.chartSmoothingMethod ?? ChartSmoothingMethod.MOVING_AVERAGE}
                  onChange={(e) => handleChange('chartSmoothingMethod', e.target.value)}
                  className="w-full bg-slate-800 text-white rounded-lg px-3 py-2 text-sm border border-slate-600"
                >
                  <option value={ChartSmoothingMethod.MOVING_AVERAGE}>Moving average</option>
                  <option value={ChartSmoothingMethod.GAUSSIAN}>Gaussian</option>
                  <option value={ChartSmoothingMethod.NONE}>None (raw)</option>
                </select>
              </div>
              {(localConfig.chartSmoothingMethod ?? ChartSmoothingMethod.MOVING_AVERAGE) !== ChartSmoothingMethod.NONE && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">Window size (frames)</span>
                    <span className="font-mono">{localConfig.chartSmoothingWindow ?? 7}</span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={30}
                    step={1}
                    value={localConfig.chartSmoothingWindow ?? 7}
                    onChange={(e) => handleChange('chartSmoothingWindow', parseInt(e.target.value, 10))}
                    className="w-full accent-violet-500 h-1 bg-slate-600 rounded-lg"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Smoothing is applied only to the gaze signal on the results charts. Raw data is never modified.
                  </p>
                </div>
              )}
            </section>
          </>
        )}

        {activeTab === 'DATA' && (
          <>
            <section>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Outlier removal</label>
              <select
                value={localConfig.outlierMethod}
                onChange={(e) => handleChange('outlierMethod', e.target.value)}
                className="w-full bg-slate-800 text-white rounded-lg px-3 py-2 text-sm border border-slate-600"
              >
                <option value={OutlierMethod.TRIM_TAILS}>Trim tails</option>
                <option value={OutlierMethod.STD_DEV}>Standard deviation</option>
                <option value={OutlierMethod.NONE}>None</option>
              </select>
            </section>
            {(localConfig.outlierMethod === OutlierMethod.TRIM_TAILS || localConfig.outlierMethod === OutlierMethod.STD_DEV) && (
              <section className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Threshold</span>
                  <span className="font-mono">
                    {localConfig.outlierMethod === OutlierMethod.TRIM_TAILS
                      ? `${(localConfig.outlierThreshold * 100).toFixed(0)}%`
                      : localConfig.outlierThreshold}
                  </span>
                </div>
                <input
                  type="range"
                  min={localConfig.outlierMethod === OutlierMethod.STD_DEV ? 0.5 : 0}
                  max={localConfig.outlierMethod === OutlierMethod.STD_DEV ? 3 : 0.45}
                  step={localConfig.outlierMethod === OutlierMethod.STD_DEV ? 0.1 : 0.05}
                  value={localConfig.outlierThreshold}
                  onChange={(e) => handleChange('outlierThreshold', parseFloat(e.target.value))}
                  className="w-full accent-blue-500 h-1 bg-slate-600 rounded-lg"
                />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
