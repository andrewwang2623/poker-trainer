import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAction, createBotProfile } from '../../src/bots/placeholder.js';
import { TIER_RANGES } from '../../src/bots/profiles.js';
import {
  createRng, deriveSeed, createScenario, createHand, getLegalActions, applyAction, getView, isComplete,
  buildHandRecord,
} from '../../src/engine/index.js';
import { TIERS, TIER_LABELS } from '../../src/shared/schemas.js';

test('createBotProfile samples inside the tier ranges', () => {
  const rng = createRng(5);
  for (const tier of TIERS) {
    for (let i = 0; i < 200; i++) {
      const p = createBotProfile(tier, rng);
      assert.equal(p.tier, tier);
      assert.match(p.id, /^bot-[0-9a-f]{8}$/);
      assert.ok(p.name.length > 0);
      assert.match(p.avatar.color, /^#[0-9a-f]{6}$/);
      assert.equal(p.avatar.initials.length, 2);
      for (const f of ['vpip', 'pfr', 'threeBet', 'aggression', 'bluffFreq', 'foldToBet', 'skill']) {
        const [lo, hi] = TIER_RANGES[tier][f];
        assert.ok(p[f] >= lo && p[f] <= hi, `${tier}.${f} = ${p[f]}`);
      }
      assert.ok(p.pfr <= p.vpip && p.threeBet <= p.pfr);
      assert.equal(p.usesCharts, tier === 'toughReg');
      assert.equal(p.exploitsHero, tier === 'toughReg');
      assert.equal(p.mixing, tier === 'midReg' || tier === 'toughReg');
      assert.equal(p.textureSizing, tier === 'midReg' || tier === 'toughReg');
    }
  }
  assert.deepEqual(createBotProfile('fish', createRng(1)), createBotProfile('fish', createRng(1)));
  assert.throws(() => createBotProfile('pro', createRng(1)), RangeError);
  assert.equal(TIER_LABELS.toughReg, 'Tough reg');
});

test('placeholder checks when it can, otherwise calls', () => {
  const view = (types) => ({ legal: { seat: 0, types, toCall: 0, minTo: 0, maxTo: 0 } });
  assert.deepEqual(decideAction(view(['check', 'bet'])), { type: 'check' });
  assert.deepEqual(decideAction(view(['fold', 'call', 'raise'])), { type: 'call' });
  assert.deepEqual(decideAction(view(['fold', 'call'])), { type: 'call' });
  assert.throws(() => decideAction({ legal: null }), RangeError);
});

test('main-style loop: placeholder bots vs a scripted hero play complete, legal hands', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = createRng(seed);
    const scenario = createScenario({ stakes: 'micro', seed, createdAt: 1790000000000 + seed }, rng);
    const botRng = createRng(deriveSeed(seed, 'bots'));
    for (const seat of scenario.seats) {
      if (!seat.isHero) seat.profile = createBotProfile(seat.tier, botRng);
    }
    let s = createHand(scenario);
    for (const p of s.players) if (!p.isHero) assert.equal(p.name, p.profile.name);
    while (!isComplete(s)) {
      const seat = s.actingSeat;
      let action;
      if (seat === s.heroSeat) {
        const legal = getLegalActions(s);
        action = legal.types.includes('raise') && rng() < 0.2
          ? { type: 'raise', amount: legal.maxTo }
          : { type: legal.types.includes('check') ? 'check' : 'call' };
      } else {
        const view = getView(s, seat);
        action = decideAction(view, s.players[seat].profile, { rng: botRng, heroStats: null });
        assert.ok(view.legal.types.includes(action.type));
      }
      s = applyAction(s, action);
    }
    assert.equal(s.result.netChips.reduce((a, b) => a + b, 0) + s.result.rakeChips, 0);
    const rec = buildHandRecord(s, { sessionId: 'test', timestamp: seed });
    assert.equal(rec.heroSeat, s.heroSeat);
  }
});
