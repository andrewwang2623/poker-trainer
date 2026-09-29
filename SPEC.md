# Poker Trainer — SPEC

A browser No-Limit Hold'em trainer. Every hand is a random scenario against profiled bots. It has an
offline coach, export text for pasting into a Claude chat, and a long-term tracker.

**Hard rules**
- Zero network or API calls anywhere in the app. Everything runs locally.
- Vanilla JS ES modules. No framework, no build step, no runtime dependencies. Served by any static server
  (e.g. `python3 -m http.server`).
- Pure logic (engine, bots, coach, explain, export, tracker) must not touch the DOM, `window` or IndexedDB,
  and must run under Node for `node --test`.
- The shared contract is `src/shared/schemas.js`. This spec and that file must agree. If they conflict,
  that's a bug: file a request (RULES.md).

## 1. Ownership and module layout

| Owner | Paths |
|---|---|
| Claude | `src/engine/`, `src/bots/`, `src/coach/`, `tests/engine/`, `tests/bots/`, `tests/coach/`, `REQUESTS-claude.md` |
| Astra | `src/ui/`, `src/explain/`, `src/export/`, `src/tracker/`, `src/data/`, `src/main.js`, `index.html`, `styles/`, `tests/explain/`, `tests/export/`, `tests/tracker/`, `tests/data/`, `tests/engine-extra/`, `tests/integration/`, `REQUESTS-astra.md` |
| Human only | `SPEC.md`, `src/shared/schemas.js` |

```
index.html                 loads styles/ and src/main.js
src/shared/schemas.js      typedefs + constants (STAKES, POSITIONS_BY_SIZE, FLAG_IDS, …)
src/engine/  index.js      re-exports below
             rng.js        createRng(seed): Rng  (mulberry32)
             cards.js      fullDeck(), shuffle(deck, rng), handClass(cards), parseCard/formatCard
             evaluator.js  evaluate(cards[5..7]) → {score, category, label}
             equity.js     computeEquity(opts) (Monte Carlo / exact enumeration)
             scenario.js   createScenario(opts, rng): ScenarioConfig
             game.js       createHand, getLegalActions, applyAction, getView, isComplete
             record.js     buildHandRecord(state, meta): HandRecord  (coach: null)
             texture.js    boardTexture(board): Texture
src/bots/    index.js      decideAction (real bots), createBotProfile
             placeholder.js decideAction (check/call), createBotProfile (re-export)
             profiles.js   tier parameter ranges, names, avatars, createBotProfile
             strategy/…    internal (preflop, postflop, sizing, exploit)
src/coach/   index.js      analyzeHand, detectPatterns, liveOdds
             ev.js, flags.js, patterns.js, villainRanges.js
src/explain/ index.js      explainFlag(flag): Explanation; templates.js
src/export/  index.js      formatHand, formatHands, formatSummary
src/tracker/ index.js      createTracker(store): Tracker; stats.js, profitability.js
src/data/    index.js      openHandStore(): Promise<HandStore>, createMemoryStore(): HandStore
             ranges.js     RANGE_CHART: RangeChart, getChartRange(position, band, action)  (pure data, no IndexedDB)
src/ui/      index.js      mountApp(rootEl, app); table, controls, review, dashboard, settings
src/main.js                composition root: loads modules, builds `app`, calls mountApp
styles/                    CSS
tests/<area>/*.test.js     node:test only
```

Imports flow one way: `ui → (anything via app object)`, `export/tracker/explain → engine, shared`,
`coach → engine, data/ranges.js, shared`, `bots → engine, data/ranges.js, shared`, `engine → shared`. Nothing imports
`ui` or `main.js`. You may import a module you don't own. You may not edit it.

## 2. Conventions

- **Chips:** all engine amounts are integer chips, and `CHIPS_PER_BB = 100`. SB chips come from
  `STAKES[id].sbChips`. Records, coach and export use bb (chips / 100, one decimal when displayed).
- **Cards:** `"As"`, `"Td"`, `"2c"`. Ranks `23456789TJQKA`, suits `cdhs`. Hand classes: `"AA"`, `"AKs"`, `"AKo"`.
- **Seats** run 0..N−1 clockwise. Positions come from `POSITIONS_BY_SIZE[N]`, listed in preflop action order
  and ending at the BB seat. Heads-up, the SB is the button: it acts first preflop and last postflop.
- **RNG:** every random choice goes through a seeded `Rng`. A hand is fully reproducible from
  `ScenarioConfig` plus hero actions. The deck, bots and the coach each get their own RNG from
  `deriveSeed(seed, label)`; no two operations may share one stream (§13 item 11).
- **Immutability:** `applyAction` returns a new `GameState`. It never mutates its input.
- **Depth band:** effective stack in bb: `short` ≤ 40, `mid` 40–100, `deep` > 100.
- **Texture** (`boardTexture`): `monotone` = 3+ cards of one suit. `paired` = any paired board. `wet` = two-tone
  plus a connected board (3 cards within a 4-rank span). `semiwet` = two-tone or connected. `dry` otherwise.

## 3. Stakes table

The authoritative values are in `STAKES` in schemas.js.

| id | label | blinds | rake | cap | default pool fish/lowReg/midReg/toughReg | ref. winrate |
|---|---|---|---|---|---|---|
| micro | Micro (NL5) | $0.02/$0.05 | 5% | 4bb | 60/30/8/2 | 10 bb/100 |
| low | Low (NL25) | $0.10/$0.25 | 5% | 3bb | 35/45/15/5 | 7 |
| mid | Mid (NL100) | $0.50/$1 | 4.5% | 3bb | 15/30/40/15 | 5 |
| high | High (NL500) | $2.50/$5 | 3.5% | 0.6bb | 5/15/35/45 | 4 |

- Rake is "no flop, no drop": `rakeChips = floor(min(potTotal × rakePct, rakeCapBb × 100))`, taken only if a
  flop was dealt. It comes off the pots before awarding, main pot first. `HandResult.pots[].amount` is after
  rake, so Σ pot amounts = Σ `award` amounts, and Σ pot amounts + `rakeChips` = total chips contributed.
