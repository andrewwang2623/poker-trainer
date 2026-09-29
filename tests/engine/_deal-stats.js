// Shared hole-card classification for the deal-distribution test and audit (not a test file).

/** Theoretical per-hand frequencies out of C(52,2) = 1326 combos. */
export const EXPECTED = {
  premium: 34 / 1326, // QQ, KK, AA (6 each) + AKs (4) + AKo (12)
  pair: 78 / 1326, // 13 ranks × 6 combos
};

/** @param {string[]} cards two hole cards @returns {{premium: 0|1, pair: 0|1}} */
export function classify([a, b]) {
  const pair = a[0] === b[0];
  const ranks = a[0] + b[0];
  const premium = pair ? 'QKA'.includes(a[0]) : ranks === 'AK' || ranks === 'KA';
  return { premium: premium ? 1 : 0, pair: pair ? 1 : 0 };
}
