import assert from 'node:assert/strict';
import { createHand, applyAction, getLegalActions } from '../../src/engine/index.js';

export function hand({ stacks = [10000, 10000], button = 0, hero = 0, stakes = 'micro', straddleSeat = null, cards } = {}) {
  return createHand({
    seed: 41, createdAt: 1790000000000, stakes, numPlayers: stacks.length,
    buttonSeat: button, heroSeat: hero, straddleSeat,
    seats: stacks.map((stack, seat) => ({ seat, stack, isHero: seat === hero,
      tier: seat === hero ? null : 'fish', profile: null })),
  }, cards ? { cards } : undefined);
}

export function act(state, type, amount) {
  const before = structuredClone(state);
  const next = applyAction(state, amount === undefined ? { type } : { type, amount });
  assert.deepEqual(state, before, 'SPEC §2: applying an action preserves its input');
  return next;
}

export function passiveUntil(state, street = 'complete') {
  for (let count = 0; state.street !== street; count++) {
    assert.ok(count < 50 && state.street !== 'complete', `must reach ${street}`);
    state = act(state, getLegalActions(state).toCall ? 'call' : 'check');
  }
  return state;
}

export const events = (state, type) => state.events.filter(event => event.type === type);

export function accounting(state) {
  assert.equal(state.street, 'complete');
  const sum = xs => xs.reduce((a, b) => a + b, 0);
  const paid = sum(events(state, 'postBlind').map(e => e.amount))
    + sum(events(state, 'action').map(e => e.amount))
    - sum(events(state, 'uncalled').map(e => e.amount));
  const pots = sum(state.result.pots.map(p => p.amount));
  assert.equal(pots + state.result.rakeChips, paid, 'SPEC §3: contributions = pots + rake');
  assert.equal(sum(events(state, 'award').map(e => e.amount)), pots);
  assert.equal(sum(state.result.netChips) + state.result.rakeChips, 0);
  for (const player of state.players) {
    assert.ok(Number.isInteger(player.stack) && player.stack >= 0);
    assert.equal(player.stack - player.startStack, state.result.netChips[player.seat]);
  }
}
