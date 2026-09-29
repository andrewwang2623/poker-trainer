import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRng, createScenario, createHand, applyAction, getLegalActions, getView, isComplete, buildHandRecord,
  chooseStraddleSeat, straddlePosition, STRADDLE_RATES, STRADDLE_CHIPS,
} from '../../src/engine/index.js';
import { TIERS } from '../../src/shared/schemas.js';
import { makeScenario, play, eventsOf, assertConserved } from './_helpers.js';

const ON = Object.freeze({ enabled: true, heroChance: 1 });
const scenarioFor = (seed, straddle, extra = {}) =>
  createScenario({ stakes: 'micro', seed, createdAt: 1790000000000, straddle, ...extra }, createRng(seed));

/** 5-handed, button 0: SB 1, BB 2, straddle 3 (first after the BB), then 4, 0, 1, 2, 3. */
const straddled = (stacks = [10000, 10000, 10000, 10000, 10000], opts = {}) =>
  createHand({ ...makeScenario({ stacks, button: 0, hero: 4, ...opts }), straddleSeat: 3 }, opts.cards ? { cards: opts.cards } : {});

test('straddles are off by default and when disabled; enabling never shifts other streams', () => {
  let hits = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const base = scenarioFor(seed);
    assert.equal(base.straddleSeat, null);
    assert.equal(scenarioFor(seed, { enabled: false, heroChance: 1 }).straddleSeat, null);
    const on = scenarioFor(seed, ON);
    const { straddleSeat, ...rest } = on;
    const { straddleSeat: baseStraddle, ...baseRest } = base;
    assert.equal(baseStraddle, null);
    assert.deepEqual(rest, baseRest, 'seats, stacks, tiers and button are unchanged');
    if (straddleSeat !== null) {
      hits++;
      assert.equal(straddleSeat, straddlePosition(on.numPlayers, on.buttonSeat));
      // Same deal whether or not the straddle is posted.
      const a = createHand(base);
      const b = createHand(on);
      assert.deepEqual(a.players.map((p) => p.holeCards), b.players.map((p) => p.holeCards));
      assert.deepEqual(a.deck, b.deck);
    }
  }
  assert.ok(hits > 0);
});

test('eligibility: heads-up never, UTG only, and never with a UTG stack of 2bb or less', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const sc = scenarioFor(seed, ON);
    if (sc.numPlayers === 2) assert.equal(sc.straddleSeat, null);
  }
  assert.equal(straddlePosition(2, 0), null);
  assert.equal(straddlePosition(3, 0), 0, '3-handed the button is first after the BB');
  assert.equal(straddlePosition(6, 4), 1);
  const custom = (stack) => ({
    seed: 5, numPlayers: 4, buttonSeat: 0, heroSeat: 3,
    seats: [0, 1, 2, 3].map((seat) => ({ seat, stack: seat === 3 ? stack : 10000, tier: seat === 3 ? null : 'fish' })),
  });
  assert.equal(chooseStraddleSeat(custom(STRADDLE_CHIPS), ON), null);
  assert.equal(chooseStraddleSeat(custom(STRADDLE_CHIPS + 1), ON), 3);
  assert.equal(chooseStraddleSeat(custom(10000), { enabled: true, heroChance: 0 }), null);
  assert.equal(chooseStraddleSeat(custom(10000), { enabled: false, heroChance: 1 }), null);

  for (const bad of [{ enabled: 'yes' }, { enabled: true, heroChance: 1.5 }, { enabled: true, heroChance: -0.1 },
    { enabled: true, heroChance: NaN }, { enabled: true, heroChance: '0.5' }, 0.3]) {
    assert.throws(() => scenarioFor(1, bad), RangeError);
  }
  // createHand rejects a straddleSeat the rules don't allow.
  const base = makeScenario({ stacks: [10000, 10000, 10000, 10000, 10000], button: 0 });
  assert.throws(() => createHand({ ...base, straddleSeat: 4 }), RangeError);
  assert.throws(() => createHand({ ...makeScenario({ stacks: [10000, 10000] }), straddleSeat: 1 }), RangeError);
  assert.throws(() => createHand({ ...makeScenario({ stacks: [10000, 10000, 10000, 200, 10000] }), straddleSeat: 3 }), RangeError);
});

