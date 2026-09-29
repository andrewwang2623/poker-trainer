import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoardReveal } from '../../src/ui/table.js';

test('community cards reveal in sequence without replaying on table redraws', () => {
  let time = 0;
  const reveal = createBoardReveal(() => time);
  const state = { handId: 'one', board: [] };
  assert.deepEqual(reveal(state), []);
  state.board = ['As', '7d', '2c'];
  assert.deepEqual(reveal(state), [0, 160, 320]);
  time = 200;
  assert.deepEqual(reveal(state), [-200, -40, 120]);
  time = 700;
  assert.deepEqual(reveal(state), [null, null, null]);
  state.board.push('9s');
  assert.deepEqual(reveal(state), [null, null, null, 0]);
  time = 1100;
  state.board.push('3h');
  assert.deepEqual(reveal(state), [null, null, null, null, 0]);
  assert.deepEqual(reveal({ handId: 'two', board: ['As', '7d', '2c'] }), [0, 160, 320]);
});