- The settings UI has a stakes selector and a manual pool override: four sliders, normalized to sum to 1.
  The override replaces `pool` for scenario generation only.
- `winningRanges` (per stakes, in schemas.js) are calibrated for 6-max. With random table sizes they're only
  approximate. They're used for pattern flags and the profitability model.

## 4. Scenario generation (`createScenario({stakes, poolOverride?, seed, createdAt, straddle?, bounty?}, rng)`)

- `straddle` and `bounty` are optional and off by default; see §14 and §15. Each draws from its own
  `deriveSeed(seed, label)` stream and stores its result in `ScenarioConfig`, so dealt cards are identical with
  either feature on or off, and a hand replays from `ScenarioConfig` alone.

- `createdAt` (ms since epoch) is copied into `ScenarioConfig.createdAt`. main.js passes `Date.now()`. It feeds
  `handId` (§5). Pure modules never read the clock themselves, so a hand stays reproducible from its ScenarioConfig.
- `numPlayers` is uniform over 2–9. `buttonSeat` and `heroSeat` are uniform over seats, so hero's position is random.
- Every stack is uniform over 20–200bb, rounded to whole bb. Stacks don't carry over between hands.
- Each non-hero seat gets a tier sampled from the pool. `main.js` then fills `seats[i].profile` with
  `bots.createBotProfile(tier, rng)` and calls `engine.createHand(scenario)`.

## 5. Schemas

Exact field lists and types are the JSDoc typedefs in `src/shared/schemas.js`. Here's a summary, with the
semantics the typedefs can't express.

**Action** `{type, amount?}`. `amount` is used for bet/raise only. It's the "to" total this seat has committed on the
current street. An all-in is a bet/raise to `maxTo`, or a call when `stack ≤ toCall`.

**LegalActions** `{seat, types, toCall, minTo, maxTo}`. Standard NLHE min-raise: `minTo = currentBet + lastRaiseSize`,
capped at all-in. An all-in under a full raise doesn't reopen betting for players who already acted.
- `fold` is legal only when there's something to call: `types` starts `['check']` when `toCall = 0` and
  `['fold', 'call']` otherwise, followed by `'bet'` or `'raise'` when legal. The UI hides or disables Fold when
  nothing is owed.
- An opening bet (no bet yet on the street) always reopens betting, even an all-in under 1bb. Only raises are
  checked against the full-raise rule. After a short opening bet, `lastRaiseSize` stays 1bb, so the min-raise
  is `currentBet + 1bb`.

**GameState**: `schemaVersion, handId, seed, stakes, numPlayers, buttonSeat, sbSeat, bbSeat, heroSeat,
players: PlayerState[], street ('preflop'|'flop'|'turn'|'river'|'showdown'|'complete'), board, deck,
potCollected, currentBet, lastRaiseSize, actingSeat, lastAggressorSeat, preflopAggressorSeat, events, result`.
- `applyAction` advances streets, deals the board, runs out all-ins, resolves showdown, side pots, rake and
  awards. It also sets `result` and `street: 'complete'`. Odd chips: when a pot splits unevenly, the whole
  remainder goes to the first winner clockwise from the button (not one chip each).
- `handId` = `createdAt.toString(36)` + `-` + the first 8 lowercase hex characters of a one-way hash of `seed`
  (e.g. `mfz3k9q1-3fa92c07`). The timestamp makes ids unique across hands, even when a seed repeats. The hash
  keeps the seed hidden, since `handId` is visible in every SeatView. It must be a real one-way hash computed
  synchronously in pure JS. A reversible integer mix such as a MurmurHash finalizer doesn't count.
  The same ScenarioConfig always gives the same `handId`.
- `PlayerState`: `seat, name, isHero, position, profile, startStack, stack, committedStreet, committedTotal,
  holeCards, folded, allIn, hasActed`.
- `HandResult`: `pots[{amount, eligibleSeats, winnerSeats}], rakeChips, netChips[seat], showdownSeats,
  heroAllInEv`. `pots[].amount` is after rake (§3). `heroAllInEv` is set only when betting has closed for the
  rest of the hand with board cards still to come and hero hasn't folded (the runout case, which covers hero
  all-in, hero calling an all-in, and an opponent calling hero's bet all-in). Otherwise it's `null`.
  It's computed at that moment: exact enumeration for 1–2 cards to come, 20,000-sample Monte Carlo otherwise.
  Folded players' cards count as unknown (they stay in the pool of possible board cards).
  Hero's expected share is taken pot by pot, minus hero's contribution, minus hero's expected rake share.

**HandEvent** `{seq, type, street, …}` with these types:

| type | fields |
|---|---|
| postBlind | seat, blind ('SB'/'BB'/'straddle'), amount |
| dealHole | seat, cards |
| action | seat, action, amount (chips added), to, allIn, potBefore, toCall, stackBefore |
| board | cards (new cards only) |
| uncalled | seat, amount |
| showdown | seat, cards, handLabel |
| rake | amount |
| award | seat, amount, potIndex |
| bounty | seat (receiver), fromSeat (payer), amount, bountyIndex (§15) |

Event `street`: the street the event happened on. `uncalled` uses the street it happened on. `rake` and `award`
use `'showdown'` if there was a showdown, otherwise the street the hand ended on (e.g. `'preflop'` for a walk).

**SeatView** (`getView(state, seat)`): the state for one seat with no deck, other seats' hole cards set to `[]`,
and other seats' `dealHole` events removed. `showdown` events stay visible. The hero UI uses the same view.
It carries every other GameState field except `deck` and `seed` (e.g. `buttonSeat`, `currentBet`,
`lastRaiseSize`, `actingSeat`, `result`), plus `seat`, `position`, `holeCards`, `pot` and `legal`. `street` can
be `'showdown'` or `'complete'` for finished hands. `legal` is `null` when the seat isn't to act. `seed` is left
out because the deck is a pure function of it.

**BotProfile** `{id, name, tier, avatar{color, initials}, vpip, pfr, threeBet, aggression, bluffFreq,
foldToBet, skill, usesCharts, textureSizing, mixing, exploitsHero}`. The rates are 0..1. `aggression` is the target
postflop AF. The display label for `toughReg` is **"Tough reg"**. Never use "pro".

