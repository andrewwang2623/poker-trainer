import * as engine from '../../src/engine/index.js';

export function bountyHand({ live = true, paysOn = 'showdownOrFold', hero = 0, targets = ['J4o', '4c'], stacks = [10000, 10000] } = {}) {
  return engine.createHand({
    seed: 42, createdAt: 1790000000000, stakes: 'micro', numPlayers: 2, buttonSeat: 0, heroSeat: hero,
    seats: stacks.map((stack, seat) => ({ seat, stack, isHero: seat === hero, tier: seat === hero ? null : 'fish', profile: null })),
    bounties: live ? targets.map((target, i) => ({ type: i === 0 ? 'hand' : 'card', target, amountChips: 200, paysOn })) : [],
  }, { cards: { holes: { 0: ['Jh', '4c'], 1: ['Ah', 'Kd'] }, board: ['Jd', '4h', '8s', '2s', '9c'] } });
}

export function finish(state, fold = false) {
  if (fold) {
    state = engine.applyAction(state, { type: 'raise', amount: 300 });
    return engine.applyAction(state, { type: 'fold' });
  }
  while (!engine.isComplete(state)) {
    state = engine.applyAction(state, { type: engine.getLegalActions(state).toCall ? 'call' : 'check' });
  }
  return state;
}
