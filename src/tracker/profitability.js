import { STAKES, PROFITABILITY_DISCLAIMER } from '../shared/schemas.js';

/** The caller supplies opportunity counts not exposed by StatsSummary (PFR and AF). */
export function estimateProfitability(stats, { ranges, referenceWinrate, opportunities = {} } = {}) {
  const config = STAKES[stats.stakes] ?? STAKES.micro;
  ranges ??= config.winningRanges;
  referenceWinrate ??= config.referenceWinrate;
  const deviations = Object.entries(ranges).flatMap(([key, [lo, hi]]) => {
    const count = opportunities[key] ?? (key === 'pfr' ? stats.hands : stats.opportunities[key]);
    const value = stats[key];
    if (count < 30 || count == null || value == null) return [];
    const distance = Math.max(lo - value, value - hi, 0);
    return distance ? [{ key, penalty: Math.min(3, 2 * distance / (hi - lo)) }] : [];
  }).sort((a, b) => b.penalty - a.penalty || a.key.localeCompare(b.key));
  const penalty = Math.min(10, deviations.reduce((sum, item) => sum + item.penalty, 0));
  const model = referenceWinrate - stats.evLossPer100 - penalty - stats.rakePer100;
  const weight = stats.hands / (stats.hands + 3000);
  const estimate = weight * stats.evAdjBbPer100 + (1 - weight) * model;
  const verdict = estimate <= -2.5 ? 'likely_losing' : estimate >= 2.5 ? 'likely_winning' : 'break_even';
  const [lo, hi] = stats.evAdjCi95;
  const disagreement = lo <= 0 && hi >= 0 && Math.sign(model) !== Math.sign((lo + hi) / 2);
  const onSide = verdict === 'likely_winning' ? lo >= 2.5
    : verdict === 'likely_losing' ? hi <= -2.5 : lo > -2.5 && hi < 2.5;
  const confidence = stats.hands < 300 || disagreement ? 'low'
    : stats.hands >= 3000 && onSide ? 'high' : 'medium';
  const reasons = [];
  if (deviations.length) reasons.push(`${deviations[0].key.toUpperCase()} is outside the winning range`);
  reasons.push(stats.coachedHands ? `Coach EV loss: ${stats.evLossPer100.toFixed(1)} bb/100`
    : 'No coached hands; EV loss is unavailable');
  reasons.push(`Hero rake: ${stats.rakePer100.toFixed(1)} bb/100`,
    `${stats.hands} hands; ${stats.hands < 3000 ? 'small sample, model carries more weight' : 'observed results carry more weight'}`);
  return { verdict, confidence, estimateBbPer100: estimate, modelBbPer100: model,
    observedWeight: weight, reasons: reasons.slice(0, 4), disclaimer: PROFITABILITY_DISCLAIMER };
}
