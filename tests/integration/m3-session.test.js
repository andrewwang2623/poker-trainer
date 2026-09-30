import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../../src/engine/index.js';
import * as bots from '../../src/bots/index.js';
import * as placeholder from '../../src/bots/placeholder.js';
import * as explain from '../../src/explain/index.js';
import * as exporter from '../../src/export/index.js';
import * as data from '../../src/data/index.js';
import { createApp } from '../../src/main.js';
import { createTracker } from '../../src/tracker/index.js';
import { createEngineSession } from '../../src/ui/session.js';
import { mountApp } from '../../src/ui/index.js';
import { Node, setup, text } from './bounty-dom.js';
import { createFakeCoach } from './fake-coach.js';
import { recordFixture } from '../tracker/fixtures.js';

async function finish(session) {
  await session.ready;
  for (let i = 0; !engine.isComplete(session.getState()); i++) {
    assert.ok(i < 200);
    const legal = session.getLegalActions();
    await session.act({ type: legal.types.includes('check') ? 'check' : 'call' });
  }
}

test('coach API uses its own RNG, stores results once and renders explained feedback for the current hand', async t => {
  const coach = createFakeCoach();
  const tracker = createTracker(data.createMemoryStore(), { sessionId: 'm3' });
  let seed = 1000;
  const session = createEngineSession(engine, placeholder, { stakes: 'micro' }, {
    coach, tracker, sessionId: 'm3', seedSource: () => seed++, delay: async () => {},
  });
  await finish(session);
  const record = session.getRecentHands()[0];
  assert.equal(coach.calls.analyze.length, 1);
  assert.equal(coach.calls.analyze[0].draw, engine.createRng(engine.deriveSeed(record.seed, 'coach'))());
  assert.deepEqual((await tracker.getRecentHands(1))[0].coach, record.coach);
  assert.match(exporter.formatHand(record, { explain: explain.explainFlag }), /COACH FLAGS:.*|COACH FLAGS:/);
  assert.match(exporter.formatHand(record, { explain: explain.explainFlag }), /Explanation:/);
  setup(t);
  const root = new Node('div');
  const mounted = mountApp(root, { session, coach, tracker, explain, exporter, features: { coach: true, export: true, explain: true } });
  t.after(() => mounted.destroy());
  const panel = root.querySelector('.coach-panel');
  assert.ok(panel);
  assert.match(text(panel), /Estimated EV loss/);
  assert.match(text(panel), new RegExp(explain.explainFlag(record.coach.flags[0]).title));
  await session.newHand();
  assert.equal(root.querySelector('.coach-panel'), null);
  assert.equal((await tracker.getStats('all')).hands, 1);
});

test('New hand abandons incomplete hands; rapid navigation after completion still records once', async () => {
  const tracker = createTracker(data.createMemoryStore(), { sessionId: 'm3' });
  const coach = createFakeCoach();
  let seed = 1000;
  const session = createEngineSession(engine, placeholder, { stakes: 'micro' }, {
    tracker, coach, sessionId: 'm3', seedSource: () => seed++, delay: async () => {},
  });
  await session.ready;
  const abandoned = session.getState().handId;
  await session.newHand();
  await finish(session);
  assert.equal((await tracker.getRecentHands(10)).some(record => record.id === abandoned), false);
  let switched = false;
  const unsubscribe = session.subscribe(() => {
    if (engine.isComplete(session.getState()) && !switched) { switched = true; session.newHand(); }
  });
  await session.newHand(); await finish(session); unsubscribe();
  const records = await tracker.getRecentHands(10);
  assert.equal(new Set(records.map(record => record.id)).size, records.length);
  assert.equal(coach.calls.analyze.length, records.length);
});

test('bots receive tracker session StatsSummary at thirty hands and reads below that threshold', async () => {
  const store = data.createMemoryStore();
  await store.putMany(Array.from({ length: 30 }, (_, i) => recordFixture(i, { sessionId: 'm3' })));
  const tracker = createTracker(store, { sessionId: 'm3' });
  const contexts = [];
  let seed = 1000;
  const session = createEngineSession(engine, { ...bots, decideAction(view, profile, ctx) {
    contexts.push(ctx.heroStats); return placeholder.decideAction(view, profile, ctx);
  } }, { stakes: 'micro' }, { tracker, sessionId: 'm3', seedSource: () => seed++, delay: async () => {} });
  await finish(session);
  assert.ok(contexts.length);
  assert.ok(contexts.every(stats => stats.hands === 30 && stats.window === 'session' && 'profitability' in stats));
  assert.equal((await tracker.getStats('session')).hands, 31);
});

