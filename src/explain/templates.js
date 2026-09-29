// Pure render functions: all values come from CoachFlag.data (SPEC §8.3).
const number = (value, digits = 1) => typeof value === 'number' && Number.isFinite(value)
  ? value.toFixed(digits) : 'unknown';
const pct = value => `${number(typeof value === 'number' ? value * 100 : value, 0)}%`;
const bb = value => `${number(value)}bb`;
const range = (values, format) => Array.isArray(values)
  ? `${format(values[0])}–${format(values[1])}` : 'unknown';
const text = value => value == null ? 'unknown' : String(value);
const spot = d => `${text(d.hand)} from ${text(d.position)} at ${text(d.depthBand)} depth`;
const windowText = value => typeof value === 'number' ? `last ${value} hands`
  : value === 'session' ? 'this session' : value === 'all' ? 'all hands' : 'unknown window';
const action = value => {
  const [verb, size] = String(value ?? '').split(':');
  if (['bet', 'raise'].includes(verb) && size && Number.isFinite(Number(size))) {
    return `${verb} at ${pct(Number(size))} pot`;
  }
  if (value === 'allIn' || value === 'all-in') return 'go all-in';
  return text(value);
};

function hand(title, body, tips) {
  const contexts = {
    default: '',
    fish: ' Against a fish, loose calls and infrequent bluffs favor value-heavy play.',
    reg: ' Against a regular, use position and the betting line to refine the range estimate.',
    tough: ' A Tough reg can mix bluffs with value and exploit predictable responses.',
  };
  return Object.freeze(Object.fromEntries(Object.entries(contexts).map(([group, context]) => [
    group, d => ({ title, body: body(d) + context, tip: tips[group] }),
  ])));
}

function pattern(title, body, tip) {
  return Object.freeze({ default: d => ({ title, body: body(d), tip }) });
}

const statNames = {
  vpip: 'VPIP (voluntary preflop participation)', threeBet: '3-bet rate',
  af: 'aggression factor', foldToCbet: 'fold-to-c-bet rate', cbet: 'c-bet rate',
  wtsd: 'went-to-showdown rate', wsd: 'won-at-showdown rate',
};
const statBody = d => {
  const format = d.stat === 'af' ? value => number(value) : pct;
  return `Your ${statNames[d.stat] ?? text(d.stat)} is ${format(d.value)} versus a reference range of ${range(d.target, format)}, over ${text(d.hands)} hands in ${windowText(d.window)}. These are approximate 6-max reference ranges; table size and opportunities matter.`;
};

