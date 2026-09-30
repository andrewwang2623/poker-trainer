import test from 'node:test';
import assert from 'node:assert/strict';
import { formatHand, formatHands, formatSummary } from '../../src/export/index.js';
import { handFixture, coachFixture, statsFixture } from './fixtures.js';

const GOLDEN = `=== POKER TRAINER EXPORT v1 ===
--- Hand 1 of 1 | id fixture-1 | Micro (NL5) $0.02/$0.05 | 2-handed | 2026-09-28 19:55 ---
Rake: 5% cap 4.0bb | Effective stacks: hero 100.0bb
Players:
  Seat 1 SB  Hero  100.0bb  HERO  [Ah Kd]
  Seat 2 BB  Mika  100.0bb  Tough reg  VPIP 24 PFR 20 3B 10 AF 3.0 Bluff 35% Skill 90%  [Qs Qh]
PREFLOP (pot 1.4bb): Hero (SB) posts SB 0.4bb, BB posts BB 1.0bb, Hero (SB) raises to 3.0bb, BB calls 2.0bb
FLOP [As 7d 2c] (pot 6.0bb): BB checks, Hero bets 2.0bb, BB calls 2.0bb
TURN [As 7d 2c] [9s] (pot 10.0bb): BB checks, Hero checks
RIVER [As 7d 2c 9s] [3h] (pot 10.0bb): BB checks, Hero checks
SHOWDOWN: BB shows [Qs Qh] (Pair of Queens); Hero shows [Ah Kd] (Pair of Aces)
RESULT: Hero wins 9.5bb (net +4.5bb) | rake 0.5bb
=== END ===`;

test('uncoached hand matches golden text without mutating input', () => {
  const record = handFixture();
  const before = structuredClone(record);
  assert.equal(formatHand(record, { includePrompt: false }), GOLDEN);
  assert.deepEqual(record, before);
  assert.doesNotMatch(GOLDEN, /equity|pot odds|COACH FLAGS|Explanation|seed|123/);
});

test('coach decisions join by index, with optional explanations', () => {
  const record = handFixture();
  record.coach = coachFixture();
  record.coach.decisions.reverse();
  const expected = GOLDEN.replace('FLOP [', '  Hero #1: raise to 3.0bb | equity 58% | pot odds 30% | EV loss 0.0bb | chart: open 100%\nFLOP [')
    .replace('TURN [', '  Hero #2: bet 2.0bb | equity 81% | pot odds — | EV loss 0.8bb\nTURN [')
    .replace('=== END ===', 'COACH FLAGS:\n  - [minor] SZ_TOO_SMALL (flop, #2): sizePct: 33%; recommendedPct: 66%–80%; texture: wet. EV loss 0.8bb\n=== END ===');
  assert.equal(formatHand(record, { includePrompt: false }), expected);
  assert.equal(formatHand(record, { includePrompt: false, explain: () => ({ title: 'Size', body: 'Bet larger.', tip: 'Use the pot.' }) }), expected.replace('\n=== END', '\n    Explanation: Bet larger.\n=== END'));
});

test('hiding cards redacts all opponent cards and showdown labels only', () => {
  const record = handFixture();
  assert.equal(formatHand(record, { includePrompt: false, hideOpponentCards: true }), GOLDEN.replaceAll('[Qs Qh]', '[?? ??]').replace(' (Pair of Queens)', ''));
  assert.deepEqual(record.players[1].holeCards, ['Qs', 'Qh']);
});

test('multiple hands sort oldest-first without mutation, prompt appears once, empty is clean', () => {
  const older = handFixture();
  const newer = { ...handFixture(), id: 'newer', timestamp: older.timestamp + 1000 };
  const records = [newer, older];
  const text = formatHands(records);
  assert.equal(text.match(/You are an expert/g).length, 1);
  assert.ok(text.indexOf('Hand 1 of 2 | id fixture-1') < text.indexOf('Hand 2 of 2 | id newer'));
  assert.equal(records[0], newer);
  assert.equal(formatHands([], { includePrompt: false }), '=== POKER TRAINER EXPORT v1 ===\n=== END ===');
});

test('folded cards, uncalled chips, all-ins, split awards and runout-only streets', () => {
  const record = handFixture();
  record.events[4].allIn = true;
  record.events.splice(6, 0, { seq: 30, type: 'uncalled', street: 'preflop', seat: 0, amount: 100 });
  record.events = record.events.filter(e => !(e.street === 'turn' && e.type === 'action'));
  record.events.push({ seq: 31, type: 'award', street: 'showdown', seat: 0, amount: 50, potIndex: 1 });
  record.result.heroAllInEv = { street: 'flop', heroEquity: .8, evNetChips: 241 };
  const text = formatHand(record);
  assert.match(text, /raises to 3.0bb \(all-in\)/);
  assert.match(text, /Uncalled 1.0bb returned to SB/);
  assert.match(text, /FLOP .*pot 5.0bb/);
  assert.match(text, /TURN .*No betting/);
  assert.match(text, /Hero wins 10.0bb/);
  assert.match(text, /all-in EV net \+2.4bb/);
  // A preflop fold still exposes the full record's opponent cards by default.
  record.events = record.events.slice(0, 4).concat({ seq: 4, type: 'action', street: 'preflop', seat: 0, action: 'fold', amount: 0, to: 40, allIn: false, potBefore: 140, toCall: 60, stackBefore: 9960 });
  assert.match(formatHand(record), /\[Qs Qh\]/);
  assert.doesNotMatch(formatHand(record, { hideOpponentCards: true }), /Qs|Qh|SHOWDOWN|\nFLOP/);
});

