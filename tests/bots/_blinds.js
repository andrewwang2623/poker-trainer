// Blind-play spots for simulation tests and tests/bots/blind-report.js: the first preflop decision of
// the SB or BB when it's folded to them (unopened, facing an unraised straddle, or facing one open
// with no callers), tallied as fold / call / raise by tier and opener position.
import { TIERS, POSITIONS_BY_SIZE } from '../../src/shared/schemas.js';
import { createRng, deriveSeed, createHand, applyAction, getView } from '../../src/engine/index.js';
import { decideAction, createBotProfile } from '../../src/bots/index.js';
import { simulateBotHands } from './_sim.js';

export const OPENER_GROUPS = Object.freeze({
  UTG: 'early', UTG1: 'early', UTG2: 'early', LJ: 'middle', HJ: 'middle', CO: 'late', BTN: 'late', SB: 'SB',
});

/**
 * Classify a blind's decision, or null when it isn't one of the tracked spots.
 * @returns {{spot: string, group: string}|null}
 *   spots: bbVsOpen, sbVsOpen, sbFirstIn (3+ handed, no straddle); huSbFirstIn, huBbVsOpen (heads-up);
 *   bbVsStraddle, sbVsStraddle (folded to the blind with only the straddle in).
 */
export function blindSpot(view) {
  if (view.street !== 'preflop' || (view.position !== 'SB' && view.position !== 'BB')) return null;
  const acts = view.events.filter((e) => e.type === 'action' && e.street === 'preflop');
  if (acts.some((e) => e.seat === view.seat)) return null;
  const raises = acts.filter((e) => e.action === 'raise' || e.action === 'bet');
  if (acts.some((e) => e.action === 'call')) return null;
  const hu = view.numPlayers === 2;
  const straddled = view.straddleSeat != null;
  if (raises.length === 0) {
    if (straddled) return { spot: view.position === 'BB' ? 'bbVsStraddle' : 'sbVsStraddle', group: 'all' };
    if (view.position !== 'SB') return null;
    return { spot: hu ? 'huSbFirstIn' : 'sbFirstIn', group: 'all' };
  }
  if (raises.length !== 1 || straddled) return null;
  if (hu) return { spot: 'huBbVsOpen', group: 'SB' };
  const opener = view.players[raises[0].seat].position;
  return { spot: view.position === 'BB' ? 'bbVsOpen' : 'sbVsOpen', group: OPENER_GROUPS[opener] ?? opener };
}

/**
 * Simulate bot-only hands and tally blind decisions.
 * @returns {Object} tallies[spot][group][tier] = {n, fold, call, raise}
 */
export function blindTallies(opts) {
  const out = {};
  simulateBotHands({
    ...opts,
    onDecision(view, profile, action) {
      const s = blindSpot(view);
      if (!s) return;
      const byGroup = (out[s.spot] ??= {});
      const byTier = (byGroup[s.group] ??= Object.fromEntries(TIERS.map((t) => [t, { n: 0, fold: 0, call: 0, raise: 0 }])));
      const t = byTier[profile.tier];
      t.n++;
      t[action.type === 'check' ? 'call' : action.type === 'bet' ? 'raise' : action.type]++;
    },
  });
  return out;
}

/** Fold / call / raise shares of one tally cell (null when empty). */
export function rates(cell) {
  if (!cell?.n) return null;
  return { n: cell.n, fold: cell.fold / cell.n, call: cell.call / cell.n, raise: cell.raise / cell.n };
}

/**
 * Spot simulation: deal `samples` random hands at a fixed table, fold to `opener` (a position label,
 * or null for nobody), let it open to the standard size (2.5 effective blinds, 3 from the SB), fold to
 * `defender` (a position label, usually 'SB' or 'BB') and tally a freshly sampled `tier` bot's decision there. Stacks are
 * uniform 20–200bb like real scenarios. With straddle, the first seat after the BB has posted one.
 * `openBlinds` overrides the open size in effective blinds.
 * @returns {{n, fold, call, raise}} shares (n = samples)
 */
export function spotRates({ tier, numPlayers, opener, defender, straddle = false, openBlinds, samples = 2000, seed = 1 }) {
  const positions = POSITIONS_BY_SIZE[numPlayers];
  const buttonSeat = 0;
  const bbSeat = numPlayers === 2 ? 1 : 2 % numPlayers;
  const seatOf = (pos) => (bbSeat + 1 + positions.indexOf(pos)) % numPlayers;
  const defenderSeat = seatOf(defender);
  const openerSeat = opener === null ? null : seatOf(opener);
  const straddleSeat = straddle ? (bbSeat + 1) % numPlayers : null;
  const heroSeat = openerSeat ?? straddleSeat ?? (defenderSeat + 1) % numPlayers;
  const tally = { n: 0, fold: 0, call: 0, raise: 0 };
  for (let i = 0; i < samples; i++) {
    const handSeed = seed * 1000003 + i;
    const rng = createRng(deriveSeed(handSeed, 'bots'));
    const profiles = Array.from({ length: numPlayers }, () => createBotProfile(tier, rng));
    let s = createHand({
      seed: handSeed, createdAt: handSeed, stakes: 'mid', numPlayers, buttonSeat, heroSeat, straddleSeat, bounties: [],
      seats: profiles.map((profile, seat) => ({
        seat, isHero: seat === heroSeat, stack: (20 + Math.floor(rng() * 181)) * 100,
        tier: seat === heroSeat ? null : tier, profile: seat === heroSeat ? null : profile,
      })),
    });
    const blind = straddle ? 200 : 100;
    while (s.actingSeat !== defenderSeat) {
      const pos = s.players[s.actingSeat].position;
      s = applyAction(s, s.actingSeat === openerSeat
        ? { type: 'raise', amount: Math.round((openBlinds ?? (pos === 'SB' ? 3 : 2.5)) * blind) }
        : { type: 'fold' });
    }
    const action = decideAction(getView(s, defenderSeat), profiles[defenderSeat], { rng, heroStats: null });
    tally.n++;
    tally[action.type === 'check' ? 'call' : action.type === 'bet' ? 'raise' : action.type]++;
  }
  return { n: tally.n, fold: tally.fold / tally.n, call: tally.call / tally.n, raise: tally.raise / tally.n };
}
