import type { GuideStep } from '../../types';

/** Guide steps for Test 4: Opposite Direction Gaze Control (Anti-Saccade) — PDF. */
export const ANTI_SACCADE_GUIDE_STEPS: GuideStep[] = [
  {
    id: '1',
    title: 'Anti-Saccade',
    body: 'Two rectangles will appear: one bright and one dim. They will move in opposite directions. Your task is to look at the dim rectangle, not the bright one.',
  },
  {
    id: '2',
    body: 'Keep your gaze on the dim (faint) rectangle as it moves. Try not to follow the bright one — that is the opposite direction we want you to look.',
  },
  {
    id: '3',
    title: 'Trials',
    body: 'You will see several trials. Each time the direction changes at random. Look at the dim rectangle as quickly and accurately as you can.',
  },
];

export type AntiSaccadeDirection = 'left' | 'right' | 'up' | 'down';

export const DIRECTIONS: AntiSaccadeDirection[] = ['left', 'right', 'up', 'down'];

export const OPPOSITE_DIRECTION: Record<AntiSaccadeDirection, AntiSaccadeDirection> = {
  left: 'right',
  right: 'left',
  up: 'down',
  down: 'up',
};

/** Number of trials in the main test. */
export const DEFAULT_TRIAL_COUNT = 12;
/** Duration (ms) each rectangle moves per trial (fallback when speed not set). */
export const DEFAULT_MOVEMENT_DURATION_MS = 1500;
/** Movement speed (px/s) — used to compute duration from distance, same for all directions. */
export const DEFAULT_MOVEMENT_SPEED_PX_PER_SEC = 120;
/** Pause (ms) between trials. */
export const DEFAULT_INTERVAL_BETWEEN_TRIALS_MS = 800;
/** Practice: number of trials. */
export const PRACTICE_TRIALS = 3;
/** Rectangle half-width / half-height in px (so full size 2*RECT_HALF). */
export const RECT_HALF_PX = 40;
/** Distance (px) each rect moves from center during movement. */
export const TRAVEL_DISTANCE_PX = 180;
/** AOI radius (px): gaze within this distance of dim rect center counts as "correct". */
export const AOI_RADIUS_PX = 70;
/** Gaze sample interval (ms) during trial. */
export const GAZE_SAMPLE_INTERVAL_MS = 20;

/** Stimulus shape: rectangle, circle, triangle, ball, table, chair. */
export type AntiSaccadeStimulusShape =
  | 'rectangle'
  | 'circle'
  | 'triangle'
  | 'ball'
  | 'table'
  | 'chair';

export const STIMULUS_SHAPE_OPTIONS: { value: AntiSaccadeStimulusShape; label: string }[] = [
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'circle', label: 'Circle' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'ball', label: 'Ball' },
  { value: 'table', label: 'Table' },
  { value: 'chair', label: 'Chair' },
];

export type AntiSaccadeRectColorToken = 'red' | 'blue' | 'green' | 'amber' | 'violet' | 'cyan';

export type AntiSaccadeRectColor = AntiSaccadeRectColorToken | `#${string}`;

export const RECT_COLOR_PALETTE: Record<
  AntiSaccadeRectColorToken,
  {
    value: AntiSaccadeRectColorToken;
    label: string;
    primaryFillClass: string;
    primaryBorderClass: string;
    dimFillClass: string;
    dimBorderClass: string;
    primaryHex: string;
    primaryBorderHex: string;
    dimHex: string;
    dimBorderHex: string;
  }