test('liveOdds receives redacted hero view and active profiles; odds draws do not affect completed hands', async () => {
  let seed = 1000;
  const coach = createFakeCoach();
  const session = createEngineSession(engine, placeholder, { stakes: 'micro' }, {
    coach, seedSource: () => seed++, delay: async () => {},
  });
  await session.ready;
  assert.deepEqual(session.getLiveOdds(), { equity: .6, potOdds: .25 });
  const call = coach.calls.odds[0];
  assert.equal('seed' in call.view, false); assert.equal('deck' in call.view, false);
  assert.ok(call.view.players.filter(p => !p.isHero).every(p => p.holeCards.length === 0));
  assert.ok(call.opponents.every(profile => profile?.tier));
  assert.deepEqual(session.getLiveOdds(), session.getLiveOdds());
  await finish(session);
  assert.equal(session.getLiveOdds(), null);
  const baseline = createEngineSession(engine, placeholder, { stakes: 'micro' }, { seedSource: () => 1000, delay: async () => {} });
  await finish(baseline);
  assert.deepEqual(session.getState().events, baseline.getState().events);
});

test('app with no coach records and exports without coach controls; failed IndexedDB uses memory', async t => {
  let seed = 1000;
  const app = await createApp({ stakes: 'micro' }, { modules: { coach: null, data: { ...data,
    openHandStore: async () => { throw new Error('denied'); } } }, seedSource: () => seed++, delay: async () => {} });
  await finish(app.session);
  assert.equal(app.coach, null); assert.equal(app.features.coach, false);
  assert.equal(app.storageMode, 'memory'); assert.ok(app.features.dashboard);
  assert.equal((await app.tracker.getStats('all')).hands, 1);
  assert.equal(app.session.getRecentHands()[0].coach, null);
  assert.doesNotMatch(app.exporter.formatHand(app.session.getRecentHands()[0]), /COACH FLAGS/);
  setup(t);
  const root = new Node('div'); const mounted = mountApp(root, app); t.after(() => mounted.destroy());
  assert.equal(root.querySelector('.coach-panel'), null); assert.equal(root.querySelector('.live-odds'), null);
});

test('coach or store runtime errors preserve the completed hand and next-hand play', async () => {
  let seed = 1000;
  const session = createEngineSession(engine, placeholder, { stakes: 'micro' }, {
    coach: { analyzeHand() { throw new Error('coach failed'); } },
    tracker: { async recordHand() { throw new Error('disk failed'); } }, seedSource: () => seed++, delay: async () => {},
  });
  await finish(session);
  const record = session.getRecentHands()[0];
  assert.equal(record.coach, null);
  assert.match(session.getCompletionError(record.id), /coach failed.*disk failed/);
  await session.nextHand(); assert.equal(session.getState().street, 'preflop');
});

test('native straddled and bounty hands reach tracker unchanged and keep bounty-free winrates', async () => {
  const coach = createFakeCoach();
  const tracker = createTracker(data.createMemoryStore(), { sessionId: 'm3' });
  const settings = { stakes: 'micro', straddle: { enabled: true, heroChancePercent: 100 },
    bounty: { hand: { enabled: true, chance: 1, amountBb: 2 }, card: { enabled: true, chance: 1, amountBb: 2 }, paysOn: 'showdownOrFold' } };
  let seed = 1;
  const session = createEngineSession(engine, placeholder, settings, {
    tracker, coach, sessionId: 'm3', seedSource: () => seed++, delay: async () => {},
  });
  let straddled = false;
  for (let i = 0; i < 12; i++) {
    await finish(session);
    const state = session.getState();
    const record = session.getRecentHands()[0];
    straddled ||= record.straddleSeat != null;
    assert.equal(record.bounties.length, 2);
    assert.equal(record.heroNetBb, state.result.netChips[state.heroSeat] / 100);
    assert.equal(record.heroBountyBb, state.result.bountyNetChips[state.heroSeat] / 100);
    assert.deepEqual((await tracker.getRecentHands(1))[0], record);
    if (i < 11) await session.nextHand();
  }
  assert.ok(straddled);
  const records = await tracker.getRecentHands(100);
  const stats = await tracker.getStats('all');
  assert.equal(stats.hands, 12);
  assert.ok(Math.abs(stats.bbPer100 - 100 * records.reduce((n, r) => n + r.heroNetBb, 0) / 12) < 1e-9);
  assert.ok(Math.abs(stats.bbPer100WithBounty - stats.bbPer100 - stats.bountyPer100) < 1e-9);
});
