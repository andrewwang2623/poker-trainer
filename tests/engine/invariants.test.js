// Randomized invariants, determinism by seed, scenario generation and getView redaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createHand, getLegalActions, applyAction, getView, isComplete,
} from '../../src/engine/game.js';
import { createScenario } from '../../src/engine/scenario.js';
import { createRng, randInt } from '../../src/engine/rng.js';
import { STAKES, TIERS, CHIPS_PER_BB } from '../../src/shared/schemas.js';
import { assertConserved, eventsOf } from './_helpers.js';

const STAKE_IDS = Object.keys(STAKES);
const T0 = 1790000000000; // a fixed createdAt (ms since epoch)

/** A random legal action, biased toward all-ins so side pots get exercised. */
function randomAction(legal, rng) {
  const type = legal.types[Math.floor(rng() * legal.types.length)];
  if (type === 'bet' || type === 'raise') {
    const amount = rng() < 0.3 ? legal.maxTo : randInt(rng, legal.minTo, legal.maxTo);
    return { type, amount };
  }
  if (type === 'fold' && rng() < 0.5) return { type: 'call' };
  return { type };
}

function playRandomHand(seed) {
  const rng = createRng(seed);
  const scenario = createScenario({ createdAt: T0, stakes: STAKE_IDS[seed % 4], seed }, rng);
  let s = createHand(scenario);
  const startTotal = s.players.reduce((a, p) => a + p.startStack, 0);
  const actions = [];
  let guard = 0;
  while (!isComplete(s)) {
    const legal = getLegalActions(s);
    assert.ok(legal, 'an incomplete hand always has someone to act');
    assert.equal(legal.seat, s.actingSeat);
    const p = s.players[legal.seat];
    assert.ok(!p.folded && !p.allIn);
    assert.ok(legal.toCall >= 0 && legal.toCall <= p.stack);
    assert.equal(legal.maxTo, p.committedStreet + p.stack);
    if (legal.minTo) assert.ok(legal.minTo <= legal.maxTo && legal.minTo > s.currentBet);
    const action = randomAction(legal, rng);
    actions.push(action);
    s = applyAction(s, action);
    const inPlay = s.potCollected + s.players.reduce((a, q) => a + q.stack + q.committedStreet, 0);
    if (!isComplete(s)) assert.equal(inPlay, startTotal, 'chips are conserved mid-hand');
    assert.ok(++guard < 500);
  }
  return { scenario, state: s, actions };
}

test('random hands: chip conservation and structural invariants', () => {
  let showdowns = 0;
  let sidePots = 0;
  let allInEvs = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const { state: s } = playRandomHand(seed);
    assertConserved(s);
    const r = s.result;
    assert.equal(r.netChips.length, s.numPlayers);
    s.events.forEach((e, i) => assert.equal(e.seq, i));
    assert.equal(getLegalActions(s), null);
    const cap = Math.round(STAKES[s.stakes].rakeCapBb * CHIPS_PER_BB);
    assert.ok(r.rakeChips >= 0 && r.rakeChips <= cap);
    if (s.board.length < 3) assert.equal(r.rakeChips, 0);
    for (const pot of r.pots) {
      assert.ok(pot.winnerSeats.length >= 1);
      for (const w of pot.winnerSeats) assert.ok(pot.eligibleSeats.includes(w));
      for (const seat of pot.eligibleSeats) assert.ok(!s.players[seat].folded);
    }
    if (r.showdownSeats.length) {
      showdowns++;
      assert.equal(s.board.length, 5);
    }
    if (r.pots.length > 1) sidePots++;
    if (r.heroAllInEv) {
      allInEvs++;
      assert.ok(r.heroAllInEv.heroEquity >= 0 && r.heroAllInEv.heroEquity <= 1);
    }
  }
  assert.ok(showdowns > 20 && sidePots > 5 && allInEvs > 5, `coverage: ${showdowns}/${sidePots}/${allInEvs}`);
});