test('summary golden text uses supplied stats and no invented date range', () => {
  const text = formatSummary({ stats: [statsFixture()], patterns: [], stakes: 'micro' }, { includePrompt: false });
  assert.equal(text, `=== POKER TRAINER SUMMARY v1 ===
Stakes: Micro (NL5) | Hands: 1,240
Window  Hands  VPIP PFR 3B CB FCB WTSD W$SD AF  bb/100  EVadj bb/100 (95% CI)  EVloss/100 Rake/100
All  1240  24 19 7 61 44 29 52 2.8  +12.0  +8.4 (-31.0, +47.8)  6.1 3.9
Winning ranges (Micro): VPIP 18–28, PFR 14–22, 3B 5–9, CB 50–75, FCB 35–55, WTSD 24–32, W$SD 50–60, AF 2.0–4.0
Top leaks:
  1. EQ_BAD_CALL — 14× — 38.2bb total
Profitability: likely losing (confidence: low) — Small sample; Costly calls
Note: Estimate only. Poker results have high variance; this combines a model with a small sample and can be wrong.
=== END ===`);
});

test('rabbit exports label undealt streets without changing actual boards, results, or redaction', () => {
  const fullBoard = ['As', '7d', '2c', '9s', '3h'];
  for (const length of [0, 3, 4]) {
    const record = handFixture();
    record.board = fullBoard.slice(0, length);
    const playedStreets = length === 0 ? ['preflop'] : length === 3 ? ['preflop', 'flop'] : ['preflop', 'flop', 'turn'];
    record.events = record.events.filter(event => playedStreets.includes(event.street));
    const before = structuredClone(record);
    const rabbitCardsByHand = new Map([[record.id, fullBoard.slice(length)]]);
    const regular = formatHand(record, { hideOpponentCards: true });
    const text = formatHand(record, { hideOpponentCards: true, rabbitCardsByHand });
    assert.doesNotMatch(regular, /RABBIT HUNT/);
    const expected = length === 0 ? 'Flop [As 7d 2c] | Turn [9s] | River [3h]'
      : length === 3 ? 'Turn [9s] | River [3h]' : 'River [3h]';
    assert.ok(text.includes(`RABBIT HUNT (hypothetical; not dealt, result unchanged): ${expected}`));
    assert.equal(text.split('\n').find(line => line.startsWith('RESULT:')),
      regular.split('\n').find(line => line.startsWith('RESULT:')));
    assert.doesNotMatch(text, /Qs|Qh|\nRIVER/);
    assert.deepEqual(record, before);
    assert.deepEqual(rabbitCardsByHand.get(record.id), fullBoard.slice(length));
  }
});

test('rabbit cards stay associated with their hand and incomplete previews are omitted', () => {
  const first = { ...handFixture(), id: 'first', board: [] };
  const second = { ...handFixture(), id: 'second', timestamp: first.timestamp + 1, board: [] };
  const rabbitCardsByHand = new Map([['first', ['2h', '3s', '4d', '5c', '6h']]]);
  const text = formatHands([second, first], { rabbitCardsByHand });
  const blocks = text.split('--- Hand');
  assert.match(blocks[1], /RABBIT HUNT.*Flop \[2h 3s 4d\].*River \[6h\]/);
  assert.doesNotMatch(blocks[2], /RABBIT HUNT/);
  for (const values of [[], ['2h'], ['2h', '2h', '4d', '5c', '6h'], ['invalid', '3s', '4d', '5c', '6h']]) {
    assert.doesNotMatch(formatHand(first, { rabbitCardsByHand: new Map([['first', values]]) }), /RABBIT HUNT/);
  }
  assert.doesNotMatch(formatHand({ ...first, board: ['As', '7d', '2c', '9s', '3h'] }, { rabbitCardsByHand }), /RABBIT HUNT/);
});

test('summary handles overlapping windows, trends, patterns and unavailable rates', () => {
  const all = statsFixture();
  const recent = { ...statsFixture(), window: 500, hands: 500, vpip: null, af: null, coachedHands: 0, trend: { bbPer100Delta: 3.1, evLossPer100Delta: -1.2, vpipDelta: -.02 } };
  const patterns = [{ id: 'PAT_OVERFOLD_CBET', severity: 'minor', street: null, decisionIndex: null, evLossBb: null, oppTier: null, data: { stat: 'foldToCbet', value: .61, target: [.35, .55], hands: 500, window: 500 } }];
  const input = { stats: [recent, all], patterns, stakes: 'micro' };
  const before = structuredClone(input);
  const text = formatSummary(input);
  assert.match(text, /Hands: 1,240/);
  assert.match(text, /Last500  500  —/);
  assert.match(text, /Trends \(last 500 vs previous 500\): bb\/100 \+3.1, EV loss\/100 —, VPIP -2/);
  assert.match(text, /PAT_OVERFOLD_CBET .*value: 61%; target: 35%–55%/);
  assert.doesNotMatch(text, /undefined|NaN/);
  assert.deepEqual(input, before);
  assert.doesNotMatch(formatSummary({ stats: [], stakes: 'micro' }), /undefined|NaN|Profitability:/);
});
