
import React, { useState } from 'react';
import { AppConfig, RegressionMethod, SmoothingMethod, OutlierMethod, CalibrationMethod, DEFAULT_CONFIG } from '../types';

interface SettingsModalProps {
  config: AppConfig;
  onSave: (newConfig: AppConfig) => void;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ config, onSave, onClose }) => {
  const [localConfig, setLocalConfig] = React.useState<AppConfig>(config);
  const [activeTab, setActiveTab] = useState<'GENERAL' | 'SMOOTHING' | 'DATA' | 'RECORDING'>('GENERAL');

  const handleChange = (key: keyof AppConfig, value: any) => {
    setLocalConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleReset = () => {
    setLocalConfig(DEFAULT_CONFIG);
  };

  return (
    <div className="fixed inset-0 z-[300] bg-black bg-opacity-80 flex items-center justify-center backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-6 pb-2 border-b border-gray-800">
          <h2 className="text-xl font-bold text-white flex justify-between items-center">
            <span>Configuration</span>
            <button onClick={handleReset} className="text-xs text-blue-400 hover:text-blue-300 underline">
              Reset Defaults
            </button>
          </h2>
          {/* Tabs */}
          <div className="flex space-x-4 mt-6 overflow-x-auto">
            <button onClick={() => setActiveTab('GENERAL')} className={`pb-2 text-sm font-bold border-b-2 transition whitespace-nowrap ${activeTab === 'GENERAL' ? 'text-white border-blue-500' : 'text-gray-500 border-transparent hover:text-gray-300'}`}>General</button>
            <button onClick={() => setActiveTab('RECORDING')} className={`pb-2 text-sm font-bold border-b-2 transition whitespace-nowrap ${activeTab === 'RECORDING' ? 'text-white border-blue-500' : 'text-gray-500 border-transparent hover:text-gray-300'}`}>Recording</button>
            <button onClick={() => setActiveTab('SMOOTHING')} className={`pb-2 text-sm font-bold border-b-2 transition whitespace-nowrap ${activeTab === 'SMOOTHING' ? 'text-white border-blue-500' : 'text-gray-500 border-transparent hover:text-gray-300'}`}>Smoothing</button>
            <button onClick={() => setActiveTab('DATA')} className={`pb-2 text-sm font-bold border-b-2 transition whitespace-nowrap ${activeTab === 'DATA' ? 'text-white border-blue-500' : 'text-gray-500 border-transparent hover:text-gray-300'}`}>Data Hygiene</button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto flex-1">
          <div className="space-y-6">
            
            {/* --- GENERAL TAB --- */}
            {activeTab === 'GENERAL' && (
              <>
                 <div className="bg-gray-800 p-3 rounded-lg space-y-4 border border-gray-700">
                     <div className="flex justify-between items-center"><span className="text-xs font-bold text-green-300">Calibration Method</span></div>
                     
                     <div className="flex space-x-2">
                         <button 
                            onClick={() => handleChange('calibrationMethod', CalibrationMethod.TIMER)}
                            className={`flex-1 py-2 text-xs font-bold rounded border ${localConfig.calibrationMethod === CalibrationMethod.TIMER ? 'bg-blue-600 border-blue-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}
                         >
                             Auto Timer
                         </button>
                         <button 
                            onClick={() => handleChange('calibrationMethod', CalibrationMethod.CLICK_HOLD)}
                            className={`flex-1 py-2 text-xs font-bold rounded border ${localConfig.calibrationMethod === CalibrationMethod.CLICK_HOLD ? 'bg-blue-600 border-blue-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}
                         >
                             Click & Hold
                         </button>
                     </div>

                     {localConfig.calibrationMethod === CalibrationMethod.CLICK_HOLD && (
                         <div className="pt-2 border-t border-gray-700">
                            <div className="flex justify-between text-xs mb-1"><span className="text-gray-400">Click Duration (Seconds)</span><span className="font-mono">{localConfig.clickDuration}s</span></div>
                            <input type="range" min="0.5" max="3.0" step="0.1" value={localConfig.clickDuration} onChange={(e) => handleChange('clickDuration', parseFloat(e.target.value))} className="w-full accent-green-500 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"/>
                            <p className="text-[9px] text-gray-500 mt-1">Hold the mouse on the dot for this long. First/last 20% of frames are discarded.</p>
                         </div>
                     )}

                     {localConfig.calibrationMethod === CalibrationMethod.TIMER && (
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Calibration Speed</label>
                            <div className="flex space-x-2">
                                {['FAST', 'NORMAL', 'SLOW'].map((speed) => (
                                    <button
                                        key={speed}
                                        onClick={() => handleChange('calibrationSpeed', speed)}
                                        className={`flex-1 py-2 text-xs font-bold rounded border ${localConfig.calibrationSpeed === speed ? 'bg-blue-600 border-blue-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}
                                    >
                                        {speed}
                                    </button>
                                ))}
                            </div>
                        </div>
                     )}
                 </div>

                 <div className="bg-gray-800 p-3 rounded-lg space-y-4 border border-gray-700">
                     <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-300">Setup Distance</span></div>
                     <div>
                        <div className="flex justify-between text-xs mb-1"><span className="text-gray-400">Distance to Screen (cm)</span><span className="font-mono">{localConfig.faceDistance} cm</span></div>
                        <input type="range" min="40" max="90" step="5" value={localConfig.faceDistance} onChange={(e) => handleChange('faceDistance', parseInt(e.target.value))} className="w-full accent-gray-500 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"/>
                     </div>
                 </div>

                <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Mapping Algorithm</label>
                    <select 
                    value={localConfig.regressionMethod}
                    onChange={(e) => handleChange('regressionMethod', e.target.value)}
                    className="w-full bg-gray-800 text-white rounded p-2 text-sm border border-gray-700 focus:border-blue-500 outline-none"
                    >
                    <option value={RegressionMethod.TPS}>Thin Plate Splines (TPS) - Best Accuracy</option>
                    <option value={RegressionMethod.HYBRID}>Hybrid (Ridge + kNN)</option>
                    <option value={RegressionMethod.RIDGE}>Ridge Regression (Global Only)</option>
                    </select>
                </div>
              </>
            )}

            {/* --- RECORDING TAB --- */}
            {activeTab === 'RECORDING' && (
              <>
                 <div className="bg-red-900 bg-opacity-20 p-3 rounded border border-red-800 mb-4">
                    <p className="text-[10px] text-red-200">
                        Recording starts automatically when Tracking begins.
                    </p>
                 </div>

                 <div className="space-y-4">
                     {/* Toggle Video Recording */}
                     <div className="flex items-center justify-between bg-gray-800 p-3 rounded-lg border border-gray-700">
                        <div>
                            <div className="text-sm font-bold text-white">Full Session Video</div>
                            <div className="text-[10px] text-gray-400">Record entire tracking session (WebM)</div>
                        </div>
                        <button 
                            onClick={() => handleChange('enableVideoRecording', !localConfig.enableVideoRecording)}
                            className={`w-12 h-6 rounded-full transition-colors relative ${localConfig.enableVideoRecording ? 'bg-green-500' : 'bg-gray-600'}`}
                        >
                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${localConfig.enableVideoRecording ? 'left-7' : 'left-1'}`}></div>
                        </button>
                     </div>

                     {/* Face Capture Interval */}
                     <div className="bg-gray-800 p-3 rounded-lg space-y-4 border border-gray-700">
                        <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-white">Periodic Face Capture</span>
                        </div>
                        <div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-gray-400">Capture Interval</span>
                                <span className="font-mono">{localConfig.faceCaptureInterval === 0 ? 'OFF' : `${localConfig.faceCaptureInterval}s`}</span>
                            </div>
                            <input 
                                type="range" 
                                min="0" 
                                max="30" 
                                step="1" 
                                value={localConfig.faceCaptureInterval} 
                                onChange={(e) => handleChange('faceCaptureInterval', parseInt(e.target.value))} 
                                className="w-full accent-blue-500 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                            />
                            <p className="text-[9px] text-gray-500 mt-1">Set to 0s to disable auto-capture.</p>
                        </div>
                     </div>
                 </div>
              </>
            )}

            {/* --- SMOOTHING TAB --- */}
            {activeTab === 'SMOOTHING' && (
              <>
                <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Filter Type</label>
                    <select 
                    value={localConfig.smoothingMethod}
                    onChange={(e) => handleChange('smoothingMethod', e.target.value)}
                    className="w-full bg-gray-800 text-white rounded p-2 text-sm border border-gray-700 focus:border-blue-500 outline-none"
                    >
                    <option value={SmoothingMethod.ONE_EURO}>1€ Filter (Adaptive)</option>
                    <option value={SmoothingMethod.MOVING_AVERAGE}>Moving Average (Simple)</option>
                    <option value={SmoothingMethod.KALMAN}>Kalman Filter (Predictive)</option>
                    <option value={SmoothingMethod.NONE}>None (Raw Data)</option>
                    </select>
                </div>

                {/* SACCADE DETECTION SETTING */}
                 <div className="bg-gray-800 p-3 rounded-lg space-y-4 border border-gray-700">
                    <div className="flex justify-between items-center"><span className="text-xs font-bold text-orange-300">Saccade Detection</span></div>
                    <div>
                        <div className="flex justify-between text-xs mb-1"><span className="text-gray-400">Jump Threshold (px)</span><span className="font-mono">{localConfig.saccadeThreshold}px</span></div>
                        <input type="range" min="10" max="200" step="10" value={localConfig.saccadeThreshold} onChange={(e) => handleChange('saccadeThreshold', parseInt(e.target.value))} className="w-full accent-orange-500 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"/>
                        <p className="text-[9px] text-gray-500 mt-1">If eye jumps further than this, smoothing is temporarily disabled to reduce lag.</p>
                    </div>
                </div>

                {localConfig.smoothingMethod === SmoothingMethod.ONE_EURO && (
                    <div className="bg-gray-800 p-3 rounded-lg space-y-4 border border-gray-700">
                      <div className="flex justify-between items-center"><span className="text-xs font-bold text-blue-300">1€ Configuration</span></div>
                      <div>
                        <div className="flex justify-between text-xs mb-1"><span className="text-gray-400">Jitter Reduction (MinCutoff)</span><span className="font-mono">{localConfig.minCutoff}</span></div>
                        <input type="range" min="0.001" max="0.1" step="0.001" value={localConfig.minCutoff} onChange={(e) => handleChange('minCutoff', parseFloat(e.target.value))} className="w-full accent-blue-500 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"/>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1"><span className="text-gray-400">Speed Response (Beta)</span><span className="font-mono">{localConfig.beta}</span></div>
                        <input type="range" min="0.001" max="0.1" step="0.001" value={localConfig.beta} onChange={(e) => handleChange('beta', parseFloat(e.target.value))} className="w-full accent-blue-500 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"/>
                      </div>
                    </div>
                )}

                {localConfig.smoothingMethod === SmoothingMethod.MOVING_AVERAGE && (
                    <div className="bg-gray-800 p-3 rounded-lg space-y-4 border border-gray-700">
                        <div className="flex justify-between items-center"><span className="text-xs font-bold text-blue-300">Moving Average Config</span></div>
                         <div>
                            <div className="flex justify-between text-xs mb-1"><span className="text-gray-400">Window Size (Frames)</span><span className="font-mono">{localConfig.maWindow}</span></div>
                            <input type="range" min="2" max="20" step="1" value={localConfig.maWindow} onChange={(e) => handleChange('maWindow', parseInt(e.target.value))} className="w-full accent-blue-500 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"/>
                            <p className="text-[9px] text-gray-500 mt-1">Larger window = Smoother but slower.</p>
                         </div>
                    </div>
                )}

                {localConfig.smoothingMethod === SmoothingMethod.KALMAN && (
                    <div className="bg-gray-800 p-3 rounded-lg space-y-4 border border-gray-700">
                        <div className="flex justify-between items-center"><span className="text-xs font-bold text-blue-300">Kalman Config</span></div>
                        <div>
                            <div className="flex justify-between text-xs mb-1"><span className="text-gray-400">Process Noise (Q)</span><span className="font-mono">{localConfig.kalmanQ}</span></div>
                            <input type="range" min="0.001" max="0.1" step="0.001" value={localConfig.kalmanQ} onChange={(e) => handleChange('kalmanQ', parseFloat(e.target.value))} className="w-full accent-blue-500 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"/>
                            <p className="text-[9px] text-gray-500 mt-1">Sensitivity to movement.</p>
                        </div>
                         <div>
                            <div className="flex justify-between text-xs mb-1"><span className="text-gray-400">Measurement Noise (R)</span><span className="font-mono">{localConfig.kalmanR}</span></div>
                            <input type="range" min="0.01" max="1.0" step="0.01" value={localConfig.kalmanR} onChange={(e) => handleChange('kalmanR', parseFloat(e.target.value))} className="w-full accent-blue-500 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"/>
                            <p className="text-[9px] text-gray-500 mt-1">Higher = Treats sensor as noisy (Smoother).</p>
                        </div>
                    </div>
                )}
              </>
            )}

            {/* --- DATA HYGIENE TAB --- */}
            {activeTab === 'DATA' && (
              <>
                 <div className="bg-blue-900 bg-opacity-20 p-3 rounded border border-blue-800 mb-4">
                    <p className="text-[10px] text-blue-200">
                        Data Hygiene filters bad data during calibration. For example, if you look away or blink, this removes that data.
                    </p>
                 </div>

                 <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Outlier Removal Method</label>
                    <select 
                    value={localConfig.outlierMethod}
                    onChange={(e) => handleChange('outlierMethod', e.target.value)}
                    className="w-full bg-gray-800 text-white rounded p-2 text-sm border border-gray-700 focus:border-blue-500 outline-none"
                    >
                    <option value={OutlierMethod.TRIM_TAILS}>Trim Tails (Cut top/bottom %)</option>
                    <option value={OutlierMethod.STD_DEV}>Standard Deviation (Statistical)</option>
                    <option value={OutlierMethod.NONE}>None (Use all data)</option>
                    </select>
                </div>

                {localConfig.outlierMethod === OutlierMethod.TRIM_TAILS && (
                    <div className="bg-gray-800 p-3 rounded-lg space-y-4 border border-gray-700">
                         <div>
                            <div className="flex justify-between text-xs mb-1"><span className="text-gray-400">Trim Amount (per end)</span><span className="font-mono">{(localConfig.outlierThreshold * 100).toFixed(0)}%</span></div>
                            <input type="range" min="0.0" max="0.45" step="0.05" value={localConfig.outlierThreshold} onChange={(e) => handleChange('outlierThreshold', parseFloat(e.target.value))} className="w-full accent-blue-500 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"/>
                            <p className="text-[9px] text-gray-500 mt-1">E.g., 25% means discarding the lowest 25% and highest 25% of values.</p>
                         </div>
                    </div>
                )}

                {localConfig.outlierMethod === OutlierMethod.STD_DEV && (
                    <div className="bg-gray-800 p-3 rounded-lg space-y-4 border border-gray-700">
                         <div>
                            <div className="flex justify-between text-xs mb-1"><span className="text-gray-400">Sigma Threshold</span><span className="font-mono">{localConfig.outlierThreshold}</span></div>
                            <input type="range" min="0.5" max="3.0" step="0.1" value={localConfig.outlierThreshold} onChange={(e) => handleChange('outlierThreshold', parseFloat(e.target.value))} className="w-full accent-blue-500 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"/>
                            <p className="text-[9px] text-gray-500 mt-1">Lower = Stricter (Removes more data). Standard is 2.0.</p>
                         </div>
                    </div>
                )}
              </>
            )}

          </div>
        </div>

        {/* Footer */}
        <div className="p-6 pt-2 border-t border-gray-800 flex space-x-3 bg-gray-900">
          <button 
            onClick={onClose} 
            className="flex-1 py-3 text-sm font-bold bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition"
          >
            Cancel
          </button>
          <button 
            onClick={() => onSave(localConfig)} 
            className="flex-1 py-3 text-sm font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-500 shadow-lg transition"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
