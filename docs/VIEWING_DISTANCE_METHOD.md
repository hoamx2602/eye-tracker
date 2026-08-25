# Viewing distance: what the card measures, and where the method comes from

Every angular number this system reports — validation error in degrees, saccade
amplitude, peak velocity, BCEA — is screen pixels divided by two physical
quantities: how big a pixel is, and how far away the eye is. Neither is
observable from a browser. Both are measured with a bank card.

The card is used for **two completely different measurements**, and only one of
them is from the eye-tracking literature. This document separates them, because
conflating them is how you end up trusting a number further than it deserves.

| Measurement | What the card gives | Source |
|---|---|---|
| Card **against the screen** | CSS pixels per cm | Li et al. 2020 — the standard method |
| Card **against the cheek** | Physical face width, and hence camera focal length | Ditto Technologies patent, 2012 — from eyewear fitting, not eye tracking |
| Blind spot / tape measure | One absolute distance | Li et al. 2020 |

---

## 1. Why one measurement is unavoidable

Under a pinhole camera model, an object of real width `W` at distance `d`
projects to a width `w` in the image:

```
w = F · W / d
```

where `F` is the focal length expressed in frame widths. Hold a card at the face
and both card and face are at the same `d`, giving two equations:

```
w_card = F · W_card / d          W_card = 8.56 cm, known
w_face = F · W_face / d          W_face = unknown
```

Two equations, three unknowns. Dividing them cancels `F` and `d` **together**:

```
W_face = W_card · (w_face / w_card)      ← comes out
d      = ?                                ← never comes out
```

