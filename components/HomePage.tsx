'use client';

/**
 * HomePage — user-facing assessment entry point.
 *
 * Layout: centered two-column. Left = vertical timeline (all steps, natural page scroll).
 * Right = sticky description panel + Begin button.
 *
 * Fix: globals.css sets html { overflow: hidden } for the full-screen test flow.
 * We override it on mount and restore on unmount so this page can scroll normally.
 *
 * Phase 1: static shell — wizard navigation wired in Phase 2.
 */

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isOfflineMetaExportEnabled, withOfflineMetaExportFlag } from '@/lib/offlineExportMeta';
import { setAssessmentFlow } from '@/lib/assessmentFlow';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Step {
  id: string;
  label: string;
  duration: string;
  durationSec: number;
  icon: React.ReactNode;
  tagline: string;
  description: string;
  section: 'calibration' | 'neuro' | 'facial';
}

/**
 * Per-section accent. Written as whole class strings (not interpolated fragments)
 * so Tailwind's scanner keeps them.
 */
const SECTION_THEME: Record<Step['section'], {
  setLabel: string;
  badge: string;
  badgeDot: string;
  iconTile: string;
  node: string;
  nodeIcon: string;
  rule: string;
  dot: string;
  heading: string;
}> = {
  calibration: {
    setLabel: 'Neurological Assessment — Set 1',
    badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    badgeDot: 'bg-blue-500',
    iconTile: 'bg-blue-500/10 text-blue-400',
    node: 'border-blue-500 bg-blue-500 shadow-sm shadow-blue-500/50',
    nodeIcon: 'text-blue-400',
    rule: 'border-blue-500',
    dot: 'bg-blue-500',
    heading: 'text-blue-400',
  },
  neuro: {
    setLabel: 'Neurological Assessment — Set 2',
    badge: 'bg-gray-700 text-gray-400 border-gray-600',
    badgeDot: 'bg-gray-500',
    iconTile: 'bg-gray-700 text-gray-300',
    node: 'border-blue-500 bg-blue-500 shadow-sm shadow-blue-500/50',
    nodeIcon: 'text-blue-400',
    rule: 'border-blue-500',
    dot: 'bg-blue-500',
    heading: 'text-blue-400',
  },
  facial: {
    setLabel: 'Facial Assessment — Set 3',
    badge: 'bg-teal-500/10 text-teal-300 border-teal-500/20',
    badgeDot: 'bg-teal-400',
    iconTile: 'bg-teal-500/10 text-teal-300',
    node: 'border-teal-400 bg-teal-400 shadow-sm shadow-teal-400/50',
    nodeIcon: 'text-teal-300',
    rule: 'border-teal-400',
    dot: 'bg-teal-400',
    heading: 'text-teal-300',
  },
};

// ─── Step data ────────────────────────────────────────────────────────────────

