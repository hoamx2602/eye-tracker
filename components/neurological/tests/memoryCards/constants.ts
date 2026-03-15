import type { GuideStep } from '../../types';

/** Guide steps for Test 3: Controlled Cognitive Load (Memory Cards) — PDF. */
export const MEMORY_CARDS_GUIDE_STEPS: GuideStep[] = [
  {
    id: '1',
    title: 'Memory Cards',
    body: 'You will see a grid of face-down cards. Each card has a symbol. Find matching pairs by turning two cards at a time.',
  },
  {
    id: '2',
    body: 'Click a card (or look at it for a moment) to flip it. Select a second card. If they match, they stay face-up. If not, they flip back.',
  },
  {
    id: '3',
    body: 'Remember the positions of the symbols. Your goal is to open all pairs in as few moves as possible.',
  },
  {
    id: '4',
    title: 'When finished',
    body: 'When all pairs are face-up, the test ends automatically. You can also use the keyboard or click to select cards.',
  },
];

/** Grid size for main test: 4 → 4×4 (8 pairs), 6 → 6×6 (18 pairs), 9 → 9×9 (40 pairs, one empty). */
export type MemoryCardsGridSize = 4 | 6 | 9;
export const DEFAULT_GRID_SIZE: MemoryCardsGridSize = 4;
/** Symbol size preset: 'md' | 'lg' | 'xl'. */
export type MemoryCardsSymbolSize = 'md' | 'lg' | 'xl';
export const DEFAULT_SYMBOL_SIZE: MemoryCardsSymbolSize = 'lg';
/** Numeric scale for symbol size (0.8–2.5). Applied as fontSize = baseRem * symbolScale. Overrides symbolSize when set. */
export const DEFAULT_SYMBOL_SCALE = 1.5;
export const MIN_SYMBOL_SCALE = 0.8;
export const MAX_SYMBOL_SCALE = 2.5;
/** Practice grid: 2×2 = 2 cards = 1 pair. */
export const PRACTICE_GRID_SIZE = 2;
/** Gaze path sample interval (ms). */
export const GAZE_PATH_INTERVAL_MS = 50;
/** Dwell time (ms) on a card to select it via gaze. */
export const DEFAULT_DWELL_MS = 800;
/** Delay (ms) before flipping non-matching pair back. */
export const FLIP_BACK_DELAY_MS = 1200;
