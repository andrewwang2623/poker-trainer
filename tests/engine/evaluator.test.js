import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../src/engine/evaluator.js';
import { createRng, deriveSeed, normalizeSeed } from '../../src/engine/rng.js';
import { fullDeck, shuffle, handClass, parseCard, formatCard, classCombos } from '../../src/engine/cards.js';

const ev = (s) => evaluate(s.split(' '));

test('categories', () => {
  const cases = [
    ['As Kd 9h 7c 3s 2d 4h', 'highCard', 'High Card, Ace'],
    ['As Ad 9h 7c 3s', 'pair', 'Pair of Aces, Nine kicker'],
    ['As Ad 7h 7c 3s Kd 2c', 'twoPair', 'Two Pair, Aces and Sevens'],
    ['7s 7d 7h Ac 3s', 'threeOfAKind', 'Three of a Kind, Sevens'],
    ['5s 6d 7h 8c 9s', 'straight', 'Straight, Nine High'],
    ['As 2d 3h 4c 5s Kd', 'straight', 'Straight, Five High'],
    ['As 9s 7s 4s 2s Kd', 'flush', 'Flush, Ace High'],
    ['7s 7d 7h Ac As', 'fullHouse', 'Full House, Sevens full of Aces'],
    ['7s 7d 7h 7c As', 'fourOfAKind', 'Four of a Kind, Sevens'],
    ['5s 6s 7s 8s 9s', 'straightFlush', 'Straight Flush, Nine High'],
    ['Ts Js Qs Ks As', 'straightFlush', 'Royal Flush'],
    ['As 2s 3s 4s 5s', 'straightFlush', 'Straight Flush, Five High'],
  ];
  for (const [cards, category, label] of cases) {
    const r = ev(cards);
    assert.equal(r.category, category, cards);
    assert.equal(r.label, label, cards);
  }
});

test('category ordering', () => {
  const order = [
    'As Kd 9h 7c 3s', 'As Ad 9h 7c 3s', 'As Ad 7h 7c 3s', '7s 7d 7h Ac 3s', '5s 6d 7h 8c 9s',
    'As 9s 7s 4s 2s', '7s 7d 7h Ac As', '7s 7d 7h 7c As', '5s 6s 7s 8s 9s',
  ].map((c) => ev(c).score);
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1]);
});

test('kickers and tie-breaks', () => {
  assert.ok(ev('As Ad Kh 7c 3s').score > ev('Ac Ah Qh 7c 3s').score);
  assert.ok(ev('As Ad Kh 7c 4s').score > ev('Ac Ah Kd 7d 3s').score);
  assert.ok(ev('2s 3d 4h 5c 6s').score > ev('As 2d 3h 4c 5s').score, '6-high beats wheel');
  assert.ok(ev('Ks Kd 2h 2c As').score > ev('Qs Qd Jh Jc As').score);
  assert.ok(ev('Ks Kd 2h 2c As').score > ev('Kc Kh 2d 2s Qs').score, 'two-pair kicker');
  assert.ok(ev('8s 8d 8h 2c 2s').score > ev('7s 7d 7h Ac As').score);
  assert.ok(ev('As Ks 7s 4s 3s').score > ev('Ad Qd Jd Td 8d').score);
});

test('ties produce equal scores', () => {
  assert.equal(ev('As Kd 9h 7c 3s').score, ev('Ac Kh 9d 7s 3c').score);
  // Both play the board straight.
  const board = 'Ts Jd Qh Kc Ad';
  assert.equal(ev(`${board} 2c 3c`).score, ev(`${board} 4h 5h`).score);
  // Third pair doesn't count; kicker decides.
  assert.equal(ev('As Ad Ks Kd 5c 5h 2d').score, ev('As Ad Ks Kd 5c 4h 2d').score);
});

test('7-card best selection', () => {
  // Trips+trips → full house using the higher trips.
  assert.equal(ev('9s 9d 9h 4c 4s 4d 2c').label, 'Full House, Nines full of Fours');
  // Flush over straight with 7 cards.
  assert.equal(ev('4h 5h 6d 7h 8c Kh 2h').category, 'flush');
  // Quads kicker uses the highest remaining card, even from a pair.
  assert.equal(ev('9s 9d 9h 9c Ks Kd As').score, ev('9s 9d 9h 9c 2s 3d As').score);
  // Straight flush chosen over a higher plain straight.
  assert.equal(ev('5h 6h 7h 8h 9h Td Jc').label, 'Straight Flush, Nine High');
});

test('evaluate rejects bad input', () => {
  assert.throws(() => evaluate(['As', 'Kd', 'Qh', 'Jc']), RangeError);
  assert.throws(() => evaluate(['As', 'As', 'Qh', 'Jc', '2d']), RangeError);
  assert.throws(() => evaluate(['Xs', 'Kd', 'Qh', 'Jc', '2d']), RangeError);
});

test('rng is deterministic and derived streams differ', () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
  const c = createRng(deriveSeed(42, 'bots'));
  assert.notEqual(createRng(42)(), c());
  assert.equal(normalizeSeed(2 ** 32 + 5), 5);
  assert.equal(normalizeSeed(-1), 2 ** 32 - 1);
  const r = createRng(7);
  for (let i = 0; i < 1000; i++) {
    const x = r();
    assert.ok(x >= 0 && x < 1);
  }
});

test('deck, shuffle, handClass', () => {
  const deck = fullDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck).size, 52);
  const s1 = shuffle(deck, createRng(1));
  assert.deepEqual(s1, shuffle(deck, createRng(1)));
  assert.notDeepEqual(s1, deck);
  assert.deepEqual([...s1].sort(), [...deck].sort());
  assert.equal(handClass(['Kd', 'As']), 'AKo');
  assert.equal(handClass(['Ks', 'As']), 'AKs');
  assert.equal(handClass(['7c', '7d']), '77');
  assert.equal(formatCard(parseCard('Td')), 'Td');
  assert.equal(classCombos('AA').length, 6);
  assert.equal(classCombos('AKs').length, 4);
  assert.equal(classCombos('AKo').length, 12);
});
