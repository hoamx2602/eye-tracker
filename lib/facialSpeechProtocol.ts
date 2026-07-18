export type FacialSpeechDomain = 'face' | 'speech';

export interface FacialSpeechTask {
  id: string;
  domain: FacialSpeechDomain;
  title: string;
  instruction: string;
  durationSec: number;
  clinicalAnchor: string;
  captureNotes: string;
  /** Only used during a speech task; placed immediately below the webcam preview. */
  nearLensPrompt?: string;
}

export interface MetricDefinition {
  id: string;
  domain: FacialSpeechDomain | 'quality';
  label: string;
  unit: string;
  purpose: string;
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
    clinicalAnchor: 'Sunnybrook: resting symmetry',
    captureNotes: 'Keep your head level, with both ears and your chin visible in the frame.',
  },
  {
    id: 'face_brow_raise',
    domain: 'face',
    title: 'Raise your eyebrows',
    instruction: 'Raise both eyebrows evenly, hold for 2 seconds, then relax. Repeat twice.',
    durationSec: 8,
    clinicalAnchor: 'NIHSS facial-palsy cue; Sunnybrook voluntary movement',
    captureNotes: 'Do not tilt or lift your head to compensate.',
  },
  {
    id: 'face_eye_closure',
    domain: 'face',
    title: 'Close your eyes',
    instruction: 'Close both eyes firmly, hold for 2 seconds, then open them. Repeat twice.',
    durationSec: 8,
    clinicalAnchor: 'NIHSS facial-palsy cue; eye-closure function',
    captureNotes: 'Do not cover your face; keep it facing the camera.',
  },
  {
    id: 'face_smile_show_teeth',
    domain: 'face',
    title: 'Smile and show your teeth',
    instruction: 'Smile broadly and show your teeth, hold for 2 seconds, then relax. Repeat twice.',
    durationSec: 8,
    clinicalAnchor: 'NIHSS: show teeth; Sunnybrook: open-mouth smile',
    captureNotes: 'This is the primary window for lower-face droop and left/right smile excursion.',
  },
  {
    id: 'face_lip_pucker',
    domain: 'face',
    title: 'Pucker your lips',
    instruction: 'Pucker your lips forward, hold for 2 seconds, then relax. Repeat twice.',
    durationSec: 8,
    clinicalAnchor: 'Sunnybrook: lip pucker',
    captureNotes: 'Keep your head and shoulders still.',
  },
  {
    id: 'speech_sustained_a',
    domain: 'speech',
    title: 'Sustained vowel /a/',
    instruction: 'Breathe in, then say “ah” steadily and comfortably for about 5 seconds. Rest briefly and repeat three times.',
    durationSec: 22,
    clinicalAnchor: 'Maximum phonation / acoustic voice quality',
    captureNotes: 'Keep a steady distance from the microphone and do not intentionally change loudness.',
  },
  {
    id: 'speech_ddk_patka',
    domain: 'speech',
    title: 'Diadochokinesis: pa-ta-ka',
    instruction: 'Say “pa-ta-ka” clearly, evenly, and at a comfortable brisk pace for 10 seconds. Rest briefly and repeat once.',
    durationSec: 24,
    clinicalAnchor: 'Sequential motion rate / dysarthria motor-speech assessment',
    captureNotes: 'Do not chant or sing. A steady natural rate matters more than maximum speed.',
  },
  {
    id: 'speech_reading',
    domain: 'speech',
    title: 'Read a fixed sentence',
    instruction: 'Read clearly: “Today is bright. I speak clearly and steadily.” Repeat twice.',
    durationSec: 18,
    clinicalAnchor: 'NIHSS dysarthria-style intelligibility sample',
    captureNotes: 'A fixed sentence supports ASR/phoneme alignment and repeat-session comparison.',
    nearLensPrompt: 'Today is bright. I speak clearly and steadily.',
  },
  {
    id: 'speech_counting',
    domain: 'speech',
    title: 'Count aloud',
    instruction: 'Count from 1 to 20 at a natural, clear speaking pace.',
    durationSec: 18,
    clinicalAnchor: 'Connected-speech rate, pausing, intelligibility',
    captureNotes: 'Do not rush; keep a consistent distance from the microphone.',
  },
];

export const FACIAL_SPEECH_METRICS: MetricDefinition[] = [
  { id: 'capture_face_visibility', domain: 'quality', label: 'Valid face-frame ratio', unit: '%', purpose: 'Quality gate: score only when the face is frontal and landmarks are stable.' },
  { id: 'capture_audio_snr', domain: 'quality', label: 'SNR / background-noise level', unit: 'dB', purpose: 'Quality gate: avoid interpreting speech features from excessively noisy audio.' },
  { id: 'head_pose_stability', domain: 'quality', label: 'Head-pose stability', unit: 'deg', purpose: 'Flags geometric bias caused by head rotation or tilt.' },
  { id: 'resting_asymmetry', domain: 'face', label: 'Resting asymmetry', unit: 'ratio', purpose: 'Normalised position/height differences across eyes, brows and mouth corners.' },
  { id: 'smile_excursion_ratio', domain: 'face', label: 'Left/right smile-excursion ratio', unit: 'ratio', purpose: 'Measures unilateral reduction during smile/show-teeth.' },
  { id: 'mouth_corner_vertical_asymmetry', domain: 'face', label: 'Mouth-corner vertical asymmetry', unit: 'IPD-normalised', purpose: 'Lower-face facial-droop feature.' },
  { id: 'brow_excursion_ratio', domain: 'face', label: 'Left/right brow-excursion ratio', unit: 'ratio', purpose: 'Measures upper-face function during voluntary movement.' },
  { id: 'eye_closure_asymmetry', domain: 'face', label: 'Eye-closure asymmetry', unit: 'ratio', purpose: 'Compares bilateral eye aperture/blink blendshapes.' },
  { id: 'au_left_right_delta', domain: 'face', label: 'Left/right Facial Action Unit delta', unit: 'score', purpose: 'AU12/AU6, brow, blink and lip-corner activation.' },
  { id: 'sustained_f0', domain: 'speech', label: 'F0 and F0 variation', unit: 'Hz', purpose: 'Pitch stability during sustained vowel phonation.' },
  { id: 'jitter_shimmer_hnr', domain: 'speech', label: 'Jitter, shimmer, HNR', unit: '% / % / dB', purpose: 'Periodicity and voice-quality measures in the vowel window.' },
  { id: 'maximum_phonation_time', domain: 'speech', label: 'Maximum phonation time', unit: 's', purpose: 'Tracks usable /a/ duration; never used alone for diagnosis.' },
  { id: 'ddk_rate_regularity', domain: 'speech', label: 'Pa-ta-ka rate and regularity', unit: 'syllables/s, CV', purpose: 'Assesses timing and regularity of sequential speech movement.' },
  { id: 'connected_speech_rate', domain: 'speech', label: 'Speech rate, articulation rate, pause ratio', unit: 'words/s, syllables/s, %', purpose: 'Separates slow speech caused by pauses from articulation rate.' },
  { id: 'asr_alignment', domain: 'speech', label: 'Reading alignment / word-phoneme error', unit: 'WER, PER, confidence', purpose: 'Fixed-utterance intelligibility proxy, always paired with audio quality.' },
  { id: 'prosody', domain: 'speech', label: 'Pitch and intensity variation', unit: 'Hz / dB', purpose: 'Adds monotonicity and breath-control measurements.' },
];

export const FACIAL_SPEECH_PROTOCOL_VERSION = '1.0.0';
