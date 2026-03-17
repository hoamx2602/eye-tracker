/**
 * Fisher–Yates shuffle.
 */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Fisher–Yates deck for N cards (N must be even). Each symbol id appears twice. */
export function createShuffledDeck(cardCount: number): number[] {
  const total = Math.max(2, Math.floor(cardCount));
  const pairCount = Math.floor(total / 2);
  const deck: number[] = [];
  for (let id = 0; id < pairCount; id++) {
    deck.push(id, id);
  }
  return shuffle(deck);
}

/** Choose a near-square grid (cols × rows) to fit `cardCount` cells. */
export function getGridDimensions(cardCount: number): { cols: number; rows: number; cellCount: number } {
  const n = Math.max(2, Math.floor(cardCount));
  const cols = Math.max(2, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(2, Math.ceil(n / cols));
  return { cols, rows, cellCount: cols * rows };
}

/** Board is sized to `cellCount`; extra cells are -1 (empty). */
export function createBoard(cardCount: number): { cards: number[]; cols: number; rows: number } {
  const even = Math.max(2, Math.floor(cardCount / 2) * 2);
  const deck = createShuffledDeck(even);
  const { cols, rows, cellCount } = getGridDimensions(even);
  const empties = Math.max(0, cellCount - deck.length);
  const cards = shuffle([...deck, ...Array.from({ length: empties }, () => -1)]);
  return { cards, cols, rows };
}
