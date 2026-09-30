// analyzeHand and liveOdds (SPEC §6 Coach, §8, §14, §15) on engine-built hand fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEquity, classCombos, codeToCard, getView, createRng, deriveSeed, createScenario, createHand,
  applyAction, isComplete, buildHandRecord,
} from '../../src/engine/index.js';
import { decideAction, createBotProfile } from '../../src/bots/index.js';
import { FLAG_IDS, FLAG_SEVERITIES } from '../../src/shared/schemas.js';
import { analyzeHand, liveOdds, detectPatterns } from '../../src/coach/index.js';
import { makeHand, play, recordOf, PROFILES, coachRng, flagIds, flagsAt } from './_hands.js';
import { decisionContexts } from '../../src/coach/context.js';
import { opponentRanges } from '../../src/coach/villainRanges.js';

/** P(hero wins or ties) at a record's first decision, from the same rng stream and ranges as the coach. */
function firstWinOrTie(record) {
  const [ctx] = decisionContexts(record);
  const ranges = opponentRanges({ events: ctx.events, street: ctx.street, board: ctx.board,
    heroCards: ctx.decision.holeCards, opponents: ctx.opponents });
  const eq = computeEquity({ hero: ctx.decision.holeCards, board: ctx.board, villains: ranges.map((r) => r.range),
    iterations: 2000, rng: coachRng(record) });
  return eq.win + eq.tie;
}

/** §8.3 data fields per hand-level flag. */
const DATA_KEYS = {
  PF_OPEN_OUT_OF_RANGE: ['hand', 'position', 'depthBand', 'chartFreq'],
  PF_MISSED_OPEN: ['hand', 'position', 'depthBand', 'chartFreq'],
  PF_OPEN_LIMP: ['hand', 'position', 'depthBand'],
  PF_CALL_OUT_OF_RANGE: ['hand', 'position', 'depthBand', 'vsPosition', 'raiseToBb', 'chartFreq'],
  PF_MISSED_3BET: ['hand', 'position', 'depthBand', 'vsPosition', 'chartFreq'],
  PF_3BET_OUT_OF_RANGE: ['hand', 'position', 'depthBand', 'vsPosition', 'chartFreq'],
  PF_FOLD_IN_RANGE: ['hand', 'position', 'depthBand', 'vsPosition', 'callFreq', 'threeBetFreq'],
  PF_OPEN_SIZE: ['sizeBb', 'recommendedBb', 'position', 'limpers'],
  EQ_BAD_CALL: ['equity', 'requiredEquity', 'toCallBb', 'potBb'],
  EQ_BAD_FOLD: ['equity', 'requiredEquity', 'toCallBb', 'potBb'],
  EQ_MISSED_VALUE: ['equity', 'potBb', 'bestAction', 'evGainBb'],
  EQ_BAD_BLUFF: ['equity', 'foldEstimate', 'sizePct', 'oppVpip'],
  SZ_TOO_SMALL: ['sizePct', 'recommendedPct', 'texture'],
  SZ_TOO_LARGE: ['sizePct', 'recommendedPct', 'texture'],
  LN_MISSED_CBET: ['texture', 'numOpponents', 'equity'],
  LN_PAYOFF_PASSIVE_RAISE: ['oppAggression', 'equity', 'toCallBb'],
};

const analyze = (record, opts = {}) => analyzeHand(record, { rng: coachRng(record), ...opts });

/** Heads-up, button 0: seat 0 is the SB/button, seat 1 the BB. */
const HU = (opts) => makeHand({ n: 2, button: 0, ...opts });

/** Exact equity against a range of equally weighted combos, averaging exact enumeration per combo. */
function exactVsRange(hero, board, classes) {
  const seen = new Set([...hero, ...board]);
  let sum = 0;
  let n = 0;
  for (const cls of classes) {
    for (const [a, b] of classCombos(cls)) {
      const villain = [codeToCard(a), codeToCard(b)];
      if (villain.some((c) => seen.has(c))) continue;
      sum += computeEquity({ hero, board, villains: [villain] }).equity;
      n++;
    }
  }
  return sum / n;
}

