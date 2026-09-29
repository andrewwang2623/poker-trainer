import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../../src/engine/index.js';
import * as bots from '../../src/bots/placeholder.js';
import { formatHand } from '../../src/export/index.js';
import { createEngineSession } from '../../src/ui/session.js';
import { loadStraddle, maybePostStraddle, normalizeStraddle, saveStraddle, straddlePost } from '../../src/ui/straddle.js';

const enabled = { enabled: true, chancePercent: 100 };
function scenario({ numPlayers = 7, buttonSeat = 4, heroSeat = (buttonSeat + 3) % numPlayers, seed = 123, stacks = [] } = {}) {
  return { seed, createdAt: 123456789, stakes: 'micro', numPlayers, buttonSeat, heroSeat,
    seats: Array.from({ length: numPlayers }, (_, seat) => ({ seat, isHero: seat === heroSeat,
      stack: stacks[seat] ?? 10000, tier: seat === heroSeat ? null : 'fish', profile: null })),
  };
}
const post = state => maybePostStraddle(state, enabled, () => 0);
const passive = state => engine.applyAction(state, {
  type: engine.getLegalActions(state).types.includes('check') ? 'check' : 'call',
});
function finish(state) {
  while (!engine.isComplete(state)) state = passive(state);
  return state;
}
const record = state => engine.buildHandRecord(state, { sessionId: 'straddle-test', timestamp: 123456789 });

test('straddle eligibility, probability boundaries, defaults, and persistence', () => {
  assert.deepEqual(normalizeStraddle(null), { enabled: false, chancePercent: 33 });
  const state = engine.createHand(scenario());
  for (const value of [null, { enabled: true, chancePercent: 0 }, { enabled: false, chancePercent: 100 }]) {
    assert.equal(maybePostStraddle(state, value, () => 0), state);
  }
  const settings = { enabled: true, chancePercent: 33 };
  assert.ok(straddlePost(maybePostStraddle(state, settings, () => 0.32999)));
  assert.equal(maybePostStraddle(state, settings, () => 0.33), state);
  assert.ok(straddlePost(maybePostStraddle(state, enabled, () => 0.99999)));
  for (const config of [{ numPlayers: 2, buttonSeat: 0, heroSeat: 0 }, { heroSeat: 1 }, { stacks: [200] }]) {
    const ineligible = engine.createHand(scenario(config));
    assert.equal(post(ineligible), ineligible);
  }
  const started = engine.applyAction(state, { type: 'call' });
  assert.equal(post(started), started);
  const straddled = post(state);
  assert.equal(post(straddled), straddled);
  const saved = new Map();
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  saveStraddle(settings, storage);
  assert.deepEqual(loadStraddle(storage), settings);
  assert.deepEqual(loadStraddle({ getItem: () => '{bad' }), normalizeStraddle(null));
  assert.doesNotThrow(() => saveStraddle(enabled, { setItem() { throw Error('blocked'); } }));
});

test('live straddle posts 2bb, starts left of hero, retains check/raise option and normal postflop order', () => {
  for (let numPlayers = 3; numPlayers <= 9; numPlayers++) {
    for (let buttonSeat = 0; buttonSeat < numPlayers; buttonSeat++) {
      const initial = engine.createHand(scenario({ numPlayers, buttonSeat }));
      const before = structuredClone(initial);
      let state = post(initial);
      assert.deepEqual(initial, before);
      assert.equal(state.players[state.heroSeat].stack, 9800);
      assert.equal(state.players[state.heroSeat].committedTotal, 200);
      assert.equal(state.currentBet, 200);
      assert.equal(state.lastRaiseSize, 200);
      assert.equal(state.actingSeat, (state.heroSeat + 1) % numPlayers);
      assert.equal(engine.getLegalActions(state).minTo, 400);
      assert.equal(state.preflopAggressorSeat, null);
      assert.deepEqual(state.deck, initial.deck);
      assert.deepEqual(state.players.map(p => p.holeCards), initial.players.map(p => p.holeCards));
      assert.deepEqual(state.events.map(e => e.seq), state.events.map((_, i) => i));
      while (state.actingSeat !== state.heroSeat) state = passive(state);
      assert.equal(state.street, 'preflop');
      assert.equal(engine.getLegalActions(state).toCall, 0);
      assert.deepEqual(engine.getLegalActions(state).types, ['check', 'raise']);
      state = engine.applyAction(state, { type: 'check' });
      assert.equal(state.street, 'flop');
      assert.equal(state.actingSeat, state.sbSeat);
      assert.equal(engine.getLegalActions(state).minTo, 100);
    }
  }
});

