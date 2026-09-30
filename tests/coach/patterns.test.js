// Session pattern flags (SPEC §8.3 PAT_*).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPatterns, windowStats, PATTERN_WINDOW } from '../../src/coach/patterns.js';

const NO_FLAGS = {
  vpip: false, pfr: false, threeBetOpp: false, threeBet: false, cbetOpp: false, cbet: false,
  foldToCbetOpp: false, foldToCbet: false, sawFlop: false, wentToShowdown: false, wonAtShowdown: false,
  facedPostflopBet: false, foldedToPostflopBet: false, straddled: false, facedStraddle: false,
  postflopBets: 0, postflopRaises: 0, postflopCalls: 0,
};

/** n records; `pick(i)` returns statFlags overrides (and optional heroNetBb / coach flags) for hand i. */
function records(n, pick = () => ({})) {
  return Array.from({ length: n }, (_, i) => {
    const { heroNetBb = 0, flags = [], ...stat } = pick(i);
    return {
      id: `h${i}`, timestamp: 1790000000000 + i * 1000, stakes: 'micro', heroNetBb,
      statFlags: { ...NO_FLAGS, ...stat }, coach: { flags },
    };
  });
}

/** A solid micro-stakes regular: every stat inside the winning ranges. */
const solid = (i) => ({
  vpip: i % 4 === 0, pfr: i % 5 === 0,
  threeBetOpp: i % 2 === 0, threeBet: i % 28 === 0,
  cbetOpp: i % 3 === 0, cbet: i % 3 === 0 && i % 9 !== 0,
  foldToCbetOpp: i % 3 === 1, foldToCbet: i % 3 === 1 && i % 2 === 0,
  sawFlop: i % 2 === 0, wentToShowdown: i % 14 === 0 || i % 14 === 2, wonAtShowdown: i % 14 === 0,
  postflopBets: i % 2 === 0 ? 1 : 0, postflopRaises: i % 10 === 0 ? 1 : 0, postflopCalls: i % 4 === 0 ? 1 : 0,
});

const byId = (flags, id) => flags.filter((f) => f.id === id);

test('a player inside every winning range gets no pattern flags', () => {
  const recs = records(300, solid);
  const s = windowStats(recs);
  for (const [stat, [lo, hi]] of Object.entries({
    vpip: [0.18, 0.28], pfr: [0.14, 0.22], threeBet: [0.05, 0.09], cbet: [0.5, 0.75], foldToCbet: [0.35, 0.55],
    wtsd: [0.24, 0.32], wsd: [0.5, 0.6], af: [2, 4],
  })) {
    assert.ok(s[stat].value >= lo && s[stat].value <= hi, `${stat} = ${s[stat].value}`);
  }
  assert.deepEqual(detectPatterns(recs, 'micro'), []);
  assert.deepEqual(detectPatterns([], 'micro'), []);
});

test('range patterns: data fields, window, and major beyond one range-width', () => {
  const loose = records(200, (i) => ({ ...solid(i), vpip: i % 3 === 0 }));
  const [flag] = byId(detectPatterns(loose, 'micro'), 'PAT_TOO_LOOSE');
  assert.deepEqual(flag, {
    id: 'PAT_TOO_LOOSE', severity: 'minor', street: null, decisionIndex: null, evLossBb: null, oppTier: null,
    data: { stat: 'vpip', value: 0.335, target: [0.18, 0.28], hands: 200, window: PATTERN_WINDOW },
  });
  const wild = records(200, (i) => ({ ...solid(i), vpip: i % 2 === 0 }));
  assert.equal(byId(detectPatterns(wild, 'micro'), 'PAT_TOO_LOOSE')[0].severity, 'major');

  const tight = records(200, (i) => ({ ...solid(i), vpip: i % 7 === 0, pfr: i % 7 === 0 }));
  assert.equal(byId(detectPatterns(tight, 'micro'), 'PAT_TOO_TIGHT').length, 1);

  const flags = detectPatterns(records(300, (i) => ({
    ...solid(i),
    threeBet: false,
    cbet: false,
    foldToCbet: i % 3 === 1,
    wentToShowdown: i % 2 === 0,
    wonAtShowdown: i % 8 === 0,
    postflopBets: 0, postflopRaises: 0, postflopCalls: 1,
  })), 'micro');
  for (const id of ['PAT_LOW_3BET', 'PAT_LOW_CBET', 'PAT_OVERFOLD_CBET', 'PAT_HIGH_WTSD', 'PAT_LOW_WSD', 'PAT_PASSIVE']) {
    assert.equal(byId(flags, id).length, 1, id);
  }
  assert.deepEqual(byId(flags, 'PAT_PASSIVE')[0].data, { stat: 'af', value: 0, target: [2, 4], hands: 300, window: 500 });

  // Stakes pick the ranges: 3-bet 7% passes at micro (5–9%) but not at high (8–12%).
  const sevenPct = records(400, (i) => ({ ...solid(i), threeBetOpp: true, threeBet: i % 100 < 7 }));
  assert.equal(byId(detectPatterns(sevenPct, 'micro'), 'PAT_LOW_3BET').length, 0);
  assert.equal(byId(detectPatterns(sevenPct, 'high'), 'PAT_LOW_3BET').length, 1);
});

