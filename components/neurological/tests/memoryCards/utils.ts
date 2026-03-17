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
 * Chọn lưới cols × rows = cardCount (không ô trống), gần vuông nhất (min |cols − rows|).
 * Ví dụ: 6→2×3, 8→2×4, 12→3×4, 16→4×4, 20→4×5, 24→4×6, 28→4×7, 32→4×8.
 */
export function getGridDimensions(cardCount: number): { cols: number; rows: number; cellCount: number } {
  const n = Math.max(2, Math.floor(cardCount));
  let cols = 1;
  for (let c = Math.floor(Math.sqrt(n)); c >= 1; c--) {
    if (n % c === 0) {
      cols = c;
      break;
    }
  }
  const rows = n / cols;
  return { cols, rows, cellCount: n };
}

/** Board đúng cardCount ô, không ô trống. */
export function createBoard(cardCount: number): { cards: number[]; cols: number; rows: number } {
  const even = Math.max(2, Math.floor(cardCount / 2) * 2);
  const deck = createShuffledDeck(even);
  const { cols, rows } = getGridDimensions(even);
  const cards = shuffle([...deck]);
  return { cards, cols, rows };
}
