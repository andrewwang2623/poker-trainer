// Shared contract for all modules. Human-owned: agents must not edit (see RULES.md).
// Field-level meaning is documented in SPEC.md §5; this file mirrors it as JSDoc
// typedefs plus the frozen constants every module shares.

export const SCHEMA_VERSION = 1;

/** Integer chip units per big blind. All engine amounts are integer chips. */
export const CHIPS_PER_BB = 100;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 9;
export const MIN_STACK_BB = 20;
export const MAX_STACK_BB = 200;

export const RANKS = Object.freeze(['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']);
export const SUITS = Object.freeze(['c', 'd', 'h', 's']);

export const STREETS = Object.freeze(['preflop', 'flop', 'turn', 'river']);
export const ACTION_TYPES = Object.freeze(['fold', 'check', 'call', 'bet', 'raise']);
export const TIERS = Object.freeze(['fish', 'lowReg', 'midReg', 'toughReg']);
/** Straddle (SPEC §14): live UTG straddle size, and each bot tier's chance of straddling when UTG. */
export const STRADDLE_BB = 2;
export const STRADDLE_RATES = Object.freeze({ fish: 0.25, lowReg: 0.10, midReg: 0.05, toughReg: 0.03 });

/** Bounties (SPEC §15). */
export const BOUNTY_TYPES = Object.freeze(['hand', 'card']);
export const BOUNTY_HAND_POOL = 84;          // weakest N of the 169 hand classes
export const BOUNTY_CARD_RANKS = Object.freeze(['2', '3', '4', '5', '6', '7']);
export const BOUNTY_DEFAULTS = Object.freeze({
  hand: Object.freeze({ enabled: false, chance: 0.05, amountBb: 2 }),
  card: Object.freeze({ enabled: false, chance: 0.05, amountBb: 2 }),
  paysOn: 'showdownOrFold',
});

export const TIER_LABELS = Object.freeze({
  fish: 'Fish', lowReg: 'Low-stakes reg', midReg: 'Mid-stakes reg', toughReg: 'Tough reg',
});
export const DEPTH_BANDS = Object.freeze(['short', 'mid', 'deep']); // ≤40bb, 40–100bb, >100bb effective
export const CHART_ACTIONS = Object.freeze(['open', 'call', 'threeBet']);
export const TEXTURES = Object.freeze(['dry', 'semiwet', 'wet', 'paired', 'monotone']);
export const STATS_WINDOWS = Object.freeze([100, 500, 1000, 'session', 'all']);

