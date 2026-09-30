// Hand fixtures for coach tests (not a test file): real engine hands from preset cards and
// scripted actions, so records match exactly what the app produces.
import assert from 'node:assert/strict';
import {
  createHand, applyAction, getLegalActions, isComplete, buildHandRecord, createRng, deriveSeed,
} from '../../src/engine/index.js';

const T0 = 1790000000000;

/** Fixed bot profiles (no sampling), so ranges and fold estimates are predictable. */
const base = {
  avatar: { color: '#888', initials: 'XX' }, skill: 0.5, usesCharts: false, textureSizing: false,
  mixing: false, exploitsHero: false,
};
export const PROFILES = Object.freeze({
  fish: { ...base, id: 'fish', name: 'Fish', tier: 'fish', vpip: 0.5, pfr: 0.1, threeBet: 0.03,
    aggression: 0.9, bluffFreq: 0.1, foldToBet: 0.25 },
  lowReg: { ...base, id: 'low', name: 'Low', tier: 'lowReg', vpip: 0.26, pfr: 0.19, threeBet: 0.06,
    aggression: 2.2, bluffFreq: 0.2, foldToBet: 0.45 },
  toughReg: { ...base, id: 'tough', name: 'Tough', tier: 'toughReg', vpip: 0.24, pfr: 0.2, threeBet: 0.1,
    aggression: 3.2, bluffFreq: 0.34, foldToBet: 0.42, usesCharts: true, textureSizing: true, mixing: true },
  /** Raises AA and KK only (the coach floors pfr at 1% of combos). */
  nit: { ...base, id: 'nit', name: 'Nit', tier: 'midReg', vpip: 0.004, pfr: 0.004, threeBet: 0.004,
    aggression: 3, bluffFreq: 0, foldToBet: 0.4 },
  /** Passive fish: AF 0.8. */
  passive: { ...base, id: 'calling', name: 'Station', tier: 'fish', vpip: 0.55, pfr: 0.06, threeBet: 0.02,
    aggression: 0.8, bluffFreq: 0.05, foldToBet: 0.2 },
});

/**
 * @param {{n?: number, button?: number, hero?: number, stacksBb?: number[]|number, profiles?: Object,
 *   holes?: Object<number, string[]>, board?: string[], straddleSeat?: number|null, bounties?: Object[],
 *   stakes?: string, seed?: number}} opts  profiles: {seat: profile}; unset non-hero seats get lowReg.
 */
export function makeHand({
  n = 6, button = 0, hero = 3, stacksBb = 100, profiles = {}, holes = {}, board = [],
  straddleSeat = null, bounties = [], stakes = 'mid', seed = 7,
} = {}) {
  const stacks = Array.isArray(stacksBb) ? stacksBb : new Array(n).fill(stacksBb);
  return createHand({
    seed, createdAt: T0, stakes, numPlayers: n, buttonSeat: button, heroSeat: hero,
    straddleSeat, bounties,
    seats: stacks.map((bb, seat) => ({
      seat, isHero: seat === hero, stack: Math.round(bb * 100),
      tier: seat === hero ? null : (profiles[seat] ?? PROFILES.lowReg).tier,
      profile: seat === hero ? null : (profiles[seat] ?? PROFILES.lowReg),
    })),
  }, { cards: { holes, board } });
}

/**
 * Apply [seat, type, toBb?] steps (bet/raise amounts are "to" totals in bb), asserting the acting seat.
 * Pass '*' as the seat to auto-play: every remaining seat checks or calls until the hand ends.
 */
export function play(state, steps) {
  for (const [seat, type, toBb] of steps) {
    if (seat === '*') {
      while (!isComplete(state)) {
        const legal = getLegalActions(state);
        state = applyAction(state, { type: legal.types.includes('check') ? 'check' : 'call' });
      }
      continue;
    }
    assert.equal(state.actingSeat, seat, `expected seat ${seat} to act before ${type}, got ${state.actingSeat}`);
    state = applyAction(state, toBb === undefined ? { type } : { type, amount: Math.round(toBb * 100) });
  }
  return state;
}

/** Finish the hand (check/call down) and build its record. */
export function recordOf(state, steps = []) {
  const done = play(state, [...steps, ['*']]);
  return buildHandRecord(done, { sessionId: 'test', timestamp: T0 });
}

export const coachRng = (record) => createRng(deriveSeed(record.seed, 'coach'));

export const flagsAt = (result, index) => result.flags.filter((f) => f.decisionIndex === index);
export const flagIds = (result, index) => flagsAt(result, index).map((f) => f.id);
