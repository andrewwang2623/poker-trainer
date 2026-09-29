// Large deal-distribution audit (not part of `node --test`; see deal-stream.test.js for the fast check).
// Plays the main.js path: seed → createScenario({seed}, createRng(seed)) → createHand, and compares
// premium (QQ+, AK) and pocket-pair frequencies by table size against theory.
//
//   node tests/engine/deal-audit.js [deals=1000000] [auditSeed=1]
import { createScenario } from '../../src/engine/scenario.js';
import { createHand } from '../../src/engine/game.js';
import { createRng } from '../../src/engine/rng.js';
import { MIN_PLAYERS, MAX_PLAYERS } from '../../src/shared/schemas.js';
import { EXPECTED, classify } from './_deal-stats.js';

const deals = Number(process.argv[2] ?? 1_000_000);
const auditSeed = Number(process.argv[3] ?? 1);
const sessionRng = createRng(auditSeed);

const bySize = {};
for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
  bySize[n] = { deals: 0, hands: 0, premium: 0, pair: 0, heroHands: 0, heroPremium: 0, heroPair: 0 };
}
const total = { hands: 0, premium: 0, pair: 0 };

const started = Date.now();
for (let i = 0; i < deals; i++) {
  const seed = Math.floor(sessionRng() * 4294967296);
  const scenario = createScenario({ stakes: 'micro', seed, createdAt: 0 }, createRng(seed));
  const s = createHand(scenario);
  const row = bySize[s.numPlayers];
  row.deals++;
  for (const p of s.players) {
    const { premium, pair } = classify(p.holeCards);
    row.hands++; row.premium += premium; row.pair += pair;
    total.hands++; total.premium += premium; total.pair += pair;
    if (p.isHero) { row.heroHands++; row.heroPremium += premium; row.heroPair += pair; }
  }
}

// Per-hand counts within one deal are slightly negatively correlated (shared deck), so the binomial
// sigma below is a slight overestimate: the z-scores are conservative.
const pct = (k, n) => (100 * k / n).toFixed(3).padStart(7) + '%';
const z = (k, n, p) => ((k / n - p) / Math.sqrt(p * (1 - p) / n)).toFixed(2).padStart(6);

console.log(`${deals} deals, audit seed ${auditSeed}, ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`expected: premium ${pct(EXPECTED.premium, 1)}  pocket pair ${pct(EXPECTED.pair, 1)}`);
console.log('size    deals     hands   premium      z    pair       z |  hero premium   z    hero pair    z');
for (const [n, r] of Object.entries(bySize)) {
  console.log([
    `${n}-max`.padEnd(5), String(r.deals).padStart(8), String(r.hands).padStart(9),
    pct(r.premium, r.hands), z(r.premium, r.hands, EXPECTED.premium),
    pct(r.pair, r.hands), z(r.pair, r.hands, EXPECTED.pair), '|',
    pct(r.heroPremium, r.heroHands), z(r.heroPremium, r.heroHands, EXPECTED.premium),
    pct(r.heroPair, r.heroHands), z(r.heroPair, r.heroHands, EXPECTED.pair),
  ].join(' '));
}
console.log(`all   ${String(deals).padStart(8)} ${String(total.hands).padStart(9)} ` +
  `${pct(total.premium, total.hands)} ${z(total.premium, total.hands, EXPECTED.premium)} ` +
  `${pct(total.pair, total.hands)} ${z(total.pair, total.hands, EXPECTED.pair)}`);
