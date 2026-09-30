import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateProfitability } from '../../src/tracker/profitability.js';
import { STAKES, PROFITABILITY_DISCLAIMER } from '../../src/shared/schemas.js';

function stats(changes = {}) {
  return { stakes: 'micro', hands: 3000, coachedHands: 3000, evLossPer100: 0, rakePer100: 0,
    evAdjBbPer100: 10, evAdjCi95: [5, 15],
    ...Object.fromEntries(Object.entries(STAKES.micro.winningRanges).map(([key, [lo, hi]]) => [key, (lo + hi) / 2])),
    opportunities: { vpip: 3000, threeBet: 300, cbet: 300, foldToCbet: 300, wtsd: 300, wsd: 300 }, ...changes };
}

test('profitability implements weighting, inclusive verdict thresholds and confidence', () => {
  const winning = estimateProfitability(stats());
  assert.equal(winning.modelBbPer100, 10); assert.equal(winning.estimateBbPer100, 10);
  assert.equal(winning.observedWeight, .5); assert.equal(winning.confidence, 'high');
  assert.equal(winning.disclaimer, PROFITABILITY_DISCLAIMER);
  for (const [value, verdict] of [[-2.5, 'likely_losing'], [2.5, 'likely_winning'], [0, 'break_even']]) {
    const result = estimateProfitability(stats({ evAdjBbPer100: value }), { referenceWinrate: value });
    assert.equal(result.verdict, verdict);
  }
  assert.equal(estimateProfitability(stats({ hands: 299 })).confidence, 'low');
  assert.equal(estimateProfitability(stats({ hands: 300 })).confidence, 'medium');
  assert.equal(estimateProfitability(stats({ evAdjCi95: [-20, 10] })).confidence, 'low');
  assert.equal(estimateProfitability(stats({ evAdjBbPer100: -10, evAdjCi95: [-15, -5] }), { referenceWinrate: -10 }).confidence, 'high');
});

test('deviation penalty needs thirty opportunities, scales, and caps per stat and total', () => {
  const base = stats({ hands: 0, vpip: .38, pfr: .22, opportunities: { vpip: 29 } });
  assert.equal(estimateProfitability(base).modelBbPer100, 10);
  const over = { ...base, opportunities: { vpip: 30 } };
  assert.ok(Math.abs(estimateProfitability(over).modelBbPer100 - 8) < 1e-9);
  assert.equal(estimateProfitability({ ...over, vpip: 1 }).modelBbPer100, 7);
  const all = stats(Object.fromEntries(Object.keys(STAKES.micro.winningRanges).map(key => [key, 10])));
  assert.equal(estimateProfitability(all, { opportunities: { af: 30 } }).modelBbPer100, 0);
  const af = stats({ af: 10 });
  assert.equal(estimateProfitability(af, { opportunities: { af: 29 } }).modelBbPer100, 10);
  assert.equal(estimateProfitability(af, { opportunities: { af: 30 } }).modelBbPer100, 7);
});

test('no coach supplies a reason and does not infer coaching losses', () => {
  const result = estimateProfitability(stats({ coachedHands: 0, evLossPer100: 0, rakePer100: 3 }));
  assert.equal(result.modelBbPer100, 7);
  assert.match(result.reasons.join(' '), /No coached hands/);
  assert.ok(result.reasons.length <= 4);
});
