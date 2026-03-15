'use client';

import React from 'react';
import type { HeadValidationResult } from '../services/eyeTrackingService';

type HeadPositioningScreenProps = {
  headPosCanvasRef: React.RefObject<HTMLCanvasElement>;
  headValidation: HeadValidationResult | null;
  positionHoldTime: number | null;
  stableFrameCount: number;
};

function HeadPositioningScreen({
  headPosCanvasRef,
  headValidation,
  positionHoldTime,
  stableFrameCount,
}: HeadPositioningScreenProps) {
  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h2 className="text-xl font-bold text-white uppercase tracking-widest">Head Positioning</h2>
        <p className="text-sm text-gray-500 mt-1">Center your face inside the box</p>
      </div>

      <div className="relative w-full max-w-3xl aspect-video rounded-2xl overflow-hidden border-2 border-gray-700 bg-black shadow-2xl">
        <canvas ref={headPosCanvasRef} className="w-full h-full" />

        {positionHoldTime != null && positionHoldTime > 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30">
            <div className="text-8xl font-black text-white drop-shadow-lg animate-pulse">
              {Math.ceil(positionHoldTime / 1000)}
            </div>
          </div>
        )}
      </div>

      <div className="text-center bg-gray-900 bg-opacity-90 px-6 py-3 rounded-xl border border-gray-800 max-w-lg mx-auto">
        <p
          className={`text-xl font-bold transition-colors duration-300 ${
            headValidation?.valid ? 'text-green-400' : 'text-red-400'
          }`}
        >
          {headValidation?.message || 'Detecting face...'}
        </p>
        <p className="text-cyan-300 text-sm mt-2 font-mono">
          {headValidation?.debug
            ? `faceWidth: ${headValidation.debug.faceWidth.toFixed(3)} (min: ${headValidation.debug.minFaceWidth.toFixed(
                3,
              )}, max: ${headValidation.debug.maxFaceWidth.toFixed(3)}) · target ${
                headValidation.debug.targetDistanceCm
              }cm`
            : 'Debug: center face in frame to see values (or check Console)'}
        </p>
        <p className="text-gray-300 text-sm mt-1.5 font-mono">
          Stable frames:{' '}
          <span className={headValidation?.valid ? 'text-green-400 font-semibold' : 'text-gray-500'}>
            {stableFrameCount}
          </span>{' '}
          / 60
        </p>
        <p className="text-gray-500 text-xs mt-3 max-w-md mx-auto">
          Nếu hình tự zoom khi bạn đẩy người ra xa/gần, việc tính khoảng cách sẽ sai. Hãy tắt <strong>Center Stage</strong> (Mac) hoặc <strong>Studio Effects / Automatic framing</strong> (Windows) trong cài đặt hệ thống.
        </p>
      </div>
    </div>
  );
}

export default HeadPositioningScreen;

