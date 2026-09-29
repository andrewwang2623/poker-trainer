# Requests from Astra

## Native live UTG straddle support

2026-09-29: engine/bot support and UI wiring are complete. The UI now passes native straddle options to scenario generation and renders native `postBlind` / `blind: 'straddle'` events for hero or bots. The temporary posting adapter and its tests have been removed.

Still pending for the human-owned SPEC/schema: adopt the straddle fields/events/constants and bot tier flag amendments listed in REQUESTS-claude.md (2026-09-29). The app follows the native engine contract and the user's explicit migration instructions while those declarations are updated.

## Summary export date range

SPEC.md §10 shows a From/To date range, but StatsSummary in schemas.js contains no timestamps. Please add nullable start/end timestamps if that range is required. `formatSummary` currently omits the range rather than inventing dates or changing the shared contract.

## Engine `createdAt` and hand ID contract

Resolved: the engine carries `createdAt` and generates the required SHA-256-based ID. The UI now trusts its returned state; the timestamp/ID patches and duplicate hash module have been removed.
