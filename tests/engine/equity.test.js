import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEquity } from '../../src/engine/equity.js';
import { boardTexture } from '../../src/engine/texture.js';
import { createRng } from '../../src/engine/rng.js';

test('exact enumeration on the flop: AA vs KK', () => {
  const r = computeEquity({ hero: ['As', 'Ah'], board: ['2c', '7d', '9s'], villains: [['Ks', 'Kh']] });
  assert.equal(r.samples, 990); // C(45, 2)
  // KK needs one of 2 kings in 2 cards: 1 - C(43,2)/C(45,2) ≈ 8.8% (minus runner-runner nothing).
  assert.ok(r.equity > 0.9 && r.equity < 0.93, String(r.equity));
});

test('exact enumeration on the turn with a split', () => {
  const r = computeEquity({
    hero: ['2c', '3c'], board: ['Ts', 'Jd', 'Qh', 'Kc'], villains: [['4h', '5h']],
  });
  assert.equal(r.samples, 44);
  // A 2/3 pairs hero (6 outs), a 4/5 pairs villain (6 outs); every other river ties.
  assert.equal(r.win, 6 / 44);
  assert.equal(r.tie, 32 / 44);
  assert.ok(Math.abs(r.equity - 0.5) < 1e-9);
});

test('Monte Carlo preflop AA vs KK ≈ 82%', () => {
  const r = computeEquity({
    hero: ['As', 'Ah'], villains: [['Ks', 'Kh']], iterations: 20000, rng: createRng(3),
  });
  assert.equal(r.samples, 20000);
  assert.ok(Math.abs(r.equity - 0.82) < 0.015, String(r.equity));
});

test('range villains and determinism', () => {
  const opts = { hero: ['As', 'Ks'], villains: [{ QQ: 1, JJ: 1 }], iterations: 5000 };
  const a = computeEquity({ ...opts, rng: createRng(9) });
  const b = computeEquity({ ...opts, rng: createRng(9) });
  assert.deepEqual(a, b);
  assert.ok(a.equity > 0.4 && a.equity < 0.52, String(a.equity));
  assert.throws(() => computeEquity({ hero: ['As', 'Ah'], villains: [{ AA: 1 }], dead: ['Ad', 'Ac'] }), RangeError);
  assert.throws(() => computeEquity({ hero: ['As', 'Ah'], villains: [['As', 'Kd']] }), RangeError);
});

test('sampling needs an explicit rng; exact enumeration does not', () => {
  // A hidden shared default stream would give every call the same samples (SPEC §13 item 11).
  assert.throws(() => computeEquity({ hero: ['As', 'Ks'], villains: [{ QQ: 1 }] }), TypeError);
  assert.throws(() => computeEquity({ hero: ['As', 'Ks'], villains: [['Qd', 'Qc']] }), TypeError);
  const exact = computeEquity({ hero: ['As', 'Ks'], board: ['2c', '7d', '9s'], villains: [['Qd', 'Qc']] });
  assert.equal(exact.samples, 990);
  const a = computeEquity({ hero: ['As', 'Ks'], villains: [{ QQ: 1 }], iterations: 500, rng: createRng(1) });
  const b = computeEquity({ hero: ['As', 'Ks'], villains: [{ QQ: 1 }], iterations: 500, rng: createRng(2) });
  assert.notDeepEqual(a, b, 'different streams give different samples');
});

test('board textures', () => {
  assert.equal(boardTexture([]), null);
  assert.equal(boardTexture(['Ah', '7h', '2h']), 'monotone');
  assert.equal(boardTexture(['Ah', 'Ad', '2c']), 'paired');
  assert.equal(boardTexture(['9h', 'Th', '8c']), 'wet');
  assert.equal(boardTexture(['9h', 'Th', '2c']), 'semiwet');
  assert.equal(boardTexture(['9h', 'Tc', '8d']), 'semiwet');
  assert.equal(boardTexture(['Kh', '7c', '2d']), 'dry');
  assert.equal(boardTexture(['Ah', '2c', '4d']), 'semiwet'); // wheel-connected
});