test('known equity spots: within 2pp of exact enumeration against the estimated range', () => {
  // The nit raised preflop, so its range is {AA, KK}; it checks behind, so no postflop narrowing.
  const steps = [[0, 'raise', 3], [1, 'call'], [1, 'check'], [0, 'check'], [1, 'check']];
  const board = ['9s', '8s', '2d', '3c', 'Kh'];
  const record = recordOf(HU({ hero: 1, profiles: { 0: PROFILES.nit }, holes: { 1: ['Js', 'Ts'] }, board }), steps);
  const result = analyze(record);
  const flop = result.decisions[1];
  const turn = result.decisions[2];
  assert.equal(flop.equitySamples, 2000);
  const exactFlop = exactVsRange(['Js', 'Ts'], board.slice(0, 3), ['AA', 'KK']);
  const exactTurn = exactVsRange(['Js', 'Ts'], board.slice(0, 4), ['AA', 'KK']);
  assert.ok(Math.abs(flop.equity - exactFlop) <= 0.02, `flop ${flop.equity} vs exact ${exactFlop}`);
  assert.ok(Math.abs(turn.equity - exactTurn) <= 0.02, `turn ${turn.equity} vs exact ${exactTurn}`);
  assert.equal(flop.texture, 'semiwet');
  assert.equal(flop.potOdds, null);

  // Set over set: hero 99 vs {AA, KK} on a 9-high flop.
  const set = recordOf(HU({ hero: 1, profiles: { 0: PROFILES.nit }, holes: { 1: ['9h', '9d'] }, board }), steps);
  const exactSet = exactVsRange(['9h', '9d'], board.slice(0, 3), ['AA', 'KK']);
  assert.ok(exactSet > 0.85);
  assert.ok(Math.abs(analyze(set).decisions[1].equity - exactSet) <= 0.02);

  // The same spot through liveOdds, mid-hand.
  const live = play(HU({ hero: 1, profiles: { 0: PROFILES.nit }, holes: { 1: ['Js', 'Ts'] }, board }),
    [[0, 'raise', 3], [1, 'call']]);
  const view = getView(live, 1);
  const odds = liveOdds(view, [PROFILES.nit], { rng: createRng(1), iterations: 2000 });
  assert.ok(Math.abs(odds.equity - exactFlop) <= 0.02, `liveOdds ${odds.equity} vs ${exactFlop}`);
  assert.equal(odds.potOdds, null);
});

test('liveOdds: pot odds when facing a bet, nulls when the hand is over or hero folded', () => {
  const state = play(HU({ hero: 1, profiles: { 0: PROFILES.nit }, holes: { 1: ['Js', 'Ts'] }, board: ['9s', '8s', '2d'] }),
    [[0, 'raise', 3], [1, 'call'], [1, 'check'], [0, 'bet', 4]]);
  const odds = liveOdds(getView(state, 1), [], { rng: createRng(3) });
  assert.equal(odds.potOdds, Math.round((400 / (1000 + 400)) * 10000) / 10000);
  assert.ok(odds.equity > 0 && odds.equity < 1);
  // Deterministic without an rng.
  assert.deepEqual(liveOdds(getView(state, 1), []), liveOdds(getView(state, 1), []));
  const done = play(state, [[1, 'fold']]);
  assert.deepEqual(liveOdds(getView(done, 1), []), { equity: null, potOdds: null });
});

