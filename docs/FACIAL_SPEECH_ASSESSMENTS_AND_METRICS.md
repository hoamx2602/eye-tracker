# Facial weakness and motor speech: assessment instruments and implemented metrics

Two questions this answers. **What are the established ways of testing these
symptoms**, and **what does this product actually measure today**.

Companion to [FACIAL_SPEECH_SCREENING.md](FACIAL_SPEECH_SCREENING.md), which
covers the design rationale, the validation plan and the release gates. This
file is the reference: instruments on one side, implemented metrics on the
other, and the mapping between them.

Nothing here is a diagnostic threshold. Every implemented number is a
measurement for clinician review; see [Reading the numbers](#reading-the-numbers).

---

## Part 1 — Assessment instruments for facial weakness

### 1.1 The instruments

| Instrument | Type | Scale | What it captures | Role here |
| --- | --- | --- | --- | --- |
| **NIHSS item 4 (Facial Palsy)** | Clinician, ordinal | 0–3 | Normal / minor / partial / complete paralysis. Cues: show teeth, raise eyebrows, close eyes | **Anchor for acute stroke.** Our facial task set follows its cues |
| **House–Brackmann (HB)** | Clinician, ordinal | I–VI | Global facial nerve function after palsy | Historical standard; too coarse and poorly sensitive to regional change to be a target |
| **Sunnybrook Facial Grading System (SFGS)** | Clinician, composite | 0–100 | Three separate components: resting symmetry, voluntary movement (5 expressions), synkinesis | **Primary reference standard.** Its component structure is what the task battery mirrors |
| **eFACE** | Clinician, visual-analogue | 0–100 per item | Static, dynamic and synkinesis subscores, region by region | **Second reference standard.** Validated for *video* rating, which is what makes an offline capture defensible |
| **FaCE Scale** | Patient-reported | 0–100 | Facial movement, comfort, oral function, social function | Out of scope: measures impact, not function |
| **Facial Disability Index (FDI)** | Patient-reported | Physical + social subscales | Disability and wellbeing | Out of scope, same reason |

### 1.2 Prehospital and screening scales

These are where facial droop and speech appear *together*, and they define the
intended-use framing of the product.

| Scale | Items | Note |
| --- | --- | --- |
| **FAST** | Face, Arms, Speech, Time | The public-facing framing. Our emergency banner exists because of it |
| **Cincinnati (CPSS)** | Facial droop, arm drift, abnormal speech | Three items, any positive → suspect stroke |
| **LAPSS**, **ROSIER** | Screening batteries incl. facial weakness | Include exclusion criteria and history; not reproducible from a video alone |

**Why this matters for the product**: these are *screening* tools with high
sensitivity and modest specificity, applied in populations with meaningful
prevalence. Applying the same operating point to at-home self-screening, where
prevalence is far lower, yields a positive predictive value in the single-digit
percentages. That is a labelling problem, not a modelling one.

### 1.3 The discriminator that matters most

**Forehead involvement.** An upper motor neuron lesion (stroke) typically
**spares the forehead**, because the forehead receives bilateral cortical
innervation. A peripheral facial nerve lesion (Bell's palsy, VII injury)
**does not** — the forehead is weak too.

This is why the battery contains both a brow-raise task and a smile task, and
why the report compares them. See
[`upper_versus_lower_face`](#face--derived-comparisons).

---

## Part 2 — Assessment instruments for motor speech

### 2.1 The instruments

| Instrument | Type | What it captures | Role here |
| --- | --- | --- | --- |
| **NIHSS item 10 (Dysarthria)** | Clinician, ordinal 0–2 | Normal / mild-to-moderate / severe or unintelligible. Uses a **fixed word list** | **Anchor for acute stroke.** Our reading task uses that exact list |
| **Frenchay Dysarthria Assessment (FDA-2)** | Clinician, structured | Reflexes, respiration, lips, palate, larynx, tongue, intelligibility | **Primary reference standard** for speech severity |
| **Assessment of Intelligibility of Dysarthric Speech (AIDS)** / **Speech Intelligibility Test (SIT)** | Clinician-scored | Word and sentence intelligibility, speaking rate | Intelligibility reference; language-specific |
| **GRBAS** / **CAPE-V** | Perceptual voice rating | Grade, Roughness, Breathiness, Asthenia, Strain / consensus auditory-perceptual | Perceptual counterpart to our acoustic voice measures |
| **Voice Handicap Index (VHI)** | Patient-reported | Functional, physical, emotional impact | Out of scope: impact, not function |
| **Dysarthria core outcome set (post-stroke)** | Consensus outcome set | What outcomes a dysarthria study must report | Defines what the validation study must collect |

### 2.2 Task types in motor-speech assessment

These are the *task* categories, independent of any scoring instrument. Each
stresses a different part of the speech motor system, which is why a battery
uses several.

| Task type | Stresses | Classic measures |
| --- | --- | --- |
| **Sustained vowel** (/a/) | Phonation, laryngeal function, breath support | F0, jitter, shimmer, HNR/CPP, maximum phonation time |
| **Diadochokinesis (DDK)** | Sequential motor programming and articulatory speed | Syllable rate, timing regularity. `pa-ta-ka` (sequential) vs `pa-pa-pa` (alternating) |
| **Reading a fixed passage/list** | Articulation under standardised phonetic load | Intelligibility, word/phoneme error, articulation rate |
| **Connected/automatic speech** (counting) | Prosody, pausing, breath grouping in running speech | Speech rate, articulation rate, pause structure |

**Important distinction — dysarthria vs aphasia.** Dysarthria is a *motor*
speech disorder: the message is intact, the execution is not. Aphasia is a
*language* disorder. The NIHSS separates them into different items (10 vs 9),
and so does this product: **aphasia is explicitly out of scope**. An acoustic
pipeline cannot distinguish them, and treating a word-finding difficulty as a
motor finding would be wrong in a clinically dangerous direction.

---

## Part 3 — The implemented task battery

Ten tasks, one continuous recording, each with a timestamped window. Task IDs
are stable — the offline processor uses their windows as ground truth.

Defined in `lib/facialSpeechProtocol.ts`.

| # | Task ID | Duration / min | Instrument it maps to | Feeds |
| --: | --- | --- | --- | --- |
| 1 | `face_rest` | 5s / 3s | SFGS resting symmetry | The neutral baseline **every** other facial measure is relative to |
| 2 | `face_brow_raise` | 8s / 4s | NIHSS cue; SFGS voluntary | Upper-face function → forehead-sparing comparison |
| 3 | `face_eye_closure` | 8s / 4s | NIHSS cue; SFGS voluntary | Eye-closure adequacy |
| 4 | `face_smile_show_teeth` | 8s / 4s | NIHSS "show teeth"; SFGS open-mouth smile | Lower-face droop — the primary facial window |
| 5 | `face_lip_pucker` | 8s / 4s | SFGS lip pucker | *Captured, not yet analysed* |
| 6 | `capture_noise_floor` | 5s / 3s | Acoustic QC | Room noise floor for the SNR gate |
| 7 | `speech_sustained_a` | 22s / 6s | Voice acoustics; GRBAS/CAPE-V counterpart | Phonation quality, MPT |
| 8 | `speech_ddk_patka` | 24s / 8s | Sequential motion rate | Articulatory timing and regularity |
| 9 | `speech_reading` | 24s / 8s | **NIHSS dysarthria word list** | Articulation rate; ASR/intelligibility later |
| 10 | `speech_counting` | 18s / 8s | Connected speech | Rate and pause structure |

**Duration / min**: the finish control appears at the first; a quieter early
exit unlocks at the second, which mirrors the processor's own rejection
threshold. `backend/tests/test_facial_speech_protocol_contract.py` asserts the
two never drift apart.

**Why these five facial movements**: they are the NIHSS cues plus a practical
subset of the SFGS voluntary-movement set. Cheek puff and forceful eye closure
are omitted — the objective correlates are weaker for those expressions.

---

## Part 4 — Quality gates

**The gates fail closed.** A blocking gate withholds the measurements it
invalidates, and the report carries `status: insufficient-quality` with a coded
reason. This is a distinct outcome from a measurement that came back normal.

The reason this is load-bearing: every voluntary-movement measure is expressed
relative to the subject's own neutral frame. A capture with no usable rest
window has no baseline, and substituting anything for it makes the deltas zero
and the left/right ratios exactly 1.0 — a total capture failure rendered as a
perfectly symmetric face. A withheld measurement is safe; a fabricated normal
one is not.

Constants in `backend/app/facial_speech.py`.

### Video gates

| Code | Condition | Threshold | Blocks |
| --- | --- | --- | --- |
| `face-visibility-low` | Usable face found in too few sampled frames | < 75% | All facial metrics |
| `illumination-low` | Median frame brightness | < 55 / 255 | All facial metrics |
| `image-blurred` | Median Laplacian variance | < 40 | All facial metrics |
| `rest-baseline-missing` | Usable frames in the rest window | < 15 (~1s at 15 Hz) | All facial metrics |
| `task-window-unusable` | Usable frames in one movement window | < 15 | That metric only |
| `head-roll-excessive` | Median head roll during a task | > 15° | That window |
| `head-yaw-drift` / `head-pitch-drift` | Median pose vs the rest baseline | > 0.08 IPD | That window |
| `head-yaw-unsteady` / `head-pitch-unsteady` | P90–P10 pose spread within a task | > 0.10 IPD | That window |

The pose gates exist because out-of-plane rotation foreshortens one side of the
face, manufacturing exactly the left/right difference the module looks for.
They are judged against the subject's own baseline: a consistently off-centre
head is a framing quirk and passes; a head that *turns between* the rest and
movement windows does not.

### Audio gates

| Code | Condition | Threshold | Blocks |
| --- | --- | --- | --- |
| `speech-window-too-short` | Window duration | Per task: /a/ 3s, DDK 5s, reading 2s, counting 5s | That task |
| `audio-clipping` | Fraction of samples at full scale | > 1% | That task |
| `audio-snr-low` | Speech level over the measured room noise floor | < 15 dB | That task |
| `speech-activity-low` | Fraction of window above the speech gate | < 20% | That task |
| `no-speech-trial-detected` | No continuous segment isolable | — | That task |
| `no-steady-phonation` | No phonation ≥ 1.5s after trimming 0.5s onset/offset | — | Sustained vowel |
| `task-window-missing` | Metadata carries no completed window — the task was never performed | — | That task |

### Advisories (do not block)

| Code | Meaning |
| --- | --- |
| `task-ended-early` | Subject ended before the intended duration. **May itself be a finding** — inability to sustain the task is a fact about the subject, not only the recording |
| `noise-floor-not-captured` | Silence task missing; SNR falls back to a within-window estimate, unreliable for continuously voiced tasks |
| `stream-timing-unknown` | Container reported no per-stream start times; any A/V offset is uncorrected |

---

## Part 5 — Implemented metrics

### Measurement conventions

Applied to every facial metric. Changing any invalidates comparison with
previously collected data.

- **Sides are anatomical, from the subject's perspective** (`side_convention:
  subject-anatomical`). MediaPipe names sides this way too, so landmark 61 is
  the subject's *right* mouth corner. The captured stream is never mirrored.
- **Geometry in pixels, never normalised landmark coordinates.** MediaPipe
  normalises x by width and y by height separately; a Euclidean distance on
  those values stretches the horizontal axis by the frame aspect ratio.
- **A face-local coordinate frame**: origin at the midpoint of the outer eye
  corners, axes from the interocular line, scale from interpupillary distance
  (IPD). Removes head translation, in-plane rotation and scale.
- **Excursions read at their peak** (P90), not their median — a movement window
  is mostly rest, so a central statistic measures rest.
- **Repetitions measured separately**, reported as a median plus the spread
  across trials. That spread is also the within-session repeatability evidence.

### Face — resting panel

Needs no voluntary movement, so it survives a movement window that fails its
gates. This is what a clinician reads first from a still.

| Metric | Definition | Unit |
| --- | --- | --- |
| `resting_mouth_corner_vertical_asymmetry_ipd` | Vertical offset between mouth corners along the **face** axis, so head tilt does not register | IPD |
| `resting_brow_height` | Brow-to-upper-lid distance, per side | IPD, ratio |
| `resting_palpebral_fissure` | Upper-to-lower lid aperture, per side | IPD, ratio |
| `resting_mouth_corner_spread` | Horizontal distance of each corner from the midline | IPD, ratio |
| `resting_philtrum_deviation_ipd` | Signed philtrum offset from the facial midline | IPD |

### Face — voluntary movement

All relative to the rest baseline.

| Metric | Definition | Unit |
| --- | --- | --- |
| `smile_excursion_ipd` | Peak mouth-corner displacement from its rest position, per side | IPD, ratio |
| `brow_excursion_ipd` | Peak brow elevation above rest, per side | IPD, ratio |
| `eye_closure_residual_ratio` | Residual aperture at maximum closure (P10), relative to rest, per side | ratio |

Each is a **side measure**: it reports `left`, `right`,
`ratio_weaker_over_stronger`, and — critically — `weaker_side`. A bare ratio is
symmetric and cannot say which side is affected, which is the one output a
clinician acts on.

### Face — derived comparisons

| Metric | Definition | Note |
| --- | --- | --- |
| `upper_versus_lower_face` | Brow symmetry ratio **minus** smile symmetry ratio, plus whether both name the same weaker side | **The forehead-sparing measure.** Positive = upper face more symmetric than lower, the UMN-lesion direction. Labelled `uncalibrated-descriptor`: **no cut-off applied**, because converting it to a pattern label requires the validation study |
| `ocular_narrowing_during_smile` | Eye aperture during the smile window relative to rest, per side | Synkinesis proxy — an SFGS component the smile window already contained |

### Speech — sustained vowel

Measured on the trimmed steady middle of **each** phonation separately, then
aggregated. Perturbation measures are cycle-to-cycle and are only defined on a
continuously voiced stretch; computing them across a window holding three
vowels and the pauses between them measures the silences as glottal cycles.

| Metric | Definition | Unit |
| --- | --- | --- |
| `f0_hz_median`, `f0_hz_sd` | Fundamental frequency and its variation. Two-pass pitch floor/ceiling to avoid octave errors | Hz |
| `jitter_local` | Cycle-to-cycle frequency perturbation | fraction |
| `shimmer_local` | Cycle-to-cycle amplitude perturbation | fraction |
| `hnr_db_median` | Harmonics-to-noise ratio | dB |
| `intensity_db_median` | Median intensity | dB |
| `max_phonation_time_s` | **Longest single trial**, not the sum | s |
| `usable_trials` | Phonations that survived trimming and gating | count |

Each aggregate carries `median`, `iqr`, `n_trials`, `per_trial`.

### Speech — diadochokinesis

| Metric | Definition | Unit |
| --- | --- | --- |
| `energy_peak_rate_hz` | Energy peaks per second, **per run** — divided by the run's own duration, not the window's | peaks/s |
| `peak_interval_cv` | Coefficient of variation of inter-peak intervals. Lower = more regular | ratio |
| `usable_runs` | DDK runs isolated | count |

**Deliberately not called a syllable rate.** The unvoiced stop closures in
`pa-ta-ka` do not always produce a separate energy peak. **Do not read it
against published DDK norms.**

### Speech — connected speech

| Metric | Definition | Unit |
| --- | --- | --- |
| `speech_rate_syllables_per_s` | Declared syllables ÷ **total** window duration (includes pauses) | syll/s |
| `articulation_rate_syllables_per_s` | Declared syllables ÷ **speaking** time (excludes pauses) | syll/s |
| `speaking_time_ratio`, `pause_ratio` | Phonation vs silence | fraction |
| `pause_count`, `pause_duration_s_median` | Pause structure | count, s |
| `f0_hz_median`, `f0_hz_sd`, `intensity_db_median` | Prosody over running speech | Hz, dB |

Separating the two rates is the point of the task: two subjects can share a
speech rate while one pauses heavily and the other articulates slowly, and only
the second is a motor-speech finding.

The syllable count is declared **alongside the prompt** in the protocol, not
hardcoded in the processor, so a Vietnamese word list brings its own count. The
rates assume the prompt was read as given (`rate_basis:
assumes-prompt-read-as-given`); forced alignment replaces that assumption later.

### Quality metrics reported alongside

Per speech task: `duration_s`, `rms_dbfs`, `clipping_ratio`,
`speech_activity_ratio`, `noise_floor_rms`, `noise_floor_source`, `snr_db`.
Per session: `sampled_frames`, `valid_face_frame_ratio`,
`brightness_median_0_255`, `blur_variance_median`,
`frame_timestamps_from_container`, plus a `timeline` block recording the
stream start times and the audio offset actually applied.

### Not yet implemented

| Metric | Blocked on |
| --- | --- |
| `au_left_right_delta` (AU12/AU6, brow, blink, lip-corner) | Pinning the OpenFace 3.0 AU head output order against the published mapping. OpenFace 3.0 is already a backend dependency for the gaze pipeline |
| `asr_alignment` (WER, PER, forced-alignment confidence) | A language-matched ASR and forced aligner. English error rates must not be applied to Vietnamese speech |
| `face_lip_pucker` analysis | Captured but unanalysed — either compute it or drop the task |

Tracked in `FACIAL_SPEECH_ROADMAP_METRICS`, deliberately kept out of the
subject-facing metric list.

---

## Part 6 — Reading the numbers

**There are no clinical thresholds in this product, by design.** Not one number
here is compared against a cut-off, and that is a deliberate position, not an
omission.

Why:

1. **Published thresholds assume a controlled setup.** The familiar voice
   reference values (jitter, shimmer, HNR) were established on studio-grade
   recordings with a fixed mouth-to-microphone distance. A consumer webcam
   microphone at an unknown distance is a different measurement.
2. **Landmark models are not neutral instruments.** MediaPipe's training
   distribution is dominated by symmetric faces and its mesh prior pulls toward
   symmetry, so it plausibly **under-reports** the asymmetry being measured. How
   much is an open question that requires a study on real palsy faces.
3. **A threshold not derived from the intended population is a guess.** Skin
   tone, age, facial hair, glasses, lighting, microphone and language all move
   these numbers.

What the report *is* for: giving a clinician the measurement, its uncertainty,
its provenance, and the raw evidence — the annotated frames, the per-frame
traces, the envelopes — so they can score SFGS/eFACE/FDA-2 from the video
themselves and check the automated numbers rather than trust them.

The release gates that would permit a clinical claim, the sample sizes required
to demonstrate them, and the reporting standards
(STARD 2015, QUADAS-2, TRIPOD+AI, DECIDE-AI) are in
[FACIAL_SPEECH_SCREENING.md](FACIAL_SPEECH_SCREENING.md#validation-gates-before-a-clinical-claim).

---

## Where things live

| Concern | File |
| --- | --- |
| Task battery, durations, minimums, metric catalogue | `lib/facialSpeechProtocol.ts` |
| Capture UI, timers, consent, manifest | `app/facial-speech/page.tsx` |
| Feature extraction, gates, all metrics | `backend/app/facial_speech.py` |
| Job endpoints, retention TTL | `backend/app/main.py` |
| Report rendering and charts | `components/facial-speech/` |
| Geometry conventions | `backend/tests/test_facial_speech_geometry.py` |
| Fail-closed behaviour | `backend/tests/test_facial_speech_quality_gates.py` |
| Trial segmentation and rates | `backend/tests/test_facial_speech_acoustics.py` |
| Traces and key frames | `backend/tests/test_facial_speech_visuals.py` |
| UI/processor minimum agreement | `backend/tests/test_facial_speech_protocol_contract.py` |

## Primary sources

- [NIH Stroke Scale, updated February 2024](https://www.ninds.nih.gov/sites/default/files/documents/NIH-Stroke-Scale_updatedFeb2024_508.pdf)
- [Sunnybrook Facial Grading System](https://pubmed.ncbi.nlm.nih.gov/8942275/)
- [eFACE development and validation](https://pubmed.ncbi.nlm.nih.gov/26218397/) · [video vs in-person reliability](https://pubmed.ncbi.nlm.nih.gov/28006048/)
- [Systematic review of facial-nerve grading scales](https://pubmed.ncbi.nlm.nih.gov/25357164/)
- [Core outcomes for dysarthria after stroke](https://pubmed.ncbi.nlm.nih.gov/40409971/)
- [Prospective stroke dysarthria assessment](https://pubmed.ncbi.nlm.nih.gov/33580596/)
- [Praat voice-analysis reference](https://praat.org/manual/Intro.html) · [HNR definition](https://praat.org/manual/Harmonicity.html)
