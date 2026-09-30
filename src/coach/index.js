// Offline coach (SPEC §6 Coach, §8, §14, §15).
//   analyzeHand(record, {rng, iterations}) → CoachResult
//   detectPatterns(records, stakes) → PAT_* CoachFlag[]
//   liveOdds(view, opponents, {rng, iterations}) → {equity, potOdds}
import { computeEquity, boardTexture, holdsBounty, createRng, deriveSeed } from '../engine/index.js';
import { decisionContexts } from './context.js';
import { opponentRanges, statsOf } from './villainRanges.js';
import { candidateActions, evaluateCandidates, uncalledExcess, GRADE_MAJOR_LOSS } from './ev.js';
import { chartCheck, openSizeCheck } from './preflop.js';
import { decisionFlags, TEXTURE_PCT } from './flags.js';

export { detectPatterns } from './patterns.js';

export const COACH_VERSION = 1;
export const DEFAULT_ITERATIONS = 2000;
export const LIVE_ODDS_ITERATIONS = 1000;

const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 10000) / 10000;

/**
 * @param {import('../shared/schemas.js').HandRecord} record
 * @param {{rng?: Function, iterations?: number}} [opts]  rng: the app passes
 *   createRng(deriveSeed(seed, 'coach')), which is also the default.
 * @returns {import('../shared/schemas.js').CoachResult}
 */
export function analyzeHand(record, { rng, iterations = DEFAULT_ITERATIONS } = {}) {
  const random = rng ?? createRng(deriveSeed(record.seed, 'coach'));
  const decisions = [];
  const flags = [];
  for (const ctx of decisionContexts(record)) {
    const a = analyzeDecision(record, ctx, random, iterations);
    decisions.push(a.coachDecision);
    flags.push(...decisionFlags(a));
  }
  const totalEvLossBb = r2(decisions.reduce((s, d) => s + d.evLossBb, 0));
  const grade = flags.some((f) => f.severity === 'major') || totalEvLossBb >= GRADE_MAJOR_LOSS ? 'major'
    : flags.length ? 'minor' : 'clean';
  return { handId: record.id, version: COACH_VERSION, decisions, flags, totalEvLossBb, grade };
}

/** Live bounties hero holds, hand first (§15 order), as EV terms for evaluateCandidates. */
function heldBounties(record, ctx) {
  const hole = ctx.decision.holeCards;
  return (record.bounties ?? []).filter((b) => holdsBounty(hole, b)).map((b) => ({
    amountChips: b.amountChips, paysOnFold: b.paysOn === 'showdownOrFold',
  }));
}

