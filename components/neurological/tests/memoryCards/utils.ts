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

/**
 * Choose grid cols × rows = cardCount (no empty cells), as square as possible
 * (min |cols − rows|), laid out landscape — the wider side becomes the columns.
 *
 * Landscape because screens are: a portrait grid wastes the width, pushes the
 * cards small to fit the height, and stretches the gaze path vertically where
 * the tracker is least accurate.
 * E.g. 6→3×2, 8→4×2, 12→4×3, 16→4×4, 20→5×4, 24→6×4, 28→7×4, 32→8×4.
 */
export function getGridDimensions(cardCount: number): { cols: number; rows: number; cellCount: number } {
  const n = Math.max(2, Math.floor(cardCount));
  let shortSide = 1;
  for (let c = Math.floor(Math.sqrt(n)); c >= 1; c--) {
    if (n % c === 0) {
      shortSide = c;
      break;
    }
  }
  const longSide = n / shortSide;
  return { cols: longSide, rows: shortSide, cellCount: n };
}

/** Board with exactly cardCount cells, no empty cells. */
export function createBoard(cardCount: number): { cards: number[]; cols: number; rows: number } {
  const even = Math.max(2, Math.floor(cardCount / 2) * 2);
  const deck = createShuffledDeck(even);
  const { cols, rows } = getGridDimensions(even);
  const cards = shuffle([...deck]);
  return { cards, cols, rows };
}
