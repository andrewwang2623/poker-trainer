import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/main.js';
import * as engine from '../../src/engine/index.js';
import * as bots from '../../src/bots/index.js';
import * as placeholder from '../../src/bots/placeholder.js';
import { TIERS } from '../../src/shared/schemas.js';
import { createEngineSession } from '../../src/ui/session.js';

async function finishHand(session, fold = false) {
  let decisions = 0;
  while (!engine.isComplete(session.getState())) {
    assert.ok(++decisions < 200, 'hand must finish');
    const legal = session.getLegalActions();
    assert.ok(legal);
    await session.act({ type: legal.types.includes('check') ? 'check'
      : fold && legal.types.includes('fold') ? 'fold' : 'call' });
  }
}

test('main wiring plays 50 random full hands with the available bots', async () => {
  let nextSeed = 1000;
  const app = await createApp({ stakes: 'micro', poolOverride: null }, {
    seedSource: () => nextSeed++, delay: async () => {},
  });
  assert.equal(app.features.realBots, true);
  assert.equal(app.session.getState().handId.startsWith('mock-'), false);
  await app.session.ready;

  const ids = new Set();
  const tableSizes = new Set();
  let showdowns = 0;
  for (let hand = 0; hand < 50; hand++) {
    while (!app.engine.isComplete(app.session.getState())) {
      const legal = app.session.getLegalActions();
      assert.ok(legal, `hero must act in hand ${hand}`);
      const type = hand % 7 === 0 && legal.types.includes('fold') ? 'fold'
        : hand % 3 === 0 && legal.types.includes('bet') ? 'bet'
          : legal.types.includes('check') ? 'check' : 'call';
      const action = type === 'bet' ? { type, amount: legal.minTo } : { type };
      await app.session.act(action);
    }
    const state = app.session.getState();
    const record = app.session.getRecentHands()[0];
    assert.ok(record);
    assert.equal(record.id, state.handId);
    assert.equal(record.seed, state.seed);
    assert.equal(record.timestamp.toString(36), state.handId.split('-')[0]);
    assert.equal(state.handId.split('-')[1], createHash('sha256').update(String(state.seed)).digest('hex').slice(0, 8));
    assert.equal(state.players.filter(player => player.isHero).length, 1);
    assert.ok(state.players.filter(player => !player.isHero).every(player => player.profile));
    assert.equal(state.result.netChips.reduce((sum, chips) => sum + chips, 0) + state.result.rakeChips, 0);
    assert.ok(!ids.has(state.handId));
    ids.add(state.handId);
    tableSizes.add(state.numPlayers);
    if (state.events.some(event => event.type === 'showdown')) showdowns++;
    if (hand < 49) await app.session.nextHand({ stakes: hand < 24 ? 'micro' : 'high', poolOverride: null });
  }
  assert.equal(ids.size, 50);
  assert.ok(tableSizes.size > 1);
  assert.ok(showdowns > 0);
  assert.equal(app.session.getRecentHands().length, 10);
  assert.equal(app.session.getState().stakes, 'high');
});

for (const tier of TIERS) {
  for (const enabled of [false, true]) test(`main wiring completes ${tier} hands with straddles ${enabled ? 'on' : 'off'}`, async () => {
    const settings = { stakes: 'micro', poolOverride: Object.fromEntries(TIERS.map(key => [key, key === tier ? 1 : 0])),
      straddle: { enabled, heroChancePercent: 75 } };
    // Exercise real native hero, bot and non-straddle scenarios for every tier,
    // including tough regs whose natural straddle frequency is only 3%.
    const seeds = [];
    const counts = { hero: 0, bot: 0, none: 0 };
    for (let seed = 1; seed < 10000 && seeds.length < 6; seed++) {
      const scenario = engine.createScenario({ stakes: 'micro', poolOverride: settings.poolOverride,
        seed, createdAt: 123456789, straddle: { enabled, heroChance: 0.75 } });
      const kind = scenario.straddleSeat === null ? 'none' : scenario.straddleSeat === scenario.heroSeat ? 'hero' : 'bot';
      if (!enabled || counts[kind] < 2) { seeds.push(seed); counts[kind]++; }
    }
    assert.equal(seeds.length, 6);
    if (enabled) assert.deepEqual(counts, { hero: 2, bot: 2, none: 2 });
    let index = 0;
    const app = await createApp(settings, { seedSource: () => seeds[index++], delay: async () => {} });
    await app.session.ready;
    for (let hand = 0; hand < 6; hand++) {
      assert.ok(app.session.getState().players.filter(player => !player.isHero)
        .every(player => player.profile.tier === tier));
      await finishHand(app.session);
      const state = app.session.getState();
      assert.equal(state.result.netChips.reduce((sum, n) => sum + n, 0) + state.result.rakeChips, 0);
      const record = app.session.getRecentHands()[0];
      assert.equal(record.id, state.handId);
      const scenario = engine.createScenario({ stakes: 'micro', poolOverride: settings.poolOverride,
        seed: state.seed, createdAt: record.timestamp, straddle: { enabled, heroChance: 0.75 } });
      assert.equal(state.straddleSeat, scenario.straddleSeat);
      assert.equal(record.straddleSeat, state.straddleSeat);
      assert.equal(record.statFlags.straddled, state.straddleSeat === state.heroSeat);
      assert.equal(record.statFlags.facedStraddle, state.straddleSeat !== null && state.straddleSeat !== state.heroSeat);
      const posts = state.events.filter(event => event.type === 'postBlind');
      assert.equal(posts.filter(event => event.blind === 'BB').length, 1);
      assert.equal(posts.length, state.straddleSeat === null ? 2 : 3);
      if (state.straddleSeat !== null) {
        assert.deepEqual([posts[2].blind, posts[2].seat, posts[2].amount], ['straddle', state.straddleSeat, 200]);
        assert.match(app.exporter.formatHand(record), /posts straddle 2.0bb/);
      }
      if (hand < 5) await app.session.nextHand(settings);
    }
  });
}