test('patterns need 30 opportunities and use only the last 500 hands', () => {
  // Only 20 3-bet opportunities, all passed on.
  const few = records(200, (i) => ({ ...solid(i), threeBetOpp: i < 20, threeBet: false }));
  assert.equal(byId(detectPatterns(few, 'micro'), 'PAT_LOW_3BET').length, 0);
  assert.deepEqual(detectPatterns(records(29, () => ({ vpip: true })), 'micro'), []);

  // 300 loose hands long ago, then 500 solid ones: nothing to flag. Order of input doesn't matter.
  const history = records(800, (i) => (i < 300 ? { ...solid(i), vpip: true } : solid(i)));
  assert.deepEqual(detectPatterns(history.slice().reverse(), 'micro'), []);
});

test('PAT_LOW_PFR: vpip − pfr above 8pp', () => {
  const calls = records(200, (i) => ({ ...solid(i), vpip: i % 4 === 0, pfr: i % 10 === 0 }));
  const [flag] = byId(detectPatterns(calls, 'micro'), 'PAT_LOW_PFR');
  assert.deepEqual(flag.data, { vpip: 0.25, pfr: 0.1, gap: 0.15, hands: 200, window: 500 });
  assert.equal(flag.severity, 'minor');
});

test('PAT_TILT: VPIP over the 20 hands after a 50bb loss rises 10pp over the hands before', () => {
  const tilt = records(120, (i) => ({
    ...solid(i),
    vpip: i > 80 && i <= 100 ? i % 2 === 0 : i % 4 === 0,
    heroNetBb: i === 80 ? -62.5 : 0,
  }));
  const [flag] = byId(detectPatterns(tilt, 'micro'), 'PAT_TILT');
  assert.equal(flag.data.lossBb, 62.5);
  assert.equal(flag.data.handsAfter, 20);
  assert.equal(flag.data.vpipAfter, 0.5);
  assert.ok(Math.abs(flag.data.vpipBefore - 0.25) < 0.01);
  assert.equal(flag.severity, 'major', 'a 25pp rise is more than one 10pp width over');

  const calm = records(120, (i) => ({ ...solid(i), heroNetBb: i === 80 ? -62.5 : 0 }));
  assert.equal(byId(detectPatterns(calm, 'micro'), 'PAT_TILT').length, 0);
  const small = records(120, (i) => ({
    ...solid(i), vpip: i > 80 && i <= 100 ? i % 2 === 0 : i % 4 === 0, heroNetBb: i === 80 ? -40 : 0,
  }));
  assert.equal(byId(detectPatterns(small, 'micro'), 'PAT_TILT').length, 0, 'loss under 50bb');
});

test('PAT_REPEATED_LEAK: the same hand-level flag 5+ times in the last 100 hands', () => {
  const leak = (id, evLossBb) => ({ id, evLossBb, severity: 'minor' });
  const recs = records(150, (i) => ({
    ...solid(i),
    flags: [
      ...(i >= 50 && i % 20 === 0 ? [leak('EQ_BAD_CALL', 2)] : []), // 5 in the last 100
      ...(i < 50 && i % 5 === 0 ? [leak('EQ_BAD_FOLD', 1)] : []), // only older hands
      ...(i >= 50 && i % 25 === 0 ? [leak('SZ_TOO_SMALL', 0.1)] : []), // 4
    ],
  }));
  const flags = byId(detectPatterns(recs, 'micro'), 'PAT_REPEATED_LEAK');
  assert.deepEqual(flags.map((f) => f.data), [{ flagId: 'EQ_BAD_CALL', count: 5, evLossBb: 10, window: 100 }]);
});

test('exact thresholds: an 8pp VPIP−PFR gap is not PAT_LOW_PFR; a 10pp VPIP rise is PAT_TILT', () => {
  // 7/50 − 3/50 is exactly 0.08 but 0.08000000000000002 in floats.
  const gap = records(50, (i) => ({ ...solid(i), vpip: i < 7, pfr: i < 3 }));
  assert.equal(byId(detectPatterns(gap, 'micro'), 'PAT_LOW_PFR').length, 0);
  const wider = records(50, (i) => ({ ...solid(i), vpip: i < 8, pfr: i < 3 }));
  assert.equal(byId(detectPatterns(wider, 'micro'), 'PAT_LOW_PFR').length, 1);

  // VPIP 16/80 = 20% before the 60bb loss, 6/20 = 30% after: a rise of exactly 10pp.
  const tilt = records(120, (i) => ({
    ...solid(i), vpip: i < 80 ? i % 5 === 0 : i > 80 && i <= 86, heroNetBb: i === 80 ? -60 : 0,
  }));
  const [flag] = byId(detectPatterns(tilt, 'micro'), 'PAT_TILT');
  assert.ok(flag, 'a 10pp rise meets the ≥ 10pp rule');
  assert.deepEqual(flag.data, { lossBb: 60, vpipBefore: 0.2, vpipAfter: 0.3, handsAfter: 20 });
  assert.equal(flag.severity, 'minor');
});
