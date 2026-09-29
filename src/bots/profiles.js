// Bot tiers (SPEC §7): parameter ranges sampled uniformly per bot, plus names and avatars.
// midReg plays the standard charts without mixing (owner decision; SPEC §7 table lists the reverse,
// see REQUESTS-claude.md). toughReg is the only tier that mixes.
import { TIERS } from '../shared/schemas.js';

export const TIER_RANGES = Object.freeze({
  fish: {
    vpip: [0.40, 0.65], pfr: [0.05, 0.15], threeBet: [0.02, 0.05], aggression: [0.6, 1.2],
    bluffFreq: [0.05, 0.15], foldToBet: [0.20, 0.35], skill: [0.10, 0.30],
    usesCharts: false, textureSizing: false, mixing: false, exploitsHero: false,
  },
  lowReg: {
    vpip: [0.22, 0.30], pfr: [0.16, 0.22], threeBet: [0.05, 0.08], aggression: [1.8, 2.8],
    bluffFreq: [0.15, 0.25], foldToBet: [0.40, 0.50], skill: [0.40, 0.55],
    usesCharts: false, textureSizing: false, mixing: false, exploitsHero: false,
  },
  midReg: {
    vpip: [0.20, 0.26], pfr: [0.17, 0.22], threeBet: [0.07, 0.10], aggression: [2.5, 3.2],
    bluffFreq: [0.25, 0.33], foldToBet: [0.40, 0.48], skill: [0.60, 0.75],
    usesCharts: true, textureSizing: true, mixing: false, exploitsHero: false,
  },
  toughReg: {
    vpip: [0.21, 0.26], pfr: [0.18, 0.23], threeBet: [0.08, 0.12], aggression: [2.8, 3.5],
    bluffFreq: [0.30, 0.38], foldToBet: [0.38, 0.45], skill: [0.85, 0.95],
    usesCharts: true, textureSizing: true, mixing: true, exploitsHero: true,
  },
});

const NUMERIC_FIELDS = ['vpip', 'pfr', 'threeBet', 'aggression', 'bluffFreq', 'foldToBet', 'skill'];
const FLAG_FIELDS = ['usesCharts', 'textureSizing', 'mixing', 'exploitsHero'];

export const BOT_NAMES = Object.freeze([
  'Mika', 'Theo', 'Rosa', 'Jonas', 'Priya', 'Oskar', 'Lena', 'Diego', 'Hana', 'Felix',
  'Nora', 'Marco', 'Ines', 'Kofi', 'Yuki', 'Anton', 'Sofia', 'Ravi', 'Elsa', 'Tariq',
  'Maya', 'Lars', 'Chloe', 'Emeka', 'Greta', 'Hugo', 'Leila', 'Pavel', 'Zara', 'Bruno',
  'Aiko', 'Omar', 'Vera', 'Nils', 'Carmen', 'Idris', 'Petra', 'Sami', 'Wren', 'Iris',
]);

const TIER_COLORS = Object.freeze({
  fish: ['#4caf50', '#66bb6a', '#26a69a', '#8bc34a'],
  lowReg: ['#42a5f5', '#5c6bc0', '#29b6f6', '#7986cb'],
  midReg: ['#ffa726', '#ff7043', '#ffca28', '#f4a261'],
  toughReg: ['#ab47bc', '#ec407a', '#7e57c2', '#e53935'],
});

const round3 = (x) => Math.round(x * 1000) / 1000;
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

/**
 * @param {import('../shared/schemas.js').Tier} tier
 * @param {import('../shared/schemas.js').Rng} rng
 * @returns {import('../shared/schemas.js').BotProfile}
 */
export function createBotProfile(tier, rng) {
  if (!TIERS.includes(tier)) throw new RangeError(`Unknown tier: ${tier}`);
  if (typeof rng !== 'function') throw new TypeError('createBotProfile needs an rng');
  const ranges = TIER_RANGES[tier];
  const name = pick(BOT_NAMES, rng);
  const profile = {
    id: `bot-${Math.floor(rng() * 4294967296).toString(16).padStart(8, '0')}`,
    name,
    tier,
    avatar: { color: pick(TIER_COLORS[tier], rng), initials: name.slice(0, 2).toUpperCase() },
  };
  for (const f of NUMERIC_FIELDS) {
    const [lo, hi] = ranges[f];
    profile[f] = round3(lo + rng() * (hi - lo));
  }
  // Keep pfr ≤ vpip and threeBet ≤ pfr even where the tier ranges overlap.
  profile.pfr = Math.min(profile.pfr, profile.vpip);
  profile.threeBet = Math.min(profile.threeBet, profile.pfr);
  for (const f of FLAG_FIELDS) profile[f] = ranges[f];
  return profile;
}
