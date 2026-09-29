// handId format (SPEC §5, §13 item 10), createdAt plumbing, and seed redaction from views.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createHand, getLegalActions, applyAction, getView, isComplete, makeHandId,
} from '../../src/engine/game.js';
import { createScenario } from '../../src/engine/scenario.js';
import { sha256Hex } from '../../src/engine/sha256.js';
import { makeScenario } from './_helpers.js';

const T0 = 1790000000000;
const nodeSha = (text) => createHash('sha256').update(text).digest('hex');

test('sha256Hex matches node:crypto, including multi-block and non-ASCII input', () => {
  const inputs = ['', 'abc', '0', '4294967295', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64),
    'x'.repeat(119), 'x'.repeat(1000), 'pocket ♠♥ aces'];
  for (let i = 0; i < 200; i++) inputs.push(String((i * 2654435761) >>> 0));
  for (const text of inputs) assert.equal(sha256Hex(text), nodeSha(text), JSON.stringify(text));
});

test('handId is base36 createdAt, a dash, and 8 hex chars of SHA-256(seed)', () => {
  for (const seed of [0, 1, 99, 3735928559, 4294967295]) {
    const s = createHand(createScenario({ stakes: 'micro', seed, createdAt: T0 }));
    assert.match(s.handId, /^[0-9a-z]+-[0-9a-f]{8}$/);
    const [time, hash] = s.handId.split('-');
    assert.equal(parseInt(time, 36), T0);
    assert.equal(hash, nodeSha(String(seed)).slice(0, 8));
    assert.equal(s.handId, makeHandId(T0, seed));
  }
});

test('handId does not contain the raw seed in decimal or hex', () => {
  for (let i = 0; i < 500; i++) {
    const seed = (0x9e3779b9 * (i + 1)) >>> 0;
    const id = makeHandId(T0, seed);
    const suffix = id.split('-')[1];
    assert.ok(!id.includes(String(seed)), `${id} contains ${seed}`);
    assert.ok(!suffix.includes(seed.toString(16).padStart(8, '0')), `${id} contains hex ${seed}`);
  }
  // The old format led with the seed's hex; make sure nothing leaks it at a fixed offset.
  const seed = 3735928559; // 0xdeadbeef
  const id = createHand(createScenario({ stakes: 'low', seed, createdAt: T0 })).handId;
  assert.ok(!id.includes('deadbeef') && !id.includes('3735928559'), id);
});

test('same ScenarioConfig gives the same handId; createdAt keeps ids unique when a seed repeats', () => {
  const a = createHand(createScenario({ stakes: 'micro', seed: 7, createdAt: T0 }));
  const b = createHand(createScenario({ stakes: 'micro', seed: 7, createdAt: T0 }));
  const c = createHand(createScenario({ stakes: 'micro', seed: 7, createdAt: T0 + 1 }));
  assert.equal(a.handId, b.handId);
  assert.notEqual(a.handId, c.handId);
  assert.deepEqual({ ...a, handId: null }, { ...c, handId: null }, 'createdAt only affects the id');
});

test('createScenario copies createdAt and requires it; createHand validates it', () => {
  const sc = createScenario({ stakes: 'micro', seed: 3, createdAt: T0 });
  assert.equal(sc.createdAt, T0);
  assert.throws(() => createScenario({ stakes: 'micro', seed: 3 }), TypeError);
  assert.throws(() => createScenario({ stakes: 'micro', seed: 3, createdAt: 1.5 }), TypeError);
  assert.throws(() => createScenario({ stakes: 'micro', seed: 3, createdAt: -1 }), TypeError);
  assert.throws(() => createHand({ ...sc, createdAt: undefined }), TypeError);
  const { createdAt, ...noTime } = makeScenario({ stacks: [10000, 10000] });
  assert.throws(() => createHand(noTime), TypeError);
});

test('no SeatView ever contains the seed, for any seat or street', () => {
  let s = createHand(createScenario({ stakes: 'mid', seed: 31337, createdAt: T0 }));
  const check = () => {
    for (let seat = 0; seat < s.numPlayers; seat++) {
      const view = getView(s, seat);
      assert.equal('seed' in view, false);
      assert.equal('deck' in view, false);
      assert.ok(!JSON.stringify(view).includes('31337'), 'seed value appears nowhere in the view');
    }
  };
  check();
  while (!isComplete(s)) {
    const legal = getLegalActions(s);
    s = applyAction(s, { type: legal.types.includes('check') ? 'check' : 'call' });
    check();
  }
  assert.equal(s.seed, 31337, 'the full GameState keeps the seed');
});
