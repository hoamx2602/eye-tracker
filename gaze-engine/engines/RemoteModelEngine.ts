/**
 * RemoteModelEngine — streams frames to a custom ML backend over WebSocket.
 *
 * Use this to replace MediaPipe with a server-side model (e.g. Python + PyTorch)
 * while keeping the same IGazeEngine contract.
 *
 * Protocol (JSON over WebSocket):
 *   Client → Server: { type: 'frame',     payload: base64 JPEG }
 *   Client → Server: { type: 'calibrate', payload: CalibrationSample[] }
 *   Server → Client: { type: 'gaze',      payload: GazeResult }
 *   Server → Client: { type: 'head_pose', payload: HeadPoseResult }
 *   Server → Client: { type: 'calibrate_done', payload: LOOCVMetrics }
 *   Server → Client: { type: 'error',     payload: string }
 */

import type {
  IGazeEngine, GazeResult, HeadPoseResult,
  CalibrationSample, LOOCVMetrics, EngineCapabilities,
} from '../core/IGazeEngine';

export class RemoteModelEngine implements IGazeEngine {
  readonly id = 'remote-v1';
  readonly capabilities: EngineCapabilities = {
    supportsHeadPose: true,
    supportsConfidence: true,
    supportsOffscreenCanvas: false,
  };

  private ws: WebSocket | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private rafId = 0;

  private gazeHandler?: (r: GazeResult) => void;
  private headHandler?: (r: HeadPoseResult) => void;
  private errorHandler?: (msg: string) => void;

  /** Pending calibrate() resolve/reject, resolved when server responds. */
  private calibrateResolve?: (m: LOOCVMetrics) => void;
  private calibrateReject?: (e: Error) => void;

  constructor(private readonly wsUrl: string) {}

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize(videoEl: HTMLVideoElement): Promise<void> {
    this.videoEl = videoEl;

    // Off-screen canvas for JPEG encoding — stays on main thread (no Worker for remote)
    this.canvas = document.createElement('canvas');
    this.canvas.width  = videoEl.videoWidth  || 640;
    this.canvas.height = videoEl.videoHeight || 480;
    this.ctx = this.canvas.getContext('2d');

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen  = () => resolve();
      this.ws.onerror = (ev) => { this.errorHandler?.('WebSocket error'); reject(ev); };
      this.ws.onmessage = this.onMessage.bind(this);
    });
  }

  start(): void { this.frameLoop(); }

  stop(): void { cancelAnimationFrame(this.rafId); }

  destroy(): void {
    this.stop();
    this.ws?.close();
    this.ws = null;
  }

  // ─── Calibration ────────────────────────────────────────────────────────────

  calibrate(samples: CalibrationSample[]): Promise<LOOCVMetrics> {
    return new Promise((resolve, reject) => {
      this.calibrateResolve = resolve;
      this.calibrateReject  = reject;
      this.ws?.send(JSON.stringify({ type: 'calibrate', payload: samples }));
    });
  }

  // ─── Handlers ───────────────────────────────────────────────────────────────

  onGazeResult(h: (r: GazeResult) => void): void        { this.gazeHandler  = h; }
  onHeadPoseResult(h: (r: HeadPoseResult) => void): void { this.headHandler  = h; }
  onError(h: (msg: string) => void): void                { this.errorHandler = h; }

  // ─── Internal ───────────────────────────────────────────────────────────────

  /**
   * Encode video frame as JPEG (quality 0.7) and send over WebSocket.
   * Throttle to 15 fps to reduce bandwidth while keeping latency acceptable.
   */
  private frameLoop(): void {
    let lastSent = 0;
    const TARGET_INTERVAL = 1000 / 15; // 15 fps

    const tick = (now: number) => {
      if (now - lastSent >= TARGET_INTERVAL && (this.videoEl?.readyState ?? 0) >= 2 && this.ctx && this.canvas && this.videoEl) {
        this.ctx.drawImage(this.videoEl as CanvasImageSource, 0, 0);
        const jpeg = this.canvas.toDataURL('image/jpeg', 0.7);
        this.ws?.send(JSON.stringify({ type: 'frame', payload: jpeg, timestamp: now }));
        lastSent = now;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private onMessage(e: MessageEvent): void {
    try {
      const msg = JSON.parse(e.data as string) as { type: string; payload: unknown };
      switch (msg.type) {
        case 'gaze':           this.gazeHandler?.(msg.payload as GazeResult); break;
        case 'head_pose':      this.headHandler?.(msg.payload as HeadPoseResult); break;
        case 'calibrate_done': this.calibrateResolve?.(msg.payload as LOOCVMetrics); break;
        case 'error':          this.errorHandler?.(msg.payload as string); break;
      }
    } catch { /* malformed message — ignore */ }
  }
}
