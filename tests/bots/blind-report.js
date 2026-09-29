// Blind-play report (not part of `node --test`; blinds.test.js runs the checks). Folded-to blind spots by
// tier: BB and SB vs one open by opener position, SB first in, heads-up, blinds vs an unraised straddle,
// and the opener facing a 3-bet.
// The first table comes from spot simulations (2000 random hands per cell, standard open sizes); the rest
// are tallied from full bot-only games (even tier mix, mid stakes).
//
//   node tests/bots/blind-report.js [hands=20000] [seed=1]
import { blindTallies, rates, spotRates } from './_blinds.js';
import { TIERS, TIER_LABELS } from '../../src/shared/schemas.js';

const hands = Number(process.argv[2] ?? 20000);
const seed = Number(process.argv[3] ?? 1);
const started = Date.now();
const SPOTS = [
  ['BB v UTG', 9, 'UTG', 'BB'], ['BB v LJ', 9, 'LJ', 'BB'], ['BB v HJ', 9, 'HJ', 'BB'], ['BB v CO', 9, 'CO', 'BB'],
  ['BB v BTN', 9, 'BTN', 'BB'], ['BB v SB', 6, 'SB', 'BB'], ['SB v UTG', 9, 'UTG', 'SB'], ['SB v BTN', 6, 'BTN', 'SB'],
  ['HU BB v SB', 2, 'SB', 'BB'], ['HU SB open', 2, null, 'SB'],
  ['BB v strad', 6, null, 'BB', true], ['SB v strad', 6, null, 'SB', true],
  // The opener facing a 3-bet: [label, size, opener, null, false, 3-bettor]
  ['UTG v BTN 3b', 9, 'UTG', null, false, 'BTN'], ['CO v BTN 3b', 6, 'CO', null, false, 'BTN'],
  ['SB v BB 3b', 6, 'SB', null, false, 'BB'], ['UTG v BB 3b', 9, 'UTG', null, false, 'BB'],
  ['BTN v BB 3b', 6, 'BTN', null, false, 'BB'], ['HU SB v BB 3b', 2, 'SB', null, false, 'BB'],
];
const spotTable = SPOTS.map(([label, numPlayers, opener, defender, straddle, threeBettor]) => [label, TIERS.map((tier) =>
  spotRates({ tier, numPlayers, opener, defender, straddle, threeBettor, samples: 2000, seed }))]);
const normal = blindTallies({ hands, seed });
const hu = blindTallies({ hands: Math.round(hands / 4), seed, players: 2 });
const straddled = blindTallies({ hands, seed, straddle: { enabled: true, heroChance: 1 } });
const secs = ((Date.now() - started) / 1000).toFixed(1);

const pct = (x) => String(Math.round(x * 100)).padStart(3);
function table(title, byGroup, groups) {
  console.log(`\n${title}   fold / call / raise %  (n)`);
  console.log('tier            ' + groups.map((g) => g.padEnd(22)).join(''));
  for (const tier of TIERS) {
    const cells = groups.map((g) => {
      const r = rates(byGroup?.[g]?.[tier]);
      return (r ? `${pct(r.fold)}/${pct(r.call)}/${pct(r.raise)} (${r.n})` : '—').padEnd(22);
    });
    console.log(TIER_LABELS[tier].padEnd(16) + cells.join(''));
  }
}

console.log(`${hands} bot-only hands (+${Math.round(hands / 4)} heads-up, +${hands} straddled), seed ${seed}, even mix (${secs}s)`);
console.log('\nSpot simulation   fold %  (HU SB open: play % = raise or complete; straddle and 3-bet rows: fold / call / raise %)');
console.log('spot          ' + TIERS.map((t) => TIER_LABELS[t].padEnd(18)).join(''));
for (const [label, cells] of spotTable) {
  const show = (r) => label === 'HU SB open' ? pct(1 - r.fold)
    : label.includes('strad') || label.endsWith('3b') ? `${pct(r.fold)}/${pct(r.call)}/${pct(r.raise)}` : pct(r.fold);
  console.log(label.padEnd(14) + cells.map((r) => show(r).padEnd(18)).join(''));
}
const openers = ['early', 'middle', 'late', 'SB'];
table('BB vs one open, folded to', normal.bbVsOpen, openers);
table('SB vs one open, folded to', normal.sbVsOpen, openers.slice(0, 3));
table('SB first in (3+ handed)', normal.sbFirstIn, ['all']);
table('Heads-up: SB first in | BB vs SB open', { all: hu.huSbFirstIn?.all, 'BB vs open': hu.huBbVsOpen?.SB },
  ['all', 'BB vs open']);
table('Folded to the blinds vs an unraised straddle', { BB: straddled.bbVsStraddle?.all, SB: straddled.sbVsStraddle?.all },
  ['BB', 'SB']);
table('Opener facing a 3-bet (opener in / out of position, heads-up)', normal.openVs3Bet
  && { ...normal.openVs3Bet, hu: hu.openVs3Bet?.hu }, ['oop', 'ip', 'hu']);
