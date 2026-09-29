// Real bots (SPEC §7, M2). Same interface as placeholder.js.
//   fish, lowReg: rule-based preflop over their tier variant ranges; equity-driven postflop.
//   midReg:       RANGE_CHART preflop (argmax), texture sizing, MDF-aware defense.
//   toughReg:     midReg plus frequency mixing and exploits from hero's session stats.
import { preflopDecision } from './strategy/preflop.js';
import { postflopDecision } from './strategy/postflop.js';
import { exploitAdjust } from './strategy/exploit.js';
import { legalize } from './strategy/sizing.js';

export { createBotProfile, TIER_RANGES } from './profiles.js';
export { STAKES_POOL, poolForStakes, sampleTier } from './pool.js';
export { createHeroReads } from './reads.js';
export { BOUNTY_CHASE } from './strategy/style.js';

/**
 * @param {import('../shared/schemas.js').SeatView} view
 * @param {import('../shared/schemas.js').BotProfile} profile
 * @param {import('../shared/schemas.js').BotContext} ctx
 * @returns {import('../shared/schemas.js').Action} always legal for view.legal
 */
export function decideAction(view, profile, ctx) {
  const legal = view?.legal;
  if (!legal) throw new RangeError('decideAction: this seat has no action pending');
  if (!profile) throw new TypeError('decideAction needs a bot profile');
  if (typeof ctx?.rng !== 'function') throw new TypeError('decideAction needs ctx.rng');
  // Only exploiting bots read hero's stats at all (exploits and hero's range estimate).
  const heroStats = profile.exploitsHero ? ctx.heroStats ?? null : null;
  const adj = exploitAdjust(profile, view, heroStats);
  const decide = view.street === 'preflop' ? preflopDecision : postflopDecision;
  const intent = decide(view, profile, { rng: ctx.rng, heroStats }, adj);
  return legalize(intent, legal, view.pot, view.players[view.seat].committedStreet);
}
