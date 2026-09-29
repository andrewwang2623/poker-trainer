// Seeded PRNG (mulberry32). Every random choice in the app goes through one of these.

/**
 * Coerce any number or string into an unsigned 32-bit seed.
 * @param {number|string} seed
 * @returns {number}
 */
export function normalizeSeed(seed) {
  if (typeof seed === 'string') return hashString(seed);
  const n = Number(seed);
  if (!Number.isFinite(n)) throw new TypeError(`Invalid seed: ${seed}`);
  const i = Math.floor(n);
  return Number(((BigInt(i) % 4294967296n) + 4294967296n) % 4294967296n);
}

/**
 * @param {number|string} seed
 * @returns {import('../shared/schemas.js').Rng}
 */
export function createRng(seed) {
  let a = normalizeSeed(seed) | 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive an independent seed from a base seed and a label, so bots, the coach and
 * the engine's all-in EV each get their own reproducible stream.
 * @param {number|string} seed
 * @param {string} salt
 * @returns {number}
 */
export function deriveSeed(seed, salt) {
  let h = normalizeSeed(seed) ^ hashString(String(salt));
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Uniform integer in [lo, hi] inclusive. */
export function randInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** FNV-1a 32-bit. */
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
