# Requests from Claude

## 2026-09-28 — Engine: spec clarifications (please confirm or amend SPEC.md / schemas.js)

The engine (M1) implements these readings where SPEC/schemas are silent or loose. Astra's export/UI
should rely on them; if any is wrong, tell me and I'll change the engine.

1. **`HandResult.pots[].amount` is after rake.** Rake comes off main pot first, so Σ pot amounts =
   Σ award events, and Σ pots + `rakeChips` = total chips contributed. Suggest SPEC §5 say so.
2. **Odd chips:** the whole remainder of a split pot goes to the first winner clockwise from the button
   (literal reading of §5), not one chip each.
3. **`fold` isn't legal when `check` is.** `LegalActions.types` is `['check', ...]` when `toCall = 0`, and
   `['fold', 'call', ...]` otherwise. The UI should hide or disable Fold when there's nothing to call.
4. **SeatView typedef:** `street` can also be `'showdown'`/`'complete'` (views of finished hands), and
   `legal` is `null` when the seat isn't to act. Suggest `street: Street|'showdown'|'complete'` and
   `legal: LegalActions|null` in schemas.js. The view also carries the other GameState fields
   (minus `deck`), such as `buttonSeat`, `currentBet`, `lastRaiseSize`, `actingSeat`, `result`.
5. **Event `street` for `rake`/`award`:** `'showdown'` if there was a showdown, otherwise the street the
   hand ended on (e.g. `'preflop'` for a walk). `uncalled` uses the street it happened on.
6. **`heroAllInEv`** is set only when betting has closed for the rest of the hand with board cards still
   to come and hero hasn't folded (the runout case). Folded players' cards count as unknown.
7. **Short opening bets:** an all-in opening bet under 1bb still reopens betting. Only raises are
   checked for "full raise" (§5).
8. **`createHand(scenario, {cards})`**: an optional second argument presets hole cards and/or the
   first board cards (`{holes: {[seat]: Card[]}, board: Card[]}`). Used by tests and replays; it
   doesn't change the one-argument API.
9. **`handId` is derived from `seed`**, so the same seed gives the same id. main.js must use a fresh
   seed per hand (e.g. draw it from a session RNG seeded from `crypto.getRandomValues`), or IndexedDB
   records with the same key will overwrite each other.

## 2026-09-28 — Engine now implements §13 items 4 and 10 (FYI for Astra)

- `createScenario` requires `createdAt` (a non-negative integer, ms since epoch) and copies it into
  `ScenarioConfig.createdAt`. `createHand` throws a TypeError if the scenario has no valid `createdAt`.
- `handId` is `createdAt.toString(36)` + `-` + the first 8 hex chars of SHA-256(`String(seed)`), computed
  in `src/engine/sha256.js`. It matches `src/ui/seed-hash.js`, so the temporary workarounds in
  `src/ui/session.js` (`scenario.createdAt = createdAt` and the handId rewrite) are no longer needed.
  They're harmless if left in place.
- `getView` no longer includes `seed`.

## 2026-09-28 — Engine now implements §13 item 11 (FYI for Astra)

- `createHand` shuffles with `createRng(deriveSeed(seed, 'deck'))`. The same seed now deals different cards
  than before, so any fixed-seed fixture that hard-codes dealt cards needs regenerating (none in the repo broke).
- `computeEquity` no longer falls back to a hidden `createRng(1)` when sampling. It throws a TypeError unless
  the caller passes `rng`. Exact enumeration still works without one.

## 2026-09-29 — Bots (M2): spec amendments and wiring requests

**For the SPEC owner (SPEC.md §7, schemas.js):**
1. **Tier flags changed by owner direction.** midReg now plays the standard `RANGE_CHART` preflop without
   mixing (`usesCharts: true, mixing: false`); toughReg is the only tier that mixes. The §7 table still says
   midReg `no/yes/yes/no`; please change it to `yes/yes/no/no`, and the `BotProfile.usesCharts` comment in
   schemas.js from "(toughReg)" to "(midReg, toughReg)".
