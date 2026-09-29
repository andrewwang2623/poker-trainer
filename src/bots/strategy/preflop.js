// Preflop decisions (SPEC §7). Chart tiers sample (or argmax) RANGE_CHART frequencies; rule-based
// tiers fill vpip/pfr/threeBet percentage thresholds from a strength ordering shaped by their tier's
// variant chart. Deep commitments (big raises, 4-bets+) go by equity vs the raisers' ranges.
import { computeEquity, handClass } from '../../engine/index.js';
import { getTierChartRange } from '../../data/ranges.js';
import {
  STRENGTH_PCT, HAND_CLASSES, blendedPercentiles, comboCount, percentileWithinRange,
  rangeCoverage,
} from './handRank.js';
import {
  depthBand, effectiveStackBb, liveOpponents, postflopOrder, preflopActions, preflopSpot,
} from './situation.js';
import { opponentRanges } from './ranges.js';
import { openTo, threeBetTo, fourBetTo } from './sizing.js';
import { TIER_STYLE, POSITION_WIDTH, PREFLOP_NOISE, POSTFLOP_NOISE } from './style.js';

/** A stack-off decision: the raise is at least this share of our chips for the street. */
const COMMIT_SHARE = 0.35;

/**
 * Pick from [{type, to?, f}] by frequency (mixing) or take the most frequent (argmax). Whatever
 * frequency is left over is a fold.
 */
export function choose(options, mixing, rng) {
  const total = options.reduce((s, o) => s + o.f, 0);
  const fold = { type: 'fold', f: Math.max(0, 1 - total) };
  if (mixing) {
    let x = rng();
    for (const o of options) {
      x -= o.f;
      if (x < 0) return o;
    }
    return fold;
  }
  return [...options, fold].reduce((best, o) => (o.f > best.f ? o : best));
}

const cache = new Map();
function memo(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}

/**
 * Scale a range to `factor` × its combo coverage: above 1, top up the next-strongest hands; below
 * 1, keep only the strongest part. Factors are snapped to 0.05 so the memo stays small.
 */
function scaled(range, factor, key) {
  const f = Math.round(factor * 20) / 20;
  if (f === 1) return range;
  return memo(`s|${key}|${f}`, () => {
    const target = Math.min(1, rangeCoverage(range) * f);
    const out = f > 1 ? { ...range } : {};
    let cov = f > 1 ? rangeCoverage(range) : 0;
    for (const cls of HAND_CLASSES) {
      if (cov >= target) break;
      const have = out[cls] ?? 0;
      const room = (f > 1 ? 1 : (range[cls] ?? 0)) - have;
      if (room <= 0) continue;
      const add = Math.min(room, ((target - cov) * 1326) / comboCount(cls));
      out[cls] = have + add;
      cov += (add * comboCount(cls)) / 1326;
    }
    return out;
  });
}

/** Tier-variant ordering for rule-based bots: 'open' (first-in, limped) or 'respond' (vs a raise). */
function variantPercentiles(tier, position, band, kind, weight) {
  return memo(`v|${tier}|${position}|${band}|${kind}`, () => {
    let chart;
    if (kind === 'open' && position !== 'BB') chart = getTierChartRange(tier, position, band, 'open');
    else {
      const call = getTierChartRange(tier, position, band, 'call');
      const threeBet = getTierChartRange(tier, position, band, 'threeBet');
      chart = {};
      for (const cls of HAND_CLASSES) chart[cls] = Math.min(1, (call[cls] ?? 0) + (threeBet[cls] ?? 0));
    }
    return blendedPercentiles(chart, weight);
  });
}

/**
 * @param {import('../../shared/schemas.js').SeatView} view
 * @param {import('../../shared/schemas.js').BotProfile} profile
 * @param {{rng: Function, heroStats: Object|null}} ctx
 * @param {Object} adj  exploitAdjust() result
 * @returns {{type: string, to?: number}}
 */
export function preflopDecision(view, profile, ctx, adj) {
  const legal = view.legal;
  const me = view.players[view.seat];
  const info = {
    cls: handClass(view.holeCards),
    position: view.position,
    band: depthBand(effectiveStackBb(view)),
    ...preflopSpot(view),
  };
  if (legal.toCall > 0 &&
      (info.spot === 'fourBetPlus' || view.currentBet >= COMMIT_SHARE * (me.stack + me.committedStreet))) {
    return commitDecision(view, profile, ctx);
  }
  const ip = info.raiserSeat === null ? true
    : postflopOrder(view).indexOf(view.seat) > postflopOrder(view).indexOf(info.raiserSeat);
  return profile.usesCharts
    ? chartDecision(view, profile, ctx, adj, info, ip)
    : ruleDecision(view, profile, ctx, info, ip);
}

/**
 * Chart rates of the unscaled base chart in bot-only play (tests/bots/tier-report.js). Each chart
 * bot scales its open / call / 3-bet ranges by its profile target over these, so a bot's VPIP,
 * PFR and 3-bet land on its profile while keeping the chart's shape.
 */
export const CHART_BASE_RATES = Object.freeze({ pfr: 0.175, vpipGap: 0.075, threeBet: 0.06 });

