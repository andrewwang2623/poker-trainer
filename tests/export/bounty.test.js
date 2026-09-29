import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHandRecord } from '../../src/engine/index.js';
import { formatHand } from '../../src/export/index.js';
import { bountyHand, finish } from '../integration/bounty-fixtures.js';

for (const hero of [0, 1]) test(`§10 export separates both bounty payments from pot/rake for hero ${hero}`, () => {
  const record = buildHandRecord(finish(bountyHand({ hero })));
  const before = structuredClone(record);
  const output = formatHand(record);
  assert.match(output, /Rake: [^\n]+\nBounty: hand J4o \| 2.0bb from each player \| pays on showdown or fold\nBounty: card 4c \| 2.0bb from each player \| pays on showdown or fold\nPlayers:/);
  const result = output.split('\n').find(line => line.startsWith('RESULT:'));
  assert.ok(result.includes(`| bounty ${hero === 0 ? '+' : '-'}2.0bb (hand J4o) | bounty ${hero === 0 ? '+' : '-'}2.0bb (card 4c) | rake 0.1bb`));
  assert.match(result, hero === 0 ? /net \+0.9bb/ : /net -1.0bb/);
  assert.deepEqual(record, before);
  assert.match(formatHand(record, { hideOpponentCards: true }), /Bounty: hand J4o/, 'public bounty stays visible');
});

test('single bounty export uses heroBountyBb and falls back to native bounty net for older records', () => {
  const record = buildHandRecord(finish(bountyHand({ targets: ['J4o'] })));
  assert.match(formatHand(record), /\| bounty \+2.0bb \(hand J4o\)/);
  delete record.heroBountyBb;
  assert.match(formatHand(record), /\| bounty \+2.0bb \(hand J4o\)/);
  delete record.result.bountyNetChips;
  assert.match(formatHand(record), /\| bounty \+0.0bb \(hand J4o\)/);
});

test('showdown-only bounty denied by a fold, and nonmatching targets, export as unclaimed', () => {
  for (const record of [
    buildHandRecord(finish(bountyHand({ paysOn: 'showdownOnly' }), true)),
    buildHandRecord(finish(bountyHand({ targets: ['72o', '6c'] }))),
  ]) {
    const output = formatHand(record);
    assert.equal((output.match(/\| bounty unclaimed/g) ?? []).length, 2);
    assert.doesNotMatch(output, /\| bounty [+-]/);
  }
  const output = formatHand(buildHandRecord(finish(bountyHand({ paysOn: 'showdownOnly' }))));
  assert.match(output, /pays on showdown only/);
  assert.match(output, /\| bounty \+2.0bb/);
});

test('no-bounty and legacy records produce identical exports without bounty text', () => {
  const record = buildHandRecord(finish(bountyHand({ live: false })));
  const output = formatHand(record);
  delete record.bounties;
  delete record.heroBountyBb;
  delete record.result.bountyNetChips;
  assert.equal(formatHand(record), output);
  assert.doesNotMatch(output, /bounty/i);
});

test('each bounty retains its own claim status and exports capped actual transfers', () => {
  const mixed = buildHandRecord(finish(bountyHand({ targets: ['J4o', '6c'] })));
  assert.match(formatHand(mixed), /\| bounty \+2.0bb \(hand J4o\) \| bounty unclaimed \(card 6c\)/);
  const capped = buildHandRecord(finish(bountyHand({ targets: ['J4o'], stacks: [10000, 250] })));
  assert.match(formatHand(capped), /Bounty: hand J4o \| 2.0bb from each player/);
  assert.match(formatHand(capped), /\| bounty \+1.5bb \(hand J4o\)/);
});
