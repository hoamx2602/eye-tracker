/**
 * Spoken guidance for every participant-facing screen.
 *
 * Each key maps to one clip. `text` is the full guidance, played whenever the
 * participant presses the speaker button — and, on the handful of screens that
 * start a task straight away, once on arrival. `cue` is the short reminder
 * repeated on a cycle during long tasks — it must stay under ~8 words so it
 * never talks over the task itself.
 *
 * Audio resolution (see VoiceProvider): `/audio/<key>.mp3` is played when the
 * file exists, otherwise the browser speaks `text`. Key and filename are the
 * same string, so dropping `calib.intro.mp3` into public/audio is all it takes
 * to replace the synthetic voice for that step.
 *
 * Keep the wording here as the single source of truth: the recording script
 * handed to the voice artist is generated from this file, so a clip and its
 * fallback can never drift apart.
 */

import { stepSpokenText } from '../assessmentSteps';
import { consentSpokenText } from '../consentText';

export type VoiceScript = {
  /** Full guidance, spoken on entry and on replay. */
  text: string;
  /** Short reminder for the repeat cycle during long tasks. */
  cue?: string;
};

export const VOICE_SCRIPTS = {
  // ---------------------------------------------------------------- consent
  // The consent terms themselves, word for word with the screen, turned into
  // the second person — see lib/consentText.ts. A summary would have been
  // shorter, but this is the one screen where a participant is entitled to
  // hear exactly what they are agreeing to, not a paraphrase of it.
  'consent.terms': {
    text:
      'Please read the consent information on screen. Here it is aloud. ' +
      consentSpokenText(),
  },
  // ----------------------------------------------------------- demographics
  'demographics': {
    text:
      'Please tell us a little about yourself. ' +
      'Enter your age, select your gender, and enter your email address — ' +
      'we use the email only to link the parts of your session together and to contact you ' +
      'if there is a problem with your data. ' +
      'Let us know whether you wear glasses, as this changes how we process the camera image. ' +
      'Finally, tick any eye conditions that apply to you, or None. ' +
      'Then select Next.',
  },

  // ------------------------------------------------------------------ setup
  'setup.camera': {
    text:
      'First we need to turn on your camera. Select Allow when your browser asks for permission. ' +
      'Nothing is recorded until the session starts, and you can stop at any time.',
  },
  'setup.lighting': {
    text:
      'Now check your lighting. Your face should be evenly lit from the front. ' +
      'Avoid sitting with a bright window or lamp behind you, as this puts your face in shadow ' +
      'and makes eye tracking much less accurate.',
  },
  // Matches the six cards on the posture step, in the order they are shown.
  'setup.posture': {
    text:
      'Now your seating position, which decides how accurate the whole session is. ' +
      'Sit about an arm\'s length from the screen, and keep that distance throughout. ' +
      'Raise or tilt the screen so you are looking straight ahead, not down at it. ' +
      'Sit upright with your back supported and your shoulders relaxed — ' +
      'you will hold this position for a few minutes. ' +
      'Centre your face in the camera, with a little space above your head. ' +
      'Try not to lean towards the screen, and once the session starts, ' +
      'keep your head still and move only your eyes. ' +
      'A shifted head is the most common cause of unusable data.',
  },
  // Deliberately brief: the prompts below do the real work, and a long opening
  // line would keep the first "move up" waiting behind it.
  'headPositioning': {
    text: 'Centre your face inside the box, and follow the prompts underneath.',
  },

  // --------------------------------------------- head position prompts
  // Spoken as the on-screen prompt changes. Short, because they are said
  // repeatedly while someone shuffles into position, and each one interrupts
  // the last — a stale direction is worse than silence.
  'head.no_face': { text: 'I cannot see your face. Please sit in front of the camera.' },
  'head.move_left': { text: 'Move a little to your left.' },
  'head.move_right': { text: 'Move a little to your right.' },
  'head.move_up': { text: 'Move up a little.' },
  'head.move_down': { text: 'Move down a little.' },
  'head.closer': { text: 'Move a little closer to the screen.' },
  'head.back': { text: 'Move back a little from the screen.' },
  'head.straighten': { text: 'Straighten your head.' },
  'head.hold': { text: 'That is it. Hold still.' },

  // ------------------------------------------------------------ calibration
  'calib.intro': {
    text:
      'We will now calibrate the eye tracker. ' +
      'A dot will appear at different places on the screen. ' +
      'Look straight at the centre of each dot and keep looking until it disappears. ' +
      'Keep your head still and move only your eyes. ' +
      'This takes about a minute, and the accuracy of everything that follows depends on it, ' +
      'so please try to stay focused.',
    cue: 'Focus on each red dot as it appears, and move your eyes straight to it. Keep your head still.',
  },
  'calib.validation': {
    text:
      'Almost done. We will now check the calibration with a few more dots. ' +
      'Exactly as before — look at the centre of each dot and keep your head still.',
    cue: 'Look straight at the centre of each red dot as it appears.',
  },

  // -------------------------------------------------------------- exercises
  'ex.wiggling': {
    text:
      'Exercise one of six: wiggling. The dot will trace a smooth looping figure across the screen. ' +
      'Follow it with your eyes as smoothly as you can, without moving your head.',
    cue: 'Keep following the red dot with your eyes. Head still.',
  },
  'ex.horizontal': {
    text:
      'Exercise two of six: horizontal. The dot moves from side to side, ' +
      'pausing briefly at each edge. Follow it left and right with your eyes only.',
    cue: 'Keep following the red dot from side to side with your eyes.',
  },
  'ex.vertical': {
    text:
      'Exercise three of six: vertical. The dot moves up and down, ' +
      'pausing at the top and bottom. Follow it with your eyes, keeping your chin level.',
    cue: 'Keep following the red dot up and down with your eyes.',
  },
  'ex.forward_backward': {
    text:
      'Exercise four of six: forward and backward. ' +
      'The dot stays in the centre and grows and shrinks, as if moving towards you and away again. ' +
      'Keep your eyes on its centre the whole time.',
    cue: 'Keep your eyes on the centre of the red dot as it grows and shrinks.',
  },
  'ex.diagonal': {
    text:
      'Exercise five of six: diagonal. The dot jumps between the corners of the screen, ' +
      'pausing at each one. Follow it into every corner with your eyes.',
    cue: 'Keep following the red dot into each corner with your eyes.',
  },
  'ex.h_pattern': {
    text:
      'Exercise six of six: the H pattern. The dot traces the shape of a letter H, ' +
      'pausing at each turning point. Follow it with your eyes and keep your head still. ' +
      'This is the last exercise.',
    cue: 'Keep following the red dot along the H shape with your eyes.',
  },

  // ------------------------------------------------------------- questionnaires
  'symptom.pre': {
    text:
      'Before the tests begin, please tell us how you feel right now. ' +
      'For each symptom, choose a number from zero, meaning none at all, ' +
      'to four, meaning severe. There are no right or wrong answers — ' +
      'answer for how you feel at this moment.',
  },
  'symptom.post': {
    text:
      'The tests are finished. Please answer the same symptom questions once more, ' +
      'this time for how you feel now, after completing the session. ' +
      'Again, zero means none at all and four means severe.',
  },

  // ------------------------------------------------------- practice vs real
  // Framing only — the task instructions follow it as a second clip, so this
  // stays short. On its own it told a participant nothing about what to do.
  'practice.intro': {
    text: 'This is a practice round, and nothing here is recorded. Here is the task.',
  },
  // Spoken over a five-second countdown, so it has to fit inside it. The
  // "head still" reminder is left to each test's own instructions.
  'realtest.intro': {
    text: 'The real test starts now. Your responses are being recorded.',
  },

  // ------------------------------------------------------------- neuro tests
  'neuro.head_orientation': {
    text:
      'Head orientation. In this test you will move your head slowly in four directions — ' +
      'left, right, up, and then down. On-screen instructions tell you which way to turn ' +
      'and how long to hold each position. Move only as far as is comfortable, ' +
      'and keep your eyes on the screen as you turn.',
    cue: 'Hold your head in that position until the instruction changes.',
  },
  'neuro.visual_search': {
    text:
      'Visual search. Numbers will appear scattered across the screen. ' +
      'Your task is to find them and look at them in order — one, then two, then three, and so on. ' +
      'Hold each number for a moment until it turns green, then move on. ' +
      'They only respond in the right order, so if one does nothing, it is not the next one yet. ' +
      'Move your eyes only, keeping your head still. ' +
      'The test ends by itself once the last number is green.',
    cue: 'Keep looking for the next number in order, and hold your gaze on it.',
  },
  'neuro.memory_cards': {
    text:
      'Memory cards. You will see a grid of face-down cards, each hiding a symbol, ' +
      'and every symbol appears on exactly two cards. ' +
      'Turn over two cards at a time to find a matching pair. ' +
      'If they match, they stay face up; if not, they turn back over. ' +
      'Look at a card for a moment, or click it, to turn it. ' +
      'Try to remember where each symbol is, and complete all the pairs in as few turns as you can.',
    cue: 'Keep looking for the matching pairs.',
  },
  'neuro.anti_saccade': {
    text:
      'Anti-saccade. Two shapes will appear in the centre of the screen and then move apart, ' +
      'one to each side. One of them is brighter than the other. ' +
      'Your task is to resist looking at the bright one, and instead look at the dim shape ' +
      'on the opposite side. This feels unnatural — that is exactly what we are measuring. ' +
      'Keep your head still and move only your eyes.',
    cue: 'Look at the dim shape, not the bright one.',
  },
  'neuro.saccadic': {
    text:
      'Saccadic eye movement. A target will appear on the left or the right of the screen, ' +
      'and will switch sides about once a second. ' +
      'As soon as it appears, look straight at it as quickly and accurately as you can, ' +
      'then wait for it to move again. Move your eyes only, not your head.',
    cue: 'Look at each target as soon as it appears.',
  },
  'neuro.fixation_stability': {
    text:
      'Fixation stability. A small dot will appear in the centre of the screen. ' +
      'Your only task is to hold your gaze on it, as steadily as you can, until the test ends. ' +
      'The dot may blink — that is normal, and it helps you stay focused. ' +
      'Blink naturally when you need to, but try not to look away.',
    cue: 'Keep your eyes on the centre dot and hold them steady.',
  },
  'neuro.peripheral_vision': {
    text:
      'Peripheral vision. Keep your gaze fixed on the dot in the centre of the screen. ' +
      'From time to time, a small flash will appear near the edge of the screen. ' +
      'Press the space bar as soon as you notice it — but do not look at it. ' +
      'Keep looking at the centre the whole time. ' +
      'We are measuring what you can detect out of the corner of your eye.',
    cue: 'Keep your eyes on the centre, and press space when you see a flash.',
  },

  // ------------------------------------------------------------------ break
  // Said after the data has already been written, and before the *next* step —
  // not before finishing, which is what break.last is for.
  'break.rest': {
    text:
      'That step is complete, and your data from it has been saved. ' +
      'Take a moment to rest your eyes — look away from the screen and blink a few times. ' +
      'When you are ready for the next step, select Continue.',
  },
  'break.last': {
    text:
      'That was the last step, and your data has been saved. ' +
      'Take a moment to rest your eyes. ' +
      'When you are ready, select Next to finish the session.',
  },

  // ------------------------------------------- head orientation directions
  // Announced as each direction comes up, so the participant can keep their
  // head moving without having to read the screen — which is awkward when the
  // instruction is to turn away from it. Short enough to finish well inside
  // the four seconds each direction is held for.
  'headori.left': { text: 'Turn your head to the left, and hold it there.' },
  'headori.right': { text: 'Turn your head to the right, and hold it there.' },
  'headori.up': { text: 'Tilt your head up, and hold it there.' },
  'headori.down': { text: 'Tilt your head down, and hold it there.' },

  // ------------------------------------------------- assessment overview
  // The step previews on the home page. Text comes from lib/assessmentSteps.ts,
  // the same strings the page renders, because here the participant is reading
  // along: a clip that paraphrased the paragraph in front of them would be
  // worse than no clip at all.
  'overview.calibration': { text: stepSpokenText('calibration') },
  'overview.wiggling': { text: stepSpokenText('wiggling') },
  'overview.horizontal': { text: stepSpokenText('horizontal') },
  'overview.vertical': { text: stepSpokenText('vertical') },
  'overview.forward_backward': { text: stepSpokenText('forward_backward') },
  'overview.diagonal': { text: stepSpokenText('diagonal') },
  'overview.h_pattern': { text: stepSpokenText('h_pattern') },
  'overview.head_orientation': { text: stepSpokenText('head_orientation') },
  'overview.visual_search': { text: stepSpokenText('visual_search') },
  'overview.memory_cards': { text: stepSpokenText('memory_cards') },
  'overview.anti_saccade': { text: stepSpokenText('anti_saccade') },
  'overview.saccadic': { text: stepSpokenText('saccadic') },
  'overview.fixation_stability': { text: stepSpokenText('fixation_stability') },
  'overview.peripheral_vision': { text: stepSpokenText('peripheral_vision') },

  // --------------------------------------------------------------- finished
  'neuro.done': {
    text:
      'That is the end of the session. Thank you very much for taking part — ' +
      'your data has been saved and will help this research. ' +
      'You may now close this window.',
  },
} as const satisfies Record<string, VoiceScript>;

