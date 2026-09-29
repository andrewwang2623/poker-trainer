// Rake: percentage, caps per stakes, no flop no drop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHand } from '../../src/engine/game.js';
import { STAKES } from '../../src/shared/schemas.js';
import { makeScenario, play, eventsOf, assertConserved } from './_helpers.js';

/** Heads-up: limp/check preflop, flop bet `bet` and call, then check down. Pot = 200 + 2·bet. */
function flopPot(stakes, bet) {
  let s = createHand(makeScenario({ stakes, stacks: [100000, 100000], button: 0 }));
  const sb = STAKES[stakes].sbChips;
  assert.equal(eventsOf(s, 'postBlind')[0].amount, sb);
  s = play(s, [
    [0, 'call'], [1, 'check'],
    [1, 'bet', bet], [0, 'call'],
    [1, 'check'], [0, 'check'],
    [1, 'check'], [0, 'check'],
  ]);
  assertConserved(s);
  return s;
}

test('rake is a percentage of the pot below the cap', () => {
  assert.equal(flopPot('micro', 1400).result.rakeChips, 150); // 5% of 3000
  assert.equal(flopPot('mid', 1400).result.rakeChips, 135); // 4.5% of 3000
  assert.equal(flopPot('high', 400).result.rakeChips, 35); // 3.5% of 1000
  assert.equal(flopPot('micro', 150).result.rakeChips, 25); // 5% of 500
  assert.equal(flopPot('high', 100).result.rakeChips, 14); // floor(3.5% of 400)
});

test('rake caps per stakes', () => {
  assert.equal(flopPot('micro', 20000).result.rakeChips, 400); // 4bb
  assert.equal(flopPot('low', 20000).result.rakeChips, 300); // 3bb
  assert.equal(flopPot('mid', 20000).result.rakeChips, 300); // 3bb
  assert.equal(flopPot('high', 20000).result.rakeChips, 60); // 0.6bb
  // Exactly at the cap boundary: 5% of 8000 = 400.
  assert.equal(flopPot('micro', 3900).result.rakeChips, 400);
  const s = flopPot('high', 20000);
  assert.deepEqual(eventsOf(s, 'rake').map((e) => e.amount), [60]);
  const winner = s.result.pots[0].winnerSeats;
  const net = s.result.netChips;
  if (winner.length === 1) assert.equal(net[winner[0]], 20100 - 60);
});

test('no flop, no drop', () => {
  // A hand that ends on the flop by a fold is raked.
  let s = createHand(makeScenario({ stacks: [10000, 10000, 10000], button: 0 }));
  s = play(s, [[0, 'raise', 300], [1, 'call'], [2, 'fold']]);
  assert.equal(s.street, 'flop');
  s = play(s, [[1, 'check'], [0, 'bet', 400], [1, 'fold']]);
  assert.equal(s.result.rakeChips, 35, 'postflop fold win is raked: 5% of 700 after the uncalled 400');
  assertConserved(s);

  // A big pot that ends preflop is not.
  s = createHand(makeScenario({ stacks: [10000, 10000, 10000], button: 0 }));
  s = play(s, [[0, 'raise', 5000], [1, 'raise', 10000], [2, 'fold'], [0, 'fold']]);
  assert.equal(s.board.length, 0);
  assert.equal(s.result.rakeChips, 0);
  assert.equal(eventsOf(s, 'rake').length, 0);
  assertConserved(s);
});

test('a preflop all-in that is called is raked (the flop is dealt)', () => {
  let s = createHand(makeScenario({ stacks: [2000, 2000], button: 0 }));
  s = play(s, [[0, 'raise', 2000], [1, 'call']]);
  assert.equal(s.board.length, 5);
  assert.equal(s.result.rakeChips, 200); // 5% of 4000
  assertConserved(s);
});
