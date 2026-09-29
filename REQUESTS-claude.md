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
