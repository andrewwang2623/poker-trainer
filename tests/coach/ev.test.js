// Coach EV model (SPEC §8.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evCheck, evCall, evBet, foldEstimate, candidateActions, evaluateCandidates, severityOf, sizeKey,
  REALIZATION, CALLED_EQUITY, overbetEquity,
} from '../../src/coach/ev.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('formulas: check, call and bet/raise EV', () => {
  close(evCheck(0.5, 10, 0.95), 4.75);
  close(evCall(0.4, 10, 5, 1), 0.4 * 15 - 5);
  // F·P + (1−F)·(E'·(P+2A)·R − A), E' = 0.85·E
  close(evBet(0.6, 10, 5, 0.85, 0.3), 0.3 * 10 + 0.7 * (0.85 * 0.6 * 20 * 0.85 - 5));
  assert.equal(CALLED_EQUITY, 0.85);
  assert.deepEqual(REALIZATION, { final: 1, inPosition: 0.95, outOfPosition: 0.85 });
});

test('fold estimate: product of clamped per-opponent folds; an all-in opponent never folds', () => {
  close(foldEstimate([{ foldToBet: 0.5, allIn: false }], 7.5, 10), 0.5 * (0.6 + 0.53 * 0.75));
  close(foldEstimate([{ foldToBet: 0.5 }, { foldToBet: 0.4 }], 5, 10),
    0.5 * (0.6 + 0.265) * 0.4 * (0.6 + 0.265));
  close(foldEstimate([{ foldToBet: 0.01 }], 1, 10), 0.05, 1e-12);
  close(foldEstimate([{ foldToBet: 1 }], 30, 10), 0.9, 1e-12);
  assert.equal(foldEstimate([{ foldToBet: 0.5 }, { foldToBet: 0.5, allIn: true }], 5, 10), 0);
  assert.equal(foldEstimate([], 5, 10), 0);
});

test('overbet guards: fold equity capped at 2× pot, calling equity E/√f past pot', () => {
  const opp = [{ foldToBet: 0.4 }];
  close(foldEstimate(opp, 20, 10), foldEstimate(opp, 200, 10));
  assert.ok(foldEstimate(opp, 20, 10) > foldEstimate(opp, 10, 10));
  assert.equal(overbetEquity(0.8, 1), 0.8);
  assert.equal(overbetEquity(0.8, 0.5), 0.8);
  close(overbetEquity(0.8, 4), 0.4);
  // The nuts with 100bb behind in a 5bb pot: a pot bet beats a 19.5× pot shove.
  const nuts = flopSpot({ pot: 500, equity: 1, legal: { types: ['check', 'bet'], toCall: 0, minTo: 100, maxTo: 9750 } });
  const evs = Object.fromEntries(evaluateCandidates(nuts, candidateActions(nuts, null)).map((c) => [c.key, c.ev]));
  assert.ok(evs['bet:1'] > evs.allIn && evs['bet:1'] > evs.check, JSON.stringify(evs));
  // Pure air into a 12bb pot: the shove is no longer 'best'.
  const air = flopSpot({ pot: 1200, equity: 0, street: 'river' });
  const airEvs = evaluateCandidates(air, candidateActions(air, null));
  assert.ok(airEvs.find((c) => c.key === 'allIn').ev < 0);
});

test('severity cutoffs', () => {
  assert.equal(severityOf(3), 'major');
  assert.equal(severityOf(2.99), 'minor');
  assert.equal(severityOf(0.5), 'minor');
  assert.equal(severityOf(0.49), 'info');
  assert.equal(severityOf(0), 'info');
});

// Flop spot: pot 10bb, hero checked to with 100bb behind, one opponent.
const flopSpot = (extra = {}) => ({
  legal: { types: ['check', 'bet'], toCall: 0, minTo: 100, maxTo: 10000 },
  pot: 1000, heroCommitted: 0, street: 'flop', inPosition: true, equity: 0.5,
  opponents: [{ seat: 1, allIn: false, stack: 10000, committedStreet: 0, stats: { foldToBet: 0.4 } }],
  ...extra,
});

