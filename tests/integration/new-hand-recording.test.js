import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../../src/engine/index.js';
import * as bots from '../../src/bots/placeholder.js';
import { createHeroReads } from '../../src/bots/index.js';
import { createEngineSession } from '../../src/ui/session.js';
import { createMemoryStore } from '../../src/data/index.js';
import { createTracker } from '../../src/tracker/index.js';
import { mountApp } from '../../src/ui/index.js';
import { createFakeCoach } from './fake-coach.js';
import { Node, setup } from './bounty-dom.js';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function fixture({ heroSeat = 0, heroStack = 10000, paced = true, botAction = bots.decideAction } = {}) {
  let seed = 10;
  let deals = 0;
  const waits = [];
  const observed = [];
  const contexts = [];
  const coach = createFakeCoach();
  const tracker = createTracker(createMemoryStore(), { sessionId: 'skip-finished' });
  const session = createEngineSession({ ...engine, createScenario(options) {
    const hero = deals++ === 0 ? heroSeat : 0;
    return { ...options, numPlayers: 3, buttonSeat: 0, heroSeat: hero,
      seats: [0, 1, 2].map(seat => ({ seat, isHero: seat === hero,
        stack: deals === 1 && seat === hero ? heroStack : 10000,
        tier: seat === hero ? null : 'toughReg' })) };
  } }, { ...bots, createHeroReads() {
    const reads = createHeroReads();
    return { summary: () => reads.summary(), observe(record) {
      observed.push(record.id); reads.observe(record);
    } };
  }, decideAction(view, profile, ctx) {
    contexts.push({ id: view.handId, hands: ctx.heroStats.hands });
    return botAction(view, profile, ctx);
  } }, { stakes: 'micro' }, {
    tracker, coach, sessionId: 'skip-finished', seedSource: () => seed++, now: () => 123456789,
    delay: paced ? () => new Promise(resolve => waits.push(resolve)) : async () => {},
  });
  return { session, tracker, coach, observed, contexts, waits };
}

for (const action of ['fold', 'allIn']) test(`New hand completes and records ${action} without bot delays`, async () => {
  const f = fixture({ heroStack: action === 'allIn' ? 2000 : 10000 });
  await f.session.ready;
  const old = f.session.getState().handId;
  const chosen = action === 'fold' ? { type: 'fold' } : { type: 'raise', amount: 2000 };
  const acting = f.session.act(chosen);
  await flush();
  assert.equal(f.waits.length, 1);
  assert.equal(engine.isComplete(f.session.getState()), false);
  await f.session.newHand();
  await acting;
  assert.notEqual(f.session.getState().handId, old);
  assert.equal(f.waits.length, 1, 'no additional delays while completing the old hand');
  const [record] = await f.tracker.getRecentHands(10);
  assert.equal(record?.id, old);
  assert.equal(record.decisions.length, 1);
  assert.equal(record.decisions[0].action.type, chosen.type);
  assert.equal(record.decisions[0].allIn, action === 'allIn');
  assert.ok(record.result);
  assert.ok(record.coach);
  assert.deepEqual(f.observed, [old]);
  assert.equal(f.coach.calls.analyze.length, 1);
  assert.deepEqual(f.session.getRecentHands(), [record]);
  assert.equal((await f.tracker.getStats('session')).hands, 1);

  const next = structuredClone(f.session.getState());
  f.waits[0](); // A late completion from the cancelled timer cannot touch the next hand.
  await flush();
  assert.deepEqual(f.session.getState(), next);
  const nextAction = f.session.act({ type: 'call' });
  await flush();
  f.waits[1]();
  await flush();
  assert.equal(f.contexts.at(-1).hands, 1, 'future bots receive the recorded hero read');
  await f.session.newHand(); // Hero is still active: cancel and discard this second hand.
  await nextAction;
  assert.equal((await f.tracker.getStats('all')).hands, 1);
});

test('New hand records a hero all-in from a forced post without inventing a decision', async () => {
  const f = fixture({ heroSeat: 1, heroStack: 40 });
  await flush();
  const old = f.session.getState().handId;
  assert.equal(f.session.getState().players[1].allIn, true);
  assert.equal(f.waits.length, 1);
  await f.session.newHand();
  await f.session.ready;
  const [record] = await f.tracker.getRecentHands(10);
  assert.equal(record?.id, old);
  assert.deepEqual(record.decisions, []);
  assert.equal(record.statFlags.vpip, false);
  assert.deepEqual(f.observed, [old]);
  assert.equal(f.waits.length, 1);
});

test('mounted New hand records a folded hand and matches normal paced completion', async t => {
  setup(t);
  const botAction = (view, profile, ctx) => {
    const roll = ctx.rng();
    return roll < .5 && view.legal.types.includes('bet')
      ? { type: 'bet', amount: view.legal.minTo } : bots.decideAction(view, profile, ctx);
  };
  const baseline = fixture({ paced: false, botAction });
  await baseline.session.ready;
  await baseline.session.act({ type: 'fold' });
  const expected = baseline.session.getRecentHands()[0];
  const f = fixture({ botAction });
  await f.session.ready;
  const root = new Node('div');
  const mounted = mountApp(root, { session: f.session });
  t.after(() => mounted.destroy());
  const folding = root.querySelector('.basic-actions').children[0].events.click();
  await flush();
  assert.equal(f.session.getState().players[0].folded, true);
  assert.equal(root.querySelector('.new-hand').disabled, false);
  await root.querySelector('.new-hand').events.click();
  await folding;
  assert.deepEqual(f.session.getRecentHands(), [expected]);
  assert.deepEqual(await f.tracker.getRecentHands(10), [expected]);
  assert.equal(root.querySelector('.new-hand').disabled, false);
});

test('skipping after a flop fold retains hero investments, decisions and VPIP', async () => {
  const f = fixture({ botAction: (view, profile, ctx) => view.street === 'flop' && view.legal.types.includes('bet')
    ? { type: 'bet', amount: view.legal.minTo } : bots.decideAction(view, profile, ctx) });
  await f.session.ready;
  const calling = f.session.act({ type: 'call' });
  for (let i = 0; i < 4; i++) { await flush(); f.waits[i](); }
  await calling;
  assert.equal(f.session.getState().street, 'flop');
  const folding = f.session.act({ type: 'fold' });
  await flush();
  assert.equal(f.waits.length, 5);
  await f.session.newHand();
  await folding;
  const [record] = await f.tracker.getRecentHands(10);
  assert.deepEqual(record.decisions.map(decision => decision.action.type), ['call', 'fold']);
  assert.equal(record.heroNetBb, -1);
  assert.equal(record.heroEvNetBb, -1);
  assert.equal(record.statFlags.vpip, true);
  assert.equal(record.statFlags.sawFlop, true);
  assert.equal(f.waits.length, 5);
});
