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

/** Total cards shown in the grid (must be even). */
export const MEMORY_CARDS_CARD_COUNTS = [6, 8, 12, 16, 20, 24, 28, 32] as const;
export type MemoryCardsCardCount = (typeof MEMORY_CARDS_CARD_COUNTS)[number];
export const DEFAULT_CARD_COUNT: MemoryCardsCardCount = 16;

/** Symbol size preset: 'sm' | 'md' | 'lg' | 'xl'. */
export const MEMORY_CARDS_SYMBOL_SIZES = ['sm', 'md', 'lg', 'xl'] as const;
export type MemoryCardsSymbolSize = (typeof MEMORY_CARDS_SYMBOL_SIZES)[number];
export const DEFAULT_SYMBOL_SIZE: MemoryCardsSymbolSize = 'lg';

/** Map symbol preset → font size in px. */
export const SYMBOL_SIZE_PX: Record<MemoryCardsSymbolSize, number> = {
  sm: 28,
  md: 36,
  lg: 46,
  xl: 58,
};
/** Practice grid: 2×2 = 2 cards = 1 pair. */
export const PRACTICE_GRID_SIZE = 2;
/** Gaze path sample interval (ms). */
export const GAZE_PATH_INTERVAL_MS = 100;
/** Dwell time (ms) on a card to select it via gaze. */
export const DEFAULT_DWELL_MS = 800;
/** Delay (ms) before flipping non-matching pair back. */
export const FLIP_BACK_DELAY_MS = 1200;

/** Default card gap in px. */
export const DEFAULT_CARD_GAP_PX = 8;