test('hero straddles only through heroChance; bots straddle at their tier rate', () => {
  assert.deepEqual({ ...STRADDLE_RATES }, { fish: 0.25, lowReg: 0.10, midReg: 0.05, toughReg: 0.03 });
  let heroUtg = 0;
  for (let seed = 1; seed <= 3000; seed++) {
    const off = scenarioFor(seed, { enabled: true, heroChance: 0 });
    const on = scenarioFor(seed, ON);
    const utg = straddlePosition(on.numPlayers, on.buttonSeat);
    if (utg === on.heroSeat) {
      heroUtg++;
      assert.equal(off.straddleSeat, null);
      assert.equal(on.straddleSeat, utg);
    } else {
      assert.equal(off.straddleSeat, on.straddleSeat, 'heroChance never affects bots');
    }
  }
  assert.ok(heroUtg > 100);

  const rate = (tier) => {
    const pool = Object.fromEntries(TIERS.map((t) => [t, t === tier ? 1 : 0]));
    let eligible = 0;
    let hits = 0;
    for (let seed = 1; seed <= 6000; seed++) {
      const sc = scenarioFor(seed, { enabled: true, heroChance: 0 }, { poolOverride: pool });
      if (sc.numPlayers < 3 || straddlePosition(sc.numPlayers, sc.buttonSeat) === sc.heroSeat) continue;
      eligible++;
      if (sc.straddleSeat !== null) hits++;
    }
    return hits / eligible;
  };
  const rates = Object.fromEntries(TIERS.map((t) => [t, rate(t)]));
  for (const t of TIERS) assert.ok(Math.abs(rates[t] - STRADDLE_RATES[t]) < 0.025, `${t}: ${rates[t]}`);
  assert.ok(rates.fish > rates.lowReg && rates.lowReg > rates.toughReg);
  assert.ok(rates.fish > 4 * rates.toughReg);
});

test('createHand posts the live 2bb straddle after SB and BB, before hole cards', () => {
  const s = straddled();
  assert.equal(s.straddleSeat, 3);
  const posts = eventsOf(s, 'postBlind');
  assert.deepEqual(posts.map((e) => [e.seat, e.blind, e.amount]), [[1, 'SB', 40], [2, 'BB', 100], [3, 'straddle', 200]]);
  const firstDeal = s.events.findIndex((e) => e.type === 'dealHole');
  assert.ok(s.events.findIndex((e) => e.blind === 'straddle') < firstDeal);
  assert.equal(s.players[3].stack, 9800);
  assert.equal(s.players[3].committedStreet, 200);
  assert.equal(s.currentBet, 200);
  assert.equal(s.preflopAggressorSeat, null, 'the straddle is not a raise');
  assert.equal(s.actingSeat, 4);
  assert.deepEqual(getLegalActions(s), { seat: 4, types: ['fold', 'call', 'raise'], toCall: 200, minTo: 400, maxTo: 10000 });
  assert.equal(straddled().players.find((p) => p.seat === 3).position, 'HJ');
  // Without a straddle nothing changes.
  const plain = createHand(makeScenario({ stacks: [10000, 10000, 10000, 10000, 10000] }));
  assert.equal(plain.straddleSeat, null);
  assert.equal(eventsOf(plain, 'postBlind').length, 2);
  assert.equal(plain.actingSeat, 3);
});

test('action runs left of the straddler, who keeps the option; postflop order is unchanged', () => {
  let s = play(straddled(), [[4, 'call'], [0, 'call'], [1, 'call'], [2, 'call']]);
  assert.deepEqual(getLegalActions(s), { seat: 3, types: ['check', 'raise'], toCall: 0, minTo: 400, maxTo: 10000 });
  s = play(s, [[3, 'check']]);
  assert.equal(s.street, 'flop');
  assert.equal(s.actingSeat, 1, 'SB acts first postflop');
  s = play(s, [[1, 'check'], [2, 'check'], [3, 'check'], [4, 'check'], [0, 'check']]);
  assert.equal(s.street, 'turn');

  // The straddler can raise its option, and the limpers get to respond.
  s = play(straddled(), [[4, 'call'], [0, 'call'], [1, 'fold'], [2, 'fold'], [3, 'raise', 800]]);
  assert.equal(s.actingSeat, 4);
  assert.equal(getLegalActions(s).minTo, 1400);

  // 3-handed: the button straddles and the SB acts first.
  const three = createHand({ ...makeScenario({ stacks: [10000, 10000, 10000], button: 0 }), straddleSeat: 0 });
  assert.equal(three.actingSeat, 1);
  const after = play(three, [[1, 'call'], [2, 'call']]);
  assert.deepEqual(getLegalActions(after).types, ['check', 'raise']);
});

