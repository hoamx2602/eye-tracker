'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import CameraCheckScreen from '@/components/facial-droop/CameraCheckScreen';
import CaptureScreen from '@/components/facial-droop/CaptureScreen';
import ConsentScreen from '@/components/facial-droop/ConsentScreen';
import ExitDialog from '@/components/facial-droop/ExitDialog';
import FacialShell from '@/components/facial-droop/FacialShell';
import ResultScreen from '@/components/facial-droop/ResultScreen';
import { useCaptureDevices } from '@/components/facial-droop/useCaptureDevices';
import { useFacialCapture } from '@/components/facial-droop/useFacialCapture';
import FullscreenGuard, { enterFullscreen, exitFullscreen } from '@/components/ui/FullscreenGuard';
import { MODULE_PATHS } from '@/lib/paths';
import { useVoice } from '@/lib/voice/VoiceProvider';

type Stage = 'consent' | 'check' | 'capture' | 'result';

/**
 * /facial-droop: consent -> camera check -> ten recorded tasks -> result.
 * Every stage is centred in a viewport-sized frame; the check and the tasks
 * run in fullscreen, as the eye-tracking flow does.
 */
export default function FacialDroopPage() {
  const router = useRouter();
  const voice = useVoice();
  const devices = useCaptureDevices();
  const [consentAt, setConsentAt] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('consent');
  const [exitOpen, setExitOpen] = useState(false);
  const capture = useFacialCapture(devices.stream, consentAt);

  // Recording has ended (last task finished): leave fullscreen and show the outcome.
  useEffect(() => {
    if (stage !== 'capture' || capture.state === 'idle' || capture.state === 'recording') return;
    setStage('result');
    void exitFullscreen();
  }, [capture.state, stage]);

  const agree = useCallback(async () => {
    setConsentAt(new Date().toISOString());
    // Fullscreen must be requested inside the click, before any await.
    const fullscreen = enterFullscreen();
    setStage('check');
    await Promise.all([fullscreen, devices.request()]);
  }, [devices]);

  const startRecording = useCallback(() => {
    voice?.stop();
    capture.begin();
    setStage('capture');
  }, [capture, voice]);

  // No guidance may play inside a recorded window: it would be captured in the audio track.
  const startTask = useCallback(() => {
    voice?.stop();
    capture.startTask();
  }, [capture, voice]);

  const leave = useCallback(() => {
    voice?.stop();
    capture.abort();
    devices.release();
    void exitFullscreen();
    router.push(MODULE_PATHS.HUB);
  }, [capture, devices, router, voice]);

  const inTest = stage === 'check' || stage === 'capture';
  const leading = inTest ? (
    <button type="button" onClick={() => setExitOpen(true)} className="text-sm text-gray-400 transition hover:text-white">
      ✕ Exit
    </button>
  ) : stage === 'consent' ? (
    <Link href={MODULE_PATHS.HUB} className="text-sm text-gray-400 transition hover:text-white">← All assessments</Link>
  ) : null;

  return (
    <FacialShell leading={leading}>
      {stage === 'consent' && <ConsentScreen onAgree={() => void agree()} busy={devices.state === 'requesting'} />}
      {stage === 'check' && (
        <CameraCheckScreen stream={devices.stream} deviceState={devices.state} deviceError={devices.error}
          onRetryDevices={() => void devices.request()} onStart={startRecording} />
      )}
      {stage === 'capture' && (
        <CaptureScreen stream={devices.stream} capture={capture} onStartTask={startTask} onFinishTask={capture.finishTask} />
      )}
      {stage === 'result' && <ResultScreen result={capture} onRetry={capture.retry} onDownload={capture.download} />}
      <FullscreenGuard active={inTest} />
      <ExitDialog open={exitOpen} recording={stage === 'capture'} onStay={() => setExitOpen(false)} onLeave={leave} />
    </FacialShell>
  );
}