test('session trusts native scenario timestamps/IDs and isolates profiles, timing, and bot randomness', async () => {
  const seed = 1234;
  const createdAt = 1790000000000;
  const nativeScenario = engine.createScenario({ stakes: 'micro', seed, createdAt });
  const profiles = engine.createRng(engine.deriveSeed(seed, 'profiles'));
  nativeScenario.seats = nativeScenario.seats.map(seat => ({ ...seat,
    profile: seat.isHero ? null : bots.createBotProfile(seat.tier, profiles) }));
  const expected = engine.createHand(nativeScenario);
  let original;
  const botDraws = [];
  const delays = [];
  const wrappedEngine = { ...engine,
    createScenario(...args) {
      assert.equal(args.length, 1, 'scenario owns its RNG');
      return engine.createScenario(...args);
    },
    createHand(config) { original = engine.createHand(config); return original; },
  };
  const wrappedBots = { ...placeholder, decideAction(view, profile, ctx) {
    botDraws.push(ctx.rng());
    return placeholder.decideAction(view, profile, ctx);
  } };
  const session = createEngineSession(wrappedEngine, wrappedBots, { stakes: 'micro' }, {
    seedSource: () => seed, now: () => createdAt, delay: async ms => { delays.push(ms); },
  });
  assert.equal(session.getState(), original, 'session must not rewrite the engine hand');
  assert.deepEqual(original, expected);
  await session.ready;
  await finishHand(session);
  const decisions = engine.createRng(engine.deriveSeed(seed, 'bots'));
  assert.ok(botDraws.length > 0);
  assert.deepEqual(botDraws, botDraws.map(() => decisions()));
  const pacing = engine.createRng(engine.deriveSeed(seed, 'pacing'));
  assert.deepEqual(delays, delays.map(() => 400 + Math.floor(pacing() * 501)));
});

test('straddle percentage changes reach native scenario generation on the next hand', async () => {
  const optionsSeen = [];
  const wrappedEngine = { ...engine, createScenario(options) {
    optionsSeen.push(options.straddle);
    return engine.createScenario(options);
  } };
  let seed = 1000;
  const settings = { stakes: 'micro', straddle: { enabled: true, heroChancePercent: 33 } };
  const session = createEngineSession(wrappedEngine, placeholder, settings, {
    seedSource: () => seed++, delay: async () => {},
  });
  await session.ready;
  assert.deepEqual(optionsSeen, [{ enabled: true, heroChance: 0.33 }]);
  for (const straddle of [
    { enabled: true, heroChancePercent: 0 },
    { enabled: true, heroChancePercent: 100 },
    { enabled: false, heroChancePercent: 100 },
  ]) {
    await finishHand(session);
    const next = { ...settings, straddle };
    await session.nextHand(next);
    assert.deepEqual(optionsSeen.at(-1), { enabled: straddle.enabled, heroChance: straddle.heroChancePercent / 100 });
    const state = session.getState();
    if (!straddle.enabled) assert.equal(state.straddleSeat, null);
    else if (straddle.heroChancePercent === 0) assert.notEqual(state.straddleSeat, state.heroSeat);
  }
  await finishHand(session);
});

test('one hero-read accumulator observes every finished hand once and reaches tough-reg exploit threshold', async () => {
  let instances = 0;
  const observed = [];
  const contexts = [];
  const wrappedBots = { ...bots,
    createHeroReads() {
      instances++;
      const reads = bots.createHeroReads();
      return { summary: () => reads.summary(), observe(record) {
        assert.equal(record.coach, null, 'observe immediately after record construction');
        observed.push(record.id);
        reads.observe(record);
      } };
    },
    decideAction(view, profile, ctx) {
      assert.equal(profile.tier, 'toughReg');
      assert.equal(ctx.heroStats.hands, observed.length);
      contexts.push(ctx.heroStats.hands);
      assert.ok('foldToBet' in ctx.heroStats);
      return bots.decideAction(view, profile, ctx);
    },
  };
  let seed = 4000;
  const settings = { stakes: 'micro', poolOverride: { toughReg: 1 } };
  const session = createEngineSession(engine, wrappedBots, settings, {
    seedSource: () => seed++, delay: async () => {},
  });
  await session.ready;
  for (let hand = 0; hand < 32; hand++) {
    await finishHand(session, true);
    assert.equal(observed.length, hand + 1);
    if (hand < 31) await session.nextHand(settings);
  }
  assert.equal(instances, 1);
  assert.equal(new Set(observed).size, 32);
  assert.ok(contexts.includes(0));
  assert.ok(contexts.includes(30));
  assert.equal(session.getRecentHands().length, 10, 'reads span beyond the export buffer');
  let newSessionHands;
  const fresh = createEngineSession(engine, { ...bots, decideAction(view, profile, ctx) {
    newSessionHands = ctx.heroStats.hands;
    return placeholder.decideAction(view, profile, ctx);
  } }, settings, { seedSource: () => 4000, delay: async () => {} });
  await fresh.ready;
  await finishHand(fresh);
  assert.equal(newSessionHands, 0, 'a new session starts fresh');
});
