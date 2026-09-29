// Bet sizing (SPEC §7) and turning an intended action into a legal one.
import { CHIPS_PER_BB } from '../../shared/schemas.js';

const TEXTURE_PCT = Object.freeze({
  dry: [0.25, 0.33], paired: [0.33, 0.33], semiwet: [0.5, 0.5], wet: [0.66, 0.8], monotone: [0.66, 0.8],
});
export const RIVER_POLAR_PCT = Object.freeze([0.75, 1.25]);
export const DEFAULT_PCT = Object.freeze([0.5, 0.75]);

export const texturePct = (texture) => TEXTURE_PCT[texture] ?? DEFAULT_PCT;

const between = ([lo, hi], rng) => lo + (hi - lo) * rng();

/**
 * Postflop bet size as a fraction of the pot.
 * @param {{textureSizing: boolean}} profile
 * @param {{texture: string|null, street: string, polar: boolean}} spot  polar = river nuts or bluff
 */
export function betFraction(profile, { texture, street, polar }, rng) {
  if (street === 'river' && polar) return between(RIVER_POLAR_PCT, rng);
  if (!profile.textureSizing) return between(DEFAULT_PCT, rng);
  return between(texturePct(texture), rng);
}

/** Preflop open or iso-raise "to" in chips: 2.5bb (3bb from the SB), +1bb per limper. */
export function openTo(position, limpers) {
  return Math.round(((position === 'SB' ? 3 : 2.5) + limpers) * CHIPS_PER_BB);
}

/** 3-bet "to": 3× the open in position, 4× out of position. */
export function threeBetTo(currentBet, ip) {
  return Math.round(currentBet * (ip ? 3 : 4));
}

/** 4-bet and later: about 2.3× the last raise. */
export function fourBetTo(currentBet, ip) {
  return Math.round(currentBet * (ip ? 2.2 : 2.5));
}

/**
 * Snap an intended action onto the legal set. Bets/raises are clamped to [minTo, maxTo] and
 * rounded to 0.1bb; a bet that would leave less than a third of the called pot behind goes all-in.
 * Falls back to call/check when raising isn't allowed.
 * @param {{type: string, to?: number}} intent
 * @param {import('../../shared/schemas.js').LegalActions} legal
 * @param {number} [pot]        chips in the middle now (SeatView.pot)
 * @param {number} [committed]  chips this seat already has in on this street
 * @returns {import('../../shared/schemas.js').Action}
 */
export function legalize(intent, legal, pot = 0, committed = 0) {
  const { types } = legal;
  const passive = () => (types.includes('check') ? { type: 'check' } : { type: 'call' });
  if (intent.type === 'fold') return types.includes('fold') ? { type: 'fold' } : { type: 'check' };
  if (intent.type === 'check' || intent.type === 'call') return passive();
  const aggro = types.includes('bet') ? 'bet' : types.includes('raise') ? 'raise' : null;
  if (!aggro) return passive();
  let to = Math.round((intent.to ?? legal.minTo) / 10) * 10;
  to = Math.max(legal.minTo, Math.min(legal.maxTo, to));
  if (legal.maxTo - to < (pot + 2 * (to - committed)) / 3) to = legal.maxTo;
  return { type: aggro, amount: to };
}
