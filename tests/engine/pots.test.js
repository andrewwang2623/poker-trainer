// Side pots, split pots, odd chips, uncalled bets, showdown and all-in EV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHand, getLegalActions, isComplete } from '../../src/engine/game.js';
import { makeScenario, play, eventsOf, assertConserved } from './_helpers.js';

test('side pots: four all-ins of different sizes plus a covering caller', () => {
  // Button 4 → SB 0, BB 1, first to act seat 2.
  const scenario = makeScenario({ stacks: [1000, 2500, 5000, 8000, 20000], button: 4, hero: 4 });
  let s = createHand(scenario, {
    cards: {
      holes: { 0: ['As', 'Ah'], 1: ['Ks', 'Kh'], 2: ['Qs', 'Qh'], 3: ['Ts', 'Th'], 4: ['9s', '9d'] },
      board: ['2c', '5d', '7h', '8s', 'Jc'],
    },
  });
  s = play(s, [
    [2, 'raise', 5000], // all-in
    [3, 'raise', 8000], // all-in, incomplete re-raise
    [4, 'call'],
    [0, 'call'], // all-in for less
    [1, 'call'], // all-in for less
  ]);
  assert.ok(isComplete(s));
  assert.deepEqual(s.board, ['2c', '5d', '7h', '8s', 'Jc']);
  const r = s.result;
  // 5% of 24500 = 1225, capped at 4bb = 400, taken from the main pot.
  assert.equal(r.rakeChips, 400);
  assert.deepEqual(r.pots, [
    { amount: 5000 - 400, eligibleSeats: [0, 1, 2, 3, 4], winnerSeats: [0] },
    { amount: 6000, eligibleSeats: [1, 2, 3, 4], winnerSeats: [1] },
    { amount: 7500, eligibleSeats: [2, 3, 4], winnerSeats: [2] },
    { amount: 6000, eligibleSeats: [3, 4], winnerSeats: [3] },
  ]);
  assert.deepEqual(r.netChips, [3600, 3500, 2500, -2000, -8000]);
  assert.deepEqual(s.players.map((p) => p.stack), [4600, 6000, 7500, 6000, 12000]);
  assert.deepEqual(eventsOf(s, 'award').map((e) => [e.seat, e.amount, e.potIndex]),
    [[0, 4600, 0], [1, 6000, 1], [2, 7500, 2], [3, 6000, 3]]);
  assert.deepEqual(r.showdownSeats.slice().sort(), [0, 1, 2, 3, 4]);
  assert.equal(eventsOf(s, 'board').length, 3, 'flop, turn and river run out');
  assertConserved(s);

  // Hero (99) was all-in-called preflop: EV computed by 20k-sample Monte Carlo.
  assert.equal(r.heroAllInEv.street, 'preflop');
  assert.ok(r.heroAllInEv.heroEquity > 0 && r.heroAllInEv.heroEquity < 0.3);
  assert.ok(r.heroAllInEv.evNetChips < 0);
});

test('side pots: all-ins on different streets, dead money from a folder, short stack wins main only', () => {
  // Button 0, SB 1, BB 2, UTG 3.
  let s = createHand(makeScenario({ stacks: [10000, 600, 3000, 10000], button: 0, hero: 3 }), {
    cards: {
      holes: { 0: ['Kd', 'Kc'], 1: ['Ah', 'Ad'], 2: ['Qd', 'Qc'], 3: ['Jh', 'Jd'] },
      board: ['2s', '7c', '9h', '4d', '3s'],
    },
  });
  s = play(s, [[3, 'raise', 600], [0, 'call'], [1, 'call'], [2, 'call']]);
  // SB is all-in preflop (600). Flop: BB first.
  assert.equal(s.street, 'flop');
  assert.equal(s.actingSeat, 2);
  s = play(s, [[2, 'bet', 2400], [3, 'call'], [0, 'fold']]);
  assert.ok(isComplete(s));
  const r = s.result;
  // 5% of 7200 = 360, under the 400 cap, taken from the main pot.
  assert.equal(r.rakeChips, 360);
  assert.deepEqual(r.pots, [
    { amount: 2400 - 360, eligibleSeats: [1, 2, 3], winnerSeats: [1] },
    { amount: 4800, eligibleSeats: [2, 3], winnerSeats: [2] },
  ]);
  assert.deepEqual(r.netChips, [-600, 1440, 1800, -3000]);
  assert.deepEqual(r.showdownSeats, [1, 2, 3]);
  assert.equal(r.heroAllInEv.street, 'flop', 'hero called an all-in with two cards to come');
  assertConserved(s);
});

test('split pot: odd chip goes to the first winner left of the button', () => {
  // Heads-up, button/SB seat 0. Both play the Broadway board.
  let s = createHand(makeScenario({ stacks: [10000, 10000], button: 0 }), {
    cards: { holes: { 0: ['2c', '3c'], 1: ['2d', '3d'] }, board: ['Ts', 'Js', 'Qh', 'Kc', 'Ad'] },
  });
  s = play(s, [
    [0, 'call'], [1, 'check'],
    [1, 'bet', 150], [0, 'call'],
    [1, 'check'], [0, 'check'],
    [1, 'check'], [0, 'check'],
  ]);
  const r = s.result;
  assert.equal(r.rakeChips, 25); // 5% of 500
  assert.deepEqual(r.pots, [{ amount: 475, eligibleSeats: [0, 1], winnerSeats: [1, 0] }]);
  assert.deepEqual(eventsOf(s, 'award').map((e) => [e.seat, e.amount]), [[1, 238], [0, 237]]);
  assert.deepEqual(r.netChips, [-13, -12]);
  assert.equal(r.heroAllInEv, null);
  assertConserved(s);
});

