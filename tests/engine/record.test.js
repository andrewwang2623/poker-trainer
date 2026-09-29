import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHand, buildHandRecord } from '../../src/engine/index.js';
import * as engine from '../../src/engine/index.js';
import { makeScenario, play } from './_helpers.js';

test('engine index exposes the SPEC §6 API', () => {
  for (const name of ['createRng', 'createScenario', 'createHand', 'getLegalActions', 'applyAction', 'getView',
    'isComplete', 'buildHandRecord', 'computeEquity', 'evaluate', 'handClass', 'boardTexture']) {
    assert.equal(typeof engine[name], 'function', name);
  }
});

test('hero as preflop raiser: vpip/pfr, c-bet, postflop counts, decisions', () => {
  // 3-handed, hero on the BTN (seat 0), SB 1, BB 2.
  let s = createHand(makeScenario({ stacks: [10000, 10000, 8000], button: 0, hero: 0 }), {
    cards: { holes: { 0: ['Ah', 'Kd'], 1: ['7c', '2d'], 2: ['Qs', 'Jh'] }, board: ['Ac', '8d', '3s', '5h', '9c'] },
  });
  s = play(s, [
    [0, 'raise', 250], [1, 'fold'], [2, 'call'],
    [2, 'check'], [0, 'bet', 300], [2, 'call'],
    [2, 'bet', 500], [0, 'raise', 1500], [2, 'call'],
    [2, 'check'], [0, 'check'],
  ]);
  const rec = buildHandRecord(s, { sessionId: 'sess', timestamp: 1234 });
  assert.equal(rec.id, s.handId);
  assert.equal(rec.timestamp, 1234);
  assert.equal(rec.sessionId, 'sess');
  assert.equal(rec.heroPosition, 'BTN');
  assert.equal(rec.coach, null);
  assert.equal(rec.players[2].startStackBb, 80);
  assert.deepEqual(rec.players[1].holeCards, ['7c', '2d'], 'records are unredacted');

  assert.deepEqual(rec.statFlags, {
    vpip: true, pfr: true, threeBetOpp: false, threeBet: false,
    cbetOpp: true, cbet: true, foldToCbetOpp: false, foldToCbet: false,
    sawFlop: true, wentToShowdown: true, wonAtShowdown: true,
    facedPostflopBet: true, foldedToPostflopBet: false,
    postflopBets: 1, postflopRaises: 1, postflopCalls: 0,
    straddled: false, facedStraddle: false,
  });

  // Pot: 250 + 40 + 250 = 540, then 600 on the flop, 3000 on the turn = 4140. Rake 5% = 207.
  assert.equal(rec.rakeBb, 2.07);
  assert.equal(rec.heroNetBb, (4140 - 207 - 2050) / 100);
  assert.equal(rec.heroEvNetBb, rec.heroNetBb);
  assert.equal(rec.heroRakeBb, 2.07, 'hero won the whole pot, so all of the rake');

  assert.equal(rec.decisions.length, 4);
  const [d0, d1, d2, d3] = rec.decisions;
  assert.deepEqual(d0, {
    index: 0, eventSeq: d0.eventSeq, street: 'preflop', position: 'BTN', holeCards: ['Ah', 'Kd'], board: [],
    potBeforeBb: 1.4, toCallBb: 1, stackBeforeBb: 100, effectiveStackBb: 100, numOpponents: 2,
    inPosition: true, facing: 'unopened', opponentSeats: [1, 2], action: { type: 'raise', amount: 250 }, allIn: false,
  });
  assert.equal(rec.events[d0.eventSeq].seat, 0);
  assert.equal(d1.facing, 'checkedTo');
  assert.deepEqual(d1.board, ['Ac', '8d', '3s']);
  assert.equal(d1.numOpponents, 1);
  assert.equal(d1.effectiveStackBb, 77.5);
  assert.equal(d2.facing, 'facingBet');
  assert.equal(d2.toCallBb, 5);
  assert.deepEqual(d2.action, { type: 'raise', amount: 1500 });
  assert.equal(d3.street, 'river');
});

test('hero in the BB: 3-bet opportunity, fold to c-bet', () => {
  let s = createHand(makeScenario({ stacks: [10000, 10000, 10000], button: 0, hero: 2 }));
  s = play(s, [
    [0, 'raise', 250], [1, 'fold'], [2, 'call'],
    [2, 'check'], [0, 'bet', 200], [2, 'fold'],
  ]);
  const rec = buildHandRecord(s, { sessionId: 'x', timestamp: 1 });
  assert.equal(rec.decisions[0].facing, 'raised');
  assert.equal(rec.decisions[0].inPosition, false);
  assert.equal(rec.decisions[2].facing, 'facingBet');
  const f = rec.statFlags;
  assert.equal(f.vpip, true);
  assert.equal(f.pfr, false);
  assert.equal(f.threeBetOpp, true);
  assert.equal(f.threeBet, false);
  assert.equal(f.cbetOpp, false);
  assert.equal(f.foldToCbetOpp, true);
  assert.equal(f.foldToCbet, true);
  assert.equal(f.facedPostflopBet, true);
  assert.equal(f.foldedToPostflopBet, true);
  assert.equal(f.sawFlop, true);
  assert.equal(f.wentToShowdown, false);
  assert.equal(rec.heroNetBb, -2.5);
  assert.equal(rec.heroRakeBb, 0);
});

test('BB check is not vpip; limped pot facing; all-in EV carried into the record', () => {
  let s = createHand(makeScenario({ stacks: [5000, 5000], button: 0, hero: 1 }), {
    cards: { holes: { 0: ['Ks', 'Kd'], 1: ['Ah', '5h'] }, board: ['2h', '7h', 'Jc', '3s', '9d'] },
  });
  s = play(s, [[0, 'call'], [1, 'check'], [1, 'check'], [0, 'check'], [1, 'bet', 4900], [0, 'call']]);
  const rec = buildHandRecord(s, { sessionId: 'x', timestamp: 1 });
  assert.equal(rec.decisions[0].facing, 'limped');
  assert.equal(rec.statFlags.vpip, false);
  assert.equal(rec.statFlags.wentToShowdown, true);
  assert.equal(rec.statFlags.wonAtShowdown, false);
  assert.equal(rec.heroNetBb, -50);
  assert.equal(rec.heroEvNetBb, Math.round((15 / 44 * 9600 - 5000)) / 100);
  assert.equal(rec.decisions[2].allIn, true);
  assert.throws(() => buildHandRecord(createHand(makeScenario({ stacks: [5000, 5000] })), {}), RangeError);
});