// Set 1: initial calibration grid + all 6 exercise kinds (from EXERCISE_KINDS in types.ts)
const CALIBRATION_STEPS: Step[] = [
  {
    id: 'calibration',
    label: 'Calibration',
    duration: '~45 sec',
    durationSec: 45,
    section: 'calibration',
    icon: <DotGridIcon />,
    tagline: 'Follow a series of dots to calibrate the eye tracker to your gaze.',
    description:
      'The eye tracker needs to learn your unique gaze patterns before any testing begins. A series of dots will appear at different positions on the screen — simply look directly at each dot as it appears. Keep your head still and relaxed throughout. The more accurately you follow the dots, the better the tracker will perform during all tests.',
  },
  {
    id: 'wiggling',
    label: 'Wiggling',
    duration: '15-20 sec',
    durationSec: 20,
    section: 'calibration',
    icon: <WiggleIcon />,
    tagline: 'Follow a target that moves in a quick back-and-forth pattern.',
    description:
      'A small target will move rapidly in a short wiggling motion. Follow it as precisely as you can. This pattern exercises fine lateral eye movements and helps the tracker learn how your eyes respond to rapid small-range motion.',
  },
  {
    id: 'horizontal',
    label: 'Horizontal',
    duration: '15-20 sec',
    durationSec: 20,
    section: 'calibration',
    icon: <HArrowIcon />,
    tagline: 'Track a target sweeping smoothly from left to right.',
    description:
      'A target will move steadily from one side of the screen to the other and back. Follow it with a smooth, continuous eye movement. This calibrates the tracker across the full horizontal range of your screen.',
  },
  {
    id: 'vertical',
    label: 'Vertical',
    duration: '15-20 sec',
    durationSec: 20,
    section: 'calibration',
    icon: <VArrowIcon />,
    tagline: 'Track a target sweeping smoothly from top to bottom.',
    description:
      'Similar to horizontal, but the target moves from the top of the screen to the bottom and back. Follow with smooth, continuous vertical eye movement. This calibrates the tracker across the full vertical range.',
  },
  {
    id: 'forward_backward',
    label: 'Forward-Backward',
    duration: '15-20 sec',
    durationSec: 20,
    section: 'calibration',
    icon: <ZoomIcon />,
    tagline: 'Focus on a target as it appears to move toward and away from you.',
    description:
      'A target will appear to approach and recede, simulating depth movement. Follow it naturally. This pattern helps the tracker account for changes in perceived gaze depth and slight shifts in head position during natural viewing.',
  },
  {
    id: 'diagonal',
    label: 'Diagonal',
    duration: '15-20 sec',
    durationSec: 20,
    section: 'calibration',
    icon: <DiagIcon />,
    tagline: 'Track a target moving diagonally across the screen.',
    description:
      'The target will travel along diagonal paths — corner to corner. Follow with smooth eye movements. Diagonal patterns combine horizontal and vertical motion, ensuring the tracker is well-calibrated for all gaze directions.',
  },
  {
    id: 'h_pattern',
    label: 'H-Pattern',
    duration: '15-20 sec',
    durationSec: 20,
    section: 'calibration',
    icon: <HPatternIcon />,
    tagline: 'Follow a target tracing the shape of the letter H.',
    description:
      'The target traces the outline of an H — up, across, and down on both sides. This structured pattern ensures the eye tracker is accurately calibrated in the corners and edges of the screen, where accuracy is hardest to maintain.',
  },
];

