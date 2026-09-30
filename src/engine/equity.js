// Equity by exact enumeration (known cards, ≤2 to come) or Monte Carlo.
import { cardCode, rangeKeyCombos } from './cards.js';
import { evaluateCodes } from './evaluator.js';

/**
 * Call fn(fullBoardCodes) for every runout (exact) or for `iterations` random runouts.
 * The array passed to fn is reused between calls; copy it if you keep it.
 * @returns {number} number of runouts visited
 */
export function forEachRunout({ boardCodes, deadCodes = [], exact, iterations = 2000, rng }, fn) {
  const toCome = 5 - boardCodes.length;
  const used = new Uint8Array(52);
  for (const c of boardCodes) used[c] = 1;
  for (const c of deadCodes) used[c] = 1;
  const stub = [];
  for (let c = 0; c < 52; c++) if (!used[c]) stub.push(c);
  const full = boardCodes.slice();
  if (toCome <= 0) {
    fn(full);
    return 1;
  }
  if (exact) {
    let count = 0;
    const rec = (start, depth) => {
      if (depth === toCome) {
        fn(full);
        count++;
        return;
      }
      for (let i = start; i < stub.length; i++) {
        full[boardCodes.length + depth] = stub[i];
        rec(i + 1, depth + 1);
      }
    };
    rec(0, 0);
    return count;
  }
  if (!rng) throw new TypeError('forEachRunout: rng required for sampling');
  for (let it = 0; it < iterations; it++) {
    for (let k = 0; k < toCome; k++) {
      const j = k + Math.floor(rng() * (stub.length - k));
      const t = stub[k];
      stub[k] = stub[j];
      stub[j] = t;
      full[boardCodes.length + k] = stub[k];
    }
    fn(full);
  }
  return iterations;
}

/**
 * Expand a HandRange into weighted combos, dropping ones that collide with blocked cards. Keys are
 * hand classes or exact combos (see rangeKeyCombos); a combo listed under both counts twice.
 */
function rangeCombos(range, blocked) {
  const combos = [];
  const cumulative = [];
  let total = 0;
  for (const [key, freq] of Object.entries(range)) {
    if (!(freq > 0)) continue;
    for (const [a, b] of rangeKeyCombos(key)) {
      if (blocked[a] || blocked[b]) continue;
      total += freq;
      combos.push([a, b]);
      cumulative.push(total);
    }
  }
  return { combos, cumulative, total };
}

function pickCombo({ combos, cumulative, total }, rng) {
  const x = rng() * total;
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] > x) hi = mid;
    else lo = mid + 1;
  }
  return combos[lo];
}

/**
 * Hero equity against any mix of known hands and ranges.
 * Exact when ≤2 board cards are to come and every villain is a known hand; Monte Carlo otherwise.
 * Sampling needs the caller's `rng` (its own deriveSeed stream, SPEC §2): there is no shared
 * default stream, which would give every call the same samples.
 * @param {{hero: string[], board?: string[], villains: (string[]|Object<string, number>)[],
 *          dead?: string[], iterations?: number, rng?: () => number}} opts  rng is optional only
 *   when the result is exact. A range's keys are hand classes ("AKs") or exact combos ("AsKs").
 * @returns {{equity: number, win: number, tie: number, samples: number}}
 */
export function computeEquity({ hero, board = [], villains, dead = [], iterations = 2000, rng }) {
  if (!Array.isArray(hero) || hero.length !== 2) throw new RangeError('computeEquity: hero needs 2 cards');
  if (!Array.isArray(villains) || villains.length === 0) throw new RangeError('computeEquity: no villains');
  if (board.length > 5) throw new RangeError('computeEquity: board has more than 5 cards');

  const heroCodes = hero.map(cardCode);
  const boardCodes = board.map(cardCode);
  const deadCodes = dead.map(cardCode);
  const knownVillains = villains.map((v) => (Array.isArray(v) ? v.map(cardCode) : null));

  const blocked = new Uint8Array(52);
  const block = (c) => {
    if (blocked[c]) throw new RangeError('computeEquity: duplicate card');
    blocked[c] = 1;
  };
  [...heroCodes, ...boardCodes, ...deadCodes].forEach(block);
  for (const v of knownVillains) if (v) v.forEach(block);

  let wins = 0;
  let ties = 0;
  let share = 0;
  const hand = new Array(7);
  const villainHands = knownVillains.map((v) => v ?? [0, 0]);
  const tally = (fullBoard) => {
    for (let i = 0; i < 5; i++) hand[i + 2] = fullBoard[i];
    hand[0] = heroCodes[0];
    hand[1] = heroCodes[1];
    const heroScore = evaluateCodes(hand);
    let best = -1;
    let bestCount = 0;
    for (const vh of villainHands) {
      hand[0] = vh[0];
      hand[1] = vh[1];
      const s = evaluateCodes(hand);
      if (s > best) { best = s; bestCount = 1; }
      else if (s === best) bestCount++;
    }
    if (heroScore > best) { wins++; share++; }
    else if (heroScore === best) { ties++; share += 1 / (bestCount + 1); }
  };

  const allKnown = knownVillains.every(Boolean);
  const toCome = 5 - boardCodes.length;
  if (allKnown) {
    const deadAll = [...heroCodes, ...deadCodes, ...knownVillains.flat()];
    const samples = forEachRunout(
      { boardCodes, deadCodes: deadAll, exact: toCome <= 2, iterations, rng },
      tally,
    );
    return { equity: share / samples, win: wins / samples, tie: ties / samples, samples };
  }

  const ranges = villains.map((v) => {
    if (Array.isArray(v)) return null;
    const r = rangeCombos(v, blocked);
    if (r.combos.length === 0) throw new RangeError('computeEquity: villain range has no available combos');
    return r;
  });
  if (!rng) throw new TypeError('computeEquity: rng required for sampling');
  const used = new Uint8Array(52);
  const full = new Array(5);
  let samples = 0;
  for (let it = 0; it < iterations; it++) {
    used.set(blocked);
    let ok = true;
    for (let v = 0; v < ranges.length && ok; v++) {
      if (!ranges[v]) continue;
      ok = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const [a, b] = pickCombo(ranges[v], rng);
        if (!used[a] && !used[b]) {
          used[a] = 1;
          used[b] = 1;
          villainHands[v] = [a, b];
          ok = true;
          break;
        }
      }
    }
    if (!ok) continue;
    for (let i = 0; i < boardCodes.length; i++) full[i] = boardCodes[i];
    for (let i = boardCodes.length; i < 5; i++) {
      let c;
      do c = Math.floor(rng() * 52); while (used[c]);
      used[c] = 1;
      full[i] = c;
    }
    tally(full);
    samples++;
  }
  if (samples === 0) return { equity: 0, win: 0, tie: 0, samples: 0 };
  return { equity: share / samples, win: wins / samples, tie: ties / samples, samples };
}