**RangeChart** is `RANGE_CHART[position][depthBand][action] → HandRange`, where the action is `open`, `call` or
`threeBet`, and `HandRange = {[handClass]: freq 0..1}` (missing = 0). `call` and `threeBet` are the response to a single
open raise from any earlier position. `open` for BB is empty. The SB `open` range is used for limp/raise-first-in.
Every position in `POSITIONS_BY_SIZE` has all three bands.

**CoachFlag** `{id, severity, street, decisionIndex, evLossBb, oppTier, data}`. The IDs and data are listed in §8.3.

**HeroDecision** is one per hero `action` event. It's built by `buildHandRecord` from event fields:
`index, eventSeq, street, position, holeCards, board, potBeforeBb, toCallBb, stackBeforeBb, effectiveStackBb,
numOpponents, inPosition, facing, opponentSeats, action, allIn`.

**CoachDecision** `{decisionIndex, equity, equitySamples, potOdds, evByActionBb, bestAction, evLossBb, chart,
texture}`. **CoachResult** `{handId, version, decisions, flags, totalEvLossBb, grade}`. `grade` is `major` if any
major flag or `totalEvLossBb ≥ 5`, `minor` if any flag, and `clean` otherwise.

**HandRecord**: `schemaVersion, id, timestamp, sessionId, seed, stakes, numPlayers, heroSeat, heroPosition,
buttonSeat, players[{seat, name, position, isHero, startStackBb, holeCards, profile}], board, events, result,
heroNetBb, heroEvNetBb, rakeBb, heroRakeBb, statFlags, decisions, coach`. It stores the full, unredacted hand.
Redaction is the exporter's job.

**HeroStatFlags** (computed by `buildHandRecord`):
- `vpip`: hero voluntarily called or raised preflop. Posting a blind or checking the BB doesn't count.
- `pfr`: hero raised preflop.
- `threeBetOpp` / `threeBet`: hero could act facing exactly one raise preflop / hero re-raised it.
- `cbetOpp` / `cbet`: hero was the preflop aggressor and flop action was checked to hero or hero was first
  to act / hero bet.
- `foldToCbetOpp` / `foldToCbet`: hero faced a flop bet from the preflop aggressor / hero folded to it.
- `sawFlop`, `wentToShowdown`, `wonAtShowdown`: `wonAtShowdown` is true if hero won any part of a pot at showdown.
- `postflopBets`, `postflopRaises`, `postflopCalls`: counts across flop, turn and river.

**StatsSummary** / **ProfitabilityEstimate**: see schemas.js and §9.

## 6. Module APIs

### Engine (`src/engine/index.js`)
```js
createRng(seed) → Rng
createScenario({stakes, poolOverride?, seed, createdAt, straddle?, bounty?}, rng) → ScenarioConfig
createHand(scenario, {cards?}) → GameState      // shuffles with rng(deriveSeed(seed,'deck')), posts blinds, deals
  // optional cards = {holes?: {[seat]: Card[2]}, board?: Card[≤5]} presets hole cards and/or the first
  // board cards (tests and replays); the rest come from the seeded shuffle. main.js uses one argument.
getLegalActions(state) → LegalActions | null      // null when no one is to act
applyAction(state, action) → GameState            // throws RangeError on illegal action
getView(state, seat) → SeatView
isComplete(state) → boolean
buildHandRecord(state, {sessionId, timestamp}) → HandRecord   // coach: null
computeEquity({hero, board, villains: (Card[]|HandRange)[], dead?, iterations=2000, rng})
  → {equity, win, tie, samples}                   // exact when ≤2 cards to come and villains are known cards
evaluate(cards) → {score, category, label}; handClass(cards) → HandClass; boardTexture(board) → Texture
```

### Bots
```js
decideAction(view: SeatView, profile: BotProfile, ctx: BotContext) → Action
createBotProfile(tier: Tier, rng: Rng) → BotProfile
```
`decideAction` is synchronous and pure given `ctx.rng`. It must always return a legal action. `ctx.heroStats` is
hero's `'session'` StatsSummary, or `null` when the tracker isn't wired. The UI adds a 400–900 ms delay before bots act.
`placeholder.js` exports the same two functions: check if legal, else call.

### Coach (`src/coach/index.js`)
```js
analyzeHand(record: HandRecord, {rng, iterations=2000}) → CoachResult
detectPatterns(records: HandRecord[], stakes: StakesId) → CoachFlag[]   // PAT_* flags only
liveOdds(view: SeatView, opponents: BotProfile[], {rng, iterations=1000}) → {equity, potOdds}
```

### Explain (`src/explain/index.js`)
`explainFlag(flag: CoachFlag) → Explanation {title, body, tip}`. Templates are keyed by flag ID and tier group:
`fish`, `reg` (lowReg or midReg), `tough`, `default` (null oppTier or PAT_*). They're filled from `flag.data`.
Missing variants fall back to `default`. Every ID in `FLAG_IDS` needs a `default` template. The advice changes
with the opponent: e.g. vs fish, value-bet thinner and don't bluff; vs tough reg, stay balanced and respect raises.

### Export (`src/export/index.js`)
```js
formatHand(record, {hideOpponentCards=false, includePrompt=true, explain?}) → string
formatHands(records, opts) → string            // prompt header once; used for "copy last 10"
formatSummary({stats: StatsSummary[], patterns: CoachFlag[], stakes}, {includePrompt=true}) → string
```
`explain` is optional and gets `explainFlag` when that module is wired. Clipboard copy lives in `ui`.

### Data (`src/data/index.js`)
`HandStore`: `put(record)`, `putMany(records)`, `get(id)`, `getAll()`, `getLatest(n)` (newest first),
`count()`, `clear()`. All return Promises. IndexedDB database `poker-trainer`, store `hands`, keyPath `id`,
index `timestamp`. `createMemoryStore()` implements the same interface for tests and fallback.
`src/data/ranges.js` exports `RANGE_CHART` (a RangeChart, §5) and `getChartRange(position, band, action) → HandRange`.
It imports only `shared` and never touches IndexedDB, so bots and the coach can import it under Node.

