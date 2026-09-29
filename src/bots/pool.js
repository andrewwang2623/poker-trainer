// Stakes → opponent pool (SPEC §3): the default tier mix per stakes, with the settings override.
import { STAKES } from '../shared/schemas.js';
import { normalizePool, sampleTier } from '../engine/scenario.js';

export { sampleTier };

/** Default tier weights per stakes id, straight from STAKES. */
export const STAKES_POOL = Object.freeze(
  Object.fromEntries(Object.values(STAKES).map((s) => [s.id, Object.freeze({ ...s.pool })])),
);

/**
 * The tier mix for a table: the stakes default, or the settings override (normalized to sum to 1;
 * an all-zero override falls back to the default).
 * @param {import('../shared/schemas.js').StakesId} stakes
 * @param {Object<string, number>} [poolOverride]
 * @returns {Object<import('../shared/schemas.js').Tier, number>}
 */
export function poolForStakes(stakes, poolOverride) {
  if (!STAKES_POOL[stakes]) throw new RangeError(`Unknown stakes: ${stakes}`);
  return normalizePool(poolOverride ?? STAKES_POOL[stakes], STAKES_POOL[stakes]);
}