test('a hand is fully reproducible from ScenarioConfig plus actions', () => {
  for (const seed of [11, 12, 13]) {
    const { scenario, state, actions } = playRandomHand(seed);
    let replay = createHand(structuredClone(scenario));
    for (const a of actions) replay = applyAction(replay, a);
    assert.deepEqual(replay, state);
  }
  const a = createHand(createScenario({ createdAt: T0, stakes: 'low', seed: 99 }));
  const b = createHand(createScenario({ createdAt: T0, stakes: 'low', seed: 99 }));
  assert.deepEqual(a, b);
  const c = createHand(createScenario({ createdAt: T0, stakes: 'low', seed: 100 }));
  assert.notEqual(a.handId, c.handId);
});

test('createScenario: ranges, pool sampling and override', () => {
  const sizes = new Set();
  for (let seed = 0; seed < 500; seed++) {
    const sc = createScenario({ createdAt: T0, stakes: 'micro', seed });
    sizes.add(sc.numPlayers);
    assert.equal(sc.seed, seed);
    assert.equal(sc.seats.length, sc.numPlayers);
    assert.ok(sc.buttonSeat >= 0 && sc.buttonSeat < sc.numPlayers);
    assert.ok(sc.heroSeat >= 0 && sc.heroSeat < sc.numPlayers);
    for (const seat of sc.seats) {
      assert.equal(seat.isHero, seat.seat === sc.heroSeat);
      assert.ok(seat.stack >= 2000 && seat.stack <= 20000 && seat.stack % 100 === 0);
      assert.equal(seat.profile, null);
      if (seat.isHero) assert.equal(seat.tier, null);
      else assert.ok(TIERS.includes(seat.tier));
    }
  }
  assert.deepEqual([...sizes].sort(), [2, 3, 4, 5, 6, 7, 8, 9]);

  const onlyTough = createScenario({ createdAt: T0, stakes: 'micro', seed: 5, poolOverride: { toughReg: 3 } });
  assert.ok(onlyTough.seats.filter((s) => !s.isHero).every((s) => s.tier === 'toughReg'));
  const allZero = createScenario({ createdAt: T0, stakes: 'micro', seed: 5, poolOverride: { fish: 0 } });
  assert.equal(allZero.seats.length, createScenario({ createdAt: T0, stakes: 'micro', seed: 5 }).seats.length);
  assert.throws(() => createScenario({ createdAt: T0, stakes: 'nl2', seed: 1 }), RangeError);
});

test('getView hides the deck and other hole cards until showdown', () => {
  let s = createHand(createScenario({ createdAt: T0, stakes: 'micro', seed: 4242 }));
  const seat = s.heroSeat;
  const view = getView(s, seat);
  assert.equal('deck' in view, false);
  assert.equal('seed' in view, false);
  assert.equal(view.seat, seat);
  assert.deepEqual(view.holeCards, s.players[seat].holeCards);
  for (const p of view.players) {
    assert.deepEqual(p.holeCards, p.seat === seat ? s.players[seat].holeCards : []);
  }
  const deals = eventsOf(view, 'dealHole');
  assert.deepEqual(deals.map((e) => e.seat), [seat]);
  assert.equal(view.legal?.seat ?? null, s.actingSeat === seat ? seat : null);
  assert.equal(view.pot, s.potCollected + s.players.reduce((a, p) => a + p.committedStreet, 0));
  // The full state is untouched.
  assert.equal(s.players.every((p) => p.holeCards.length === 2), true);

  // Play to showdown by checking/calling; shown hands become visible.
  while (!isComplete(s)) {
    const legal = getLegalActions(s);
    s = applyAction(s, { type: legal.types.includes('check') ? 'check' : 'call' });
  }
  const end = getView(s, seat);
  assert.equal('seed' in end, false);
  for (const p of end.players) {
    const shown = s.result.showdownSeats.includes(p.seat) || p.seat === seat;
    assert.equal(p.holeCards.length, shown ? 2 : 0);
  }
  assert.equal(eventsOf(end, 'showdown').length, s.result.showdownSeats.length);
});
