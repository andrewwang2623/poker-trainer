// First-pass bounty play (SPEC §15). Holding a live bounty: open or defend it as at least a
// medium-strength hand, bluff more postflop (only when a fold win pays), fold less on the river.
// Facing a player who could hold one: a small call bonus, only when a fold win pays it (with
// 'showdownOnly', folding denies the bounty). Everything scales with BOUNTY_CHASE,
// and nothing here draws from the rng unless a bounty applies, so bounty-free hands play as before.
import { holdsBounty, classCombos, cardCode } from '../../engine/index.js';
import { BOUNTY_CHASE, TIER_STYLE, POSITION_WIDTH } from './style.js';
import { openTo } from './sizing.js';

/** Extra bluff frequency at full chase, holding a bounty that pays on a fold win. */
export const BOUNTY_BLUFF_BONUS = 0.2;
/** Share of river folds dropped at full chase, holding a bounty (profile layer). */
export const BOUNTY_RIVER_FOLD_CUT = 0.5;
/** Equity discount at full chase when calling a bet from a player who could hold a bounty. */
export const BOUNTY_CALL_BONUS = 0.04;

export const bountyChase = (profile) => BOUNTY_CHASE[profile.tier] ?? 0;

/** The live bounties this seat's hole cards match. */
export function heldBounties(view) {
  return (view.bounties ?? []).filter((b) => holdsBounty(view.holeCards, b));
}

/** Chips this seat would collect for its held bounties by winning now: each other seat pays, capped at its stack. */
export function heldBountyValue(view, held = heldBounties(view)) {
  let chips = 0;
  for (const b of held) {
    for (const p of view.players) if (p.seat !== view.seat) chips += Math.min(b.amountChips, p.stack);
  }
  return chips;
}

/**
 * True when some bounty this seat doesn't hold could be in `seat`'s hand, given the cards we can see.
 * @param {string} [paysOn] only count bounties with this paysOn
 */
export function couldHoldBounty(view, seat, paysOn) {
  if (seat === null || seat === undefined || seat === view.seat) return false;
  const seen = new Set([...view.holeCards, ...view.board].map(cardCode));
  return (view.bounties ?? []).some((b) => {
    if (paysOn && b.paysOn !== paysOn) return false;
    if (holdsBounty(view.holeCards, b)) return false;
    if (b.type === 'card') return !seen.has(cardCode(b.target));
    return classCombos(b.target).some(([x, y]) => !seen.has(x) && !seen.has(y));
  });
}

/**
 * Preflop: the action for a held bounty hand the bot was about to fold, or null to keep the fold.
 * With probability BOUNTY_CHASE it enters as a medium-strength hand would: unopened or limped, a
 * rule-based bot limps or raises the way the middle of its entering range does (chart bots
 * raise); facing a single raise, it calls. 3-bets and bigger aren't chased.
 * @param {{position: string, spot: string, limpers: number, blind: number}} info  preflopDecision's reads
 */
export function bountyPreflop(view, profile, rng, info) {
  if (!heldBounties(view).length || !['unopened', 'limped', 'raised'].includes(info.spot)) return null;
  if (!(rng() < bountyChase(profile))) return null;
  if (info.spot === 'raised') return { type: 'call' };
  const raise = { type: 'raise', to: openTo(info.position, info.limpers, info.blind) };
  if (profile.usesCharts) return raise;
  const style = TIER_STYLE[profile.tier] ?? TIER_STYLE.lowReg;
  const width = POSITION_WIDTH[info.position] ?? 1;
  const medium = 0.5 * profile.vpip * width * style.openVpipK;
  return medium < profile.pfr * width * style.openPfrK ? raise : { type: 'call' };
}
