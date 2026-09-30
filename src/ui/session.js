import { botActionDelay, normalizeBotSpeed } from './bot-speed.js';
import { normalizeStraddle } from './straddle-settings.js';
import { normalizeBounty } from './bounty-settings.js';

const randomWord = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0];

/** Bridge immutable engine hands to the UI's state, action, and next-hand interface. */
export function createEngineSession(engine, bots, initialSettings = {}, options = {}) {
  const listeners = new Set();
  const sessionRng = engine.createRng(randomWord());
  const usedSeeds = new Set();
  const sessionId = options.sessionId ?? `session-${randomWord().toString(36)}-${Date.now().toString(36)}`;
  const now = options.now ?? Date.now;
  const seedSource = options.seedSource ?? (() => Math.floor(sessionRng() * 0x100000000));
  const recentHands = [];
  const reads = bots.createHeroReads?.() ?? null;
  const completionErrors = new Map();
  let heroStats = null;
  let settings = initialSettings;
  let botSpeed = normalizeBotSpeed(initialSettings.botSpeed);
  let botPacing = initialSettings.botPacing !== false;
  let outBotSpeed = normalizeBotSpeed(initialSettings.outBotSpeed);
  let state;
  let botRng;
  let pacingRng;
  let createdAt;
  let pending = null;
  let recorded = false;
  let generation = 0;
  let cancelWait = null;

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
    const straddle = normalizeStraddle(settings.straddle);
    const scenario = engine.createScenario({
      stakes: settings.stakes ?? 'micro', poolOverride: settings.poolOverride ?? undefined,
      seed, createdAt,
      straddle: { enabled: straddle.enabled, heroChance: straddle.heroChancePercent / 100 },
      bounty: normalizeBounty(settings.bounty),
    });
    const profileRng = engine.createRng(engine.deriveSeed(seed, 'profiles'));
    scenario.seats = scenario.seats.map(seat => ({
      ...seat,
      profile: seat.isHero ? null : bots.createBotProfile(seat.tier, profileRng),
    }));
    state = engine.createHand(scenario);
    botRng = engine.createRng(engine.deriveSeed(seed, 'bots'));
    pacingRng = engine.createRng(engine.deriveSeed(seed, 'pacing'));
    recorded = false;
    notify();
  }

  async function refreshHeroStats() {
    try { heroStats = await options.tracker?.getStats('session') ?? null; }
    catch { heroStats = null; }
  }

  function finishHand() {
    if (recorded || !engine.isComplete(state)) return;
    recorded = true;
    const record = engine.buildHandRecord(state, { sessionId, timestamp: createdAt });
    reads?.observe(record);
    if (options.coach) {
      try {
        record.coach = options.coach.analyzeHand(record, {
          rng: engine.createRng(engine.deriveSeed(record.seed, 'coach')),
        }) ?? null;
      } catch (error) { completionErrors.set(record.id, `Coach unavailable: ${error.message}`); }
    }
    recentHands.unshift(record);
    if (recentHands.length > 10) recentHands.pop();
    const finishing = (async () => {
      try { await options.tracker?.recordHand(record); }
      catch (error) {
        completionErrors.set(record.id, [completionErrors.get(record.id), `Hand could not be saved: ${error.message}`].filter(Boolean).join(' · '));
      }
      await refreshHeroStats();
      notify();
    })();
    return finishing;
  }

  // Resolve cancelled waits too, so abandoned act()/ready promises can settle.
  function waitForBot(ms) {
    return new Promise((resolve, reject) => {
      let handle;
      const cancel = () => { clearTimeout(handle); resolve(); };
      cancelWait = cancel;
      const done = callback => value => {
        if (cancelWait === cancel) cancelWait = null;
        callback(value);
      };
      if (options.delay) Promise.resolve(options.delay(ms)).then(done(resolve), done(reject));
      else handle = setTimeout(done(resolve), ms);
    });
  }

  function advanceBots() {
    if (pending) return pending;
    const current = generation;
    const run = (async () => {
      if (options.tracker?.getStats) await refreshHeroStats();
      while (current === generation && !engine.isComplete(state) && state.actingSeat !== state.heroSeat) {
        const seat = state.actingSeat;
        if (seat === null) break;
        await waitForBot(botActionDelay(botSpeed, pacingRng(), {
          folded: state.players[state.heroSeat].folded, enabled: botPacing, outSpeed: outBotSpeed,
        }));
        if (current !== generation) return;
        playBotAction();
        notify();
      }
      if (current === generation) await finishHand();
    })();
    const result = run.finally(() => { if (pending === result) pending = null; });
    pending = result;
    return result;
  }

  function playBotAction() {
    const seat = state.actingSeat;
    const view = engine.getView(state, seat);
    const action = bots.decideAction(view, state.players[seat].profile, {
      rng: botRng, heroStats: heroStats?.hands >= 30 ? heroStats : reads?.summary() ?? heroStats,
    });
    state = engine.applyAction(state, action);
  }

  function newHand(nextSettings = settings) {
    generation++;
    cancelWait?.();
    cancelWait = null;
    pending = null;
    // Once hero cannot decide again, finish the actual bot line on the existing RNG stream.
    // No intermediate notifications: listeners must not deal another hand during this runout.
    const hero = state.players[state.heroSeat];
    if (hero.folded || hero.allIn) {
      while (!engine.isComplete(state) && state.actingSeat !== null && state.actingSeat !== state.heroSeat) {
        playBotAction();
      }
    }
    // Use the same coach, reads, history and persistence path as a normally completed hand.
    const finishing = finishHand();
    settings = nextSettings;
    startHand();
    return Promise.all([finishing, advanceBots()]).then(() => state);
  }

  startHand();
  const ready = Promise.resolve().then(advanceBots);
  return {
    ready,
    getState: () => state,
    getSessionId: () => sessionId,
    getLegalActions: () => state.actingSeat === state.heroSeat ? engine.getLegalActions(state) : null,
    getRecentHands: () => recentHands.slice(),
    getCompletionError: id => completionErrors.get(id) ?? '',
    refreshHeroStats,
    getLiveOdds() {
      if (!options.coach?.liveOdds || engine.isComplete(state) || state.actingSeat !== state.heroSeat) return null;
      const view = engine.getView(state, state.heroSeat);
      const opponents = view.players.filter(player => !player.isHero && !player.folded).map(player => player.profile);
      return options.coach.liveOdds(view, opponents, {
        rng: engine.createRng(engine.deriveSeed(state.seed, `liveOdds:${state.events.length}`)),
      });
    },
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
    newHand,
    async nextHand(nextSettings = settings) {
      if (!engine.isComplete(state)) throw new RangeError('Finish this hand first');
      return newHand(nextSettings);
    },
  };
}
