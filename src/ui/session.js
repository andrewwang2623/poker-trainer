import { seedHash } from './seed-hash.js';
import { botActionDelay, normalizeBotSpeed } from './bot-speed.js';

const randomWord = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0];

/** Bridge immutable engine hands to the UI's state, action, and next-hand interface. */
export function createEngineSession(engine, bots, initialSettings = {}, options = {}) {
  const listeners = new Set();
  const sessionRng = engine.createRng(randomWord());
  const usedSeeds = new Set();
  const sessionId = options.sessionId ?? `session-${randomWord().toString(36)}-${Date.now().toString(36)}`;
  const now = options.now ?? Date.now;
  const seedSource = options.seedSource ?? (() => Math.floor(sessionRng() * 0x100000000));
  const delay = options.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const recentHands = [];
  let settings = initialSettings;
  let botSpeed = normalizeBotSpeed(initialSettings.botSpeed);
  let botPacing = initialSettings.botPacing !== false;
  let outBotSpeed = normalizeBotSpeed(initialSettings.outBotSpeed);
  let state;
  let botRng;
  let createdAt;
  let pending = null;
  let recorded = false;

  const notify = () => { for (const listener of listeners) listener(); };

  function freshSeed() {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const seed = seedSource() >>> 0;
      if (!usedSeeds.has(seed)) { usedSeeds.add(seed); return seed; }
    }
    throw new Error('Unable to draw a fresh hand seed');
  }

  function startHand() {
    const seed = freshSeed();
    createdAt = now();
    const rng = engine.createRng(seed);
    const scenario = engine.createScenario({
      stakes: settings.stakes ?? 'micro', poolOverride: settings.poolOverride ?? undefined,
      seed, createdAt,
    }, rng);
    // The current engine drops createdAt; keep it on the config until its owner updates it.
    scenario.createdAt = createdAt;
    scenario.seats = scenario.seats.map(seat => ({
      ...seat,
      profile: seat.isHero ? null : bots.createBotProfile(seat.tier, rng),
    }));
    state = engine.createHand(scenario);
    const prefix = `${createdAt.toString(36)}-`;
    if (!new RegExp(`^${prefix}[a-f0-9]{8}$`).test(state.handId)) {
      state = { ...state, handId: `${prefix}${seedHash(seed)}` };
    }
    botRng = engine.createRng(engine.deriveSeed(seed, 'bots'));
    recorded = false;
    notify();
  }

  async function finishHand() {
    if (recorded || !engine.isComplete(state)) return;
    recorded = true;
    const record = engine.buildHandRecord(state, { sessionId, timestamp: createdAt });
    if (options.coach) {
      record.coach = options.coach.analyzeHand(record, {
        rng: engine.createRng(engine.deriveSeed(state.seed, 'coach')),
      });
    }
    recentHands.unshift(record);
    if (recentHands.length > 10) recentHands.pop();
    await options.tracker?.recordHand(record);
    notify();
  }

  function advanceBots() {
    if (pending) return pending;
    pending = (async () => {
      while (!engine.isComplete(state) && state.actingSeat !== state.heroSeat) {
        const seat = state.actingSeat;
        if (seat === null) break;
        // Consume the same random draw at every speed to preserve seeded decisions.
        await delay(botActionDelay(botSpeed, botRng(), {
          folded: state.players[state.heroSeat].folded, enabled: botPacing, outSpeed: outBotSpeed,
        }));
        const view = engine.getView(state, seat);
        const action = bots.decideAction(view, state.players[seat].profile, { rng: botRng, heroStats: null });
        state = engine.applyAction(state, action);
        notify();
      }
      await finishHand();
    })();
    return pending.finally(() => { pending = null; });
  }

  startHand();
  const ready = Promise.resolve().then(advanceBots);
  return {
    ready,
    getState: () => state,
    getLegalActions: () => state.actingSeat === state.heroSeat ? engine.getLegalActions(state) : null,
    getRecentHands: () => recentHands.slice(),
    setBotSpeed(value) { botSpeed = normalizeBotSpeed(value); },
    setBotPacing(value) { botPacing = value !== false; },
    setOutBotSpeed(value) { outBotSpeed = normalizeBotSpeed(value); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async act(action) {
      if (pending || state.actingSeat !== state.heroSeat) throw new RangeError('Hero is not acting');
      state = engine.applyAction(state, action);
      notify();
      await advanceBots();
      return state;
    },
    async nextHand(nextSettings = settings) {
      if (pending) await pending;
      if (!engine.isComplete(state)) throw new RangeError('Finish this hand first');
      settings = nextSettings;
      startHand();
      await advanceBots();
      return state;
    },
  };
}
