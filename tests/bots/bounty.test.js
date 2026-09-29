// Bots with bounties live (SPEC §15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAction, createBotProfile, BOUNTY_CHASE } from '../../src/bots/index.js';
import { TIER_RANGES } from '../../src/bots/profiles.js';
import { couldHoldBounty, heldBounties, heldBountyValue } from '../../src/bots/strategy/bounty.js';
import {
  createRng, deriveSeed, createScenario, createHand, getLegalActions, applyAction, getView, isComplete, handClass,
} from '../../src/engine/index.js';
import { STAKES, TIERS } from '../../src/shared/schemas.js';
import { hashRecords } from '../engine/_fingerprint.js';
import { botPlayRecords } from './_fingerprint.js';
import { simulateBotHands } from './_sim.js';

const EXPLOITABLE_HERO = Object.freeze({
  window: 'session', hands: 60, vpip: 0.5, pfr: 0.05, threeBet: 0.02, foldToCbet: 0.7,
  wtsd: 0.4, af: 1.2, foldToBet: 0.65,
});

function midProfile(tier) {
  const p = createBotProfile(tier, createRng(7));
  for (const [f, v] of Object.entries(TIER_RANGES[tier])) if (Array.isArray(v)) p[f] = (v[0] + v[1]) / 2;
  return p;
}

const hand = (target, amountBb = 2, paysOn = 'showdownOrFold') => ({ type: 'hand', target, amountChips: amountBb * 100, paysOn });
const card = (target, amountBb = 2, paysOn = 'showdownOrFold') => ({ type: 'card', target, amountChips: amountBb * 100, paysOn });

/** A hand with fixed seats ([{profile|null (hero)}], 100bb each), bounties and preset cards. */
function fixedHand({ profiles, buttonSeat, heroSeat, bounties = [], holes, board }) {
  return createHand({
    seed: 1, createdAt: 1, stakes: 'mid', numPlayers: profiles.length, buttonSeat, heroSeat, bounties,
    seats: profiles.map((profile, seat) => ({
      seat, isHero: seat === heroSeat, stack: 10000, tier: profile?.tier ?? null, profile,
    })),
  }, { cards: { holes, board } });
}

const decide = (s, profile, seed) =>
  decideAction(getView(s, s.actingSeat), profile, { rng: createRng(seed), heroStats: null });

// sha256 of 150 bot-played records, new fields stripped. First pinned before bounties existed (commit
// c269744, 7f76a659…); re-pinned for price- and position-aware blind defense and opener play vs 3-bets
// (deliberate strategy changes, not bounty ones: the test below checks bounties-off play directly).
const PRE_BOUNTY_BOT_RECORDS = '4ef58119b48644ae253638d5d33b207cd82c34d5f486267bb8faa1f5183606d1';

test('bounties off: bots play exactly as before bounties existed', () => {
  assert.equal(hashRecords(botPlayRecords()), PRE_BOUNTY_BOT_RECORDS);
});

test('bounties off: explicitly disabled bounty settings play exactly like no bounty option', () => {
  const disabled = {
    hand: { enabled: false, chance: 1, amountBb: 40 }, card: { enabled: false, chance: 1, amountBb: 40 },
    paysOn: 'showdownOnly',
  };
  assert.equal(hashRecords(botPlayRecords({ to: 80, extra: { bounty: disabled } })), hashRecords(botPlayRecords({ to: 80 })));
});

