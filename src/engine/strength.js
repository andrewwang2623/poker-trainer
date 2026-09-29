// Fixed 169-class preflop strength ranking (SPEC §7, §15). The engine owns it because bounty
// targets are drawn from its weakest classes; the bots import it for their preflop ranges.
// Generated offline: 0.5·(equity vs 1 random hand) + 0.75·(equity vs 2 random hands), 30k samples
// each, so multiway playability (suitedness, pairs) counts as well as heads-up high-card strength.
import { BOUNTY_HAND_POOL } from '../shared/schemas.js';

/** All 169 hand classes, strongest first. */
export const HAND_STRENGTH_ORDER = Object.freeze((
  'AA KK QQ JJ TT 99 88 AKs AQs AKo AJs ATs 77 AQo KQs AJo KJs A9s KTs ATo 66 A8s QJs KQo KJo A7s QTs ' +
  'K9s A9o KTo A5s A6s 55 JTs QJo A4s A8o Q9s K8s A7o A3s QTo K9o K7s J9s A5o A2s Q8s A6o K6s JTo 44 ' +
  'A4o K5s T9s Q9o K8o A3o J8s K4s K7o Q7s A2o J9o Q6s T8s K3s Q8o K6o J7s Q5s T9o K2s 98s K5o 33 J8o ' +
  'Q4s T7s K4o Q3s Q7o J6s T8o 97s J5s K3o Q2s Q6o 87s 98o J7o K2o T6s Q5o J4s 22 96s T7o Q4o J3s 86s ' +
  'T5s 76s J2s Q3o J6o 97o T4s 95s Q2o J5o T3s 87o T6o 65s 85s 75s T2s J4o 96o 94s 86o J3o 54s 76o 93s ' +
  '84s T5o J2o 64s 74s T4o 92s 95o T3o 85o 83s 53s 75o 82s 65o 73s T2o 63s 43s 94o 54o 84o 52s 74o 72s ' +
  '64o 93o 62s 42s 92o 32s 73o 83o 53o 63o 82o 43o 52o 62o 72o 42o 32o'
).split(' '));

/**
 * The hand-bounty targets: the weakest BOUNTY_HAND_POOL of the 156 non-pair classes (pocket pairs
 * are never bounty hands), strongest of them first.
 */
export const BOUNTY_HAND_TARGETS = Object.freeze(
  HAND_STRENGTH_ORDER.filter((cls) => cls[0] !== cls[1]).slice(-BOUNTY_HAND_POOL),
);
