import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAG_IDS, TIERS } from '../../src/shared/schemas.js';
import { explainFlag } from '../../src/explain/index.js';
import { templates } from '../../src/explain/templates.js';

// CoachFlag.data contracts from SPEC §8.3, referenced by schemas.js.
const opening = { hand: 'K9o', position: 'CO', depthBand: 'mid' };
const versus = { ...opening, vsPosition: 'LJ' };
const stat = (name, value, target) => ({ stat: name, value, target, hands: 450, window: 500 });
const data = {
  PF_OPEN_OUT_OF_RANGE: { ...opening, chartFreq: 0.1 },
  PF_MISSED_OPEN: { ...opening, hand: 'AQs', chartFreq: 1 },
  PF_OPEN_LIMP: { ...opening },
  PF_CALL_OUT_OF_RANGE: { ...versus, raiseToBb: 3.5, chartFreq: 0 },
  PF_MISSED_3BET: { ...versus, hand: 'QQ', chartFreq: 0.9 },
  PF_3BET_OUT_OF_RANGE: { ...versus, chartFreq: 0.1 },
  PF_FOLD_IN_RANGE: { ...versus, hand: 'AQs', callFreq: 0.6, threeBetFreq: 0.4 },
  PF_OPEN_SIZE: { sizeBb: 6, recommendedBb: [3, 4], position: 'CO', limpers: 1 },
  EQ_BAD_CALL: { equity: 0.2, requiredEquity: 0.333, toCallBb: 10, potBb: 20 },
  EQ_BAD_FOLD: { equity: 0.5, requiredEquity: 0.25, toCallBb: 5, potBb: 15 },
  EQ_MISSED_VALUE: { equity: 0.8, potBb: 20, bestAction: 'bet:0.75', evGainBb: 3.25 },
  EQ_BAD_BLUFF: { equity: 0.1, foldEstimate: 0.2, sizePct: 0.75, oppVpip: 0.55 },
  SZ_TOO_SMALL: { sizePct: 0.25, recommendedPct: [0.66, 0.8], texture: 'wet' },
  SZ_TOO_LARGE: { sizePct: 0.9, recommendedPct: [0.25, 0.33], texture: 'dry' },
  LN_MISSED_CBET: { texture: 'dry', numOpponents: 2, equity: 0.7 },
  LN_PAYOFF_PASSIVE_RAISE: { oppAggression: 0.8, equity: 0.3, toCallBb: 12.5 },
  PAT_TOO_LOOSE: stat('vpip', 0.4, [0.18, 0.28]),
  PAT_TOO_TIGHT: stat('vpip', 0.1, [0.18, 0.28]),
  PAT_LOW_PFR: { vpip: 0.3, pfr: 0.12, gap: 0.18, hands: 450, window: 500 },
  PAT_LOW_3BET: stat('threeBet', 0.02, [0.05, 0.09]),
  PAT_PASSIVE: stat('af', 0.8, [2, 4]),
  PAT_OVERFOLD_CBET: stat('foldToCbet', 0.7, [0.35, 0.55]),
  PAT_LOW_CBET: stat('cbet', 0.3, [0.5, 0.75]),
  PAT_HIGH_WTSD: stat('wtsd', 0.4, [0.24, 0.32]),
  PAT_LOW_WSD: stat('wsd', 0.35, [0.5, 0.6]),
  PAT_TILT: { lossBb: 60, vpipBefore: 0.2, vpipAfter: 0.4, handsAfter: 20 },
  PAT_REPEATED_LEAK: { flagId: 'EQ_BAD_CALL', count: 7, evLossBb: 12.25, window: 100 },
};

/** @returns {import('../../src/shared/schemas.js').CoachFlag} */
function fixture(id, oppTier = null) {
  const pattern = id.startsWith('PAT_');
  return {
    id, severity: 'minor', street: pattern ? null : id.startsWith('PF_') ? 'preflop' : 'turn',
    decisionIndex: pattern ? null : 2, evLossBb: pattern ? null : 1.5,
    oppTier, data: structuredClone(data[id]),
  };
}

test('fixtures and default templates cover exactly the schema flag IDs', () => {
  assert.deepEqual(Object.keys(data).sort(), [...FLAG_IDS].sort());
  assert.deepEqual(Object.keys(templates).sort(), [...FLAG_IDS].sort());
  for (const id of FLAG_IDS) assert.equal(typeof templates[id].default, 'function', id);
});

