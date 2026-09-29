# Requests from Astra

## Native live UTG straddle support

User requested an optional 2bb hero straddle when first after the BB at 3+ player tables, sampled independently of cards, with configurable probability (default 33% of eligible hands). Please add an explicit straddle option to ScenarioConfig/createHand, a straddle blind/event discriminator, and replayable metadata in the shared contract. Engine must post the live blind, start action left of the straddler, retain the straddler's check/raise option, use a 4bb initial minimum raise, and preserve chip accounting and normal postflop order. Bots/coach should recognize straddled pots without treating the forced post as a voluntary raise, VPIP, or PFR; chart sizing/depth assumptions should account for the live 2bb blind.

Until native support is available, `src/ui/straddle.js` adapts the initial state using existing fields. The forced post is encoded as a third `postBlind` with `blind: 'BB'`, amount 200 chips, from the seat immediately after the actual BB (the real bbSeat stays unchanged). This schema-compatible encoding is recognized as a straddle by UI/export adapters and counted as a forced contribution by engine record replay. No synthetic hero action or extra decision is created. Probability uses `deriveSeed(seed, 'straddle')`, separate from deck/bot streams. The adapter skips heads-up, other positions, already-started hands, and stacks unable to post a full live straddle. Existing bot actions remain legal via their legal-action clamp, but their charts are still calibrated to ordinary blinds until the owners update them.

## Summary export date range

SPEC.md §10 shows a From/To date range, but StatsSummary in schemas.js contains no timestamps. Please add nullable start/end timestamps if that range is required. `formatSummary` currently omits the range rather than inventing dates or changing the shared contract.

## Engine `createdAt` and hand ID contract

`src/engine/scenario.js` currently drops `createdAt`, and `src/engine/game.js` builds a seed-only ID that includes the raw seed in its first eight hex characters. Please carry `createdAt` through `createScenario` and build `handId` as `createdAt.toString(36) + '-' +` the first eight lowercase hex characters of a synchronous one-way seed hash, per SPEC.md §4, §5 and §13. The UI session currently supplies `createdAt` and adapts the ID locally so the app can ship while the engine owner makes this change.
