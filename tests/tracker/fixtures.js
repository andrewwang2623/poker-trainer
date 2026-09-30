import { handFixture, coachFixture } from '../export/fixtures.js';

export function recordFixture(index = 0, changes = {}) {
  const record = handFixture();
  return { ...record, id: `hand-${index}`, timestamp: record.timestamp + index, straddleSeat: null,
    bounties: [], heroBountyBb: 0,
    statFlags: { ...record.statFlags, facedPostflopBet: false, foldedToPostflopBet: false,
      straddled: false, facedStraddle: false }, ...changes };
}

export function resultFixture(handId, changes = {}) {
  return { ...coachFixture(), handId, ...changes };
}
