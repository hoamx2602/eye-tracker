# Viewing-distance calibration

## Current user flow

The calibration has one source of absolute scale: the participant measures the
real distance from either eye to the middle of the screen and enters it in
centimetres.

There is no bank-card step, card detector, face-width population prior, or
cross-session focal-length reuse in the active flow.

At the moment the participant confirms a distance `d0`, the app records a short
rolling median of two image-space measurements:

- `s0`: outer-eye-corner span as a fraction of frame width;
- `i0`: MediaPipe iris diameter as a fraction of frame width, when available.

It derives subject/session-specific constants:

```text
K_face = d0 * s0
K_iris = d0 * i0
```

For a later frame:

```text
d_face = K_face / s
d_iris = K_iris / i
```

The live reading fuses those estimates when the iris contour is reliable and
falls back to face scale otherwise. The fusion is implemented in
`lib/irisDepth.ts`; the session calibration and distance checks are in
`lib/viewingDistance.ts`.

## Why manual distance is the absolute anchor

A monocular camera cannot determine metric distance from a single apparent size
without one known physical length, known camera intrinsics, stereo/depth data,
or one absolute calibration observation. Center Stage and Manual Framing can
also change the effective crop without exposing that crop to WebRTC.

Entering a real distance resolves both problems for the current session:

- it supplies the missing metric scale directly;
- it calibrates whatever crop/framing is active at that moment.

The user may start with Center Stage either on or off. They must not change the
camera framing after confirming the measurement. If it changes, the distance
must be entered again.

## What remains relative and what is metric

After the manual anchor, depth changes are metric because `K_face` and, when
available, `K_iris` were measured at a known distance. The head-position anchor
also preserves the calibrated pose for the gaze mapping.

Removing the card also removes a fresh measurement of display density. If a
valid display scale was measured in an older session, the app reuses it. If not,
it stores the CSS reference density only as an explicitly marked fallback:

```text
screenScaleMeasured = false
```

That fallback is sufficient for legacy fields and layout, but reports must not
claim physically measured visual-angle scores from it. `lib/resultScoring.ts`
enforces this by returning no measured angular geometry when physical screen
scale is unavailable.

## Runtime sequence

1. Start the camera and face/iris tracking.
2. Ask for the actual eye-to-screen distance.
3. Collect a rolling median over recent face and iris frames.
4. Build a `manual` `DistanceCalibration`.
5. Show the live distance and guide the participant to the configured target.
6. Lock the head-position anchor and run gaze calibration/testing.

Every new run performs step 2. A previous participant/session calibration is not
silently reused.

## Relevant files

| File | Responsibility |
|---|---|
| `components/DistanceCalibrationScreen.tsx` | Manual distance entry and live target positioning |
| `lib/viewingDistance.ts` | Session constants, live distance, distance band |
| `lib/irisDepth.ts` | Iris estimate and robust face/iris fusion |
| `services/eyeTrackingService.ts` | Outer-eye span and MediaPipe iris observations |
| `lib/resultScoring.ts` | Prevents estimated display scale from becoming a measured angle |
| `lib/positionAnchor.ts` | Holds the calibrated head pose during the test |

Tests:

```bash
npm run test:distance
npm run test:iris
npm run test:anchor
```
