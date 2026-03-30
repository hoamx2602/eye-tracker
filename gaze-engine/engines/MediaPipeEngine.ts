/**
 * MediaPipeEngine — production gaze engine.
 *
 * Architecture:
 *   • All MediaPipe + regression runs inside a Web Worker (zero main-thread blocking)
 *   • Frames are transferred as ImageBitmap (zero-copy, structured-clone transfer)
 *   • Main thread only: rAF loop, postMessage, React state updates
 *
 * Typical latency budget at 30 fps:
 *   Worker detection  ~18–26 ms  (GPU delegate)
 *   Feature extract   ~0.5 ms
 *   Regression        ~0.2 ms
 *   Smoothing         ~0.1 ms
 *   Total             ~19–27 ms  — main thread sees 0 ms of that
 */

import type {
  IGazeEngine, GazeResult, HeadPoseResult,
  CalibrationSample, LOOCVMetrics, EngineCapabilities,
} from '../core/IGazeEngine';
import type { SmootherConfig } from '../core/filters/GazeSmoother';
import type { RegressionMethod } from '../services/RegressionService';
import type { FeatureFlags } from '../services/FeatureExtractor';

export interface MediaPipeEngineConfig {
  wasmPath?: string;
  modelPath?: string;
  regressionMethod?: RegressionMethod;
  smoother?: SmootherConfig;
  flags?: FeatureFlags;
}

const DEFAULT_WASM  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm';
const DEFAULT_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export class MediaPipeEngine implements IGazeEngine {
  readonly id = 'mediapipe-v1';
  readonly capabilities: EngineCapabilities = {
    supportsHeadPose: true,
    supportsConfidence: true,
    supportsOffscreenCanvas: false, // ImageBitmap path is used instead
  };

  private worker: Worker | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private rafId = 0;
  private cfg: Required<MediaPipeEngineConfig>;

  private gazeHandler?: (r: GazeResult) => void;
  private headHandler?: (r: HeadPoseResult) => void;
  private errorHandler?: (msg: string) => void;

  constructor(config: MediaPipeEngineConfig = {}) {
    this.cfg = {
      wasmPath: config.wasmPath ?? DEFAULT_WASM,
      modelPath: config.modelPath ?? DEFAULT_MODEL,
      regressionMethod: config.regressionMethod ?? 'HYBRID',
      smoother: config.smoother ?? { method: 'ONE_EURO', minCutoff: 0.005, beta: 0.01 },
      flags: config.flags ?? {},
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize(videoEl: HTMLVideoElement): Promise<void> {
    this.videoEl = videoEl;

    this.worker = new Worker(
      new URL('./workers/mediapipe.worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker.onmessage = this.onWorkerMessage.bind(this);
    this.worker.onerror = (e) => this.errorHandler?.(e.message);

    return new Promise<void>((resolve, reject) => {
      const init = (e: MessageEvent) => {
        if (e.data.type === 'READY') { this.worker!.removeEventListener('message', init); resolve(); }
        if (e.data.type === 'ERROR') { this.worker!.removeEventListener('message', init); reject(new Error(e.data.payload)); }
      };
      this.worker!.addEventListener('message', init);

      this.worker!.postMessage({
        type: 'INIT',
        payload: {
          wasmPath: this.cfg.wasmPath,
          modelPath: this.cfg.modelPath,
          useBlendshapes: !!(this.cfg.flags.useBlendshapes),
          useMatrix: !!(this.cfg.flags.useTransformationMatrix),
        },
      });

      // Configure smoother inside worker
      this.worker!.postMessage({ type: 'UPDATE_SMOOTHER', payload: this.cfg.smoother });
      this.worker!.postMessage({ type: 'SET_METHOD', payload: this.cfg.regressionMethod });
    });
  }

  start(): void {
    this.worker?.postMessage({ type: 'START' });
    this.frameLoop();
  }

  stop(): void {
    this.worker?.postMessage({ type: 'STOP' });
    cancelAnimationFrame(this.rafId);
  }

  destroy(): void {
    this.stop();
    this.worker?.postMessage({ type: 'DESTROY' });
    // Terminate after a short grace period so DESTROY is processed
    setTimeout(() => { this.worker?.terminate(); this.worker = null; }, 100);
    if (this.videoEl?.srcObject) {
      (this.videoEl.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    }
  }

  // ─── Calibration ────────────────────────────────────────────────────────────

  calibrate(samples: CalibrationSample[]): Promise<LOOCVMetrics> {
    return new Promise((resolve, reject) => {
      if (!this.worker) { reject(new Error('Engine not initialized')); return; }

      const handler = (e: MessageEvent) => {
        if (e.data.type !== 'CALIBRATE_DONE') return;
        this.worker!.removeEventListener('message', handler);
        if (!e.data.payload.ok) reject(new Error('Calibration failed — singular matrix'));
        else resolve(e.data.payload.metrics as LOOCVMetrics);
      };
      this.worker.addEventListener('message', handler);
      this.worker.postMessage({
        type: 'CALIBRATE',
        payload: { samples, method: this.cfg.regressionMethod, flags: this.cfg.flags },
      });
    });
  }

  reEvaluate(samples: CalibrationSample[]): Promise<LOOCVMetrics> {
    // Re-sends samples with current flags; Worker re-trains without re-calibrating user
    return this.calibrate(samples);
  }

  // ─── Handlers ───────────────────────────────────────────────────────────────

  onGazeResult(h: (r: GazeResult) => void): void    { this.gazeHandler  = h; }
  onHeadPoseResult(h: (r: HeadPoseResult) => void): void { this.headHandler  = h; }
  onError(h: (msg: string) => void): void            { this.errorHandler = h; }

  /** Update config at runtime (smoother params, regression method, feature flags). */
  updateConfig(patch: Partial<MediaPipeEngineConfig>): void {
    Object.assign(this.cfg, patch);
    if (patch.smoother) this.worker?.postMessage({ type: 'UPDATE_SMOOTHER', payload: patch.smoother });
    if (patch.regressionMethod) this.worker?.postMessage({ type: 'SET_METHOD', payload: patch.regressionMethod });
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  /**
   * rAF loop on main thread: grab video frame → ImageBitmap → transfer to worker.
   * createImageBitmap is async but resolves in ~0.1 ms; transfer is zero-copy.
   */
  private frameLoop(): void {
    const tick = () => {
      if (this.videoEl && this.videoEl.readyState >= 2) {
        createImageBitmap(this.videoEl).then(bitmap => {
          this.worker?.postMessage(
            { type: 'FRAME', payload: { bitmap, timestamp: performance.now() } },
            [bitmap], // transfer ownership — main thread can't use bitmap after this
          );
        }).catch(() => { /* frame skipped if video not ready */ });
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private onWorkerMessage(e: MessageEvent): void {
    const { type, payload } = e.data;
    if (type === 'GAZE'      && payload) this.gazeHandler?.(payload as GazeResult);
    if (type === 'HEAD_POSE' && payload) this.headHandler?.(payload as HeadPoseResult);
    if (type === 'ERROR')               this.errorHandler?.(payload as string);
  }
}
