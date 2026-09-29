import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hand, act, passiveUntil, events, accounting } from './helpers.js';

const showdowns = [
  { name: 'one-pair king kicker beats queen kicker', board: ['As', '7d', '4c', '2h', '9s'],
    holes: { 0: ['Ah', 'Kh'], 1: ['Ad', 'Qh'] }, winners: [0] },
  { name: 'board two-pair splits with equal ace kickers, ignoring sixth cards', board: ['Kc', 'Kd', '7h', '7s', '2c'],
    holes: { 0: ['Ah', '3d'], 1: ['As', '4d'], 2: ['Qh', '5h'] }, winners: [1, 0] },
  { name: 'quads on board use the private ace kicker', board: ['9c', '9d', '9h', '9s', '2c'],
    holes: { 0: ['Ah', '3d'], 1: ['Ks', '4d'] }, winners: [0] },
  { name: 'quads with board ace split, private kickers do not count', board: ['9c', '9d', '9h', '9s', 'Ac'],
    holes: { 0: ['Kh', '3d'], 1: ['Qs', '4d'] }, winners: [1, 0] },
  { name: 'board straight splits despite different hole-card ranks', board: ['Ts', 'Js', 'Qh', 'Kc', 'Ad'],
    holes: { 0: ['2c', '3c'], 1: ['8d', '9d'] }, winners: [1, 0] },
  { name: 'board pair with three board kickers splits', board: ['Ac', 'Ad', 'Kc', 'Qd', 'Jh'],
    holes: { 0: ['2c', '3c'], 1: ['4d', '5d'] }, winners: [1, 0] },
  { name: 'flush fifth-card kicker improves on the board', board: ['Ah', 'Jh', '8h', '4h', '2h'],
    holes: { 0: ['3h', 'Ks'], 1: ['Qd', '5s'] }, winners: [0] },
];

for (const { name, board, holes, winners } of showdowns) {
  test(`SPEC §5: ${name}`, () => {
    const n = Object.keys(holes).length;
    const s = passiveUntil(hand({ stacks: Array(n).fill(10000), cards: { holes, board } }));
    assert.deepEqual(s.result.pots, [{ amount: n * 95, eligibleSeats: Array.from({ length: n }, (_, i) => i), winnerSeats: winners }]);
    assert.deepEqual(events(s, 'award').map(e => e.seat), winners);
    accounting(s);
  });
}

for (let button = 0; button < 3; button++) {
  test(`SPEC §5: board plays, entire two-chip remainder goes left of button ${button}`, () => {
    let s = passiveUntil(hand({ button, stacks: [10000, 10000, 10000], cards: {
      holes: { 0: ['2c', '3d'], 1: ['4c', '5d'], 2: ['6c', '7d'] },
      board: ['Th', 'Jh', 'Qh', 'Kh', 'Ah'],
    } }), 'river');
    s = act(s, 'bet', 107);
    s = passiveUntil(s);
    assert.equal(s.result.rakeChips, 31); // floor(621 * .05)
    assert.equal(s.result.pots[0].amount, 590);
    assert.deepEqual(events(s, 'award').map(e => [e.seat, e.amount]),
      [[(button + 1) % 3, 198], [(button + 2) % 3, 196], [button, 196]]);
    accounting(s);
  });
}

// Exact integer pots on either side of each cap, without relying on STAKES as the oracle.
const boundaries = {
  micro: [[3999, 399], [4000, 400], [4001, 400]],
  low: [[2999, 299], [3000, 300], [3001, 300]],
  mid: [[3333, 299], [3334, 300], [3335, 300]],
  high: [[857, 59], [858, 60], [859, 60]],
};
for (const [stakes, cases] of Object.entries(boundaries)) {
  for (const [contribution, rake] of cases) {
    test(`SPEC §3: ${stakes} pot ${2 * contribution} takes ${rake} rake at cap boundary`, () => {
      let s = passiveUntil(hand({ stakes, stacks: [20000, 20000] }), 'river');
      s = act(s, 'bet', contribution - 100);
      s = act(s, 'call');
      assert.equal(s.result.rakeChips, rake);
      assert.equal(s.result.pots[0].amount, 2 * contribution - rake);
      assert.deepEqual(events(s, 'rake').map(e => e.amount), [rake]);
      accounting(s);
    });
  }
  test(`SPEC §3: ${stakes} returns a huge unmatched river bet before calculating rake`, () => {
    let s = passiveUntil(hand({ stakes, stacks: [20000, 20000] }), 'river');
    s = act(s, 'bet', 15000);
    s = act(s, 'fold');
    const rake = { micro: 10, low: 10, mid: 9, high: 7 }[stakes];
    assert.equal(s.result.rakeChips, rake);
    assert.deepEqual(events(s, 'uncalled').map(e => [e.seat, e.amount]), [[1, 15000]]);
    assert.equal(s.result.pots[0].amount, 200 - rake);
    accounting(s);
  });
}
