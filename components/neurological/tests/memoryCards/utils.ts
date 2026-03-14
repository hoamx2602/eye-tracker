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

/**
 * Build deck for N×N grid: (N*N)//2 pairs, each symbol id 0..pairCount-1 appears twice.
 * For 9×9 = 81 we use 40 pairs (80 cards) and one empty index; the board has 81 cells, cardAt[80] = -1 (empty).
 */
export function createShuffledDeck(gridSize: number): number[] {
  const total = gridSize * gridSize;
  const pairCount = Math.floor(total / 2);
  const deck: number[] = [];
  for (let id = 0; id < pairCount; id++) {
    deck.push(id, id);
  }
  return shuffle(deck);
}

/**
 * For 9×9 we have 81 cells but only 80 cards; one cell is "empty" (we use -1 or we duplicate one symbol).
 * createShuffledDeck(9) returns 80 numbers; we can pad with -1 for "no card" or add one more pair.
 * Simpler: 9×9 = 81, use 40 pairs = 80 cards + 1 dummy card that matches itself (id 40 appears twice).
 * So for gridSize 9 we have 41 symbol types, 40 appear twice and one (40) appears once? No - we need 81 cards.
 * So 40 pairs = 80 cards + 1 card. Easiest: 40 pairs + 1 "free" card that is considered already matched (id 40).
 * Then we have 81 cards: 80 from 40 pairs + 1 card with id 40. When user "flips" the 40 card, it stays open (no pair).
 * Actually standard implementation: 9×9 grid has 81 cells. We need 40.5 pairs. So we do 40 pairs (80 cards) and 1 cell is empty (no card). Board has 81 slots; 80 have cards, 1 is null. So deck length 80, and we have an array of 81 with one null.
 * createShuffledDeck(9) → 80 cards. We'll place them in 81 cells: indices 0..80, and one cell gets no card (we can put a special "blank" that can't be clicked). So cards array length 81, one value is -1 (blank).
 */
export function getCardCount(gridSize: number): number {
  const total = gridSize * gridSize;
  return Math.floor(total / 2) * 2; // 80 for 9×9
}

export function createBoard(gridSize: number): number[] {
  const total = gridSize * gridSize;
  const deck = createShuffledDeck(gridSize);
  if (total === deck.length) {
    return deck;
  }
  // 9×9: 81 cells, 80 cards. Add one empty slot and shuffle so empty position is random.
  return shuffle([...deck, -1]);
}
