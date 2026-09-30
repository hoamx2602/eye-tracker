'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type DeviceState = 'idle' | 'requesting' | 'ready' | 'error';

/**
 * Camera and microphone for the capture. Requested once, kept for the whole
 * session (the camera check and every task share the stream), stopped on unmount.
 */
export function useCaptureDevices() {
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [state, setState] = useState<DeviceState>('idle');
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (): Promise<MediaStream | null> => {
    if (streamRef.current) return streamRef.current;
    setState('requesting');
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        // The browser or device may override these. Actual settings go into
        // the manifest and the offline service applies quality gates.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      streamRef.current = media;
      setStream(media);
      setState('ready');
      return media;
    } catch (caught) {
      console.error('[facial-speech] media permission failed', caught);
      setState('error');
      setError('Camera or microphone access failed. Check the browser permissions for this site and try again.');
      return null;
    }
  }, []);

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    setState('idle');
  }, []);

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  return { stream, state, error, request, release };
}