This is the **monocular scale ambiguity**. It is a property of projective
geometry, not a limitation of the detector, and no amount of extra image
processing gets around it. A single uncalibrated camera cannot recover absolute
scale. Something outside the image has to supply either one absolute length (a
tape measure) or one absolute angle (the eye's own optic disc).

Everything below is a consequence of that fact.

---

## 2. Card against the screen → pixels per centimetre

An ISO/IEC 7810 **ID-1** card — bank cards, most national ID cards — is
**85.60 × 53.98 mm** worldwide, to a tolerance far below anything that matters
here. The participant holds one against the screen and resizes an on-screen
rectangle to match; the rectangle's width in CSS pixels converts directly to
pixels per centimetre.

This is the standard method and it is well attested:

- **Li, Joo, Yeatman & Reinecke (2020)** introduce it as step one of the
  "virtual chinrest".
- **Brascamp (2021)**, comparing methods for controlling stimulus size online,
  describes the participant comparing "on-screen dimensions to those of a
  real-world object that has a standard size, such as a bank card".
- **Saxena, Lange & Fink (2022)** use the same procedure with the same quoted
  dimensions for webcam eye-tracking calibration.
- It also appears in **Warby Parker's US10251545B2**, where "a user holds a
  credit card to the screen and using a mouse or other user interface device
  resizes the box to be the same as the outer perimeter of the credit card".

It replaces what this codebase used to do, which was a hard-coded `34.5` cm next
to a `TODO`, paired with `window.innerWidth`. Those two are the monitor and the
viewport respectively, and they agree only by accident.

**Code:** `lib/screenScale.ts`. Cached in `localStorage` per display, keyed on
screen dimensions and device pixel ratio, so docking to another monitor
invalidates it rather than silently reusing a wrong value.

---

## 3. Card against the cheek → face width, and the camera

This is the measurement that removes the blind-spot task from the participant's
path, and it is the one that is *not* from the eye-tracking literature. It comes
from **eyewear fitting**.

**Ditto Technologies, US9254081B2** (priority January 2012, granted February
2016), "Fitting glasses frames to a user", describes exactly this:

> a credit card-sized object 418 is held up to the user's head 420 for scaling

> the user is instructed to hold the credit card-sized object to the user's face

> the credit card-sized object is held on or near various places, for example the
> bridge of the user's nose

> the short video or the image of the user with a scaling reference object is
> used at least in part to calibrate the camera

The patent also names a coin (a quarter) held next to the eye as an alternative
reference. The purpose is the same as here: recover the camera's intrinsic
parameters from a known-size object in the scene.

### What this codebase does with it

The existing distance model is `K = d · s`, where `s` is face width as a
fraction of frame width, and thereafter `d = K / s` continuously. Substituting
`s = F · W_face / d`:

```
K = F · W_face
```

The single constant splits into two that belong to different things:

| Term | Belongs to | Lifetime |
|---|---|---|
| `F` | the camera | measured once per device, cached forever |
| `W_face` | the participant | measured with the card, ten seconds |

So the flow becomes: measure `F` once on a machine, and every participant
afterwards only does the card step, because `K = F · W_face` reconstructs their
constant with no further absolute measurement.

`F` is deliberately expressed in **frame widths** rather than pixels: `f_px`
scales with resolution, so `f_px / frameWidth_px` is invariant to the camera
negotiating 720p instead of 1080p. It is *not* invariant to a different sensor
crop — 16:9 and 4:3 cut different fractions of the field of view — which is why
the cache key carries the aspect ratio alongside the device id.

**This split is not a cited method.** It is elementary pinhole algebra applied to
the two measurements above. The card-at-face technique is documented; using it
specifically to amortise the viewing-distance bootstrap across participants is a
design decision made here, and should be described that way rather than
attributed to anyone.

**Code:** `lib/cameraFocal.ts`, `components/FaceCardStep.tsx`. Tests in
`scripts/test-camera-focal.ts` verify the claim directly: one participant
bootstraps, then three simulated participants with face widths of 12.4, 14.2 and
16.8 cm all recover correct distances with no absolute measurement of their own.

### The card must be at the cheek, not the forehead

The face width is measured between the cheekbones. The cancellation in §1 only
holds if the card is at that same depth. It is not a detail:

| Card depth vs cheekbone plane | Error in `W_face`, and in every distance derived from it |
|---|---|
| 1 cm | 2.5% |
| **2 cm (a forehead)** | **5.0%** |
| 3 cm | 7.5% |

Once `F` is cached, that error propagates into every later session on the
machine. Hence the instruction is specifically *flat against the cheek, at eye
level, card face toward the camera* — and the UI says so.

### Why the box is dragged, not detected

The card is located by the operator dragging a box, not by automatic detection.
Bank cards are a hostile detection target: holograms, dark cards on dark
backgrounds, printed patterns, specular glare. A detector that fails silently on
one card in twenty would corrupt those sessions in a way nothing downstream could
notice — and this number multiplies everything.

Dragging takes ten seconds, cannot fail silently, and permits an **aspect-ratio
check** that an automatic box would have needed anyway: an ID-1 card has a
long/short ratio of 85.60/53.98 = 1.586 whichever way up it is held. A box that
disagrees is either badly drawn or around a card tilted out of the frontoparallel
plane — and a tilted card reads narrow, which inflates `W_face` and every
distance after it, silently and in one direction. The tolerance admits about 30°
of tilt.

---

## 4. The absolute anchor: blind spot, or a tape measure

Something has to break the scale ambiguity once. Two options are implemented.

### Blind spot (Li, Joo, Yeatman & Reinecke, 2020)

The optic disc sits nasally on the retina, so it appears roughly **13.5°** into
the *temporal* visual field. Cover the right eye, fixate a square with the left,
sweep a dot outward, and the screen offset at which it vanishes gives the
distance by right-triangle geometry:

```
d = offset_cm / tan(13.5°)
```

No camera is involved at all — only screen geometry, which is why §2 must come
first. The paper reports a mean error of **3.25 cm**, and Brascamp (2021)
independently found it the best of three methods tested, with a relative error of
0.11 in angular stimulus extent — "for the best method it is close to 10%".

The implementation follows the published procedure (right eye covered, 30 px red
dot sweeping right to left across a 30 px fixation square, five measurements),
with three deliberate departures:

1. **Trials are combined by median, not mean.** One late keypress would otherwise
   bias every distance the session reports afterwards.

2. **Each trial reads the same edge from both directions and averages them.** The
   dot travels 180 px/s ≈ 3.3 cm/s, and the participant can only press *after*
   noticing. At a 300 ms reaction time the dot is already ~1 cm past the true
   edge, which is +4 cm of reported distance — comparable to the entire error
   budget of the method, and one-directional, so repetition does not remove it.
   The classical fix is paired ascending and descending series (the *method of
   limits*): press when it vanishes, the dot carries on ~2° and turns around,
   press again when it reappears. The overshoot cancels. Neither the paper nor
   the jsPsych plugin does this. Verified in
   `scripts/test-viewing-distance.ts`: outward-only reads 44.0 cm for a true
   40 cm at RT 300 ms; the paired mean reads 40.0.

3. **The fixation square is centred only when centring leaves enough travel.**
   The dot must reach `d · tan(13.5°)` to its left — 528 px at 40 cm, 792 px at
   60 cm — and on a narrow window half the width is not enough. Sliding the
   square right introduces an off-axis error, computed to stay under 1.5% at
   every window width and target this flow supports.

The dominant remaining error is not fixable in software: individual optic discs
sit between roughly 12° and 15°, and assuming 13.5° for a 15° eye reports
44.6 cm for a true 40 cm (+11.6%).

### Tape measure

Measure eye to screen centre and type it in. More accurate than the blind spot;
it simply cannot be automated at scale, which is the only reason the blind spot
exists. Since §3 means this is needed **once per machine rather than once per
participant**, an operator-supervised tape measurement is now the default and the
blind spot is the fallback for machines where no tape is at hand.

**Code:** `lib/viewingDistance.ts`, `components/DistanceCalibrationScreen.tsx`.

---

## 5. Error budget

At a 40 cm target, in rough order of size:

| Source | Magnitude | Character |
|---|---|---|
| Blind-spot eccentricity (12–15° vs assumed 13.5°) | ±11.5% | Between-subject; constant scale factor per session |
| Reaction time, if unpaired | +7 to +14% | One-directional — **removed** by the paired sweep |
| Card out of the cheek plane | 2.5% per cm | One-directional; propagates into cached `F` |
| Screen-scale error (1 mm on an 85.6 mm card) | 1.2% | Propagates linearly |
| Off-axis fixation square | <1.5% | Only on narrow windows |
| Yaw correction via the geometric head pose | ~2% | Heuristic yaw, used only through `cos(yaw)` |

**The mitigating argument:** because the absolute distance is used *once* to fix
`K` rather than per frame, its error becomes a **constant scale factor, not
noise**. Within-subject comparisons — the pre/post design this system exists for
— are unaffected by a common factor. Only comparisons against published norms are
shifted. This is why the ±11.5% is technical debt rather than a blocker.

**The corresponding danger:** once `F` is cached, a bad bootstrap poisons every
later session on that machine, silently and by the same factor. Mitigations:
`loadFocal` refuses a value stored under a different camera key, so swapping a
webcam or docking invalidates the cache rather than relying on someone noticing;
the position screen prints the provenance (`camera calibrated 24/08 by tape ·
65° FOV`) with a re-measure button; and `checkFocalAgainst` flags a fresh
measurement that disagrees by more than 20% — loose on purpose, since the
bootstrap carries ±11.5% of its own.

---

## 6. Alternatives considered

### MediaPipe Iris — the strongest one, and not yet used

The horizontal iris diameter is **11.7 ± 0.5 mm** across a wide population, so
with a known focal length, `d = F · 11.7mm / iris_px`. Google validated this
against the iPhone 11 depth sensor on 200+ participants: **mean relative error
4.3%, SD 2.4%** (4.8% / 3.1% with eyeglasses). That is better than the blind
spot's ~11%.

The stated limitation is that it "requires camera focal length (obtained via
capture APIs or EXIF metadata)" — which browsers do not expose. **But §3 measures
exactly that.** So once `F` is known on a machine, the iris method becomes
available, and it would need *no per-participant step at all*: iris diameter is a
population constant, where face width has to be measured.

