// Postflop decisions (SPEC §7): equity against opponents' estimated ranges (300 samples), value
// bets/raises above a threshold, bluffs at bluffFreq below 0.35, calls by pot odds. Thresholds move
// with the profile's target AF. Mid/tough regs also defend by MDF; tough regs exploit hero.
import { boardTexture, computeEquity } from '../../engine/index.js';
import { inPosition, liveOpponents, preflopActions } from './situation.js';
import { opponentRanges, preflopRange, shareBeaten } from './ranges.js';
import { betFraction } from './sizing.js';
import { choose } from './preflop.js';
import { TIER_STYLE, POSTFLOP_NOISE } from './style.js';
import {
  BOUNTY_BLUFF_BONUS, BOUNTY_CALL_BONUS, BOUNTY_RIVER_FOLD_CUT, bountyChase, couldHoldBounty, heldBounties,
  heldBountyValue,
} from './bounty.js';

export const EQUITY_SAMPLES = 300;
const BLUFF_BELOW = 0.35;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * Equity threshold for value bets. SPEC §7's 0.6, moved by target AF: passive profiles need a
 * stronger hand to bet, aggressive ones bet thinner.
 */
export function valueThreshold(aggression) {
  return 0.6 + clamp((2.5 - aggression) * 0.03, -0.05, 0.1);
}

/**
 * @param {import('../../shared/schemas.js').SeatView} view
 * @param {import('../../shared/schemas.js').BotProfile} profile
 * @param {{rng: Function, heroStats: Object|null}} ctx
 * @param {Object} adj  exploitAdjust() result
 * @returns {{type: string, to?: number}}
 */
export function postflopDecision(view, profile, ctx, adj) {
  const { rng } = ctx;
  const legal = view.legal;
  const me = view.players[view.seat];
  const opps = liveOpponents(view);
  const ranges = opponentRanges(view, opps, ctx.heroStats);
  const raw = computeEquity({
    hero: view.holeCards, board: view.board, villains: ranges.map((r) => r.range),
    iterations: EQUITY_SAMPLES, rng,
  }).equity;
  const equity = clamp(raw + (rng() - 0.5) * POSTFLOP_NOISE * (1 - profile.skill), 0, 1);
  // Equity relative to a fair multiway share, so thresholds mean the same heads-up and multiway.
  const rel = Math.min(1, (equity * (opps.length + 1)) / 2);
  const vThr = valueThreshold(profile.aggression) + adj.valueThrDelta;
  const texture = boardTexture(view.board);
  // Bounties (SPEC §15): a held bounty that pays on a fold win makes bluffs worth more, and on the
  // river any held bounty is worth calling for. All zero when no bounty applies.
  const chase = bountyChase(profile);
  const held = heldBounties(view);
  const bluffBonus = held.some((b) => b.paysOn === 'showdownOrFold') ? chase * BOUNTY_BLUFF_BONUS : 0;
  const riverChase = view.street === 'river' && held.length ? chase : 0;
  const bluffP = (profile.bluffFreq + bluffBonus) * adj.bluffMul / Math.max(1, opps.length);

  const sized = (type, polar) => ({
    type,
    to: me.committedStreet + Math.round(betFraction(profile, { texture, street: view.street, polar }, rng) * view.pot),
  });

  if (legal.toCall === 0) {
    const cbetSpot = view.street === 'flop' && view.preflopAggressorSeat === view.seat;
    if (cbetSpot && adj.cbetAny && rng() < 0.9) return sized('bet', false);
    if (rel >= vThr) {
      const f = Math.min(0.95, 0.45 + 0.12 * profile.aggression); // mixers slow-play the rest
      const pick = choose([{ ...sized('bet', view.street === 'river' && rel >= 0.85), f }], profile.mixing, rng);
      return pick.type === 'fold' ? { type: 'check' } : pick;
    }
    if (cbetSpot && adj.cbetValueOnly) return { type: 'check' };
    if (rel >= BLUFF_BELOW) {
      // Protection / semi-bluff / c-bet zone: a mixed strategy, so only mixing profiles use it.
      const f = (cbetSpot ? 0.2 : 0.05) * (profile.aggression / 2.5);
      const pick = choose([{ ...sized('bet', false), f }], profile.mixing, rng);
      return pick.type === 'fold' ? { type: 'check' } : pick;
    }
    if (rng() < bluffP) return sized('bet', view.street === 'river');
    return { type: 'check' };
  }

  const { toCall } = legal;
  const potOdds = toCall / (view.pot + toCall);
  const canRaise = legal.types.includes('raise');
  const raiseTo = Math.max(view.currentBet * 3, view.currentBet + Math.round(0.5 * (view.pot + toCall)));
  if (canRaise && rel >= vThr + 0.12) {
    const f = profile.mixing ? Math.min(1, 0.15 * profile.aggression) : 1;
    const pick = choose([{ type: 'raise', to: raiseTo, f }, { type: 'call', f: 1 - f }], profile.mixing, rng);
    if (pick.type !== 'fold') return pick;
  }
  if (canRaise && rel < 0.3 && view.street !== 'river' && rng() < bluffP * 0.25) {
    return { type: 'raise', to: raiseTo };
  }

  // Profile layer: with probability 1 − skill, play the profile's fold-to-bet rate instead of the
  // equity read (never folding a value hand).
  if (rng() < 1 - profile.skill) {
    if (rel >= vThr) return { type: 'call' };
    const sizeRatio = toCall / Math.max(1, view.pot - toCall);
    const fold = clamp(profile.foldToBet * (0.6 + 0.53 * sizeRatio), 0.05, 0.9) * (1 - riverChase * BOUNTY_RIVER_FOLD_CUT);
    return rng() < fold ? { type: 'fold' } : { type: 'call' };
  }

  const facingHero = view.lastAggressorSeat === view.heroSeat;
  // River with a held bounty: the bounty is part of what a call can win.
  const bountyPot = riverChase > 0 ? riverChase * heldBountyValue(view, held) : 0;
  const callOdds = bountyPot > 0 ? toCall / (view.pot + toCall + bountyPot) : potOdds;
  // Calling a possible bounty holder only helps when a fold would hand them the bounty.
  const holderBonus = couldHoldBounty(view, view.lastAggressorSeat, 'showdownOrFold') ? chase * BOUNTY_CALL_BONUS : 0;
  const required = callOdds * (facingHero ? adj.callMul : 1) - (TIER_STYLE[profile.tier]?.looseCall ?? 0) - holderBonus;
  // Realization as in the coach's EV model (SPEC §8.2): all of it on the river, less out of position.
  const realized = equity * (view.street === 'river' ? 1 : inPosition(view) ? 0.95 : 0.85);
  let call = realized >= required;
  if (!call && TIER_STYLE[profile.tier]?.mdf && equity >= required * 0.6) {
    // MDF: defend when this hand is in the top (pot / (pot + bet)) of our own range.
    const mdf = 1 - toCall / view.pot;
    const own = preflopRange(profile, preflopActions(view).get(view.seat));
    call = shareBeaten(own, view.holeCards, view.board) >= 1 - mdf;
  }
  if (call && facingHero && adj.foldToRaiseExtra > 0 && lastActionWasRaise(view) && rel < 0.8 &&
      rng() < adj.foldToRaiseExtra) {
    call = false;
  }
  return call ? { type: 'call' } : { type: 'fold' };
}

function lastActionWasRaise(view) {
  for (let i = view.events.length - 1; i >= 0; i--) {
    const e = view.events[i];
    if (e.type === 'action' && e.seat === view.lastAggressorSeat) return e.action === 'raise';
  }
  return false;
}
