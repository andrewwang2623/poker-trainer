import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/main.js';

test('main wiring plays 50 random full hands with the available bots', async () => {
  let nextSeed = 1000;
  const app = await createApp({ stakes: 'micro', poolOverride: null }, {
    seedSource: () => nextSeed++, delay: async () => {},
  });
  const realBots = await import('../../src/bots/index.js').catch(() => null);
  assert.equal(app.features.realBots, Boolean(realBots?.decideAction && realBots?.createBotProfile));
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
