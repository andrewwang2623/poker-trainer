// Coach opponent ranges (SPEC §8.1) and decision contexts rebuilt from records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardCode } from '../../src/engine/index.js';
import {
  preflopRange, strengthBand, seatActions, dropWeakest, opponentRanges, statsOf, STRENGTH_PCT, DEFAULT_STATS,
} from '../../src/coach/villainRanges.js';
import { decisionContexts } from '../../src/coach/context.js';
import { makeHand, recordOf, PROFILES } from './_hands.js';

/** Share of all 1326 combos; keys are classes or (after narrowing) exact combos such as "KhQh". */
const coverage = (range) => Object.entries(range)
  .reduce((s, [c, f]) => s + f * (c.length === 4 ? 1 : c.length === 2 ? 6 : c[2] === 's' ? 4 : 12), 0) / 1326;
/** Combo-keyed weights of a class's combos in a narrowed range. */
const comboWeights = (range, cls) => Object.entries(range)
  .filter(([c]) => c.length === 4 && [c[0] + c[2], c[2] + c[0]].includes(cls.slice(0, 2)) &&
    (cls.length === 2 || (c[1] === c[3]) === (cls[2] === 's')))
  .map(([, w]) => w);

test('preflop ranges follow the action: raise, 3-bet, call band, BB check complement, not yet acted', () => {
  const stats = { vpip: 0.3, pfr: 0.2, threeBet: 0.08 };
  const raise = preflopRange(stats, { acted: true, raiseIndex: 1 });
  const threeBet = preflopRange(stats, { acted: true, raiseIndex: 2 });
  const call = preflopRange(stats, { acted: true, called: true, raiseIndex: 0 });
  const check = preflopRange(stats, { acted: true, raiseIndex: 0 });
  const unacted = preflopRange(stats, undefined);
  assert.ok(Math.abs(coverage(raise) - 0.2) < 0.02);
  assert.ok(Math.abs(coverage(threeBet) - 0.08) < 0.02);
  assert.ok(Math.abs(coverage(call) - 0.1) < 0.02, 'called: the band between pfr and vpip');
  assert.ok(Math.abs(coverage(check) - 0.8) < 0.02, 'BB check: everything outside the raising range');
  assert.ok(Math.abs(coverage(unacted) - 0.3) < 0.02, 'not acted yet: the hands it would play');
  assert.equal(raise.AA, 1);
  assert.equal(call.AA, undefined);
  assert.equal(check['72o'], 1);
  assert.equal(check.AA, undefined);
  for (const cls of Object.keys(call)) assert.ok(!raise[cls], `${cls} is in both the raise and call bands`);
});

test('strength bands are percentile slices of the fixed ranking', () => {
  assert.deepEqual(Object.keys(strengthBand(0, 0.01)).sort(), ['AA', 'KK']);
  assert.ok(STRENGTH_PCT.AA < STRENGTH_PCT.KK && STRENGTH_PCT['72o'] > 0.9);
  assert.equal(Object.keys(strengthBand(0, 1.01)).length, 169);
  assert.equal(statsOf(null), DEFAULT_STATS);
  assert.equal(statsOf({ vpip: 0.2, pfr: 0.3, threeBet: 0.4 }).pfr, 0.2, 'pfr capped at vpip');
});

test('postflop: a bet or raise on this street drops the weakest 30% × (1 − bluffFreq) by made hand', () => {
  const board = ['Ks', '7d', '2c'].map(cardCode);
  const blocked = new Uint8Array(52);
  for (const c of board) blocked[c] = 1;
  const range = strengthBand(0, 0.2);
  const narrowed = dropWeakest(range, board, blocked, 0.3);
  const before = coverage(range);
  const after = coverage(narrowed);
  assert.ok(after < before * 0.8 && after > before * 0.6, `${after} vs ${before}`);
  assert.deepEqual(comboWeights(narrowed, 'KQs'), [1, 1, 1], 'top pair survives (Ks is on the board)');
  assert.deepEqual(comboWeights(narrowed, 'QJo'), [], 'queen-high is dropped');
  assert.deepEqual(comboWeights(narrowed, 'A8o'), [], 'weak ace-high is dropped');
  assert.equal(dropWeakest(range, [], blocked, 0.3), range, 'no narrowing preflop');

  const events = [
    { type: 'action', street: 'preflop', seat: 1, action: 'raise', to: 250 },
    { type: 'action', street: 'preflop', seat: 2, action: 'call', to: 250 },
    { type: 'action', street: 'flop', seat: 1, action: 'bet', to: 300 },
  ];
  const acts = seatActions(events, 'flop');
  assert.deepEqual(acts.get(1), { raiseIndex: 1, called: false, acted: true, aggression: 1 });
  assert.deepEqual(acts.get(2), { raiseIndex: 0, called: true, acted: true, aggression: 0 });
  const [bettor, caller] = opponentRanges({
    events, street: 'flop', board: ['Ks', '7d', '2c'], heroCards: ['Ah', 'Ad'],
    opponents: [{ seat: 1, profile: PROFILES.lowReg }, { seat: 2, profile: { ...PROFILES.lowReg, bluffFreq: 1 } }],
  });
  assert.ok(coverage(bettor.range) < coverage(preflopRange(statsOf(PROFILES.lowReg), acts.get(1))));
  // bluffFreq 1 → nothing dropped, and seat 2 didn't bet anyway.
  assert.deepEqual(caller.range, preflopRange(statsOf(PROFILES.lowReg), acts.get(2)));
});

