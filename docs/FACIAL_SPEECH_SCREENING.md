# Facial drooping & speech analysis — clinical-screening design

## Scope and safety

This module is an **offline, video-and-audio screening/measurement tool**. It must
not claim to diagnose stroke, Bell's palsy, facial nerve injury, dysarthria, or
aphasia until it has completed the validation study below and any required medical
device/regulatory review. Sudden facial weakness or speech disturbance is an
emergency: the UI must direct the user to emergency services rather than waiting
for an algorithmic result.

The design uses video because this is a supported mode of clinical facial-function
assessment: eFACE video ratings showed excellent agreement with in-person ratings.
The relevant NIH Stroke Scale (NIHSS) instructions ask the participant to show
teeth, raise eyebrows, and close eyes; its dysarthria item is a motor-speech,
not language, assessment. Therefore an aphasia/language score is intentionally
out of scope for this first module.

## Evidence anchors

| Need | Reference standard / source | What the product uses |
| --- | --- | --- |
| Acute safety | NIHSS Facial Palsy + Dysarthria; FAST | Red-flag wording and clinician-review severity anchor, never delayed by a score. |
| Facial function | Sunnybrook Facial Grading System (rest, voluntary movement, synkinesis) | Standardised rest, brow raise, eye closure, open-mouth smile/show teeth, lip pucker. |
| Fine-grained facial reporting | eFACE | Static/dynamic/synkinesis-compatible result layout and blinded-video comparison. |
| Post-stroke speech outcomes | FDA-2 and the dysarthria core outcome set | Objective motor-speech features plus intelligibility and participation outcomes in validation. |
| Voice acoustics | Praat / openSMILE eGeMAPS | F0, jitter, shimmer, HNR/CPP, formants, intensity, prosody. |

Primary sources:

