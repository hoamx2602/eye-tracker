'use client';

import React, { useEffect, useRef } from 'react';
import type { HeadValidationResult } from '../services/eyeTrackingService';
import { VoiceControls } from './ui/VoiceButton';
import { useVoice, useVoiceOnMount } from '@/lib/voice/VoiceProvider';
import { headPromptVoiceKey, type VoiceKey } from '@/lib/voice/scripts';

/**
 * How long a prompt must hold before it is spoken.
 *
 * The validator re-runs every frame and flickers between directions while
 * someone is still moving; without this the voice would stutter through three
 * contradictory instructions a second.
 */
const PROMPT_SETTLE_MS = 700;
/** Don't repeat the same direction more often than this. */
const PROMPT_REPEAT_MS = 5000;

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
  useVoiceOnMount('headPositioning');

  const voice = useVoice();
  const speak = voice?.speak;

  // Read through refs on a timer rather than reacting to renders: the
  // validator re-renders this screen many times a second while the face
  // moves, and not at all once it is still — the opposite of the cadence
  // spoken prompts need.
  const messageRef = useRef('');
  messageRef.current = headValidation?.message ?? '';
  const speakingKeyRef = useRef<string | null>(null);
  speakingKeyRef.current = voice?.speakingKey ?? null;

  /** The prompt waiting to be confirmed, and when it first appeared. */
  const pendingRef = useRef<{ key: VoiceKey; since: number } | null>(null);
  /** What was last said, so one direction is not repeated endlessly. */
  const spokenRef = useRef<{ key: VoiceKey; at: number } | null>(null);

  useEffect(() => {
    if (!speak) return;
    const id = setInterval(() => {
      const key = headPromptVoiceKey(messageRef.current);
      if (!key) {
        pendingRef.current = null;
        return;
      }

      const now = Date.now();
      if (pendingRef.current?.key !== key) {
        pendingRef.current = { key, since: now };
        return;
      }
      if (now - pendingRef.current.since < PROMPT_SETTLE_MS) return;

      // One voice at a time: a prompt replaces an earlier prompt, but waits
      // for the opening guidance to finish rather than cutting it off.
      const speaking = speakingKeyRef.current;
      if (speaking !== null && !speaking.startsWith('head.')) return;
      if (speaking === key) return;

      const spoken = spokenRef.current;
      if (spoken?.key === key && now - spoken.at < PROMPT_REPEAT_MS) return;

      spokenRef.current = { key, at: now };
      speak(key);
    }, 250);
    return () => clearInterval(id);
  }, [speak]);

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col items-center justify-center gap-6 p-8">
      <VoiceControls voiceKey="headPositioning" label="Instructions" floating />
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
          If the image auto-zooms when you move closer or farther, distance calculation will be wrong. Turn off <strong>Center Stage</strong> (Mac) or <strong>Studio Effects / Automatic framing</strong> (Windows) in system settings.
        </p>
      </div>
    </div>
  );
}

export default HeadPositioningScreen;