test('decision contexts rebuild pot, legal actions and lines; forced posts are never decisions', () => {
  // 6-max, button 0: SB 1, BB 2, LJ 3 (hero), HJ 4, CO 5.
  const record = recordOf(makeHand({ holes: { 3: ['As', 'Kd'] }, board: ['Qh', '7c', '2d', '9s', '3h'] }), [
    [3, 'raise', 2.5], [4, 'fold'], [5, 'fold'], [0, 'fold'], [1, 'fold'], [2, 'raise', 9],
    [3, 'call'], [2, 'bet', 5], [3, 'raise', 15], [2, 'fold'],
  ]);
  const ctxs = decisionContexts(record);
  assert.equal(ctxs.length, record.decisions.length);
  assert.equal(ctxs.length, 3);
  const [open, call, raise] = ctxs;
  assert.equal(open.pot, 150);
  assert.deepEqual(open.legal, { types: ['fold', 'call', 'raise'], toCall: 100, minTo: 200, maxTo: 10000 });
  assert.deepEqual(open.preflop, { raises: 0, limpers: 0, raiserSeat: null, raiseTo: 0 });
  assert.equal(open.opponents.length, 5);
  assert.equal(call.legal.toCall, 650);
  assert.equal(call.preflop.raises, 2);
  assert.equal(call.lastAggressor, 2);
  assert.equal(call.heroCommitted, 250);
  assert.equal(raise.street, 'flop');
  assert.equal(raise.pot, 1850 + 500, 'both 9bb bets, the folded SB and the flop bet');
  assert.equal(raise.legal.minTo, 1000);
  assert.equal(raise.preflopAggressor, 2);
  assert.equal(raise.streetAggressor, 2);
  assert.equal(raise.firstFlopDecision, true);
  assert.deepEqual(raise.opponents.map((o) => o.seat), [2]);
});

test('straddle: the post is not a decision, the effective blind is 2bb and the straddler keeps its option', () => {
  // 5-handed, button 0: SB 1, BB 2, straddle 3 (hero), then 4.
  const record = recordOf(makeHand({ n: 5, hero: 3, straddleSeat: 3, holes: { 3: ['9c', '8c'] } }), [
    [4, 'call'], [0, 'fold'], [1, 'fold'], [2, 'fold'], [3, 'check'],
  ]);
  assert.equal(record.decisions[0].action.type, 'check');
  const [ctx] = decisionContexts(record);
  assert.equal(ctx.blind, 200);
  assert.equal(ctx.preflop.limpers, 1, 'the straddle is a post, not a raise');
  assert.equal(ctx.preflop.raises, 0);
  assert.deepEqual(ctx.legal, { types: ['check', 'raise'], toCall: 0, minTo: 400, maxTo: 10000 });

  const walk = recordOf(makeHand({ n: 5, hero: 3, straddleSeat: 3 }), [
    [4, 'fold'], [0, 'fold'], [1, 'fold'], [2, 'fold'],
  ]);
  assert.equal(walk.decisions.length, 0);
  assert.deepEqual(decisionContexts(walk), []);
});

test('narrowing keeps weights per combo: a class is never refilled with its dropped combos', () => {
  // AA/KK on a four-spade board: the spade aces and kings made flushes, the rest only an overpair.
  const board = ['9s', '8s', '2s', '3s', '4d'].map(cardCode);
  const blocked = new Uint8Array(52);
  for (const c of [...board, cardCode('Qs'), cardCode('Jh')]) blocked[c] = 1;
  const kept = dropWeakest({ AA: 1, KK: 1 }, board, blocked, 0.3);
  // 12 combos, drop 3.6: all three non-spade KK and 0.6 of the (tied) non-spade AA.
  for (const combo of ['KhKd', 'KhKc', 'KdKc']) assert.equal(kept[combo] ?? 0, 0, combo);
  for (const combo of ['AsAh', 'AsAd', 'AsAc', 'KsKh', 'KsKd', 'KsKc']) assert.equal(kept[combo], 1, combo);
  for (const combo of ['AhAd', 'AhAc', 'AdAc']) assert.ok(Math.abs(kept[combo] - 0.8) < 1e-9, combo);
  assert.ok(Math.abs(Object.values(kept).reduce((s, w) => s + w, 0) - 8.4) < 1e-9);
});