The trade is 4.3% population variance in iris diameter against ~0 population
variance for a measured face width, offset by the card's own plane-offset and
box-drawing error. They are comparable in accuracy and the iris method wins
decisively on participant effort. The 478-landmark model already in use here
outputs iris landmarks. **This is the clearest next improvement**, and the two
could also cross-check each other.

Not done yet only because the card path was built first.

### MediaPipe `facialTransformationMatrixes`

Gives a metric head translation directly. It assumes a canonical face model
*and* a default camera intrinsic — precisely the two assumptions this whole
document exists to remove. Usable as a rough sanity check, not as the source of
truth.

### Body height, or arm's length

Brascamp (2021) tested both. Relative errors in angular stimulus extent were 0.18
and 0.14 respectively, against 0.11 for the blind spot. Worse, and they do not
detect the participant moving.

### The old normalised-face-width band

What this replaced. It gated a normalised face width into a hand-tuned band and
then *assumed* the participant was at the configured distance. That band hides
two unknowns: camera field of view (54–78° across common webcams, a 25% distance
error on its own) and bizygomatic face width (125–155 mm). Someone passing the
"40 cm" gate could genuinely be at 30 or 52 cm. Distance is linear in saccade
amplitude and velocity and quadratic in BCEA, so a 25% distance error makes BCEA
56% wrong against a norm of 2.4 deg².

