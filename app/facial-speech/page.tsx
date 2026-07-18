'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FACIAL_SPEECH_METRICS,
  FACIAL_SPEECH_PROTOCOL_VERSION,
  FACIAL_SPEECH_TASKS,
} from '@/lib/facialSpeechProtocol';

type CaptureState = 'ready' | 'recording' | 'complete' | 'error';

interface CompletedTask {
  id: string;
  startedAtMs: number;
  endedAtMs: number;
  recordedDurationMs: number;
  expectedDurationSec: number;
}

function chooseMimeType() {
  const choices = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return choices.find((value) => MediaRecorder.isTypeSupported(value)) ?? '';
}

function download(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(href);
}

function getTrackSettings(track: MediaStreamTrack | undefined) {
  if (!track) return null;
  const settings = track.getSettings?.() ?? {};
  return {
    label: track.label,
    settings,
  };
}

export default function FacialSpeechPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sessionStartRef = useRef(0);
  const taskStartRef = useRef(0);
  const captureStartedAtRef = useRef<string | null>(null);

  const [captureState, setCaptureState] = useState<CaptureState>('ready');
  const [taskIndex, setTaskIndex] = useState(0);
  const [completedTasks, setCompletedTasks] = useState<CompletedTask[]>([]);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [message, setMessage] = useState('Cấp quyền camera và micro, sau đó bắt đầu protocol.');

  const currentTask = FACIAL_SPEECH_TASKS[taskIndex];

  useEffect(() => {
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'auto';
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      recorderRef.current?.state === 'recording' && recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [captureState]);

  const prepareCapture = useCallback(async () => {
    if (streamRef.current) return streamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        // Preserve acoustic information as far as browser/device permits. Quality
        // gates in the offline pipeline decide whether a recording is usable.
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCaptureState('ready');
      setMessage('Thiết bị đã sẵn sàng. Giữ mặt thẳng, đủ sáng và môi trường yên tĩnh.');
      return stream;
    } catch (error) {
      console.error('[facial-speech] media permission failed', error);
      setCaptureState('error');
      setMessage('Không thể truy cập camera hoặc micro. Kiểm tra quyền của trình duyệt rồi thử lại.');
      return null;
    }
  }, []);

  const beginProtocol = useCallback(async () => {
    const stream = await prepareCapture();
    if (!stream) return;

    const mimeType = chooseMimeType();
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 2_500_000,
    });
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const mediaType = recorder.mimeType || 'video/webm';
      setVideoBlob(new Blob(chunksRef.current, { type: mediaType }));
      setCaptureState('complete');
      setMessage('Đã ghi xong. Tải cả video và metadata để chạy pipeline offline.');
    };
    recorderRef.current = recorder;
    sessionStartRef.current = performance.now();
    taskStartRef.current = sessionStartRef.current;
    captureStartedAtRef.current = new Date().toISOString();
    setTaskIndex(0);
    setCompletedTasks([]);
    setVideoBlob(null);
    recorder.start(1000);
    setCaptureState('recording');
    setMessage('Đang ghi liên tục. Hoàn thành từng tác vụ theo hướng dẫn.');
  }, [prepareCapture]);

  const completeCurrentTask = useCallback(() => {
    if (captureState !== 'recording') return;
    const now = performance.now();
    const completed: CompletedTask = {
      id: currentTask.id,
      startedAtMs: Math.round(taskStartRef.current - sessionStartRef.current),
      endedAtMs: Math.round(now - sessionStartRef.current),
      recordedDurationMs: Math.round(now - taskStartRef.current),
      expectedDurationSec: currentTask.durationSec,
    };
    setCompletedTasks((previous) => [...previous, completed]);

    if (taskIndex === FACIAL_SPEECH_TASKS.length - 1) {
      recorderRef.current?.state === 'recording' && recorderRef.current.stop();
      setMessage('Đang hoàn tất file video…');
      return;
    }
    taskStartRef.current = now;
    setTaskIndex((previous) => previous + 1);
  }, [captureState, currentTask, taskIndex]);

  const exportArtifacts = useCallback(() => {
    if (!videoBlob) return;
    const sessionId = `facial-speech-${Date.now()}`;
    const stream = streamRef.current;
    const manifest = {
      protocol: 'facial-speech-screening',
      protocolVersion: FACIAL_SPEECH_PROTOCOL_VERSION,
      sessionId,
      captureStartedAt: captureStartedAtRef.current,
      media: {
        container: videoBlob.type || 'video/webm',
        video: getTrackSettings(stream?.getVideoTracks()[0]),
        audio: getTrackSettings(stream?.getAudioTracks()[0]),
      },
      tasks: completedTasks,
      expectedTaskOrder: FACIAL_SPEECH_TASKS.map((task) => ({
        id: task.id,
        domain: task.domain,
        durationSec: task.durationSec,
      })),
      metricsRequested: FACIAL_SPEECH_METRICS.map((metric) => metric.id),
      qualityPolicy: {
        requireFrontalFace: true,
        requireStableHeadPose: true,
        requireAudioSnrGate: true,
        interpretation: 'screening-and-clinical-review, not standalone diagnosis',
      },
    };
    download(videoBlob, `${sessionId}.webm`);
    download(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), `${sessionId}.meta.json`);
  }, [completedTasks, videoBlob]);

  const faceMetrics = FACIAL_SPEECH_METRICS.filter((metric) => metric.domain === 'face');
  const speechMetrics = FACIAL_SPEECH_METRICS.filter((metric) => metric.domain === 'speech');

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-col gap-3 border-b border-slate-800 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">Offline neurological capture</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Facial drooping &amp; speech screen</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Capture protocol chuẩn hoá để đo bất đối xứng vận động mặt và dấu hiệu dysarthria. Kết quả tự động là tín hiệu sàng lọc cần được bác sĩ hoặc chuyên viên âm ngữ trị liệu xem lại.
            </p>
          </div>
          <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
            Nếu méo miệng hoặc nói khó xuất hiện đột ngột: gọi cấp cứu ngay, không chờ kết quả test.
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/20">
            <div className="relative aspect-video bg-black">
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              <div className="absolute left-4 top-4 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
                {captureState === 'recording' ? '● RECORDING' : captureState === 'complete' ? 'CAPTURE COMPLETE' : 'CAMERA PREVIEW'}
              </div>
            </div>
            <div className="p-5">
              <p className="text-sm text-slate-300">{message}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {captureState === 'ready' || captureState === 'error' ? (
                  <button onClick={() => void prepareCapture()} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium hover:border-cyan-400 hover:text-cyan-300">
                    Kiểm tra camera &amp; micro
                  </button>
                ) : null}
                {captureState === 'ready' ? (
                  <button onClick={() => void beginProtocol()} className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300">
                    Bắt đầu protocol
                  </button>
                ) : null}
                {captureState === 'complete' ? (
                  <button onClick={exportArtifacts} className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300">
                    Tải video + metadata
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <aside className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-400">Tác vụ {Math.min(taskIndex + 1, FACIAL_SPEECH_TASKS.length)} / {FACIAL_SPEECH_TASKS.length}</p>
            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">{currentTask.domain === 'face' ? 'Facial movement' : 'Motor speech'}</p>
            <h2 className="mt-1 text-xl font-semibold">{currentTask.title}</h2>
            <p className="mt-4 min-h-20 text-base leading-7 text-slate-200">{currentTask.instruction}</p>
            <div className="mt-4 rounded-lg bg-slate-800/80 p-3 text-sm text-slate-400">
              <p><span className="text-slate-500">Thời lượng gợi ý:</span> {currentTask.durationSec}s</p>
              <p className="mt-1"><span className="text-slate-500">Cơ sở:</span> {currentTask.clinicalAnchor}</p>
              <p className="mt-1"><span className="text-slate-500">Lưu ý:</span> {currentTask.captureNotes}</p>
            </div>
            <button disabled={captureState !== 'recording'} onClick={completeCurrentTask} className="mt-6 w-full rounded-lg bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 enabled:hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
              {taskIndex === FACIAL_SPEECH_TASKS.length - 1 ? 'Hoàn tất và dừng ghi' : 'Hoàn thành tác vụ →'}
            </button>
            <p className="mt-3 text-xs leading-5 text-slate-500">Bấm khi đã làm xong; metadata sẽ lưu thời gian thực tế thay vì giả định cố định.</p>
          </aside>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <MetricPanel title="Facial metrics sẽ xuất" metrics={faceMetrics} />
          <MetricPanel title="Speech metrics sẽ xuất" metrics={speechMetrics} />
        </section>

        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold">Quality gates trước khi chấm điểm</h2>
          <div className="mt-4 grid gap-3 text-sm text-slate-400 sm:grid-cols-3">
            <p><span className="font-medium text-slate-200">Mặt:</span> frontal pose, landmark confidence, không bị che khuất.</p>
            <p><span className="font-medium text-slate-200">Đầu:</span> loại/đánh cờ các đoạn nghiêng hoặc dịch chuyển mạnh.</p>
            <p><span className="font-medium text-slate-200">Audio:</span> noise floor, clipping, SNR, speech activity trước khi tính acoustic features.</p>
          </div>
        </section>
      </div>
    </main>
  );
}

function MetricPanel({ title, metrics }: { title: string; metrics: typeof FACIAL_SPEECH_METRICS }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4 space-y-3">
        {metrics.map((metric) => (
          <div key={metric.id} className="rounded-lg bg-slate-800/70 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-slate-200">{metric.label}</p>
              <span className="shrink-0 text-xs text-cyan-300">{metric.unit}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">{metric.purpose}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