function analyzeDecision(record, ctx, rng, iterations) {
  const d = ctx.decision;
  const hero = record.heroSeat;
  const opponents = ctx.opponents.map((o) => ({ ...o, stats: statsOf(o.profile) }));
  const ranges = opponentRanges({
    events: ctx.events, street: ctx.street, board: ctx.board, heroCards: d.holeCards, opponents,
  });
  const eq = computeEquity({
    hero: d.holeCards, board: ctx.board, villains: ranges.map((r) => r.range), iterations, rng,
  });
  const equity = eq.equity;
  // The price of the call hero can make, against the pot it can win (§8.3 requiredEquity = C/(P+C)).
  const matchedPot = ctx.pot - uncalledExcess(ctx);
  const potOdds = ctx.legal.toCall > 0 ? ctx.legal.toCall / (matchedPot + ctx.legal.toCall) : null;
  const bounties = heldBounties(record, ctx);
  // A tie for the main pot still qualifies for a bounty, so its chance is win + tie, not equity.
  const spot = { ...ctx, opponents, equity, winOrTie: eq.win + eq.tie, inPosition: d.inPosition, bounties };

  const evs = evaluateCandidates(spot, candidateActions(ctx, d.action));
  const chosen = evs.find((c) => c.chosen);
  const top = evs.reduce((a, b) => (b.ev > a.ev ? b : a));
  const texture = boardTexture(ctx.board);

  // Preflop the chart sets the loss, except all-in or facing an all-in, and where no chart applies.
  const facingAllIn = ctx.legal.toCall > 0 && opponents.some((o) => o.allIn && o.committedStreet > ctx.heroCommitted);
  const chartResult = d.street === 'preflop' ? chartCheck(record, ctx, bounties.length > 0) : null;
  const useChart = chartResult && !d.allIn && !facingAllIn;
  let best = top;
  let evLossBb = Math.max(0, top.ev - chosen.ev);
  if (useChart) {
    evLossBb = chartResult.evLossBb;
    best = chartBest(evs, chartResult.best, chosen) ?? top;
  }

  let sizing = null;
  if (d.action.type === 'bet' && texture) {
    const [lo, hi] = TEXTURE_PCT[texture];
    const mid = (lo + hi) / 2;
    const to = ctx.heroCommitted + Math.round(mid * ctx.pot);
    const ref = to >= ctx.legal.minTo && to < ctx.legal.maxTo
      ? evaluateCandidates(spot, [{ key: 'ref', type: 'bet', to }])[0] : null;
    sizing = { lossBb: ref ? Math.max(0, ref.ev - chosen.ev) : 0 };
  }

  const liveAggressor = [ctx.streetAggressor, ctx.lastAggressor]
    .map((s) => opponents.find((o) => o.seat === s)).find(Boolean) ?? null;
  const mainOpp = liveAggressor ?? (opponents.length === 1 ? opponents[0] : null);
  const oppVpip = mainOpp ? mainOpp.stats.vpip
    : opponents.reduce((s, o) => s + o.stats.vpip, 0) / Math.max(1, opponents.length);

  const coachDecision = {
    decisionIndex: d.index,
    equity: r4(equity),
    equitySamples: eq.samples,
    potOdds: potOdds === null ? null : r4(potOdds),
    evByActionBb: Object.fromEntries(evs.map((c) => [c.key, c.ev])),
    bestAction: best.key,
    evLossBb: r2(evLossBb),
    chart: chartResult?.chart ?? null,
    texture,
  };
  return {
    ctx, heroSeat: hero, equity, potOdds, matchedPot, evs, chosen, best, evLossBb: r2(evLossBb),
    source: useChart ? 'chart' : 'ev', chartResult, openSize: d.street === 'preflop' ? openSizeCheck(record, ctx) : null,
    texture, sizing, oppTier: mainOpp?.profile?.tier ?? null, oppVpip,
    raiser: opponents.find((o) => o.seat === ctx.streetAggressor) ?? null, coachDecision,
  };
}

/** The candidate matching the chart's cheapest action: hero's own size for a raise, else the smallest. */
function chartBest(evs, action, chosen) {
  if (action === 'fold' || action === 'call') return evs.find((c) => c.type === action);
  if (chosen.type === 'raise') return chosen;
  return evs.find((c) => c.type === 'raise');
}

/**
 * Hero's equity against the live opponents' estimated ranges, and the pot odds of a call.
 * Profiles come from the view's players; `opponents` fills in, in seat order, any live opponent
 * without one.
 * @param {import('../shared/schemas.js').SeatView} view
 * @param {import('../shared/schemas.js').BotProfile[]} opponents
 * @param {{rng?: Function, iterations?: number}} [opts]
 * @returns {{equity: number|null, potOdds: number|null}}
 */
export function liveOdds(view, opponents = [], { rng, iterations = LIVE_ODDS_ITERATIONS } = {}) {
  const me = view?.players?.[view.seat];
  const live = (view?.players ?? []).filter((p) => p.seat !== view.seat && !p.folded);
  const toCall = view?.legal ? view.legal.toCall
    : me ? Math.max(0, Math.min(view.currentBet - me.committedStreet, me.stack)) : 0;
  const matchedPot = me ? view.pot - uncalledExcess({
    legal: { toCall }, heroCommitted: me.committedStreet, heroSeat: view.seat, seats: view.players,
  }) : view?.pot;
  const potOdds = toCall > 0 ? r4(toCall / (matchedPot + toCall)) : null;
  // Nothing to price once hero is out of the hand or it's over.
  const done = view?.street === 'showdown' || view?.street === 'complete';
  if (!me || me.folded || done) return { equity: null, potOdds: null };
  if (view.holeCards?.length !== 2 || live.length === 0) return { equity: null, potOdds };
  const random = rng ?? createRng(deriveSeed(`${view.handId}:${view.events.length}`, 'liveOdds'));
  const withProfiles = live.map((p, i) => ({ seat: p.seat, profile: p.profile ?? opponents[i] ?? null }));
  const ranges = opponentRanges({
    events: view.events, street: view.street, board: view.board, heroCards: view.holeCards, opponents: withProfiles,
  });
  const { equity } = computeEquity({
    hero: view.holeCards, board: view.board, villains: ranges.map((r) => r.range), iterations, rng: random,
  });
  return { equity: r4(equity), potOdds };
}
