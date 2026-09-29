import { PROFITABILITY_DISCLAIMER } from '../../src/shared/schemas.js';

export function handFixture() {
  const profile = { id: 'mika', name: 'Mika', tier: 'toughReg', avatar: { color: '#123456', initials: 'MI' }, vpip: .24, pfr: .2, threeBet: .1, aggression: 3, bluffFreq: .35, foldToBet: .4, skill: .9, usesCharts: true, textureSizing: true, mixing: true, exploitsHero: true };
  const events = [
    { type: 'postBlind', street: 'preflop', seat: 0, blind: 'SB', amount: 40 },
    { type: 'postBlind', street: 'preflop', seat: 1, blind: 'BB', amount: 100 },
    { type: 'dealHole', street: 'preflop', seat: 0, cards: ['Ah', 'Kd'] },
    { type: 'dealHole', street: 'preflop', seat: 1, cards: ['Qs', 'Qh'] },
    { type: 'action', street: 'preflop', seat: 0, action: 'raise', amount: 260, to: 300, allIn: false, potBefore: 140, toCall: 60, stackBefore: 9960 },
    { type: 'action', street: 'preflop', seat: 1, action: 'call', amount: 200, to: 300, allIn: false, potBefore: 400, toCall: 200, stackBefore: 9900 },
    { type: 'board', street: 'flop', cards: ['As', '7d', '2c'] },
    { type: 'action', street: 'flop', seat: 1, action: 'check', amount: 0, to: 0, allIn: false, potBefore: 600, toCall: 0, stackBefore: 9700 },
    { type: 'action', street: 'flop', seat: 0, action: 'bet', amount: 200, to: 200, allIn: false, potBefore: 600, toCall: 0, stackBefore: 9700 },
    { type: 'action', street: 'flop', seat: 1, action: 'call', amount: 200, to: 200, allIn: false, potBefore: 800, toCall: 200, stackBefore: 9700 },
    { type: 'board', street: 'turn', cards: ['9s'] },
    ...[1, 0].map(seat => ({ type: 'action', street: 'turn', seat, action: 'check', amount: 0, to: 0, allIn: false, potBefore: 1000, toCall: 0, stackBefore: 9500 })),
    { type: 'board', street: 'river', cards: ['3h'] },
    ...[1, 0].map(seat => ({ type: 'action', street: 'river', seat, action: 'check', amount: 0, to: 0, allIn: false, potBefore: 1000, toCall: 0, stackBefore: 9500 })),
    { type: 'showdown', street: 'showdown', seat: 1, cards: ['Qs', 'Qh'], handLabel: 'Pair of Queens' },
    { type: 'showdown', street: 'showdown', seat: 0, cards: ['Ah', 'Kd'], handLabel: 'Pair of Aces' },
    { type: 'rake', street: 'showdown', amount: 50 },
    { type: 'award', street: 'showdown', seat: 0, amount: 950, potIndex: 0 },
  ].map((event, seq) => ({ seq, ...event }));
  const decisions = events.filter(e => e.type === 'action' && e.seat === 0).map((event, index) => ({ index, eventSeq: event.seq, street: event.street, position: 'SB', holeCards: ['Ah', 'Kd'], board: { preflop: [], flop: ['As', '7d', '2c'], turn: ['As', '7d', '2c', '9s'], river: ['As', '7d', '2c', '9s', '3h'] }[event.street], potBeforeBb: event.potBefore / 100, toCallBb: event.toCall / 100, stackBeforeBb: event.stackBefore / 100, effectiveStackBb: event.stackBefore / 100, numOpponents: 1, inPosition: event.street !== 'preflop', facing: event.street === 'preflop' ? 'unopened' : 'checkedTo', opponentSeats: [1], action: ['bet', 'raise'].includes(event.action) ? { type: event.action, amount: event.to } : { type: event.action }, allIn: false }));
  return { schemaVersion: 1, id: 'fixture-1', timestamp: Date.UTC(2026, 8, 28, 19, 55), sessionId: 'session', seed: 123, stakes: 'micro', numPlayers: 2, heroSeat: 0, heroPosition: 'SB', buttonSeat: 0,
    players: [{ seat: 0, name: 'Hero', position: 'SB', isHero: true, startStackBb: 100, holeCards: ['Ah', 'Kd'], profile: null }, { seat: 1, name: 'Mika', position: 'BB', isHero: false, startStackBb: 100, holeCards: ['Qs', 'Qh'], profile }],
    board: ['As', '7d', '2c', '9s', '3h'], events, result: { pots: [{ amount: 950, eligibleSeats: [0, 1], winnerSeats: [0] }], rakeChips: 50, netChips: [450, -500], showdownSeats: [1, 0], heroAllInEv: null }, heroNetBb: 4.5, heroEvNetBb: 4.5, rakeBb: .5, heroRakeBb: .5,
    statFlags: { vpip: true, pfr: true, threeBetOpp: false, threeBet: false, cbetOpp: true, cbet: true, foldToCbetOpp: false, foldToCbet: false, sawFlop: true, wentToShowdown: true, wonAtShowdown: true, postflopBets: 1, postflopRaises: 0, postflopCalls: 0 }, decisions, coach: null };
}

export function coachFixture() {
  return { handId: 'fixture-1', version: 1, decisions: [
    { decisionIndex: 0, equity: .58, equitySamples: 2000, potOdds: .3, evByActionBb: { fold: 0, 'raise:3': 1 }, bestAction: 'raise:3', evLossBb: 0, chart: { position: 'SB', band: 'mid', action: 'open', freq: 1 }, texture: null },
    { decisionIndex: 1, equity: .81, equitySamples: 2000, potOdds: null, evByActionBb: { check: 2, 'bet:2': 3 }, bestAction: 'bet:2', evLossBb: .8, chart: null, texture: 'dry' },
  ], flags: [{ id: 'SZ_TOO_SMALL', severity: 'minor', street: 'flop', decisionIndex: 1, evLossBb: .8, oppTier: 'toughReg', data: { sizePct: .33, recommendedPct: [.66, .8], texture: 'wet' } }], totalEvLossBb: .8, grade: 'minor' };
}

export function statsFixture() {
  return { window: 'all', hands: 1240, stakes: 'micro', vpip: .24, pfr: .19, threeBet: .07, cbet: .61, foldToCbet: .44, wtsd: .29, wsd: .52, af: 2.8, opportunities: { vpip: 1240, threeBet: 400, cbet: 200, foldToCbet: 100, wtsd: 350, wsd: 100 }, bbPer100: 12, evAdjBbPer100: 8.4, evAdjCi95: [-31, 47.8], evLossPer100: 6.1, coachedHands: 1000, rakePer100: 3.9, topLeaks: [{ flagId: 'EQ_BAD_CALL', count: 14, evLossBb: 38.2 }], trend: null, profitability: { verdict: 'likely_losing', confidence: 'low', estimateBbPer100: -3, modelBbPer100: -5, observedWeight: .29, reasons: ['Small sample', 'Costly calls'], disclaimer: PROFITABILITY_DISCLAIMER } };
}
