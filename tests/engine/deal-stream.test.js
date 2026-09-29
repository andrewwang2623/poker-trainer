// The deck has its own RNG stream (SPEC §2, §6, §13 item 11). Sharing createRng(seed) with
// createScenario made dealt cards depend on table size (premiums ~2.1% at 9-handed vs 2.56%).
// A larger audit lives in deal-audit.js (not run by `node --test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScenario } from '../../src/engine/scenario.js';
import { createHand } from '../../src/engine/game.js';
import { createRng, deriveSeed } from '../../src/engine/rng.js';
import { fullDeck, shuffle } from '../../src/engine/cards.js';
import { MIN_PLAYERS, MAX_PLAYERS } from '../../src/shared/schemas.js';
import { makeScenario } from './_helpers.js';
import { EXPECTED, classify } from './_deal-stats.js';

/** Hole cards in the order they came off the deck (one at a time, starting with the SB). */
function dealtInOrder(s) {
  const holes = new Map(s.events.filter((e) => e.type === 'dealHole').map((e) => [e.seat, e.cards]));
  const order = Array.from({ length: s.numPlayers }, (_, i) => (s.sbSeat + i) % s.numPlayers);
  return [0, 1].flatMap((round) => order.map((seat) => holes.get(seat)[round]));
}

test('the deck is shuffled with createRng(deriveSeed(seed, "deck"))', () => {
  for (const seed of [0, 1, 42, 3735928559]) {
    const s = createHand(createScenario({ stakes: 'micro', seed, createdAt: 0 }));
    const expected = shuffle(fullDeck(), createRng(deriveSeed(seed, 'deck')));
    assert.deepEqual([...dealtInOrder(s), ...s.deck], expected);
    assert.notDeepEqual(expected, shuffle(fullDeck(), createRng(seed)), 'not the scenario stream');
  }
});

test('deck order depends only on the seed, not on table size or scenario draws', () => {
  const seed = 2024;
  const decks = [];
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const s = createHand(makeScenario({ seed, stacks: Array(n).fill(10000), button: n - 1 }));
    decks.push([...dealtInOrder(s), ...s.deck]);
  }
  for (const d of decks) assert.deepEqual(d, decks[0]);
});

test('card presets still come out of the seeded deck, keeping the rest in shuffle order', () => {
  const sc = makeScenario({ seed: 77, stacks: [10000, 10000, 10000] });
  const preset = { holes: { 1: ['As', 'Ah'] }, board: ['Kd', 'Qc'] };
  const a = createHand(sc, { cards: preset });
  assert.deepEqual(a, createHand(structuredClone(sc), { cards: structuredClone(preset) }));
  assert.deepEqual(a.players[1].holeCards, ['As', 'Ah']);
  assert.deepEqual(a.deck.slice(0, 2), ['Kd', 'Qc']);
  const taken = new Set(['As', 'Ah', 'Kd', 'Qc']);
  const rest = shuffle(fullDeck(), createRng(deriveSeed(77, 'deck'))).filter((c) => !taken.has(c));
  // SB is seat 1 (button 0), so the unpreset seats are dealt in order 2, 0, 2, 0.
  const order = [0, 1].flatMap((r) => [2, 0].map((seat) => a.players[seat].holeCards[r]));
  assert.deepEqual([...order, ...a.deck.slice(2)], rest);
  assert.equal(new Set([...order, ...a.deck, 'As', 'Ah']).size, 52);
});

// Deals on the main.js path (createScenario with createRng(seed), then createHand), bucketed by table
// size. Every seat's hand counts. Hands within one deal share a deck, which makes their counts slightly
// negatively correlated, so the binomial sigma used here is conservative. With fixed seeds the result
// is deterministic; a 4-sigma band keeps a fair deck far from the edge (per-check false alarm ~6e-5)
// while the old shared stream fails 9-handed premiums at about -12 sigma with this sample size.
test('premium and pocket-pair frequencies match theory at every table size (2-9)', () => {
  const DEALS = 150_000;
  const Z_MAX = 4;
  const seeds = createRng(20260928);
  const rows = {};
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) rows[n] = { hands: 0, premium: 0, pair: 0 };
  for (let i = 0; i < DEALS; i++) {
    const seed = Math.floor(seeds() * 4294967296);
    const s = createHand(createScenario({ stakes: 'micro', seed, createdAt: 0 }, createRng(seed)));
    const row = rows[s.numPlayers];
    for (const p of s.players) {
      const { premium, pair } = classify(p.holeCards);
      row.hands++; row.premium += premium; row.pair += pair;
    }
  }
  const failures = [];
  for (const [n, row] of Object.entries(rows)) {
    assert.ok(row.hands > 30_000, `${n}-max: only ${row.hands} hands sampled`);
    for (const key of ['premium', 'pair']) {
      const p = EXPECTED[key];
      const observed = row[key] / row.hands;
      const z = (observed - p) / Math.sqrt(p * (1 - p) / row.hands);
      if (Math.abs(z) > Z_MAX) {
        failures.push(`${n}-max ${key}: ${(100 * observed).toFixed(3)}% vs ${(100 * p).toFixed(3)}% (z=${z.toFixed(1)})`);
      }
    }
  }
  assert.deepEqual(failures, []);
});
