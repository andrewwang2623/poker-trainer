// The coach's approximate EV model (SPEC §8.2). All amounts are bb.
//   EV(fold) = 0
//   EV(check) = E·P·R
//   EV(call) = E·(P+C)·R − C
//   EV(bet/raise adding A) = F·P + (1−F)·(E'·(P+2A)·R − A)
// Two effective-stack corrections the spec's formulas leave implicit: a call or raise only wins
// what opponents can match (chips beyond hero's all-in come back uncalled), so P and A are capped
// at the matchable amount.
// Two overbet guards (REQUESTS-claude.md): taken literally, F keeps growing with A/P while E' stays
// 0.85·E, so a 20×-pot shove scores best with the nuts and as a bluff alike. Folds stop growing past
// FOLD_SIZE_CAP × pot, and a bet or raise of f > 1 pot is called by a tighter range:
// E' = 0.85·E / f^OVERBET_EXP. Bets up to pot (every ½/¾/pot preset) use §8.2 unchanged.

/** Realization: river or all-in, in position, out of position. */
export const REALIZATION = Object.freeze({ final: 1, inPosition: 0.95, outOfPosition: 0.85 });
/** E' = CALLED_EQUITY · E, hero's equity against the range that calls a bet or raise. */
export const CALLED_EQUITY = 0.85;
/** Per-opponent fold chance: clamp(foldToBet × (FOLD_BASE + FOLD_SLOPE·A/P), FOLD_MIN, FOLD_MAX). */
export const FOLD_BASE = 0.6;
export const FOLD_SLOPE = 0.53;
export const FOLD_MIN = 0.05;
export const FOLD_MAX = 0.9;
/** A/P above this adds no fold equity (overbet guard). */
export const FOLD_SIZE_CAP = 2;
/** E' shrinks by f^OVERBET_EXP for a bet or raise of f > 1 pot (overbet guard). */
export const OVERBET_EXP = 0.5;
/** Bet/raise candidates as a share of the pot (a raise: of the pot after calling). */
export const BET_SIZES = Object.freeze([0.5, 0.75, 1]);

/** Preflop chart costs in bb: evLoss = cost × (1 − chart frequency of the chosen action). */
export const CHART_COSTS = Object.freeze({
  openOutOfRange: 0.4, missedOpen: 0.3, limp: 0.3, callOutOfRange: 0.6,
  missed3bet: 0.4, threeBetOutOfRange: 0.8, foldInRange: 1.0,
});
/** Chart frequency thresholds for preflop flags (§8.3). */
export const CHART_LOW = 0.25;
export const CHART_HIGH = 0.75;

/** Severity cutoffs in bb of EV loss. */
export const SEVERITY_MAJOR = 3;
export const SEVERITY_MINOR = 0.5;
/** Loss needed for EQ_BAD_CALL / EQ_BAD_FOLD, and the extra equity margin for EQ_BAD_FOLD. */
export const EQ_FLAG_LOSS = 0.5;
export const BAD_FOLD_MARGIN = 0.05;
/** Equity cutoffs: value (EQ_MISSED_VALUE), bluff (EQ_BAD_BLUFF), passive-raise payoff. */
export const VALUE_EQUITY = 0.6;
export const BLUFF_EQUITY = 0.35;
export const PAYOFF_EQUITY = 0.5;
export const PASSIVE_AF = 1.5;
/** Grade: a hand with this much total EV loss is major even without a major flag. */
export const GRADE_MAJOR_LOSS = 5;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function severityOf(evLossBb) {
  if (evLossBb >= SEVERITY_MAJOR) return 'major';
  if (evLossBb >= SEVERITY_MINOR) return 'minor';
  return 'info';
}

/**
 * F: the chance every opponent folds to a bet or raise adding A into P. An all-in opponent can't fold.
 * @param {{foldToBet: number, allIn: boolean}[]} opponents
 */
export function foldEstimate(opponents, addBb, potBb) {
  if (!opponents.length || !(potBb > 0)) return 0;
  let f = 1;
  for (const o of opponents) {
    if (o.allIn) return 0;
    const size = Math.min(FOLD_SIZE_CAP, addBb / potBb);
    f *= clamp(o.foldToBet * (FOLD_BASE + FOLD_SLOPE * size), FOLD_MIN, FOLD_MAX);
  }
  return f;
}

export const evCheck = (E, P, R) => E * P * R;
export const evCall = (E, P, C, R) => E * (P + C) * R - C;
export const evBet = (E, P, A, R, F) => F * P + (1 - F) * (CALLED_EQUITY * E * (P + 2 * A) * R - A);

/** Equity to use in evBet for a bet or raise of `frac` pot: E, tightened for overbets. */
export const overbetEquity = (E, frac) => (frac > 1 ? E / frac ** OVERBET_EXP : E);

const round2 = (x) => Math.round(x * 100) / 100;

