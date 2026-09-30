'use client';

import React from 'react';
import { VoiceControls } from '@/components/ui/VoiceButton';
import type { FacialSpeechTask } from '@/lib/facialSpeechProtocol';
import { useVoiceOnMount } from '@/lib/voice/VoiceProvider';
import { facialTaskVoiceKey } from '@/lib/voice/scripts';

const DOMAIN_LABEL: Record<FacialSpeechTask['domain'], string> = {
  face: 'Facial movement',
  speech: 'Motor speech',
  quality: 'Recording quality',
};

interface TaskGuideOverlayProps {
  task: FacialSpeechTask;
  taskIndex: number;
  taskCount: number;
  onStart: () => void;
}

/**
 * The guide before each task, centred over the camera so reading it keeps the
 * head facing the lens. Spoken on arrival; the page stops the voice before the
 * countdown, so no guidance is ever inside a recorded task window.
 */
export default function TaskGuideOverlay({ task, taskIndex, taskCount, onStart }: TaskGuideOverlayProps) {
  const voiceKey = facialTaskVoiceKey(task.id);
  useVoiceOnMount(voiceKey);

  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-gray-950/80 p-6 backdrop-blur-sm">
      <div className="w-full max-w-xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-400">
          Task {taskIndex + 1} of {taskCount} · {DOMAIN_LABEL[task.domain]}
        </p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight">{task.title}</h2>
        <p className="mt-4 text-lg leading-8 text-gray-100">{task.instruction}</p>
        {task.nearLensPrompt && (
          <p className="mt-3 text-sm text-gray-400">The words will appear at the top of the screen, next to the camera.</p>
        )}
        <p className="mt-3 text-xs text-gray-500">
          3-second countdown, then {task.durationSec}s of recording · {task.clinicalAnchor}
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          {voiceKey && <VoiceControls voiceKey={voiceKey} />}
          <button type="button" onClick={onStart}
            className="rounded-xl bg-blue-600 px-8 py-3 text-base font-semibold text-white shadow-lg shadow-blue-900/40 transition duration-150 ease-out hover:bg-blue-500">
            Start this task
          </button>
        </div>
      </div>
    </div>
  );
}
