// Preflop chart checks (SPEC §8.2 chart costs, §8.3 PF_* flags, §14 straddle roles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionContexts } from '../../src/coach/context.js';
import { chartCheck, openSizeCheck, chartRole, depthBand } from '../../src/coach/preflop.js';
import { makeHand, recordOf } from './_hands.js';

// 6-max, button 0: SB 1, BB 2, LJ 3, HJ 4, CO 5.
const check = (opts, steps, index = 0, held = false) => {
  const record = recordOf(makeHand(opts), steps);
  const ctx = decisionContexts(record)[index];
  return { record, ctx, result: chartCheck(record, ctx, held), size: openSizeCheck(record, ctx) };
};
const ids = (result) => result.flags.map((f) => f.id);

test('first-in: open out of range, missed open, limp', () => {
  const open = check({ hero: 3, holes: { 3: ['7c', '2d'] } }, [[3, 'raise', 2.5]]).result;
  assert.deepEqual(open.flags, [{
    id: 'PF_OPEN_OUT_OF_RANGE', data: { hand: '72o', position: 'LJ', depthBand: 'mid', chartFreq: 0 },
  }]);
  assert.equal(open.evLossBb, 0.4);
  assert.equal(open.best, 'fold');
  assert.deepEqual(open.chart, { position: 'LJ', band: 'mid', action: 'open', freq: 0 });

  const fold = check({ hero: 3, holes: { 3: ['Ac', 'Ad'] } }, [[3, 'fold']]).result;
  assert.deepEqual(ids(fold), ['PF_MISSED_OPEN']);
  assert.equal(fold.flags[0].data.chartFreq, 1);
  assert.equal(fold.evLossBb, 0.3);
  assert.equal(fold.best, 'raise');

  const limp = check({ hero: 3, holes: { 3: ['Tc', '9c'] } }, [[3, 'call']]).result;
  assert.deepEqual(limp.flags, [{ id: 'PF_OPEN_LIMP', data: { hand: 'T9s', position: 'LJ', depthBand: 'mid' } }]);
  assert.equal(limp.evLossBb, 0.3);

  const inRange = check({ hero: 3, holes: { 3: ['Ks', 'Jd'] } }, [[3, 'raise', 2.5]]).result;
  assert.deepEqual(inRange.flags, []);
  assert.equal(inRange.evLossBb, 0);
});

test('the SB may limp its open range; limping outside it is flagged', () => {
  const folds = [[3, 'fold'], [4, 'fold'], [5, 'fold'], [0, 'fold']];
  const ok = check({ hero: 1, holes: { 1: ['Kc', '5d'] } }, [...folds, [1, 'call']]).result;
  assert.deepEqual(ok.flags, []);
  assert.equal(ok.evLossBb, 0);
  const bad = check({ hero: 1, holes: { 1: ['Jc', '4d'] } }, [...folds, [1, 'call']]).result;
  assert.deepEqual(ids(bad), ['PF_OPEN_LIMP']);
});

test('facing one raise: call out of range, missed 3-bet, 3-bet out of range, fold in range', () => {
  const toBb = [[3, 'fold'], [4, 'fold'], [5, 'fold'], [0, 'raise', 2.5], [1, 'fold']];
  const call = check({ hero: 2, holes: { 2: ['7c', '2d'] } }, [...toBb, [2, 'call']]).result;
  assert.deepEqual(call.flags, [{
    id: 'PF_CALL_OUT_OF_RANGE',
    data: { hand: '72o', position: 'BB', depthBand: 'mid', vsPosition: 'BTN', raiseToBb: 2.5, chartFreq: 0 },
  }]);
  assert.equal(call.evLossBb, 0.6);
  assert.deepEqual(call.chart, { position: 'BB', band: 'mid', action: 'call', freq: 0 });

  const fold = check({ hero: 2, holes: { 2: ['Ac', '9c'] } }, [...toBb, [2, 'fold']]).result;
  assert.deepEqual(fold.flags, [{
    id: 'PF_FOLD_IN_RANGE',
    data: { hand: 'A9s', position: 'BB', depthBand: 'mid', vsPosition: 'BTN', callFreq: 1, threeBetFreq: 0 },
  }]);
  assert.equal(fold.evLossBb, 1);
  assert.equal(fold.best, 'call');

  // CO facing an LJ open.
  const toCo = [[3, 'raise', 2.5], [4, 'fold']];
  const flat = check({ hero: 5, holes: { 5: ['Ac', 'Ad'] } }, [...toCo, [5, 'call']]).result;
  assert.deepEqual(flat.flags, [{
    id: 'PF_MISSED_3BET', data: { hand: 'AA', position: 'CO', depthBand: 'mid', vsPosition: 'LJ', chartFreq: 1 },
  }]);
  assert.equal(flat.evLossBb, 0.4);
  assert.equal(flat.best, 'raise');

  const light = check({ hero: 5, holes: { 5: ['7c', '2d'] } }, [...toCo, [5, 'raise', 7.5]]).result;
  assert.deepEqual(ids(light), ['PF_3BET_OUT_OF_RANGE']);
  assert.equal(light.evLossBb, 0.8);
  assert.deepEqual(light.chart, { position: 'CO', band: 'mid', action: 'threeBet', freq: 0 });

  const good = check({ hero: 5, holes: { 5: ['Tc', '9c'] } }, [...toCo, [5, 'call']]).result;
  assert.deepEqual(good.flags, []);
  assert.equal(good.evLossBb, 0);
});

