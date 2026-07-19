export type FacialSpeechDomain = 'face' | 'speech' | 'quality';

export interface FacialSpeechTask {
  id: string;
  domain: FacialSpeechDomain;
  title: string;
  instruction: string;
  /** How long the task is meant to run. The Finish control appears at this point. */
  durationSec: number;
  /**
   * Shortest window the offline processor will still measure, mirroring its
   * gates. Below this the capture is guaranteed to be rejected, so there is no
   * point letting a subject end there. Between this and durationSec the subject
   * can stop early — some of the intended population cannot sustain a full
   * window, and trapping them is worse than a flagged short capture.
   */
  minimumSec: number;
  clinicalAnchor: string;
  captureNotes: string;
  /** Only used during a speech task; placed immediately below the webcam preview. */
  nearLensPrompt?: string;
  /**
   * Syllables the task asks the subject to produce, counted for the prompt as
   * written. Articulation rate is derived from this, so the count belongs with
   * the prompt: a Vietnamese word list must bring its own rather than being
   * scored against English syllables. Omit when the count is not fixed.
   */
  expectedSyllables?: number;
}

export interface MetricDefinition {
  id: string;
  domain: FacialSpeechDomain;
  label: string;
  unit: string;
  purpose: string;
  /**
   * Whether the offline processor computes this today. The list is shown to the
   * subject, so a planned metric must not be presented as something the report
   * will contain.
   */
  status: 'implemented' | 'planned';
}

/**
 * Fixed capture battery. It deliberately follows the standard facial movements
 * used in NIHSS/Sunnybrook-style video examination and separates speech tasks
 * by the motor subsystem they stress. Keep task IDs stable: offline reports use
 * their time windows as the ground truth for feature extraction.
 */
