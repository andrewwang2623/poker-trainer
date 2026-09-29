// Bounties (SPEC §15): scenario draw, settlement, records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRng, deriveSeed, createScenario, createHand, drawBounties, normalizeBountyOption, handClass,
  HAND_STRENGTH_ORDER, BOUNTY_HAND_TARGETS, BOUNTY_CARD_TARGETS,
} from '../../src/engine/index.js';
import { BOUNTY_DEFAULTS, BOUNTY_HAND_POOL, BOUNTY_CARD_RANKS } from '../../src/shared/schemas.js';

const T0 = 1790000000000;
const scenarioFor = (seed, bounty, extra = {}) =>
  createScenario({ stakes: 'micro', seed, createdAt: T0, bounty, ...extra }, createRng(seed));
const both = (chance, amountBb = 2, paysOn) => ({
  hand: { enabled: true, chance, amountBb }, card: { enabled: true, chance, amountBb }, ...(paysOn ? { paysOn } : {}),
});

test('the 169-class ranking lives in the engine; bounty pools are its weakest 84 classes and the 2–7 cards', () => {
  assert.equal(HAND_STRENGTH_ORDER.length, 169);
  assert.equal(new Set(HAND_STRENGTH_ORDER).size, 169);
  assert.equal(HAND_STRENGTH_ORDER[0], 'AA');
  assert.equal(HAND_STRENGTH_ORDER[168], '32o');
  assert.equal(BOUNTY_HAND_TARGETS.length, BOUNTY_HAND_POOL);
  assert.deepEqual([...BOUNTY_HAND_TARGETS], HAND_STRENGTH_ORDER.slice(169 - BOUNTY_HAND_POOL));
  assert.ok(!BOUNTY_HAND_TARGETS.includes('A2o') && !BOUNTY_HAND_TARGETS.includes('98s'));
  assert.ok(BOUNTY_HAND_TARGETS.includes('72o') && BOUNTY_HAND_TARGETS.includes('J5s'));
  assert.equal(BOUNTY_CARD_TARGETS.length, 24);
  assert.ok(BOUNTY_CARD_TARGETS.every((c) => BOUNTY_CARD_RANKS.includes(c[0])));
});

test('bounties are off by default and when disabled', () => {
  assert.deepEqual(normalizeBountyOption(undefined), BOUNTY_DEFAULTS);
  for (let seed = 1; seed <= 200; seed++) {
    assert.deepEqual(scenarioFor(seed).bounties, []);
    assert.deepEqual(scenarioFor(seed, BOUNTY_DEFAULTS).bounties, []);
    assert.deepEqual(scenarioFor(seed, { hand: { enabled: false, chance: 1 }, card: { enabled: false, chance: 1 } }).bounties, []);
  }
});

test('bad bounty options throw', () => {
  for (const bad of [5, 'on', { hand: { enabled: 'yes' } }, { card: { enabled: true, chance: 1.2 } },
    { hand: { enabled: true, chance: -0.1 } }, { hand: { enabled: true, amountBb: 0 } },
    { card: { enabled: true, amountBb: Infinity } }, { paysOn: 'always' }, { hand: { chance: '0.5' } }]) {
    assert.throws(() => scenarioFor(1, bad), RangeError, JSON.stringify(bad));
  }
  // Partial options fill from the defaults.
  assert.deepEqual(normalizeBountyOption({ card: { enabled: true } }), {
    hand: { ...BOUNTY_DEFAULTS.hand }, card: { enabled: true, chance: 0.05, amountBb: 2 }, paysOn: 'showdownOrFold',
  });
});

