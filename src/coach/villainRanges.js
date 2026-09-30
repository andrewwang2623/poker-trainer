// Opponent range estimates for the coach (SPEC §8.1). Each live opponent's range comes from its
// profile and its preflop action, then on a postflop street where it bet or raised, the weakest
// 30% × (1 − bluffFreq) of that range by made-hand strength is dropped.
// Pure: reads only the events and cards it is given, never hidden cards.
import { HAND_STRENGTH_ORDER, cardCode, classCombos, evaluateCodes } from '../engine/index.js';

/** Share of the range dropped (× (1 − bluffFreq)) when the opponent bet or raised this street. */
export const POSTFLOP_DROP = 0.3;
/** A 4-bet or more: the top share of the 3-bet range (§8.1 only covers raises and 3-bets). */
export const FOUR_BET_SHARE = 0.4;
/** Minimum width of a calling band, so a profile with vpip ≈ pfr still has a range. */
const MIN_BAND = 0.03;

/** Stats for an opponent without a profile. */
export const DEFAULT_STATS = Object.freeze({
  vpip: 0.28, pfr: 0.2, threeBet: 0.07, aggression: 2, bluffFreq: 0.25, foldToBet: 0.45,
});

const comboCount = (cls) => (cls.length === 2 ? 6 : cls[2] === 's' ? 4 : 12);

/** Percentile of each class in the fixed strength order: combos ranked above it plus half its own. */
export const STRENGTH_PCT = (() => {
  const pct = {};
  let above = 0;
  for (const cls of HAND_STRENGTH_ORDER) {
    pct[cls] = (above + comboCount(cls) / 2) / 1326;
    above += comboCount(cls);
  }
  return Object.freeze(pct);
})();

/** HandRange of every class whose strength percentile is in [lo, hi). */
export function strengthBand(lo, hi) {
  const range = {};
  for (const cls of HAND_STRENGTH_ORDER) {
    if (STRENGTH_PCT[cls] >= lo && STRENGTH_PCT[cls] < hi) range[cls] = 1;
  }
  return range;
}

/** The profile's stats, or DEFAULT_STATS for a seat without one. */
export function statsOf(profile) {
  if (!profile) return DEFAULT_STATS;
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const vpip = num(profile.vpip, DEFAULT_STATS.vpip);
  const pfr = Math.min(vpip, num(profile.pfr, DEFAULT_STATS.pfr));
  return {
    vpip,
    pfr,
    threeBet: Math.min(pfr, num(profile.threeBet, DEFAULT_STATS.threeBet)),
    aggression: num(profile.aggression, DEFAULT_STATS.aggression),
    bluffFreq: num(profile.bluffFreq, DEFAULT_STATS.bluffFreq),
    foldToBet: num(profile.foldToBet, DEFAULT_STATS.foldToBet),
  };
}

/**
 * Per-seat action summary from an event list: preflop raise index (1 = open, 2 = 3-bet, …), whether
 * it called or acted at all preflop, and its bets/raises on `street`. Posts are not actions.
 * @param {import('../shared/schemas.js').HandEvent[]} events  events before the decision
 * @param {string} street  the current street
 * @returns {Map<number, {raiseIndex: number, called: boolean, acted: boolean, aggression: number}>}
 */
export function seatActions(events, street) {
  const out = new Map();
  let raises = 0;
  const row = (seat) => {
    if (!out.has(seat)) out.set(seat, { raiseIndex: 0, called: false, acted: false, aggression: 0 });
    return out.get(seat);
  };
  for (const e of events) {
    if (e.type !== 'action') continue;
    const r = row(e.seat);
    const aggressive = e.action === 'bet' || e.action === 'raise';
    if (e.street === 'preflop') {
      r.acted = true;
      if (aggressive) r.raiseIndex = ++raises;
      else if (e.action === 'call') r.called = true;
    }
    if (e.street === street && street !== 'preflop' && aggressive) r.aggression++;
  }
  return out;
}

/**
 * Preflop range (SPEC §8.1): raised → top pfr, 3-bet → top threeBet (4-bet+ → the top
 * FOUR_BET_SHARE of that); called → the band between pfr and vpip; acted without putting money in
 * voluntarily (the BB or straddler checking) → the complement of the raising range; not acted yet →
 * top vpip, the hands it would play.
 */
export function preflopRange(stats, action) {
  const vpip = Math.max(stats.vpip, 0.02);
  const pfr = Math.max(Math.min(stats.pfr, vpip), 0.01);
  const threeBet = Math.max(Math.min(stats.threeBet, pfr), 0.01);
  if (!action?.acted) return strengthBand(0, vpip);
  if (action.raiseIndex >= 3) return strengthBand(0, threeBet * FOUR_BET_SHARE + 0.01);
  if (action.raiseIndex === 2) return strengthBand(0, threeBet);
  if (action.raiseIndex === 1) return strengthBand(0, pfr);
  if (action.called) return strengthBand(pfr, Math.max(vpip, pfr + MIN_BAND));
  return strengthBand(pfr, 1.01);
}

/**
 * Drop the weakest `dropFrac` of a range (combo-weighted) by made-hand strength on this board.
 * Each class keeps weight in proportion to its surviving live combos.
 */
export function dropWeakest(range, boardCodes, blocked, dropFrac) {
  if (!(dropFrac > 0) || boardCodes.length < 3) return range;
  const hand = [0, 0, ...boardCodes];
  const combos = [];
  for (const [cls, w] of Object.entries(range)) {
    if (!(w > 0)) continue;
    for (const [a, b] of classCombos(cls)) {
      if (blocked[a] || blocked[b]) continue;
      hand[0] = a;
      hand[1] = b;
      combos.push({ cls, w, score: evaluateCodes(hand) });
    }
  }
  combos.sort((x, y) => x.score - y.score);
  const total = combos.reduce((s, c) => s + c.w, 0);
  const live = {};
  const kept = {};
  let dropped = 0;
  for (const c of combos) {
    live[c.cls] = (live[c.cls] ?? 0) + 1;
    if (dropped < dropFrac * total) dropped += c.w;
    else kept[c.cls] = (kept[c.cls] ?? 0) + 1;
  }
  const out = {};
  for (const cls of Object.keys(kept)) out[cls] = range[cls] * (kept[cls] / live[cls]);
  return Object.keys(out).length ? out : range;
}

function hasLiveCombo(range, blocked) {
  for (const [cls, w] of Object.entries(range)) {
    if (!(w > 0)) continue;
    for (const [a, b] of classCombos(cls)) if (!blocked[a] && !blocked[b]) return true;
  }
  return false;
}

/**
 * Estimated ranges for the given opponents at one decision point.
 * @param {{events: Object[], street: string, board: string[], heroCards: string[],
 *          opponents: {seat: number, profile: Object|null}[]}} spot
 * @returns {{seat: number, range: Object<string, number>, stats: Object}[]}
 */
export function opponentRanges({ events, street, board, heroCards, opponents }) {
  const actions = seatActions(events, street);
  const boardCodes = board.map(cardCode);
  const blocked = new Uint8Array(52);
  for (const c of [...boardCodes, ...heroCards.map(cardCode)]) blocked[c] = 1;
  return opponents.map(({ seat, profile }) => {
    const stats = statsOf(profile);
    const action = actions.get(seat);
    let range = preflopRange(stats, action);
    if (action?.aggression > 0) {
      range = dropWeakest(range, boardCodes, blocked, POSTFLOP_DROP * (1 - stats.bluffFreq));
    }
    if (!hasLiveCombo(range, blocked)) range = strengthBand(0, 1.01);
    return { seat, range, stats };
  });
}