test('bots always act legally with bounties live', () => {
  let decisions = 0;
  let holding = 0;
  let paid = 0;
  for (let seed = 1; decisions < 8000; seed++) {
    const rng = createRng(seed);
    const paysOn = seed % 2 ? 'showdownOrFold' : 'showdownOnly';
    const amountBb = [1, 2, 5, 40][seed % 4];
    const scenario = createScenario({
      stakes: Object.keys(STAKES)[seed % 4], seed, createdAt: seed,
      straddle: { enabled: seed % 3 === 0, heroChance: 0.5 },
      bounty: { hand: { enabled: true, chance: 1, amountBb }, card: { enabled: true, chance: 1, amountBb }, paysOn },
      poolOverride: { fish: 1, lowReg: 1, midReg: 1, toughReg: 1 },
    }, rng);
    // Aim the bounties at dealt cards (the deal doesn't depend on them) so bots hold them often.
    const holes = createHand(scenario).players.map((p) => p.holeCards);
    scenario.bounties = scenario.bounties.map((b, i) => ({
      ...b, target: b.type === 'hand' ? handClass(holes[(seed + i) % holes.length]) : holes[(seed + 3) % holes.length][i % 2],
    }));
    const botRng = createRng(deriveSeed(seed, 'bots'));
    for (const seat of scenario.seats) if (!seat.isHero) seat.profile = createBotProfile(seat.tier, botRng);
    const heroStats = seed % 2 ? EXPLOITABLE_HERO : null;
    let s = createHand(scenario);
    while (!isComplete(s)) {
      const seat = s.actingSeat;
      const legal = getLegalActions(s);
      let action;
      if (seat === s.heroSeat) {
        const type = legal.types[Math.floor(rng() * legal.types.length)];
        action = type === 'bet' || type === 'raise'
          ? { type, amount: legal.minTo + Math.floor(rng() * (legal.maxTo - legal.minTo + 1)) } : { type };
      } else {
        const view = getView(s, seat);
        if (heldBounties(view).length) holding++;
        action = decideAction(view, s.players[seat].profile, { rng: botRng, heroStats });
        assert.ok(legal.types.includes(action.type), `seed ${seed}: ${action.type} not in ${legal.types}`);
        if (action.type === 'bet' || action.type === 'raise') {
          assert.ok(Number.isInteger(action.amount) && action.amount >= legal.minTo && action.amount <= legal.maxTo,
            `seed ${seed}: ${action.type} to ${action.amount} outside [${legal.minTo}, ${legal.maxTo}]`);
        } else {
          assert.equal(action.amount, undefined);
        }
        decisions++;
      }
      s = applyAction(s, action);
    }
    assert.equal(s.result.bountyNetChips.reduce((a, b) => a + b, 0), 0);
    if (s.events.some((e) => e.type === 'bounty')) paid++;
  }
  assert.ok(holding > 1500, `${holding} decisions holding a bounty`);
  assert.ok(paid > 100, `${paid} hands paid a bounty`);
});

test('preflop: a bounty hand is played at the tier chase rate instead of folded', () => {
  assert.ok(BOUNTY_CHASE.fish > BOUNTY_CHASE.lowReg && BOUNTY_CHASE.lowReg > BOUNTY_CHASE.midReg &&
    BOUNTY_CHASE.midReg > BOUNTY_CHASE.toughReg && BOUNTY_CHASE.toughReg > 0);
  // 6-handed, button 0: SB 1, BB 2; seat 3 (LJ) is first to act with 7-2 offsuit. Hero is seat 0.
  const N = 400;
  const rates = {};
  for (const tier of TIERS) {
    const bot = midProfile(tier);
    const profiles = [null, bot, bot, bot, bot, bot];
    const spot = (bounties, holes = { 3: ['7h', '2d'] }) => fixedHand({ profiles, buttonSeat: 0, heroSeat: 0, bounties, holes });
    const played = (s) => {
      let n = 0;
      for (let seed = 0; seed < N; seed++) if (decide(s, bot, seed).type !== 'fold') n++;
      return n / N;
    };
    assert.equal(played(spot([])), 0, `${tier} folds 72o without a bounty`);
    assert.equal(played(spot([hand('J4o')])), 0, `${tier}: someone else's bounty changes nothing`);
    const open = played(spot([hand('72o')]));
    assert.ok(Math.abs(open - BOUNTY_CHASE[tier]) < 0.07, `${tier} open ${open}`);
    assert.ok(Math.abs(played(spot([card('2d')])) - BOUNTY_CHASE[tier]) < 0.07, `${tier} card bounty`);
    // Unopened, it enters as a medium hand: never a 3-bet-sized raise, and chart bots raise.
    for (let seed = 0; seed < 40; seed++) {
      const a = decide(spot([hand('72o')]), bot, seed);
      if (a.type === 'raise') assert.equal(a.amount, 250);
      if (bot.usesCharts) assert.notEqual(a.type, 'call');
    }
    // Facing a single raise it defends by calling.
    let s = applyAction(spot([hand('72o')], { 4: ['7h', '2d'] }), { type: 'raise', amount: 250 });
    const calls = Array.from({ length: N }, (_, seed) => decide(s, bot, seed).type);
    assert.ok(calls.every((t) => t === 'fold' || t === 'call'));
    assert.ok(Math.abs(calls.filter((t) => t === 'call').length / N - BOUNTY_CHASE[tier]) < 0.07, `${tier} defend`);
    // Facing a 3-bet it doesn't chase.
    s = applyAction(spot([hand('72o')], { 5: ['7h', '2d'] }), { type: 'raise', amount: 250 });
    s = applyAction(s, { type: 'raise', amount: 900 });
    assert.equal(played(s), 0, `${tier} folds to a 3-bet`);
    rates[tier] = open;
  }
  assert.ok(rates.fish > rates.lowReg && rates.lowReg > rates.midReg && rates.midReg > rates.toughReg, JSON.stringify(rates));
});