test('frequencies match the chance per type; targets come only from the allowed pools', () => {
  const N = 20000;
  const count = { hand: 0, card: 0, both: 0 };
  const handTargets = new Map();
  const cardTargets = new Map();
  for (let seed = 1; seed <= N; seed++) {
    const bounties = drawBounties(seed, both(0.3, 1.5, 'showdownOnly'));
    const types = bounties.map((b) => b.type);
    assert.ok(types.length <= 2 && (types.length < 2 || (types[0] === 'hand' && types[1] === 'card')), 'hand first');
    for (const b of bounties) {
      count[b.type]++;
      assert.equal(b.amountChips, 150);
      assert.equal(b.paysOn, 'showdownOnly');
      const seen = b.type === 'hand' ? handTargets : cardTargets;
      seen.set(b.target, (seen.get(b.target) ?? 0) + 1);
    }
    if (bounties.length === 2) count.both++;
  }
  assert.ok(Math.abs(count.hand / N - 0.3) < 0.015, `hand ${count.hand / N}`);
  assert.ok(Math.abs(count.card / N - 0.3) < 0.015, `card ${count.card / N}`);
  assert.ok(Math.abs(count.both / N - 0.09) < 0.01, `both ${count.both / N} (independent rolls)`);
  for (const t of handTargets.keys()) assert.ok(BOUNTY_HAND_TARGETS.includes(t), t);
  for (const t of cardTargets.keys()) assert.ok(BOUNTY_CARD_TARGETS.includes(t), t);
  assert.equal(handTargets.size, BOUNTY_HAND_POOL, 'every weak class shows up');
  assert.equal(cardTargets.size, 24);
  // Roughly uniform: each target within ±35% of its expected count.
  for (const [seen, k] of [[handTargets, BOUNTY_HAND_POOL], [cardTargets, 24]]) {
    const expected = [...seen.values()].reduce((a, b) => a + b, 0) / k;
    for (const n of seen.values()) assert.ok(Math.abs(n - expected) < 0.35 * expected, `${n} vs ${expected}`);
  }

  // The default 5% chance through createScenario.
  let live = 0;
  for (let seed = 1; seed <= 8000; seed++) live += scenarioFor(seed, { hand: { enabled: true } }).bounties.length;
  assert.ok(Math.abs(live / 8000 - 0.05) < 0.008, `default chance ${live / 8000}`);
});

test('the draw uses its own stream, four draws, so toggling one type never changes the other', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const rng = createRng(deriveSeed(seed, 'bounty'));
    const [handRoll, handPick, cardRoll, cardPick] = [rng(), rng(), rng(), rng()];
    const all = drawBounties(seed, both(0.5));
    const hand = all.find((b) => b.type === 'hand');
    const card = all.find((b) => b.type === 'card');
    assert.equal(!!hand, handRoll < 0.5);
    assert.equal(!!card, cardRoll < 0.5);
    if (hand) assert.equal(hand.target, BOUNTY_HAND_TARGETS[Math.floor(handPick * 84)]);
    if (card) assert.equal(card.target, BOUNTY_CARD_TARGETS[Math.floor(cardPick * 24)]);
    const onlyCard = drawBounties(seed, { card: { enabled: true, chance: 0.5 } });
    assert.deepEqual(onlyCard, card ? [card] : []);
    const onlyHand = drawBounties(seed, { hand: { enabled: true, chance: 0.5 } });
    assert.deepEqual(onlyHand, hand ? [hand] : []);
  }
});

test('bounties never change the rest of the scenario or the dealt cards', () => {
  let live = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const straddle = { enabled: seed % 3 === 0, heroChance: 0.5 };
    const off = scenarioFor(seed, undefined, { straddle });
    const on = scenarioFor(seed, both(0.6), { straddle });
    const { bounties, ...rest } = on;
    const { bounties: none, ...offRest } = off;
    assert.deepEqual(none, []);
    assert.deepEqual(rest, offRest, 'seats, stacks, tiers, button and straddle are unchanged');
    if (bounties.length) live++;
    const a = createHand(off);
    const b = createHand(on);
    assert.deepEqual(a.players.map((p) => p.holeCards), b.players.map((p) => p.holeCards));
    assert.deepEqual(a.deck, b.deck);
    // Sanity: the hand bounty target is a real hand class.
    for (const bt of bounties.filter((x) => x.type === 'hand')) {
      assert.equal(handClass(bt.target[2] === 's' ? [`${bt.target[0]}c`, `${bt.target[1]}c`] : [`${bt.target[0]}c`, `${bt.target[1]}d`]), bt.target);
    }
  }
  assert.ok(live > 200);
});

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

import {
  applyAction, getLegalActions, getView, isComplete, buildHandRecord, randInt,
} from '../../src/engine/index.js';
import { STAKES } from '../../src/shared/schemas.js';
import { makeScenario, play, eventsOf, assertConserved } from './_helpers.js';
import { hashRecords, randomPlayRecords } from './_fingerprint.js';

const hand = (target, amountBb = 2, paysOn = 'showdownOrFold') => ({ type: 'hand', target, amountChips: amountBb * 100, paysOn });
const card = (target, amountBb = 2, paysOn = 'showdownOrFold') => ({ type: 'card', target, amountChips: amountBb * 100, paysOn });
const withBounties = (opts, bounties, cards) =>
  createHand({ ...makeScenario(opts), bounties }, cards ? { cards } : {});
