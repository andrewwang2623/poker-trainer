// Random table scenario (SPEC §4).
import {
  STAKES, TIERS, CHIPS_PER_BB, MIN_PLAYERS, MAX_PLAYERS, MIN_STACK_BB, MAX_STACK_BB,
  STRADDLE_BB, STRADDLE_RATES, BOUNTY_DEFAULTS, BOUNTY_CARD_RANKS, SUITS,
} from '../shared/schemas.js';
import { createRng, deriveSeed, randInt } from './rng.js';
import { BOUNTY_HAND_TARGETS } from './strength.js';

export { STRADDLE_BB, STRADDLE_RATES };

/** Live straddle size in chips (STRADDLE_BB). A UTG stack at or below this can't straddle. */
export const STRADDLE_CHIPS = STRADDLE_BB * CHIPS_PER_BB;

/** The 24 card-bounty targets: every card ranked 2–7 (BOUNTY_CARD_RANKS). */
export const BOUNTY_CARD_TARGETS = Object.freeze(BOUNTY_CARD_RANKS.flatMap((r) => SUITS.map((s) => r + s)));

export const BOUNTY_PAYS_ON = Object.freeze(['showdownOrFold', 'showdownOnly']);

const NO_STRADDLE = Object.freeze({ enabled: false, heroChance: 0 });

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

/** Draw a tier from a normalized pool. */
export function sampleTier(pool, rng) {
  let x = rng();
  for (const t of TIERS) {
    x -= pool[t];
    if (x < 0) return t;
  }
  return TIERS[TIERS.length - 1];
}

/**
 * @param {{stakes: import('../shared/schemas.js').StakesId, poolOverride?: Object, seed?: number,
 *          createdAt: number, straddle?: {enabled: boolean, heroChance?: number}, bounty?: Object}} opts
 *   createdAt is ms since epoch (the caller reads the clock, not the engine). `straddle` turns live
 *   UTG straddles on (default off); heroChance (0–1) is hero's chance when hero sits UTG. `bounty`
 *   is {hand?, card?, paysOn?} (SPEC §15), each type {enabled, chance, amountBb}; missing parts take
 *   BOUNTY_DEFAULTS, so every type is off unless enabled.
 * @param {import('../shared/schemas.js').Rng} [rng] defaults to createRng(seed)
 * @returns {import('../shared/schemas.js').ScenarioConfig}
 */
export function createScenario({ stakes, poolOverride, seed, createdAt, straddle = NO_STRADDLE, bounty }, rng) {
  if (!STAKES[stakes]) throw new RangeError(`Unknown stakes: ${stakes}`);
  if (seed === undefined && !rng) throw new TypeError('createScenario needs a seed or an rng');
  if (!isValidCreatedAt(createdAt)) throw new TypeError('createScenario needs createdAt (ms since epoch)');
  straddle = normalizeStraddleOption(straddle);
  bounty = normalizeBountyOption(bounty);
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
  const scenario = { seed, createdAt, stakes, numPlayers, buttonSeat, heroSeat, seats };
  scenario.straddleSeat = chooseStraddleSeat(scenario, straddle);
  scenario.bounties = drawBounties(seed, bounty);
  return scenario;
}

/**
 * The first seat after the BB (the seat that may straddle), or null heads-up.
 * @param {number} numPlayers
 * @param {number} buttonSeat
 */
export function straddlePosition(numPlayers, buttonSeat) {
  return numPlayers >= 3 ? (buttonSeat + 3) % numPlayers : null;
}

/**
 * Validate the straddle option: {enabled: boolean, heroChance?: number in [0, 1]}.
 * @returns {{enabled: boolean, heroChance: number}}
 */
export function normalizeStraddleOption(straddle) {
  if (straddle === undefined || straddle === null) return NO_STRADDLE;
  if (typeof straddle !== 'object' || typeof straddle.enabled !== 'boolean') {
    throw new RangeError('straddle must be {enabled: boolean, heroChance?: number}');
  }
  const heroChance = straddle.heroChance ?? 0;
  if (typeof heroChance !== 'number' || !(heroChance >= 0 && heroChance <= 1)) {
    throw new RangeError(`straddle.heroChance must be a number in [0, 1], got ${heroChance}`);
  }
  return { enabled: straddle.enabled, heroChance };
}

