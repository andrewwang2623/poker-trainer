// Bot-only tier calibration report (not part of `node --test`; tiers.test.js runs the check).
// Plays bot-only hands and prints each tier's observed VPIP / PFR / 3-bet / AF / fold-to-bet / WTSD
// next to the mean of its sampled profile targets. With --bounty, both bounty types are live at
// that chance and a second table shows bounty play and win rates by tier.
//
//   node tests/bots/tier-report.js [hands=1000] [seed=1] [stakes] [--bounty=chance] [--bounty-amount=bb]
//     [--pays-on=showdownOrFold|showdownOnly]
//   (no stakes: an even mix of all four tiers; with stakes: that stakes' default pool)
import { simulateBotHands } from './_sim.js';
import { TIER_LABELS } from '../../src/shared/schemas.js';

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--'))
  .map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? 'true']; }));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const hands = Number(args[0] ?? 1000);
const seed = Number(args[1] ?? 1);
const stakes = args[2];
let bounty;
if (flags.bounty !== undefined) {
  const chance = flags.bounty === 'true' ? 0.5 : Number(flags.bounty);
  const amountBb = Number(flags['bounty-amount'] ?? 2);
  bounty = {
    hand: { enabled: true, chance, amountBb }, card: { enabled: true, chance, amountBb },
    paysOn: flags['pays-on'] ?? 'showdownOrFold',
  };
}

const started = Date.now();
const stats = simulateBotHands({ hands, seed, stakes, bounty });
const secs = ((Date.now() - started) / 1000).toFixed(1);

const pct = (x) => (x === null ? '  —' : String(Math.round(x * 100)).padStart(3));
const ratio = (x) => (x === null ? '  —' : x.toFixed(1).padStart(4));
const bountyNote = bounty ? `, bounties ${Math.round(bounty.hand.chance * 100)}% each at ${bounty.hand.amountBb}bb (${bounty.paysOn})` : '';
console.log(`${hands} bot-only hands, seed ${seed}, pool ${stakes ?? 'even mix'}${bountyNote} (${secs}s)\n`);
console.log('tier             seat-hands   VPIP (tgt)   PFR (tgt)   3B (tgt)   AF (tgt)   FtB (tgt)  WTSD');
for (const [tier, s] of Object.entries(stats)) {
  const t = s.target;
  console.log([
    TIER_LABELS[tier].padEnd(16),
    String(s.seatHands).padStart(10),
    `  ${pct(s.vpip)} (${pct(t.vpip)})`,
    `  ${pct(s.pfr)} (${pct(t.pfr)})`,
    ` ${pct(s.threeBet)} (${pct(t.threeBet)})`,
    ` ${ratio(s.af)} (${ratio(t.aggression)})`,
    `  ${pct(s.foldToBet)} (${pct(t.foldToBet)})`,
    `  ${pct(s.wtsd)}`,
  ].join(''));
}

if (bounty) {
  console.log('\nBounties   held = dealt a live bounty; played = VPIP when held; won = collected one');
  console.log('tier             held   played%   won   won%/held   bounty bb/100');
  for (const [tier, s] of Object.entries(stats)) {
    const b = s.bounty;
    console.log([
      TIER_LABELS[tier].padEnd(16),
      String(b.held).padStart(5),
      `     ${pct(b.playedWhenHeld)}`,
      String(b.won).padStart(8),
      `        ${pct(b.wonWhenHeld)}`,
      `   ${(b.bbPer100 >= 0 ? '+' : '') + b.bbPer100.toFixed(1)}`.padStart(16),
    ].join(''));
  }
}
