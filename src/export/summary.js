import { STAKES, PROFITABILITY_DISCLAIMER } from '../shared/schemas.js';
import { bb, number, signed, percent, flagDetails } from './format.js';

const COLUMNS = { vpip: 'VPIP', pfr: 'PFR', threeBet: '3B', cbet: 'CB', foldToCbet: 'FCB', wtsd: 'WTSD', wsd: 'W$SD', af: 'AF' };
const windowName = window => typeof window === 'number' ? `Last${window}` : window === 'all' ? 'All' : 'Session';

/** StatsSummary has no dates: omit the date range rather than infer it. */
export function formatSummary({ stats, patterns = [], stakes }, { includePrompt = true } = {}) {
  const config = Object.hasOwn(STAKES, stakes) ? STAKES[stakes] : undefined;
  // Windows overlap: use All when available, otherwise the largest supplied sample.
  const primary = stats.find(stat => stat.window === 'all') ?? [...stats].sort((a, b) => b.hands - a.hands)[0];
  const lines = ['=== POKER TRAINER SUMMARY v1 ==='];
  if (includePrompt) lines.push("You are an expert No-Limit Hold'em coach. Assess this player's long-term stats against winning ranges for the stakes, rank the leaks, and suggest a study plan. Treat the profitability line as a rough estimate.");
  lines.push(`Stakes: ${config?.label ?? 'Mixed'} | Hands: ${(primary?.hands ?? 0).toLocaleString('en-US')}`,
    'Window  Hands  VPIP PFR 3B CB FCB WTSD W$SD AF  bb/100  EVadj bb/100 (95% CI)  EVloss/100 Rake/100');
  for (const stat of stats) {
    lines.push(`${windowName(stat.window)}  ${stat.hands}  ${Object.keys(COLUMNS).map(key => key === 'af' ? number(stat[key]) : percent(stat[key])).join(' ')}  ${signed(stat.bbPer100)}  ${signed(stat.evAdjBbPer100)} (${stat.evAdjCi95.map(signed).join(', ')})  ${stat.coachedHands ? number(stat.evLossPer100) : '—'} ${number(stat.rakePer100)}`);
  }
  if (stats.some(stat => stat.bountyPer100 != null)) {
    lines.push('Bounty accounting (base bb/100 and all-in EV exclude bounties):', 'Window  Bounty bb/100  bb/100 with bounties  Fold to bet');
    for (const stat of stats) lines.push(`${windowName(stat.window)}  ${signed(stat.bountyPer100 ?? 0)}  ${signed(stat.bbPer100WithBounty ?? stat.bbPer100)}  ${percent(stat.foldToBet)}`);
  }
  if (config) lines.push(`Winning ranges (${config.label.split(' ')[0]}): ${Object.entries(COLUMNS).map(([key, label]) => `${label} ${config.winningRanges[key].map(key === 'af' ? number : percent).join('–')}`).join(', ')}`);
  for (const stat of stats.filter(item => item.trend)) {
    const trend = stat.trend;
    lines.push(`Trends (last ${stat.window} vs previous ${stat.window}): bb/100 ${signed(trend.bbPer100Delta)}, EV loss/100 ${stat.coachedHands ? signed(trend.evLossPer100Delta) : '—'}, VPIP ${trend.vpipDelta == null ? '—' : `${trend.vpipDelta >= 0 ? '+' : ''}${percent(trend.vpipDelta)}`}`);
  }
  if (primary?.topLeaks.length) {
    lines.push('Top leaks:');
    primary.topLeaks.forEach((leak, index) => lines.push(`  ${index + 1}. ${leak.flagId} — ${leak.count}× — ${bb(leak.evLossBb)} total`));
  }
  if (patterns.length) lines.push(`Patterns: ${patterns.map(flag => `${flag.id} (${flagDetails(flag)})`).join(', ')}`);
  if (primary?.profitability) {
    const estimate = primary.profitability;
    lines.push(`Profitability: ${estimate.verdict.replaceAll('_', ' ')} (confidence: ${estimate.confidence}) — ${estimate.reasons.join('; ')}`,
      `Note: ${PROFITABILITY_DISCLAIMER}`);
  }
  lines.push('=== END ===');
  return lines.join('\n');
}