test('EQ_BAD_CALL and EQ_BAD_FOLD: equity against the price, with at least 0.5bb lost', () => {
  const call = recordOf(HU({ hero: 1, profiles: { 0: PROFILES.nit }, holes: { 1: ['7c', '5d'] },
    board: ['Qh', 'Jc', '2s', '3d', '9h'] }), [
    [0, 'raise', 3], [1, 'call'], [1, 'check'], [0, 'check'], [1, 'check'], [0, 'check'], [1, 'check'],
    [0, 'bet', 6], [1, 'call'],
  ]);
  const r = analyze(call);
  assert.deepEqual(flagIds(r, 4), ['EQ_BAD_CALL']);
  const [bad] = flagsAt(r, 4);
  assert.deepEqual(bad.data, { equity: 0, requiredEquity: 0.333, toCallBb: 6, potBb: 12 });
  assert.equal(bad.severity, 'major');
  assert.equal(bad.evLossBb, 6);
  assert.equal(bad.oppTier, 'midReg');
  assert.equal(bad.street, 'river');
  assert.equal(r.decisions[4].bestAction, 'fold');
  // Preflop the chart owns the call: PF flag, no EQ flag.
  assert.deepEqual(flagIds(r, 0), ['PF_CALL_OUT_OF_RANGE']);

  const fold = recordOf(HU({ hero: 1, profiles: { 0: PROFILES.lowReg }, holes: { 1: ['Js', 'Ts'] },
    board: ['As', 'Ks', 'Qs', '2d', '3c'] }), [
    [0, 'raise', 2.5], [1, 'call'], [1, 'check'], [0, 'check'], [1, 'check'], [0, 'check'], [1, 'check'],
    [0, 'bet', 1], [1, 'fold'],
  ]);
  const f = analyze(fold);
  const [folded] = flagsAt(f, 4);
  assert.equal(folded.id, 'EQ_BAD_FOLD');
  assert.deepEqual(folded.data, { equity: 1, requiredEquity: 0.143, toCallBb: 1, potBb: 6 });
  assert.equal(f.grade, 'major');
});

test('EQ_MISSED_VALUE, LN_MISSED_CBET, EQ_BAD_BLUFF and the sizing flags', () => {
  // Hero (button) checks the nuts behind on the river.
  const value = analyze(recordOf(HU({ hero: 0, profiles: { 1: PROFILES.fish }, holes: { 0: ['Js', 'Ts'] },
    board: ['As', 'Ks', 'Qs', '2d', '3c'] }), [
    [0, 'raise', 2.5], [1, 'call'], [1, 'check'], [0, 'bet', 2], [1, 'call'], [1, 'check'], [0, 'bet', 5],
    [1, 'call'], [1, 'check'], [0, 'check'],
  ]));
  const [missed] = flagsAt(value, 3);
  assert.equal(missed.id, 'EQ_MISSED_VALUE');
  assert.equal(missed.data.equity, 1);
  assert.equal(missed.data.potBb, 19);
  assert.match(missed.data.bestAction, /^bet:/);
  assert.equal(missed.data.evGainBb, value.decisions[3].evLossBb);
  assert.equal(missed.oppTier, 'fish');
  // 2bb into 5bb on a monotone flop is well under 66–80%.
  assert.deepEqual(flagsAt(value, 1).map((f) => [f.id, f.data]), [
    ['SZ_TOO_SMALL', { sizePct: 0.4, recommendedPct: [0.66, 0.8], texture: 'monotone' }],
  ]);

  // Preflop raiser checks top set on the flop: a missed c-bet, not a missed-value flag.
  const cbet = analyze(recordOf(HU({ hero: 0, profiles: { 1: PROFILES.fish }, holes: { 0: ['Kh', 'Kd'] },
    board: ['Ks', '7d', '2c', '4h', '9s'] }), [[0, 'raise', 2.5], [1, 'call'], [1, 'check'], [0, 'check']]));
  assert.deepEqual(flagIds(cbet, 1), ['LN_MISSED_CBET']);
  const [c] = flagsAt(cbet, 1);
  assert.equal(c.data.texture, 'dry');
  assert.equal(c.data.numOpponents, 1);
  assert.ok(c.data.equity > 0.95);
  assert.deepEqual(flagIds(cbet, 2), ['EQ_MISSED_VALUE'], 'later streets are value flags');

  // A pot-size stab with 4-high into a fish that rarely folds, on a dry flop.
  const bluff = analyze(recordOf(HU({ hero: 0, profiles: { 1: PROFILES.fish }, holes: { 0: ['4c', '3d'] },
    board: ['Kh', '9c', '2s', '8d', 'Jh'] }), [[0, 'raise', 2.5], [1, 'call'], [1, 'check'], [0, 'bet', 5], [1, 'call']]));
  const b = Object.fromEntries(flagsAt(bluff, 1).map((f) => [f.id, f]));
  assert.deepEqual(Object.keys(b).sort(), ['EQ_BAD_BLUFF', 'SZ_TOO_LARGE']);
  assert.equal(b.EQ_BAD_BLUFF.data.sizePct, 1);
  assert.equal(b.EQ_BAD_BLUFF.data.oppVpip, 0.5);
  assert.ok(b.EQ_BAD_BLUFF.data.equity < 0.35);
  assert.ok(b.EQ_BAD_BLUFF.data.foldEstimate > 0.2 && b.EQ_BAD_BLUFF.data.foldEstimate < 0.35);
  assert.deepEqual(b.SZ_TOO_LARGE.data, { sizePct: 1, recommendedPct: [0.25, 0.33], texture: 'dry' });
  assert.equal(bluff.decisions[1].bestAction, 'check');

  // Shoves and polarized river bets aren't sizing mistakes.
  const shove = analyze(recordOf(HU({ hero: 0, stacksBb: 20, profiles: { 1: PROFILES.fish }, holes: { 0: ['Kh', 'Kd'] },
    board: ['Ks', '7d', '2c', '4h', '9s'] }), [[0, 'raise', 2.5], [1, 'call'], [1, 'check'], [0, 'bet', 17.5]]));
  assert.ok(!flagIds(shove, 1).includes('SZ_TOO_LARGE'));
  const polar = analyze(recordOf(HU({ hero: 0, profiles: { 1: PROFILES.fish }, holes: { 0: ['Js', 'Ts'] },
    board: ['As', 'Ks', 'Qs', '2d', '3c'] }), [
    [0, 'raise', 2.5], [1, 'call'], [1, 'check'], [0, 'bet', 4], [1, 'call'], [1, 'check'], [0, 'bet', 9],
    [1, 'call'], [1, 'check'], [0, 'bet', 40],
  ]));
  assert.ok(!flagIds(polar, 3).includes('SZ_TOO_LARGE'), 'river overbet with the nuts is polar');
});