test('the minimum raise over a straddle is to 4bb', () => {
  const s = straddled();
  assert.throws(() => applyAction(s, { type: 'raise', amount: 399 }), RangeError);
  const r = applyAction(s, { type: 'raise', amount: 400 });
  assert.equal(getLegalActions(r).minTo, 600);
});

test('an all-in below the min raise over a straddle does not reopen betting for callers', () => {
  // Seat 0 has 3.5bb: its all-in to 350 is 150 over the straddle, short of a full 200 raise.
  let s = straddled([350, 10000, 10000, 10000, 10000]);
  s = play(s, [[4, 'call']]);
  assert.deepEqual(getLegalActions(s), { seat: 0, types: ['fold', 'call', 'raise'], toCall: 200, minTo: 350, maxTo: 350 });
  s = play(s, [[0, 'raise', 350], [1, 'fold'], [2, 'fold']]);
  // The straddler hasn't acted yet, so it may still raise: min is 350 + 200.
  assert.deepEqual(getLegalActions(s), { seat: 3, types: ['fold', 'call', 'raise'], toCall: 150, minTo: 550, maxTo: 10000 });
  s = play(s, [[3, 'call']]);
  assert.deepEqual(getLegalActions(s).types, ['fold', 'call'], 'seat 4 already acted: no re-raise');
  s = play(s, [[4, 'call']]);
  assert.equal(s.street, 'flop');
  assert.equal(s.potCollected, 40 + 100 + 350 * 3);
});

test('side pots with a short straddler conserve chips and take rake main-first', () => {
  // 4-handed, button 0: SB 1, BB 2, straddle 3 (5bb total). Everyone ends up all-in or calling.
  let s = createHand({
    ...makeScenario({ stacks: [1000, 2000, 3000, 500], button: 0, hero: 0 }), straddleSeat: 3,
  }, { cards: { holes: { 0: ['Ah', 'Ad'], 1: ['Kh', 'Kd'], 2: ['Qh', 'Qd'], 3: ['Jh', 'Jd'] }, board: ['2c', '5s', '9d', 'Tc', '3h'] } });
  s = play(s, [[0, 'raise', 1000], [1, 'raise', 2000], [2, 'call'], [3, 'call']]);
  assert.ok(isComplete(s));
  const pots = s.result.pots;
  assert.deepEqual(pots.map((p) => p.eligibleSeats), [[0, 1, 2, 3], [0, 1, 2], [1, 2]]);
  const rake = Math.min(Math.floor(5500 * 0.05), 400);
  assert.equal(s.result.rakeChips, rake);
  assert.deepEqual(pots.map((p) => p.amount), [2000 - rake, 1500, 2000]);
  assert.deepEqual(pots.map((p) => p.winnerSeats), [[0], [0], [1]]);
  assertConserved(s);
});

test('rake: a walk to the straddler is not raked; a flopped pot with a straddle is', () => {
  let s = play(straddled(), [[4, 'fold'], [0, 'fold'], [1, 'fold'], [2, 'fold']]);
  assert.ok(isComplete(s));
  assert.equal(s.result.rakeChips, 0);
  assert.deepEqual(eventsOf(s, 'uncalled').map((e) => [e.seat, e.amount]), [[3, 100]]);
  assert.equal(s.result.netChips[3], 140);
  assertConserved(s);

  s = play(straddled(), [[4, 'call'], [0, 'call'], [1, 'call'], [2, 'call'], [3, 'check']]);
  while (!isComplete(s)) s = applyAction(s, { type: 'check' });
  assert.equal(s.result.rakeChips, Math.floor(1000 * 0.05));
  assertConserved(s);
});