/** Position labels by table size, in preflop action order. Heads-up: SB is the button. */
export const POSITIONS_BY_SIZE = Object.freeze({
  2: ['SB', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['CO', 'BTN', 'SB', 'BB'],
  5: ['HJ', 'CO', 'BTN', 'SB', 'BB'],
  6: ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  7: ['UTG', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  8: ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  9: ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
});

/**
 * Stakes table. Currency amounts are display-only; the engine works in chips.
 * `pool` is the default opponent tier mix (weights sum to 1).
 * `referenceWinrate` is the pre-rake bb/100 of a leak-free player (profitability model).
 * `winningRanges` are [lo, hi] stat ranges typical of winning players (fractions, AF is a ratio).
 */
export const STAKES = Object.freeze({
  micro: {
    id: 'micro', label: 'Micro (NL5)', sb: 0.02, bb: 0.05, sbChips: 40,
    rakePct: 0.05, rakeCapBb: 4, noFlopNoDrop: true,
    pool: { fish: 0.60, lowReg: 0.30, midReg: 0.08, toughReg: 0.02 },
    referenceWinrate: 10,
    winningRanges: {
      vpip: [0.18, 0.28], pfr: [0.14, 0.22], threeBet: [0.05, 0.09], cbet: [0.50, 0.75],
      foldToCbet: [0.35, 0.55], wtsd: [0.24, 0.32], wsd: [0.50, 0.60], af: [2.0, 4.0],
    },
  },
  low: {
    id: 'low', label: 'Low (NL25)', sb: 0.10, bb: 0.25, sbChips: 40,
    rakePct: 0.05, rakeCapBb: 3, noFlopNoDrop: true,
    pool: { fish: 0.35, lowReg: 0.45, midReg: 0.15, toughReg: 0.05 },
    referenceWinrate: 7,
    winningRanges: {
      vpip: [0.19, 0.27], pfr: [0.15, 0.22], threeBet: [0.06, 0.10], cbet: [0.48, 0.72],
      foldToCbet: [0.35, 0.52], wtsd: [0.24, 0.31], wsd: [0.50, 0.58], af: [2.2, 4.0],
    },
  },
  mid: {
    id: 'mid', label: 'Mid (NL100)', sb: 0.50, bb: 1.00, sbChips: 50,
    rakePct: 0.045, rakeCapBb: 3, noFlopNoDrop: true,
    pool: { fish: 0.15, lowReg: 0.30, midReg: 0.40, toughReg: 0.15 },
    referenceWinrate: 5,
    winningRanges: {
      vpip: [0.20, 0.27], pfr: [0.16, 0.23], threeBet: [0.07, 0.11], cbet: [0.45, 0.70],
      foldToCbet: [0.35, 0.50], wtsd: [0.24, 0.30], wsd: [0.49, 0.56], af: [2.3, 4.0],
    },
  },
  high: {
    id: 'high', label: 'High (NL500)', sb: 2.50, bb: 5.00, sbChips: 50,
    rakePct: 0.035, rakeCapBb: 0.6, noFlopNoDrop: true,
    pool: { fish: 0.05, lowReg: 0.15, midReg: 0.35, toughReg: 0.45 },
    referenceWinrate: 4,
    winningRanges: {
      vpip: [0.21, 0.28], pfr: [0.17, 0.24], threeBet: [0.08, 0.12], cbet: [0.42, 0.68],
      foldToCbet: [0.35, 0.50], wtsd: [0.23, 0.30], wsd: [0.48, 0.55], af: [2.4, 4.2],
    },
  },
});

/** Every coach flag ID. Data fields per ID are listed in SPEC.md §8.3. */
export const FLAG_IDS = Object.freeze([
  // Preflop chart
  'PF_OPEN_OUT_OF_RANGE', 'PF_MISSED_OPEN', 'PF_OPEN_LIMP', 'PF_CALL_OUT_OF_RANGE',
  'PF_MISSED_3BET', 'PF_3BET_OUT_OF_RANGE', 'PF_FOLD_IN_RANGE', 'PF_OPEN_SIZE',
  // Equity / EV
  'EQ_BAD_CALL', 'EQ_BAD_FOLD', 'EQ_MISSED_VALUE', 'EQ_BAD_BLUFF',
  // Sizing and lines
  'SZ_TOO_SMALL', 'SZ_TOO_LARGE', 'LN_MISSED_CBET', 'LN_PAYOFF_PASSIVE_RAISE',
  // Session patterns
  'PAT_TOO_LOOSE', 'PAT_TOO_TIGHT', 'PAT_LOW_PFR', 'PAT_LOW_3BET', 'PAT_PASSIVE',
  'PAT_OVERFOLD_CBET', 'PAT_LOW_CBET', 'PAT_HIGH_WTSD', 'PAT_LOW_WSD', 'PAT_TILT',
  'PAT_REPEATED_LEAK',
]);

export const FLAG_SEVERITIES = Object.freeze(['info', 'minor', 'major']);

export const PROFITABILITY_DISCLAIMER =
  'Estimate only. Poker results have high variance; this combines a model with a small sample and can be wrong.';

// ---------------------------------------------------------------------------
// Primitive types
// ---------------------------------------------------------------------------

/** @typedef {string} Card  Rank+suit, e.g. "As", "Td", "2c". */
/** @typedef {string} HandClass  169-class notation: "AA", "AKs", "AKo". */
/** @typedef {'micro'|'low'|'mid'|'high'} StakesId */
/** @typedef {'preflop'|'flop'|'turn'|'river'} Street */
/** @typedef {'UTG'|'UTG1'|'UTG2'|'LJ'|'HJ'|'CO'|'BTN'|'SB'|'BB'} Position */
/** @typedef {'fish'|'lowReg'|'midReg'|'toughReg'} Tier */
/** @typedef {'short'|'mid'|'deep'} DepthBand */
/** @typedef {'open'|'call'|'threeBet'} ChartAction */
/** @typedef {'dry'|'semiwet'|'wet'|'paired'|'monotone'} Texture */
/** @typedef {'fold'|'check'|'call'|'bet'|'raise'} ActionType */
/** @typedef {100|500|1000|'session'|'all'} StatsWindow */
/** @typedef {() => number} Rng  Seeded PRNG returning a float in [0, 1). */

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Action
 * @property {ActionType} type
 * @property {number} [amount]  bet/raise only: total chips this seat has committed on this street after acting ("raise to").
 */

/**
 * @typedef {Object} LegalActions
 * @property {number} seat
 * @property {ActionType[]} types  Legal action types right now: ['check', …] when toCall = 0,
 *   ['fold', 'call', …] otherwise ('fold' is never legal when 'check' is), then 'bet' or 'raise' if legal.
 * @property {number} toCall   Chips needed to call (0 if check is legal).
 * @property {number} minTo    Minimum legal "to" amount for bet/raise (0 if neither legal).
 * @property {number} maxTo    Maximum "to" amount (all-in).
 */

/**
 * @typedef {Object} PlayerState
 * @property {number} seat            0..numPlayers-1, clockwise.
 * @property {string} name
 * @property {boolean} isHero
 * @property {Position} position
 * @property {BotProfile|null} profile  null for hero.
 * @property {number} startStack      Chips at hand start (before blinds).
 * @property {number} stack           Chips behind now.
 * @property {number} committedStreet Chips put in on the current street.
 * @property {number} committedTotal  Chips put in this hand.
 * @property {Card[]} holeCards       Always 2 cards in full state; [] in redacted views.
 * @property {boolean} folded
 * @property {boolean} allIn
 * @property {boolean} hasActed       Acted voluntarily since the last full raise on this street.
 */

/**
 * @typedef {Object} Pot
 * @property {number} amount          After rake (rake comes off the main pot first).
 * @property {number[]} eligibleSeats
 * @property {number[]} winnerSeats   Filled at hand end.
 */

/**
 * @typedef {Object} AllInEv
 * @property {Street} street      Street on which the last money went in.
 * @property {number} heroEquity  0..1, hero's share of pots at that moment.
 * @property {number} evNetChips  Hero's expected net for the hand, after rake.
 */

/**
 * @typedef {Object} HandResult
 * @property {Pot[]} pots              Σ amount = Σ award events; Σ amount + rakeChips = chips contributed.
 * @property {number} rakeChips
 * @property {number[]} netChips        Net per seat (index = seat), after rake.
 * @property {number[]} showdownSeats   Seats that showed cards.
 * @property {number[]} bountyNetChips  Bounty net per seat (index = seat), sums to 0; not in netChips (§15).
 * @property {AllInEv|null} heroAllInEv  Set only when betting closed for the rest of the hand with board
 *   cards to come and hero not folded. Folded players' cards count as unknown.
 */

/**
 * @typedef {Object} GameState
 * @property {number} schemaVersion
 * @property {string} handId          createdAt.toString(36) + '-' + first 8 hex chars of a one-way hash of seed.
 * @property {number} seed            Never shown to UI/bots (the deck is derived from it).
 * @property {StakesId} stakes
 * @property {number} numPlayers
 * @property {number} buttonSeat
 * @property {number} sbSeat
 * @property {number} bbSeat
 * @property {number} heroSeat
 * @property {PlayerState[]} players   Index = seat.
 * @property {Street|'showdown'|'complete'} street
 * @property {Card[]} board
 * @property {Card[]} deck             Remaining cards in deal order. Never shown to UI/bots.
 * @property {number} potCollected     Chips from completed streets.
 * @property {number} currentBet       Highest committedStreet this street.
 * @property {number} lastRaiseSize    Size of the last full bet/raise increment (min-raise basis).
 * @property {number|null} actingSeat  null when no action is pending.
 * @property {number|null} lastAggressorSeat  Last bettor/raiser on the current street.
 * @property {number|null} preflopAggressorSeat
 * @property {number|null} straddleSeat  §14.
 * @property {Bounty[]} bounties      Live bounties, public (§15).
 * @property {HandEvent[]} events
 * @property {HandResult|null} result  Set when street === 'complete'.
 */

/**
 * One entry in GameState.events / HandRecord.events. `seq` is the index in the log.
 * `street` is the street the event happened on; 'rake' and 'award' use 'showdown' if there was a
 * showdown, otherwise the street the hand ended on.
 * type-specific fields:
 *  - 'postBlind': seat, blind ('SB'|'BB'|'straddle'), amount
 *  - 'dealHole':  seat, cards
 *  - 'action':    seat, action (ActionType), amount (chips added), to (committedStreet after),
 *                 allIn, potBefore (pot incl. all current bets), toCall, stackBefore
 *  - 'board':     cards (only the newly dealt cards)
 *  - 'uncalled':  seat, amount
 *  - 'showdown':  seat, cards, handLabel (e.g. "Two Pair, Aces and Sevens")
 *  - 'rake':      amount
 *  - 'award':     seat, amount, potIndex
 *  - 'bounty':    seat (receiver), fromSeat (payer), amount, bountyIndex (into bounties); street as 'award'
 * @typedef {Object} HandEvent
 * @property {number} seq
 * @property {'postBlind'|'dealHole'|'action'|'board'|'uncalled'|'showdown'|'rake'|'award'|'bounty'} type
 * @property {Street|'showdown'} street
 * @property {number} [seat]
 * @property {'SB'|'BB'|'straddle'} [blind]
 * @property {Card[]} [cards]
 * @property {ActionType} [action]
 * @property {number} [amount]
 * @property {number} [to]
 * @property {boolean} [allIn]
 * @property {number} [potBefore]
 * @property {number} [toCall]
 * @property {number} [stackBefore]
 * @property {string} [handLabel]
 * @property {number} [potIndex]
 * @property {number} [fromSeat]
 * @property {number} [bountyIndex]
 */

/**
 * A live bounty (SPEC §15). `target` is a HandClass for 'hand', a Card for 'card'.
 * @typedef {Object} Bounty
 * @property {'hand'|'card'} type
 * @property {HandClass|Card} target
 * @property {number} amountChips     Paid by each non-qualifying seat dealt in, capped at its stack.
 * @property {'showdownOrFold'|'showdownOnly'} paysOn
 */

/**
 * @typedef {Object} SeatConfig
 * @property {number} seat
 * @property {boolean} isHero
 * @property {number} stack            Chips.
 * @property {Tier|null} tier          null for hero.
 * @property {BotProfile|null} profile Filled by main.js via bots.createBotProfile before createHand.
 */

/**
 * @typedef {Object} ScenarioConfig
 * @property {number} seed             Fresh per hand.
 * @property {number} createdAt        ms since epoch, set by main.js (Date.now()); feeds handId.
 * @property {StakesId} stakes
 * @property {number} numPlayers
 * @property {number} buttonSeat
 * @property {number} heroSeat
 * @property {SeatConfig[]} seats
 * @property {number|null} straddleSeat  §14; null when no straddle.
 * @property {Bounty[]} bounties       §15; [] when none.
 */

/**
 * What a bot (or the hero UI) may see: GameState minus `deck` and `seed`, other seats' hole cards
 * hidden, plus the per-seat fields below.
 * @typedef {Object} SeatView
 * @property {number} seat
 * @property {number} schemaVersion
 * @property {string} handId
 * @property {StakesId} stakes
 * @property {number} numPlayers
 * @property {number} buttonSeat
 * @property {number} sbSeat
 * @property {number} bbSeat
 * @property {number} heroSeat
 * @property {Street|'showdown'|'complete'} street
 * @property {Position} position
 * @property {Card[]} holeCards
 * @property {Card[]} board
 * @property {number} pot              Total chips in the middle incl. current-street bets.
 * @property {number} potCollected
 * @property {number} currentBet
 * @property {number} lastRaiseSize
 * @property {number|null} actingSeat
 * @property {number|null} lastAggressorSeat
 * @property {LegalActions|null} legal null when this seat isn't to act.
 * @property {PlayerState[]} players   holeCards [] for every other seat (until showdown events).
 * @property {number|null} preflopAggressorSeat
 * @property {number|null} straddleSeat
 * @property {Bounty[]} bounties
 * @property {HandEvent[]} events      'dealHole' events of other seats removed.
 * @property {HandResult|null} result
 */

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} BotProfile
 * @property {string} id
 * @property {string} name
 * @property {Tier} tier
 * @property {{color: string, initials: string}} avatar
 * @property {number} vpip          0..1 target
 * @property {number} pfr           0..1 target
 * @property {number} threeBet      0..1 target
 * @property {number} aggression    Target postflop AF = (bets+raises)/calls
 * @property {number} bluffFreq     0..1 share of bets/raises made without showdown value
 * @property {number} foldToBet     0..1 baseline fold rate vs a ~2/3-pot bet
 * @property {number} skill         0..1 how closely decisions track equity/charts (noise = 1-skill)
 * @property {boolean} usesCharts   Preflop from RangeChart (midReg, toughReg)
 * @property {boolean} textureSizing
 * @property {boolean} mixing       Randomized frequency mixing
 * @property {boolean} exploitsHero Adjusts to BotContext.heroStats
 */

/**
 * @typedef {Object} BotContext
 * @property {Rng} rng
 * @property {StatsSummary|null} heroStats  Hero's 'session' stats, null if tracker not wired.
 */

/** @typedef {Object<HandClass, number>} HandRange  Frequency 0..1 per hand class; missing = 0. */

/**
 * RangeChart[position][depthBand][action]. `call` and `threeBet` are versus a single open raise.
 * @typedef {Object<Position, Object<DepthBand, {open: HandRange, call: HandRange, threeBet: HandRange}>>} RangeChart
 */

// ---------------------------------------------------------------------------
// Coach
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CoachFlag
 * @property {string} id                    One of FLAG_IDS.
 * @property {'info'|'minor'|'major'} severity
 * @property {Street|null} street           null for PAT_* flags.
 * @property {number|null} decisionIndex    Index into HandRecord.decisions; null for PAT_*.
 * @property {number|null} evLossBb
 * @property {Tier|null} oppTier            Main opponent's tier (drives explanation variant).
 * @property {Object} data                  Per-ID fields, SPEC.md §8.3.
 */

/**
 * @typedef {Object} HeroDecision
 * @property {number} index
 * @property {number} eventSeq
 * @property {Street} street
 * @property {Position} position
 * @property {Card[]} holeCards
 * @property {Card[]} board
 * @property {number} potBeforeBb
 * @property {number} toCallBb
 * @property {number} stackBeforeBb
 * @property {number} effectiveStackBb
 * @property {number} numOpponents          Opponents still in the hand.
 * @property {boolean} inPosition           Hero acts last postflop among remaining players.
 * @property {'unopened'|'limped'|'raised'|'threeBet'|'fourBetPlus'|'checkedTo'|'facingBet'|'facingRaise'} facing
 * @property {number[]} opponentSeats
 * @property {Action} action
 * @property {boolean} allIn
 */

/**
 * @typedef {Object} CoachDecision
 * @property {number} decisionIndex
 * @property {number|null} equity          0..1 vs estimated ranges (Monte Carlo)
 * @property {number} equitySamples
 * @property {number|null} potOdds         toCall / (pot + toCall); null when nothing to call
 * @property {Object<string, number>} evByActionBb  e.g. {fold:0, call:1.2, 'raise:0.75':2.0}
 * @property {string} bestAction           Key of evByActionBb
 * @property {number} evLossBb             ≥ 0
 * @property {{position: Position, band: DepthBand, action: ChartAction, freq: number}|null} chart
 * @property {Texture|null} texture
 */

/**
 * @typedef {Object} CoachResult
 * @property {string} handId
 * @property {number} version
 * @property {CoachDecision[]} decisions
 * @property {CoachFlag[]} flags
 * @property {number} totalEvLossBb
 * @property {'clean'|'minor'|'major'} grade
 */

/**
 * @typedef {Object} Explanation
 * @property {string} title
 * @property {string} body
 * @property {string} tip
 */

// ---------------------------------------------------------------------------
// Records and stats
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} HeroStatFlags  Opportunity/occurrence booleans and postflop counts for one hand.
 * @property {boolean} vpip
 * @property {boolean} pfr
 * @property {boolean} threeBetOpp
 * @property {boolean} threeBet
 * @property {boolean} cbetOpp
 * @property {boolean} cbet
 * @property {boolean} foldToCbetOpp
 * @property {boolean} foldToCbet
 * @property {boolean} sawFlop
 * @property {boolean} wentToShowdown
 * @property {boolean} wonAtShowdown
 * @property {boolean} facedPostflopBet     Faced any postflop bet or raise.
 * @property {boolean} foldedToPostflopBet  Folded to one.
 * @property {boolean} straddled            Hero posted a straddle (§14).
 * @property {boolean} facedStraddle        Another seat straddled.
 * @property {number} postflopBets
 * @property {number} postflopRaises
 * @property {number} postflopCalls
 */

