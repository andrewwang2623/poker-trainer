import { STAKES } from '../shared/schemas.js';
import { estimateProfitability } from './profitability.js';

const rate = (numerator, denominator) => denominator ? numerator / denominator : null;
export const evNet = record => record.heroEvNetBb ?? record.heroNetBb;
const stakesConfig = stakes => {
  if (!Object.hasOwn(STAKES, stakes)) throw new RangeError('Unknown stakes');
  return STAKES[stakes];
};

/** Compute one window without accessing storage or the clock. */
export function summarize(records, window, stakes) {
  const n = records.length;
  const count = key => records.reduce((sum, record) => sum + Number(record.statFlags[key] === true), 0);
  const sum = key => records.reduce((total, record) => total + (record[key] ?? 0), 0);
  const flagsSum = key => records.reduce((total, record) => total + (record.statFlags[key] ?? 0), 0);
  const per100 = total => n ? 100 * total / n : 0;
  const opportunities = { vpip: n, threeBet: count('threeBetOpp'), cbet: count('cbetOpp'),
    foldToCbet: count('foldToCbetOpp'), foldToBet: count('facedPostflopBet'),
    wtsd: count('sawFlop'), wsd: count('wentToShowdown') };
  const coached = records.filter(record => record.coach != null);
  const leaks = new Map();
  for (const record of coached) for (const flag of record.coach.flags) {
    if (flag.id.startsWith('PAT_')) continue;
    const leak = leaks.get(flag.id) ?? { flagId: flag.id, count: 0, evLossBb: 0 };
    leak.count++;
    leak.evLossBb += flag.evLossBb ?? 0;
    leaks.set(flag.id, leak);
  }
  const evMean = n ? records.reduce((total, record) => total + evNet(record), 0) / n : 0;
  const variance = n > 1 ? records.reduce((total, record) => total + (evNet(record) - evMean) ** 2, 0) / (n - 1) : 0;
  const margin = n > 1 ? 100 * 1.96 * Math.sqrt(variance / n) : 0;
  const stakeIds = new Set(records.map(record => record.stakes));
  const summary = {
    window, hands: n, stakes: stakes ?? (stakeIds.size === 1 ? records[0].stakes : 'mixed'),
    vpip: rate(count('vpip'), n), pfr: rate(count('pfr'), n),
    threeBet: rate(count('threeBet'), opportunities.threeBet),
    cbet: rate(count('cbet'), opportunities.cbet), foldToCbet: rate(count('foldToCbet'), opportunities.foldToCbet),
    foldToBet: rate(count('foldedToPostflopBet'), opportunities.foldToBet),
    wtsd: rate(count('wentToShowdown'), opportunities.wtsd), wsd: rate(count('wonAtShowdown'), opportunities.wsd),
    af: rate(flagsSum('postflopBets') + flagsSum('postflopRaises'), flagsSum('postflopCalls')),
    opportunities, bbPer100: per100(sum('heroNetBb')), bountyPer100: per100(sum('heroBountyBb')),
    bbPer100WithBounty: per100(sum('heroNetBb') + sum('heroBountyBb')),
    evAdjBbPer100: 100 * evMean, evAdjCi95: [100 * evMean - margin, 100 * evMean + margin],
    evLossPer100: coached.length ? 100 * coached.reduce((total, record) => total + record.coach.totalEvLossBb, 0) / coached.length : 0,
    coachedHands: coached.length, rakePer100: per100(sum('heroRakeBb')),
    topLeaks: [...leaks.values()].sort((a, b) => b.evLossBb - a.evLossBb || a.flagId.localeCompare(b.flagId)).slice(0, 5), trend: null,
  };
  // Mixed stakes use hand-weighted reference winrates and ranges instead of choosing one stake arbitrarily.
  const configs = records.length ? records.map(record => stakesConfig(record.stakes)) : [stakesConfig(stakes ?? 'micro')];
  const average = fn => configs.reduce((total, config) => total + fn(config), 0) / configs.length;
  const ranges = Object.fromEntries(Object.keys(STAKES.micro.winningRanges).map(key =>
    [key, [average(config => config.winningRanges[key][0]), average(config => config.winningRanges[key][1])]]));
  summary.profitability = estimateProfitability(summary, { ranges,
    referenceWinrate: average(config => config.referenceWinrate), opportunities: { af: flagsSum('postflopCalls') } });
  return summary;
}