export const FACIAL_SPEECH_TASKS: FacialSpeechTask[] = [
  {
    id: 'face_rest',
    domain: 'face',
    title: 'Face at rest',
    instruction: 'Look directly into the camera lens. Relax your face and remain silent.',
    durationSec: 5,
    minimumSec: 3,
    clinicalAnchor: 'Sunnybrook: resting symmetry',
    captureNotes: 'Keep your head level, with both ears and your chin visible in the frame.',
  },
  {
    id: 'face_brow_raise',
    domain: 'face',
    title: 'Raise your eyebrows',
    instruction: 'Raise both eyebrows evenly, hold for 2 seconds, then relax. Repeat twice.',
    durationSec: 8,
    minimumSec: 4,
    clinicalAnchor: 'NIHSS facial-palsy cue; Sunnybrook voluntary movement',
    captureNotes: 'Do not tilt or lift your head to compensate.',
  },
  {
    id: 'face_eye_closure',
    domain: 'face',
    title: 'Close your eyes',
    instruction: 'Close both eyes firmly, hold for 2 seconds, then open them. Repeat twice.',
    durationSec: 8,
    minimumSec: 4,
    clinicalAnchor: 'NIHSS facial-palsy cue; eye-closure function',
    captureNotes: 'Do not cover your face; keep it facing the camera.',
  },
  {
    id: 'face_smile_show_teeth',
    domain: 'face',
    title: 'Smile and show your teeth',
    instruction: 'Smile broadly and show your teeth, hold for 2 seconds, then relax. Repeat twice.',
    durationSec: 8,
    minimumSec: 4,
    clinicalAnchor: 'NIHSS: show teeth; Sunnybrook: open-mouth smile',
    captureNotes: 'This is the primary window for lower-face droop and left/right smile excursion.',
  },
  {
    id: 'face_lip_pucker',
    domain: 'face',
    title: 'Pucker your lips',
    instruction: 'Pucker your lips forward, hold for 2 seconds, then relax. Repeat twice.',
    durationSec: 8,
    minimumSec: 4,
    clinicalAnchor: 'Sunnybrook: lip pucker',
    captureNotes: 'Keep your head and shoulders still.',
  },
  {
    id: 'capture_noise_floor',
    domain: 'quality',
    title: 'Room silence',
    instruction: 'Stay silent and still for 5 seconds. Do not speak, move, or touch the microphone.',
    durationSec: 5,
    minimumSec: 3,
    clinicalAnchor: 'Acoustic quality control',
    captureNotes:
      'Measures the room noise floor. Without it, SNR has to be guessed from the speech itself, and every acoustic measure is interpreted without knowing how noisy the recording was.',
  },
  {
    id: 'speech_sustained_a',
    domain: 'speech',
    title: 'Sustained vowel /a/',
    instruction: 'Breathe in, then say “ah” steadily and comfortably for about 5 seconds. Rest briefly and repeat three times.',
    durationSec: 22,
    minimumSec: 6,
    clinicalAnchor: 'Maximum phonation / acoustic voice quality',
    captureNotes: 'Keep a steady distance from the microphone and do not intentionally change loudness.',
  },
  {
    id: 'speech_ddk_patka',
    domain: 'speech',
    title: 'Diadochokinesis: pa-ta-ka',
    instruction: 'Say “pa-ta-ka” clearly, evenly, and at a comfortable brisk pace for 10 seconds. Rest briefly and repeat once.',
    durationSec: 24,
    minimumSec: 8,
    clinicalAnchor: 'Sequential motion rate / dysarthria motor-speech assessment',
    captureNotes: 'Do not chant or sing. A steady natural rate matters more than maximum speed.',
  },
  {
    id: 'speech_reading',
    domain: 'speech',
    title: 'Read the word list aloud',
    instruction: 'Read each word clearly, pausing briefly between them. Read the whole list twice.',
    durationSec: 24,
    minimumSec: 8,
    clinicalAnchor: 'NIHSS dysarthria item word list',
    captureNotes:
      'This is the actual NIHSS list, chosen to stress different articulators, so the recording is directly comparable with a clinician-graded NIHSS dysarthria item. Vietnamese cohorts need a tone-balanced list of their own; do not read English error rates against Vietnamese speech.',
    nearLensPrompt: 'MAMA · TIP-TOP · FIFTY-FIFTY · THANKS · HUCKLEBERRY · BASEBALL PLAYER',
    // 17 syllables per pass (2+2+4+1+4+4), read twice.
    expectedSyllables: 34,
  },
  {
    id: 'speech_counting',
    domain: 'speech',
    title: 'Count aloud',
    instruction: 'Count from 1 to 20 at a natural, clear speaking pace.',
    durationSec: 18,
    minimumSec: 8,
    clinicalAnchor: 'Connected-speech rate, pausing, intelligibility',
    captureNotes: 'Do not rush; keep a consistent distance from the microphone.',
    // English "one" through "twenty": 11 syllables for 1-10, 21 for 11-20.
    expectedSyllables: 32,
  },
];

