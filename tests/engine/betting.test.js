// Min-raise rules, the incomplete-raise rule, legality and immutability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHand, getLegalActions, applyAction } from '../../src/engine/game.js';
import { makeScenario, play } from './_helpers.js';

test('preflop min-raise tracks the last full raise size', () => {
  // BTN 0 acts first 3-handed, then SB 1, BB 2.
  let s = createHand(makeScenario({ stacks: [10000, 10000, 10000], button: 0 }));
  assert.equal(getLegalActions(s).minTo, 200, 'min open = 2bb');
  assert.throws(() => applyAction(s, { type: 'raise', amount: 199 }), RangeError);

  s = play(s, [[0, 'raise', 300]]); // raise of 200
  assert.equal(s.lastRaiseSize, 200);
  assert.equal(getLegalActions(s).minTo, 500);
  assert.equal(getLegalActions(s).toCall, 260, 'SB owes 300 - 40');
  assert.throws(() => applyAction(s, { type: 'raise', amount: 499 }), RangeError);

  s = play(s, [[1, 'raise', 500]]); // exactly a min-raise
  assert.equal(getLegalActions(s).minTo, 700);
  s = play(s, [[2, 'raise', 1500]]); // raise of 1000
  assert.equal(s.lastRaiseSize, 1000);
  assert.equal(getLegalActions(s).minTo, 2500);
  assert.equal(getLegalActions(s).maxTo, 10000);
});

test('postflop min bet is 1bb and the min raise doubles the bet', () => {
  let s = createHand(makeScenario({ stacks: [10000, 10000], button: 0 }));
  s = play(s, [[0, 'call'], [1, 'check']]);
  assert.deepEqual(getLegalActions(s), { seat: 1, types: ['check', 'bet'], toCall: 0, minTo: 100, maxTo: 9900 });
  assert.throws(() => applyAction(s, { type: 'bet', amount: 99 }), RangeError);
  s = play(s, [[1, 'bet', 250]]);
  assert.equal(getLegalActions(s).minTo, 500);
  s = play(s, [[0, 'raise', 900]]);
  assert.equal(getLegalActions(s).minTo, 1550);
});

test('min-raise is capped at all-in; a short stack can only shove', () => {
  let s = createHand(makeScenario({ stacks: [10000, 10000, 450], button: 0 }));
  s = play(s, [[0, 'raise', 400]]);
  s = play(s, [[1, 'fold']]);
  const legal = getLegalActions(s);
  assert.equal(legal.seat, 2);
  assert.equal(legal.minTo, 450);
  assert.equal(legal.maxTo, 450);
  assert.throws(() => applyAction(s, { type: 'raise', amount: 500 }), RangeError);
});

test('an all-in under a full raise does not reopen betting for players who already acted', () => {
  // 4-handed, BTN 0, SB 1, BB 2, UTG 3. The BTN has 450 chips.
  let s = createHand(makeScenario({ stacks: [450, 10000, 10000, 10000], button: 0 }));
  s = play(s, [[3, 'raise', 300]]); // full raise of 200
  s = play(s, [[0, 'raise', 450]]); // all-in, only +150: incomplete
  assert.equal(s.currentBet, 450);
  assert.equal(s.lastRaiseSize, 200, 'incomplete raise does not change the min-raise basis');
  assert.equal(s.events.at(-1).allIn, true);

  // SB and BB haven't acted yet: they may raise, min to 450 + 200.
  assert.deepEqual(getLegalActions(s).types, ['fold', 'call', 'raise']);
  assert.equal(getLegalActions(s).minTo, 650);
  s = play(s, [[1, 'call'], [2, 'call']]);

  // UTG already acted and faced only an incomplete raise: call or fold.
  const legal = getLegalActions(s);
  assert.equal(legal.seat, 3);
  assert.deepEqual(legal.types, ['fold', 'call']);
  assert.equal(legal.toCall, 150);
  assert.throws(() => applyAction(s, { type: 'raise', amount: 1000 }), RangeError);
  s = play(s, [[3, 'call']]);
  assert.equal(s.street, 'flop');
  assert.equal(s.potCollected, 1800);
});

test('a full raise after an incomplete all-in reopens betting', () => {
  let s = createHand(makeScenario({ stacks: [450, 10000, 10000, 10000], button: 0 }));
  s = play(s, [[3, 'raise', 300], [0, 'raise', 450], [1, 'raise', 1000], [2, 'fold']]);
  const legal = getLegalActions(s);
  assert.equal(legal.seat, 3);
  assert.deepEqual(legal.types, ['fold', 'call', 'raise']);
  assert.equal(legal.minTo, 1550);
});

test('postflop incomplete all-in raise: the bettor may only call or fold', () => {
  let s = createHand(makeScenario({ stacks: [10000, 1300, 10000], button: 0 }));
  s = play(s, [[0, 'call'], [1, 'call'], [2, 'check']]); // pot 300, seat 1 has 1200 left
  s = play(s, [[1, 'check'], [2, 'bet', 1000], [0, 'call'], [1, 'raise', 1200]]);
  // Seat 2 bet and seat 0 called, both acted: +200 is not a full raise.
  assert.deepEqual(getLegalActions(s).types, ['fold', 'call']);
  s = play(s, [[2, 'call'], [0, 'call']]);
  assert.equal(s.street, 'turn');
});

test('no raise when every other player is all-in', () => {
  let s = createHand(makeScenario({ stacks: [10000, 3000], button: 0 }));
  s = play(s, [[0, 'raise', 500], [1, 'raise', 3000]]);
  assert.deepEqual(getLegalActions(s).types, ['fold', 'call']);
});

test('illegal actions throw RangeError and inputs are never mutated', () => {
  const s = createHand(makeScenario({ stacks: [10000, 10000, 10000], button: 0 }));
  const snapshot = structuredClone(s);
  assert.throws(() => applyAction(s, { type: 'check' }), RangeError);
  assert.throws(() => applyAction(s, { type: 'bet', amount: 300 }), RangeError);
  assert.throws(() => applyAction(s, { type: 'raise', amount: 250.5 }), RangeError);
  assert.throws(() => applyAction(s, { type: 'raise' }), RangeError);
  assert.throws(() => applyAction(s, { type: 'shove' }), RangeError);
  assert.throws(() => applyAction(s, null), RangeError);
  const next = applyAction(s, { type: 'raise', amount: 300 });
  applyAction(next, { type: 'fold' });
  assert.deepEqual(s, snapshot);
  assert.notEqual(next, s);
});
