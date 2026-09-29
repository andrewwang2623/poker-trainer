// Blind play (SPEC §7, §14): regs defend the BB and SB by price and opener position, the heads-up button
// opens wide, and folded-to blinds facing only a straddle mostly complete or raise. Spot simulations
// (tests/bots/_blinds.js) deal thousands of random hands into each spot; blind-report.js prints the
// same spots from full bot-only games.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spotRates } from './_blinds.js';
import { chartPosition } from '../../src/bots/strategy/situation.js';
import { createHand, getView } from '../../src/engine/index.js';

const REGS = ['lowReg', 'midReg', 'toughReg'];
const TIERS = ['fish', ...REGS];
const SAMPLES = 1500;
const OPENERS = {
  early: [[9, 'UTG'], [9, 'UTG2']],
  middle: [[9, 'LJ'], [9, 'HJ']],
  late: [[9, 'CO'], [9, 'BTN']],
  SB: [[6, 'SB']],
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x) => `${Math.round(x * 100)}%`;

/** BB fold rate per tier and opener group, averaged over the group's positions. */
function bbFolds() {
  const out = {};
  for (const tier of TIERS) {
    out[tier] = {};
    for (const [group, spots] of Object.entries(OPENERS)) {
      out[tier][group] = mean(spots.map(([numPlayers, opener], i) =>
        spotRates({ tier, numPlayers, opener, defender: 'BB', samples: SAMPLES, seed: 10 + i }).fold));
    }
  }
  return out;
}

test('BB vs one open: regs fold by opener position, tough regs closest to MDF, fish unchanged', () => {
  const folds = bbFolds();
  const bands = { early: [0.48, 0.64], middle: [0.42, 0.58], late: [0.30, 0.48], SB: [0.22, 0.40] };
  for (const tier of REGS) {
    const f = folds[tier];
    for (const [group, [lo, hi]] of Object.entries(bands)) {
      assert.ok(f[group] >= lo && f[group] <= hi, `${tier} BB fold vs ${group} ${pct(f[group])} not in ${pct(lo)}–${pct(hi)}`);
    }
    assert.ok(f.early > f.middle && f.middle > f.late && f.late > f.SB, `${tier} ${JSON.stringify(f)}`);
  }
  for (const group of Object.keys(bands)) {
    const [low, mid, tough] = REGS.map((t) => folds[t][group]);
    assert.ok(tough < low, `${group}: toughReg ${pct(tough)} folds less than lowReg ${pct(low)}`);
    assert.ok(tough <= mid + 0.02 && mid <= low + 0.02, `${group}: ${pct(low)} / ${pct(mid)} / ${pct(tough)}`);
    assert.ok(folds.fish[group] < 0.4, `fish BB fold vs ${group} ${pct(folds.fish[group])}`);
  }
});

test('BB defense is price-aware: a bigger open gets more folds', () => {
  for (const tier of REGS) {
    const std = spotRates({ tier, numPlayers: 6, opener: 'BTN', defender: 'BB', samples: SAMPLES, seed: 3 }).fold;
    const big = spotRates({ tier, numPlayers: 6, opener: 'BTN', defender: 'BB', openBlinds: 4, samples: SAMPLES, seed: 3 }).fold;
    const min = spotRates({ tier, numPlayers: 6, opener: 'BTN', defender: 'BB', openBlinds: 2, samples: SAMPLES, seed: 3 }).fold;
    assert.ok(big > std + 0.08 && min < std - 0.03, `${tier} fold vs 2/2.5/4bb: ${pct(min)} / ${pct(std)} / ${pct(big)}`);
  }
});

test('SB vs one open: regs defend tighter than the BB and wider against late openers', () => {
  for (const tier of REGS) {
    const early = spotRates({ tier, numPlayers: 9, opener: 'UTG', defender: 'SB', samples: SAMPLES, seed: 4 }).fold;
    const late = spotRates({ tier, numPlayers: 6, opener: 'BTN', defender: 'SB', samples: SAMPLES, seed: 4 }).fold;
    assert.ok(early >= 0.8 && early <= 0.95, `${tier} SB fold vs UTG ${pct(early)}`);
    assert.ok(late >= 0.6 && late <= 0.82 && late < early - 0.08, `${tier} SB fold vs BTN ${pct(late)}`);
  }
});

test('heads-up: the button opens 75–92% and the BB folds 22–38% to its open', () => {
  for (const tier of REGS) {
    const sb = spotRates({ tier, numPlayers: 2, opener: null, defender: 'SB', samples: SAMPLES, seed: 6 });
    const bb = spotRates({ tier, numPlayers: 2, opener: 'SB', defender: 'BB', samples: SAMPLES, seed: 6 });
    assert.ok(sb.raise >= 0.75 && sb.raise <= 0.92, `${tier} HU SB opens ${pct(sb.raise)}`);
    assert.ok(bb.fold >= 0.22 && bb.fold <= 0.38, `${tier} HU BB folds ${pct(bb.fold)}`);
  }
});

test('blinds facing only an unraised straddle mostly complete or raise', () => {
  for (const tier of TIERS) {
    const bb = spotRates({ tier, numPlayers: 6, opener: null, defender: 'BB', straddle: true, samples: SAMPLES, seed: 8 });
    const sb = spotRates({ tier, numPlayers: 6, opener: null, defender: 'SB', straddle: true, samples: SAMPLES, seed: 8 });
    assert.ok(bb.fold <= 0.4, `${tier} BB folds ${pct(bb.fold)} to an unraised straddle`);
    assert.ok(sb.fold <= 0.48, `${tier} SB folds ${pct(sb.fold)} to an unraised straddle`);
    if (REGS.includes(tier)) {
      assert.ok(bb.call >= 0.2 && bb.raise >= 0.15, `${tier} BB completes ${pct(bb.call)}, raises ${pct(bb.raise)}`);
    }
  }
});

test('the straddler defends its option against one open like a big blind', () => {
  for (const tier of REGS) {
    const r = spotRates({ tier, numPlayers: 6, opener: 'BTN', defender: 'LJ', straddle: true, samples: SAMPLES, seed: 9 });
    assert.ok(r.fold >= 0.25 && r.fold <= 0.5, `${tier} straddler folds ${pct(r.fold)} to a BTN open`);
  }
});

test('with a straddle, chart roles shift: straddler → BB, BB → SB, SB stays SB', () => {
  // 6-handed, button 0: SB 1, BB 2, first seat after the BB 3.
  const table = (straddleSeat) => getView(createHand({
    seed: 1, createdAt: 1, stakes: 'mid', numPlayers: 6, buttonSeat: 0, heroSeat: 0, straddleSeat, bounties: [],
    seats: Array.from({ length: 6 }, (_, seat) => ({ seat, isHero: seat === 0, stack: 10000, tier: null, profile: null })),
  }), 0);
  const straddled = table(3);
  assert.deepEqual([1, 2, 3, 4].map((seat) => chartPosition(straddled, seat)), ['SB', 'SB', 'BB', 'HJ']);
  const plain = table(null);
  assert.deepEqual([1, 2, 3].map((seat) => chartPosition(plain, seat)), ['SB', 'BB', 'LJ']);
});