export const FACIAL_SPEECH_METRICS: MetricDefinition[] = [
  { id: 'capture_face_visibility', domain: 'quality', label: 'Valid face-frame ratio', unit: '%', purpose: 'Quality gate: score only when the face is frontal and landmarks are stable.', status: 'implemented' },
  { id: 'capture_audio_snr', domain: 'quality', label: 'SNR / background-noise level', unit: 'dB', purpose: 'Quality gate: avoid interpreting speech features from excessively noisy audio.', status: 'implemented' },
  { id: 'head_pose_stability', domain: 'quality', label: 'Head-pose stability', unit: 'deg, IPD', purpose: 'Blocks a window whose head pose drifted from the rest baseline, since every measure here is rest-relative.', status: 'implemented' },
  { id: 'mouth_corner_vertical_asymmetry', domain: 'face', label: 'Resting mouth-corner vertical asymmetry', unit: 'IPD-normalised', purpose: 'Lower-face facial-droop feature, taken along the face axis so head tilt does not register.', status: 'implemented' },
  { id: 'smile_excursion_ratio', domain: 'face', label: 'Left/right smile excursion', unit: 'IPD-normalised, ratio', purpose: 'Measures unilateral reduction during smile/show-teeth, and names the reduced side.', status: 'implemented' },
  { id: 'brow_excursion_ratio', domain: 'face', label: 'Left/right brow excursion', unit: 'IPD-normalised, ratio', purpose: 'Measures upper-face function during voluntary movement.', status: 'implemented' },
  { id: 'eye_closure_asymmetry', domain: 'face', label: 'Eye-closure residual asymmetry', unit: 'ratio', purpose: 'Compares residual palpebral aperture at maximum closure.', status: 'implemented' },
  { id: 'upper_versus_lower_face', domain: 'face', label: 'Upper- versus lower-face symmetry gap', unit: 'ratio difference', purpose: 'Whether the forehead is involved. Reported raw, with no cut-off applied.', status: 'implemented' },
  { id: 'ocular_narrowing_during_smile', domain: 'face', label: 'Ocular narrowing during smile', unit: 'ratio', purpose: 'Synkinesis proxy: involuntary eye narrowing accompanying a voluntary smile.', status: 'implemented' },
  { id: 'resting_asymmetry_full', domain: 'face', label: 'Resting brow, palpebral fissure and philtrum', unit: 'ratio, IPD', purpose: 'The resting panel a clinician reads first. Needs no voluntary movement, so it survives an unusable movement window.', status: 'implemented' },
  { id: 'sustained_f0', domain: 'speech', label: 'F0 and F0 variation', unit: 'Hz', purpose: 'Pitch stability, measured per phonation and reported as a median across trials.', status: 'implemented' },
  { id: 'jitter_shimmer_hnr', domain: 'speech', label: 'Jitter, shimmer, HNR', unit: '% / % / dB', purpose: 'Periodicity and voice quality, measured on the steady middle of each sustained vowel.', status: 'implemented' },
  { id: 'maximum_phonation_time', domain: 'speech', label: 'Maximum phonation time', unit: 's', purpose: 'Longest single sustained /a/; never used alone for diagnosis.', status: 'implemented' },
  { id: 'ddk_rate_regularity', domain: 'speech', label: 'Pa-ta-ka energy-peak rate and regularity', unit: 'peaks/s, CV', purpose: 'Timing and regularity of sequential speech movement, measured per run. A proxy for syllable rate, not a syllable count.', status: 'implemented' },
  { id: 'connected_speech_timing', domain: 'speech', label: 'Pause count, pause duration, speaking-time ratio', unit: 'count, s, %', purpose: 'Separates slow speech caused by pausing from slow articulation.', status: 'implemented' },
  { id: 'prosody', domain: 'speech', label: 'Pitch and intensity variation', unit: 'Hz / dB', purpose: 'Monotonicity and breath-control measurements over connected speech.', status: 'implemented' },
  { id: 'articulation_rate', domain: 'speech', label: 'Speech and articulation rate', unit: 'syllables/s', purpose: 'Separates slow speech caused by pausing from slow articulation, using the syllable count declared with the prompt.', status: 'implemented' },
];

/**
 * Measurements the design calls for that the processor does not yet produce.
 * Deliberately kept out of FACIAL_SPEECH_METRICS: that list is rendered to the
 * subject as what the report will contain, and listing work-in-progress there
 * makes the product promise measurements it will not deliver. Tracked in
 * docs/FACIAL_SPEECH_SCREENING.md.
 */
export const FACIAL_SPEECH_ROADMAP_METRICS: MetricDefinition[] = [
  { id: 'au_left_right_delta', domain: 'face', label: 'Left/right Facial Action Unit delta', unit: 'score', purpose: 'AU12/AU6, brow, blink and lip-corner activation. Needs the OpenFace 3.0 AU head output order pinned against the published mapping first.', status: 'planned' },
  { id: 'asr_alignment', domain: 'speech', label: 'Reading alignment / word-phoneme error', unit: 'WER, PER, confidence', purpose: 'Fixed-utterance intelligibility proxy. Needs a language-matched ASR and forced aligner; English error rates must not be applied to Vietnamese speech.', status: 'planned' },
];

export const FACIAL_SPEECH_PROTOCOL_VERSION = '1.0.0';
