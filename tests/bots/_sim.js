// Bot-only hand simulator for tier calibration. Every seat, including the scenario's hero seat,
// is a bot; per-seat stats come straight from the event log. The engine keeps the hero seat's
// profile null, so profiles are tracked here by seat (other bots see that seat as an unknown player).
import {
  createRng, deriveSeed, createScenario, createHand, applyAction, getView, isComplete, normalizePool, sampleTier,
} from '../../src/engine/index.js';
import { TIERS } from '../../src/shared/schemas.js';
import { decideAction, createBotProfile, poolForStakes } from '../../src/bots/index.js';

const UNIFORM_POOL = Object.freeze(Object.fromEntries(TIERS.map((t) => [t, 1 / TIERS.length])));

function emptyTally() {
  return {
    seatHands: 0, vpip: 0, pfr: 0, threeBetOpp: 0, threeBet: 0,
    bets: 0, raises: 0, calls: 0, facingBet: 0, foldToBet: 0, sawFlop: 0, wtsd: 0, decisions: 0,
    target: { vpip: 0, pfr: 0, threeBet: 0, aggression: 0, foldToBet: 0 },
  };
}

function tallyHand(state, profiles, tallies) {
  const seen = state.players.map(() => ({ vpip: false, pfr: false, threeBetOpp: false, threeBet: false, sawFlop: false }));
  let raises = 0;
  for (const e of state.events) {
    if (e.type !== 'action') continue;
    const t = tallies[profiles[e.seat].tier];
    const s = seen[e.seat];
    t.decisions++;
    if (e.street === 'preflop') {
      if (raises === 1) s.threeBetOpp = true;
      if (e.action === 'call' || e.action === 'raise') s.vpip = true;
      if (e.action === 'raise') {
        s.pfr = true;
        if (raises === 1) s.threeBet = true;
        raises++;
      }
      continue;
    }
    s.sawFlop = true;
    if (e.action === 'bet') t.bets++;
    if (e.action === 'raise') t.raises++;
    if (e.action === 'call') t.calls++;
    if (e.toCall > 0) {
      t.facingBet++;
      if (e.action === 'fold') t.foldToBet++;
    }
  }
  // Players all-in preflop (or checking the whole way) also "saw" the flop if it came.
  const flopDealt = state.events.some((e) => e.type === 'board' && e.street === 'flop');
  profiles.forEach((profile, seat) => {
    const t = tallies[profile.tier];
    const s = seen[seat];
    if (flopDealt && !foldedPreflop(state, seat)) s.sawFlop = true;
    t.seatHands++;
    for (const k of ['vpip', 'pfr', 'threeBetOpp', 'threeBet', 'sawFlop']) if (s[k]) t[k]++;
    if (state.result.showdownSeats.includes(seat)) t.wtsd++;
    for (const k of Object.keys(t.target)) t.target[k] += profile[k];
  });
}

function foldedPreflop(state, seat) {
  return state.events.some((e) => e.type === 'action' && e.seat === seat && e.street === 'preflop' && e.action === 'fold');
}

/**
 * @param {{hands?: number, seed?: number, stakes?: string, pool?: Object, straddle?: Object}} opts
 *   pool defaults to an even mix of all four tiers so every tier gets a sample; pass stakes to use its
 *   default pool. straddle is passed to createScenario.
 * @returns {Object<string, Object>} per tier: observed rates and mean profile targets
 */
export function simulateBotHands({ hands = 1000, seed = 1, stakes, pool, straddle } = {}) {
  const tierPool = pool ? normalizePool(pool) : stakes ? poolForStakes(stakes) : UNIFORM_POOL;
  const session = createRng(seed);
  const tallies = Object.fromEntries(TIERS.map((t) => [t, emptyTally()]));
  for (let h = 0; h < hands; h++) {
    const handSeed = Math.floor(session() * 4294967296);
    const scenario = createScenario({ stakes: stakes ?? 'mid', seed: handSeed, createdAt: h, straddle },
      createRng(handSeed));
    const botRng = createRng(deriveSeed(handSeed, 'bots'));
    const profiles = scenario.seats.map(() => createBotProfile(sampleTier(tierPool, botRng), botRng));
    for (const seat of scenario.seats) seat.profile = seat.isHero ? null : profiles[seat.seat];
    let state = createHand(scenario);
    while (!isComplete(state)) {
      const seat = state.actingSeat;
      const action = decideAction(getView(state, seat), profiles[seat], { rng: botRng, heroStats: null });
      state = applyAction(state, action);
    }
    tallyHand(state, profiles, tallies);
  }
  const out = {};
  for (const tier of TIERS) {
    const t = tallies[tier];
    const rate = (x, d) => (d > 0 ? x / d : null);
    out[tier] = {
      seatHands: t.seatHands,
      vpip: rate(t.vpip, t.seatHands),
      pfr: rate(t.pfr, t.seatHands),
      threeBet: rate(t.threeBet, t.threeBetOpp),
      af: rate(t.bets + t.raises, t.calls),
      foldToBet: rate(t.foldToBet, t.facingBet),
      wtsd: rate(t.wtsd, t.sawFlop),
      decisions: t.decisions,
      target: Object.fromEntries(Object.entries(t.target).map(([k, v]) => [k, rate(v, t.seatHands)])),
    };
  }
  return out;
}