test('LN_PAYOFF_PASSIVE_RAISE: calling a turn raise from a passive player without the goods', () => {
  const r = analyze(recordOf(HU({ hero: 1, profiles: { 0: PROFILES.passive }, holes: { 1: ['6h', '5h'] },
    board: ['Kd', '9c', '6s', '2d', '3c'] }), [
    [0, 'call'], [1, 'check'], [1, 'check'], [0, 'check'], [1, 'bet', 1.5], [0, 'raise', 6], [1, 'call'],
  ]));
  const [flag] = flagsAt(r, 3);
  assert.equal(flag.id, 'LN_PAYOFF_PASSIVE_RAISE');
  assert.equal(flag.data.oppAggression, 0.8);
  assert.equal(flag.data.toCallBb, 4.5);
  assert.ok(flag.data.equity < 0.5);
  assert.equal(flag.oppTier, 'fish');
  // The same line against an aggressive reg isn't flagged.
  const reg = analyze(recordOf(HU({ hero: 1, profiles: { 0: PROFILES.toughReg }, holes: { 1: ['6h', '5h'] },
    board: ['Kd', '9c', '6s', '2d', '3c'] }), [
    [0, 'call'], [1, 'check'], [1, 'check'], [0, 'check'], [1, 'bet', 1.5], [0, 'raise', 6], [1, 'call'],
  ]));
  assert.ok(!flagIds(reg, 3).includes('LN_PAYOFF_PASSIVE_RAISE'));
});