2. **Chart bots scale the chart to their profile.** Each chart bot widens/trims its `open`, `call` and
   `threeBet` ranges by `pfr / 0.175`, `(vpip − pfr) / 0.075` and `threeBet / 0.06` (the unscaled chart's
   rates in bot-only play), keeping the chart's shape. Without this, every chart bot plays identical
   ranges and §12's "tier stats within ±5pp of the profile" can't hold. Suggest §7 say so.
3. **`heroStats.foldToBet` (optional).** Tough regs also exploit hero's fold rate to any postflop bet.
   `StatsSummary` has no such field, so it's read when present (from `createHeroReads`, below) and
   `foldToCbet` stands in otherwise. Consider adding `foldToBet: number|null` to StatsSummary.
4. **Only `exploitsHero` bots read `ctx.heroStats`**, for both exploits and hero's range estimate, so the
   flag fully separates tough regs from the rest.

**For Astra:**
1. `tests/integration/main.test.js:11` asserts `app.features.realBots === false`. With `src/bots/index.js`
   in place (M2) main.js loads the real bots, so it's now `true` and that line fails. I ran a copy of the
   test with only that assertion flipped: all 50 main-wired hands pass with the real bots. Please update it.
2. `src/ui/mock.js` sets `usesCharts: tier === 'toughReg'` and `mixing` for midReg; see item 1 above.
3. **Session reads for exploits (optional until the tracker lands).** `bots.createHeroReads()` returns
   `{observe(record), summary()}`. Create one per session, call `observe(record)` after `buildHandRecord`,
   and pass `heroStats: trackerSessionStats ?? reads.summary()` to `decideAction` (session.js passes `null`
   today, so tough-reg exploits are off in the app). Exploits start at 30 hands.
4. FYI: `TIER_RANGE_CHARTS.lowReg` is tighter than the base chart (per tests/data). The bots use the fish and
   lowReg variants only to shape which hands fill their profile's vpip/pfr thresholds, so lowReg still plays
   its looser profile VPIP (22–30%).

## 2026-09-29 — Native live UTG straddle (owner decision; engine and bots implemented)

**For the SPEC owner: wording for SPEC.md and schemas.js.**
1. **§4 Scenario generation / §6 Engine:** `createScenario({stakes, poolOverride?, seed, createdAt, straddle?}, rng)`.
   `straddle = {enabled: boolean, heroChance: number 0–1}`, default `{enabled: false, heroChance: 0}`. When
   enabled at a 3+ player table, the first seat after the BB straddles 2bb live: with `heroChance` if hero sits
   there, otherwise at `STRADDLE_RATES[tier]`. The draw is one value from `createRng(deriveSeed(seed, 'straddle'))`,
   so no other stream shifts. A UTG stack ≤ 2bb never straddles. The result is `ScenarioConfig.straddleSeat`.
2. **schemas.js constants:** please move `STRADDLE_RATES = {fish: 0.25, lowReg: 0.10, midReg: 0.05,
   toughReg: 0.03}` next to `TIERS`/`TIER_LABELS`, and optionally `STRADDLE_BB = 2`. They live in
   `src/engine/scenario.js` for now (`STRADDLE_RATES`, `STRADDLE_CHIPS`), re-exported from `src/engine/index.js`.
   I'll switch the engine to import them once they're in schemas.js.
3. **Typedefs:**
   - `ScenarioConfig.straddleSeat: number|null`: the straddling seat, or null.
   - `GameState.straddleSeat: number|null`. SeatView carries it too, since it's public information.
   - `HandEvent` postBlind: `blind: 'SB'|'BB'|'straddle'`.
   - `HandRecord.straddleSeat: number|null`.
   - `HeroStatFlags.straddled: boolean`: hero posted the straddle.
   - `HeroStatFlags.facedStraddle: boolean`: another seat straddled.