const checkDown = (s) => {
  while (!isComplete(s)) s = applyAction(s, getLegalActions(s).types.includes('check') ? { type: 'check' } : { type: 'call' });
  return s;
};
const bountyMoves = (s) => eventsOf(s, 'bounty').map((e) => [e.fromSeat, e.seat, e.amount, e.bountyIndex]);
const stacksAdd = (s) => s.players.forEach((p) =>
  assert.equal(p.stack, p.startStack + s.result.netChips[p.seat] + s.result.bountyNetChips[p.seat]));

/** Same hand with and without bounties: pots, rake, netChips and non-bounty events must match. */
function assertPotUnchanged(withB, without) {
  assert.deepEqual(withB.result.pots, without.result.pots);
  assert.equal(withB.result.rakeChips, without.result.rakeChips);
  assert.deepEqual(withB.result.netChips, without.result.netChips);
  assert.deepEqual(withB.result.showdownSeats, without.result.showdownSeats);
  assert.deepEqual(without.result.bountyNetChips, without.players.map(() => 0));
  const strip = (s) => s.events.filter((e) => e.type !== 'bounty').map(({ seq, ...e }) => e);
  assert.deepEqual(strip(withB), strip(without));
  assert.equal(withB.result.bountyNetChips.reduce((a, b) => a + b, 0), 0, 'bounties are zero-sum');
  assertConserved(withB);
  stacksAdd(withB);
}

// 4-handed, button 0: SB 1, BB 2, seat 3 first to act.
const BOARD = ['2c', '5s', '9d', 'Tc', '3h'];

test('a hand bounty won at showdown: every other seat pays, never raked, pots and netChips untouched', () => {
  const opts = { stacks: [10000, 10000, 10000, 10000], button: 0, hero: 3 };
  const cards = { holes: { 3: ['7h', '2d'], 0: ['Kc', '8d'], 1: ['Qh', '4s'], 2: ['Jh', '6d'] }, board: BOARD };
  const run = (bounties) => checkDown(withBounties(opts, bounties, cards));
  const b = run([hand('72o')]);
  const plain = run([]);
  assertPotUnchanged(b, plain);
  assert.deepEqual(b.result.pots[0].winnerSeats, [3], 'pair of deuces wins');
  assert.deepEqual(bountyMoves(b), [[1, 3, 200, 0], [2, 3, 200, 0], [0, 3, 200, 0]], 'payers clockwise from the button');
  assert.deepEqual(b.result.bountyNetChips, [-200, -200, -200, 600]);
  assert.ok(eventsOf(b, 'bounty').every((e) => e.street === 'showdown'));
  const last = b.events.at(-1);
  assert.equal(last.type, 'bounty', 'settled after the award');
  assert.ok(eventsOf(b, 'award').every((e) => e.seq < eventsOf(b, 'bounty')[0].seq));

  const rec = buildHandRecord(b, { sessionId: 's', timestamp: 1 });
  assert.equal(rec.heroBountyBb, 6);
  assert.equal(rec.heroNetBb, buildHandRecord(plain, { sessionId: 's', timestamp: 1 }).heroNetBb, 'heroNetBb excludes bounties');
  assert.deepEqual(rec.bounties, [hand('72o')]);
  assert.equal(buildHandRecord(plain, { sessionId: 's' }).heroBountyBb, 0);

  // The board never counts: a 2 on the board doesn't make 7x a deuce-seven, and a card bounty needs a hole card.
  assert.deepEqual(bountyMoves(run([card('2c')])), []);
  assert.deepEqual(bountyMoves(run([card('2d')])).map((m) => m[1]), [3, 3, 3]);
  // Not holding it: a losing holder doesn't collect and nobody pays.
  assert.deepEqual(bountyMoves(run([hand('K8o'), card('4s')])), []);
});

test('payments are capped at the payer\'s remaining stack', () => {
  // Seat 0 goes all-in for 10bb and loses: it has nothing left to pay. Seat 1 folded with 1.5bb behind.
  const opts = { stacks: [1000, 190, 10000, 10000], button: 0, hero: 3 };
  const cards = { holes: { 3: ['7h', '2d'], 0: ['Kc', '8d'], 1: ['Qh', '4s'], 2: ['Jh', '6d'] }, board: BOARD };
  const act = (s) => play(s, [[3, 'call'], [0, 'raise', 1000], [1, 'fold'], [2, 'call'], [3, 'call']]);
  const b = checkDown(act(withBounties(opts, [hand('72o', 5)], cards)));
  assertPotUnchanged(b, checkDown(act(withBounties(opts, [], cards))));
  assert.deepEqual(bountyMoves(b), [[1, 3, 150, 0], [2, 3, 500, 0]]);
  assert.equal(b.players[0].stack, 0);
  assert.equal(b.players[1].stack, 0);
});