for (const id of FLAG_IDS) {
  test(`${id}: renders complete, deterministic explanations for every schema tier`, () => {
    for (const tier of [null, ...TIERS]) {
      const flag = fixture(id, tier);
      const before = structuredClone(flag);
      Object.freeze(flag.data);
      Object.freeze(flag);
      const result = explainFlag(flag);
      assert.deepEqual(Object.keys(result).sort(), ['body', 'tip', 'title']);
      for (const value of Object.values(result)) {
        assert.equal(typeof value, 'string');
        assert.ok(value.trim().length > 0);
        assert.doesNotMatch(value, /undefined|null|NaN|unknown|\[object Object\]|\{[^}]+\}/);
      }
      assert.deepEqual(explainFlag(flag), result);
      assert.deepEqual(flag, before);
    }
  });

  test(`${id}: every data field is used in the explanation`, () => {
    const flag = fixture(id);
    const original = explainFlag(flag).body;
    for (const [key, value] of Object.entries(flag.data)) {
      const replacement = Array.isArray(value) ? value.map(n => n + 0.1)
        : typeof value === 'number' ? value + 1 : `${value}-changed`;
      const updated = { ...flag, data: { ...flag.data, [key]: replacement } };
      assert.notEqual(explainFlag(updated).body, original, `${id}.${key} was not filled`);
    }
  });

  test(`${id}: selects tier groups and pattern defaults`, () => {
    const fallback = explainFlag(fixture(id));
    const fish = explainFlag(fixture(id, 'fish'));
    const reg = explainFlag(fixture(id, 'lowReg'));
    const tough = explainFlag(fixture(id, 'toughReg'));
    assert.deepEqual(explainFlag(fixture(id, 'midReg')), reg);
    assert.deepEqual(explainFlag(fixture(id, 'futureTier')), fallback);
    if (id.startsWith('PAT_')) {
      for (const variant of [fish, reg, tough]) assert.deepEqual(variant, fallback);
    } else {
      assert.equal(new Set([fallback.body, fish.body, reg.body, tough.body]).size, 4);
      assert.equal(new Set([fallback.tip, fish.tip, reg.tip, tough.tip]).size, 4);
    }
  });
}

test('formats prices and equity without confusing chips and bb', () => {
  assert.equal(explainFlag(fixture('EQ_BAD_CALL')).body,
    'Calling 10.0bb into 20.0bb requires 33% equity; your estimated equity is 20%.');
  assert.match(explainFlag(fixture('PF_OPEN_SIZE')).body, /6.0bb.*CO.*1 limpers.*3.0bb–4.0bb/);
  assert.match(explainFlag(fixture('PF_FOLD_IN_RANGE')).body, /AQs.*CO.*mid.*LJ.*60%.*40%/);
  assert.match(explainFlag(fixture('EQ_MISSED_VALUE')).body, /bet at 75% pot.*3.3bb/);
  assert.match(explainFlag(fixture('SZ_TOO_SMALL')).body, /25%.*wet.*66%–80%/);
});

test('formats pattern rates, ratios, percentage-point gaps and windows', () => {
  assert.match(explainFlag(fixture('PAT_PASSIVE')).body, /aggression factor is 0.8.*2.0–4.0.*450 hands.*last 500 hands/);
  assert.match(explainFlag(fixture('PAT_TOO_LOOSE')).body, /40%.*18%–28%/);
  assert.match(explainFlag(fixture('PAT_LOW_PFR')).body, /30%.*12%.*18 percentage points/);
  assert.match(explainFlag(fixture('PAT_TILT')).body, /60.0bb.*20%.*40%.*20 hands/);
  assert.match(explainFlag(fixture('PAT_REPEATED_LEAK')).body, /EQ_BAD_CALL.*7 times.*last 100 hands.*12.3bb/);
  for (const [window, expected] of [['session', 'this session'], ['all', 'all hands']]) {
    const flag = fixture('PAT_TOO_LOOSE');
    flag.data.window = window;
    assert.ok(explainFlag(flag).body.includes(expected));
  }
});

test('preserves zero frequencies and supports all-in action labels', () => {
  assert.match(explainFlag(fixture('PF_CALL_OUT_OF_RANGE')).body, /frequency is 0%/);
  const flag = fixture('EQ_MISSED_VALUE');
  flag.data.bestAction = 'allIn';
  flag.data.evGainBb = 0;
  assert.match(explainFlag(flag).body, /go all-in.*0.0bb/);
});

test('unknown IDs and incomplete data degrade without throwing or prototype lookup', () => {
  for (const id of ['FUTURE_FLAG', 'constructor', 'toString', '__proto__']) {
    assert.equal(explainFlag({ id }).title, 'Coach note');
  }
  assert.equal(explainFlag(null).title, 'Coach note');
  for (const id of FLAG_IDS) {
    assert.doesNotMatch(JSON.stringify(explainFlag({ id, data: {} })), /undefined|NaN|\[object Object\]/);
  }
});
