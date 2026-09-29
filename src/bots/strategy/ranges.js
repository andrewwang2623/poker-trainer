// Range estimates for postflop play: each player's preflop range from their stats and preflop
// action, narrowed by postflop aggression, and where a hand sits inside a range on this board.
import { cardCode, classCombos, evaluateCodes } from '../../engine/index.js';
import { strengthBand } from './handRank.js';
import { preflopActions, postflopAggression } from './situation.js';

export const NARROW_CURRENT = 0.55;
export const NARROW_EARLIER = 0.25;

/** Assumed stats for a player with no profile and no hero reads. */
export const UNKNOWN_STATS = Object.freeze({
  vpip: 0.28, pfr: 0.2, threeBet: 0.07, bluffFreq: 0.25, aggression: 2, foldToBet: 0.45,
});

/** Stats for a seat: its bot profile, else hero's session stats, else UNKNOWN_STATS. */
export function statsFor(view, seat, heroStats) {
  const p = view.players[seat];
  if (p.profile) return p.profile;
  if (p.isHero && heroStats && heroStats.hands > 0) {
    const pick = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const vpip = pick(heroStats.vpip, UNKNOWN_STATS.vpip);
    const pfr = Math.min(vpip, pick(heroStats.pfr, UNKNOWN_STATS.pfr));
    return {
      ...UNKNOWN_STATS,
      vpip, pfr, threeBet: Math.min(pfr, pick(heroStats.threeBet, UNKNOWN_STATS.threeBet)),
      aggression: pick(heroStats.af, UNKNOWN_STATS.aggression),
    };
  }
  return UNKNOWN_STATS;
}

/**
 * Preflop range by strength percentile band (SPEC §8.1-style): raised → top pfr (3-bet → top
 * threeBet, 4-bet+ → the top 40% of that); called a raise → threeBet..vpip; limped → pfr..vpip;
 * no voluntary action (BB check, blinds) → everything outside the top pfr.
 */
export function preflopRange(stats, action) {
  const vpip = Math.max(stats.vpip, 0.02);
  const pfr = Math.max(Math.min(stats.pfr, vpip), 0.01);
  const threeBet = Math.max(Math.min(stats.threeBet, pfr), 0.01);
  if (!action) return strengthBand(pfr, 1.01);
  if (action.raiseIndex >= 3) return strengthBand(0, threeBet * 0.4 + 0.01);
  if (action.raiseIndex === 2) return strengthBand(0, threeBet);
  if (action.raiseIndex === 1) return strengthBand(0, pfr);
  if (action.called && action.facingRaises >= 2) return strengthBand(threeBet * 0.4, pfr);
  if (action.called && action.facingRaises === 1) return strengthBand(threeBet, Math.max(vpip, threeBet + 0.08));
  if (action.called) return strengthBand(pfr, Math.max(vpip, pfr + 0.05));
  return strengthBand(pfr, 1.01);
}

/** Made-hand score of every unblocked combo in a range: [{cls, w, score}]. */
function scoredCombos(range, boardCodes, blocked) {
  const out = [];
  const hand = [0, 0, ...boardCodes];
  for (const [cls, w] of Object.entries(range)) {
    if (!(w > 0)) continue;
    for (const [a, b] of classCombos(cls)) {
      if (blocked[a] || blocked[b]) continue;
      hand[0] = a;
      hand[1] = b;
      out.push({ cls, w, score: evaluateCodes(hand) });
    }
  }
  return out;
}

/**
 * Drop the weakest `dropFrac` of a range by made-hand strength on this board. Class weights are
 * scaled by the share of their live combos that survive.
 */
export function narrowRange(range, boardCodes, blocked, dropFrac) {
  if (!(dropFrac > 0) || boardCodes.length < 3) return range;
  const combos = scoredCombos(range, boardCodes, blocked).sort((x, y) => x.score - y.score);
  const total = combos.reduce((s, c) => s + c.w, 0);
  const kept = {};
  const live = {};
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

/**
 * Share of a range's combos (weighted) that our made hand beats on this board; ties count half.
 * 1 = we beat everything, 0 = we beat nothing.
 */
export function shareBeaten(range, holeCards, board) {
  const boardCodes = board.map(cardCode);
  const holeCodes = holeCards.map(cardCode);
  const blocked = new Uint8Array(52);
  for (const c of [...boardCodes, ...holeCodes]) blocked[c] = 1;
  const ours = evaluateCodes([...holeCodes, ...boardCodes]);
  let total = 0;
  let beaten = 0;
  for (const { w, score } of scoredCombos(range, boardCodes, blocked)) {
    total += w;
    if (score < ours) beaten += w;
    else if (score === ours) beaten += w / 2;
  }
  return total > 0 ? beaten / total : 0.5;
}

/**
 * Ranges for every live opponent: preflop range from their stats and action, then drop the
 * weakest NARROW_CURRENT·(1 − bluffFreq) for each bet/raise on this street and
 * NARROW_EARLIER·(1 − bluffFreq) for each one on an earlier postflop street. Bots bet a strong,
 * lightly bluffed range, so these are steeper than the coach's 30% (SPEC §8.1).
 * @returns {{seat: number, range: Object<string, number>, stats: Object}[]}
 */
export function opponentRanges(view, opponents, heroStats) {
  const pf = preflopActions(view);
  const aggro = postflopAggression(view);
  const boardCodes = view.board.map(cardCode);
  const blocked = new Uint8Array(52);
  for (const c of [...boardCodes, ...view.holeCards.map(cardCode)]) blocked[c] = 1;
  return opponents.map((p) => {
    const stats = statsFor(view, p.seat, heroStats);
    let range = preflopRange(stats, pf.get(p.seat));
    const a = aggro.get(p.seat);
    if (a) {
      const keep = (1 - NARROW_CURRENT * (1 - stats.bluffFreq)) ** a.current *
        (1 - NARROW_EARLIER * (1 - stats.bluffFreq)) ** a.earlier;
      range = narrowRange(range, boardCodes, blocked, 1 - keep);
    }
    if (!hasLiveCombo(range, blocked)) range = strengthBand(0, 1.01);
    return { seat: p.seat, range, stats };
  });
}

function hasLiveCombo(range, blocked) {
  for (const [cls, w] of Object.entries(range)) {
    if (!(w > 0)) continue;
    for (const [a, b] of classCombos(cls)) if (!blocked[a] && !blocked[b]) return true;
  }
  return false;
}
