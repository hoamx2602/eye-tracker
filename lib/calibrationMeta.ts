/**
 * CalibrationMetaRecorder — captures the per-dot time windows (on the recorded
 * video clock) that the offline OpenFace backend (`backend/app/reprocess.py`)
 * needs to re-fit the calibration mapping from the recorded video.
 *
 * The browser records ONE video covering the calibration + validation phase. For
 * each dot the backend needs: its screen (x, y) in px and the [t_start, t_end]
 * window (ms from the start of that video) during which the subject fixated it.
 * This recorder timestamps each window against the moment MediaRecorder.start()
 * was called, and emits a `meta.json` matching the schema in
 * `backend/app/reprocess_example.json`.
 *
 * Windows are the *selected stable fixation* of each dot (lib/fixationSampling),
 * not the whole time the dot was on screen — `settled_windows: true` tells the
 * backend not to drop a further approach transient from them. Each dot is keyed,
 * so re-collecting a dot replaces its window instead of adding a second one.
 *
 * Clock note: t=0 is `recorder.start()`, and windows are on the frame-processing
 * clock, which runs a little (<~100 ms) behind capture. A window therefore maps
 * onto slightly later video frames than the ones the browser used — still inside
 * the fixation, since the next dot only appears after the window ends.
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
  /** Windows already start at a settled fixation (gaze-contingent), see header. */
  settled_windows: boolean;
  calibration_dots: DotWindow[];
  validation_dots: DotWindow[];
  _note: string;
}

export class CalibrationMetaRecorder {
  private t0 = 0;          // performance.now() at recorder.start()
  private calibration = new Map<string, DotWindow>();
  private validation = new Map<string, DotWindow>();

  /** Call the instant MediaRecorder.start() is invoked. Resets all state. */
  startRecording(now: number = performance.now()): void {
    this.t0 = now;
    this.calibration.clear();
    this.validation.clear();
  }

  /**
   * Record (or replace) a dot's fixation window.
   * @param key          stable per dot, so a re-collected dot overwrites its earlier window
   * @param tStart,tEnd  performance.now() times of the first/last frame used for the dot
   */
  putDot(key: string, screenX: number, screenY: number, isValidation: boolean, tStart: number, tEnd: number): void {
    if (this.t0 === 0) return;   // recording not started — ignore
    const w: DotWindow = {
      screen_x: Math.round(screenX),
      screen_y: Math.round(screenY),
      t_start_ms: Math.max(0, Math.round(tStart - this.t0)),
      t_end_ms: Math.max(0, Math.round(tEnd - this.t0)),
    };
    (isValidation ? this.validation : this.calibration).set(key, w);
  }

  get counts(): { calibration: number; validation: number } {
    return { calibration: this.calibration.size, validation: this.validation.size };
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
      settled_windows: true,
      calibration_dots: [...this.calibration.values()],
      validation_dots: [...this.validation.values()],
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