test('straddled pots: posts are never decisions, roles and sizes follow the straddle', () => {
  // 6-max, button 0: SB 1, BB 2, straddle 3. Hero straddles; HJ limps; hero checks its option,
  // then plays the flop.
  const option = recordOf(makeHand({ hero: 3, straddleSeat: 3, holes: { 3: ['9c', '8c'] },
    board: ['Kd', '7h', '2s', '4c', 'Jd'] }), [
    [4, 'call'], [5, 'fold'], [0, 'fold'], [1, 'fold'], [2, 'fold'], [3, 'check'], [3, 'check'], [4, 'check'],
  ]);
  const r = analyze(option);
  assert.equal(r.decisions.length, option.decisions.length);
  assert.equal(option.decisions[0].action.type, 'check', 'the first decision is the option, not the post');
  assert.equal(r.decisions[0].chart, null, 'a limped straddle has no chart row');
  assert.deepEqual(flagIds(r, 0), []);
  assert.equal(r.decisions[0].evByActionBb.fold, undefined, 'nothing to call: no fold');

  // Folded to the real BB, which opens from the SB row in effective blinds.
  const bb = recordOf(makeHand({ hero: 2, straddleSeat: 3, holes: { 2: ['7c', '2d'] } }), [
    [4, 'fold'], [5, 'fold'], [0, 'fold'], [1, 'fold'], [2, 'raise', 9], [3, 'fold'],
  ]);
  const rb = analyze(bb);
  assert.deepEqual(rb.decisions[0].chart, { position: 'SB', band: 'mid', action: 'open', freq: 0 });
  assert.deepEqual(flagsAt(rb, 0).map((f) => [f.id, f.data]), [
    ['PF_OPEN_OUT_OF_RANGE', { hand: '72o', position: 'SB', depthBand: 'mid', chartFreq: 0 }],
    ['PF_OPEN_SIZE', { sizeBb: 9, recommendedBb: [5, 7], position: 'SB', limpers: 0 }],
  ]);
  assert.equal(rb.flags.find((f) => f.id === 'PF_OPEN_SIZE').severity, 'info');
  assert.equal(rb.totalEvLossBb, 0.4);
  assert.equal(rb.grade, 'minor');

  // A straddle walk: hero posts and never decides.
  const walk = recordOf(makeHand({ hero: 3, straddleSeat: 3 }), [[4, 'fold'], [5, 'fold'], [0, 'fold'], [1, 'fold'], [2, 'fold']]);
  assert.deepEqual(analyze(walk), {
    handId: walk.id, version: 1, decisions: [], flags: [], totalEvLossBb: 0, grade: 'clean',
  });
});

test('bounty hands: no out-of-range flags for playing them, expected bounty added to continuing EV', () => {
  // Hero LJ opens 72o, the live hand bounty. 6 players × 2bb bounty → 10bb from the other five.
  const bounty = (type, target, paysOn = 'showdownOrFold') => [{ type, target, amountChips: 200, paysOn }];
  const hand = (bounties, steps = [[3, 'raise', 2.5]]) => recordOf(
    makeHand({ hero: 3, holes: { 3: ['7c', '2d'] }, board: ['Kd', '9h', '4s', 'Jc', '3h'], bounties }), steps);

  const plain = analyze(hand([]));
  const held = analyze(hand(bounty('hand', '72o')));
  assert.deepEqual(flagIds(plain, 0), ['PF_OPEN_OUT_OF_RANGE']);
  assert.deepEqual(flagIds(held, 0), []);
  assert.equal(held.decisions[0].evLossBb, 0);
  assert.equal(held.grade, 'clean');
  // Same rng stream, same ranges: same equity, so the EV gap is exactly the expected bounty.
  const E = plain.decisions[0].equity;
  assert.equal(held.decisions[0].equity, E);
  const gap = (key) => held.decisions[0].evByActionBb[key] - plain.decisions[0].evByActionBb[key];
  assert.equal(gap('fold'), 0);
  // A tie for the main pot qualifies too: P(win or tie), not the pot-share equity.
  const Q = firstWinOrTie(hand(bounty('hand', '72o')));
  assert.ok(Q > E);
  assert.ok(Math.abs(gap('call') - Q * 10) < 0.02, `call gap ${gap('call')} vs ${Q * 10}`);
  assert.ok(gap('raise:0.5') > gap('call'), 'fold wins pay with showdownOrFold');

  // A card bounty works the same; showdownOnly pays nothing for fold wins.
  const card = analyze(hand(bounty('card', '7c')));
  assert.deepEqual(flagIds(card, 0), []);
  const onlySd = analyze(hand(bounty('card', '7c', 'showdownOnly')));
  const sdGap = (key) => onlySd.decisions[0].evByActionBb[key] - plain.decisions[0].evByActionBb[key];
  assert.ok(Math.abs(sdGap('call') - Q * 10) < 0.02);
  assert.ok(sdGap('raise:0.5') < sdGap('call'), 'showdownOnly: only the called share can win it');

  // A bounty someone else could hold changes nothing for hero.
  const other = analyze(hand(bounty('hand', '83o')));
  assert.deepEqual(other.decisions, plain.decisions);
  assert.deepEqual(flagIds(other, 0), ['PF_OPEN_OUT_OF_RANGE']);

  // Calling a raise with the bounty hand is fine too; folding it isn't flagged either way.
  const defend = [[3, 'fold'], [4, 'fold'], [5, 'fold'], [0, 'raise', 2.5], [1, 'fold'], [2, 'call']];
  const bbHand = (bounties) => recordOf(makeHand({ hero: 2, holes: { 2: ['7c', '2d'] }, bounties }), defend);
  assert.deepEqual(flagIds(analyze(bbHand([])), 0), ['PF_CALL_OUT_OF_RANGE']);
  assert.deepEqual(flagIds(analyze(bbHand(bounty('hand', '72o'))), 0), []);
});