test('records treat the straddle as a forced post, not VPIP, PFR or a raise', () => {
  // 7-handed, button 0: SB 1, BB 2, UTG 3 straddles.
  const seven = (hero) => createHand({ ...makeScenario({ stacks: Array(7).fill(10000), button: 0, hero }), straddleSeat: 3 });
  const limpAround = [[4, 'call'], [5, 'call'], [6, 'call'], [0, 'call'], [1, 'call'], [2, 'call']];
  const finish = (s) => { while (!isComplete(s)) s = applyAction(s, { type: 'check' }); return s; };

  let rec = buildHandRecord(finish(play(seven(3), [...limpAround, [3, 'check']])), { sessionId: 's', timestamp: 1 });
  assert.equal(rec.heroPosition, 'UTG');
  assert.equal(rec.straddleSeat, 3);
  assert.equal(rec.statFlags.straddled, true);
  assert.equal(rec.statFlags.facedStraddle, false);
  assert.equal(rec.statFlags.vpip, false);
  assert.equal(rec.statFlags.pfr, false);
  assert.equal(rec.decisions[0].street, 'preflop');
  assert.equal(rec.decisions[0].facing, 'limped');
  assert.deepEqual(rec.decisions[0].action, { type: 'check' });
  assert.equal(rec.decisions[0].stackBeforeBb, 98);

  rec = buildHandRecord(finish(play(seven(3), [...limpAround, [3, 'raise', 1000], ...limpAround.map(([seat]) => [seat, 'call'])])), { sessionId: 's' });
  assert.equal(rec.statFlags.vpip, true);
  assert.equal(rec.statFlags.pfr, true);
  assert.equal(rec.statFlags.threeBetOpp, false, 'the straddle is not an open to 3-bet');

  let s = play(seven(4), [[4, 'call'], [5, 'fold'], [6, 'fold'], [0, 'fold'], [1, 'fold'], [2, 'fold'], [3, 'check']]);
  rec = buildHandRecord(finish(s), { sessionId: 's' });
  assert.equal(rec.statFlags.straddled, false);
  assert.equal(rec.statFlags.facedStraddle, true);
  assert.equal(rec.statFlags.vpip, true);
  assert.equal(rec.statFlags.pfr, false);
  assert.equal(rec.decisions[0].facing, 'unopened');
  assert.equal(rec.decisions[0].toCallBb, 2);

  s = play(seven(4), [[4, 'fold'], [5, 'fold'], [6, 'fold'], [0, 'fold'], [1, 'fold'], [2, 'fold']]);
  rec = buildHandRecord(s, { sessionId: 's' });
  assert.equal(rec.statFlags.vpip, false);
  assert.equal(rec.statFlags.facedStraddle, true);

  rec = buildHandRecord(finish(play(createHand(makeScenario({ stacks: [10000, 10000, 10000] })), [[0, 'call'], [1, 'call'], [2, 'check']])), { sessionId: 's' });
  assert.equal(rec.straddleSeat, null);
  assert.equal(rec.statFlags.straddled, false);
  assert.equal(rec.statFlags.facedStraddle, false);
});

test('straddled hands are deterministic by seed and redact views as usual', () => {
  let found = 0;
  for (let seed = 1; found < 20; seed++) {
    const sc = scenarioFor(seed, ON);
    if (sc.straddleSeat === null) continue;
    found++;
    assert.deepEqual(scenarioFor(seed, ON), sc);
    const run = () => {
      let s = createHand(sc);
      while (!isComplete(s)) {
        const legal = getLegalActions(s);
        s = applyAction(s, legal.types.includes('check') ? { type: 'check' } : { type: 'call' });
      }
      return s;
    };
    assert.deepEqual(run(), run());

    const s = createHand(sc);
    const viewer = (sc.straddleSeat + 1) % sc.numPlayers;
    const view = getView(s, viewer);
    assert.equal(view.straddleSeat, sc.straddleSeat);
    assert.ok(!('deck' in view) && !('seed' in view));
    for (const p of view.players) assert.equal(p.holeCards.length, p.seat === viewer ? 2 : 0);
    assert.ok(view.events.every((e) => e.type !== 'dealHole' || e.seat === viewer));
    assert.equal(view.events.filter((e) => e.blind === 'straddle').length, 1);
    assert.equal(view.pot, s.players.reduce((a, p) => a + p.committedStreet, 0));
  }
});
