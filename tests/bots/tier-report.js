// Bot-only tier calibration report (not part of `node --test`; tiers.test.js runs the check).
// Plays bot-only hands and prints each tier's observed VPIP / PFR / 3-bet / AF / fold-to-bet / WTSD
// next to the mean of its sampled profile targets.
//
//   node tests/bots/tier-report.js [hands=1000] [seed=1] [stakes]
//   (no stakes: an even mix of all four tiers; with stakes: that stakes' default pool)
import { simulateBotHands } from './_sim.js';
import { TIER_LABELS } from '../../src/shared/schemas.js';

const hands = Number(process.argv[2] ?? 1000);
const seed = Number(process.argv[3] ?? 1);
const stakes = process.argv[4];

const started = Date.now();
const stats = simulateBotHands({ hands, seed, stakes });
const secs = ((Date.now() - started) / 1000).toFixed(1);

const pct = (x) => (x === null ? '  —' : String(Math.round(x * 100)).padStart(3));
const ratio = (x) => (x === null ? '  —' : x.toFixed(1).padStart(4));
console.log(`${hands} bot-only hands, seed ${seed}, pool ${stakes ?? 'even mix'} (${secs}s)\n`);
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
