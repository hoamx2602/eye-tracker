'use client';

import React from 'react';
import { TrackingMode } from '../types';

type TrackingToolbarProps = {
  isRecording: boolean;
  trackingMode: TrackingMode;
  onTrackingModeChange: (mode: TrackingMode) => void;
  showHeatmap: boolean;
  onToggleHeatmap: () => void;
  canToggleHeatmap: boolean;
  onClearHeatmap: () => void;
  canClearHeatmap: boolean;
  onStopSave: () => void;
};

function TrackingToolbar({
  isRecording,
  trackingMode,
  onTrackingModeChange,
  showHeatmap,
  onToggleHeatmap,
  canToggleHeatmap,
  onClearHeatmap,
  canClearHeatmap,
  onStopSave,
}: TrackingToolbarProps) {
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-2 bg-gray-900 bg-opacity-90 p-2 rounded-lg border border-gray-700 shadow-xl">
      {/* REC INDICATOR */}
      {isRecording && (
        <div className="flex items-center space-x-1.5 px-2 flex-shrink-0">
          <div className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse shadow-[0_0_8px_red]"></div>
          <span className="text-[10px] font-bold text-red-200">REC</span>
        </div>
      )}
      <div className="w-px h-6 bg-gray-700 flex-shrink-0" />

      {/* MODE SELECTOR — fixed width buttons to prevent text jump */}
      <div className="flex items-center bg-gray-800 rounded-md p-0.5 flex-shrink-0">
        <button
          onClick={() => onTrackingModeChange('free_gaze')}
          className={`w-[4.75rem] py-1.5 text-xs font-bold rounded transition-colors ${
            trackingMode === 'free_gaze'
              ? 'bg-blue-600 text-white shadow'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          Free Gaze
        </button>
        <button
          onClick={() => onTrackingModeChange('random_dots')}
          className={`w-[4.25rem] py-1.5 text-xs font-bold rounded transition-colors ${
            trackingMode === 'random_dots'
              ? 'bg-emerald-600 text-white shadow'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          Dot Test
        </button>
        <button
          onClick={() => onTrackingModeChange('article_reading')}
          className={`w-[4rem] py-1.5 text-xs font-bold rounded transition-colors ${
            trackingMode === 'article_reading'
              ? 'bg-purple-600 text-white shadow'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          Article
        </button>
      </div>
      <div className="w-px h-6 bg-gray-700 flex-shrink-0" />

      {/* HEATMAP SWITCHER — always visible; enabled only when Free Gaze */}
      <div className="flex items-center gap-2 min-w-[11rem] flex-shrink-0">
        <span
          className={`text-xs font-medium whitespace-nowrap ${
            canToggleHeatmap ? 'text-gray-300' : 'text-gray-500'
          }`}
        >
          Heatmap
        </span>
        <button
          role="switch"
          aria-checked={showHeatmap}
          onClick={canToggleHeatmap ? onToggleHeatmap : undefined}
          disabled={!canToggleHeatmap}
          className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900
            ${
              !canToggleHeatmap
                ? 'cursor-not-allowed bg-gray-700 opacity-50'
                : showHeatmap
                  ? 'bg-orange-600'
                  : 'bg-gray-600 hover:bg-gray-500'
            }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5 ${
              showHeatmap ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
        <button
          onClick={canClearHeatmap ? onClearHeatmap : undefined}
          disabled={!canClearHeatmap}
          className={`px-3 py-1 text-xs font-bold rounded-md flex-shrink-0 transition-colors ${
            canClearHeatmap
              ? 'bg-gray-700 text-gray-300 hover:bg-red-900 hover:text-white cursor-pointer'
              : 'bg-gray-700 text-gray-500 opacity-50 cursor-not-allowed'
          }`}
        >
          Clear
        </button>
      </div>
      <div className="w-px h-6 bg-gray-700 flex-shrink-0" />

      <button
        onClick={onStopSave}
        className="px-4 py-1.5 text-xs font-bold rounded-md bg-gray-800 border border-gray-600 hover:bg-gray-700 transition text-red-300 flex-shrink-0"
      >
        Stop
      </button>
    </div>
  );
}

export default TrackingToolbar;

