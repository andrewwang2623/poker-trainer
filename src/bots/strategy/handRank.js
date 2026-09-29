// Fixed 169-class preflop strength list (SPEC §7) and combo-weighted percentiles over it.
// Generated offline: 0.5·(equity vs 1 random hand) + 0.75·(equity vs 2 random hands), 30k samples
// each, so multiway playability (suitedness, pairs) counts as well as heads-up high-card strength.

const STRENGTH_LIST = (
  'AA KK QQ JJ TT 99 88 AKs AQs AKo AJs ATs 77 AQo KQs AJo KJs A9s KTs ATo 66 A8s QJs KQo KJo A7s QTs ' +
  'K9s A9o KTo A5s A6s 55 JTs QJo A4s A8o Q9s K8s A7o A3s QTo K9o K7s J9s A5o A2s Q8s A6o K6s JTo 44 ' +
  'A4o K5s T9s Q9o K8o A3o J8s K4s K7o Q7s A2o J9o Q6s T8s K3s Q8o K6o J7s Q5s T9o K2s 98s K5o 33 J8o ' +
  'Q4s T7s K4o Q3s Q7o J6s T8o 97s J5s K3o Q2s Q6o 87s 98o J7o K2o T6s Q5o J4s 22 96s T7o Q4o J3s 86s ' +
  'T5s 76s J2s Q3o J6o 97o T4s 95s Q2o J5o T3s 87o T6o 65s 85s 75s T2s J4o 96o 94s 86o J3o 54s 76o 93s ' +
  '84s T5o J2o 64s 74s T4o 92s 95o T3o 85o 83s 53s 75o 82s 65o 73s T2o 63s 43s 94o 54o 84o 52s 74o 72s ' +
  '64o 93o 62s 42s 92o 32s 73o 83o 53o 63o 82o 43o 52o 62o 72o 42o 32o'
).split(' ');

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