test('CoachResult: deterministic from the rng, grade rules, totals', () => {
  const record = recordOf(HU({ hero: 1, profiles: { 0: PROFILES.nit }, holes: { 1: ['7c', '5d'] },
    board: ['Qh', 'Jc', '2s', '3d', '9h'] }), [
    [0, 'raise', 3], [1, 'call'], [1, 'check'], [0, 'check'], [1, 'check'], [0, 'check'], [1, 'check'],
    [0, 'bet', 6], [1, 'call'],
  ]);
  const a = analyze(record);
  assert.deepEqual(analyzeHand(record), a, "the default rng is deriveSeed(seed, 'coach')");
  assert.deepEqual(analyze(record), a);
  assert.notDeepEqual(analyzeHand(record, { rng: createRng(99) }).decisions.map((d) => d.equity),
    a.decisions.map((d) => d.equity));
  assert.equal(analyze(record, { iterations: 300 }).decisions[1].equitySamples, 300);
  assert.equal(a.handId, record.id);
  assert.equal(a.totalEvLossBb, Math.round(a.decisions.reduce((s, d) => s + d.evLossBb, 0) * 100) / 100);
  assert.equal(a.grade, 'major');
  assert.ok(a.totalEvLossBb >= 5);
});

test('every flag in random bot-played hands matches the §8.3 contract', () => {
  const tiers = ['fish', 'lowReg', 'midReg', 'toughReg'];
  const records = [];
  const seen = new Set();
  for (let seed = 1; seed <= 120; seed++) {
    const sc = createScenario({
      stakes: 'low', seed, createdAt: 1790000000000 + seed,
      straddle: { enabled: true, heroChance: 0.3 },
      bounty: { hand: { enabled: true, chance: 0.5, amountBb: 2 }, card: { enabled: true, chance: 0.3, amountBb: 2 } },
    }, createRng(seed));
    const prng = createRng(deriveSeed(seed, 'profiles'));
    sc.seats = sc.seats.map((s) => ({ ...s, profile: s.isHero ? null : createBotProfile(s.tier, prng) }));
    const heroProfile = createBotProfile(tiers[seed % 4], prng);
    let state = createHand(sc);
    const rng = createRng(deriveSeed(seed, 'bots'));
    while (!isComplete(state)) {
      const seat = state.actingSeat;
      const profile = state.players[seat].profile ?? heroProfile;
      state = applyAction(state, decideAction(getView(state, seat), profile, { rng, heroStats: null }));
    }
    const record = buildHandRecord(state, { sessionId: 's', timestamp: 1790000000000 + seed });
    const result = analyzeHand(record, { rng: createRng(deriveSeed(record.seed, 'coach')), iterations: 400 });
    record.coach = result;
    records.push(record);

    assert.equal(result.decisions.length, record.decisions.length);
    result.decisions.forEach((d, i) => {
      assert.equal(d.decisionIndex, i);
      assert.ok(d.equity >= 0 && d.equity <= 1);
      assert.ok(Object.hasOwn(d.evByActionBb, d.bestAction), `${d.bestAction} in ${Object.keys(d.evByActionBb)}`);
      assert.ok(d.evLossBb >= 0);
      assert.equal(d.potOdds === null, record.decisions[i].toCallBb === 0);
      assert.equal(d.chart === null || record.decisions[i].street === 'preflop', true);
    });
    for (const f of result.flags) {
      seen.add(f.id);
      assert.ok(FLAG_IDS.includes(f.id) && !f.id.startsWith('PAT_'));
      assert.ok(FLAG_SEVERITIES.includes(f.severity));
      assert.deepEqual(Object.keys(f.data).sort(), DATA_KEYS[f.id].slice().sort(), f.id);
      assert.equal(f.street, record.decisions[f.decisionIndex].street);
      assert.ok(f.evLossBb >= 0);
      assert.ok(f.oppTier === null || tiers.includes(f.oppTier));
    }
    const hasMajor = result.flags.some((f) => f.severity === 'major');
    assert.equal(result.grade, hasMajor || result.totalEvLossBb >= 5 ? 'major' : result.flags.length ? 'minor' : 'clean');
  }
  assert.ok(seen.size >= 8, `only saw ${[...seen]}`);
  for (const f of detectPatterns(records, 'low')) assert.ok(f.id.startsWith('PAT_') && f.street === null);
});

