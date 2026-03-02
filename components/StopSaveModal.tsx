'use client';

import React, { useState } from 'react';

interface StopSaveModalProps {
  hasCsvData: boolean;
  hasVideo: boolean;
  hasImages: boolean;
  onConfirm: (options: { csv: boolean; video: boolean; images: boolean }) => void;
  onCancel: () => void;
}

const StopSaveModal: React.FC<StopSaveModalProps> = ({
  hasCsvData,
  hasVideo,
  hasImages,
  onConfirm,
  onCancel,
}) => {
  const [csv, setCsv] = useState(true);
  const [video, setVideo] = useState(true);
  const [images, setImages] = useState(true);

  const handleConfirm = () => {
    onConfirm({
      csv: hasCsvData && csv,
      video: hasVideo && video,
      images: hasImages && images,
    });
  };

  const anyOption = hasCsvData || hasVideo || hasImages;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60">
      <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
        <h2 className="text-lg font-bold text-white mb-1">Stop & Save</h2>
        <p className="text-gray-400 text-sm mb-4">Download before leaving?</p>

        <div className="space-y-3 mb-6">
          {hasCsvData && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={csv}
                onChange={(e) => setCsv(e.target.checked)}
                className="w-4 h-4 rounded border-gray-500 bg-slate-700 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-200">Gaze data (CSV)</span>
            </label>
          )}
          {hasVideo && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={video}
                onChange={(e) => setVideo(e.target.checked)}
                className="w-4 h-4 rounded border-gray-500 bg-slate-700 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-200">Video recording</span>
            </label>
          )}
          {hasImages && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={images}
                onChange={(e) => setImages(e.target.checked)}
                className="w-4 h-4 rounded border-gray-500 bg-slate-700 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-200">Captured images</span>
            </label>
          )}
          {!anyOption && (
            <p className="text-gray-500 text-sm">No data to download.</p>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
          >
            Stop & Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default StopSaveModal;
