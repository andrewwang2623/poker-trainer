// Blind play targets (SPEC §7, §14). A single overall VPIP threshold makes regs defend their blinds
// the same way against a UTG open and a SB open, whatever the price. These tables set how much of
// its range a reg blind plays by role, opener position and price; preflop.js turns the targets into
// chart-shaped ranges. Fish keep their plain VPIP play.
import { TIER_RANGES } from '../profiles.js';

/**
 * Share of hands a toughReg continues with (call + 3-bet) when folded to it facing one standard open
 * (2.5 blinds, 3 from the SB), by the defender's chart role and the opener's position. BB rows fold
 * about 55% vs early opens, 35–40% vs CO/BTN and 30% vs the SB; the SB, with the BB still behind and
 * no closing action, defends far less.
 */
export const BLIND_DEFENSE = Object.freeze({
  BB: Object.freeze({ UTG: 0.45, UTG1: 0.45, UTG2: 0.46, LJ: 0.49, HJ: 0.53, CO: 0.61, BTN: 0.65, SB: 0.71 }),
  SB: Object.freeze({ UTG: 0.12, UTG1: 0.13, UTG2: 0.14, LJ: 0.16, HJ: 0.19, CO: 0.24, BTN: 0.29 }),
});

/** Heads-up BB vs the button's open: the SB opens ~85% there, so the BB defends wider than 3+ handed. */
export const HU_BB_DEFENSE = 0.75;

/** Share of the final pot the defender puts in to call at the price BLIND_DEFENSE is set for. */
const REF_ODDS = Object.freeze({ BB: 1.5 / 5.5, BBvsSB: 2 / 6, SB: 2 / 6 });

/** Defense and open multipliers by tier: toughReg sits on the table, lower regs fold a little more. */
export const TIER_BLIND_WIDTH = Object.freeze({ lowReg: 0.9, midReg: 0.95, toughReg: 1 });

/** Heads-up button (SB) first-in raise share by tier. */
export const HU_OPEN = Object.freeze({ lowReg: 0.82, midReg: 0.84, toughReg: 0.87 });

/**
 * Folded to a blind with only a straddle in: share of hands played (toughReg, before the tier
 * multiplier) by the seat's real blind, the price it's set for, and the part of that range raised
 * (the rest completes). The BB gets the SB's first-in spot at a better price; the SB has two
 * players behind and a worse price.
 */
export const STRADDLE_FIRST_IN = Object.freeze({
  BB: Object.freeze({ play: 0.72, refOdds: 1 / 4.5 }),
  SB: Object.freeze({ play: 0.62, refOdds: 1.5 / 5 }),
});
export const STRADDLE_RAISE_SHARE = 0.45;

/** Each caller between the opener and us trims the defense (worse realization multiway). */
const CALLER_PENALTY = 0.8;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** True for tiers that use these targets (regs); fish keep their VPIP-threshold play. */
export const usesBlindTargets = (profile) => Object.hasOwn(TIER_BLIND_WIDTH, profile.tier);

/** A bot's width relative to its tier: looser profiles (higher vpip) defend and open a bit more. */
function profileWidth(profile) {
  const [lo, hi] = TIER_RANGES[profile.tier].vpip;
  const mid = (lo + hi) / 2;
  return TIER_BLIND_WIDTH[profile.tier] * clamp(1 + 0.6 * (profile.vpip / mid - 1), 0.85, 1.15);
}

/** Share of the final pot we'd put in by calling now. */
export function callOdds(view) {
  const { toCall } = view.legal;
  return toCall / (view.pot + toCall);
}

/**
 * Continue share (call + 3-bet) for a blind facing one raise, or null when the spot isn't covered
 * (not a reg, not a blind role, or an opener position with no table entry, e.g. a limp-raise).
 * @param {string} role       our chart role (the straddle maps the BB to 'SB', the straddler to 'BB')
 * @param {string} openerRole the raiser's chart role
 * @param {number} callers    players who called the raise before us
 */
export function blindDefenseTarget(view, profile, role, openerRole, callers) {
  if (!usesBlindTargets(profile)) return null;
  const base = view.numPlayers === 2 && role === 'BB' ? HU_BB_DEFENSE : BLIND_DEFENSE[role]?.[openerRole];
  if (base === undefined) return null;
  const ref = role === 'SB' ? REF_ODDS.SB : openerRole === 'SB' ? REF_ODDS.BBvsSB : REF_ODDS.BB;
  const price = clamp(ref / callOdds(view), 0.5, 1.6);
  return clamp(base * profileWidth(profile) * price * CALLER_PENALTY ** callers, 0.03, 0.95);
}

/** Heads-up button first-in raise share, or null for fish. */
export function headsUpOpenTarget(profile, openWider = 1) {
  if (!usesBlindTargets(profile)) return null;
  return clamp(HU_OPEN[profile.tier] * profileWidth(profile) / TIER_BLIND_WIDTH[profile.tier] * openWider, 0.3, 0.95);
}

/**
 * Folded to a blind facing only an unraised straddle: {play, raise} shares of all hands, or null.
 * @param {'SB'|'BB'} blind the seat's real blind
 */
export function straddleFirstInTarget(view, profile, blind) {
  if (!usesBlindTargets(profile)) return null;
  const row = STRADDLE_FIRST_IN[blind];
  if (!row) return null;
  const price = clamp(row.refOdds / callOdds(view), 0.6, 1.4);
  const play = clamp(row.play * profileWidth(profile) * price, 0.2, 0.95);
  return { play, raise: play * STRADDLE_RAISE_SHARE };
}
