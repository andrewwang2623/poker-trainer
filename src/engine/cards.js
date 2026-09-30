// Cards are strings like "As". Internally the evaluator uses codes 0..51: rank * 4 + suit,
// with rank 0 = '2' .. 12 = 'A' and suit indices from SUITS ('c','d','h','s').
import { RANKS, SUITS } from '../shared/schemas.js';

const RANK_INDEX = Object.fromEntries(RANKS.map((r, i) => [r, i]));
const SUIT_INDEX = Object.fromEntries(SUITS.map((s, i) => [s, i]));

/** 52 cards in a fixed order (2c 2d 2h 2s 3c … As). */
export function fullDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

/** Fisher–Yates. Returns a new array; the input is not modified. */
export function shuffle(deck, rng) {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

export function isValidCard(card) {
  return typeof card === 'string' && card.length === 2 &&
    card[0] in RANK_INDEX && card[1] in SUIT_INDEX;
}

/** @returns {{rank: number, suit: number}} rank 0..12 ('2'..'A'), suit 0..3 */
export function parseCard(card) {
  if (!isValidCard(card)) throw new RangeError(`Invalid card: ${card}`);
  return { rank: RANK_INDEX[card[0]], suit: SUIT_INDEX[card[1]] };
}

export function formatCard({ rank, suit }) {
  return RANKS[rank] + SUITS[suit];
}

export function cardCode(card) {
  const { rank, suit } = parseCard(card);
  return rank * 4 + suit;
}

export function codeToCard(code) {
  return RANKS[code >> 2] + SUITS[code & 3];
}

/**
 * 169-class notation for two hole cards: "AA", "AKs", "AKo".
 * @param {string[]} cards
 */
export function handClass(cards) {
  if (!Array.isArray(cards) || cards.length !== 2) throw new RangeError('handClass needs 2 cards');
  const [a, b] = cards.map(parseCard);
  const [hi, lo] = a.rank >= b.rank ? [a, b] : [b, a];
  if (hi.rank === lo.rank) return RANKS[hi.rank] + RANKS[lo.rank];
  return RANKS[hi.rank] + RANKS[lo.rank] + (hi.suit === lo.suit ? 's' : 'o');
}

/**
 * Every concrete combo of a hand class, as card-code pairs.
 * "AA" → 6 combos, "AKs" → 4, "AKo" → 12.
 * @param {string} cls
 * @returns {[number, number][]}
 */
export function classCombos(cls) {
  const r1 = RANK_INDEX[cls[0]];
  const r2 = RANK_INDEX[cls[1]];
  if (r1 === undefined || r2 === undefined) throw new RangeError(`Invalid hand class: ${cls}`);
  const combos = [];
  if (r1 === r2) {
    for (let s1 = 0; s1 < 4; s1++) {
      for (let s2 = s1 + 1; s2 < 4; s2++) combos.push([r1 * 4 + s1, r2 * 4 + s2]);
    }
    return combos;
  }
  const suited = cls[2] === 's';
  for (let s1 = 0; s1 < 4; s1++) {
    for (let s2 = 0; s2 < 4; s2++) {
      if ((s1 === s2) === suited) combos.push([r1 * 4 + s1, r2 * 4 + s2]);
    }
  }
  return combos;
}

/**
 * The combos a range key stands for: a hand class ("AKs") or one exact combo ("AsKs"), so a range
 * can weight single combos (the coach's narrowed ranges).
 * @param {string} key
 * @returns {[number, number][]}
 */
export function rangeKeyCombos(key) {
  if (key.length === 4) {
    const a = cardCode(key.slice(0, 2));
    const b = cardCode(key.slice(2));
    if (a === b) throw new RangeError(`Invalid combo: ${key}`);
    return [[a, b]];
  }
  return classCombos(key);
}
