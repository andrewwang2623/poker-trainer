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