> = {
  red: {
    value: 'red',
    label: 'Red',
    primaryFillClass: 'bg-red-400',
    primaryBorderClass: 'border-red-300',
    dimFillClass: 'bg-red-500',
    dimBorderClass: 'border-red-300',
    primaryHex: '#f87171',
    primaryBorderHex: '#fca5a5',
    dimHex: '#ef4444',
    dimBorderHex: '#fca5a5',
  },
  blue: {
    value: 'blue',
    label: 'Blue',
    primaryFillClass: 'bg-blue-400',
    primaryBorderClass: 'border-blue-300',
    dimFillClass: 'bg-blue-500',
    dimBorderClass: 'border-blue-300',
    primaryHex: '#60a5fa',
    primaryBorderHex: '#93c5fd',
    dimHex: '#3b82f6',
    dimBorderHex: '#93c5fd',
  },
  green: {
    value: 'green',
    label: 'Green',
    primaryFillClass: 'bg-emerald-400',
    primaryBorderClass: 'border-emerald-300',
    dimFillClass: 'bg-emerald-500',
    dimBorderClass: 'border-emerald-300',
    primaryHex: '#34d399',
    primaryBorderHex: '#6ee7b7',
    dimHex: '#10b981',
    dimBorderHex: '#6ee7b7',
  },
  amber: {
    value: 'amber',
    label: 'Amber',
    primaryFillClass: 'bg-amber-400',
    primaryBorderClass: 'border-amber-300',
    dimFillClass: 'bg-amber-500',
    dimBorderClass: 'border-amber-300',
    primaryHex: '#fbbf24',
    primaryBorderHex: '#fcd34d',
    dimHex: '#f59e0b',
    dimBorderHex: '#fcd34d',
  },
  violet: {
    value: 'violet',
    label: 'Violet',
    primaryFillClass: 'bg-violet-400',
    primaryBorderClass: 'border-violet-300',
    dimFillClass: 'bg-violet-500',
    dimBorderClass: 'border-violet-300',
    primaryHex: '#a78bfa',
    primaryBorderHex: '#c4b5fd',
    dimHex: '#8b5cf6',
    dimBorderHex: '#c4b5fd',
  },
  cyan: {
    value: 'cyan',
    label: 'Cyan',
    primaryFillClass: 'bg-cyan-400',
    primaryBorderClass: 'border-cyan-300',
    dimFillClass: 'bg-cyan-500',
    dimBorderClass: 'border-cyan-300',
    primaryHex: '#22d3ee',
    primaryBorderHex: '#67e8f9',
    dimHex: '#06b6d4',
    dimBorderHex: '#67e8f9',
  },
};

function isHexColor(v: unknown): v is `#${string}` {
  return typeof v === 'string' && /^#([0-9A-Fa-f]{6})$/.test(v.trim());
}

export function resolveAntiSaccadeRectHex(
  color: AntiSaccadeRectColor | undefined,
  variant: 'primary' | 'dim',
  fallbackToken: AntiSaccadeRectColorToken = 'red'
): { fillHex: string; borderHex: string } {
  if (isHexColor(color)) {
    const hex = color.toLowerCase();
    // Simple border = slightly darker.
    const fillRgb = hexToRgb(hex);
    const borderRgb = fillRgb ? { r: Math.max(0, Math.round(fillRgb.r * 0.85)), g: Math.max(0, Math.round(fillRgb.g * 0.85)), b: Math.max(0, Math.round(fillRgb.b * 0.85)) } : null;
    const borderHex = borderRgb ? rgbToHex(borderRgb) : hex;
    return { fillHex: hex, borderHex };
  }

  const token = (color && typeof color === 'string' ? color : fallbackToken) as AntiSaccadeRectColorToken;
  const entry = (RECT_COLOR_PALETTE as Record<string, any>)[token] as (typeof RECT_COLOR_PALETTE)[AntiSaccadeRectColorToken] | undefined;
  const resolved = entry ?? (RECT_COLOR_PALETTE as any)[fallbackToken];
  return variant === 'primary'
    ? { fillHex: resolved.primaryHex, borderHex: resolved.primaryBorderHex }
    : { fillHex: resolved.dimHex, borderHex: resolved.dimBorderHex };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(/^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const to2 = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to2(rgb.r)}${to2(rgb.g)}${to2(rgb.b)}`.toLowerCase();
}

export const RECT_COLOR_OPTIONS: { value: AntiSaccadeRectColor; label: string }[] = (
  Object.values(RECT_COLOR_PALETTE) as typeof RECT_COLOR_PALETTE[AntiSaccadeRectColorToken][]
).map((c) => ({ value: c.value, label: c.label }));