test('no chart outside first-in and single-raise spots (limped pots, facing a 3-bet)', () => {
  const limped = check({ hero: 4, holes: { 4: ['Ac', 'Kd'] } }, [[3, 'call'], [4, 'raise', 4]]);
  assert.equal(limped.result, null);
  assert.equal(limped.size, null, '4bb over one limper is inside 3–4bb');
  const threeBet = check({ hero: 3, holes: { 3: ['Ac', 'Kd'] } },
    [[3, 'raise', 2.5], [4, 'raise', 8], [5, 'fold'], [0, 'fold'], [1, 'fold'], [2, 'fold'], [3, 'call']], 1);
  assert.equal(threeBet.result, null);
});

test('open size: 2–3bb, +1 per limper, SB 2.5–3.5', () => {
  const big = check({ hero: 3, holes: { 3: ['Ac', 'Kd'] } }, [[3, 'raise', 5]]).size;
  assert.deepEqual(big, { sizeBb: 5, recommendedBb: [2, 3], position: 'LJ', limpers: 0 });
  assert.equal(check({ hero: 3 }, [[3, 'raise', 3]]).size, null);
  const iso = check({ hero: 4 }, [[3, 'call'], [4, 'raise', 2.5]]).size;
  assert.deepEqual(iso, { sizeBb: 2.5, recommendedBb: [3, 4], position: 'HJ', limpers: 1 });
  const folds = [[3, 'fold'], [4, 'fold'], [5, 'fold'], [0, 'fold']];
  assert.equal(check({ hero: 1 }, [...folds, [1, 'raise', 3.5]]).size, null);
  assert.deepEqual(check({ hero: 1 }, [...folds, [1, 'raise', 2]]).size.recommendedBb, [2.5, 3.5]);
  // An all-in isn't an open size.
  assert.equal(check({ hero: 3, stacksBb: 20 }, [[3, 'raise', 20]]).size, null);
});

test('depth bands: ≤40 short, ≤100 mid, deeper is deep', () => {
  assert.equal(depthBand(40), 'short');
  assert.equal(depthBand(40.5), 'mid');
  assert.equal(depthBand(100), 'mid');
  assert.equal(depthBand(101), 'deep');
});

// Straddled 6-max, button 0: SB 1, BB 2, straddle 3, then HJ 4, CO 5, BTN 0.
const STRADDLE = { straddleSeat: 3 };

