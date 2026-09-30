// Session-level PAT_* flags (SPEC §8.3). Stats come straight from each record's statFlags (the
// coach doesn't import the tracker). Each stat needs PATTERN_MIN_OPPS opportunities and uses the
// last PATTERN_WINDOW hands. Severity is major when the value is more than one range-width outside.
import { STAKES } from '../shared/schemas.js';

export const PATTERN_WINDOW = 500;
export const PATTERN_MIN_OPPS = 30;
/** PAT_LOW_PFR: vpip − pfr above this. */
export const PFR_GAP = 0.08;
/** PAT_TILT: a loss of at least this much, then the next TILT_HANDS hands' VPIP ≥ TILT_RISE over before. */
export const TILT_LOSS_BB = 50;
export const TILT_HANDS = 20;
export const TILT_RISE = 0.1;
/** PAT_REPEATED_LEAK: the same hand-level flag at least LEAK_COUNT times in the last LEAK_WINDOW hands. */
export const LEAK_WINDOW = 100;
export const LEAK_COUNT = 5;

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;

/** Rate over records: occurrences / opportunities, with the opportunity count. */
function rate(records, opp, occ) {
  let n = 0;
  let k = 0;
  for (const r of records) {
    const f = r.statFlags ?? {};
    if (!opp(f)) continue;
    n++;
    if (occ(f)) k++;
  }
  return { value: n ? k / n : null, opps: n };
}

/** Hero stats over a window of records, each {value, opps}. */
export function windowStats(records) {
  const all = () => true;
  let bets = 0;
  let calls = 0;
  let flops = 0;
  for (const r of records) {
    const f = r.statFlags ?? {};
    bets += (f.postflopBets ?? 0) + (f.postflopRaises ?? 0);
    calls += f.postflopCalls ?? 0;
    if (f.sawFlop) flops++;
  }
  return {
    vpip: rate(records, all, (f) => f.vpip),
    pfr: rate(records, all, (f) => f.pfr),
    threeBet: rate(records, (f) => f.threeBetOpp, (f) => f.threeBet),
    cbet: rate(records, (f) => f.cbetOpp, (f) => f.cbet),
    foldToCbet: rate(records, (f) => f.foldToCbetOpp, (f) => f.foldToCbet),
    wtsd: rate(records, (f) => f.sawFlop, (f) => f.wentToShowdown),
    wsd: rate(records, (f) => f.wentToShowdown, (f) => f.wonAtShowdown),
    // AF opportunities: hands where hero saw a flop.
    af: { value: calls > 0 ? bets / calls : null, opps: flops },
  };
}

/** [flag id, stat, side]: 'high' flags a value above the range, 'low' below it. */
const RANGE_CHECKS = [
  ['PAT_TOO_LOOSE', 'vpip', 'high'],
  ['PAT_TOO_TIGHT', 'vpip', 'low'],
  ['PAT_LOW_3BET', 'threeBet', 'low'],
  ['PAT_PASSIVE', 'af', 'low'],
  ['PAT_OVERFOLD_CBET', 'foldToCbet', 'high'],
  ['PAT_LOW_CBET', 'cbet', 'low'],
  ['PAT_HIGH_WTSD', 'wtsd', 'high'],
  ['PAT_LOW_WSD', 'wsd', 'low'],
];

const patternFlag = (id, severity, data) => ({
  id, severity, street: null, decisionIndex: null, evLossBb: null, oppTier: null, data,
});

const chronological = (records) => records
  .map((r, i) => ({ r, i }))
  .sort((a, b) => (a.r.timestamp ?? 0) - (b.r.timestamp ?? 0) || a.i - b.i)
  .map(({ r }) => r);

/**
 * @param {import('../shared/schemas.js').HandRecord[]} records  any order; the caller picks which
 *   hands count (e.g. one stakes level). `stakes` selects the winning ranges.
 * @param {import('../shared/schemas.js').StakesId} stakes
 * @returns {import('../shared/schemas.js').CoachFlag[]} PAT_* flags only
 */
export function detectPatterns(records, stakes) {
  const ranges = (STAKES[stakes] ?? STAKES.micro).winningRanges;
  const sorted = chronological(records ?? []);
  const recent = sorted.slice(-PATTERN_WINDOW);
  const hands = recent.length;
  const stats = windowStats(recent);
  const flags = [];

  for (const [id, stat, side] of RANGE_CHECKS) {
    const { value, opps } = stats[stat];
    if (value === null || opps < PATTERN_MIN_OPPS) continue;
    const [lo, hi] = ranges[stat];
    const outside = side === 'high' ? value - hi : lo - value;
    if (!(outside > 0)) continue;
    flags.push(patternFlag(id, outside > hi - lo ? 'major' : 'minor', {
      stat, value: r3(value), target: [lo, hi], hands, window: PATTERN_WINDOW,
    }));
  }

  const { vpip, pfr } = stats;
  if (vpip.value !== null && vpip.opps >= PATTERN_MIN_OPPS && vpip.value - pfr.value > PFR_GAP) {
    const gap = vpip.value - pfr.value;
    flags.push(patternFlag('PAT_LOW_PFR', gap - PFR_GAP > PFR_GAP ? 'major' : 'minor', {
      vpip: r3(vpip.value), pfr: r3(pfr.value), gap: r3(gap), hands, window: PATTERN_WINDOW,
    }));
  }

  const tilt = detectTilt(recent);
  if (tilt) flags.push(tilt);
  flags.push(...repeatedLeaks(sorted.slice(-LEAK_WINDOW)));
  return flags;
}

/** The latest ≥ TILT_LOSS_BB loss followed by TILT_HANDS hands whose VPIP rose ≥ TILT_RISE. */
function detectTilt(records) {
  const vpipOf = (rs) => rs.filter((r) => r.statFlags?.vpip).length / rs.length;
  for (let i = records.length - TILT_HANDS - 1; i >= PATTERN_MIN_OPPS; i--) {
    const net = records[i].heroNetBb ?? 0;
    if (net > -TILT_LOSS_BB) continue;
    const before = vpipOf(records.slice(0, i));
    const after = vpipOf(records.slice(i + 1, i + 1 + TILT_HANDS));
    const rise = after - before;
    if (rise < TILT_RISE) continue;
    return patternFlag('PAT_TILT', rise - TILT_RISE > TILT_RISE ? 'major' : 'minor', {
      lossBb: r2(-net), vpipBefore: r3(before), vpipAfter: r3(after), handsAfter: TILT_HANDS,
    });
  }
  return null;
}

/** One PAT_REPEATED_LEAK per hand-level flag ID seen at least LEAK_COUNT times. */
function repeatedLeaks(records) {
  const byId = new Map();
  for (const r of records) {
    for (const f of r.coach?.flags ?? []) {
      if (f.id.startsWith('PAT_')) continue;
      const row = byId.get(f.id) ?? { count: 0, evLossBb: 0 };
      row.count++;
      row.evLossBb += f.evLossBb ?? 0;
      byId.set(f.id, row);
    }
  }
  const out = [];
  for (const [flagId, { count, evLossBb }] of byId) {
    if (count < LEAK_COUNT) continue;
    out.push(patternFlag('PAT_REPEATED_LEAK', count - LEAK_COUNT >= LEAK_COUNT ? 'major' : 'minor', {
      flagId, count, evLossBb: r2(evLossBb), window: LEAK_WINDOW,
    }));
  }
  return out.sort((a, b) => b.data.evLossBb - a.data.evLossBb);
}
