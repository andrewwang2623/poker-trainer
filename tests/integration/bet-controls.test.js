import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBetBb, potPercent, presetTarget } from '../../src/ui/controls.js';

const state = {
  heroSeat: 0, potCollected: 600,
  players: [{ committedStreet: 100 }, { committedStreet: 300 }],
};

test('bet presets size from the current pot and clamp to legal limits', () => {
  const legal = { toCall: 0, minTo: 200, maxTo: 800 };
  assert.equal(presetTarget(state, legal, 1 / 3), 433);
  assert.equal(presetTarget(state, legal, 2 / 3), 767);
  assert.equal(presetTarget(state, legal, 1), 800);
  assert.equal(potPercent(state, legal, 600), 50);
});

test('raise percentages use the pot after calling and exclude the call', () => {
  const legal = { toCall: 200, minTo: 500, maxTo: 3000 };
  assert.equal(presetTarget(state, legal, 0.5), 900);
  assert.equal(potPercent(state, legal, 900), 50);
  assert.equal(potPercent(state, legal, 1500), 100);
});

test('typed bb amounts retain chip precision and reject incomplete values', () => {
  assert.equal(parseBetBb(' 12.34 '), 1234);
  assert.equal(parseBetBb('2'), 200);
  for (const value of ['', '1.', '1.234', '-2', 'Infinity', '1e3']) {
    assert.equal(parseBetBb(value), null, value);
  }
});