// Set 2: 7 neurological tests (from DEFAULT_TEST_ORDER in lib/neurologicalConfig.ts)
const NEURO_STEPS: Step[] = [
  {
    id: 'head_orientation',
    label: 'Head Orientation',
    duration: '~30 sec',
    durationSec: 30,
    section: 'neuro',
    icon: <CompassIcon />,
    tagline: 'Look in different directions while holding your head still.',
    description:
      'On-screen cues will guide you to look left, right, up, and down. Keep your head as still as possible — only your eyes should move. Hold your gaze in each direction until the cue changes. This test measures the range and steadiness of your eye movement in all four directions.',
  },
  {
    id: 'visual_search',
    label: 'Visual Search',
    duration: '~30 sec',
    durationSec: 30,
    section: 'neuro',
    icon: <SearchIcon />,
    tagline: 'Find numbered targets scattered across the screen in order.',
    description:
      'Numbers will be scattered randomly across the screen. Find and look at each number in order from 1 upward, as quickly as you can — no clicking required, just gaze at the correct number. This measures how efficiently your eyes scan and search a visual scene.',
  },
  {
    id: 'memory_cards',
    label: 'Memory Cards',
    duration: '~1 min',
    durationSec: 60,
    section: 'neuro',
    icon: <CardIcon />,
    tagline: 'Find matching pairs of cards using your gaze.',
    description:
      'A grid of face-down cards is shown. Look at a card to reveal its symbol, then find its matching pair by looking at another card. Once matched, the pair stays revealed. Find all pairs to complete the test. This measures visual memory — how well you recall and use what you have already seen.',
  },
  {
    id: 'anti_saccade',
    label: 'Anti-Saccade',
    duration: '~45 sec',
    durationSec: 45,
    section: 'neuro',
    icon: <SwapIcon />,
    tagline: 'Look in the opposite direction to a moving shape.',
    description:
      'A shape will appear and move toward one side of the screen. Your task is to immediately look to the opposite side — not at the shape. This is intentionally challenging because your natural reflex is to follow movement. The test measures your ability to override that reflex and direct your gaze intentionally.',
  },
  {
    id: 'saccadic',
    label: 'Saccadic Eye Movement',
    duration: '~20 sec',
    durationSec: 20,
    section: 'neuro',
    icon: <BoltIcon />,
    tagline: 'React quickly to targets appearing alternately on each side.',
    description:
      'Targets will appear alternately on the left and right sides of the screen. Move your eyes to each target as fast as possible the moment it appears. Speed matters here. This test measures the raw speed and accuracy of voluntary eye movement responses.',
  },
  {
    id: 'fixation_stability',
    label: 'Fixation Stability',
    duration: '15-20 sec',
    durationSec: 20,
    section: 'neuro',
    icon: <TargetIcon />,
    tagline: 'Hold your gaze perfectly still on a central dot.',
    description:
      'A small dot will appear at the centre of the screen. Your only task is to stare at it as steadily as you can for the full duration. Do not let your eyes wander or make unnecessary movements. This measures the stability of your gaze when you actively try to keep it completely fixed.',
  },
  {
    id: 'peripheral_vision',
    label: 'Peripheral Vision',
    duration: '~30 sec',
    durationSec: 30,
    section: 'neuro',
    icon: <EyeIcon />,
    tagline: 'Detect flashes of light at the edges of your vision.',
    description:
      'Keep your eyes fixed on the centre of the screen at all times. Whenever you notice a flash of light anywhere on the screen — even far in your peripheral vision — press the spacebar or tap the screen as quickly as possible. Do not move your eyes toward the flash. This measures peripheral awareness and reaction time.',
  },
];

// Set 3: facial drooping screen. Poses follow the MEEI / eFACE standard photo set —
// one neutral baseline plus five effortful expressions, each driven by a different
// branch of the facial nerve, so upper-face sparing (central/stroke) can be told
// apart from full hemifacial weakness (peripheral/Bell's palsy).
const FACIAL_STEPS: Step[] = [
  {
    id: 'face_rest',
    label: 'Resting Symmetry',
    duration: '~15 sec',
    durationSec: 15,
    section: 'facial',
    icon: <FaceRestIcon />,
    tagline: 'Hold a completely relaxed, neutral face while a photo is captured.',
    description:
      'Look straight at the camera with your face fully relaxed — no smiling, no talking, mouth gently closed. This neutral baseline is what every later pose is compared against. At rest, a weakened side of the face often shows a flattened smile line beside the nose, a lower corner of the mouth, or a wider eye opening.',
  },
  {
    id: 'brow_raise',
    label: 'Brow Raise',
    duration: '~15 sec',
    durationSec: 15,
    section: 'facial',
    icon: <BrowRaiseIcon />,
    tagline: 'Raise both eyebrows as high as you can and hold.',
    description:
      'Lift your eyebrows as if surprised, hold for a few seconds, then relax. This is the single most informative pose in the set: the forehead receives nerve supply from both sides of the brain, so in a stroke the brow usually still lifts normally even when the mouth droops. If the forehead is weak on the same side as the mouth, the problem is more likely in the facial nerve itself.',
  },
  {
    id: 'eye_closure',
    label: 'Eye Closure',
    duration: '~15 sec',
    durationSec: 15,
    section: 'facial',
    icon: <EyeClosedIcon />,
    tagline: 'Close both eyes gently, then squeeze them shut tightly.',
    description:
      'First close your eyes softly as if falling asleep, then squeeze them tightly shut. Incomplete closure on one side, or a visible gap between the eyelids, points to weakness of the muscle that rings the eye. This pose also matters for care rather than diagnosis alone — an eye that cannot close fully is at real risk of corneal injury and needs protection.',
  },
  {
    id: 'smile',
    label: 'Full Smile',
    duration: '~15 sec',
    durationSec: 15,
    section: 'facial',
    icon: <SmileIcon />,
    tagline: 'Give your biggest smile, showing your teeth.',
    description:
      'Smile as widely as you can with your teeth showing, and hold it. This is the classic "does one side of the smile droop?" check used in stroke screening. The system measures how far each corner of the mouth travels from its resting position; a difference between the two sides is the strongest single indicator of facial drooping.',
  },
  {
    id: 'lip_pucker',
    label: 'Lip Pucker',
    duration: '~15 sec',
    durationSec: 15,
    section: 'facial',
    icon: <PuckerIcon />,
    tagline: 'Purse your lips forward as if to whistle or say "ooo".',
    description:
      'Push your lips forward into a tight pucker and hold. This isolates the ring of muscle around the mouth, which controls speech sounds, drinking and keeping food in the mouth. A pucker that pulls off-centre toward one side shows that the lips are weak on the opposite side.',
  },
  {
    id: 'snarl',
    label: 'Snarl',
    duration: '~15 sec',
    durationSec: 15,
    section: 'facial',
    icon: <SnarlIcon />,
    tagline: 'Wrinkle your nose and lift your upper lip, as if smelling something bad.',
    description:
      'Wrinkle your nose upward and raise your upper lip to expose the upper teeth. This targets the small muscles that lift the lip and deepen the smile line beside the nose — an area that is often the first to weaken and the last to recover. It completes the picture across the whole face, from forehead to mouth.',
  },
];

