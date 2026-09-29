import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hand, act, passiveUntil, events, accounting } from './helpers.js';

const sizes = [500, 1100, 2300, 4700, 9500, 19100];
const ranks = ['A', 'K', 'Q', 'T', '8', '6'];
// Independently calculated pot layers, with rake already removed from the main pot.
const expected = {
  2: { rake: 50, pots: [950] },
  3: { rake: 135, pots: [1365, 1200] },
  4: { rake: 310, pots: [1690, 1800, 2400] },
  5: { rake: 400, pots: [2100, 2400, 3600, 4800] },
  6: { rake: 400, pots: [2600, 3000, 4800, 7200, 9600] },
};

for (let n = 2; n <= 6; n++) {
  test(`SPEC §3/§5: ${n} unequal all-ins pay each layer to its strongest eligible hand`, () => {
    const ascending = sizes.slice(0, n);
    // Largest stack acts first postflop; shortest has AA, next shortest KK, etc.
    const stacks = [ascending[n - 2], ascending[n - 1], ...ascending.slice(0, -2)];
    const holes = Object.fromEntries(stacks.map((size, seat) => {
      const rank = ranks[ascending.indexOf(size)];
      return [seat, [rank + 'h', rank + 'd']];
    }));
    let s = passiveUntil(hand({ stacks, cards: { holes, board: ['2c', '4d', '7h', '9s', 'Jc'] } }), 'turn');
    assert.equal(s.actingSeat, 1);
    s = act(s, 'bet', stacks[1] - 100);
    s = passiveUntil(s);
    assert.equal(events(s, 'action').filter(e => e.street === 'turn' && e.allIn).length, n);
    assert.deepEqual(events(s, 'uncalled').map(e => [e.seat, e.amount, e.street]),
      [[1, ascending[n - 1] - ascending[n - 2], 'turn']]);
    assert.equal(s.result.rakeChips, expected[n].rake);
    const pots = expected[n].pots.map((amount, i) => ({
      amount,
      eligibleSeats: stacks.flatMap((size, seat) => size >= ascending[i] ? [seat] : []),
      winnerSeats: [stacks.indexOf(ascending[i])],
    }));
    assert.deepEqual(s.result.pots, pots);
    assert.deepEqual(events(s, 'award').map(e => [e.seat, e.amount, e.potIndex]),
      pots.map((p, i) => [p.winnerSeats[0], p.amount, i]));
    assert.deepEqual(s.result.netChips, stacks.map((size, seat) =>
      pots.reduce((total, p) => total + (p.winnerSeats[0] === seat ? p.amount : 0), 0)
      - Math.min(size, ascending[n - 2])));
    accounting(s);
  });
}

test('SPEC §3/§5: folded intermediate contribution funds pots without eligibility', () => {
  let s = hand({ stacks: [10000, 500, 1100, 2300], cards: {
    holes: { 0: ['Ah', 'Ad'], 1: ['Kh', 'Kd'], 2: ['Qh', 'Qd'], 3: ['Th', 'Td'] },
    board: ['2c', '4d', '7h', '9s', 'Jc'],
  } });
  s = passiveUntil(s, 'turn');
  s = act(s, 'bet', 400); // seat 1 all-in, total 500
  s = act(s, 'raise', 800); // seat 2, total 900: full raise
  s = act(s, 'call');
  s = act(s, 'call');
  assert.equal(s.street, 'river');
  s = act(s, 'bet', 200); // seat 2 all-in, total 1100
  s = act(s, 'raise', 1400); // seat 3 all-in, total 2300
  s = act(s, 'fold'); // seat 0 leaves 900 dead chips
  assert.deepEqual(s.result.pots, [
    { amount: 1820, eligibleSeats: [1, 2, 3], winnerSeats: [1] },
    { amount: 1600, eligibleSeats: [2, 3], winnerSeats: [2] },
  ]);
  assert.equal(s.result.rakeChips, 180); // matched contributions: 900 + 500 + 1100 + 1100
  assert.deepEqual(s.result.netChips, [-900, 1320, 500, -1100]);
  accounting(s);
});