/** Key for a bet/raise of `to` chips (see candidateActions). */
export function sizeKey(type, to, spot) {
  if (to >= spot.legal.maxTo) return 'allIn';
  const add = to - spot.heroCommitted;
  const frac = (add - spot.legal.toCall) / (spot.pot + spot.legal.toCall);
  return `${type}:${round2(frac)}`;
}

/**
 * The candidate actions (§8.2): fold or check, call, bet/raise at BET_SIZES of the pot plus
 * all-in (legal sizes only), plus the chosen action.
 * @param {{legal: Object, pot: number, heroCommitted: number}} spot  chips
 * @param {{type: string, amount?: number}} chosen
 * @returns {{key: string, type: string, to: number|null}[]} chosen last if it isn't a preset
 */
export function candidateActions(spot, chosen) {
  const { legal, pot, heroCommitted } = spot;
  const out = [];
  if (legal.types.includes('check')) out.push({ key: 'check', type: 'check', to: null });
  if (legal.types.includes('fold')) out.push({ key: 'fold', type: 'fold', to: null });
  if (legal.types.includes('call')) out.push({ key: 'call', type: 'call', to: null });
  const aggro = legal.types.find((t) => t === 'bet' || t === 'raise');
  if (aggro) {
    for (const f of BET_SIZES) {
      const to = heroCommitted + Math.round(legal.toCall + f * (pot + legal.toCall));
      if (to < legal.minTo || to >= legal.maxTo) continue;
      out.push({ key: `${aggro}:${f}`, type: aggro, to });
    }
    out.push({ key: 'allIn', type: aggro, to: legal.maxTo });
  }
  if (chosen) {
    const to = chosen.type === 'bet' || chosen.type === 'raise' ? chosen.amount : null;
    const key = to === null ? chosen.type : sizeKey(chosen.type, to, spot);
    if (!out.some((c) => c.key === key)) out.push({ key, type: chosen.type, to, chosen: true });
    else out.find((c) => c.key === key).chosen = true;
  }
  return out;
}

/**
 * EV in bb of each candidate.
 * Continuing actions add the expected bounty (§15): P(winning the main pot) × the bounty payout,
 * where a win by folds only counts for 'showdownOrFold'.
 * @param {Object} spot  DecisionContext plus {equity, inPosition, bounties}; opponents carry `stats`.
 *   bounties: [{bb, paysOnFold}] for each live bounty hero holds (bb = total payout to hero).
 * @returns {{key: string, type: string, to: number|null, ev: number, fold: number|null, addBb: number}[]}
 */
export function evaluateCandidates(spot, candidates) {
  const E = spot.equity;
  const P = spot.pot / 100;
  const C = spot.legal.toCall / 100;
  const opps = spot.opponents.map((o) => ({
    foldToBet: o.stats.foldToBet, allIn: o.allIn, reach: o.committedStreet + o.stack,
  }));
  const reach = Math.max(0, ...opps.map((o) => o.reach));
  const streetR = spot.street === 'river' ? REALIZATION.final
    : spot.inPosition ? REALIZATION.inPosition : REALIZATION.outOfPosition;
  const bounties = spot.bounties ?? [];
  const bounty = bounties.reduce((s, b) => s + b.bb, 0);
  const foldPaid = bounties.reduce((s, b) => s + (b.paysOnFold ? b.bb : 0), 0);
  return candidates.map((c) => {
    let ev = 0;
    let fold = null;
    let addBb = 0;
    if (c.type === 'check') {
      ev = evCheck(E, P, streetR) + bounty * E;
    } else if (c.type === 'call') {
      const after = spot.heroCommitted + spot.legal.toCall;
      const heroAllIn = spot.legal.toCall >= spot.legal.maxTo - spot.heroCommitted;
      // Opponent chips above hero's all-in level are returned uncalled.
      const excess = spot.opponents.reduce((s, o) => s + Math.max(0, o.committedStreet - after), 0) / 100;
      const noMoreBetting = heroAllIn || opps.every((o) => o.allIn);
      ev = evCall(E, P - excess, C, noMoreBetting ? REALIZATION.final : streetR) + bounty * E;
      addBb = C;
    } else if (c.type === 'bet' || c.type === 'raise') {
      const A = (c.to - spot.heroCommitted) / 100;
      const matchable = (Math.min(c.to, reach) - spot.heroCommitted) / 100;
      const R = c.to >= spot.legal.maxTo ? REALIZATION.final : streetR;
      const Ec = overbetEquity(E, (A - C) / (P + C));
      fold = foldEstimate(opps, A, P);
      ev = evBet(Ec, P, Math.max(matchable, C), R, fold);
      ev += foldPaid * fold + bounty * (1 - fold) * CALLED_EQUITY * Ec;
      addBb = A;
    }
    return { ...c, ev: round2(ev), fold, addBb };
  });
}