export type VoiceKey = keyof typeof VOICE_SCRIPTS;

/**
 * Script for a key, widened to `VoiceScript`.
 *
 * `as const satisfies` gives each entry its own literal type, so `.cue` is not
 * a property of the entries that have no cue. Read through here rather than
 * indexing the object directly.
 */
export function getScript(key: VoiceKey): VoiceScript {
  return VOICE_SCRIPTS[key] as VoiceScript;
}

/**
 * Voice key for an on-screen head-position prompt.
 *
 * Keyed off the message text from `eyeTrackingService.validateHeadPosition`,
 * so a new prompt there shows up here as a missing key rather than silently
 * saying the wrong thing.
 */
export function headPromptVoiceKey(message: string): VoiceKey | null {
  switch (message.trim().toLowerCase().replace(/[.!…]+$/, '')) {
    case 'no face detected': return 'head.no_face';
    case 'move left': return 'head.move_left';
    case 'move right': return 'head.move_right';
    case 'move up': return 'head.move_up';
    case 'move down': return 'head.move_down';
    case 'move closer': return 'head.closer';
    case 'move back': return 'head.back';
    case 'straighten head': return 'head.straighten';
    case 'perfect! hold steady': return 'head.hold';
    default: return null;
  }
}

/** Voice key for one head-orientation direction. */
export function headDirectionVoiceKey(direction: string): VoiceKey | null {
  const key = `headori.${direction}`;
  return key in VOICE_SCRIPTS ? (key as VoiceKey) : null;
}

/** Voice key for a step preview on the overview screen. */
export function overviewVoiceKey(stepId: string): VoiceKey | null {
  const key = `overview.${stepId}`;
  return key in VOICE_SCRIPTS ? (key as VoiceKey) : null;
}

/** Voice key for an eye-movement exercise, e.g. 'wiggling' → 'ex.wiggling'. */
export function exerciseVoiceKey(kind: string): VoiceKey | null {
  const key = `ex.${kind}`;
  return key in VOICE_SCRIPTS ? (key as VoiceKey) : null;
}

/** Voice key for a neurological test, e.g. 'saccadic' → 'neuro.saccadic'. */
export function neuroTestVoiceKey(testId: string): VoiceKey | null {
  const key = `neuro.${testId}`;
  return key in VOICE_SCRIPTS ? (key as VoiceKey) : null;
}