test('three-way split of a side pot while the short stack wins the main', () => {
  // Button 3 → SB 0, BB 1, UTG 2. Seat 0 is short.
  let s = createHand(makeScenario({ stakes: 'mid', stacks: [1000, 5000, 5000, 5000], button: 3 }), {
    cards: {
      holes: { 0: ['Ah', 'Kh'], 1: ['2c', '3d'], 2: ['4c', '2s'], 3: ['5c', '6d'] },
      board: ['Th', 'Jh', 'Qh', '7s', '8c'], // seat 0 has a royal; the rest play the board
    },
  });
  s = play(s, [[2, 'raise', 5000], [3, 'call'], [0, 'call'], [1, 'call']]);
  const r = s.result;
  // Pots: main 4000, side 12000. Mid rake: 4.5% of 16000 = 720 → cap 300.
  assert.equal(r.rakeChips, 300);
  assert.deepEqual(r.pots[0], { amount: 3700, eligibleSeats: [0, 1, 2, 3], winnerSeats: [0] });
  assert.equal(r.pots[1].amount, 12000);
  assert.deepEqual(r.pots[1].winnerSeats, [1, 2, 3], 'all three play the board');
  assert.deepEqual(eventsOf(s, 'award').filter((e) => e.potIndex === 1).map((e) => e.amount), [4000, 4000, 4000]);
  assertConserved(s);
});

test('uncalled bets are returned', () => {
  // Preflop raise, everyone folds.
  let s = createHand(makeScenario({ stacks: [10000, 10000, 10000], button: 0 }));
  s = play(s, [[0, 'raise', 300], [1, 'fold'], [2, 'fold']]);
  assert.deepEqual(eventsOf(s, 'uncalled').map((e) => [e.seat, e.amount, e.street]), [[0, 200, 'preflop']]);
  assert.deepEqual(s.result.netChips, [140, -40, -100]);
  assert.equal(s.result.rakeChips, 0);
  assert.deepEqual(s.result.showdownSeats, []);
  assert.equal(eventsOf(s, 'award')[0].street, 'preflop');
  assertConserved(s);

  // A covered all-in call returns the excess.
  s = createHand(makeScenario({ stacks: [5000, 1000], button: 0 }));
  s = play(s, [[0, 'raise', 3000], [1, 'call']]);
  assert.deepEqual(eventsOf(s, 'uncalled').map((e) => [e.seat, e.amount]), [[0, 2000]]);
  assert.equal(s.result.pots.length, 1);
  assert.equal(s.result.pots[0].amount + s.result.rakeChips, 2000);
  assertConserved(s);
});

test('walk: BB wins the SB when everyone folds', () => {
  let s = createHand(makeScenario({ stacks: [10000, 10000, 10000], button: 0 }));
  s = play(s, [[0, 'fold'], [1, 'fold']]);
  assert.ok(isComplete(s));
  assert.deepEqual(s.result.netChips, [0, -40, 40]);
  assert.equal(getLegalActions(s), null);
  assertConserved(s);
});

test('showdown order: river aggressor shows first, else first live seat left of the button', () => {
  let s = createHand(makeScenario({ stacks: [10000, 10000, 10000], button: 0 }));
  s = play(s, [
    [0, 'call'], [1, 'call'], [2, 'check'],
    [1, 'check'], [2, 'check'], [0, 'check'],
    [1, 'check'], [2, 'check'], [0, 'check'],
    [1, 'check'], [2, 'check'], [0, 'bet', 200], [1, 'call'], [2, 'call'],
  ]);
  assert.deepEqual(eventsOf(s, 'showdown').map((e) => e.seat), [0, 1, 2]);
  assert.ok(eventsOf(s, 'showdown').every((e) => e.handLabel && e.cards.length === 2 && e.street === 'showdown'));

  s = createHand(makeScenario({ stacks: [10000, 10000, 10000], button: 0 }));
  s = play(s, [
    [0, 'call'], [1, 'call'], [2, 'check'],
    ...Array(3).fill([[1, 'check'], [2, 'check'], [0, 'check']]).flat(),
  ]);
  assert.deepEqual(eventsOf(s, 'showdown').map((e) => e.seat), [1, 2, 0]);
  assertConserved(s);
});

test('all-in EV on the turn uses exact enumeration and nets out rake', () => {
  // Hero (seat 1, BB) has a flush draw vs an overpair; all-in on the turn with one card to come.
  let s = createHand(makeScenario({ stacks: [5000, 5000], button: 0, hero: 1 }), {
    cards: { holes: { 0: ['Ks', 'Kd'], 1: ['Ah', '5h'] }, board: ['2h', '7h', 'Jc', '3s', '9d'] },
  });
  s = play(s, [
    [0, 'call'], [1, 'check'],
    [1, 'check'], [0, 'check'],
    [1, 'bet', 4900], [0, 'call'],
  ]);
  const ev = s.result.heroAllInEv;
  assert.equal(ev.street, 'turn');
  // 44 rivers: 9 hearts (flush), 3 more 4s (wheel), 3 aces (pair over KK) = 15 outs.
  assert.ok(Math.abs(ev.heroEquity - 15 / 44) < 1e-9, String(ev.heroEquity));
  // Pot 10000, rake capped at 400 → 9600 net. EV = 15/44 × 9600 − 5000.
  assert.equal(ev.evNetChips, Math.round((15 / 44 * 9600 - 5000) * 100) / 100);
  assert.deepEqual(s.result.netChips, [4600, -5000]);
});
