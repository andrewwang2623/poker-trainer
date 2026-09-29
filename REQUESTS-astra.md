# Requests from Astra

## Engine `createdAt` and hand ID contract

`src/engine/scenario.js` currently drops `createdAt`, and `src/engine/game.js` builds a seed-only ID that includes the raw seed in its first eight hex characters. Please carry `createdAt` through `createScenario` and build `handId` as `createdAt.toString(36) + '-' +` the first eight lowercase hex characters of a synchronous one-way seed hash, per SPEC.md §4, §5 and §13. The UI session currently supplies `createdAt` and adapts the ID locally so the app can ship while the engine owner makes this change.