test('straddle roles: straddler uses the BB row, the real BB the SB row, the SB keeps its row', () => {
  const { record } = check({ hero: 4, ...STRADDLE }, [[4, 'fold']]);
  assert.equal(chartRole(record, 3), 'BB');
  assert.equal(chartRole(record, 2), 'SB');
  assert.equal(chartRole(record, 1), 'SB');
  assert.equal(chartRole(record, 4), 'HJ');

  // Folded to the real BB, which opens from the SB row.
  const toBb = [[4, 'fold'], [5, 'fold'], [0, 'fold'], [1, 'fold']];
  const bb = check({ hero: 2, ...STRADDLE, holes: { 2: ['7c', '2d'] } }, [...toBb, [2, 'raise', 6]]);
  assert.deepEqual(bb.result.flags, [{
    id: 'PF_OPEN_OUT_OF_RANGE', data: { hand: '72o', position: 'SB', depthBand: 'mid', chartFreq: 0 },
  }]);
  assert.equal(bb.size, null, '6bb is 3 effective blinds, inside the SB row 2.5–3.5');

  // The straddler facing an HJ raise defends from the BB row.
  const straddler = check({ hero: 3, ...STRADDLE, holes: { 3: ['7c', '2d'] } },
    [[4, 'raise', 5], [5, 'fold'], [0, 'fold'], [1, 'fold'], [2, 'fold'], [3, 'call']]);
  assert.deepEqual(straddler.result.flags, [{
    id: 'PF_CALL_OUT_OF_RANGE',
    data: { hand: '72o', position: 'BB', depthBand: 'mid', vsPosition: 'HJ', raiseToBb: 5, chartFreq: 0 },
  }]);

  // A raise by the straddler reads as a BB-row raise for whoever faces it.
  const vsStraddler = check({ hero: 4, ...STRADDLE, holes: { 4: ['Ac', '9c'] } },
    [[4, 'call'], [5, 'fold'], [0, 'fold'], [1, 'fold'], [2, 'fold'], [3, 'raise', 10], [4, 'fold']], 1);
  assert.deepEqual(vsStraddler.result.flags.map((f) => [f.id, f.data.vsPosition]), [['PF_FOLD_IN_RANGE', 'BB']]);
});

test('straddle: sizes and depth are read in effective blinds', () => {
  const small = check({ hero: 4, ...STRADDLE }, [[4, 'raise', 4]]).size;
  assert.deepEqual(small, null, '4bb over a straddle is a 2-blind open');
  const big = check({ hero: 4, ...STRADDLE }, [[4, 'raise', 8]]).size;
  assert.deepEqual(big, { sizeBb: 8, recommendedBb: [4, 6], position: 'HJ', limpers: 0 });
  const iso = check({ hero: 5, ...STRADDLE }, [[4, 'call'], [5, 'raise', 7]]).size;
  assert.equal(iso, null, '7bb over a limped straddle is 3.5 blinds, inside 3–4');

  // 150bb stacks: 75 effective blinds (mid) with a straddle, deep without. SB K5o opens 100% mid, 90% deep.
  const folds = [[4, 'fold'], [5, 'fold'], [0, 'fold']];
  const straddled = check({ hero: 1, stacksBb: 150, ...STRADDLE, holes: { 1: ['Kc', '5d'] } }, [...folds, [1, 'raise', 6]]);
  assert.deepEqual(straddled.result.chart, { position: 'SB', band: 'mid', action: 'open', freq: 1 });
  const plain = check({ hero: 1, stacksBb: 150, holes: { 1: ['Kc', '5d'] } },
    [[3, 'fold'], [4, 'fold'], [5, 'fold'], [0, 'fold'], [1, 'raise', 3]]);
  assert.deepEqual(plain.result.chart, { position: 'SB', band: 'deep', action: 'open', freq: 0.9 });
});

test('holding a live bounty: no out-of-range flags or chart cost for playing it', () => {
  const open = check({ hero: 3, holes: { 3: ['7c', '2d'] } }, [[3, 'raise', 2.5]], 0, true).result;
  assert.deepEqual(open.flags, []);
  assert.equal(open.evLossBb, 0);
  const toBb = [[3, 'fold'], [4, 'fold'], [5, 'fold'], [0, 'raise', 2.5], [1, 'fold']];
  const call = check({ hero: 2, holes: { 2: ['7c', '2d'] } }, [...toBb, [2, 'call']], 0, true).result;
  assert.deepEqual(call.flags, []);
  assert.equal(call.evLossBb, 0);
  const light = check({ hero: 2, holes: { 2: ['7c', '2d'] } }, [...toBb, [2, 'raise', 10]], 0, true).result;
  assert.deepEqual(light.flags, []);
  // Limping outside the SB is still a leak, bounty or not.
  const limp = check({ hero: 3, holes: { 3: ['7c', '2d'] } }, [[3, 'call']], 0, true).result;
  assert.deepEqual(ids(limp), ['PF_OPEN_LIMP']);
  assert.equal(limp.evLossBb, 0.3);
});
