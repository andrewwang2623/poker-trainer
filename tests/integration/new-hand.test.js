import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../../src/engine/index.js';
import * as bots from '../../src/bots/placeholder.js';
import { createHeroReads } from '../../src/bots/index.js';
import * as exporter from '../../src/export/index.js';
import { createEngineSession } from '../../src/ui/session.js';
import { mountApp } from '../../src/ui/index.js';
import { Node, setup } from './bounty-dom.js';

function fixture({ delay = async () => {}, settings = {}, tracker: suppliedTracker, heroSeat = 0 } = {}) {
  let seed = 10;
  const scenarios = [];
  const observed = [];
  const contexts = [];
  // The optional tracker module is not installed yet; exercise its recording boundary.
  const records = [];
  const tracker = suppliedTracker ?? {
    async recordHand(record) { records.push(record); },
    async getRecentHands() { return records.slice().reverse(); },
    async exportJSON() { return JSON.stringify({ hands: records }); },
  };
  const session = createEngineSession({ ...engine, createScenario(options) {
    scenarios.push(structuredClone(options));
    return { ...options, numPlayers: 2, buttonSeat: 0, heroSeat,
      seats: [0, 1].map(seat => ({ seat, isHero: seat === heroSeat, stack: 10000,
        tier: seat === heroSeat ? null : 'toughReg' })) };
  } }, { ...bots, createHeroReads() {
    const reads = createHeroReads();
    return { summary: () => reads.summary(), observe(record) {
      observed.push(record.id); reads.observe(record);
    } };
  }, decideAction(view, profile, ctx) {
    contexts.push({ id: view.handId, hands: ctx.heroStats.hands });
    return bots.decideAction(view, profile, ctx);
  } }, settings, { delay, tracker, seedSource: () => seed++, now: () => 123456789, sessionId: 'new-hand' });
  return { session, tracker, observed, contexts, scenarios };
}