function chartDecision(view, profile, ctx, adj, info, ip) {
  const { cls, position, band, spot, limpers } = info;
  const key = `${profile.tier}|${position}|${band}`;
  const factor = {
    open: profile.pfr / CHART_BASE_RATES.pfr,
    call: Math.max(profile.vpip - profile.pfr, 0.01) / CHART_BASE_RATES.vpipGap,
    threeBet: profile.threeBet / CHART_BASE_RATES.threeBet,
  };
  const chart = (action, extra = 1) =>
    scaled(getTierChartRange(profile.tier, position, band, action), factor[action] * extra, `${key}|${action}`);
  const heroLimped = preflopActions(view).get(view.heroSeat)?.limped === true;
  switch (spot) {
    case 'unopened':
      return choose([{ type: 'raise', to: openTo(position, 0), f: chart('open', adj.openWider)[cls] ?? 0 }],
        profile.mixing, ctx.rng);
    case 'limped': {
      const isoWider = heroLimped ? adj.isoWider : 1;
      const to = openTo(position, limpers);
      if (position === 'BB') {
        const iso = chart('threeBet', 1.5 * isoWider);
        return choose([{ type: 'raise', to, f: iso[cls] ?? 0 }], profile.mixing, ctx.rng);
      }
      const open = chart('open');
      const f = open[cls] ?? 0;
      const within = percentileWithinRange(open, cls);
      if (within === null) return { type: 'fold' };
      const late = ['CO', 'BTN', 'SB'].includes(position);
      return within < 0.6 * isoWider
        ? choose([{ type: 'raise', to, f }], profile.mixing, ctx.rng)
        : choose([{ type: 'call', f: late ? f : 0 }], profile.mixing, ctx.rng);
    }
    case 'raised':
      return choose([
        { type: 'raise', to: threeBetTo(view.currentBet, ip), f: chart('threeBet')[cls] ?? 0 },
        { type: 'call', f: chart('call')[cls] ?? 0 },
      ], profile.mixing, ctx.rng);
    default: {
      // Facing a 3-bet: continue with the top 40% of our 3-bet range, 4-bet the top 15% of it.
      const within = percentileWithinRange(getTierChartRange(profile.tier, position, band, 'threeBet'), cls);
      if (within === null || within >= 0.4) return { type: 'fold' };
      return within < 0.15 ? { type: 'raise', to: fourBetTo(view.currentBet, ip) } : { type: 'call' };
    }
  }
}

function ruleDecision(view, profile, ctx, info, ip) {
  const { cls, position, band, spot, limpers } = info;
  const style = TIER_STYLE[profile.tier] ?? TIER_STYLE.lowReg;
  const width = POSITION_WIDTH[position] ?? 1;
  // Noise scaled by 1 − skill. Capping its half-width at the threshold (and 1 − threshold) keeps
  // the expected rate at the threshold instead of inflating small ones like 3-bet%.
  const below = (pct, threshold) => {
    const a = Math.min((PREFLOP_NOISE / 2) * (1 - profile.skill), threshold, 1 - threshold);
    return pct + (ctx.rng() * 2 - 1) * Math.max(a, 0) < threshold;
  };
  const strength = STRENGTH_PCT[cls];
  switch (spot) {
    case 'unopened':
    case 'limped': {
      const pct = variantPercentiles(profile.tier, position, band, 'open', style.chartWeight)[cls];
      if (below(pct, profile.pfr * width * style.openPfrK)) return { type: 'raise', to: openTo(position, limpers) };
      if (below(pct, profile.vpip * width * style.openVpipK)) return { type: 'call' };
      return { type: 'fold' };
    }
    case 'raised': {
      if (below(strength, profile.threeBet * width * style.threeBetK)) {
        return { type: 'raise', to: threeBetTo(view.currentBet, ip) };
      }
      const pct = variantPercentiles(profile.tier, position, band, 'respond', style.chartWeight)[cls];
      const bbDiscount = position === 'BB' ? 1.3 : 1;
      const callTop = (profile.threeBet + Math.max(profile.vpip - profile.pfr, 0.04)) * width * style.callK * bbDiscount;
      return below(pct, callTop) ? { type: 'call' } : { type: 'fold' };
    }
    default: {
      if (below(strength, profile.threeBet * 0.3)) return { type: 'raise', to: fourBetTo(view.currentBet, ip) };
      const base = profile.tier === 'fish' ? profile.vpip : profile.pfr;
      return below(strength, base * style.callVsThreeBet) ? { type: 'call' } : { type: 'fold' };
    }
  }
}

/** Big raises and 4-bets+: call or jam by equity against the players who put money in voluntarily. */
function commitDecision(view, profile, ctx) {
  const style = TIER_STYLE[profile.tier] ?? TIER_STYLE.lowReg;
  const pf = preflopActions(view);
  let opps = liveOpponents(view).filter((p) => pf.get(p.seat)?.raiseIndex > 0 || pf.get(p.seat)?.called);
  if (!opps.length) opps = liveOpponents(view);
  const ranges = opponentRanges(view, opps, ctx.heroStats).map((r) => r.range);
  let equity = computeEquity({ hero: view.holeCards, villains: ranges, iterations: 300, rng: ctx.rng }).equity;
  equity += (ctx.rng() - 0.5) * POSTFLOP_NOISE * (1 - profile.skill);
  const { toCall } = view.legal;
  const potOdds = toCall / (view.pot + toCall);
  const relEquity = Math.min(1, (equity * (opps.length + 1)) / 2);
  if (relEquity >= 0.62 && view.legal.types.includes('raise')) return { type: 'raise', to: view.legal.maxTo };
  if (equity >= potOdds - style.looseCall) return { type: 'call' };
  return { type: 'fold' };
}
