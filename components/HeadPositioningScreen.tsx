'use client';

import React from 'react';
import type { HeadValidationResult } from '../services/eyeTrackingService';

type HeadPositioningScreenProps = {
  headPosCanvasRef: React.RefObject<HTMLCanvasElement>;
  headValidation: HeadValidationResult | null;
  positionHoldTime: number | null;
  stableFrameCount: number;
};

/**
 * One-line readout of what the position check is actually doing.
 *
 * Which numbers are meaningful depends on the mode: once an anchor exists the
 * check is a comparison against the setup pose, and printing a face-width band
 * there would be showing values nothing is being compared to.
 */
function describeHeadDebug(d: NonNullable<HeadValidationResult['debug']>): string {
  if (d.anchorFault !== undefined) {
    const depth = Number.isFinite(d.depthRatio) ? `${((d.depthRatio! - 1) * 100).toFixed(0)}%` : '—';
    const drift = Number.isFinite(d.driftFaceWidths)
      ? d.lateralCm != null
        ? `${Math.abs(d.lateralCm).toFixed(1)}cm`
        : `${d.driftFaceWidths!.toFixed(2)} face-widths`
      : '—';
    const deg = (v: number | undefined) => (Number.isFinite(v) ? `${v!.toFixed(0)}°` : '—');
    const turn = `y ${deg(d.yawDeg)} p ${deg(d.pitchDeg)} r ${deg(d.rollDeg)}`;
    return `vs setup pose · depth ${depth} · drift ${drift} · turn ${turn}`;
  }
  const measured = d.measuredDistanceCm != null ? ` · at ${d.measuredDistanceCm.toFixed(0)}cm` : '';
  return `faceWidth: ${d.faceWidth.toFixed(3)} (min ${d.minFaceWidth.toFixed(2)}) · target ${d.targetDistanceCm}cm${measured}`;
}

function HeadPositioningScreen({
  headPosCanvasRef,
  headValidation,
  positionHoldTime,
  stableFrameCount,
}: HeadPositioningScreenProps) {
  // Two modes, and telling them apart matters. Before the anchor exists the task
  // is to get framed and to the target distance. After it exists — which is the
  // only way this screen appears mid-run — the task is to get back to the exact
  // pose the mapping was fitted at, and "center your face in the box" is then
  // actively misleading: a well-centred face at the wrong depth is still wrong.
  const resuming = headValidation?.debug?.anchorFault !== undefined;

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h2 className="text-xl font-bold text-white uppercase tracking-widest">
          {resuming ? 'Return To Your Position' : 'Head Positioning'}
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          {resuming
            ? 'The test paused because you moved. Follow the prompt to get back.'
            : 'Center your face inside the box'}
        </p>
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
          {headValidation?.debug ? describeHeadDebug(headValidation.debug) : 'Debug: center face in frame to see values (or check Console)'}
        </p>
        <p className="text-gray-300 text-sm mt-1.5 font-mono">
          Stable frames:{' '}
          <span className={headValidation?.valid ? 'text-green-400 font-semibold' : 'text-gray-500'}>
            {stableFrameCount}
          </span>{' '}
          / 60
        </p>
        <p className="text-gray-500 text-xs mt-3 max-w-md mx-auto">
          If the image auto-zooms when you move closer or farther, distance calculation will be wrong. Turn off <strong>Center Stage</strong> (Mac) or <strong>Studio Effects / Automatic framing</strong> (Windows) in system settings.
        </p>
      </div>
    </div>
  );
}

export default HeadPositioningScreen;