- [NIH Stroke Scale, updated February 2024](https://www.ninds.nih.gov/sites/default/files/documents/NIH-Stroke-Scale_updatedFeb2024_508.pdf)
- [eFACE development and validation](https://pubmed.ncbi.nlm.nih.gov/26218397/), and [video vs in-person reliability](https://pubmed.ncbi.nlm.nih.gov/28006048/)
- [Systematic review of facial-nerve grading scales](https://pubmed.ncbi.nlm.nih.gov/25357164/)
- [Core outcomes for dysarthria after stroke](https://pubmed.ncbi.nlm.nih.gov/40409971/)
- [Prospective stroke dysarthria assessment](https://pubmed.ncbi.nlm.nih.gov/33580596/)
- [Praat voice-analysis reference](https://praat.org/manual/Intro.html) and [HNR definition](https://praat.org/manual/Harmonicity.html)

## Route and exported artefacts

The capture route is `/facial-speech`.

It records **one continuous webcam+microphone WebM** and emits two paired files:

```
facial-speech-<timestamp>.webm
facial-speech-<timestamp>.meta.json
```

The metadata records the actual start/end time of every timed task on the
recorder clock, capture settings, requested metrics, and protocol version. The
source remains one continuous video: guide and countdown material has no task
window, and the processor decodes only the recorded task windows. Do not infer
task boundaries from video frames. This makes every session reproducible,
prevents loss at separate MediaRecorder boundaries, and permits re-analysis with
future models. The processor may generate derived per-task clips for replay, but
the original continuous capture remains the evidence source.

## Capture protocol (version 1.0)

### Device and environmental control

1. Front camera, 720p or above, nominal 30 fps; face fills roughly one third to
   one half of the frame; no beauty filter, portrait blur, mirrored landmark
   interpretation, or aggressive auto-crop.
2. Diffuse front lighting; no strong side/back light, sunglasses, mask, hand, or
   hair occluding landmarks. Keep head centred and level.
3. Read each guide **before** its timed window. Facial-movement windows begin
   after a three-second countdown and show no lateral instructions: the subject
   looks into the camera lens, not at the screen. The fixed speech-reading prompt
   is placed as close as the browser can place it to the webcam; eye position is
   not a speech metric, but head remains centred.
4. Quiet room, one speaker, stable mouth-to-microphone distance. Browser requests
   disabled echo cancellation/noise suppression/auto gain, but devices may
   override this; record the actual track settings and use audio-quality gating.
5. Collect a 5 s silence/noise-floor segment before the first voice task in the
   production backend (the current UI displays the quality requirements; the
   processor should calculate and persist SNR/clipping).

### Facial movements

| Task | Repetitions | Offline measurement |
| --- | ---: | --- |
| Rest | 5 s | Static midline, eyelid/brow/mouth-corner asymmetry. |
| Brow raise | 2 | Left/right brow excursion and latency. |
| Tight eye closure | 2 | Eye-aperture residual, blink/closure asymmetry. |
| Smile / show teeth | 2 | Mouth-corner excursion ratio, vertical droop, lower-face AU asymmetry. |
| Lip pucker | 2 | Orbicularis-oris/lip-centre displacement and symmetry. |

The five movements correspond to the key NIHSS cues and a practical subset of
Sunnybrook voluntary-movement video documentation. Cheek puff and forceful eye
closure are retained only as optional future cues because objective correlations
are weaker for those expressions in a 4-D validation study.

### Speech movements

| Task | Repetitions | Offline measurement |
| --- | ---: | --- |
| Room silence | 5 s | Noise floor for the SNR gate. Must precede the voice tasks. |
| Sustained /a/ | 3 x 5 s | F0, F0 variation, jitter, shimmer, HNR/CPP, intensity, maximum usable phonation duration, voice breaks. |
| `pa-ta-ka` | 2 x 10 s | Sequential-motion rate, syllable timing CV, pauses, consonant/vowel stability. |
| NIHSS word list | 2 | ASR alignment, word/phoneme error, articulation rate, pause ratio, pitch/intensity range. |
| Counting 1–20 | 1 | Connected-speech rate, pauses, prosody and intelligibility proxy. |

The reading task uses the NIHSS dysarthria word list verbatim (MAMA, TIP-TOP,
FIFTY-FIFTY, THANKS, HUCKLEBERRY, BASEBALL PLAYER) so the recording is directly
comparable with a clinician-graded NIHSS item, and because the list is chosen to
stress different articulators.

The silence task is not optional. A sustained vowel is voiced from end to end,
so there is no quiet interval inside it from which a noise floor could be
inferred; without the dedicated segment, SNR for the most important acoustic
task can only be guessed.

Use the displayed language-specific prompt consistently within a cohort. For a
validated Vietnamese product, create Vietnamese normative cohorts, a
tone-balanced Vietnamese word list, and Vietnamese phoneme alignment; do not
apply English WER/PER norms to Vietnamese speech.

## Measurement conventions

These are the choices that make a number mean the same thing twice. Changing any
of them invalidates comparison with previously collected data.

- **Sides are anatomical, from the subject's perspective.** The report carries
  `side_convention: subject-anatomical`. The captured stream is never mirrored,
  so image space and anatomy agree. MediaPipe also names sides this way, which
  means landmark 61 is the subject's *right* mouth corner. Getting this backwards
  reports weakness on the wrong side, which is the one output a clinician acts on.
- **Geometry is computed in pixels, never in normalised landmark coordinates.**
  MediaPipe normalises x by frame width and y by frame height separately, so a
  Euclidean distance taken on those values stretches the horizontal axis by the
  frame aspect ratio and is not comparable across capture resolutions.
- **Landmarks are expressed in a face-local frame:** origin at the midpoint of
  the outer eye corners, axes from the interocular line, scale from IPD. This
  removes head translation, in-plane rotation and scale. Without it, a subject
  who leans in between the rest and smile windows has that motion charged to both
  mouth corners, which pulls the left/right ratio toward 1.0 and *masks* real
  asymmetry — the failure direction that matters for a screening tool.
- **Out-of-plane rotation is gated, not corrected.** Yaw and pitch proxies are
  taken from bony midline landmarks that facial nerve palsy does not displace,
  and are judged against the subject's own rest baseline. A consistently
  off-centre head is a framing quirk and passes; a head that turns between the
  rest and movement windows blocks that window, because it foreshortens one side
  of the face and manufactures exactly the asymmetry being measured.
- **Excursions are read at their peak, not their median.** A movement window
  contains the movement and the relaxed periods around it, so a central statistic
  measures mostly rest.
- **Repetitions are measured separately.** Each task window holds several
  repetitions, so features are computed per trial and reported as a median plus
  the spread across trials. Perturbation measures (jitter, shimmer) are defined
  only on a continuously voiced stretch and are taken from the trimmed steady
  middle of one phonation; computed across a window containing several vowels and
  the pauses between them, they measure the silences as glottal cycles.

## Failure behaviour

The gates fail closed. A blocking gate withholds the measurements it invalidates
and the report carries `status: insufficient-quality` with a coded, scoped
reason — a distinct outcome from a measurement that came back normal.

This matters more than it sounds. Every voluntary-movement measure here is
expressed relative to the subject's own neutral frame, so a capture with no
usable rest window has no baseline. Substituting anything for that baseline
makes the deltas zero and the left/right ratios exactly 1.0: a total capture
failure rendered as a perfectly symmetric face. A withheld measurement is safe;
a fabricated normal one is not.

Blocking conditions: face visibility, illumination and blur below threshold; a
missing or too-short rest window; a movement window with too few usable frames;
head roll beyond tolerance or head pose drifting from the rest baseline; a
speech window that is too short, clipped, too quiet, below the SNR floor, or
containing no isolable phonation.

## Metrics emitted by the offline report

### Quality and provenance (mandatory)

- Protocol version, model versions and hashes, capture device settings, task
  windows, frames/audio samples accepted and rejected.
- Face visibility/landmark confidence, yaw/pitch/roll distribution, head-motion
  gate, illumination/exposure flags and left/right landmark consistency.
- Audio sample rate, clipping ratio, speech activity ratio, noise floor, SNR,
  reverberation/noise flags and VAD confidence.

### Face metrics

All geometric features are normalised by interpupillary distance (IPD) and use
the subject's neutral frame as the origin. Report a median and 95% bootstrap CI
over valid frames, not one selected frame.

- Resting facial-asymmetry index: brow, palpebral fissure, philtrum, and
  mouth-corner displacement relative to the facial midline.
- Smile/show-teeth: left and right mouth-corner excursion, excursion ratio,
  vertical corner difference, onset/peak latency, and within-trial repeatability.
- Brow raise and eye closure: left/right excursion ratio, residual eye aperture,
  onset/peak timing, and repeatability.
- Upper- versus lower-face symmetry gap. Whether the forehead is involved is the
  classic discriminator between an upper motor neuron lesion, which tends to
  spare it, and a peripheral facial nerve palsy, which does not. Reported as a
  raw difference between the upper-face and lower-face symmetry ratios and
  labelled `uncalibrated-descriptor`: converting it into a pattern label needs
  the labelled study, and a threshold invented here would be precisely the
  unvalidated clinical claim this design forbids.
- Ocular narrowing during smile, as a synkinesis proxy and Sunnybrook component.
- Facial Action Unit deltas when the selected model supports them: AU12/AU6
  (smile), lip-corner depressor/raiser, brow raise/down, and blink/eye closure.
  *Planned; not in the current report.*
- Model uncertainty, quality-gate result, and an *automated facial asymmetry
  flag*; preserve raw measurements so a clinician can score Sunnybrook/eFACE
  from the video independently.

### Speech metrics

- Sustained vowel: usable duration, mean/SD F0, intensity, jitter, shimmer,
  HNR, cepstral peak prominence, voice breaks, and formants where signal quality
  permits.
- DDK: syllables/s, `pa-ta-ka` cycle timing median/IQR/CV, pause count/duration,
  and repeated-trial reliability.
- Connected speech: speech and articulation rate, pause ratio, mean/SD pause
  duration, F0 and intensity range, voiced/unvoiced balance, and speaking-time
  ratio.
- Fixed utterance: ASR text, word error rate, phoneme error rate, forced-alignment
  confidence, and an intelligibility proxy. Store the reference prompt/version;
  never treat ASR error as a diagnosis because accent and language affect it.
  *Planned; not in the current report.*
- A separately reported NIHSS-style *clinician-review dysarthria flag*: normal,
  possible mild–moderate, or possible severe/unintelligible. It is not a NIHSS
  score unless a trained examiner has graded the recording.

## Recommended offline pipeline

```
WebM + meta.json
       │
       ├── QC: frame timing, face visibility, 6-DoF pose, illumination, VAD/SNR/clipping
       │       └── fail/re-capture if QC insufficient
       │
       ├── Face: MediaPipe Face Landmarker → landmarks/blendshapes
       │          + OpenFace / py-feat → AUs, head pose, independent QA
       │          → neutral-relative dynamic symmetry features → calibrated classifier
       │
       └── Speech: FFmpeg audio extraction → VAD/diarisation guard
                   → Praat/Parselmouth + openSMILE eGeMAPS acoustics
                   → Whisper or a Vietnamese-capable wav2vec2/WavLM ASR + forced alignment
                   → calibrated dysarthria / intelligibility model
```

Recommended open-source components:

| Component | Role | Reason / caveat |
| --- | --- | --- |
| [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) | 3-D face landmarks and 52 blendshapes | Already available in the frontend dependencies; fast, deterministic landmark basis. **Its training distribution is dominated by symmetric faces and its mesh prior pulls toward symmetry, so it plausibly under-reports the very asymmetry being measured.** Quantifying that residual against hand annotation on palsy faces is a prerequisite, not a caveat — see the technical verification step below. |
| OpenFace 3.0 (`openface-test`, already a backend dependency) | AUs, landmarks, gaze, head pose | Already installed and loaded for the gaze pipeline, and its multitask head emits AUs alongside gaze. Prefer it over adding OpenFace 2.0 as a second dependency; the AU head output ordering needs pinning against the published mapping before it is used. |
| [py-feat](https://py-feat.org/) | Research facial-expression/AU toolkit | Useful comparator/ensemble, not an unvalidated medical grade. |
| [openSMILE](https://audeering.github.io/opensmile-python/) | eGeMAPS/ComParE acoustic features | Reproducible fixed feature sets for the classical baseline. |
| [Praat/Parselmouth](https://www.fon.hum.uva.nl/praat/) | Vowel acoustic measurements | Reference implementation for F0, perturbation and harmonicity metrics. |
| [SpeechBrain](https://speechbrain.github.io/) / WavLM/wav2vec2 | SSL speech embeddings and ASR components | Fine-tune only on labelled, language-matched clinical data; keep a classical acoustic baseline. |

The current research direction with the most practical value is **multimodal
late fusion**: geometry/AU features and acoustic/SSL speech features are scored
separately, quality-gated separately, then combined only after calibration. This
is more inspectable and less vulnerable to a poor microphone or a partially
occluded face than one end-to-end black-box classifier.

## Validation gates before a clinical claim

Numeric landmark/asymmetry cut-offs must not be copied from a healthy cohort or
invented from a single device. Train and freeze thresholds only after a labelled
study that includes the intended population, skin tones, ages, facial hair,
glasses, lighting, microphone and language variation.

### Reference labels

1. Two blinded facial-nerve clinicians grade each standard video independently
   with Sunnybrook and eFACE; adjudicate disagreement. Retain NIHSS facial item
   when the use case is acute stroke. **Report inter-rater agreement before
   adjudication and pre-specify a floor** (ICC(2,1) >= 0.80 for the continuous
   scales, weighted kappa >= 0.70 for ordinal items). An unreliable reference
   standard caps the agreement the product can demonstrate: a device cannot
   exceed its own ground truth, so an ICC target of 0.90 against a reference
   whose raters agree at 0.75 is not achievable, and failure would be
   misattributed to the model.
2. Two blinded speech-language therapists grade FDA-2 and an intelligibility
   measure; retain the NIHSS dysarthria item when applicable. Capture aphasia
   separately, not as dysarthria.
3. Include healthy controls, unilateral facial palsy of several severities,
   and the intended neurological cohort. Split train/validation/test by person,
   not clip; hold out one clinical site/device where possible.

### Product acceptance criteria (pre-specified engineering targets)

These are release gates, **not published diagnostic cut-offs**:

- Facial continuous score versus consensus eFACE/Sunnybrook: ICC(2,1) >= 0.90;
  test–retest ICC >= 0.85 under the same setup.
- Facial screening flag: sensitivity >= 0.90 and specificity >= 0.85 for
  clinician-defined clinically relevant asymmetry, with confidence intervals
  reported by severity and demographic/device subgroup.
- Speech severity score versus clinician FDA-2/intelligibility: Spearman rho
  >= 0.75; test–retest ICC >= 0.85; error and calibration audited separately for
  each supported language.
- Any “urgent review” flag prioritises sensitivity. Its threshold is selected on
  a locked validation set, and the UI includes the emergency instruction even
  when the quality gate fails.
- No score when mandatory QC fails. Report `insufficient-quality` with the
  precise reason and permit re-capture.

### Sample size

Targets without a sample size are not testable. Size the locked test set from
the precision required on the primary endpoint, not from convenience:

| Endpoint | Target | Precision | Approximate requirement |
| --- | --- | --- | --- |
| Facial screening sensitivity | >= 0.90 | 95% CI half-width <= 0.05 | ~140 confirmed positives |
| Facial screening specificity | >= 0.85 | 95% CI half-width <= 0.05 | ~196 confirmed negatives |
| Facial continuous ICC(2,1) | >= 0.90 | 95% CI lower bound > 0.85 | ~120 subjects, 2 raters |
| Speech severity Spearman rho | >= 0.75 | 95% CI lower bound > 0.60 | ~90 subjects per language |
| Test–retest ICC | >= 0.85 | 95% CI lower bound > 0.75 | ~60 subjects with repeat sessions |

Positives must be stratified across severity, not concentrated in obvious cases:
pre-specify a minimum per severity band, because sensitivity on severe palsy says
nothing about the mild cases where an automated screen would actually add value.
Subgroup analyses across skin tone, age, facial hair, glasses, device and
language are reported with their own confidence intervals and are explicitly
underpowered unless sized for separately.

### Predictive value at the intended prevalence

Sensitivity and specificity are prevalence-independent; the number a user acts on
is not. At the specificity floor of 0.85, an at-home screening population with
low prevalence yields a positive predictive value in the single-digit percentages
— most positive results will be false. This has to be stated in the intended-use
description and reflected in the UI wording, and it is the argument for
prioritising sensitivity on the urgent-review flag while presenting the result as
a prompt to seek assessment rather than as a finding.

### Reporting standards

Pre-register the analysis and report against the established checklists so the
evidence is legible to reviewers and regulators:

- **STARD 2015** for the diagnostic accuracy study, with a QUADAS-2 risk-of-bias
  assessment.
- **TRIPOD+AI** for development and validation of the prediction models.
- **DECIDE-AI** for the prospective usability and early live-evaluation stage.
- **CONSORT-AI / SPIRIT-AI** if any comparative trial follows.

### Regulatory position

Any released claim beyond "measurement for clinician review" makes this software
as a medical device. Under EU MDR Rule 11 software intended to inform diagnostic
decisions falls to Class IIa or above, and the FDA equivalent is generally Class
II requiring 510(k) with a named predicate. Identify the predicate, the intended
use statement and the classification *before* the labelled study, because they
determine what the study has to demonstrate. Until then the product must not
present a diagnosis, a NIHSS score, or a severity grade.

### Test process

1. **Technical verification:** synthetic landmark perturbations and annotated
   clips validate side orientation, IPD normalisation, task-window alignment,
   mirror handling, audio timestamps, VAD and feature extraction. Covered by
   `backend/tests/test_facial_speech_*.py` for the conventions above; still
   outstanding is the landmark-fidelity study on real palsy faces, which
   measures MediaPipe residual error against hand annotation and bounds how much
   asymmetry the landmark model itself suppresses.
2. **Analytic validation:** compare each raw metric with hand landmarks, AU
   labels and acoustic annotations; use Bland–Altman plots and per-task
   repeatability, not only aggregate AUC.
3. **Clinical validation:** locked person-level test set, blinded reference
   grading, ROC/PR curves, calibration curve, CIs, subgroup and failure analysis.
4. **Prospective usability study:** at-home/clinic capture with repeat session;
   measure invalid-capture rate, re-capture instructions, and agreement with the
   controlled reference recording.
5. **Change control:** every model has a version/hash, frozen threshold file,
   data-card and evaluation report. Revalidate whenever prompt, language,
   landmark model, microphone preprocessing or decision threshold changes.

## Implementation phases

1. **Done:** standardised capture route, versioned metadata contract,
   documented metric schema and clinical validation plan.
2. **In progress:** offline feature service. The Docker backend reads the paired
   artefacts and produces QC plus raw face/speech metrics with fail-closed gates.
   Still outstanding in this phase: AU stream, ASR and forced alignment, and the
   interactive replay (video, landmarks/AUs, waveform/spectrogram, task window
   and metric plots).
3. **Labelled-data study:** collect/consent/de-identify data; add blinded
   clinician annotation workflow and baseline models.
4. **Calibrated classifier and report:** lock models/thresholds only after
   validation gates are met; show measurement, uncertainty and reason codes
   before any high-level screening flag.