test('candidates: check/fold, call, bet or raise at ½, ¾ and pot plus all-in, plus the chosen size', () => {
  const keys = candidateActions(flopSpot(), { type: 'bet', amount: 330 }).map((c) => c.key);
  assert.deepEqual(keys, ['check', 'bet:0.5', 'bet:0.75', 'bet:1', 'allIn', 'bet:0.33']);
  const same = candidateActions(flopSpot(), { type: 'bet', amount: 750 });
  assert.equal(same.length, 5, 'a preset size is not added twice');
  assert.equal(same.find((c) => c.chosen).key, 'bet:0.75');
  assert.equal(candidateActions(flopSpot(), { type: 'bet', amount: 10000 }).find((c) => c.chosen).key, 'allIn');

  // Facing 5bb into 10bb (pot 15 before hero): a pot raise adds 5 + (15 + 5) = 25bb.
  const facing = {
    legal: { types: ['fold', 'call', 'raise'], toCall: 500, minTo: 1000, maxTo: 10000 },
    pot: 1500, heroCommitted: 0,
  };
  const raises = candidateActions(facing, { type: 'call' });
  assert.deepEqual(raises.map((c) => c.key), ['fold', 'call', 'raise:0.5', 'raise:0.75', 'raise:1', 'allIn']);
  assert.equal(raises.find((c) => c.key === 'raise:1').to, 2500);
  assert.equal(sizeKey('raise', 2500, facing), 'raise:1');
  // Sizes below the min-raise or at/over all-in are dropped.
  const short = { ...facing, legal: { ...facing.legal, maxTo: 2000 } };
  assert.deepEqual(candidateActions(short, null).map((c) => c.key), ['fold', 'call', 'raise:0.5', 'allIn']);
});

test('EV by candidate: realization by position and street, all-in realization 1', () => {
  const [check, half] = evaluateCandidates(flopSpot(), candidateActions(flopSpot(), null));
  close(check.ev, Math.round(0.5 * 10 * 0.95 * 100) / 100);
  const F = 0.4 * (0.6 + 0.53 * 0.5);
  close(half.fold, F);
  close(half.ev, Math.round((F * 10 + (1 - F) * (0.85 * 0.5 * 20 * 0.95 - 5)) * 100) / 100);
  const oop = evaluateCandidates(flopSpot({ inPosition: false }), [{ key: 'check', type: 'check', to: null }]);
  close(oop[0].ev, 0.5 * 10 * 0.85);
  const river = evaluateCandidates(flopSpot({ street: 'river' }), [{ key: 'check', type: 'check', to: null }]);
  close(river[0].ev, 5);
});

test('EV caps what an all-in can win at what opponents can match', () => {
  // Hero shoves 100bb into a 10bb pot; the opponent has only 20bb behind.
  const spot = flopSpot({
    opponents: [{ seat: 1, allIn: false, stack: 2000, committedStreet: 0, stats: { foldToBet: 0.4 } }],
  });
  const [shove] = evaluateCandidates(spot, [{ key: 'allIn', type: 'bet', to: 10000 }]);
  const F = 0.4 * (0.6 + 0.53 * 2); // folds stop growing past a 2× pot overbet
  close(shove.fold, F);
  const Ec = 0.5 / Math.sqrt(10); // a 10× pot bet is called by a tighter range
  close(shove.ev, Math.round((F * 10 + (1 - F) * (0.85 * Ec * (10 + 40) * 1 - 20)) * 100) / 100);

  // Hero calls a 100bb shove with 20bb: the 80bb excess comes back.
  const call = {
    legal: { types: ['fold', 'call'], toCall: 2000, minTo: 0, maxTo: 2000 },
    pot: 11000, heroCommitted: 0, street: 'flop', inPosition: false, equity: 0.4,
    opponents: [{ seat: 1, allIn: true, stack: 0, committedStreet: 10000, stats: { foldToBet: 0.4 } }],
  };
  const [c] = evaluateCandidates(call, [{ key: 'call', type: 'call', to: null }]);
  close(c.ev, Math.round((0.4 * (110 - 80 + 20) * 1 - 20) * 100) / 100);
});

test('bounty EV: P(win) × payout on continuing actions; fold wins count only for showdownOrFold', () => {
  const cands = candidateActions(flopSpot(), null);
  const plain = evaluateCandidates(flopSpot(), cands);
  const orFold = evaluateCandidates(flopSpot({ bounties: [{ bb: 10, paysOnFold: true }] }), cands);
  const onlySd = evaluateCandidates(flopSpot({ bounties: [{ bb: 10, paysOnFold: false }] }), cands);
  const byKey = (list) => Object.fromEntries(list.map((c) => [c.key, c]));
  const [p, f, s] = [byKey(plain), byKey(orFold), byKey(onlySd)];
  close(f.check.ev - p.check.ev, 0.5 * 10, 0.011);
  close(s.check.ev - p.check.ev, 0.5 * 10, 0.011);
  const F = p['bet:0.5'].fold;
  close(f['bet:0.5'].ev - p['bet:0.5'].ev, 10 * (F + (1 - F) * 0.85 * 0.5), 0.011);
  close(s['bet:0.5'].ev - p['bet:0.5'].ev, 10 * (1 - F) * 0.85 * 0.5, 0.011);
});