---

## 7. Where this lives in the code

| File | Responsibility |
|---|---|
| `lib/screenScale.ts` | Card against the screen → px/cm. Cached per display. |
| `components/FaceCardStep.tsx` | Card against the cheek → `W_face`. Live preview, freeze, drag, aspect check. |
| `lib/cameraFocal.ts` | The `K = F · W_face` split, cache keyed on device + aspect, staleness checks. |
| `lib/viewingDistance.ts` | Blind-spot geometry, trial aggregation, quality gate, `K`, the distance band. |
| `components/DistanceCalibrationScreen.tsx` | The flow: card → face-card → (bootstrap) → position. |
| `lib/positionAnchor.ts` | Drift from the setup pose. Uses `W_face` to report drift in real cm. |

Tests: `npm run test:distance`, `npm run test:focal`, `npm run test:anchor`.

---

## References

**Primary**

- Li, Q., Joo, S. J., Yeatman, J. D., & Reinecke, K. (2020). Controlling for
  Participants' Viewing Distance in Large-Scale, Psychophysical Online
  Experiments Using a Virtual Chinrest. *Scientific Reports*, 10, 904.
  https://www.nature.com/articles/s41598-019-57204-1 — mean error 3.25 cm.
  Reference implementation: https://github.com/QishengLi/virtual_chinrest

- Ditto Technologies Inc. (2016). *Fitting glasses frames to a user*.
  US9254081B2. Kornilov, Surkov & Bhagavathy. Priority 2012-01-30.
  https://patents.google.com/patent/US9254081B2/en — card-sized object held to
  the face to calibrate camera intrinsics.

**Corroborating and comparative**

- Brascamp, J. W. (2021). Controlling the spatial dimensions of visual stimuli in
  online experiments. *Journal of Vision*, 21(8), 19.
  https://doi.org/10.1167/jov.21.8.19 — compares blind spot (0.11 relative
  error) against body height (0.18) and arm's length (0.14).

- Saxena, S., Lange, E. B., & Fink, L. K. (2022). Towards efficient calibration
  for webcam eye-tracking in online experiments. *ETRA '22*.
  https://doi.org/10.1145/3517031.3529645 — ID card 85.60 × 53.98 mm for screen
  scale, blind spot for distance.

- Warby Parker / JAND Inc. (2019). *System and method for determining distances
  from an object*. US10251545B2.
  https://patents.google.com/patent/US10251545B2/en — card against the screen
  for display calibration.

**Alternative method**

- Google Research (2020). *MediaPipe Iris: Real-time Iris Tracking & Depth
  Estimation*.
  https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/
  — iris 11.7 ± 0.5 mm; depth error 4.3% ± 2.4%, validated against iPhone 11
  depth on 200+ participants.

**Standards and tooling**

- ISO/IEC 7810:2019, *Identification cards — Physical characteristics*. ID-1
  format: 85.60 × 53.98 mm.

- jsPsych `virtual-chinrest` plugin — 5 blindspot reps, right eye covered, ball
  right to left, 13.5° temporal.
  https://www.jspsych.org/7.3/plugins/virtual-chinrest/

**Psychophysics**

- Gescheider, G. A. (1997). *Psychophysics: The Fundamentals* (3rd ed.). Method
  of limits — paired ascending and descending series to cancel anticipation and
  reaction-time bias. The basis for the two-legged trial in §4.