### Tracker (`src/tracker/index.js`)
```js
createTracker(store: HandStore, {sessionId}) → Tracker
tracker.recordHand(handRecord) → Promise<void>
tracker.getStats(window: StatsWindow, {stakes?}) → Promise<StatsSummary>
tracker.getRecentHands(n) → Promise<HandRecord[]>          // newest first
tracker.exportJSON() → Promise<string>                      // {schemaVersion, exportedAt, hands: HandRecord[]}
tracker.importJSON(text, {mode: 'merge'|'replace'}) → Promise<{added, skipped}>  // merge dedupes by id
```
Windows 100, 500 and 1000 are the most recent N hands (fewer if the store has fewer). `'session'` means this
`sessionId`. `'all'` means everything.

### UI and main.js
`main.js` loads each optional module with `await import()` inside try/catch. A module that's missing or throws on
import is left out. It builds:
```js
app = { engine, bots, coach|null, explain|null, exporter|null, tracker|null,
        features: {realBots, coach, explain, export, tracker, dashboard}, settings }
```
`bots` is `src/bots/index.js` if it loads, otherwise `placeholder.js`. The UI shows a feature's controls only
when its flag is true. Later milestones only add modules. main.js wiring stays additive.
Hand loop in main.js/ui:
1. `createScenario` → fill profiles → `createHand`. Use a fresh seed for every hand (e.g. drawn from a session
   RNG seeded once from `crypto.getRandomValues`) and pass `createdAt: Date.now()`. A reused seed would replay
   the same deal. The `createdAt` part of `handId` keeps record ids unique either way.
2. While the hand isn't complete: the hero seat waits for UI input, and bot seats call `bots.decideAction`.
3. `buildHandRecord`, then `record.coach = coach?.analyzeHand(...) ?? null`, then `tracker?.recordHand(record)`.
   Keep the last 10 records in memory for export when the tracker is absent.

UI: a felt oval table with seats placed around it. Each seat shows an avatar circle (color + initials), name, tier
badge, stack in bb, bet chips, and cards (CSS/SVG cards, face-down for opponents until showdown). The board and
pot sit in the center. Hero controls are fold, check/call, a bet/raise slider with ⅓, ½, ¾ and pot presets, and all-in.
Fold is hidden or disabled when `legal.types` doesn't include it (nothing to call).
There's a "Next hand" button. Optional panels: hand review (coach results + explanations), export buttons (copy
last hand, copy last 10, hide-opponent-cards toggle, copy summary), dashboard (stats windows, trends, leaks,
profitability) and settings (stakes, pool override, live-odds toggle, JSON export/import).

## 7. Bots

Tier parameters are sampled uniformly per bot from these ranges:

| tier | vpip | pfr | 3bet | AF | bluff | foldToBet | skill | charts/texture/mixing/exploit |
|---|---|---|---|---|---|---|---|---|
| fish | .40–.65 | .05–.15 | .02–.05 | 0.6–1.2 | .05–.15 | .20–.35 | .10–.30 | no/no/no/no |
| lowReg | .22–.30 | .16–.22 | .05–.08 | 1.8–2.8 | .15–.25 | .40–.50 | .40–.55 | no/no/no/no |
| midReg | .20–.26 | .17–.22 | .07–.10 | 2.5–3.2 | .25–.33 | .40–.48 | .60–.75 | yes/yes/no/no |
| toughReg | .21–.26 | .18–.23 | .08–.12 | 2.8–3.5 | .30–.38 | .38–.45 | .85–.95 | yes/yes/yes/yes |

- **Preflop without charts:** rank the 169 classes by a fixed strength list. Open or raise with the top `pfr`,
  call with the next `vpip − pfr`, and 3-bet with the top `threeBet`. Widen by position (BTN ×1.3, UTG ×0.7).
  Add noise scaled by `1 − skill`.