test('a split bounty: equal shares, odd chips to the first qualifier clockwise from the button', () => {
  // 5-handed, button 0: SB 1, BB 2. Seats 3 and 4 both hold 7-2 offsuit and chop; the rest fold to a raise.
  // Seat 0 (the button) folds with 55 chips behind, so the pool is odd.
  const opts = { stacks: [55, 10000, 10000, 10000, 10000], button: 0, hero: 4 };
  const cards = {
    holes: { 3: ['7h', '2d'], 4: ['7s', '2c'], 0: ['Kc', '8d'], 1: ['Qh', '4s'], 2: ['Jh', '6d'] },
    board: ['Ah', 'Ad', 'Kh', 'Ks', 'Qc'],
  };
  const act = (s) => checkDown(play(s, [[3, 'raise', 300], [4, 'call'], [0, 'fold'], [1, 'fold'], [2, 'fold']]));
  const b = act(withBounties(opts, [hand('72o')], cards));
  assertPotUnchanged(b, act(withBounties(opts, [], cards)));
  assert.deepEqual(b.result.pots[0].winnerSeats, [3, 4]);
  // Pool = 200 + 200 + 55 = 455: seat 3 (first clockwise from the button) gets 228, seat 4 gets 227.
  assert.deepEqual(b.result.bountyNetChips, [-55, -200, -200, 228, 227]);
  assert.deepEqual(bountyMoves(b), [
    [1, 3, 100, 0], [1, 4, 100, 0], [2, 3, 100, 0], [2, 4, 100, 0], [0, 3, 28, 0], [0, 4, 27, 0],
  ]);
});

test('paysOn: showdownOrFold pays a fold win, showdownOnly does not', () => {
  const opts = { stacks: [10000, 10000, 10000, 10000], button: 0, hero: 3 };
  const cards = { holes: { 3: ['7h', '2d'], 0: ['Kc', '8d'], 1: ['Qh', '4s'], 2: ['Jh', '6d'] }, board: BOARD };
  const steal = (bounties) => play(withBounties(opts, bounties, cards), [[3, 'raise', 300], [0, 'fold'], [1, 'fold'], [2, 'fold']]);
  const fold = steal([hand('72o', 2, 'showdownOrFold')]);
  assert.ok(isComplete(fold));
  assertPotUnchanged(fold, steal([]));
  assert.deepEqual(fold.result.bountyNetChips, [-200, -200, -200, 600]);
  assert.ok(eventsOf(fold, 'bounty').every((e) => e.street === 'preflop'), 'street as the award');
  assert.deepEqual(steal([hand('72o', 2, 'showdownOnly')]).result.bountyNetChips, [0, 0, 0, 0]);
  // A walk counts as winning the main pot too.
  const walk = play(withBounties(opts, [card('Jh')], cards), [[3, 'fold'], [0, 'fold'], [1, 'fold']]);
  assert.deepEqual(walk.result.pots[0].winnerSeats, [2]);
  assert.deepEqual(walk.result.bountyNetChips, [-200, -200, 600, -200]);

  const showdown = checkDown(withBounties(opts, [hand('72o', 2, 'showdownOnly')], cards));
  assert.deepEqual(showdown.result.bountyNetChips, [-200, -200, -200, 600]);
});