async function checkCall(session) {
  await session.act({ type: session.getLegalActions().types.includes('check') ? 'check' : 'call' });
}
async function finish(session) {
  while (!engine.isComplete(session.getState())) await checkCall(session);
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

for (const street of ['preflop', 'river']) test(`new hand abandons mid-${street} without recording or learning it`, async () => {
  const { session, tracker, observed, contexts } = fixture();
  await session.ready;
  await finish(session);
  const completed = session.getState().handId;
  await session.newHand();
  while (session.getState().street !== street) await checkCall(session);
  const abandoned = session.getState().handId;
  const oldSeed = session.getState().seed;
  await session.newHand();
  assert.equal(session.getState().street, 'preflop');
  assert.notEqual(session.getState().seed, oldSeed);
  assert.notEqual(session.getState().handId, abandoned);
  assert.deepEqual(session.getState().board, []);
  await checkCall(session);
  assert.equal(contexts.at(-1).hands, 1);
  assert.deepEqual(observed, [completed]);
  assert.deepEqual(session.getRecentHands().map(record => record.id), [completed]);
  assert.deepEqual((await tracker.getRecentHands(10)).map(record => record.id), [completed]);
  assert.ok(!exporter.formatHands(session.getRecentHands()).includes(abandoned));
  assert.ok(!(await tracker.exportJSON()).includes(abandoned));
});

test('replacing during bot waits settles old actions and never releases the new loop lock', async () => {
  const waits = [];
  const { session, contexts, observed } = fixture({ delay: () => new Promise(resolve => waits.push(resolve)) });
  await session.ready;
  const first = session.act({ type: 'call' });
  const abandoned = session.getState().handId;
  assert.equal(waits.length, 1);
  await session.newHand();
  await first; // Cancellation settles even if the injected delay never cooperates.
  const second = session.act({ type: 'call' });
  const before = structuredClone(session.getState());
  waits[0]();
  await flush();
  assert.deepEqual(session.getState(), before);
  assert.deepEqual(contexts, []);
  assert.deepEqual(observed, []);
  await assert.rejects(session.act({ type: 'check' }), /Hero is not acting/);
  waits[1]();
  await flush();
  assert.equal(waits.length, 3); // BB check preflop, then its flop action.
  waits[2]();
  await second;
  assert.ok(contexts.every(ctx => ctx.id !== abandoned));
  assert.equal(session.getState().street, 'flop');
  assert.ok(session.getLegalActions());
});

test('new hand preserves all scenario settings and live speed choices', async () => {
  const settings = { stakes: 'high', poolOverride: { fish: 0.1, lowReg: 0.2, midReg: 0.3, toughReg: 0.4 },
    straddle: { enabled: true, heroChancePercent: 73 },
    bounty: { hand: { enabled: true, chance: 0.8, amountBb: 4 },
      card: { enabled: true, chance: 0.6, amountBb: 3 }, paysOn: 'showdownOnly' },
    botSpeed: 'study', botPacing: true, outBotSpeed: 'fast' };
  const original = structuredClone(settings);
  const waits = [];
  const { session, scenarios } = fixture({ settings, delay: async ms => waits.push(ms) });
  await session.ready;
  await session.newHand();
  await checkCall(session);
  const { seed: a, ...first } = scenarios[0];
  const { seed: b, ...second } = scenarios[1];
  assert.notEqual(a, b);
  assert.deepEqual(first, second);
  assert.deepEqual(settings, original);
  assert.ok(waits.length > 0 && waits.every(ms => ms >= 2000 && ms <= 4500));
});

test('completed hand persists once even when replaced while tracker save is pending', async () => {
  let release;
  const saved = [];
  const { session, observed } = fixture({ tracker: { recordHand(record) {
    saved.push(record.id);
    return new Promise(resolve => { release = resolve; });
  } } });
  await session.ready;
  const ending = session.act({ type: 'fold' });
  const completed = session.getState().handId;
  assert.equal(session.getState().street, 'complete');
  await session.newHand();
  const next = session.getState().handId;
  release();
  await ending;
  assert.equal(session.getState().handId, next);
  assert.deepEqual(saved, [completed]);
  assert.deepEqual(observed, [completed]);
  assert.deepEqual(session.getRecentHands().map(record => record.id), [completed]);
});

test('New hand stays enabled during bot actions, cancels the timer, and preserves UI preferences', async t => {
  const storage = setup(t);
  storage.setItem('felt-theory-action-timer', JSON.stringify({ enabled: true, seconds: 30 }));
  storage.setItem('felt-theory-appearance', JSON.stringify({ theme: 'midnight', textSize: 'large' }));
  const callbacks = [];
  const cancelled = [];
  t.mock.method(globalThis, 'setTimeout', callback => { callbacks.push(callback); return callbacks.length; });
  t.mock.method(globalThis, 'clearTimeout', handle => cancelled.push(handle));
  const waits = [];
  const { session } = fixture({ delay: () => new Promise(resolve => waits.push(resolve)) });
  await session.ready;
  const root = new Node('div');
  const app = mountApp(root, { session });
  t.after(() => app.destroy());
  const preferences = ['felt-theory-action-timer', 'felt-theory-appearance'].map(key => storage.getItem(key));
  const theme = document.documentElement.dataset.theme;
  const timerCallback = callbacks[0];
  const initial = session.getState().handId;
  assert.equal(root.querySelector('.new-hand').textContent, 'New hand');
  await root.querySelector('.new-hand').events.click();
  assert.notEqual(session.getState().handId, initial);
  assert.ok(cancelled.includes(1));
  const fresh = structuredClone(session.getState());
  timerCallback();
  assert.deepEqual(session.getState(), fresh);
  const acting = root.querySelector('.basic-actions').children[1].events.click();
  assert.equal(root.querySelector('.new-hand').disabled, false);
  await root.querySelector('.new-hand').events.click();
  const after = structuredClone(session.getState());
  waits[0]();
  await acting;
  await flush();
  assert.deepEqual(session.getState(), after);
  assert.equal(root.querySelector('.new-hand').disabled, false);
  assert.deepEqual(['felt-theory-action-timer', 'felt-theory-appearance'].map(key => storage.getItem(key)), preferences);
  assert.equal(document.documentElement.dataset.theme, theme);
  assert.match(root.querySelector('.action-timer').textContent, /30s left/);
});


test('rapid replacements cancel native bot timeouts, including the opening bot loop', async t => {
  const callbacks = [];
  const cancelled = [];
  t.mock.method(globalThis, 'setTimeout', callback => { callbacks.push(callback); return callbacks.length; });
  t.mock.method(globalThis, 'clearTimeout', handle => cancelled.push(handle));
  const { session, contexts } = fixture({ delay: null, heroSeat: 1 });
  await Promise.resolve();
  assert.equal(callbacks.length, 1);
  const second = session.newHand();
  const third = session.newHand();
  assert.deepEqual(cancelled, [1, 2]);
  const fresh = structuredClone(session.getState());
  callbacks[0]();
  callbacks[1]();
  await session.ready;
  await second;
  assert.deepEqual(session.getState(), fresh);
  assert.deepEqual(contexts, []);
  callbacks[2]();
  await third;
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].id, fresh.handId);
  assert.ok(session.getLegalActions());
});
