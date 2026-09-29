// Combo-weighted percentiles over the engine's fixed 169-class strength ranking (SPEC §7).
import { HAND_STRENGTH_ORDER } from '../../engine/index.js';

const STRENGTH_LIST = HAND_STRENGTH_ORDER;

export const HAND_CLASSES = Object.freeze(STRENGTH_LIST.slice());

export const comboCount = (cls) => (cls.length === 2 ? 6 : cls[2] === 's' ? 4 : 12);

/**
 * Build a percentile table from an ordering: each class maps to the share of all 1326 combos that
 * rank strictly above it plus half its own combos (midpoint), so "pct < x" selects about x of combos.
 * @param {string[]} order best first
 * @returns {Object<string, number>}
 */
export function percentilesFor(order) {
  const pct = {};
  let above = 0;
  for (const cls of order) {
    const n = comboCount(cls);
    pct[cls] = (above + n / 2) / 1326;
    above += n;
  }
  return pct;
}

/** Percentile of each class in the fixed strength list (0 = AA, ~1 = 32o). */
export const STRENGTH_PCT = Object.freeze(percentilesFor(STRENGTH_LIST));

/** Rank index in the fixed list (0 = best), for tie-breaks. */
export const STRENGTH_INDEX = Object.freeze(Object.fromEntries(STRENGTH_LIST.map((c, i) => [c, i])));

/**
 * HandRange of every class whose strength percentile falls in [lo, hi).
 * @returns {Object<string, number>}
 */
export function strengthBand(lo, hi) {
  const range = {};
  for (const cls of STRENGTH_LIST) {
    const p = STRENGTH_PCT[cls];
    if (p >= lo && p < hi) range[cls] = 1;
  }
  return range;
}

/**
 * Order classes by a blend of fixed strength and a chart's frequencies, so a tier variant chart
 * shapes which hands fill a percentage threshold (e.g. fish prefer suited junk over offsuit
 * broadways of similar strength). weight is how many strength-percentile points a chart
 * frequency of 1 is worth.
 * @param {Object<string, number>} chartRange
 * @param {number} weight
 * @returns {Object<string, number>} percentile per class
 */
export function blendedPercentiles(chartRange, weight) {
  const score = (cls) => STRENGTH_PCT[cls] - weight * (chartRange[cls] ?? 0);
  const order = STRENGTH_LIST.slice().sort((a, b) => score(a) - score(b) || STRENGTH_INDEX[a] - STRENGTH_INDEX[b]);
  return percentilesFor(order);
}

/**
 * Where a class sits inside a range, by the fixed strength list: 0 = strongest combo of the range,
 * 1 = weakest. Returns null when the class isn't in the range.
 */
export function percentileWithinRange(range, cls) {
  if (!(range[cls] > 0)) return null;
  let total = 0;
  let above = 0;
  for (const c of STRENGTH_LIST) {
    const w = (range[c] ?? 0) * comboCount(c);
    if (!w) continue;
    if (STRENGTH_INDEX[c] < STRENGTH_INDEX[cls]) above += w;
    total += w;
  }
  const own = range[cls] * comboCount(cls);
  return (above + own / 2) / total;
}

/** Share of all 1326 combos a HandRange covers. */
export function rangeCoverage(range) {
  let sum = 0;
  for (const [cls, f] of Object.entries(range)) sum += comboCount(cls) * f;
  return sum / 1326;
}