export const templates = Object.freeze({
  PF_OPEN_OUT_OF_RANGE: hand('Opening too wide', d => `You opened ${spot(d)}; the chart opens this hand ${pct(d.chartFreq)} of the time.`, {
    default: 'Start with the position and depth chart, then adjust for the players behind you.',
    fish: 'Prefer hands that make strong pairs; loose callers reduce the value of weak steal attempts.',
    reg: 'Widen steals only when the players behind you actually fold enough.',
    tough: 'Keep your opening range defensible against 3-bets; use chart mixing for marginal hands.',
  }),
  PF_MISSED_OPEN: hand('Missed opening raise', d => `You folded ${spot(d)}; the chart opens it ${pct(d.chartFreq)} of the time.`, {
    default: 'Raise first-in with the chart’s frequent opens to capture value and the blinds.',
    fish: 'Open strong hands for value against loose callers instead of waiting only for premiums.',
    reg: 'Use position to take profitable first-in raises and put pressure on the blinds.',
    tough: 'Preserve your opening frequencies so observant opponents cannot overfold to your raises.',
  }),
  PF_OPEN_LIMP: hand('Open limp', d => `You limped ${spot(d)}, outside the chart’s allowed small-blind limp strategy.`, {
    default: 'Choose a chart-supported raise or fold when first into the pot.',
    fish: 'Raise your value hands to build a pot against loose callers.',
    reg: 'Avoid inviting isolation raises with an unprotected limping range.',
    tough: 'Use a coherent opening strategy; a weak limp range invites repeated isolation.',
  }),
  PF_CALL_OUT_OF_RANGE: hand('Preflop call too wide', d => `You called a raise to ${bb(d.raiseToBb)} from ${text(d.vsPosition)} with ${spot(d)}; chart call frequency is ${pct(d.chartFreq)}.`, {
    default: 'Check the call range and price before committing chips, especially out of position.',
    fish: 'A loose player can still have a tight raising range; avoid dominated calls.',
    reg: 'Account for the opener’s position and players who can squeeze behind you.',
    tough: 'Defend with hands that realize equity well and retain a credible 3-bet range.',
  }),
  PF_MISSED_3BET: hand('Missed 3-bet', d => `With ${spot(d)} against ${text(d.vsPosition)}, the chart 3-bets ${pct(d.chartFreq)} of the time; you did not 3-bet.`, {
    default: 'Use the chart’s frequent 3-bets to gain value and initiative.',
    fish: 'Prioritize value 3-bets that loose opponents can call with worse.',
    reg: 'Build a position-aware 3-bet range instead of routinely flat-calling strong hands.',
    tough: 'Maintain value and suitable bluff combinations in your 3-bet range.',
  }),
  PF_3BET_OUT_OF_RANGE: hand('3-betting too wide', d => `You 3-bet ${spot(d)} against ${text(d.vsPosition)}; chart 3-bet frequency is ${pct(d.chartFreq)}.`, {
    default: 'Use chart-supported 3-bets and consider the opener’s range before adding bluffs.',
    fish: 'Cut back on bluff 3-bets against opponents who rarely fold; favor value.',
    reg: 'Choose bluff 3-bets with useful blockers and evidence that the opener folds.',
    tough: 'Use disciplined mixed frequencies and plan how your range handles a 4-bet.',
  }),
  PF_FOLD_IN_RANGE: hand('Folded a chart continue', d => `You folded ${spot(d)} against ${text(d.vsPosition)}; the chart calls ${pct(d.callFreq)} and 3-bets ${pct(d.threeBetFreq)} of the time.`, {
    default: 'Review both calling and 3-betting options before folding a frequent continue.',
    fish: 'Keep profitable value continues, but allow for a passive player’s tighter raising range.',
    reg: 'Defend according to position and price rather than folding every marginal hand.',
    tough: 'Avoid systematic overfolding; distribute continues between calls and 3-bets.',
  }),
  PF_OPEN_SIZE: hand('Review opening size', d => `Your open to ${bb(d.sizeBb)} from ${text(d.position)} with ${text(d.limpers)} limpers is outside the recommended ${range(d.recommendedBb, bb)} range.`, {
    default: 'Use the recommended opening range, including the adjustment for limpers.',
    fish: 'Size value raises to what loose callers will pay without automatically inflating every pot.',
    reg: 'Use consistent opening sizes for your range and adjust for position and limpers.',
    tough: 'Avoid revealing hand strength through opening size; keep sizing consistent across your range.',
  }),
  EQ_BAD_CALL: hand('Call below the equity threshold', d => `Calling ${bb(d.toCallBb)} into ${bb(d.potBb)} requires ${pct(d.requiredEquity)} equity; your estimated equity is ${pct(d.equity)}.`, {
    default: 'Compare your range equity with the price and account for future betting before calling.',
    fish: 'Do not assume a passive opponent is bluffing enough to justify a weak call.',
    reg: 'Count plausible value hands and bluffs for this line before paying off.',
    tough: 'Defend enough against bluffs, but choose bluff-catchers with suitable blockers and sufficient equity.',
  }),
  EQ_BAD_FOLD: hand('Folded with enough estimated equity', d => `Facing ${bb(d.toCallBb)} into ${bb(d.potBb)}, your estimated ${pct(d.equity)} equity exceeds the ${pct(d.requiredEquity)} pot-odds threshold.`, {
    default: 'Recheck the opponent’s range and the price; this model favors continuing over folding.',
    fish: 'Take favorable prices when worse hands remain in range, while respecting rare strong raises.',
    reg: 'Include plausible bluffs and weaker value hands instead of assigning only the top of the range.',
    tough: 'Protect against overfolding by continuing with your strongest suitable bluff-catchers.',
  }),
  EQ_MISSED_VALUE: hand('Missed value opportunity', d => `With ${pct(d.equity)} estimated equity in a ${bb(d.potBb)} pot, the model prefers ${action(d.bestAction)}, for an estimated gain of ${bb(d.evGainBb)} over your action.`, {
    default: 'Identify worse hands that can call before choosing a value bet or raise.',
    fish: 'Value-bet thinner when loose opponents can call with weaker pairs and draws.',
    reg: 'Choose a size that gets called by enough worse hands and consider the response to a raise.',
    tough: 'Balance value bets with appropriate bluffs and preserve some strong checks.',
  }),
  EQ_BAD_BLUFF: hand('Unprofitable bluff estimate', d => `Your ${pct(d.sizePct)}-pot bet or raise has ${pct(d.equity)} estimated equity and ${pct(d.foldEstimate)} estimated fold equity against an opponent with ${pct(d.oppVpip)} VPIP. The model prefers checking or folding.`, {
    default: 'Bluff when enough better hands can fold, preferably with equity or useful blockers.',
    fish: 'Avoid low-equity bluffs into loose callers; focus on getting paid with value hands.',
    reg: 'Match the bluff to the board and opponent’s continuing range instead of relying on VPIP alone.',
    tough: 'Use credible value-to-bluff proportions and blockers; aggression alone will not force folds.',
  }),
  SZ_TOO_SMALL: hand('Bet size too small', d => `You bet ${pct(d.sizePct)} pot on a ${text(d.texture)} board; the texture guideline is ${range(d.recommendedPct, pct)} pot.`, {
    default: 'Consider a larger size when value hands and vulnerable equity benefit from charging draws.',
    fish: 'Charge loose callers more with value hands, especially on draw-heavy boards.',
    reg: 'Match sizing to the board and your value range rather than always using a small bet.',
    tough: 'Support larger sizes with a coherent value and bluff range; retain protected checks.',
  }),
  SZ_TOO_LARGE: hand('Bet size too large', d => `You bet ${pct(d.sizePct)} pot on a ${text(d.texture)} board; the texture guideline is ${range(d.recommendedPct, pct)} pot.`, {
    default: 'Consider whether a smaller bet achieves the same goal while keeping worse hands in.',
    fish: 'Large value bets can work against callers, but avoid expensive bluffs with little fold equity.',
    reg: 'Avoid forcing out all weaker hands when a smaller value bet would earn calls.',
    tough: 'Reserve large sizes for suitable polarized ranges and choose bluffs consistently.',
  }),
  LN_MISSED_CBET: hand('Missed continuation bet', d => `You checked a ${text(d.texture)} flop against ${text(d.numOpponents)} opponents with ${pct(d.equity)} estimated equity; the model prefers a continuation bet.`, {
    default: 'Review whether value or fold equity supports betting; reduce bluffing in multiway pots.',
    fish: 'C-bet for value when worse hands call; do not automatically bluff loose opponents.',
    reg: 'Consider range advantage, board texture and opponent count when selecting c-bets.',
    tough: 'Mix c-bets and protected checks so neither range becomes easy to exploit.',
  }),
  LN_PAYOFF_PASSIVE_RAISE: hand('Paid off a passive raise', d => `You called ${bb(d.toCallBb)} with ${pct(d.equity)} estimated equity against a turn or river raise from an opponent with aggression factor ${number(d.oppAggression)}.`, {
    default: 'A late-street raise from a passive player often signals strength; reassess one-pair hands.',
    fish: 'Respect rare raises from passive callers and avoid paying off simply because they play loose.',
    reg: 'Use the observed passive profile and specific line to narrow the raising range.',
    tough: 'Respect this passive line while checking for credible bluffs; defend with appropriate blockers.',
  }),
  PAT_TOO_LOOSE: pattern('Playing too many starting hands', statBody, 'Remove weak early-position opens and dominated calls; review ranges by position.'),
  PAT_TOO_TIGHT: pattern('Playing too few starting hands', statBody, 'Review missed late-position opens and profitable defenses before widening indiscriminately.'),
  PAT_LOW_PFR: pattern('Too much preflop calling', d => `Your VPIP is ${pct(d.vpip)} and PFR is ${pct(d.pfr)}, a gap of ${number(typeof d.gap === 'number' ? d.gap * 100 : d.gap, 0)} percentage points over ${text(d.hands)} hands in ${windowText(d.window)}.`, 'Review limps and cold calls; replace them with chart-supported raises or folds.'),
  PAT_LOW_3BET: pattern('3-betting too rarely', statBody, 'Start by taking your value 3-bets, then study position-specific bluff candidates.'),
  PAT_PASSIVE: pattern('Too much postflop calling', statBody, 'Review missed value bets and raises; aggression factor is (bets + raises) / calls, not a percentage.'),
  PAT_OVERFOLD_CBET: pattern('Folding too often to c-bets', statBody, 'Review price, board texture and backdoor equity to find suitable additional continues.'),
  PAT_LOW_CBET: pattern('Continuation betting too rarely', statBody, 'Look for missed value and favorable boards to bet; keep multiway bluffs selective.'),
  PAT_HIGH_WTSD: pattern('Going to showdown too often', statBody, 'Review marginal turn and river calls, especially against passive value-heavy lines.'),
  PAT_LOW_WSD: pattern('Winning too few showdowns', statBody, 'Review losing bluff-catchers and missed value; a short run of showdown losses can also be variance.'),
  PAT_TILT: pattern('Possible tilt after a large loss', d => `After a ${bb(d.lossBb)} loss, VPIP rose from ${pct(d.vpipBefore)} to ${pct(d.vpipAfter)} over the next ${text(d.handsAfter)} hands. This change may indicate tilt; it does not establish your mental state.`, 'Pause after a large loss and check your starting-hand choices against the chart before continuing.'),
  PAT_REPEATED_LEAK: pattern('Repeated decision leak', d => `${text(d.flagId)} appeared ${text(d.count)} times in ${windowText(d.window)}, totaling ${bb(d.evLossBb)} in estimated EV loss.`, 'Review these decisions together and practice the recurring spot; model EV losses are estimates.'),
});
