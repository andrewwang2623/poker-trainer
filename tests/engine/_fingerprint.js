// Fingerprints of whole hand records (not a test file). Used to show that switching bounties off
// reproduces the records the engine made before bounties existed: fields added for §15 (and the
// new HeroStatFlags) are stripped, then everything else is hashed.
import { createHash } from 'node:crypto';
import {
  createRng, createScenario, createHand, getLegalActions, applyAction, isComplete, buildHandRecord, randInt,
} from '../../src/engine/index.js';
import { STAKES } from '../../src/shared/schemas.js';

const STAKE_IDS = Object.keys(STAKES);

/** A record minus the fields that didn't exist before bounties. */
export function legacyView(record) {
  const { bounties, heroBountyBb, ...rest } = record;
  const { bountyNetChips, ...result } = record.result;
  const { facedPostflopBet, foldedToPostflopBet, ...statFlags } = record.statFlags;
  return { ...rest, result, statFlags };
}

export function hashRecords(records) {
  const h = createHash('sha256');
  for (const r of records) h.update(JSON.stringify(legacyView(r)));
  return h.digest('hex');
}

/**
 * Hands played with seeded random legal actions (all-in heavy), straddles on for odd seeds.
 * `extra` is merged into the createScenario options (e.g. {bounty}).
 */
export function randomPlayRecords({ from = 1, to = 300, extra = {} } = {}) {
  const records = [];
  for (let seed = from; seed <= to; seed++) {
    const rng = createRng(seed);
    const straddle = { enabled: seed % 2 === 1, heroChance: 0.5 };
    const scenario = createScenario({ stakes: STAKE_IDS[seed % 4], seed, createdAt: seed, straddle, ...extra }, rng);
    let s = createHand(scenario);
    while (!isComplete(s)) {
      const legal = getLegalActions(s);
      const type = legal.types[Math.floor(rng() * legal.types.length)];
      s = applyAction(s, type === 'bet' || type === 'raise'
        ? { type, amount: rng() < 0.3 ? legal.maxTo : randInt(rng, legal.minTo, legal.maxTo) }
        : type === 'fold' && rng() < 0.6 ? { type: 'call' } : { type });
    }
    records.push(buildHandRecord(s, { sessionId: 'fp', timestamp: seed }));
  }
  return records;
}
