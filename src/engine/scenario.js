// Random table scenario (SPEC §4).
import {
  STAKES, TIERS, CHIPS_PER_BB, MIN_PLAYERS, MAX_PLAYERS, MIN_STACK_BB, MAX_STACK_BB,
} from '../shared/schemas.js';
import { createRng, randInt } from './rng.js';

/**
 * Normalize a tier-weight object to sum to 1. Negative or missing weights count as 0.
 * Falls back to `fallback` when every weight is 0.
 */
export function normalizePool(pool, fallback) {
  const weights = TIERS.map((t) => Math.max(0, Number(pool?.[t]) || 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return fallback ? normalizePool(fallback) : null;
  return Object.fromEntries(TIERS.map((t, i) => [t, weights[i] / sum]));
}

function sampleTier(pool, rng) {
  let x = rng();
  for (const t of TIERS) {
    x -= pool[t];
    if (x < 0) return t;
  }
  return TIERS[TIERS.length - 1];
}

/**
 * @param {{stakes: import('../shared/schemas.js').StakesId, poolOverride?: Object, seed?: number,
 *          createdAt: number}} opts  createdAt is ms since epoch (the caller reads the clock, not the engine).
 * @param {import('../shared/schemas.js').Rng} [rng] defaults to createRng(seed)
 * @returns {import('../shared/schemas.js').ScenarioConfig}
 */
export function createScenario({ stakes, poolOverride, seed, createdAt }, rng) {
  if (!STAKES[stakes]) throw new RangeError(`Unknown stakes: ${stakes}`);
  if (seed === undefined && !rng) throw new TypeError('createScenario needs a seed or an rng');
  if (!isValidCreatedAt(createdAt)) throw new TypeError('createScenario needs createdAt (ms since epoch)');
  rng = rng ?? createRng(seed);
  if (seed === undefined) seed = Math.floor(rng() * 4294967296);
  const pool = normalizePool(poolOverride ?? STAKES[stakes].pool, STAKES[stakes].pool);

  const numPlayers = randInt(rng, MIN_PLAYERS, MAX_PLAYERS);
  const buttonSeat = randInt(rng, 0, numPlayers - 1);
  const heroSeat = randInt(rng, 0, numPlayers - 1);
  const seats = [];
  for (let seat = 0; seat < numPlayers; seat++) {
    const isHero = seat === heroSeat;
    seats.push({
      seat,
      isHero,
      stack: randInt(rng, MIN_STACK_BB, MAX_STACK_BB) * CHIPS_PER_BB,
      tier: isHero ? null : sampleTier(pool, rng),
      profile: null,
    });
  }
  return { seed, createdAt, stakes, numPlayers, buttonSeat, heroSeat, seats };
}

/** createdAt must be a non-negative integer millisecond timestamp. */
export function isValidCreatedAt(createdAt) {
  return Number.isSafeInteger(createdAt) && createdAt >= 0;
}
