/**
 * MockEngine — deterministic gaze engine for development and testing.
 *
 * No camera, no model, no workers.
 * Emits a Lissajous-curve gaze path for realistic-looking demo data.
 * Resolves calibrate() immediately so the full UI flow can be tested.
 */

import type {
  IGazeEngine, GazeResult, HeadPoseResult,
  CalibrationSample, LOOCVMetrics, EngineCapabilities,
} from '../core/IGazeEngine';

export interface MockEngineConfig {
  /** Frame interval in ms. Default 33 (~30 fps). */
  intervalMs?: number;
  /** Gaze path amplitude in pixels. Default { x: 300, y: 200 }. */
  amplitude?: { x: number; y: number };
  /** Fixed mock confidence value. Default 1. */
  confidence?: number;
}

export class MockEngine implements IGazeEngine {
  readonly id = 'mock-v1';
  readonly capabilities: EngineCapabilities = {
    supportsHeadPose: true,
    supportsConfidence: false,
    supportsOffscreenCanvas: false,
  };

  private cfg: Required<MockEngineConfig>;
  private timer = 0;
  private t = 0;
  private gazeHandler?: (r: GazeResult) => void;
  private headHandler?: (r: HeadPoseResult) => void;

  constructor(config: MockEngineConfig = {}) {
    this.cfg = {
      intervalMs: config.intervalMs ?? 33,
      amplitude: config.amplitude ?? { x: 300, y: 200 },
      confidence: config.confidence ?? 1,
    };
  }

  async initialize(_video: HTMLVideoElement): Promise<void> {
    // No setup needed — MockEngine has no external dependencies
  }

  start(): void {
    this.timer = window.setInterval(() => {
      this.t += 0.05;
      const cx = typeof window !== 'undefined' ? window.innerWidth  / 2 : 960;
      const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : 540;

      this.gazeHandler?.({
        x: cx + Math.sin(this.t)       * this.cfg.amplitude.x,
        y: cy + Math.sin(this.t * 1.3) * this.cfg.amplitude.y,
        timestamp: performance.now(),
        confidence: this.cfg.confidence,
      });

      this.headHandler?.({
        pitch: Math.sin(this.t * 0.3) * 0.1,
        yaw:   Math.cos(this.t * 0.2) * 0.15,
        roll:  0,
        timestamp: performance.now(),
      });
    }, this.cfg.intervalMs);
  }

  stop(): void { clearInterval(this.timer); }

  destroy(): void { this.stop(); }

  async calibrate(_samples: CalibrationSample[]): Promise<LOOCVMetrics> {
    // Instant success — mock needs no training
    return { ridgePx: 12.5, hybridPx: 9.2 };
  }

  onGazeResult(h: (r: GazeResult) => void): void    { this.gazeHandler = h; }
  onHeadPoseResult(h: (r: HeadPoseResult) => void): void { this.headHandler = h; }
}
