// Best-5 hand evaluator for 5–7 cards.
// Score layout: category << 20 | r0 << 16 | r1 << 12 | r2 << 8 | r3 << 4 | r4,
// where r0..r4 are the tie-break ranks (0 = '2' .. 12 = 'A'). Higher score wins; equal scores tie.
import { cardCode } from './cards.js';

export const HAND_CATEGORIES = Object.freeze([
  'highCard', 'pair', 'twoPair', 'threeOfAKind', 'straight',
  'flush', 'fullHouse', 'fourOfAKind', 'straightFlush',
]);

const RANK_NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Jack', 'Queen', 'King', 'Ace'];
const RANK_PLURALS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines',
  'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

function pack(category, ranks) {
  let score = category << 20;
  for (let i = 0; i < ranks.length; i++) score |= ranks[i] << (16 - 4 * i);
  return score;
}

/** Highest rank of a 5-card straight inside a 13-bit rank mask, or -1. The wheel returns 3 ('5'). */
function straightHigh(mask) {
  const ext = (mask << 1) | ((mask >> 12) & 1); // bit 0 = ace-low
  for (let top = 13; top >= 4; top--) {
    if (((ext >> (top - 4)) & 0x1f) === 0x1f) return top - 1;
  }
  return -1;
}

/** Ranks present in a mask, high to low, up to `limit`, skipping `exclude` ranks. */
function topRanks(mask, limit, exclude = []) {
  const out = [];
  for (let r = 12; r >= 0 && out.length < limit; r--) {
    if ((mask >> r) & 1 && !exclude.includes(r)) out.push(r);
  }
  return out;
}

/**
 * Score 5–7 card codes (see cards.js). Hot path for equity enumeration: no validation.
 * @param {number[]} codes
 * @returns {number}
 */
export function evaluateCodes(codes) {
  const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const suitMasks = [0, 0, 0, 0];
  const suitCounts = [0, 0, 0, 0];
  let rankMask = 0;
  for (let i = 0; i < codes.length; i++) {
    const r = codes[i] >> 2;
    const s = codes[i] & 3;
    counts[r]++;
    rankMask |= 1 << r;
    suitMasks[s] |= 1 << r;
    suitCounts[s]++;
  }

  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCounts[s] >= 5) flushSuit = s;
  if (flushSuit >= 0) {
    const sf = straightHigh(suitMasks[flushSuit]);
    if (sf >= 0) return pack(8, [sf]);
  }

  let quad = -1;
  const trips = [];
  const pairs = [];
  for (let r = 12; r >= 0; r--) {
    if (counts[r] === 4) { if (quad < 0) quad = r; }
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
  }

  if (quad >= 0) return pack(7, [quad, topRanks(rankMask, 1, [quad])[0]]);
  if (trips.length >= 2) return pack(6, [trips[0], trips[1]]);
  if (trips.length === 1 && pairs.length >= 1) return pack(6, [trips[0], pairs[0]]);
  if (flushSuit >= 0) return pack(5, topRanks(suitMasks[flushSuit], 5));
  const st = straightHigh(rankMask);
  if (st >= 0) return pack(4, [st]);
  if (trips.length === 1) return pack(3, [trips[0], ...topRanks(rankMask, 2, [trips[0]])]);
  if (pairs.length >= 2) {
    const [p1, p2] = pairs;
    return pack(2, [p1, p2, ...topRanks(rankMask, 1, [p1, p2])]);
  }
  if (pairs.length === 1) return pack(1, [pairs[0], ...topRanks(rankMask, 3, [pairs[0]])]);
  return pack(0, topRanks(rankMask, 5));
}

export function scoreCategory(score) {
  return HAND_CATEGORIES[score >> 20];
}

/** Human-readable label for a score, e.g. "Two Pair, Aces and Sevens". */
export function scoreLabel(score) {
  const cat = score >> 20;
  const r = [0, 1, 2, 3, 4].map((i) => (score >> (16 - 4 * i)) & 15);
  switch (cat) {
    case 0: return `High Card, ${RANK_NAMES[r[0]]}`;
    case 1: return `Pair of ${RANK_PLURALS[r[0]]}, ${RANK_NAMES[r[1]]} kicker`;
    case 2: return `Two Pair, ${RANK_PLURALS[r[0]]} and ${RANK_PLURALS[r[1]]}`;
    case 3: return `Three of a Kind, ${RANK_PLURALS[r[0]]}`;
    case 4: return `Straight, ${RANK_NAMES[r[0]]} High`;
    case 5: return `Flush, ${RANK_NAMES[r[0]]} High`;
    case 6: return `Full House, ${RANK_PLURALS[r[0]]} full of ${RANK_PLURALS[r[1]]}`;
    case 7: return `Four of a Kind, ${RANK_PLURALS[r[0]]}`;
    default: return r[0] === 12 ? 'Royal Flush' : `Straight Flush, ${RANK_NAMES[r[0]]} High`;
  }
}

/**
 * @param {string[]} cards 5 to 7 distinct cards
 * @returns {{score: number, category: string, label: string}}
 */
export function evaluate(cards) {
  if (!Array.isArray(cards) || cards.length < 5 || cards.length > 7) {
    throw new RangeError('evaluate needs 5 to 7 cards');
  }
  if (new Set(cards).size !== cards.length) throw new RangeError('evaluate: duplicate cards');
  const score = evaluateCodes(cards.map(cardCode));
  return { score, category: scoreCategory(score), label: scoreLabel(score) };
}
