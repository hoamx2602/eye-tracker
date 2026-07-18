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
| Sustained /a/ | 3 x 5 s | F0, F0 variation, jitter, shimmer, HNR/CPP, intensity, maximum usable phonation duration, voice breaks. |
| `pa-ta-ka` | 2 x 10 s | Sequential-motion rate, syllable timing CV, pauses, consonant/vowel stability. |
| Fixed sentence | 2 | ASR alignment, word/phoneme error, articulation rate, pause ratio, pitch/intensity range. |
| Counting 1–20 | 1 | Connected-speech rate, pauses, prosody and intelligibility proxy. |

Use the displayed language-specific prompt consistently within a cohort. For a
validated Vietnamese product, create Vietnamese normative cohorts and Vietnamese
phoneme alignment; do not apply English WER/PER norms to Vietnamese speech.

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
- Facial Action Unit deltas when the selected model supports them: AU12/AU6
  (smile), lip-corner depressor/raiser, brow raise/down, and blink/eye closure.
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
| [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) | 3-D face landmarks and 52 blendshapes | Already available in the frontend dependencies; fast, deterministic landmark basis. Validate on palsy faces before using it as primary clinical landmark source. |
| [OpenFace 2.0](https://github.com/TadasBaltrusaitis/OpenFace) | AUs, landmarks, gaze, head pose | Mature research baseline and useful independent QA/AU stream. |
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
   when the use case is acute stroke.
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

### Test process

1. **Technical verification:** synthetic landmark perturbations and annotated
   clips validate side orientation, IPD normalisation, task-window alignment,
   mirror handling, audio timestamps, VAD and feature extraction.
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

1. **Current branch:** standardised capture route, versioned metadata contract,
   documented metric schema and clinical validation plan.
2. **Offline feature service:** Docker backend reads the paired artefacts,
   produces QC + raw face/speech metrics and an interactive replay (video,
   landmarks/AUs, waveform/spectrogram, task window and metric plots).
3. **Labelled-data study:** collect/consent/de-identify data; add blinded
   clinician annotation workflow and baseline models.
4. **Calibrated classifier and report:** lock models/thresholds only after
   validation gates are met; show measurement, uncertainty and reason codes
   before any high-level screening flag.
