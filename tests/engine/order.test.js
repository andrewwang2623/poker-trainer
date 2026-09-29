// Blinds, positions and action order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHand, getLegalActions } from '../../src/engine/game.js';
import { makeScenario, play, eventsOf } from './_helpers.js';

test('heads-up: the button posts the SB, acts first preflop and last postflop', () => {
  for (const button of [0, 1]) {
    const other = 1 - button;
    let s = createHand(makeScenario({ stacks: [10000, 10000], button }));
    assert.equal(s.sbSeat, button);
    assert.equal(s.bbSeat, other);
    assert.equal(s.players[button].position, 'SB');
    assert.equal(s.players[other].position, 'BB');
    assert.deepEqual(
      eventsOf(s, 'postBlind').map((e) => [e.seat, e.blind, e.amount]),
      [[button, 'SB', 40], [other, 'BB', 100]],
    );
    assert.equal(s.actingSeat, button, 'SB/button acts first preflop');
    assert.deepEqual(getLegalActions(s), { seat: button, types: ['fold', 'call', 'raise'], toCall: 60, minTo: 200, maxTo: 10000 });

    s = play(s, [[button, 'call'], [other, 'check']]);
    assert.equal(s.street, 'flop');
    assert.equal(s.board.length, 3);
    assert.equal(s.actingSeat, other, 'BB acts first postflop');
    s = play(s, [[other, 'check'], [button, 'check']]);
    assert.equal(s.street, 'turn');
    assert.equal(s.actingSeat, other);
    s = play(s, [[other, 'bet', 100], [button, 'call']]);
    assert.equal(s.street, 'river');
    assert.equal(s.actingSeat, other);
  }
});

test('heads-up: the BB gets its option after an SB limp', () => {
  let s = createHand(makeScenario({ stacks: [10000, 10000], button: 0 }));
  s = play(s, [[0, 'call']]);
  assert.equal(s.actingSeat, 1);
  assert.deepEqual(getLegalActions(s).types, ['check', 'raise']);
  s = play(s, [[1, 'raise', 300], [0, 'call']]);
  assert.equal(s.street, 'flop');
  assert.equal(s.potCollected, 600);
});

test('3-handed: button acts first preflop, SB first postflop', () => {
  let s = createHand(makeScenario({ stacks: [10000, 10000, 10000], button: 2 }));
  assert.equal(s.sbSeat, 0);
  assert.equal(s.bbSeat, 1);
  assert.deepEqual(s.players.map((p) => p.position), ['SB', 'BB', 'BTN']);
  s = play(s, [[2, 'call'], [0, 'call'], [1, 'check']]);
  assert.equal(s.actingSeat, 0);
  s = play(s, [[0, 'check'], [1, 'check'], [2, 'check']]);
  assert.equal(s.street, 'turn');
});

test('positions follow POSITIONS_BY_SIZE from the seat after the BB', () => {
  const s = createHand(makeScenario({ stacks: Array(6).fill(10000), button: 3 }));
  assert.deepEqual(s.players.map((p) => p.position), ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
  assert.equal(s.actingSeat, 0);
  const s9 = createHand(makeScenario({ stacks: Array(9).fill(10000), button: 8 }));
  assert.deepEqual(s9.players.map((p) => p.position),
    ['SB', 'BB', 'UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN']);
  assert.equal(s9.actingSeat, 2);
});

test('postflop action skips folded and all-in players', () => {
  let s = createHand(makeScenario({ stacks: [10000, 10000, 10000, 1000], button: 0 }));
  // UTG = seat 3 (short), BTN 0, SB 1, BB 2.
  s = play(s, [[3, 'raise', 1000], [0, 'call'], [1, 'fold'], [2, 'call']]);
  assert.equal(s.street, 'flop');
  assert.equal(s.actingSeat, 2, 'SB folded, so BB is first; UTG is all-in');
  s = play(s, [[2, 'check'], [0, 'check']]);
  assert.equal(s.street, 'turn');
});

test('dealing and event log basics', () => {
  const s = createHand(makeScenario({ stacks: [10000, 10000, 10000], button: 0 }));
  const deals = eventsOf(s, 'dealHole');
  assert.deepEqual(deals.map((e) => e.seat), [1, 2, 0], 'dealt from the SB clockwise');
  const all = [...s.deck, ...s.players.flatMap((p) => p.holeCards)];
  assert.equal(all.length, 52);
  assert.equal(new Set(all).size, 52);
  s.events.forEach((e, i) => assert.equal(e.seq, i));
  const after = play(s, [[0, 'raise', 250]]);
  assert.deepEqual(after.events.at(-1), {
    seq: s.events.length, type: 'action', street: 'preflop', seat: 0, action: 'raise',
    amount: 250, to: 250, allIn: false, potBefore: 140, toCall: 100, stackBefore: 10000,
  });
  assert.equal(after.preflopAggressorSeat, 0);
  assert.equal(after.lastAggressorSeat, 0);
});
