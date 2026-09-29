// Bot-played hand records for fingerprinting (not a test file); see tests/engine/_fingerprint.js.
import {
  createRng, deriveSeed, createScenario, createHand, applyAction, getView, isComplete, buildHandRecord,
} from '../../src/engine/index.js';
import { STAKES } from '../../src/shared/schemas.js';
import { decideAction, createBotProfile } from '../../src/bots/index.js';

const STAKE_IDS = Object.keys(STAKES);

/** Every seat is a bot (hero's seat plays as a fish profile tracked here). */
export function botPlayRecords({ from = 1, to = 150, extra = {} } = {}) {
  const records = [];
  for (let seed = from; seed <= to; seed++) {
    const straddle = { enabled: seed % 2 === 0, heroChance: 0.3 };
    const scenario = createScenario({
      stakes: STAKE_IDS[seed % 4], seed, createdAt: seed, straddle, poolOverride: { fish: 1, lowReg: 1, midReg: 1, toughReg: 1 },
      ...extra,
    }, createRng(seed));
    const botRng = createRng(deriveSeed(seed, 'bots'));
    const profiles = scenario.seats.map((seat) => createBotProfile(seat.tier ?? 'fish', botRng));
    for (const seat of scenario.seats) seat.profile = seat.isHero ? null : profiles[seat.seat];
    let s = createHand(scenario);
    while (!isComplete(s)) {
      const seat = s.actingSeat;
      s = applyAction(s, decideAction(getView(s, seat), profiles[seat], { rng: botRng, heroStats: null }));
    }
    records.push(buildHandRecord(s, { sessionId: 'fp', timestamp: seed }));
  }
  return records;
}
