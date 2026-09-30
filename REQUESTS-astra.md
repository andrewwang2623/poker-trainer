# Requests from Astra

## Native live UTG straddle support

2026-09-29: engine/bot support and UI wiring are complete. The UI now passes native straddle options to scenario generation and renders native `postBlind` / `blind: 'straddle'` events for hero or bots. The temporary posting adapter and its tests have been removed.

Still pending for the human-owned SPEC/schema: adopt the straddle fields/events/constants and bot tier flag amendments listed in REQUESTS-claude.md (2026-09-29). The app follows the native engine contract and the user's explicit migration instructions while those declarations are updated.

## Summary export date range

SPEC.md §10 shows a From/To date range, but StatsSummary in schemas.js contains no timestamps. Please add nullable start/end timestamps if that range is required. `formatSummary` currently omits the range rather than inventing dates or changing the shared contract.

## Engine `createdAt` and hand ID contract

Resolved: the engine carries `createdAt` and generates the required SHA-256-based ID. The UI now trusts its returned state; the timestamp/ID patches and duplicate hash module have been removed.

## Atomic HandStore replacement

2026-09-30: please add `replaceAll(records): Promise<void>` to the HandStore contract in SPEC.md §6 and
`src/shared/schemas.js`. It atomically replaces all hands, preserving the existing store if any write fails.
Both owned storage adapters implement it now: one IndexedDB readwrite transaction, or preparation of a
complete cloned map before swapping memory storage. Tracker replace imports require this operation and
reject unsupported adapters before modifying data; merge imports keep using `putMany`.

## Nullable EV-loss trend

2026-09-30: please change `StatsSummary.trend.evLossPer100Delta` to `number|null` in
`src/shared/schemas.js`. Per the owner's review decision, the delta is unavailable unless both compared
windows contain coached hands. The tracker returns null and dashboard/summary export display an em dash;
observed zero loss in two coached windows remains a numeric zero.
