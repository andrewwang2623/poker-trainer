# Requests from Astra

## Summary export date range

SPEC.md §10 shows a From/To date range, but StatsSummary in schemas.js contains no timestamps. Please add nullable start/end timestamps if that range is required. `formatSummary` currently omits the range rather than inventing dates or changing the shared contract.

## Engine `createdAt` and hand ID contract

`src/engine/scenario.js` currently drops `createdAt`, and `src/engine/game.js` builds a seed-only ID that includes the raw seed in its first eight hex characters. Please carry `createdAt` through `createScenario` and build `handId` as `createdAt.toString(36) + '-' +` the first eight lowercase hex characters of a synchronous one-way seed hash, per SPEC.md §4, §5 and §13. The UI session currently supplies `createdAt` and adapts the ID locally so the app can ship while the engine owner makes this change.