/**
 * Decide the straddle for a scenario. With straddles enabled, the UTG seat straddles with hero's
 * `heroChance` if hero sits there, otherwise at its tier's STRADDLE_RATES. The draw comes from
 * createRng(deriveSeed(seed, 'straddle')), so no other stream shifts. Heads-up tables and UTG
 * stacks of 2bb or less never straddle.
 * @param {{seed: number, numPlayers: number, buttonSeat: number, heroSeat: number,
 *          seats: {seat: number, stack: number, tier: string|null}[]}} scenario
 * @param {{enabled: boolean, heroChance?: number}} straddle
 * @returns {number|null}
 */
export function chooseStraddleSeat(scenario, straddle) {
  const { enabled, heroChance } = normalizeStraddleOption(straddle);
  const seat = straddlePosition(scenario.numPlayers, scenario.buttonSeat);
  if (!enabled || seat === null) return null;
  const cfg = scenario.seats.find((s) => s.seat === seat);
  if (!cfg || cfg.stack <= STRADDLE_CHIPS) return null;
  const chance = seat === scenario.heroSeat ? heroChance : (STRADDLE_RATES[cfg.tier] ?? 0);
  if (!(chance > 0)) return null;
  return createRng(deriveSeed(scenario.seed, 'straddle'))() < chance ? seat : null;
}

/**
 * Validate the bounty option and fill gaps from BOUNTY_DEFAULTS. Each type is
 * {enabled: boolean, chance: number in [0, 1], amountBb: number > 0}; paysOn is
 * 'showdownOrFold' or 'showdownOnly'.
 * @returns {{hand: {enabled: boolean, chance: number, amountBb: number},
 *            card: {enabled: boolean, chance: number, amountBb: number}, paysOn: string}}
 */
export function normalizeBountyOption(bounty) {
  if (bounty === undefined || bounty === null) return BOUNTY_DEFAULTS;
  if (typeof bounty !== 'object') throw new RangeError('bounty must be {hand?, card?, paysOn?}');
  const type = (name) => {
    const opt = { ...BOUNTY_DEFAULTS[name], ...(bounty[name] ?? {}) };
    if (typeof opt.enabled !== 'boolean') throw new RangeError(`bounty.${name}.enabled must be a boolean`);
    if (typeof opt.chance !== 'number' || !(opt.chance >= 0 && opt.chance <= 1)) {
      throw new RangeError(`bounty.${name}.chance must be a number in [0, 1], got ${opt.chance}`);
    }
    if (typeof opt.amountBb !== 'number' || !(opt.amountBb > 0) || !Number.isFinite(opt.amountBb)) {
      throw new RangeError(`bounty.${name}.amountBb must be a positive number, got ${opt.amountBb}`);
    }
    return { enabled: opt.enabled, chance: opt.chance, amountBb: opt.amountBb };
  };
  const paysOn = bounty.paysOn ?? BOUNTY_DEFAULTS.paysOn;
  if (!BOUNTY_PAYS_ON.includes(paysOn)) throw new RangeError(`bounty.paysOn must be one of ${BOUNTY_PAYS_ON.join(', ')}`);
  return { hand: type('hand'), card: type('card'), paysOn };
}

/**
 * Draw the live bounties (SPEC §15) from createRng(deriveSeed(seed, 'bounty')): always four draws,
 * hand roll, hand target, card roll, card target, so no other stream shifts and toggling one type
 * never changes the other. Hand targets are uniform over the weakest BOUNTY_HAND_POOL non-pair
 * classes, card targets over the 24 cards ranked 2–7.
 * @param {number} seed
 * @param {Object} [bounty] the createScenario option
 * @returns {import('../shared/schemas.js').Bounty[]} hand first, then card; [] when none
 */
export function drawBounties(seed, bounty) {
  const opt = normalizeBountyOption(bounty);
  const rng = createRng(deriveSeed(seed, 'bounty'));
  const handRoll = rng();
  const handTarget = BOUNTY_HAND_TARGETS[Math.floor(rng() * BOUNTY_HAND_TARGETS.length)];
  const cardRoll = rng();
  const cardTarget = BOUNTY_CARD_TARGETS[Math.floor(rng() * BOUNTY_CARD_TARGETS.length)];
  const bounties = [];
  const live = (t, roll, target) => {
    if (!opt[t].enabled || !(roll < opt[t].chance)) return;
    bounties.push({ type: t, target, amountChips: Math.round(opt[t].amountBb * CHIPS_PER_BB), paysOn: opt.paysOn });
  };
  live('hand', handRoll, handTarget);
  live('card', cardRoll, cardTarget);
  return bounties;
}

/** createdAt must be a non-negative integer millisecond timestamp. */
export function isValidCreatedAt(createdAt) {
  return Number.isSafeInteger(createdAt) && createdAt >= 0;
}