test('river bettor range: dropped combos stay dropped when computing equity', () => {
  // Nit raised (AA/KK), then bet the river with bluffFreq 0: the weakest 30% (non-spade KK and
  // some non-spade AA) is gone. Q-high flush beats 2.4 of the remaining 8.4 combos: 2/7.
  const record = recordOf(HU({ hero: 1, profiles: { 0: PROFILES.nit }, holes: { 1: ['Qs', 'Jh'] },
    board: ['9s', '8s', '2s', '3s', '4d'] }), [
    [0, 'raise', 3], [1, 'call'], [1, 'check'], [0, 'check'], [1, 'check'], [0, 'check'], [1, 'check'],
    [0, 'bet', 4], [1, 'call'],
  ]);
  const { equity } = analyze(record).decisions[4];
  assert.ok(Math.abs(equity - 2 / 7) <= 0.03, `equity ${equity}, expected ~${(2 / 7).toFixed(3)}`);
});

test('pot odds use the effective call and the matched pot, not an opponent\'s unmatchable excess', () => {
  // HU: SB 100bb shoves, hero (BB, 20bb) calls 19bb. Only 20bb of the shove can be won: 40bb pot.
  const hand = () => HU({ hero: 1, stacksBb: [100, 20], profiles: { 0: PROFILES.lowReg },
    holes: { 1: ['7c', '2d'] }, board: ['Kd', '9h', '4s', 'Jc', '3h'] });
  const r = analyze(recordOf(hand(), [[0, 'raise', 100], [1, 'call']]));
  assert.equal(r.decisions[0].potOdds, 0.475);
  const [bad] = r.flags.filter((f) => f.id === 'EQ_BAD_CALL');
  assert.ok(bad, `EQ_BAD_CALL expected, got ${r.flags.map((f) => f.id)}`);
  assert.deepEqual({ ...bad.data, equity: undefined },
    { equity: undefined, requiredEquity: 0.475, toCallBb: 19, potBb: 21 });

  const odds = liveOdds(getView(play(hand(), [[0, 'raise', 100]]), 1), [], { rng: createRng(3) });
  assert.equal(odds.potOdds, 0.475);
});

