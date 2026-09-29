import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLegalActions, applyAction } from '../../src/engine/index.js';
import { hand, act, passiveUntil, events, accounting } from './helpers.js';

for (const to of [301, 399, 499, 500]) {
  test(`SPEC §5: all-in raise to ${to} after opening 300 ${to < 500 ? 'does not reopen' : 'reopens'} betting`, () => {
    let s = hand({ stacks: [to, 10000, 10000, 10000] });
    s = act(s, 'raise', 300); // UTG 3
    s = act(s, 'raise', to); // button all-in
    assert.equal(getLegalActions(s).minTo, to + 200, 'unacted SB keeps full raise size');
    s = act(s, 'call');
    s = act(s, 'call');
    assert.equal(s.actingSeat, 3);
    assert.deepEqual(getLegalActions(s).types, to < 500 ? ['fold', 'call'] : ['fold', 'call', 'raise']);
    if (to === 500) assert.equal(getLegalActions(s).minTo, 700);
    else assert.throws(() => applyAction(s, { type: 'raise', amount: 1000 }));
    accounting(passiveUntil(s));
  });
}

test('SPEC §5: a 50-chip all-in opening bet reopens after a check, min raise is 150', () => {
  let s = passiveUntil(hand({ stacks: [10000, 10000, 150] }), 'flop');
  s = act(s, 'check'); // SB
  s = act(s, 'bet', 50); // BB all-in
  s = act(s, 'call'); // button
  assert.equal(s.actingSeat, 1);
  assert.deepEqual(getLegalActions(s).types, ['fold', 'call', 'raise']);
  assert.equal(getLegalActions(s).minTo, 150);
  assert.throws(() => applyAction(s, { type: 'raise', amount: 149 }));
  s = act(s, 'raise', 150);
  accounting(passiveUntil(s));
});

for (const n of [2, 3]) for (let button = 0; button < n; button++) {
  test(`SPEC §2: ${n}-way blind and street orders with button ${button}`, () => {
    const sb = n === 2 ? button : (button + 1) % n;
    const bb = (sb + 1) % n;
    let s = hand({ stacks: Array(n).fill(10000), button });
    assert.equal(s.sbSeat, sb);
    assert.equal(s.bbSeat, bb);
    assert.deepEqual(events(s, 'postBlind').map(e => [e.seat, e.blind, e.amount]), [[sb, 'SB', 40], [bb, 'BB', 100]]);
    const pre = Array.from({ length: n }, (_, i) => (button + i) % n);
    for (const seat of pre) {
      assert.equal(s.actingSeat, seat);
      s = act(s, seat === bb ? 'check' : 'call');
    }
    for (const street of ['flop', 'turn', 'river']) {
      assert.equal(s.street, street);
      for (let i = 1; i <= n; i++) {
        assert.equal(s.actingSeat, (button + i) % n);
        assert.ok(!getLegalActions(s).types.includes('fold'), 'cannot fold when check is free');
        s = act(s, 'check');
      }
    }
    accounting(s);
  });
}

for (const stakes of ['micro', 'low', 'mid', 'high']) for (const n of [2, 3, 6, 9]) {
  test(`SPEC §2/§3: ${stakes} ${n}-way BB walk, every button position`, () => {
    for (let button = 0; button < n; button++) {
      let s = hand({ stakes, stacks: Array(n).fill(10000), button });
      const { sbSeat, bbSeat } = s;
      const sb = stakes === 'micro' || stakes === 'low' ? 40 : 50;
      while (s.street !== 'complete') s = act(s, 'fold');
      assert.deepEqual(s.result.netChips, Array.from({ length: n }, (_, seat) => seat === sbSeat ? -sb : seat === bbSeat ? sb : 0));
      assert.deepEqual(events(s, 'uncalled').map(e => [e.seat, e.amount]), [[bbSeat, 100 - sb]]);
      assert.equal(events(s, 'action').length, n - 1);
      assert.ok(events(s, 'action').every(e => e.seat !== bbSeat));
      assert.deepEqual(s.board, []);
      assert.equal(s.result.rakeChips, 0);
      assert.deepEqual(events(s, 'rake'), []);
      accounting(s);
    }
  });
}
