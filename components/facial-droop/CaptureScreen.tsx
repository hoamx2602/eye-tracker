'use client';

import React from 'react';
import { FACIAL_SPEECH_TASKS, type FacialSpeechTask } from '@/lib/facialSpeechProtocol';
import ActiveTaskOverlay from './ActiveTaskOverlay';
import CameraView from './CameraView';
import TaskGuideOverlay from './TaskGuideOverlay';
import type { TaskPhase } from './useFacialCapture';

/** The slice of useFacialCapture this screen reads. */
export interface CaptureProgress {
  task: FacialSpeechTask;
  taskIndex: number;
  phase: TaskPhase;
  countdown: number;
  elapsedMs: number;
  completedCount: number;
}

interface CaptureScreenProps {
  stream: MediaStream | null;
  capture: CaptureProgress;
  onStartTask: () => void;
  onFinishTask: () => void;
}

/** The recording stage: the camera centred, the task layer on top, progress below. */
export default function CaptureScreen({ stream, capture, onStartTask, onFinishTask }: CaptureScreenProps) {
  const { task, taskIndex, phase, countdown, elapsedMs, completedCount } = capture;
  const isLast = taskIndex === FACIAL_SPEECH_TASKS.length - 1;

  return (
    <div className="flex h-full w-full max-w-6xl flex-col items-center justify-center gap-4">
      <CameraView stream={stream} reserve="9rem">
        <span className="absolute left-3 top-3 z-30 flex items-center gap-2 rounded-full bg-red-600/90 px-3 py-1 text-xs font-medium">
          <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> RECORDING
        </span>
        {phase === 'instruction' && (
          <TaskGuideOverlay key={task.id} task={task} taskIndex={taskIndex} taskCount={FACIAL_SPEECH_TASKS.length} onStart={onStartTask} />
        )}
        {phase === 'countdown' && (
          <div className="absolute inset-0 z-20 grid place-items-center bg-black/55 text-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-300">Look at the camera lens</p>
              <p className="mt-2 text-8xl font-bold tabular-nums">{countdown}</p>
              <p className="mt-2 text-sm text-gray-300">{task.title}</p>
            </div>
          </div>
        )}
        {phase === 'active' && <ActiveTaskOverlay task={task} isLast={isLast} elapsedMs={elapsedMs} onFinish={onFinishTask} />}
      </CameraView>

      <div className="flex w-full max-w-3xl items-center gap-3" aria-label="Task progress">
        <div className="flex flex-1 gap-1">
          {FACIAL_SPEECH_TASKS.map((item, index) => (
            <div key={item.id} title={item.title}
              className={`h-1.5 flex-1 rounded-full ${index < completedCount ? 'bg-emerald-500' : index === taskIndex ? 'bg-blue-500' : 'bg-gray-700'}`} />
          ))}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-gray-400">{completedCount} / {FACIAL_SPEECH_TASKS.length}</span>
      </div>
    </div>
  );
}
