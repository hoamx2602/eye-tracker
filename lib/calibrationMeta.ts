/**
 * CalibrationMetaRecorder — captures the per-dot time windows (on the recorded
 * video clock) that the offline OpenFace backend (`backend/app/reprocess.py`)
 * needs to re-fit the calibration mapping from the recorded video.
 *
 * The browser records ONE video covering the calibration + validation phase. For
 * each dot the backend needs: its screen (x, y) in px and the [t_start, t_end]
 * window (ms from the start of that video) during which the subject fixated it.
 * This recorder timestamps each collection window against the moment
 * MediaRecorder.start() was called, and emits a `meta.json` matching the schema
 * in `backend/app/reprocess_example.json`.
 *
 * Clock note: t=0 is `recorder.start()`. There is a small (<~100 ms) latency
 * before the first encoded frame, but the backend takes a robust median over each
 * (≥1 s) window after dropping the approach transient, so a constant offset of
 * that size does not move the calibration center. If sub-frame sync is ever
 * needed, add a visual flash at recording start and detect it in the video.
 */

export interface DotWindow {
  screen_x: number;
  screen_y: number;
  t_start_ms: number;
  t_end_ms: number;
}

export interface SessionMetaOptions {
  /** Viewport the dots were placed in (dots use window.innerWidth/Height). */
  widthPx: number;
  heightPx: number;
  /** Physical width (cm) spanned by widthPx — set per monitor; only affects degree units. */
  widthCm: number;
  /** Eye→screen distance (cm), e.g. config.faceDistance. */
  viewingDistanceCm: number;
  glasses?: boolean;
  frameStride?: number;
  saccadeVelocityThresholdDegS?: number;
  calibrationOutlierSigma?: number;
}

export interface SessionMeta {
  screen: { width_px: number; height_px: number; width_cm: number; viewing_distance_cm: number };
  frame_stride: number;
  saccade_velocity_threshold_deg_s: number;
  calibration_outlier_sigma: number;
  glasses: boolean;
  calibration_dots: DotWindow[];
  validation_dots: DotWindow[];
  _note: string;
}

export class CalibrationMetaRecorder {
  private t0 = 0;          // performance.now() at recorder.start()
  private winStart = 0;    // performance.now() at the current dot's collection start
  private calibration: DotWindow[] = [];
  private validation: DotWindow[] = [];

  /** Call the instant MediaRecorder.start() is invoked. Resets all state. */
  startRecording(now: number = performance.now()): void {
    this.t0 = now;
    this.winStart = now;
    this.calibration = [];
    this.validation = [];
  }

  /** Call when a dot's data-collection (gaze dwell) window begins. */
  markWindowStart(now: number = performance.now()): void {
    this.winStart = now;
  }

  /**
   * Call when a dot's collection window ends successfully.
   * @param isValidation true for held-out validation dots, false for calibration.
   */
  addDot(screenX: number, screenY: number, isValidation: boolean, now: number = performance.now()): void {
    if (this.t0 === 0) return;   // recording not started — ignore
    const w: DotWindow = {
      screen_x: Math.round(screenX),
      screen_y: Math.round(screenY),
      t_start_ms: Math.max(0, Math.round(this.winStart - this.t0)),
      t_end_ms: Math.round(now - this.t0),
    };
    (isValidation ? this.validation : this.calibration).push(w);
  }

  get counts(): { calibration: number; validation: number } {
    return { calibration: this.calibration.length, validation: this.validation.length };
  }

  build(opts: SessionMetaOptions): SessionMeta {
    return {
      screen: {
        width_px: Math.round(opts.widthPx),
        height_px: Math.round(opts.heightPx),
        width_cm: opts.widthCm,
        viewing_distance_cm: opts.viewingDistanceCm,
      },
      frame_stride: opts.frameStride ?? 1,
      saccade_velocity_threshold_deg_s: opts.saccadeVelocityThresholdDegS ?? 30,
      calibration_outlier_sigma: opts.calibrationOutlierSigma ?? 2.5,
      glasses: !!opts.glasses,
      calibration_dots: this.calibration,
      validation_dots: this.validation,
      _note:
        't_*_ms are ms from video start (recorder.start). Set screen.width_cm to ' +
        'the real physical width of the region the dots span for accurate degree units; ' +
        'pixel accuracy is unaffected by it.',
    };
  }

  toJSON(opts: SessionMetaOptions): string {
    return JSON.stringify(this.build(opts), null, 2);
  }

  toBlob(opts: SessionMetaOptions): Blob {
    return new Blob([this.toJSON(opts)], { type: 'application/json' });
  }
}