- **Preflop with charts:** sample an action from the `RANGE_CHART` frequencies for (position, band, action).
  Each chart bot scales the chart to its own profile, keeping its shape: `open` by `pfr / 0.175`, `call` by
  `(vpip − pfr) / 0.075` and `threeBet` by `threeBet / 0.06` (the unscaled chart's bot-only rates). Without
  this every chart bot plays identical ranges.
- midReg and toughReg have similar VPIP/PFR on purpose; they differ in 3-bet rate, skill, mixing and exploits.
- **Opener facing a 3-bet (regs):** continue (call or 4-bet) with the top share of the bot's own opening range
  from that position: lowReg 40%, midReg 48%, toughReg 50% out of position, +4pp in position, +3pp heads-up,
  scaled by the price and trimmed per caller; 4-bet the top 10% / 11% / 12% of that range. Targets: fold to
  3-bet ~55% lowReg, ~50% midReg, ~45% toughReg. Fish keep their profile logic. Cold spots and 4-bets+ are
  unchanged.
- **Blind defense (regs):** when folded to a blind facing one raise, regs don't use the `vpip` threshold. They
  continue with a share set by the opener's position and the price: toughReg BB folds ~55% vs UTG, ~37% vs
  CO/BTN, ~30% vs SB (midReg ×0.95 and lowReg ×0.9 of its defense); the SB defends ~12% vs UTG to ~29% vs BTN.
  Chart bots keep the chart's shape. Fish are unchanged.
- **Heads-up:** the button (SB) opens ~82–87% (regs) and the BB defends ~70–75% vs its open. 3–9 handed opens
  scale with players left to act, via positions named back from the button.
- **What `vpip` means here:** the table's `vpip` is the target outside blind defense. Blind defense adds ~5–6pp,
  so regs' overall VPIP runs ~29–30% in bot-only play. That's intended.
- **Straddles and bounties:** see §14 and §15.
- **Postflop:** estimate equity vs a uniform range narrowed by opponents' preflop actions (300 samples).
  Bet or raise for value when equity > 0.6. Bluff with probability `bluffFreq` when equity < 0.35. Call when
  equity ≥ pot odds, blended with noise by `1 − skill`. Tune the bet/call ratio toward `aggression`.
- **Sizing:** without `textureSizing`, bet 50–75% pot at random. With it: dry 25–33%, paired 33%, semiwet 50%,
  wet/monotone 66–80%. The river goes polarized: 75–125% with nuts or bluffs. Preflop opens are 2.5bb
  (+1bb per limper; 3bb from SB). 3-bets are 3× in position and 4× out of position.
- **Mixing:** with `mixing`, pick actions by frequency with `rng`. Without it, take the argmax.
- **Exploits (`exploitsHero`, only when `heroStats.hands ≥ 30`):**
  - hero foldToCbet > .55: c-bet 90%, any hand.
  - hero foldToCbet < .35: c-bet value-heavy only.
  - hero vpip > .35: iso-raise wider (+30%) and value-bet thinner.
  - hero threeBet < .04: open ×1.3 from CO/BTN/SB.
  - hero wtsd > .35: halve bluffs.
  - hero af < 1.5: fold more to hero's raises (+15%).

## 8. Coach

### 8.1 Equity and ranges
Each opponent's range at a decision comes from its profile and preflop action:
- Raised: top `pfr` (or `threeBet` for a 3-bet).
- Called: the band between `vpip` and `pfr`.
- BB check: the complement.
- Postflop: if the opponent bet or raised on the current street, drop the weakest 30% × (1 − bluffFreq) of
  the range by made-hand strength.

Equity is a Monte Carlo `computeEquity` against all live opponents, 2000 samples, with
`rng = createRng(deriveSeed(seed, 'coach'))`.

### 8.2 EV model (bb, approximate; constants live in `src/coach/ev.js`)
- `EV(fold) = 0`
- `EV(check) = E·P·R`
- `EV(call) = E·(P+C)·R − C`
- `EV(bet/raise adding A) = F·P + (1−F)·(E'·(P+2A)·R − A)`

Where:
- `P` is the pot before the action and `C` is the amount to call.
- `R` is realization: 1.0 on the river or all-in, otherwise 0.95 in position and 0.85 out of position.
- `F = Π opponents clamp(foldToBet × (0.6 + 0.53·A/P), 0.05, 0.9)`.
- `E' = 0.85·E` is equity against a calling range.

Candidates are fold/check, call, and bet/raise at 0.5, 0.75 and 1.0 pot plus all-in (legal ones only), plus the
chosen size. `evLossBb = max(EV) − EV(chosen)`, floored at 0.

Preflop, except when all-in or facing an all-in, `evLossBb` comes from the chart instead:
`cost × (1 − chartFreq(chosen))`, with costs openOutOfRange 0.4, missedOpen 0.3, limp 0.3, callOutOfRange 0.6,
missed3bet 0.4, threeBetOutOfRange 0.8 and foldInRange 1.0 bb.

Severity: `major` if evLossBb ≥ 3, `minor` if ≥ 0.5, and `info` below that (sizing and chart notes).

### 8.3 Flag IDs and data fields
Every flag has the common fields (§5). `oppTier` is the tier of the last aggressor, or of the single
remaining opponent. The `data` fields are:

| id | when | data |
|---|---|---|
| PF_OPEN_OUT_OF_RANGE | raised first-in, chart open freq < 0.25 | hand, position, depthBand, chartFreq |
| PF_MISSED_OPEN | folded first-in, open freq ≥ 0.75 | hand, position, depthBand, chartFreq |
| PF_OPEN_LIMP | limped first-in (not SB with chart limp) | hand, position, depthBand |
| PF_CALL_OUT_OF_RANGE | called an open, call freq < 0.25 | hand, position, depthBand, vsPosition, raiseToBb, chartFreq |
| PF_MISSED_3BET | didn't 3-bet, 3-bet freq ≥ 0.75 | hand, position, depthBand, vsPosition, chartFreq |
| PF_3BET_OUT_OF_RANGE | 3-bet, 3-bet freq < 0.25 | hand, position, depthBand, vsPosition, chartFreq |
| PF_FOLD_IN_RANGE | folded to an open, call+3-bet freq ≥ 0.75 | hand, position, depthBand, vsPosition, callFreq, threeBetFreq |
| PF_OPEN_SIZE | open outside 2–3bb (+1/limper; SB 2.5–3.5) | sizeBb, recommendedBb [lo, hi], position, limpers |
| EQ_BAD_CALL | called, E < required, loss ≥ 0.5 | equity, requiredEquity, toCallBb, potBb |
| EQ_BAD_FOLD | folded, E > required + 0.05, loss ≥ 0.5 | equity, requiredEquity, toCallBb, potBb |
| EQ_MISSED_VALUE | checked/called, best is bet/raise, E ≥ 0.6 | equity, potBb, bestAction, evGainBb |
| EQ_BAD_BLUFF | bet/raise with E < 0.35 and EV < check/fold | equity, foldEstimate, sizePct, oppVpip |
| SZ_TOO_SMALL | postflop bet < texture range − 10pp | sizePct, recommendedPct [lo, hi], texture |
| SZ_TOO_LARGE | postflop bet > texture range + 25pp (not all-in, not river polar) | sizePct, recommendedPct [lo, hi], texture |
| LN_MISSED_CBET | cbetOpp, checked, best EV is bet | texture, numOpponents, equity |
| LN_PAYOFF_PASSIVE_RAISE | called a turn/river raise from an opponent with AF < 1.5 and E < 0.5 | oppAggression, equity, toCallBb |
| PAT_TOO_LOOSE / PAT_TOO_TIGHT | vpip outside winningRanges | stat:'vpip', value, target [lo, hi], hands, window |
| PAT_LOW_PFR | vpip − pfr > 0.08 | vpip, pfr, gap, hands, window |
| PAT_LOW_3BET | threeBet < lo | stat, value, target, hands, window |
| PAT_PASSIVE | af < lo | stat, value, target, hands, window |
| PAT_OVERFOLD_CBET | foldToCbet > hi | stat, value, target, hands, window |
| PAT_LOW_CBET | cbet < lo | stat, value, target, hands, window |
| PAT_HIGH_WTSD | wtsd > hi | stat, value, target, hands, window |
| PAT_LOW_WSD | wsd < lo | stat, value, target, hands, window |
| PAT_TILT | vpip over the 20 hands after a ≥ 50bb loss exceeds the prior vpip by ≥ 0.10 | lossBb, vpipBefore, vpipAfter, handsAfter |
| PAT_REPEATED_LEAK | the same hand-level flag ID ≥ 5 times in the last 100 hands | flagId, count, evLossBb, window |

`requiredEquity = potOdds = C/(P+C)`. `recommendedPct` is the §7 texture range. Pattern flags need at least 30
opportunities for their stat and use the last 500 hands (`window: 500`). Severity for patterns: `major` if the
value is more than one range-width outside, otherwise `minor`.

## 9. Tracker stats and profitability

- Rates are occurrences / opportunities, and `null` when there are 0 opportunities.
  `vpip` and `pfr` use all hands. `wtsd` = wentToShowdown / sawFlop. `wsd` = wonAtShowdown / wentToShowdown.
  `af` = (bets + raises) / calls, and `null` if calls = 0.
  `foldToBet` = foldedToPostflopBet / facedPostflopBet (hands where hero faced any postflop bet or raise).
- `bbPer100 = 100·Σ heroNetBb / n`. `evAdjBbPer100` uses `heroEvNetBb` instead. Both exclude bounties.
  `bountyPer100 = 100·Σ heroBountyBb / n` and `bbPer100WithBounty = bbPer100 + bountyPer100` (§15). The
  profitability estimate uses the bounty-free numbers.
  `evAdjCi95 = mean ± 1.96·sd/√n`, scaled ×100, where sd is the sample SD of per-hand `heroEvNetBb`.
- `evLossPer100 = 100·Σ coach.totalEvLossBb / coachedHands`. `rakePer100 = 100·Σ heroRakeBb / n`.
- `topLeaks`: hand-level flags grouped by ID, top 5 by total evLossBb.
- `trend` compares this window with the previous window of the same size. It's `null` if not enough hands or for 'session'/'all'.

**Profitability** (`profitability.js`, deterministic):
1. `deviationPenalty`: for each of vpip, pfr, threeBet, cbet, foldToCbet, wtsd, wsd and af with ≥ 30
   opportunities, take `d` = the distance outside `[lo, hi]` and add `min(3, 2·d/(hi−lo))`. Cap the total at 10.
2. `model = referenceWinrate − evLossPer100 − deviationPenalty − rakePer100`. If there are no coached hands,
   skip evLoss and add a reason.
3. `w = n/(n+3000)` and `estimate = w·evAdjBbPer100 + (1−w)·model`.
4. Verdict: `estimate ≤ −2.5` → likely_losing, `≥ 2.5` → likely_winning, otherwise break_even.
5. Confidence: `low` if n < 300, or if the sign of `model` and the CI midpoint disagree while the CI spans 0.
   `high` if n ≥ 3000 and the CI lies entirely on the verdict's side of ±2.5. `medium` otherwise.
6. `reasons` has up to 4 short strings (the biggest deviation, EV loss, rake, sample size).
   `disclaimer = PROFITABILITY_DISCLAIMER`. The UI must show the confidence and the disclaimer next to every
   verdict and must never word it as certain.

## 10. Export text format

Line endings are `\n`. Amounts are bb with one decimal (`12.5bb`), and percentages are whole numbers.
Lines in `{}` are omitted when their data is absent: no coach → no equity or flag lines, and no explain → no
explanation text.

```
=== POKER TRAINER EXPORT v1 ===
You are an expert No-Limit Hold'em coach. Review the hand(s) below from a training app with bot opponents.
For each hero decision, say whether it was a mistake, why, and what you would do instead, considering
opponent profiles, stack depth, and board texture. The app's own coach notes are included; agree or
disagree with them. Then summarize the most important leak.

--- Hand 1 of 1 | id 7f3a… | Micro (NL5) $0.02/$0.05 | 6-handed | 2026-09-28 19:55 ---
Rake: 5% cap 4bb | Effective stacks: hero 100.0bb
Players:
  Seat 1 LJ   Mika     85.0bb  fish      VPIP 52 PFR 9 3B 3 AF 0.9 Bluff 10% Skill 20%  [Qs Qh]
  Seat 4 BTN  Hero    100.0bb  HERO                                                     [Ah Kd]
  …
PREFLOP (pot 1.5bb): LJ raises to 2.5bb, HJ folds, CO folds, Hero (BTN) raises to 8.0bb, SB folds, BB folds, LJ calls 5.5bb
{  Hero #1: raise to 8.0bb | equity 58% | pot odds — | EV loss 0.0bb | chart: 3-bet 100%}
FLOP [Ah 7d 2c] (pot 17.5bb): LJ checks, Hero bets 6.0bb, LJ calls 6.0bb
{  Hero #2: bet 6.0bb | equity 81% | pot odds — | EV loss 0.0bb}
TURN [Ah 7d 2c] [9s] (pot 29.5bb): …
RIVER [Ah 7d 2c 9s] [3h] (pot …): …
SHOWDOWN: LJ shows [Qs Qh] (Pair of Queens); Hero shows [Ah Kd] (Pair of Aces, King kicker)
RESULT: Hero wins 58.5bb (net +29.0bb) | rake 0.0bb {| all-in EV net +24.1bb}
{COACH FLAGS:
  - [minor] SZ_TOO_SMALL (turn, #3): bet 25% pot; texture wet suggests 66–80%. EV loss 0.8bb
{    Explanation: <explainFlag(flag).body>}}
=== END ===
```
- Opponent profile columns are percentages. Hero's row shows `HERO` instead of profile stats.
- With `hideOpponentCards: false` (the default), every opponent's `[cards]` is shown, including folded hands.
- With `hideOpponentCards: true`, every opponent's cards print as `[?? ??]`, including SHOWDOWN lines, and hand
  labels are omitted. RESULT still prints.
- When a bounty is live, the hand header gets one line per bounty after `Rake:`, and RESULT gets a bounty part:
  `Bounty: hand J4o | 2.0bb from each player | pays on showdown or fold` (or `card 4c`, `pays on showdown only`),
  `RESULT: Hero wins 12.4bb (net +8.1bb) | bounty +8.0bb (hand J4o) | rake 0.6bb`. A bounty nobody won prints
  `| bounty unclaimed`.
- Action verbs are `posts SB/BB`, `posts straddle X`, `folds`, `checks`, `calls X`, `bets X`, `raises to X`, with `(all-in)`
  appended when it applies. Uncalled bets print `Uncalled X returned to <pos>`.
- `formatHands` prints the prompt once, then `--- Hand i of n …` blocks oldest-first, then `=== END ===`.

**Summary export**
```
=== POKER TRAINER SUMMARY v1 ===
<coaching prompt: assess this player's long-term stats vs winning ranges for the stakes, rank leaks,
 suggest a study plan; treat the profitability line as a rough estimate>
Stakes: Micro (NL5) | Hands: 1,240 | From 2026-09-01 to 2026-09-28
Window  Hands  VPIP PFR 3B  CB FCB WTSD W$SD  AF   bb/100  EVadj bb/100 (95% CI)   EVloss/100 Rake/100
Last100   100   24  19  7  61  44   29   52  2.8    +12.0   +8.4 (-31.0, +47.8)        6.1      3.9
Last500 …  Last1000 …  All …
Winning ranges (Micro): VPIP 18–28, PFR 14–22, 3B 5–9, CB 50–75, FCB 35–55, WTSD 24–32, W$SD 50–60, AF 2.0–4.0
Trends (last 500 vs previous 500): bb/100 +3.1, EV loss/100 −1.2, VPIP −2
Top leaks:
  1. EQ_BAD_CALL — 14× — 38.2bb total
  …
Patterns: PAT_OVERFOLD_CBET (FCB 61% vs 35–55%), …
Profitability: likely losing (confidence: low) — <reasons joined by "; ">
Note: <PROFITABILITY_DISCLAIMER>
=== END ===
```

## 11. Milestones (the app is playable at each one)

- **M1:** engine, `bots/placeholder.js`, `bots/profiles.js`, ui table + controls, main.js, index.html, styles.
  Play endless random hands against check/call bots. Coach, export, tracker and dashboard are all hidden.
- **M2:** `bots/index.js` (all four tiers, charts, exploits reading `heroStats` when present), `data/ranges.js`, export
  `formatHand`/`formatHands`, plus ui copy buttons and the hide toggle. Export works without coach lines.
- **M3:** coach, explain, data hand store, tracker, dashboard, summary export, JSON import/export, live-odds toggle.
  Wiring these in only adds to main.js. Existing modules aren't rewritten.

## 12. Testing

- `node --test` from the repo root runs every `tests/**/*.test.js`. Use only `node:test` and `node:assert`.
- Engine tests: evaluator categories and ties, side pots with 3+ all-ins, min-raise and the incomplete-raise rule,
  heads-up blind/button order, rake cap and no-flop-no-drop, chip conservation (Σ netChips + rake = 0),
  determinism by seed, and `getView` redaction.
- Bots: every returned action is legal across 10k random seeded states. Tier stats converge within ±5 pp
  of the profile over 5k simulated hands, except reg VPIP, which may run up to +8pp over the profile because
  of blind defense (§7). Blind-defense, heads-up and vs-3-bet fold rates are checked against the §7 targets.
- Coach: known spots give the expected flag IDs. Equity comes within ±2 pp of exact enumeration.
- Export: golden-text snapshots from fixed HandRecords.
- Tracker: stats computed from fixture records, CI math, and profitability thresholds.
- Data: tests use `createMemoryStore`.
- Integration: scripted full hands through main-style wiring, with no DOM.

## 13. Clarifications

From `REQUESTS-claude.md` (2026-09-28). The sections named are updated to match.

1. **Pots after rake** (§3, §5): `HandResult.pots[].amount` is after rake. Σ pots = Σ awards, and
   Σ pots + `rakeChips` = total chips contributed.
2. **Odd chips** (§5): the whole remainder of an uneven split goes to the first winner clockwise from the button.
3. **Fold needs something to call** (§5 LegalActions, §6 UI): `types` is `['check', …]` when `toCall = 0`
   and `['fold', 'call', …]` otherwise. The UI hides or disables Fold when it isn't legal.
4. **SeatView fields** (§5, schemas.js): `street` may be `'showdown'`/`'complete'`, `legal` may be `null`, and the
   view carries the other GameState fields **except `deck` and `seed`**. Adopted with one change: the request kept
   `seed`, but the deck is a pure function of the seed, so it can't be in a redacted view.
5. **Event street for rake/award/uncalled** (§5 HandEvent): `rake`/`award` use `'showdown'` if there was one,
   otherwise the street the hand ended on. `uncalled` uses the street it happened on.
6. **`heroAllInEv`** (§5 HandResult): set only when betting has closed for the rest of the hand with board cards
   to come and hero hasn't folded. Folded players' cards count as unknown.
7. **Short opening bets** (§5 LegalActions): any opening bet, including an all-in under 1bb, reopens betting.
   Only raises are checked against the full-raise rule.
8. **`createHand(scenario, {cards})`** (§6 Engine): optional presets for hole cards and the first board cards.
   The one-argument form is unchanged and is what main.js uses.
9. **`handId` from `seed`** (§5, §6 UI): adopted, then replaced by item 10. main.js still uses a fresh seed per
   hand, but `handId` no longer depends on the seed alone.
10. **Unique, non-revealing `handId`** (§4, §5, §6, schemas.js; owner decision): `handId` = base36 `createdAt`,
    a dash, then the first 8 hex characters of a one-way hash of `seed`. `createdAt` is a new ScenarioConfig field
    that main.js sets to `Date.now()`, so the engine stays pure and reproducible. This fixes two problems: the
    old format put the raw seed in the id, and repeated 32-bit seeds would have made ids collide.
11. **Separate deck stream** (§2, §6 Engine; owner decision): `createHand` shuffles with
    `createRng(deriveSeed(seed, 'deck'))`, not `createRng(seed)`. `createScenario` also draws from `seed`, so
    sharing a stream made the deal depend on table size (premiums were 2.06% at 9-handed vs 2.56% expected over
    1M deals). Every other random consumer (bots, coach, all-in EV) likewise uses its own `deriveSeed` label.
12. **Later owner decisions (2026-09-29):** midReg uses charts without mixing (§7 table); chart bots scale the
    chart to their profile (§7); the coach's equity stream is `deriveSeed(seed, 'coach')` (§8.1); `foldToBet`
    joins StatsSummary (§9); straddles (§14) and bounties (§15) are added. §7's old vs-3-bet rule ("top 40% of
    the threeBet range") was an error that made regs fold ~90%; replaced along with price-aware blind defense. Player bounties are deferred. Hand
    bounties exclude pocket pairs and default to 25% of hands, since at 5% they paid about once per 2,900 hands.

## 14. Straddles

- **Option:** `createScenario({…, straddle})`, `straddle = {enabled: boolean, heroChance: 0–1}`, default
  `{enabled: false, heroChance: 0}`. Disabled means no one straddles.
- **Who:** only at 3+ player tables, only the first seat after the BB (the button when 3-handed). Hero straddles
  with `heroChance`; a bot straddles at `STRADDLE_RATES[tier]` (schemas.js). A stack ≤ `STRADDLE_BB` never
  straddles. One draw from `createRng(deriveSeed(seed, 'straddle'))`. The result is
  `ScenarioConfig.straddleSeat` (seat or null), carried into GameState, SeatView and HandRecord.
- **Posting:** a live `STRADDLE_BB` (2bb) `postBlind` event with `blind: 'straddle'`, after SB and BB and before
  hole cards. It sets `currentBet = 2bb` and `lastRaiseSize = 2bb`, so the minimum raise is to 4bb.
- **Action:** preflop starts left of the straddler, who keeps a check/raise option like the BB. Postflop order,
  rake, side pots and the uncalled-bet return are unchanged. In a walk the straddler gets its uncalled 1bb back
  and there's no rake (no flop, no drop where it applies).
- **Records:** the straddle is a forced post: never VPIP, PFR, a 3-bet opportunity or a hero decision.
  `heroPosition` keeps the seat's normal label (e.g. `UTG`). `HeroStatFlags.straddled` / `facedStraddle`.
- **Bots:** preflop the straddle is the effective big blind: opens are 2.5 (SB 3) effective blinds plus 1 per
  limper, 3-bets are 3×/4× the current bet, depth bands are read in effective blinds, and the straddler uses the
  BB chart row for its option. The real BB uses the SB row (it has no 'open' row), and the SB keeps its row.
  Folded to a blind facing only the straddle, regs continue ~60–72% (BB) / ~53–60% (SB), raising the top ~45%
  of that and completing the rest.
- **Export:** `posts straddle 2.0bb`.

## 15. Bounties

Optional side prizes that make weak hands worth playing. Every type is off by default, so behaviour and existing
records don't change unless it's switched on. Player bounties (winning all of one seat's chips) are deferred;
`Bounty.type` leaves room for `'player'` later.

- **Option:** `createScenario({…, bounty})`, `bounty = {hand: BountyTypeSetting, card: BountyTypeSetting,
  paysOn: 'showdownOrFold'|'showdownOnly'}`, `BountyTypeSetting = {enabled, chance 0–1, amountBb}`. Defaults in
  `BOUNTY_DEFAULTS`: both disabled, chance 0.25 (hand) / 0.05 (card), amountBb 2, paysOn `'showdownOrFold'`.
- **Draw:** from `createRng(deriveSeed(seed, 'bounty'))`, always four draws in this order: hand roll, hand
  target, card roll, card target, so toggling one type never changes the other.
  - **Hand bounty target:** uniform over the weakest `BOUNTY_HAND_POOL` (84) of the 156 non-pair classes
    (pocket pairs are never bounty hands), by the fixed 169-class strength ranking (the engine owns that ranking;
    the bots import it).
  - **Card bounty target:** uniform over the 24 cards with rank in `BOUNTY_CARD_RANKS` (2–7), e.g. `4c`.
  - The live bounties are `ScenarioConfig.bounties: Bounty[]` (hand first, then card; empty when none), carried
    into GameState, SeatView and HandRecord. They're public: shown in the UI and visible to bots before the deal.
- **Qualifying:** a seat qualifies for a bounty when it wins at least a share of the main pot (`pots[0]`) and
  its hole cards match: its hand class equals the target (hand bounty), or the target card is one of its two hole
  cards, not the board (card bounty). With `paysOn: 'showdownOnly'` it must also have been a showdown.
- **Payment:** settled after the pot is awarded, hand bounty first. Every seat dealt in that doesn't qualify pays
  `min(amountChips, its remaining stack)`. The chips are split equally among the qualifying seats (odd chips per
  §13 item 2). One `bounty` event per payer→receiver transfer. Bounties are never raked and don't change `pots`,
  `rakeChips` or `netChips`. `HandResult.bountyNetChips[seat]` holds each seat's bounty net (sums to 0), so a
  seat's final stack = start + `netChips` + `bountyNetChips`. An unclaimed bounty pays nothing.
- **Records and stats:** `HandRecord.heroBountyBb`. Bounties never count toward VPIP/PFR or any other stat, and
  `heroNetBb` / `heroEvNetBb` exclude them. The tracker shows bb/100 with and without bounties (§9).
- **Bots (first pass):** holding a live bounty hand or card: open or defend it as at least a medium-strength
  hand, bluff more postflop (only with `showdownOrFold`), and fold less on the river. Facing a player who could
  hold it: a small call bonus rather than modelled ranges, only with `showdownOrFold` (with `showdownOnly`,
  folding denies the bounty). Tier weights: fish chase bounties most, toughReg
  adjusts least (a constant in `src/bots/`, like `STRADDLE_RATES`).
- **Export:** §10.
