// Hand-level coach flags (SPEC §8.3) from one analyzed decision. Pattern (PAT_*) flags live in
// patterns.js. Flags carry data only; src/explain/ writes the text.
import {
  severityOf, EQ_FLAG_LOSS, BAD_FOLD_MARGIN, VALUE_EQUITY, BLUFF_EQUITY, PAYOFF_EQUITY, PASSIVE_AF,
} from './ev.js';

/** Postflop bet sizes by texture as a share of the pot (SPEC §7), and the river polar range. */
export const TEXTURE_PCT = Object.freeze({
  dry: Object.freeze([0.25, 0.33]), paired: Object.freeze([0.33, 0.33]), semiwet: Object.freeze([0.5, 0.5]),
  wet: Object.freeze([0.66, 0.8]), monotone: Object.freeze([0.66, 0.8]),
});
export const RIVER_POLAR_PCT = Object.freeze([0.75, 1.25]);
/** A bet is flagged below the texture range by this much, or above it by SIZE_OVER. */
export const SIZE_UNDER = 0.1;
export const SIZE_OVER = 0.25;
/** River bets at or above this equity (nutted) or below BLUFF_EQUITY count as polarized. */
export const RIVER_NUT_EQUITY = 0.75;

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;

/**
 * @param {Object} a  analyzed decision: {ctx, equity, potOdds, matchedPot, evs, chosen, best, evLossBb, source,
 *   chartResult, openSize, texture, sizing, oppTier, mainOpp, heroSeat}
 * @returns {import('../shared/schemas.js').CoachFlag[]}
 */
export function decisionFlags(a) {
  const { ctx, equity, potOdds, chosen, best, evLossBb, texture } = a;
  const d = ctx.decision;
  const type = d.action.type;
  const flags = [];
  const flag = (id, data, loss = evLossBb) => flags.push({
    id, severity: severityOf(loss), street: d.street, decisionIndex: d.index, evLossBb: r2(loss),
    oppTier: a.oppTier, data,
  });
  const potBb = r2(ctx.pot / 100);
  const toCallBb = r2(ctx.legal.toCall / 100);
  // The pot hero's call can win, so requiredEquity = toCallBb / (matchedPotBb + toCallBb).
  const matchedPotBb = r2((a.matchedPot ?? ctx.pot) / 100);

  for (const f of a.chartResult?.flags ?? []) flag(f.id, f.data);
  if (a.openSize) flag('PF_OPEN_SIZE', a.openSize, 0);
  if (a.source !== 'ev') return flags;

  if (type === 'call' && potOdds !== null && equity < potOdds && evLossBb >= EQ_FLAG_LOSS) {
    flag('EQ_BAD_CALL', { equity: r3(equity), requiredEquity: r3(potOdds), toCallBb, potBb: matchedPotBb });
  }
  if (type === 'fold' && potOdds !== null && equity > potOdds + BAD_FOLD_MARGIN && evLossBb >= EQ_FLAG_LOSS) {
    flag('EQ_BAD_FOLD', { equity: r3(equity), requiredEquity: r3(potOdds), toCallBb, potBb: matchedPotBb });
  }

  const bestAggressive = best.type === 'bet' || best.type === 'raise';
  const cbetSpot = d.street === 'flop' && ctx.firstFlopDecision && ctx.preflopAggressor === a.heroSeat &&
    ctx.currentBet === 0;
  if (cbetSpot && type === 'check' && bestAggressive) {
    flag('LN_MISSED_CBET', { texture, numOpponents: d.numOpponents, equity: r3(equity) });
  } else if ((type === 'check' || type === 'call') && bestAggressive && equity >= VALUE_EQUITY && evLossBb > 0) {
    flag('EQ_MISSED_VALUE', { equity: r3(equity), potBb, bestAction: best.key, evGainBb: r2(evLossBb) });
  }

  if ((type === 'bet' || type === 'raise') && equity < BLUFF_EQUITY) {
    const passive = a.evs.find((c) => c.type === 'check' || c.type === 'fold');
    if (passive && chosen.ev < passive.ev) {
      flag('EQ_BAD_BLUFF', {
        equity: r3(equity),
        foldEstimate: r3(chosen.fold ?? 0),
        sizePct: r2(sizeFraction(ctx, d.action.amount)),
        oppVpip: r3(a.oppVpip),
      });
    }
  }

  if (type === 'bet' && d.street !== 'preflop' && texture && a.sizing) {
    const sizePct = r2(sizeFraction(ctx, d.action.amount));
    const [lo, hi] = TEXTURE_PCT[texture];
    const polar = d.street === 'river' && (equity >= RIVER_NUT_EQUITY || equity < BLUFF_EQUITY);
    const data = { sizePct, recommendedPct: [lo, hi], texture };
    if (sizePct < lo - SIZE_UNDER && !d.allIn) flag('SZ_TOO_SMALL', data, a.sizing.lossBb);
    if (sizePct > hi + SIZE_OVER && !d.allIn && !polar) flag('SZ_TOO_LARGE', data, a.sizing.lossBb);
  }

  if (type === 'call' && (d.street === 'turn' || d.street === 'river') && d.facing === 'facingRaise' &&
      a.raiser && a.raiser.stats.aggression < PASSIVE_AF && equity < PAYOFF_EQUITY) {
    flag('LN_PAYOFF_PASSIVE_RAISE', { oppAggression: r2(a.raiser.stats.aggression), equity: r3(equity), toCallBb });
  }
  return flags;
}

/** A bet or raise to `to` chips as a share of the pot (a raise: its size over the pot after calling). */
export function sizeFraction(ctx, to) {
  const add = to - ctx.heroCommitted;
  return (add - ctx.legal.toCall) / (ctx.pot + ctx.legal.toCall);
}
