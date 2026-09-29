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
  chartPosition, depthBand, effectiveBlind, effectiveStackBb, liveOpponents, postflopOrder, preflopActions,
  preflopSpot,
} from './situation.js';
import { CHIPS_PER_BB } from '../../shared/schemas.js';
import { opponentRanges } from './ranges.js';
import { openTo, threeBetTo, fourBetTo } from './sizing.js';
import { TIER_STYLE, POSITION_WIDTH, PREFLOP_NOISE, POSTFLOP_NOISE } from './style.js';
import { bountyPreflop } from './bounty.js';
import {
  blindDefenseTarget, headsUpOpenTarget, straddleFirstInTarget, STRADDLE_RAISE_SHARE,
} from './blinds.js';
import { vsThreeBetTarget } from './vsThreeBet.js';

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

/**
 * A range covering `target` of all combos, shaped by `base`: the strongest part of `base` first, then
 * (when `base` is too narrow) the next-strongest hands outside it. `exclude` (e.g. the 3-bet range)
 * caps each class at 1 − its frequency there. Targets are snapped to 0.005 so the memo stays small;
 * `key` must identify base and exclude.
 */
function fillRange(base, exclude, target, key) {
  const t = Math.round(target * 200) / 200;
  return memo(`f|${key}|${t}`, () => {
    const room = (cls) => Math.max(0, 1 - (exclude?.[cls] ?? 0));
    const out = {};
    let cov = 0;
    const add = (cls, cap) => {
      const f = Math.min(cap, ((t - cov) * 1326) / comboCount(cls));
      if (f <= 0) return;
      out[cls] = (out[cls] ?? 0) + f;
      cov += (f * comboCount(cls)) / 1326;
    };
    for (const cls of HAND_CLASSES) if (cov < t) add(cls, Math.min(base[cls] ?? 0, room(cls)));
    for (const cls of HAND_CLASSES) if (cov < t) add(cls, room(cls) - (out[cls] ?? 0));
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
    // A straddle is the effective big blind: depth is read in straddles and the straddler
    // defends like the BB. The straddle itself is a post, never a raise (preflopSpot).
    position: chartPosition(view),
    blind: effectiveBlind(view),
    band: depthBand((effectiveStackBb(view) * CHIPS_PER_BB) / effectiveBlind(view)),
    ...preflopSpot(view),
  };
  if (legal.toCall > 0 &&
      (info.spot === 'fourBetPlus' || view.currentBet >= COMMIT_SHARE * (me.stack + me.committedStreet))) {
    return commitDecision(view, profile, ctx);
  }
  const ip = info.raiserSeat === null ? true
    : postflopOrder(view).indexOf(view.seat) > postflopOrder(view).indexOf(info.raiserSeat);
  const decision = blindDecision(view, profile, ctx, adj, info, ip) ??
    openerVsThreeBet(view, profile, ctx, adj, info, ip) ?? (profile.usesCharts
    ? chartDecision(view, profile, ctx, adj, info, ip)
    : ruleDecision(view, profile, ctx, info, ip));
  // A live bounty hand is played as at least a medium-strength hand (SPEC §15).
  if (decision.type !== 'fold' || !(legal.toCall > 0)) return decision;
  return bountyPreflop(view, profile, ctx.rng, info) ?? decision;
}

/**
 * Chart rates of the unscaled base chart in bot-only play (tests/bots/tier-report.js). Each chart
 * bot scales its open / call / 3-bet ranges by its profile target over these, so a bot's VPIP,
 * PFR and 3-bet land on its profile while keeping the chart's shape.
 */
export const CHART_BASE_RATES = Object.freeze({ pfr: 0.175, vpipGap: 0.075, threeBet: 0.06 });

/** Chart-bot range for (position, band, action), scaled to the profile (× `extra`), and its memo key. */
function profileChart(profile, position, band, action, extra = 1) {
  const factor = {
    open: profile.pfr / CHART_BASE_RATES.pfr,
    call: Math.max(profile.vpip - profile.pfr, 0.01) / CHART_BASE_RATES.vpipGap,
    threeBet: profile.threeBet / CHART_BASE_RATES.threeBet,
  }[action] * extra;
  const key = `${profile.tier}|${position}|${band}|${action}`;
  return {
    range: scaled(getTierChartRange(profile.tier, position, band, action), factor, key),
    key: `${key}|${Math.round(factor * 20) / 20}`,
  };
}

/** Noisy "percentile under threshold" for rule-based bots; noise scales with 1 − skill. */
function noisyBelow(profile, rng) {
  // Capping the noise half-width at the threshold (and 1 − threshold) keeps the expected rate at the
  // threshold instead of inflating small ones like 3-bet%.
  return (pct, threshold) => {
    const a = Math.min((PREFLOP_NOISE / 2) * (1 - profile.skill), threshold, 1 - threshold);
    return pct + (rng() * 2 - 1) * Math.max(a, 0) < threshold;
  };
}

/**
 * Reg blinds (blinds.js): the heads-up button's first-in open, the blinds folded to an unraised
 * straddle, and blind defense against one raise, all sized by price and the opener's position.
 * Chart bots keep their chart's shape; rule bots fill the target from their variant ordering.
 * Returns null outside those spots (and for fish), leaving the normal chart / rule play.
 */
function blindDecision(view, profile, ctx, adj, info, ip) {
  const { cls, position, band, spot, limpers, callers } = info;
  if (position !== 'SB' && position !== 'BB') return null;
  const below = noisyBelow(profile, ctx.rng);
  const style = TIER_STYLE[profile.tier] ?? TIER_STYLE.lowReg;
  const openPct = () => variantPercentiles(profile.tier, 'SB', band, 'open', style.chartWeight)[cls];
  const sbOpen = () => ({
    range: getTierChartRange(profile.tier, 'SB', band, 'open'), key: `${profile.tier}|SB|${band}|open`,
  });

  if (spot === 'unopened' && limpers === 0) {
    const to = openTo('SB', 0, info.blind);
    if (view.numPlayers === 2) {
      const target = headsUpOpenTarget(profile, adj.openWider);
      if (target === null) return null;
      if (!profile.usesCharts) return below(openPct(), target) ? { type: 'raise', to } : { type: 'fold' };
      const base = sbOpen();
      const range = fillRange(base.range, null, target, base.key);
      return choose([{ type: 'raise', to, f: range[cls] ?? 0 }], profile.mixing, ctx.rng);
    }
    const realBlind = view.position;
    if (view.straddleSeat == null || view.seat === view.straddleSeat) return null;
    const target = straddleFirstInTarget(view, profile, realBlind);
    if (target === null) return null;
    if (!profile.usesCharts) {
      const pct = openPct();
      if (below(pct, target.raise)) return { type: 'raise', to };
      return below(pct, target.play) ? { type: 'call' } : { type: 'fold' };
    }
    const base = sbOpen();
    const range = fillRange(base.range, null, target.play, base.key);
    const within = percentileWithinRange(range, cls);
    if (within === null) return { type: 'fold' };
    const type = within < STRADDLE_RAISE_SHARE ? 'raise' : 'call';
    return choose([{ type, to, f: range[cls] }], profile.mixing, ctx.rng);
  }

  if (spot !== 'raised') return null;
  const target = blindDefenseTarget(view, profile, position, chartPosition(view, info.raiserSeat), callers);
  if (target === null) return null;
  if (!profile.usesCharts) {
    const width = POSITION_WIDTH[position] ?? 1;
    if (below(STRENGTH_PCT[cls], profile.threeBet * width * style.threeBetK)) {
      return { type: 'raise', to: threeBetTo(view.currentBet, ip) };
    }
    const pct = variantPercentiles(profile.tier, position, band, 'respond', style.chartWeight)[cls];
    return below(pct, target) ? { type: 'call' } : { type: 'fold' };
  }
  // 3-bet range as usual (capped at the whole defense), then calls fill the rest of the target
  // from the call chart outward.
  const tb = profileChart(profile, position, band, 'threeBet');
  const threeBet = fillRange(tb.range, null, Math.min(target, rangeCoverage(tb.range)), tb.key);
  const tbKey = `${tb.key}|${Math.round(Math.min(target, rangeCoverage(tb.range)) * 200)}`;
  const callBase = getTierChartRange(profile.tier, position, band, 'call');
  const call = fillRange(callBase, threeBet, Math.max(0, target - rangeCoverage(threeBet)),
    `${profile.tier}|${position}|${band}|call|x${tbKey}`);
  return choose([
    { type: 'raise', to: threeBetTo(view.currentBet, ip), f: threeBet[cls] ?? 0 },
    { type: 'call', f: call[cls] ?? 0 },
  ], profile.mixing, ctx.rng);
}

/**
 * The opener facing a 3-bet (vsThreeBet.js): continue with the top `cont` of its own opening range
 * from this position and 4-bet the top `fourBet` of it. The opening range is rebuilt the way the bot
 * opened (heads-up target, profile-scaled chart or rule threshold, and for chart bots the narrower
 * iso-raise range over limpers). Null for fish and for seats that didn't make the first raise.
 */
function openerVsThreeBet(view, profile, ctx, adj, info, ip) {
  const { cls, position, band, spot, callers, limpers } = info;
  if (spot !== 'threeBet' || preflopActions(view).get(view.seat)?.raiseIndex !== 1) return null;
  const target = vsThreeBetTarget(view, profile, ip, callers);
  if (target === null) return null;
  const hu = view.numPlayers === 2 && position === 'SB';
  const fourBet = { type: 'raise', to: fourBetTo(view.currentBet, ip) };
  if (!profile.usesCharts) {
    const style = TIER_STYLE[profile.tier] ?? TIER_STYLE.lowReg;
    const openTop = hu ? headsUpOpenTarget(profile, adj.openWider)
      : profile.pfr * (POSITION_WIDTH[position] ?? 1) * style.openPfrK;
    const below = noisyBelow(profile, ctx.rng);
    if (below(STRENGTH_PCT[cls], target.fourBet * openTop)) return fourBet;
    const pct = variantPercentiles(profile.tier, position, band, 'open', style.chartWeight)[cls];
    return below(pct, target.cont * openTop) ? { type: 'call' } : { type: 'fold' };
  }
  let open;
  if (hu) {
    const key = `${profile.tier}|SB|${band}|open`;
    open = fillRange(getTierChartRange(profile.tier, 'SB', band, 'open'), null,
      headsUpOpenTarget(profile, adj.openWider), key);
  } else if (limpers > 0) {
    // The iso-raise ranges of chartDecision's 'limped' branch (hero-limp widening not modelled).
    const chart = position === 'BB'
      ? profileChart(profile, position, band, 'threeBet', 1.5) : profileChart(profile, position, band, 'open');
    open = position === 'BB' ? chart.range
      : fillRange(chart.range, null, 0.6 * rangeCoverage(chart.range), `${chart.key}|iso`);
  } else {
    open = profileChart(profile, position, band, 'open', adj.openWider).range;
  }
  if (!(rangeCoverage(open) > 0)) return null;
  const within = percentileWithinRange(open, cls);
  if (within === null) return { type: 'fold' };
  if (within < target.fourBet) return fourBet;
  return within < target.cont ? { type: 'call' } : { type: 'fold' };
}

function chartDecision(view, profile, ctx, adj, info, ip) {
  const { cls, position, band, spot, limpers } = info;
  const chart = (action, extra = 1) => profileChart(profile, position, band, action, extra).range;
  const heroLimped = preflopActions(view).get(view.heroSeat)?.limped === true;
  switch (spot) {
    case 'unopened':
      const open = chart('open', adj.openWider);
      return choose([{ type: 'raise', to: openTo(position, 0, info.blind), f: open[cls] ?? 0 }],
        profile.mixing, ctx.rng);
    case 'limped': {
      const isoWider = heroLimped ? adj.isoWider : 1;
      const to = openTo(position, limpers, info.blind);
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
  const below = noisyBelow(profile, ctx.rng);
  const strength = STRENGTH_PCT[cls];
  switch (spot) {
    case 'unopened':
    case 'limped': {
      const pct = variantPercentiles(profile.tier, position, band, 'open', style.chartWeight)[cls];
      if (below(pct, profile.pfr * width * style.openPfrK)) return { type: 'raise', to: openTo(position, limpers, info.blind) };
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