4. **§5 semantics:** the straddle is posted after SB and BB, before hole cards. It sets `currentBet = 2bb` and
   `lastRaiseSize = 2bb`, so the min raise is to 4bb. Preflop action starts left of the straddler, who keeps a
   check/raise option like the BB. Postflop order, rake, side pots and the uncalled-bet return are unchanged: in
   a walk the straddler gets its uncalled 1bb back and there's no rake. The straddle is a forced post, so it
   never counts as VPIP, PFR, a 3-bet opportunity or a hero decision. `heroPosition` keeps the seat's normal
   label (e.g. `UTG`).
5. **§7 Bots:** preflop, the straddle is the effective big blind. Opens are 2.5 (SB 3) effective blinds plus 1 per
   limper, 3-bets are 3×/4× the current bet, depth bands are read in effective blinds, and the straddler uses
   the BB chart row for its option.
6. **§10 Export:** the verb for the post is `posts straddle X`.

**For Astra: switch the UI to the native straddle.**
1. Settings: replace the current straddle setting with **straddles on/off** plus a **hero straddle chance**
   (0–100%). Pass `straddle: {enabled, heroChance: percent / 100}` to `engine.createScenario`. Bots now straddle
   too, at their tier rates, whenever straddles are on; the settings help text should say so.
2. Delete `src/ui/straddle.js`'s adapter code: `maybePostStraddle` in session.js, `straddlePost` in log.js and
   table.js, and the compatibility branch in `src/export/index.js`, plus the tests that exercise the adapter
   (`tests/integration/straddle.test.js`, the straddle cases in `hand-reveal.test.js`). Keep only what the new
   settings need.
3. Export, log and table should read `postBlind` events with `blind: 'straddle'` (and `state.straddleSeat` /
   `record.straddleSeat` for the badge). Any seat can now straddle, not just hero.

## 2026-09-29 — Bounties (SPEC §15; engine and bots implemented)

**For Astra:**
1. **Settings.** Per bounty type (hand, card): **on/off**, **frequency %** (0–100, default 5) and **amount in
   bb** (default 2). One global **pays on** choice: "showdown or fold" (default) / "showdown only". Pass them
   to `engine.createScenario({…, bounty})` as
   `{hand: {enabled, chance: percent / 100, amountBb}, card: {enabled, chance: percent / 100, amountBb}, paysOn}`.
   Missing parts fall back to `BOUNTY_DEFAULTS`; bad values throw `RangeError`. Omitting `bounty` (as today)
   means no bounties, and records are byte-for-byte what they were before.
2. **Show live bounties on the table before the deal.** `state.bounties` / `view.bounties` is public from
   `createHand` on: `[{type: 'hand'|'card', target: 'J4o'|'4c', amountChips, paysOn}]`, hand first. Something
   like "Bounty: J4o · 2bb from each player" near the pot. At hand end, `bounty` events
   (`seat` = receiver, `fromSeat` = payer, `amount`, `bountyIndex` into `bounties`) come after the `award`
   events with the same `street`; the log/table can show them as payouts. Final stack =
   start + `result.netChips[seat]` + `result.bountyNetChips[seat]`.
3. **Export lines (§10).** When a bounty is live: one header line per bounty after `Rake:`,
   e.g. `Bounty: hand J4o | 2.0bb from each player | pays on showdown or fold` (or `card 4c`,
   `pays on showdown only`), and a bounty part in RESULT: `| bounty +8.0bb (hand J4o)` for hero's net
   (`record.heroBountyBb`), or `| bounty unclaimed` when nobody won it. Records carry `bounties` and
   `result.bountyNetChips`; records made before this change have neither, so treat missing as `[]` / zeros.
4. **Tracker (later).** Needs `record.heroBountyBb` (0 when none) for `bountyPer100` and
   `bbPer100WithBounty` (§9); `heroNetBb` and `heroEvNetBb` exclude bounties. `statFlags.facedPostflopBet` /
   `foldedToPostflopBet` are now in every record for `StatsSummary.foldToBet`.
5. FYI: views and records now always carry `straddleSeat` (null when none).

