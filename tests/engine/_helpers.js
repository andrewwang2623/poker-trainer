// Shared test helpers (not a test file).
import assert from 'node:assert/strict';
import { applyAction } from '../../src/engine/game.js';

/** Build a ScenarioConfig with explicit chip stacks. */
export function makeScenario({ stakes = 'micro', stacks, button = 0, hero = 0, seed = 1, createdAt = 1790000000000 }) {
  return {
    seed,
    createdAt,
    stakes,
    numPlayers: stacks.length,
    buttonSeat: button,
    heroSeat: hero,
    seats: stacks.map((stack, seat) => ({
      seat, isHero: seat === hero, stack, tier: seat === hero ? null : 'fish', profile: null,
    })),
  };
}

/** Apply [seat, type, amount?] steps, asserting the expected seat is to act before each one. */
export function play(state, steps) {
  for (const [seat, type, amount] of steps) {
    assert.equal(state.actingSeat, seat, `expected seat ${seat} to act before ${type}, got ${state.actingSeat}`);
    state = applyAction(state, amount === undefined ? { type } : { type, amount });
  }
  return state;
}

export const eventsOf = (state, type) => state.events.filter((e) => e.type === type);

export function assertConserved(state) {
  const r = state.result;
  assert.ok(r, 'hand has a result');
  const net = r.netChips.reduce((a, b) => a + b, 0);
  assert.equal(net + r.rakeChips, 0, 'Σ netChips + rake = 0');
  const awarded = eventsOf(state, 'award').reduce((a, e) => a + e.amount, 0);
  const pots = r.pots.reduce((a, p) => a + p.amount, 0);
  assert.equal(awarded, pots, 'awards equal pot amounts');
  for (const p of state.players) assert.ok(p.stack >= 0);
}
