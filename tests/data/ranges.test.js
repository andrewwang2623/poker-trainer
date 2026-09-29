import test from 'node:test';
import assert from 'node:assert/strict';
import { CHART_ACTIONS, DEPTH_BANDS, POSITIONS_BY_SIZE, TIERS } from '../../src/shared/schemas.js';
import { RANGE_CHART, TIER_RANGE_CHARTS, getChartRange, getTierChartRange } from '../../src/data/ranges.js';

const POSITIONS = [...new Set(Object.values(POSITIONS_BY_SIZE).flat())];
const RANKS = '23456789TJQKA';
const HAND_CLASSES = new Set();
for (let high = 0; high < RANKS.length; high++) {
  HAND_CLASSES.add(RANKS[high] + RANKS[high]);
  for (let low = 0; low < high; low++) {
    HAND_CLASSES.add(RANKS[high] + RANKS[low] + 's');
    HAND_CLASSES.add(RANKS[high] + RANKS[low] + 'o');
  }
}

const combinations = hand => hand.length === 2 ? 6 : hand.endsWith('s') ? 4 : 12;
const coverage = range => Object.entries(range).reduce((sum, [hand, freq]) => sum + combinations(hand) * freq, 0) / 1326;

function checkChart(chart) {
  assert.deepEqual(Object.keys(chart).sort(), [...POSITIONS].sort());
  assert.ok(Object.isFrozen(chart));
  for (const position of POSITIONS) {
    assert.deepEqual(Object.keys(chart[position]).sort(), [...DEPTH_BANDS].sort());
    assert.ok(Object.isFrozen(chart[position]));
    for (const band of DEPTH_BANDS) {
      const actions = chart[position][band];
      assert.deepEqual(Object.keys(actions).sort(), [...CHART_ACTIONS].sort());
      assert.ok(Object.isFrozen(actions));
      for (const action of CHART_ACTIONS) {
        const range = actions[action];
        assert.ok(Object.isFrozen(range));
        for (const [hand, frequency] of Object.entries(range)) {
          assert.ok(HAND_CLASSES.has(hand), `${position}/${band}/${action}: invalid ${hand}`);
          assert.ok(Number.isFinite(frequency) && frequency > 0 && frequency <= 1,
            `${position}/${band}/${action}/${hand}: invalid ${frequency}`);
        }
      }
      if (position === 'BB') assert.deepEqual(actions.open, {});
      for (const hand of HAND_CLASSES) {
        assert.ok((actions.call[hand] ?? 0) + (actions.threeBet[hand] ?? 0) <= 1.000001,
          `${position}/${band}/${hand}: responses exceed 100%`);
      }
    }
  }
}

test('base and tier charts cover every position, depth and action with valid frequencies', () => {
  assert.equal(HAND_CLASSES.size, 169);
  checkChart(RANGE_CHART);
  assert.deepEqual(Object.keys(TIER_RANGE_CHARTS).sort(), [...TIERS].sort());
  for (const tier of TIERS) checkChart(TIER_RANGE_CHARTS[tier]);
});

test('base chart has plausible positional and depth structure', () => {
  assert.equal(getChartRange('UTG', 'mid', 'open').AA, 1);
  assert.equal(getChartRange('UTG', 'mid', 'open')['72o'] ?? 0, 0);
  assert.equal(getChartRange('BTN', 'mid', 'open').A2o, 1);
  assert.equal(Object.keys(getChartRange('BB', 'mid', 'open')).length, 0);
  const order = ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB'];
  for (let index = 1; index < order.length; index++) {
    assert.ok(coverage(getChartRange(order[index], 'mid', 'open')) >
      coverage(getChartRange(order[index - 1], 'mid', 'open')));
  }
  assert.ok(coverage(getChartRange('UTG', 'mid', 'open')) >= 0.08);
  assert.ok(coverage(getChartRange('UTG', 'mid', 'open')) <= 0.15);
  assert.ok(coverage(getChartRange('BTN', 'mid', 'open')) >= 0.38);
  assert.ok(coverage(getChartRange('BTN', 'mid', 'open')) <= 0.55);
  assert.ok(coverage(getChartRange('BB', 'mid', 'call')) >= 0.25);
  assert.ok(coverage(getChartRange('BB', 'mid', 'call')) <= 0.5);
  assert.ok((getChartRange('UTG', 'deep', 'call').A2s ?? 0) >
    (getChartRange('UTG', 'short', 'call').A2s ?? 0));
  assert.ok((getChartRange('UTG', 'short', 'threeBet').AQs ?? 0) >
    (getChartRange('UTG', 'mid', 'threeBet').AQs ?? 0));
});

test('fish call and open wider but 3-bet less; low-stakes regs are tighter', () => {
  for (const position of ['UTG', 'CO', 'BTN', 'SB']) {
    for (const band of DEPTH_BANDS) {
      const base = RANGE_CHART[position][band];
      const fish = TIER_RANGE_CHARTS.fish[position][band];
      const lowReg = TIER_RANGE_CHARTS.lowReg[position][band];
      assert.ok(coverage(fish.open) > coverage(base.open), `${position}/${band} fish open`);
      assert.ok(coverage(fish.call) > coverage(base.call), `${position}/${band} fish call`);
      assert.ok(coverage(fish.threeBet) < coverage(base.threeBet), `${position}/${band} fish 3-bet`);
      assert.ok(coverage(lowReg.open) < coverage(base.open), `${position}/${band} reg open`);
      assert.ok(coverage(lowReg.call) < coverage(base.call), `${position}/${band} reg call`);
      assert.ok(coverage(lowReg.threeBet) < coverage(base.threeBet), `${position}/${band} reg 3-bet`);
    }
  }
  assert.equal(getTierChartRange('toughReg', 'BTN', 'mid', 'open'), getChartRange('BTN', 'mid', 'open'));
  assert.equal(getTierChartRange('fish', 'BTN', 'mid', 'call'), TIER_RANGE_CHARTS.fish.BTN.mid.call);
});

test('chart access rejects unknown keys', () => {
  assert.throws(() => getChartRange('MP', 'mid', 'open'), RangeError);
  assert.throws(() => getChartRange('BTN', 'ultra', 'open'), RangeError);
  assert.throws(() => getChartRange('BTN', 'mid', 'limp'), RangeError);
  assert.throws(() => getTierChartRange('pro', 'BTN', 'mid', 'open'), RangeError);
});
