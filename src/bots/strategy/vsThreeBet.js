// The opener facing a 3-bet (SPEC §7, owner correction 2026-09-29). Regs continue (call or 4-bet)
// with a share of their own opening range from that position rather than a slice of their 3-bet
// range, which folded ~90% of opens. Fish keep their VPIP-based play.

/** Share of its own opening range a reg continues with out of position, before the adjustments below. */
export const CONTINUE_VS_3BET = Object.freeze({ lowReg: 0.4, midReg: 0.48, toughReg: 0.5 });
/** Added to the continue share in position and heads-up. */
export const IP_BONUS = 0.04;
export const HU_BONUS = 0.03;
/** Share of the opening range that 4-bets (the top of it). */
export const FOUR_BET_SHARE = Object.freeze({ lowReg: 0.1, midReg: 0.11, toughReg: 0.12 });

/**
 * Price the continue shares are set for: out of position vs a 3× in-position 3-bet of a 2.5bb open,
 * in position vs a 4× blind 3-bet, heads-up vs a 4× 3-bet of a 3bb open.
 */
const REF_ODDS = Object.freeze({ oop: 5 / 16.5, ip: 7.5 / 20.5, hu: 9 / 24 });
/** Each caller of the 3-bet before us trims the continue share. */
const CALLER_PENALTY = 0.85;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * {cont, fourBet}: shares of the bot's opening range to continue with and to 4-bet, or null for tiers
 * without targets (fish).
 * @param {boolean} ip       we act after the 3-bettor postflop
 * @param {number} callers   players who called the 3-bet before us
 */
export function vsThreeBetTarget(view, profile, ip, callers) {
  const base = CONTINUE_VS_3BET[profile.tier];
  if (base === undefined) return null;
  const hu = view.numPlayers === 2;
  const { toCall } = view.legal;
  const odds = toCall / (view.pot + toCall);
  const ref = hu ? REF_ODDS.hu : ip ? REF_ODDS.ip : REF_ODDS.oop;
  const cont = (base + (ip ? IP_BONUS : 0) + (hu ? HU_BONUS : 0)) * clamp(ref / odds, 0.75, 1.25) *
    CALLER_PENALTY ** callers;
  const fourBet = FOUR_BET_SHARE[profile.tier];
  return { cont: clamp(cont, fourBet, 0.9), fourBet };
}
