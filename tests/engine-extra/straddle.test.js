import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLegalActions, applyAction, buildHandRecord } from '../../src/engine/index.js';
import { hand, act, passiveUntil, events, accounting } from './helpers.js';

for (const n of [3, 6, 9]) for (let button = 0; button < n; button++) {
  test(`SPEC §14: ${n}-way straddler option and 4bb minimum, button ${button}`, () => {
    const straddler = (button + 3) % n;
    let s = hand({ stacks: Array(n).fill(10000), button, straddleSeat: straddler });
    assert.equal(s.currentBet, 200);
    assert.equal(s.lastRaiseSize, 200);
    assert.deepEqual(events(s, 'postBlind').map(e => [e.seat, e.blind, e.amount]),
      [[(button + 1) % n, 'SB', 40], [(button + 2) % n, 'BB', 100], [straddler, 'straddle', 200]]);
    assert.ok(events(s, 'postBlind').at(-1).seq < events(s, 'dealHole')[0].seq);
    for (let i = 1; i < n; i++) {
      assert.equal(s.actingSeat, (straddler + i) % n);
      assert.equal(getLegalActions(s).minTo, 400);
      s = act(s, 'call');
    }
    assert.equal(s.actingSeat, straddler);
    assert.deepEqual(getLegalActions(s).types, ['check', 'raise']);
    assert.equal(getLegalActions(s).toCall, 0);
    assert.equal(getLegalActions(s).minTo, 400);
    assert.throws(() => applyAction(s, { type: 'raise', amount: 399 }));
    const checked = act(s, 'check');
    assert.equal(checked.street, 'flop');
    assert.equal(checked.actingSeat, (button + 1) % n);
    assert.equal(getLegalActions(checked).minTo, 100);
    accounting(passiveUntil(checked));
    const raised = act(s, 'raise', 400);
    assert.equal(raised.actingSeat, (straddler + 1) % n);
    assert.equal(getLegalActions(raised).toCall, 200);
    assert.equal(getLegalActions(raised).minTo, 600);
    accounting(passiveUntil(raised));
  });
}

test('SPEC §14/§5: short all-in below 4bb keeps the 2bb full-raise increment', () => {
  let s = hand({ stacks: [10000, 10000, 10000, 10000, 350], straddleSeat: 3 });
  assert.equal(s.actingSeat, 4);
  assert.equal(getLegalActions(s).minTo, 350);
  s = act(s, 'raise', 350);
  assert.equal(getLegalActions(s).minTo, 550);
  for (let i = 0; i < 3; i++) s = act(s, 'call');
  assert.equal(s.actingSeat, 3);
  assert.ok(getLegalActions(s).types.includes('raise'), 'forced post is not a prior action');
  assert.equal(getLegalActions(s).minTo, 550);
  s = act(s, 'raise', 550);
  accounting(passiveUntil(s));
});

for (const stakes of ['micro', 'low', 'mid', 'high']) {
  test(`SPEC §14: ${stakes} straddle walk refunds 1bb and has no rake or voluntary hero stats`, () => {
    for (const n of [3, 6, 9]) for (let button = 0; button < n; button++) {
      const straddler = (button + 3) % n;
      let s = hand({ stakes, stacks: Array(n).fill(10000), button, hero: straddler, straddleSeat: straddler });
      while (s.street !== 'complete') s = act(s, 'fold');
      const sb = stakes === 'micro' || stakes === 'low' ? 40 : 50;
      assert.deepEqual(events(s, 'uncalled').map(e => [e.seat, e.amount, e.street]), [[straddler, 100, 'preflop']]);
      assert.deepEqual(s.result.netChips, Array.from({ length: n }, (_, seat) =>
        seat === straddler ? 100 + sb : seat === s.sbSeat ? -sb : seat === s.bbSeat ? -100 : 0));
      assert.equal(s.result.rakeChips, 0);
      assert.deepEqual(s.board, []);
      assert.deepEqual(events(s, 'rake'), []);
      assert.ok(events(s, 'action').every(e => e.seat !== straddler));
      const record = buildHandRecord(s);
      assert.equal(record.straddleSeat, straddler);
      assert.equal(record.statFlags.straddled, true);
      for (const flag of ['vpip', 'pfr', 'threeBetOpp']) assert.equal(record.statFlags[flag], false, flag);
      assert.deepEqual(record.decisions, []);
      accounting(s);
    }
  });
}
