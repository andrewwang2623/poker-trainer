/** Implements exactly SPEC §6, returning only schema-valid CoachResults. */
export function createFakeCoach() {
  const calls = { analyze: [], patterns: [], odds: [] };
  return {
    calls,
    analyzeHand(record, { rng, iterations = 2000 }) {
      calls.analyze.push({ record, draw: rng(), iterations });
      const flags = record.decisions.length ? [{ id: 'PF_OPEN_SIZE', severity: 'minor', street: 'preflop',
        decisionIndex: 0, evLossBb: 1, oppTier: null, data: { sizeBb: 4, recommendedBb: [2, 3], position: record.heroPosition, limpers: 0 } }] : [];
      return { handId: record.id, version: 1, decisions: record.decisions.map(decision => ({
        decisionIndex: decision.index, equity: .6, equitySamples: iterations,
        potOdds: decision.toCallBb ? decision.toCallBb / (decision.potBeforeBb + decision.toCallBb) : null,
        evByActionBb: { fold: 0, call: 1 }, bestAction: 'call', evLossBb: decision.index === 0 ? 1 : 0,
        chart: null, texture: decision.street === 'preflop' ? null : 'dry',
      })), flags, totalEvLossBb: flags.length, grade: flags.length ? 'minor' : 'clean' };
    },
    detectPatterns(records, stakes) {
      calls.patterns.push({ records, stakes });
      return records.length ? [{ id: 'PAT_TOO_LOOSE', severity: 'minor', street: null, decisionIndex: null,
        evLossBb: null, oppTier: null, data: { stat: 'vpip', value: .4, target: [.18, .28], hands: records.length, window: 500 } }] : [];
    },
    liveOdds(view, opponents, { rng, iterations = 1000 }) {
      calls.odds.push({ view, opponents, draw: rng(), iterations });
      return { equity: .6, potOdds: .25 };
    },
  };
}