const ALL_STEPS: Step[] = [...CALIBRATION_STEPS, ...NEURO_STEPS, ...FACIAL_STEPS];

// ─── Icons ────────────────────────────────────────────────────────────────────

function DotGridIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <circle cx="10" cy="10" r="3" />
      <circle cx="3.5" cy="3.5" r="1.5" opacity="0.4" />
      <circle cx="16.5" cy="3.5" r="1.5" opacity="0.4" />
      <circle cx="3.5" cy="16.5" r="1.5" opacity="0.4" />
      <circle cx="16.5" cy="16.5" r="1.5" opacity="0.4" />
      <circle cx="10" cy="3.5" r="1.5" opacity="0.25" />
      <circle cx="10" cy="16.5" r="1.5" opacity="0.25" />
    </svg>
  );
}
function WiggleIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]">
      <path d="M2 10 Q4 7 6 10 Q8 13 10 10 Q12 7 14 10 Q16 13 18 10" strokeLinecap="round" />
    </svg>
  );
}
function HArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M2 10l4-3.5v2h8v-2l4 3.5-4 3.5v-2H6v2z" />
    </svg>
  );
}
function VArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M10 2l3.5 4h-2v8h2L10 18l-3.5-4h2V6h-2z" />
    </svg>
  );
}
function ZoomIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[18px] h-[18px]">
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="4" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
function DiagIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M3 3l14 14M17 3L3 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.5" />
      <circle cx="10" cy="10" r="2" />
    </svg>
  );
}
function HPatternIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]">
      <path d="M4 3v14M16 3v14M4 10h12" strokeLinecap="round" />
    </svg>
  );
}
function CompassIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[18px] h-[18px]">
      <circle cx="10" cy="10" r="8" />
      <path d="M10 4v2M10 14v2M4 10h2M14 10h2" strokeLinecap="round" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M13.5 13.5L18 18" strokeLinecap="round" />
    </svg>
  );
}
function CardIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <rect x="2" y="3" width="7" height="10" rx="1.5" opacity="0.4" />
      <rect x="11" y="7" width="7" height="10" rx="1.5" />
    </svg>
  );
}
function SwapIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M2 7l4-4v2h4v4H6v2L2 7zM18 13l-4 4v-2h-4V11h4V9l4 4z" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M11 2L4 11h6l-1 7 7-9h-6l1-7z" />
    </svg>
  );
}
function TargetIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[18px] h-[18px]">
      <circle cx="10" cy="10" r="8" />
      <circle cx="10" cy="10" r="4" />
      <circle cx="10" cy="10" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[18px] h-[18px]">
      <path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z" />
      <circle cx="10" cy="10" r="2.5" />
    </svg>
  );
}

function FaceRestIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[18px] h-[18px]">
      <path d="M10 2c3.3 0 5.5 2.4 5.5 6.5S13 18 10 18 4.5 12.6 4.5 8.5 6.7 2 10 2z" />
      <path d="M10 3.2v13.6" strokeWidth="1" opacity="0.45" strokeDasharray="1.5 1.5" />
      <path d="M7 8.2h1.4M11.6 8.2H13" strokeLinecap="round" />
      <path d="M7.8 13h4.4" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}
function BrowRaiseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[18px] h-[18px]">
      <path d="M3 7.5Q5.5 4.5 8 7.5M12 7.5Q14.5 4.5 17 7.5" strokeLinecap="round" />
      <circle cx="6" cy="12" r="1.4" />
      <circle cx="14" cy="12" r="1.4" />
      <path d="M10 5.5V2.2M10 2.2 8.7 3.6M10 2.2l1.3 1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
    </svg>
  );
}
function EyeClosedIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[18px] h-[18px]">
      <path d="M3 8.5q7 6 14 0" strokeLinecap="round" />
      <path d="M4.2 11.6 3.2 13.4M8 13.2l-.4 2M12 13.2l.4 2M15.8 11.6l1 1.8" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}
function SmileIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[18px] h-[18px]">
      <circle cx="10" cy="10" r="8" />
      <circle cx="7.2" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12.8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <path d="M5.8 11.8q4.2 4.2 8.4 0" strokeLinecap="round" />
    </svg>
  );
}
function PuckerIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[18px] h-[18px]">
      <ellipse cx="10" cy="10" rx="3.2" ry="4.2" />
      <ellipse cx="10" cy="10" rx="1.2" ry="1.8" />
      <path d="M4.6 6.4 2.8 5M15.4 6.4 17.2 5M4.6 13.6 2.8 15M15.4 13.6 17.2 15" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}
function SnarlIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[18px] h-[18px]">
      <path d="M6.5 5.5q3.5-2 7 0M6 8q3-1.6 6 0" strokeLinecap="round" opacity="0.6" />
      <path d="M5.5 12.5q4.5-3.5 9 0" strokeLinecap="round" />
      <path d="M6.6 12.9h6.8v1.6a3.4 3.4 0 0 1-6.8 0z" fill="currentColor" stroke="none" opacity="0.25" />
      <path d="M6.6 13h6.8" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}

// ─── Timeline item ────────────────────────────────────────────────────────────

