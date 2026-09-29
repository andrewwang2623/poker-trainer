import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../../src/engine/index.js';
import * as placeholder from '../../src/bots/placeholder.js';
import { createEngineSession } from '../../src/ui/session.js';
import { BOT_SPEEDS, botActionDelay, loadBotSpeed, normalizeBotSpeed, saveBotSpeed } from '../../src/ui/bot-speed.js';

const fixedEngine = {
  ...engine,
  createScenario: ({ seed, createdAt, stakes }) => ({
    seed, createdAt, stakes, numPlayers: 3, buttonSeat: 0, heroSeat: 2,
    seats: [0, 1, 2].map(seat => ({ seat, isHero: seat === 2, stack: 10000,
      tier: seat === 2 ? null : 'fish', profile: null })),
  }),
};

function sessionAt(speed, delay, bots = placeholder) {
  let seed = 1000;
  return createEngineSession(fixedEngine, bots, { stakes: 'micro', botSpeed: speed }, {
    seedSource: () => seed++, now: () => 123456789, sessionId: 'speed-test', delay,
  });
}

test('speed presets have bounded delays and safe persistence defaults', () => {
  const ranges = { instant: [0, 0], fast: [200, 450], normal: [400, 900], slow: [1000, 2250], study: [2000, 4500] };
  for (const { id } of BOT_SPEEDS) {
    assert.deepEqual([botActionDelay(id, 0), botActionDelay(id, 0.999999)], ranges[id]);
    assert.equal(normalizeBotSpeed(id), id);
  }
  assert.equal(normalizeBotSpeed('invalid'), 'normal');
  assert.equal(loadBotSpeed({ getItem: () => 'invalid' }), 'normal');
  assert.equal(loadBotSpeed({ getItem() { throw Error('blocked'); } }), 'normal');
  const saved = new Map();
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  saveBotSpeed('study', storage);
  assert.equal(loadBotSpeed(storage), 'study');
  assert.doesNotThrow(() => saveBotSpeed('slow', { setItem() { throw Error('blocked'); } }));
});

test('each bot waits before acting; a live speed change affects subsequent waits and hands', async () => {
  const waits = [];
  let release;
  const session = sessionAt('normal', ms => {
    waits.push(ms);
    return waits.length === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  });
  await Promise.resolve();
  assert.equal(waits.length, 1);
  assert.equal(session.getState().events.filter(event => event.type === 'action').length, 0);
  session.setBotSpeed('study');
  release();
  await session.ready;
  assert.ok(waits[0] >= 400 && waits[0] <= 900);
  assert.ok(waits.length >= 2);
  assert.ok(waits.slice(1).every(ms => ms >= 2000 && ms <= 4500));
  while (!engine.isComplete(session.getState())) {
    const legal = session.getLegalActions();
    await session.act({ type: legal.types.includes('check') ? 'check' : 'call' });
  }
  const botActions = session.getState().events.filter(event => event.type === 'action' && event.seat !== 2);
  assert.equal(waits.length, botActions.length);
  const count = waits.length;
  await session.nextHand({ stakes: 'micro' });
  assert.ok(waits.slice(count).every(ms => ms >= 2000 && ms <= 4500));
});

test('changing playback speed preserves cards and the seeded bot decision stream', async () => {
  let baseline;
  for (const { id } of BOT_SPEEDS) {
    const draws = [];
    const bots = { ...placeholder, decideAction(view, profile, context) {
      draws.push(context.rng());
      return placeholder.decideAction(view, profile, context);
    } };
    const session = sessionAt(id, async () => {}, bots);
    await session.ready;
    while (!engine.isComplete(session.getState())) {
      const legal = session.getLegalActions();
      await session.act({ type: legal.types.includes('check') ? 'check' : 'call' });
    }
    const result = { events: session.getState().events, draws };
    if (!baseline) baseline = result;
    else assert.deepEqual(result, baseline);
  }
});