/**
 * Heads-up, checked to the river: hero (seat 0) on the button, bot in the BB with 7-2 offsuit
 * (no pair) on A K 9 5 J, and hero bets the pot into the bot.
 */
function riverSpot(bot, bounties) {
  let s = fixedHand({
    profiles: [null, bot], buttonSeat: 0, heroSeat: 0, bounties,
    holes: { 0: ['Qs', 'Qd'], 1: ['7h', '2d'] }, board: ['As', 'Kd', '9c', '5h', 'Jc'],
  });
  s = applyAction(s, { type: 'call' });
  s = applyAction(s, { type: 'check' });
  for (let i = 0; i < 2; i++) s = applyAction(applyAction(s, { type: 'check' }), { type: 'check' });
  assert.equal(s.street, 'river');
  return applyAction(applyAction(s, { type: 'check' }), { type: 'bet', amount: 200 });
}

/** Decisions over seeds 0..N-1; with equal seeds, a bounty can only turn folds into calls. */
function paired(bot, a, b, N = 400) {
  const x = Array.from({ length: N }, (_, seed) => decide(a, bot, seed).type);
  const y = Array.from({ length: N }, (_, seed) => decide(b, bot, seed).type);
  return { x, y, count: (arr, t) => arr.filter((v) => v === t).length };
}

test('river: holding a bounty folds less, more so for fish than tough regs', () => {
  const extra = {};
  for (const tier of TIERS) {
    const bot = midProfile(tier);
    const { x, y, count } = paired(bot, riverSpot(bot, []), riverSpot(bot, [hand('72o', 5, 'showdownOnly')]));
    x.forEach((t, i) => { if (t !== 'fold') assert.notEqual(y[i], 'fold', `${tier} seed ${i}`); });
    extra[tier] = (count(y, 'call') - count(x, 'call')) / x.length;
    assert.ok(extra[tier] > 0, `${tier} calls more (${extra[tier]})`);
  }
  assert.ok(extra.fish > extra.toughReg, JSON.stringify(extra));
});

test('postflop bluffs go up only when a fold win pays the bounty', () => {
  for (const tier of TIERS) {
    const bot = midProfile(tier);
    // Checked to the bot on the river: hero is in the BB here, so swap seats (bot on the button).
    const spot = (bounties) => {
      let s = fixedHand({
        profiles: [bot, null], buttonSeat: 0, heroSeat: 1, bounties,
        holes: { 1: ['Qs', 'Qd'], 0: ['7h', '2d'] }, board: ['As', 'Kd', '9c', '5h', 'Jc'],
      });
      s = applyAction(applyAction(s, { type: 'call' }), { type: 'check' });
      for (let i = 0; i < 2; i++) s = applyAction(applyAction(s, { type: 'check' }), { type: 'check' });
      s = applyAction(s, { type: 'check' });
      assert.equal(s.actingSeat, 0);
      return s;
    };
    const base = spot([]);
    const orFold = paired(bot, base, spot([hand('72o', 2, 'showdownOrFold')]));
    const onlySd = paired(bot, base, spot([hand('72o', 2, 'showdownOnly')]));
    assert.deepEqual(onlySd.y, onlySd.x, `${tier}: showdownOnly doesn't change bluffing`);
    orFold.x.forEach((t, i) => { if (t === 'bet') assert.equal(orFold.y[i], 'bet'); });
    const more = orFold.count(orFold.y, 'bet') - orFold.count(orFold.x, 'bet');
    assert.ok(more > 0, `${tier} bluffs more (${more})`);
  }
});