/**
 * @typedef {Object} HandRecordPlayer
 * @property {number} seat
 * @property {string} name
 * @property {Position} position
 * @property {boolean} isHero
 * @property {number} startStackBb
 * @property {Card[]} holeCards
 * @property {BotProfile|null} profile
 */

/**
 * @typedef {Object} HandRecord
 * @property {number} schemaVersion
 * @property {string} id               Same as GameState.handId.
 * @property {number} timestamp        ms since epoch, hand end.
 * @property {string} sessionId
 * @property {number} seed
 * @property {StakesId} stakes
 * @property {number} numPlayers
 * @property {number} heroSeat
 * @property {Position} heroPosition
 * @property {number} buttonSeat
 * @property {HandRecordPlayer[]} players
 * @property {number|null} straddleSeat
 * @property {Bounty[]} bounties
 * @property {Card[]} board
 * @property {HandEvent[]} events      Full, unredacted.
 * @property {HandResult} result
 * @property {number} heroNetBb
 * @property {number} heroEvNetBb      All-in EV adjusted; equals heroNetBb when no all-in. Excludes bounties.
 * @property {number} heroBountyBb     Hero's bounty net (§15); 0 when none.
 * @property {number} rakeBb           Total rake taken from the hand.
 * @property {number} heroRakeBb       Rake attributed to hero (proportional to hero's winnings).
 * @property {HeroStatFlags} statFlags
 * @property {HeroDecision[]} decisions
 * @property {CoachResult|null} coach  null if coach not wired.
 */