function TimelineItem({
  step,
  isLast,
  isSelected,
  onClick,
}: {
  step: Step;
  isLast: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <div className="relative flex gap-3 cursor-pointer group" onClick={onClick}>
      {!isLast && (
        <div className="absolute left-[10px] top-[26px] bottom-0 w-px bg-gray-700" />
      )}
      {/* Node */}
      <div className={`
        relative z-10 mt-[3px] flex-shrink-0 w-[22px] h-[22px] rounded-full border-2
        flex items-center justify-center transition-all duration-150
        ${isSelected
          ? SECTION_THEME[step.section].node
          : 'border-gray-600 bg-gray-800 group-hover:border-gray-500'}
      `}>
        {isSelected
          ? <div className="w-[7px] h-[7px] rounded-full bg-white" />
          : <div className="w-[5px] h-[5px] rounded-full bg-gray-600 group-hover:bg-gray-400 transition-colors" />
        }
      </div>
      {/* Label */}
      <div className={`flex-1 flex items-center gap-2 pb-5 transition-colors duration-150
        ${isSelected ? 'text-white' : 'text-gray-500 group-hover:text-gray-300'}`}>
        <span className={`flex-shrink-0 transition-colors
          ${isSelected ? SECTION_THEME[step.section].nodeIcon : 'text-gray-700 group-hover:text-gray-500'}`}>
          {step.icon}
        </span>
        <div>
          <div className="text-sm font-medium leading-tight">{step.label}</div>
          <div className="text-xs text-gray-700 mt-0.5">{step.duration}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ part, title, section }: { part: string; title: string; section: Step['section'] }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-[11px] font-extrabold tracking-[0.12em] uppercase ${SECTION_THEME[section].heading}`}>{part}</span>
        <div className="flex-1 h-px bg-gray-700" />
      </div>
      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-3">{title}</p>
    </div>
  );
}

// ─── Step description panel ───────────────────────────────────────────────────

function StepPanel({ step }: { step: Step }) {
  const theme = SECTION_THEME[step.section];
  const globalIndex = ALL_STEPS.findIndex(s => s.id === step.id);

  return (
    <>
      {/* Part badge */}
      <div className="mb-5">
        <span className={`
          inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
          text-[11px] font-semibold uppercase tracking-wide border
          ${theme.badge}
        `}>
          <span className={`w-1.5 h-1.5 rounded-full ${theme.badgeDot}`} />
          {theme.setLabel}
        </span>
      </div>

      {/* Icon + title */}
      <div className="flex items-start gap-4 mb-6">
        <div className={`
          w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0
          ${theme.iconTile}
        `}>
          <div className="scale-[2]">{step.icon}</div>
        </div>
        <div>
          <h2 className="text-xl font-bold text-white leading-tight">{step.label}</h2>
          <div className="flex items-center gap-2 mt-1.5 text-gray-500 text-xs">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 flex-shrink-0">
              <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm8-3a.75.75 0 01.75.75v2.5h1.75a.75.75 0 010 1.5H8A.75.75 0 017.25 9V5.75A.75.75 0 018 5z" />
            </svg>
            {step.duration}
            <span className="text-gray-600">·</span>
            Step {globalIndex + 1} of {ALL_STEPS.length}
          </div>
        </div>
      </div>

      {/* Tagline */}
      <div className={`border-l-2 pl-4 mb-5 ${theme.rule}`}>
        <p className="text-base text-gray-200 font-medium leading-snug">{step.tagline}</p>
      </div>

      {/* Description */}
      <p className="text-sm text-gray-400 leading-relaxed">{step.description}</p>

      {/* Progress dots */}
      <div className="flex items-center gap-[3px] mt-8 flex-wrap">
        {ALL_STEPS.map((s, i) => (
          <div key={s.id} className={`h-1 rounded-full transition-all duration-300
            ${s.id === step.id
              ? `w-5 ${theme.dot}`
              : i < globalIndex ? 'w-2 bg-gray-600' : 'w-2 bg-gray-700'}`}
          />
        ))}
      </div>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [selected, setSelected] = useState<Step>(CALIBRATION_STEPS[0]);
  const router = useRouter();

  // globals.css sets html { overflow: hidden } for the full-screen test flow.
  // Override here so this page can scroll normally, restore on unmount.
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'auto';
    if (isOfflineMetaExportEnabled()) {
      console.log('[offline] exportMeta enabled for this browser tab');
    }
    return () => { html.style.overflow = prev; };
  }, []);

  const totalMin = Math.ceil(ALL_STEPS.reduce((sum, s) => sum + s.durationSec, 0) / 60);

  // Picking a facial pose starts the facial drooping screen on its own: consent
  // and demographics as usual, then straight to the capture, no calibration.
  // The eye-tracking sets still run the full route.
  const isFacialFlow = selected.section === 'facial';
  const facialMin = Math.ceil(FACIAL_STEPS.reduce((sum, s) => sum + s.durationSec, 0) / 60);

  const handleBegin = () => {
    setAssessmentFlow(isFacialFlow ? 'facial' : 'full');
    router.push(withOfflineMetaExportFlag('/consent'));
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-gray-700 bg-gray-900/95 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 20 20" fill="none" stroke="white" strokeWidth="1.5" className="w-3.5 h-3.5">
                <circle cx="10" cy="10" r="7" />
                <circle cx="10" cy="10" r="3" />
                <circle cx="10" cy="10" r="0.8" fill="white" stroke="none" />
              </svg>
            </div>
            <span className="text-sm font-semibold tracking-tight">Eye Assessment</span>
          </div>
        </div>
      </header>

      {/* Body — centered container */}
      <div className="max-w-5xl mx-auto px-8 py-12">
        <div className="flex gap-12 items-start">

          {/* ── Left: Timeline (natural height, page scrolls) ────── */}
          <aside className="w-64 flex-shrink-0">
            <div className="mb-8">
              <h1 className="text-base font-bold text-white">Assessment Overview</h1>
              <p className="text-xs text-gray-600 mt-1">
                {ALL_STEPS.length} steps · ~{totalMin} min total
              </p>
            </div>

            <SectionLabel part="Neurological Assessment" title="Set 1" section="calibration" />
            {CALIBRATION_STEPS.map((step, i) => (
              <TimelineItem
                key={step.id}
                step={step}
                isLast={i === CALIBRATION_STEPS.length - 1}
                isSelected={selected.id === step.id}
                onClick={() => setSelected(step)}
              />
            ))}


            <SectionLabel part="Neurological Assessment" title="Set 2" section="neuro" />
            {NEURO_STEPS.map((step, i) => (
              <TimelineItem
                key={step.id}
                step={step}
                isLast={i === NEURO_STEPS.length - 1}
                isSelected={selected.id === step.id}
                onClick={() => setSelected(step)}
              />
            ))}

            <SectionLabel part="Facial Assessment" title="Set 3 · Facial Drooping" section="facial" />
            {FACIAL_STEPS.map((step, i) => (
              <TimelineItem
                key={step.id}
                step={step}
                isLast={i === FACIAL_STEPS.length - 1}
                isSelected={selected.id === step.id}
                onClick={() => setSelected(step)}
              />
            ))}
          </aside>

          {/* ── Right: Description card (sticky) ──────────────────── */}
          <div className="flex-1 sticky top-[72px] self-start">
            <div className="bg-gray-800 rounded-2xl border border-gray-600 p-8">
              <StepPanel step={selected} />

              {/* CTA */}
              <div className="mt-8 pt-6 border-t border-gray-700 flex items-center justify-between gap-6">
                <div>
                  <p className="text-sm font-semibold text-white">Ready to begin?</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {isFacialFlow
                      ? `Consent and personal details, then the facial capture — no calibration, ~${facialMin} min.`
                      : 'Click any step to preview it, then start when ready.'}
                  </p>
                </div>
                <button
                  onClick={handleBegin}
                  className={`
                    flex items-center gap-2 px-5 py-2.5 rounded-xl flex-shrink-0
                    active:scale-[0.97]
                    text-white text-sm font-semibold
                    transition-all duration-150 shadow-lg
                    ${isFacialFlow
                      ? 'bg-teal-600 hover:bg-teal-500 shadow-teal-900/40'
                      : 'bg-blue-600 hover:bg-blue-500 shadow-blue-900/40'}
                  `}
                >
                  {isFacialFlow ? 'Begin Facial Assessment' : 'Begin Assessment'}
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                    <path d="M3.75 7.25a.75.75 0 000 1.5h6.69l-3.22 3.22a.75.75 0 101.06 1.06l4.5-4.5a.75.75 0 000-1.06l-4.5-4.5a.75.75 0 10-1.06 1.06l3.22 3.22H3.75z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
