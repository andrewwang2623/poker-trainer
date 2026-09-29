// Bridges the engine's immutable hand state to the small session interface used by
// the table. The mock session implements the same interface during UI development.
export function createEngineSession(engine, bots, initialSettings = {}) {
  const listeners = new Set();
  let settings = initialSettings;
  let handNumber = 0;
  let state;
  let botRng;
  let advancing = false;

  const notify = () => { for (const listener of listeners) listener(); };

  function startHand() {
    const seed = (Date.now() + (++handNumber * 0x9e3779b9)) >>> 0;
    const rng = engine.createRng(seed);
    const scenario = engine.createScenario({
      stakes: settings.stakes ?? 'micro',
      ...(settings.poolOverride ? { poolOverride: settings.poolOverride } : {}),
      seed,
    }, rng);
    scenario.seats = scenario.seats.map(seat => ({
      ...seat,
      profile: seat.isHero ? null : bots.createBotProfile(seat.tier, rng),
    }));
    state = engine.createHand(scenario);
    botRng = engine.createRng(seed ^ 0xa5a5a5a5);
    notify();
  }

  async function advanceBots() {
    if (advancing) return;
    advancing = true;
    try {
      while (!engine.isComplete(state) && state.actingSeat !== state.heroSeat) {
        const seat = state.actingSeat;
        if (seat === null) break;
        const delay = 400 + Math.floor(botRng() * 501);
        await new Promise(resolve => setTimeout(resolve, delay));
        const view = engine.getView(state, seat);
        const action = bots.decideAction(view, state.players[seat].profile, { rng: botRng, heroStats: null });
        state = engine.applyAction(state, action);
        notify();
      }
    } finally {
      advancing = false;
    }
  }

  startHand();
  queueMicrotask(() => { void advanceBots(); });
  return {
    getState: () => state,
    getLegalActions: () => state.actingSeat === state.heroSeat ? engine.getLegalActions(state) : null,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async act(action) {
      if (advancing || state.actingSeat !== state.heroSeat) throw new RangeError('Hero is not acting');
      state = engine.applyAction(state, action);
      notify();
      await advanceBots();
      return state;
    },
    async nextHand(nextSettings = settings) {
      if (advancing || !engine.isComplete(state)) throw new RangeError('Finish this hand first');
      settings = nextSettings;
      startHand();
      await advanceBots();
      return state;
    },
  };
}
