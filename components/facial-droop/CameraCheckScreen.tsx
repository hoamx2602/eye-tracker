'use client';

import React, { useState } from 'react';
import { VoiceControls } from '@/components/ui/VoiceButton';
import { useVoiceOnMount } from '@/lib/voice/VoiceProvider';
import CameraView from './CameraView';
import type { DeviceState } from './useCaptureDevices';
import { useMicLevel } from './useMicLevel';

interface CameraCheckScreenProps {
  stream: MediaStream | null;
  deviceState: DeviceState;
  deviceError: string | null;
  onRetryDevices: () => void;
  onStart: () => void;
}

type MirrorAnswer = 'left' | 'right' | null;

/** Face oval and centre marks, so the participant can frame themselves. */
function FramingGuide() {
  return (
    <svg viewBox="0 0 160 90" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      <ellipse cx="80" cy="45" rx="19" ry="27" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.6" strokeDasharray="2 1.5" />
      <line x1="80" y1="14" x2="80" y2="18" stroke="rgba(255,255,255,0.5)" strokeWidth="0.4" />
      <line x1="80" y1="72" x2="80" y2="76" stroke="rgba(255,255,255,0.5)" strokeWidth="0.4" />
    </svg>
  );
}

/**
 * Camera and microphone check, centred on the live preview. Recording cannot
 * start until the participant confirms the picture is not mirrored: some
 * webcams and virtual cameras flip the image themselves, which would make the
 * analysis report weakness on the wrong side of the face.
 */
export default function CameraCheckScreen({ stream, deviceState, deviceError, onRetryDevices, onStart }: CameraCheckScreenProps) {
  const [mirror, setMirror] = useState<MirrorAnswer>(null);
  useVoiceOnMount('facial.camera');
  const level = useMicLevel(stream, deviceState === 'ready');
  const ready = deviceState === 'ready' && mirror === 'left';

  return (
    <div className="flex h-full w-full max-w-5xl flex-col items-center justify-center gap-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">Camera and microphone check</h1>
        <p className="mt-1 text-sm text-gray-400">Centre your face in the oval, with even light and a quiet room.</p>
      </div>

      <CameraView stream={stream} reserve="22rem">
        <FramingGuide />
        <span className="absolute left-3 top-3 rounded-full bg-black/70 px-3 py-1 text-xs font-medium">CAMERA PREVIEW · NOT MIRRORED</span>
        {deviceState !== 'ready' && (
          <div className="absolute inset-0 grid place-items-center bg-gray-950/85 p-6 text-center">
            {deviceState === 'error' ? (
              <div className="space-y-3">
                <p className="max-w-sm text-sm text-red-200">{deviceError}</p>
                <button type="button" onClick={onRetryDevices} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500">Try again</button>
              </div>
            ) : (
              <p className="text-sm text-gray-300">Waiting for camera and microphone permission…</p>
            )}
          </div>
        )}
      </CameraView>

      <div className="grid w-full max-w-3xl gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <p className="text-sm font-semibold">Microphone</p>
          <p className="mt-0.5 text-xs text-gray-400">Say a few words: the bar should move.</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-800" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
            <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${level * 100}%` }} />
          </div>
        </div>
        <fieldset className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <legend className="sr-only">Mirror check</legend>
          <p className="text-sm font-semibold">Raise your right hand. Where is it on screen?</p>
          <div className="mt-3 flex gap-2">
            {(['left', 'right'] as const).map((side) => (
              <button key={side} type="button" onClick={() => setMirror(side)} aria-pressed={mirror === side}
                className={`flex-1 rounded-lg border px-3 py-1.5 text-sm transition duration-150 ease-out ${mirror === side ? 'border-blue-500 bg-blue-600/20 text-white' : 'border-gray-700 text-gray-300 hover:border-gray-500'}`}>
                On the {side}
              </button>
            ))}
          </div>
          {mirror === 'right' && (
            <p className="mt-2 text-xs leading-5 text-amber-300">
              Your camera is flipping the picture. Turn off &ldquo;mirror&rdquo; in the camera or virtual-camera settings, then check again.
            </p>
          )}
        </fieldset>
      </div>

      <div className="flex items-center gap-3">
        <VoiceControls voiceKey="facial.camera" />
        <button type="button" onClick={onStart} disabled={!ready}
          className="rounded-xl bg-blue-600 px-8 py-3 text-sm font-semibold transition duration-150 ease-out enabled:hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400">
          Start recording
        </button>
      </div>
    </div>
  );
}
