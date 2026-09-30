// Preflop chart checks for hero (SPEC §8.2, §8.3, §14). Roles follow the bots: with a straddle live
// the straddler uses the BB row, the real BB the SB row (it has no 'open' row), and depth and sizes
// are read in effective blinds (the straddle).
import { getChartRange } from '../data/ranges.js';
import { handClass } from '../engine/index.js';
import { CHART_COSTS, CHART_LOW, CHART_HIGH } from './ev.js';

/** Recommended open sizes in effective blinds before limpers; each limper adds one. */
export const OPEN_SIZE = Object.freeze({ default: [2, 3], SB: [2.5, 3.5] });

export function depthBand(effBlinds) {
  if (effBlinds <= 40) return 'short';
  if (effBlinds <= 100) return 'mid';
  return 'deep';
}

/** A seat's chart row: its position, remapped for a live straddle (§14). */
export function chartRole(record, seat) {
  const position = record.players.find((p) => p.seat === seat)?.position;
  if (record.straddleSeat == null) return position;
  if (seat === record.straddleSeat) return 'BB';
  return position === 'BB' ? 'SB' : position;
}

const freqOf = (position, band, action, cls) => {
  if (position === 'BB' && action === 'open') return 0;
  return getChartRange(position, band, action)[cls] ?? 0;
};

/**
 * Chart reading of one preflop decision, or null where the charts don't cover it (limped pots,
 * facing a 3-bet or more). `held` = hero holds a live bounty: playing it is never out of range.
 * @param {Object} record
 * @param {import('./context.js').DecisionContext} ctx
 * @param {boolean} held
 * @returns {null|{spot: 'unopened'|'raised', chart: Object, evLossBb: number, best: string,
 *   flags: {id: string, data: Object}[]}}  best: 'raise'|'call'|'fold' by lowest chart cost
 */
export function chartCheck(record, ctx, held) {
  const { decision, preflop } = ctx;
  const type = decision.action.type;
  const cls = handClass(decision.holeCards);
  const position = chartRole(record, record.heroSeat);
  const band = depthBand(decision.effectiveStackBb / (ctx.blind / 100));
  const base = { hand: cls, position, depthBand: band };
  const flags = [];

  if (preflop.raises === 0 && preflop.limpers === 0) {
    if (position === 'BB') return null;
    const open = freqOf(position, band, 'open', cls);
    // The SB open row covers a first-in raise or limp (§5 RangeChart).
    const limpFreq = position === 'SB' ? open : 0;
    const cost = {
      raise: CHART_COSTS.openOutOfRange * (1 - open),
      fold: CHART_COSTS.missedOpen * open,
      call: CHART_COSTS.limp * (1 - limpFreq),
    };
    if (type === 'raise' && open < CHART_LOW && !held) {
      flags.push({ id: 'PF_OPEN_OUT_OF_RANGE', data: { ...base, chartFreq: open } });
    }
    if (type === 'fold' && open >= CHART_HIGH) {
      flags.push({ id: 'PF_MISSED_OPEN', data: { ...base, chartFreq: open } });
    }
    if (type === 'call' && limpFreq < CHART_LOW && !(held && position === 'SB')) {
      flags.push({ id: 'PF_OPEN_LIMP', data: base });
    }
    // A bounty makes playing the hand fine; limping outside the SB is still a leak.
    if (held && (type === 'raise' || (type === 'call' && position === 'SB'))) cost[type] = 0;
    return {
      spot: 'unopened',
      chart: { position, band, action: 'open', freq: open },
      evLossBb: cost[type] ?? 0,
      best: bestOf(cost),
      flags,
    };
  }

  if (preflop.raises === 1) {
    const vsPosition = chartRole(record, preflop.raiserSeat);
    const call = freqOf(position, band, 'call', cls);
    const threeBet = freqOf(position, band, 'threeBet', cls);
    const vs = { ...base, vsPosition };
    const missed3bet = threeBet >= CHART_HIGH;
    const cost = {
      call: (missed3bet ? CHART_COSTS.missed3bet : CHART_COSTS.callOutOfRange) * (1 - call),
      raise: CHART_COSTS.threeBetOutOfRange * (1 - threeBet),
      fold: CHART_COSTS.foldInRange * Math.min(1, call + threeBet),
    };
    if (type === 'call') {
      if (missed3bet) flags.push({ id: 'PF_MISSED_3BET', data: { ...vs, chartFreq: threeBet } });
      else if (call < CHART_LOW && !held) {
        flags.push({
          id: 'PF_CALL_OUT_OF_RANGE',
          data: { ...vs, raiseToBb: preflop.raiseTo / 100, chartFreq: call },
        });
      }
    }
    if (type === 'raise' && threeBet < CHART_LOW && !held) {
      flags.push({ id: 'PF_3BET_OUT_OF_RANGE', data: { ...vs, chartFreq: threeBet } });
    }
    if (type === 'fold' && call + threeBet >= CHART_HIGH) {
      flags.push({ id: 'PF_FOLD_IN_RANGE', data: { ...vs, callFreq: call, threeBetFreq: threeBet } });
    }
    if (held && type !== 'fold' && !(type === 'call' && missed3bet)) cost[type] = 0;
    const action = type === 'call' ? 'call' : type === 'raise' ? 'threeBet'
      : threeBet > call ? 'threeBet' : 'call';
    return {
      spot: 'raised',
      chart: { position, band, action, freq: action === 'call' ? call : threeBet },
      evLossBb: cost[type] ?? 0,
      best: bestOf(cost),
      flags,
    };
  }
  return null;
}

function bestOf(cost) {
  return Object.entries(cost).reduce((a, b) => (b[1] < a[1] ? b : a))[0];
}

/**
 * PF_OPEN_SIZE data when hero raised first-in or over limpers outside the recommended size, else
 * null. Sizes are compared in effective blinds and reported in bb.
 */
export function openSizeCheck(record, ctx) {
  const { decision, preflop } = ctx;
  if (decision.action.type !== 'raise' || preflop.raises > 0 || decision.allIn) return null;
  const position = chartRole(record, record.heroSeat);
  const unit = ctx.blind / 100;
  const [lo, hi] = (OPEN_SIZE[position] ?? OPEN_SIZE.default).map((x) => (x + preflop.limpers) * unit);
  const sizeBb = decision.action.amount / 100;
  const eps = 1e-9;
  if (sizeBb >= lo - eps && sizeBb <= hi + eps) return null;
  return { sizeBb, recommendedBb: [lo, hi], position, limpers: preflop.limpers };
}