test('a small call bonus facing a player who could hold a bounty, only when a fold win pays it', () => {
  const bot = midProfile('lowReg');
  // Flop, heads-up: hero bets into the bot. A card bounty on 4c (unseen) vs on 3c (on the board).
  const board = ['As', 'Td', '3c', '5h', 'Jc'];
  const flop = (bounties, holes = ['8h', '6d']) => {
    let s = fixedHand({ profiles: [null, bot], buttonSeat: 0, heroSeat: 0, bounties, holes: { 0: ['Qs', 'Qd'], 1: holes }, board });
    s = applyAction(applyAction(s, { type: 'call' }), { type: 'check' });
    return applyAction(applyAction(s, { type: 'check' }), { type: 'bet', amount: 150 });
  };
  const unseen = flop([card('4c')]);
  assert.equal(couldHoldBounty(getView(unseen, 1), 0), true);
  assert.equal(couldHoldBounty(getView(flop([card('3c')]), 1), 0), false);
  assert.equal(couldHoldBounty(getView(unseen, 1), 1), false, 'never ourselves');
  const sdOnly = flop([card('4c', 2, 'showdownOnly')]);
  assert.equal(couldHoldBounty(getView(sdOnly, 1), 0), true);
  assert.equal(couldHoldBounty(getView(sdOnly, 1), 0, 'showdownOrFold'), false);
  assert.equal(couldHoldBounty(getView(unseen, 1), 0, 'showdownOrFold'), true);
  assert.equal(couldHoldBounty(getView(flop([hand('86o')]), 1), 0), false, 'we hold it');
  // A hand bounty is impossible once our cards and the board block every combo.
  const blocked = fixedHand({ profiles: [null, bot], buttonSeat: 0, heroSeat: 0, bounties: [hand('AA')],
    holes: { 0: ['Qs', 'Qd'], 1: ['Ah', 'Ad'] }, board: ['As', 'Td', '3c'] });
  assert.equal(couldHoldBounty(getView(blocked, 1), 0), false);

  let before = 0;
  let after = 0;
  for (const holes of [['8h', '6d'], ['Kh', '9d'], ['9h', '8h'], ['Qh', '4d'], ['6h', '5d'], ['Th', '2d'], ['Kc', 'Jd']]) {
    const base = flop([], holes);
    const bonus = paired(bot, base, flop([card('4c')], holes), 300);
    bonus.x.forEach((t, i) => { if (t === 'call') assert.equal(bonus.y[i], 'call', `${holes} seed ${i}`); });
    before += bonus.count(bonus.x, 'call');
    after += bonus.count(bonus.y, 'call');
    assert.deepEqual(paired(bot, base, flop([card('3c')], holes), 300).y, bonus.x, 'no bonus when nobody can hold it');
    assert.deepEqual(paired(bot, base, flop([card('4c', 2, 'showdownOnly')], holes), 300).y, bonus.x,
      'no bonus with showdownOnly: folding denies the bounty');
  }
  assert.ok(after > before, `${before} → ${after} calls`);
  assert.ok(after - before < 0.03 * 7 * 300, 'the bonus is small');
});

test('heldBountyValue counts every other seat, capped at stacks', () => {
  const bot = midProfile('fish');
  const s = fixedHand({ profiles: [null, bot, bot], buttonSeat: 0, heroSeat: 0, bounties: [hand('72o', 5), card('7h', 1)],
    holes: { 1: ['7h', '2d'] } });
  const view = getView(s, 1);
  assert.deepEqual(heldBounties(view).map((b) => b.type), ['hand', 'card']);
  assert.equal(heldBountyValue(view), 2 * 500 + 2 * 100);
  view.players[2].stack = 300;
  assert.equal(heldBountyValue(view), 500 + 300 + 100 + 100);
});

test('bot-only sim: fish play and win their bounty hands more than tough regs', () => {
  const stats = simulateBotHands({
    hands: 3000, seed: 5,
    bounty: { hand: { enabled: true, chance: 1, amountBb: 2 }, card: { enabled: true, chance: 1, amountBb: 2 } },
  });
  for (const tier of TIERS) {
    const b = stats[tier].bounty;
    assert.ok(b.held > 100, `${tier} held ${b.held}`);
  }
  assert.ok(stats.fish.bounty.playedWhenHeld > stats.toughReg.bounty.playedWhenHeld + 0.2);
  assert.ok(stats.fish.bounty.wonWhenHeld > stats.toughReg.bounty.wonWhenHeld);
  const net = TIERS.reduce((a, t) => a + stats[t].bounty.bbPer100 * stats[t].seatHands, 0);
  assert.ok(Math.abs(net) < 1e-6, 'bounties are zero-sum across tiers');
});