test('raises and short all-ins preserve the live straddle option', () => {
  let state = post(engine.createHand(scenario()));
  state = engine.applyAction(state, { type: 'raise', amount: 400 });
  while (state.actingSeat !== state.heroSeat) state = passive(state);
  assert.equal(engine.getLegalActions(state).toCall, 200);
  assert.equal(engine.getLegalActions(state).minTo, 600);
  state = engine.applyAction(state, { type: 'raise', amount: 600 });
  assert.equal(state.currentBet, 600);
  const short = post(engine.createHand(scenario({ stacks: [10000, 300] })));
  state = engine.applyAction(short, { type: 'raise', amount: 300 });
  while (state.actingSeat !== state.heroSeat) state = passive(state);
  assert.equal(engine.getLegalActions(state).minTo, 500);
  assert.ok(engine.getLegalActions(state).types.includes('raise'));
});

test('records count the straddle as forced chips, not a decision, VPIP, PFR, or 3-bet', () => {
  const state = finish(post(engine.createHand(scenario())));
  const hand = record(state);
  assert.equal(hand.statFlags.vpip, false);
  assert.equal(hand.statFlags.pfr, false);
  assert.equal(hand.statFlags.threeBet, false);
  assert.equal(hand.decisions[0].action.type, 'check');
  assert.equal(hand.decisions[0].stackBeforeBb, 98);
  assert.equal(hand.decisions[0].potBeforeBb, 14);
  assert.equal(hand.decisions.length, 4);
  assert.equal(hand.events.filter(e => e.type === 'postBlind').length, 3);
  assert.equal(state.result.netChips.reduce((sum, n) => sum + n, 0) + state.result.rakeChips, 0);
  assert.match(formatHand(hand), /Hero \(UTG\) posts straddle 2.0bb/);
  assert.match(formatHand(hand), /PRE[F]LOP \(pot 3.4bb\)/);
  assert.doesNotMatch(formatHand(hand), /Hero \(UTG\) posts BB/);
});

test('folds to the straddle return uncalled chips and award only the blinds without rake', () => {
  let state = post(engine.createHand(scenario()));
  while (!engine.isComplete(state)) state = engine.applyAction(state, { type: 'fold' });
  assert.equal(state.result.netChips[state.heroSeat], 140);
  assert.equal(state.result.rakeChips, 0);
  assert.equal(record(state).decisions.length, 0);
  assert.equal(state.result.netChips.reduce((sum, n) => sum + n, 0), 0);
});

test('straddled multiway side pots conserve chips after unequal river all-ins', () => {
  let state = post(engine.createHand(scenario({ numPlayers: 3, buttonSeat: 0, stacks: [10000, 5000, 3000] })));
  while (state.street !== 'river') state = passive(state);
  while (!engine.isComplete(state)) {
    const legal = engine.getLegalActions(state);
    state = engine.applyAction(state, legal.types.includes('bet')
      ? { type: 'bet', amount: legal.maxTo } : { type: 'call' });
  }
  assert.equal(state.result.pots.length, 2);
  assert.equal(state.result.netChips.reduce((sum, n) => sum + n, 0) + state.result.rakeChips, 0);
});

test('session applies straddle settings next hand and samples on a separate reproducible RNG stream', async () => {
  const localEngine = { ...engine, createScenario: opts => scenario({ seed: opts.seed }) };
  let nextSeed = 1;
  const session = createEngineSession(localEngine, bots, { stakes: 'micro', straddle: enabled }, {
    seedSource: () => nextSeed++, delay: async () => {}, now: () => 123456789,
  });
  await session.ready;
  assert.ok(straddlePost(session.getState()));
  assert.equal(session.getLegalActions().toCall, 0);
  while (!engine.isComplete(session.getState())) {
    await session.act({ type: session.getLegalActions().types.includes('check') ? 'check' : 'call' });
  }
  await session.nextHand({ stakes: 'micro', straddle: { enabled: false, chancePercent: 33 } });
  assert.equal(straddlePost(session.getState()), null);
  let hits = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const initial = engine.createHand(scenario({ seed }));
    const apply = () => maybePostStraddle(initial, { enabled: true, chancePercent: 33 },
      engine.createRng(engine.deriveSeed(seed, 'straddle')));
    const first = apply();
    assert.deepEqual(apply(), first);
    if (straddlePost(first)) hits++;
    assert.deepEqual(first.deck, initial.deck);
    assert.deepEqual(first.players.map(p => p.holeCards), initial.players.map(p => p.holeCards));
  }
  assert.ok(hits > 70 && hits < 130, `33% straddles across 300 eligible hands: ${hits}`);
});
