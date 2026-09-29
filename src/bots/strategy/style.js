// Per-tier strategy constants. Profile fields (vpip, pfr, …) set each bot's targets; these set how
// a tier turns targets into decisions. The rule-based multipliers are calibrated with
// tests/bots/tier-report.js so simulated VPIP/PFR land on the profile targets.

export const TIER_STYLE = Object.freeze({
  fish: Object.freeze({
    // Rule-based preflop over the fish variant chart.
    openVpipK: 1.1, openPfrK: 1.5, callK: 1.15, threeBetK: 1.0,
    callVsThreeBet: 0.3, // continue vs a 3-bet with the top vpip × this
    chartWeight: 0.25,   // strength-percentile points a variant-chart frequency of 1 is worth
    looseCall: 0.08,     // calls off stacks this much under the price
    mdf: false,
  }),
  lowReg: Object.freeze({
    openVpipK: 1.0, openPfrK: 1.45, callK: 1.4, threeBetK: 1.0,
    callVsThreeBet: 0.35,
    chartWeight: 0.15,
    looseCall: 0.03,
    mdf: false,
  }),
  midReg: Object.freeze({ looseCall: 0, mdf: true }),
  toughReg: Object.freeze({ looseCall: 0, mdf: true }),
});

/** Opening-range multipliers by position (SPEC §7: BTN ×1.3, UTG ×0.7). */
export const POSITION_WIDTH = Object.freeze({
  UTG: 0.7, UTG1: 0.75, UTG2: 0.8, LJ: 0.85, HJ: 0.95, CO: 1.1, BTN: 1.3, SB: 1.05, BB: 1.0,
});

/** Preflop percentile noise at skill 0 (scaled by 1 − skill). */
export const PREFLOP_NOISE = 0.3;
/** Postflop equity noise at skill 0 (scaled by 1 − skill). */
export const POSTFLOP_NOISE = 0.4;