test('side pots: only a main-pot winner qualifies', () => {
  // Seat 0 is all-in short; seats 1 and 2 play a side pot. Seat 3 folds.
  const opts = { stacks: [1000, 10000, 10000, 10000], button: 3, hero: 1 };
  // button 3: SB 0, BB 1, seat 2 first to act.
  const deal = (holes) => ({ holes: { 3: ['Qh', 'Jd'], ...holes }, board: BOARD });
  const act = (s) => checkDown(play(s, [[2, 'raise', 3000], [3, 'fold'], [0, 'call'], [1, 'call']]));

  // Seat 0's aces win the main pot; seat 1's deuces win the side pot but don't qualify.
  let cards = deal({ 0: ['Ah', 'As'], 1: ['7h', '2d'], 2: ['Kc', '8d'] });
  let b = act(withBounties(opts, [hand('72o')], cards));
  assertPotUnchanged(b, act(withBounties(opts, [], cards)));
  assert.deepEqual(b.result.pots.map((p) => p.winnerSeats), [[0], [1]]);
  assert.deepEqual(bountyMoves(b), []);

  // The short stack holds it and wins the main pot: it collects from everyone, including the side-pot winner.
  cards = deal({ 0: ['7h', '2d'], 1: ['Kc', '8d'], 2: ['Qc', '8h'] });
  b = act(withBounties(opts, [hand('72o')], cards));
  assertPotUnchanged(b, act(withBounties(opts, [], cards)));
  assert.deepEqual(b.result.pots.map((p) => p.winnerSeats), [[0], [1]]);
  assert.deepEqual(b.result.bountyNetChips, [600, -200, -200, -200]);
});

test('two bounties in one hand: hand bounty first, each capped at what is left', () => {
  // Hero (seat 3) holds 7h 2d: both the 72o hand bounty and the 2d card bounty. Seat 1 folds with 3bb behind.
  const opts = { stacks: [10000, 340, 10000, 10000], button: 0, hero: 3 };
  const cards = { holes: { 3: ['7h', '2d'], 0: ['Kc', '8d'], 1: ['Qh', '4s'], 2: ['Jh', '6d'] }, board: BOARD };
  const act = (s) => checkDown(play(s, [[3, 'call'], [0, 'call'], [1, 'fold'], [2, 'check']]));
  const b = act(withBounties(opts, [card('2d'), hand('72o')], cards));
  assertPotUnchanged(b, act(withBounties(opts, [], cards)));
  // Listed card-first here, but the hand bounty (index 1) settles first; seat 1 has 300 left: 200 then 100.
  assert.deepEqual(bountyMoves(b), [
    [1, 3, 200, 1], [2, 3, 200, 1], [0, 3, 200, 1],
    [1, 3, 100, 0], [2, 3, 200, 0], [0, 3, 200, 0],
  ]);
  assert.equal(buildHandRecord(b, { sessionId: 's' }).heroBountyBb, 11);

  // A chop between the hand-bounty holder and the card-bounty holder: each pays the other's bounty.
  const chopCards = {
    holes: { 3: ['7h', '2d'], 0: ['3c', '4d'], 1: ['Qh', '5s'], 2: ['Jh', '6d'] }, board: ['Ah', 'Ad', 'Kh', 'Ks', 'Qc'],
  };
  const chopOpts = { stacks: [10000, 10000, 10000, 10000], button: 0, hero: 3 };
  const chop = (s) => checkDown(play(s, [[3, 'raise', 300], [0, 'call'], [1, 'fold'], [2, 'fold']]));
  const c = chop(withBounties(chopOpts, [hand('72o'), card('4d')], chopCards));
  assertPotUnchanged(c, chop(withBounties(chopOpts, [], chopCards)));
  assert.deepEqual(c.result.pots[0].winnerSeats, [3, 0], 'clockwise from the button');
  assert.deepEqual(bountyMoves(c), [
    [1, 3, 200, 0], [2, 3, 200, 0], [0, 3, 200, 0],
    [1, 0, 200, 1], [2, 0, 200, 1], [3, 0, 200, 1],
  ]);
  assert.deepEqual(c.result.bountyNetChips, [400, -400, -400, 400]);
});

test('createHand validates bounties; views and records carry them', () => {
  const base = makeScenario({ stacks: [10000, 10000, 10000] });
  for (const bad of [[{ type: 'player', target: 'AA', amountChips: 200, paysOn: 'showdownOrFold' }],
    [hand('27o')], [hand('72x')], [card('7x')], [{ ...hand('72o'), amountChips: 0 }], [{ ...card('2c'), amountChips: 1.5 }],
    [{ ...card('2c'), paysOn: 'never' }], 'x']) {
    assert.throws(() => createHand({ ...base, bounties: bad }), RangeError, JSON.stringify(bad));
  }
  const noField = createHand(base);
  assert.deepEqual(noField.bounties, []);
  const s = createHand({ ...base, bounties: [hand('72o'), card('4c')] });
  for (let seat = 0; seat < 3; seat++) {
    const view = getView(s, seat);
    assert.deepEqual(view.bounties, [hand('72o'), card('4c')], 'public before the deal');
    assert.equal(view.straddleSeat, null);
    view.bounties[0].target = 'AA';
    assert.equal(s.bounties[0].target, '72o', 'views are copies');
  }
});