/**
 * @typedef {Object} ProfitabilityEstimate
 * @property {'likely_losing'|'break_even'|'likely_winning'} verdict
 * @property {'low'|'medium'|'high'} confidence
 * @property {number} estimateBbPer100
 * @property {number} modelBbPer100
 * @property {number} observedWeight   0..1
 * @property {string[]} reasons
 * @property {string} disclaimer       Always PROFITABILITY_DISCLAIMER.
 */

/**
 * @typedef {Object} StatsSummary
 * @property {StatsWindow} window
 * @property {number} hands
 * @property {StakesId|'mixed'} stakes
 * @property {number|null} vpip
 * @property {number|null} pfr
 * @property {number|null} threeBet
 * @property {number|null} cbet
 * @property {number|null} foldToCbet
 * @property {number|null} foldToBet     Folds to any postflop bet or raise (§9).
 * @property {number|null} wtsd
 * @property {number|null} wsd
 * @property {number|null} af
 * @property {{vpip: number, threeBet: number, cbet: number, foldToCbet: number, foldToBet: number, wtsd: number, wsd: number}} opportunities
 * @property {number} bbPer100         Excludes bounties.
 * @property {number} bountyPer100
 * @property {number} bbPer100WithBounty
 * @property {number} evAdjBbPer100
 * @property {[number, number]} evAdjCi95
 * @property {number} evLossPer100     0 when no hand in the window has coach data.
 * @property {number} coachedHands
 * @property {number} rakePer100
 * @property {{flagId: string, count: number, evLossBb: number}[]} topLeaks  Up to 5, by evLossBb.
 * @property {{bbPer100Delta: number, evLossPer100Delta: number, vpipDelta: number|null}|null} trend
 * @property {ProfitabilityEstimate} profitability
 */
