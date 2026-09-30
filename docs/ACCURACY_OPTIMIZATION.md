# Accuracy optimisation branch (`feat/accuracy-optimization`)

What changed, why, and what is still unverified. Branched from `main` at
`7c7710d` (2026-09-23).

## 1. Evidence-backed work from earlier branches (cherry-picked)

| Change | Evidence |
|---|---|
| Gaze-contingent calibration: each dot is collected only once the gaze has settled, bad dots re-collected, 9 validation dots incl. corners/edges | `docs/CALIBRATION_SAMPLING.md` |
| Live gates drop partial blinks and implausible (off-screen) predictions | `docs/GAZE_DENOISING.md` |
| Feature standardisation before the ridge (λ=3), default RIDGE | 69 stored sessions: 130.2 → 113.7 px median, better on 67% |
| 24-dot grid laid out as a full 6×4 rectangle | replay: error falls with dot count; old layout dropped a corner |
| Chart outliers removed instead of smoothed | 366 stored segments |

Only the accuracy commits were taken; the admin/UI commits on those branches were not.

## 2. Measurement: every frame, raw, with capture time

Tests used to read the smoothed gaze from a 100 ms `setInterval` (10 Hz of a 30 Hz
camera). Now every processed frame is kept while a real test runs
(`lib/gazeFrameStream.ts`): raw and smoothed gaze, head yaw/pitch, and a quality code
instead of the old `{0,0}` placeholder. Frames carry the camera capture time
(`requestVideoFrameCallback`); stimuli are stamped at their first painted frame
(`lib/stimulusOnset.ts`), on the same clock. Stored per test as `gazeFrames`.

## 3. Metrics that survive calibration error (`lib/oculomotorMetrics.ts`)

A webcam mapping has a constant offset and a gain below 1; timing and direction of a
movement are unaffected by both. So:

- **Saccade latency** = velocity onset of the first saccade, relative to the trial's own
  pre-stimulus baseline. Outcomes: correct / error (+ correction) / anticipatory (<80 ms)
  / no response / lost.
- **Anti-saccade error rate** = share of first saccades towards the bright shape.
- **Pursuit** gain, lag, r², catch-up saccades/s.
- **Fixation precision** (RMS-S2S, SD, BCEA) on the raw frames.

Synthetic checks (`scripts/check-oculomotor-metrics.ts`, 30 Hz, 8 px noise, gain 0.75):
latency bias 6 ms, scatter 3 ms; 0/200 false saccades; unchanged by 150 px offset;
pursuit gain within 0.002, lag within 7 ms.

Not reported on purpose: peak velocity and saccade duration (1–2 samples at 30 Hz).
Catch-up saccades under ~1.5° are below what 30 Hz resolves reliably.

## 4. Test design

- **Saccadic**: random 1–2 s central fixation, random balanced side (was a fixed 1 s
  left/right rhythm, which measures anticipation).
- **Anti-saccade**: `paradigm: 'step'` by default — shapes jump to the sides after a random
  fixation, horizontal only. `'moving'` (original) is selectable in admin. Scored by the
  error rate when ≥ half the trials are decided.
- **Fixation stability**: 15 s default (admin 5–30 s). Bug fixed: the BCEA included the
  `{0,0}` placeholder samples.
- **Smooth pursuit** (new): 0.4 Hz horizontal sine, ±30% width, 5 cycles. In the default
  order for fresh installs; where a DB config exists it appears in admin switched off.

## 5. Flexibility at home

- **Drift check** in the last 2 s of every real-test countdown: a dot at the exact
  centre; the median raw gaze re-anchors the live mapping when the check is steady
  (≥8 frames, spread < 60 px, offset < 20% of the short screen side). Stored per test as
  `driftCheck`. See `lib/driftCorrection.ts`, `scripts/check-drift-correction.ts`.
- **Calibration dot** appears at 44 px and shrinks to ~14 px over 700 ms (iOS / Tobii
  idea); the expanding "ping" ring is gone. The advisor had asked to keep the calibration
  UI unchanged; this change was confirmed with them on 2026-09-23.

## Not yet verified

- Nothing on this branch has run with a real participant and camera. Type-check,
  production build and the synthetic scripts pass; pages load on the dev server.
- Thresholds (saccade 80 ms / 30% amplitude, drift 60 px / 20%) come from physiology
  and synthetic data — tune them from the first real sessions (`gazeFrames` has
  everything needed to re-run the analysis offline).
- Seed baselines (error rate 10–60%, pursuit r² 0.5–0.95) are guesses, like the rest.
- All spoken clips, new and changed, are recorded (Deepgram, same voice); none falls
  back to the browser voice.
- Degrees need the physical screen size, which `main` does not measure
  (the card step was rolled back); stimulus sizes stay fractions of the viewport.
