import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_TYPES, SCHEMA_VERSION, STAKES, TIERS } from '../../src/shared/schemas.js';
import { createMockGameState, createMockSession, getMockLegalActions } from '../../src/ui/mock.js';

const STATE_KEYS = [
  'schemaVersion', 'handId', 'seed', 'stakes', 'numPlayers', 'buttonSeat', 'sbSeat', 'bbSeat',
  'heroSeat', 'players', 'street', 'board', 'deck', 'potCollected', 'currentBet',
  'lastRaiseSize', 'actingSeat', 'lastAggressorSeat', 'preflopAggressorSeat', 'events', 'result',
];
const PLAYER_KEYS = [
  'seat', 'name', 'isHero', 'position', 'profile', 'startStack', 'stack',
  'committedStreet', 'committedTotal', 'holeCards', 'folded', 'allIn', 'hasActed',
];
const PROFILE_KEYS = [
  'id', 'name', 'tier', 'avatar', 'vpip', 'pfr', 'threeBet', 'aggression', 'bluffFreq',
  'foldToBet', 'skill', 'usesCharts', 'textureSizing', 'mixing', 'exploitsHero',
];
const EVENT_KEYS = {
  postBlind: ['seq', 'type', 'street', 'seat', 'blind', 'amount'],
  dealHole: ['seq', 'type', 'street', 'seat', 'cards'],
  action: ['seq', 'type', 'street', 'seat', 'action', 'amount', 'to', 'allIn', 'potBefore', 'toCall', 'stackBefore'],
  board: ['seq', 'type', 'street', 'cards'],
  showdown: ['seq', 'type', 'street', 'seat', 'cards', 'handLabel'],
  rake: ['seq', 'type', 'street', 'amount'],
  award: ['seq', 'type', 'street', 'seat', 'amount', 'potIndex'],
};

function keys(value) { return Object.keys(value).sort(); }

function checkShape(state) {
  assert.deepEqual(keys(state), [...STATE_KEYS].sort());
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.equal(state.players.length, state.numPlayers);
  for (const player of state.players) {
    assert.deepEqual(keys(player), [...PLAYER_KEYS].sort());
    if (player.profile) {
      assert.deepEqual(keys(player.profile), [...PROFILE_KEYS].sort());
      assert.ok(TIERS.includes(player.profile.tier));
    }
  }
  for (const [index, event] of state.events.entries()) {
    assert.deepEqual(keys(event), EVENT_KEYS[event.type].sort());
    assert.equal(event.seq, index);
    if (event.type === 'action') assert.ok(ACTION_TYPES.includes(event.action));
  }
}

test('mock state and every event match the shared schema', () => {
  const state = createMockGameState();
  checkShape(state);
  const cards = [...state.players.flatMap(player => player.holeCards), ...state.deck];
  assert.equal(cards.length, 52);
  assert.equal(new Set(cards).size, 52);
  assert.equal(state.players[state.heroSeat].profile, null);
  assert.deepEqual(getMockLegalActions(state), {
    seat: 3, types: ['fold', 'call', 'raise'], toCall: 100, minTo: 200, maxTo: 10000,
  });
});

test('mock action stream reaches a complete showdown with chip conservation', () => {
  const session = createMockSession();
  session.act({ type: 'call' });
  assert.equal(session.getState().street, 'flop');
  assert.deepEqual(session.getState().board, ['Ah', '7d', '2c']);
  session.act({ type: 'bet', amount: 150 });
  session.act({ type: 'check' });
  session.act({ type: 'check' });
  const state = session.getState();
  checkShape(state);
  assert.equal(state.street, 'complete');
  assert.deepEqual(state.board, ['Ah', '7d', '2c', '9s', '3h']);
  assert.equal(state.result.netChips.reduce((sum, net) => sum + net, 0) + state.result.rakeChips, 0);
  assert.deepEqual(state.result.showdownSeats, [3, 5]);
});

test('fold awards the blind pot, and next hand applies stakes and mix', () => {
  const session = createMockSession();
  session.act({ type: 'fold' });
  assert.equal(session.getState().street, 'complete');
  assert.equal(session.getState().result.rakeChips, 0);
  session.nextHand({ stakes: 'high', poolOverride: { fish: 0, lowReg: 0, midReg: 0, toughReg: 1 } });
  const state = session.getState();
  checkShape(state);
  assert.equal(state.stakes, 'high');
  assert.equal(state.players[4].committedStreet, STAKES.high.sbChips);
  assert.ok(state.players.filter(player => !player.isHero).every(player => player.profile.tier === 'toughReg'));
});