// ---------------------------------------------------------------------------
// Bounties off / random play
// ---------------------------------------------------------------------------

// sha256 of 300 random-play records built by the engine before bounties existed (commit c269744), with
// the fields added for §15 stripped (tests/engine/_fingerprint.js). Bounties off must reproduce them.
const PRE_BOUNTY_RECORDS = 'c7da23b594dc53742d857b7caa238f29278c95e01242ce65a65b268ba1137986';

test('bounties off gives identical records to before bounties existed', () => {
  const off = randomPlayRecords();
  assert.equal(hashRecords(off), PRE_BOUNTY_RECORDS);
  for (const r of off) {
    assert.deepEqual(r.bounties, []);
    assert.equal(r.heroBountyBb, 0);
    assert.ok(r.result.bountyNetChips.every((x) => x === 0));
    assert.ok(r.events.every((e) => e.type !== 'bounty'));
  }
  assert.deepEqual(randomPlayRecords({ to: 80, extra: { bounty: BOUNTY_DEFAULTS } }), off.slice(0, 80));
  // Enabled at chance 0 is the same as off.
  assert.deepEqual(randomPlayRecords({ to: 80, extra: { bounty: both(0) } }), off.slice(0, 80));
});

test('random play with live bounties: pots unchanged, payouts zero-sum, capped, only to main-pot winners', () => {
  const STAKE_IDS = Object.keys(STAKES);
  const paid = { hand: 0, card: 0 };
  let live = 0;
  let capped = 0;
  const N = 400;
  for (let seed = 1; seed <= N; seed++) {
    const paysOn = seed % 3 ? 'showdownOrFold' : 'showdownOnly';
    const bounty = both(1, seed % 5 ? 2 : 60, paysOn);
    const make = (b) => createScenario({ stakes: STAKE_IDS[seed % 4], seed, createdAt: seed, bounty: b }, createRng(seed));
    const rng = createRng(deriveSeed(seed, 'test'));
    let plain = createHand(make(undefined));
    const scenario = make(bounty);
    if (seed % 4) {
      // Aim most bounties at cards someone was dealt (the deal is the same), so settlement runs often.
      const holes = plain.players.map((p) => p.holeCards);
      scenario.bounties = scenario.bounties.map((b, i) => ({
        ...b, target: b.type === 'hand' ? handClass(holes[(seed + i) % holes.length]) : holes[(seed + 2 * i) % holes.length][seed % 2],
      }));
    }
    let s = createHand(scenario);
    live += s.bounties.length;
    while (!isComplete(s)) {
      const legal = getLegalActions(s);
      const type = legal.types[Math.floor(rng() * legal.types.length)];
      const action = type === 'bet' || type === 'raise'
        ? { type, amount: rng() < 0.1 ? legal.maxTo : randInt(rng, legal.minTo, legal.maxTo) }
        : type === 'fold' && rng() < 0.7 ? { type: 'call' } : { type };
      s = applyAction(s, action);
      plain = applyAction(plain, action);
    }
    assertPotUnchanged(s, plain);
    const moves = eventsOf(s, 'bounty');
    const isShowdown = s.result.showdownSeats.length > 0;
    s.bounties.forEach((b, i) => {
      const mine = moves.filter((e) => e.bountyIndex === i);
      if (!mine.length) return;
      paid[b.type]++;
      if (b.paysOn === 'showdownOnly') assert.ok(isShowdown);
      const receivers = new Set(mine.map((e) => e.seat));
      for (const seat of receivers) {
        assert.ok(s.result.pots[0].winnerSeats.includes(seat), 'receiver won part of the main pot');
        const h = s.players[seat].holeCards;
        assert.ok(b.type === 'hand' ? handClass(h) === b.target : h.includes(b.target));
      }
      const byPayer = new Map();
      for (const e of mine) {
        assert.ok(!receivers.has(e.fromSeat) && e.amount > 0);
        byPayer.set(e.fromSeat, (byPayer.get(e.fromSeat) ?? 0) + e.amount);
      }
      for (const total of byPayer.values()) {
        assert.ok(total <= b.amountChips);
        if (total < b.amountChips) capped++;
      }
    });
  }
  assert.equal(live, 2 * N, 'chance 1: both bounties every hand');
  assert.ok(paid.card > 40 && paid.hand > 40, JSON.stringify(paid));
  assert.ok(capped > 20, `${capped} capped payments`);
});