test('liveOdds: both null once hero has folded, even while others still bet', () => {
  // 3-handed, button 0 = hero folds first; the SB then raises, so hero would "owe" 3bb.
  const state = play(makeHand({ n: 3, button: 0, hero: 0, holes: { 0: ['7c', '2d'] } }),
    [[0, 'fold'], [1, 'raise', 3]]);
  assert.equal(isComplete(state), false);
  assert.deepEqual(liveOdds(getView(state, 0), [], { rng: createRng(1) }), { equity: null, potOdds: null });
});

test('sizing thresholds compare the exact bet size, not the rounded percentage', () => {
  // 20bb pot on a dry K72 flop: 2.98bb is 14.9% of the pot, under the 25% − 10pp floor.
  const sized = (toBb) => analyze(recordOf(HU({ hero: 1, holes: { 1: ['Ah', 'Kc'] }, board: ['Kd', '7h', '2c', '9s', '4d'] }),
    [[0, 'raise', 10], [1, 'call'], [1, 'bet', toBb]]));
  const small = sized(2.98);
  assert.equal(small.decisions[1].texture, 'dry');
  assert.deepEqual(flagIds(small, 1).filter((id) => id.startsWith('SZ_')), ['SZ_TOO_SMALL']);
  assert.deepEqual(flagIds(sized(3), 1).filter((id) => id.startsWith('SZ_')), [], 'exactly 15% is not below it');
  // Wet 987: a bet of exactly 66% − 10pp (11.2bb, 56%) isn't below the floor either.
  const wet = analyze(recordOf(HU({ hero: 1, holes: { 1: ['Ah', 'Kc'] }, board: ['9h', '8h', '7c', '2s', '4d'] }),
    [[0, 'raise', 10], [1, 'call'], [1, 'bet', 11.2]]));
  assert.equal(wet.decisions[1].texture, 'wet');
  assert.deepEqual(flagIds(wet, 1).filter((id) => id.startsWith('SZ_')), []);
});

test('bounty EV counts a tie for the main pot as qualifying (§15: at least a share of pots[0])', () => {
  // Royal flush on board: hero always splits the pot, so equity is 50% but the card bounty is certain.
  const record = recordOf(HU({ hero: 1, holes: { 1: ['2c', '3d'] }, board: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
    bounties: [{ type: 'card', target: '2c', amountChips: 200, paysOn: 'showdownOnly' }] }), [
    [0, 'call'], [1, 'check'], [1, 'check'], [0, 'check'], [1, 'check'], [0, 'check'], [1, 'check'],
  ]);
  const river = analyze(record).decisions[3];
  assert.equal(river.equity, 0.5);
  assert.equal(river.evByActionBb.check, 0.5 * 2 + 2, 'half the 2bb pot plus the whole 2bb bounty');
});

test('bounty EV caps each payment at the payer\'s stack after the pot is awarded', () => {
  // River: villain has 12bb left, hero shoves 97bb, showdownOnly. A villain who calls is all-in,
  // so after losing the pot it has nothing left to pay: the shove gains nothing from the bounty.
  const hand = (bounties) => recordOf(HU({ hero: 1, stacksBb: [15, 100], holes: { 1: ['7c', '7d'] },
    board: ['Kd', '9h', '4s', 'Jc', '3h'], bounties }), [
    [0, 'raise', 3], [1, 'call'], [1, 'check'], [0, 'check'], [1, 'check'], [0, 'check'], [1, 'bet', 97],
  ]);
  const plain = analyze(hand([])).decisions[3];
  const held = analyze(hand([{ type: 'card', target: '7c', amountChips: 200, paysOn: 'showdownOnly' }])).decisions[3];
  assert.equal(held.equity, plain.equity);
  assert.equal(held.evByActionBb.allIn, plain.evByActionBb.allIn);
  assert.ok(held.evByActionBb.check > plain.evByActionBb.check, 'checking keeps its 12bb, so it still pays');
});