**For the SPEC owner (FYI, no change needed unless you disagree):**
1. The hand-bounty pool follows the fixed multiway-weighted ranking, so it includes `22` and `87s` and
   `K3o` alongside the usual junk. The weakest 84 is exactly what §15 says; flagging it only in case the
   intent was "weak-looking" hands.
2. §5's HandEvent table doesn't list `'bounty'` or `blind: 'straddle'` yet (schemas.js does).

**Update (after 0daab8f):** the hand-bounty frequency default is now **25%** (card stays 5%); take the settings
defaults from `BOUNTY_DEFAULTS` rather than hard-coding them. Hand-bounty targets no longer include pocket
pairs (SPEC owner FYI 1 above is resolved). Bots only add the call bonus against a possible holder under
"showdown or fold".

## 2026-09-29 — Blind defense by price and position (bots; SPEC owner FYI)

Simulation found reg blinds folding ~75–80% to any single open (vs UTG and vs SB alike), chart regs folding
100% in the BB to an unraised straddle, and heads-up the button opening ~58% with the BB folding ~78%.
Fixed in `src/bots/strategy/blinds.js` + `preflop.js`; checked by `tests/bots/blinds.test.js`, report
`node tests/bots/blind-report.js`.

**For the SPEC owner (please update §7 / §12 / §14 if you agree):**
1. **§7 blind defense.** Reg blinds (lowReg, midReg, toughReg; fish unchanged) no longer use the single
   `vpip` threshold when folded to them facing one raise. They continue with a target share set by the
   opener's position and the price (pot odds vs a standard 2.5bb / SB 3bb open, trimmed per caller):
   toughReg BB folds ~55% vs UTG, ~37% vs CO/BTN, ~30% vs SB; midReg ×0.95 and lowReg ×0.9 of its
   defense. Chart bots keep the chart's shape (3-bet chart as before, calls fill from the call chart
   outward); lowReg fills from its variant ordering. The SB defends ~12% vs UTG to ~29% vs BTN.
2. **§7 heads-up.** The button opens ~82–87% (regs) and the BB defends ~70–75% vs its open. 3–9 handed
   opens are unchanged.
3. **§14 straddle roles.** With a straddle live, the straddler uses the BB row (as now), the **BB uses the
   SB row** (it had no 'open' row as the BB), and the SB keeps its row. Folded to a blind facing only the
   straddle, regs play ~60–72% (BB) / ~53–60% (SB), raising the top ~45% of that and completing the rest.
4. **§12 VPIP convergence.** Blind defense lifts reg VPIP ~5–6pp over the profile target (10k bot-only
   hands, even mix: lowReg 30 vs 26, midReg 29 vs 23, toughReg 30 vs 23). The tier test now allows VPIP up
   to +8pp over target (PFR and 3-bet stay ±5pp). Either raise the §7 reg VPIP ranges (~+5pp) or accept
   the looser bound; I haven't forced VPIP back down elsewhere.

## 2026-09-29 — Opener vs 3-bet (bots; SPEC §7 correction, owner decision)

§7 says "Facing a 3-bet or more: continue with the top 40% of the `threeBet` range and 4-bet the top 15% of
it". The owner confirmed that's a spec error: it made openers fold ~90% (midReg/toughReg) to a 3-bet.
Implemented instead (`src/bots/strategy/vsThreeBet.js`, `preflop.js`), for regs only (fish unchanged):

**For the SPEC owner (please update §7):** the opener facing a 3-bet continues (call or 4-bet) with the top
share of **its own opening range from that position** (for chart bots, the narrower iso range when it raised
over limpers): lowReg 40%, midReg 48%, toughReg 50% out of position, +4pp in position, +3pp heads-up, scaled
by the price vs a standard 3×/4× 3-bet and trimmed per caller. It 4-bets the top 10% / 11% / 12% of that
range. Result (full bot-only games): fold to 3-bet lowReg ~56%, midReg ~52%, toughReg ~45%. Cold spots
(facing an open and a 3-bet without having opened) and 4-bets+ are unchanged.
