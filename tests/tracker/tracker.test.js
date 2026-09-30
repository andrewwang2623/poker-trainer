import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../../src/data/index.js';
import { createTracker } from '../../src/tracker/index.js';
import { recordFixture, resultFixture } from './fixtures.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);
const make = () => createTracker(createMemoryStore(), { sessionId: 'session', now: () => 123 });

test('all rates use their specified opportunities, with null for no opportunities', async () => {
  const tracker = make();
  const empty = await tracker.getStats('all');
  for (const key of ['vpip', 'pfr', 'threeBet', 'cbet', 'foldToCbet', 'foldToBet', 'wtsd', 'wsd', 'af']) assert.equal(empty[key], null);
  assert.deepEqual(empty.evAdjCi95, [0, 0]);
  const flags = recordFixture().statFlags;
  await tracker.recordHand(recordFixture(0, { statFlags: { ...flags, threeBetOpp: true, threeBet: true,
    postflopBets: 2, postflopRaises: 1, postflopCalls: 1, facedPostflopBet: true } }));
  await tracker.recordHand(recordFixture(1, { statFlags: { ...flags, vpip: false, pfr: false, cbet: false,
    foldToCbetOpp: true, foldToCbet: true, wonAtShowdown: false, postflopCalls: 1, postflopBets: 0,
    facedPostflopBet: true, foldedToPostflopBet: true } }));
  await tracker.recordHand(recordFixture(2, { statFlags: { ...flags, vpip: false, pfr: false,
    cbetOpp: false, cbet: false, sawFlop: false, wentToShowdown: false, wonAtShowdown: false, postflopBets: 0 } }));
  const stats = await tracker.getStats('all');
  near(stats.vpip, 1 / 3); near(stats.pfr, 1 / 3);
  assert.equal(stats.threeBet, 1); assert.equal(stats.cbet, .5); assert.equal(stats.foldToCbet, 1);
  assert.equal(stats.foldToBet, .5); assert.equal(stats.wtsd, 1); assert.equal(stats.wsd, .5); assert.equal(stats.af, 1.5);
  assert.deepEqual(stats.opportunities, { vpip: 3, threeBet: 1, cbet: 2, foldToCbet: 1, foldToBet: 2, wtsd: 2, wsd: 2 });
});

test('all-in EV, sample SD interval, coaching denominator, hero rake and bounties stay separate', async () => {
  const tracker = make();
  const first = recordFixture(0, { heroNetBb: 10, heroEvNetBb: 1, heroRakeBb: .2, heroBountyBb: 50 });
  first.coach = resultFixture(first.id, { totalEvLossBb: 2 });
  const old = recordFixture(1, { heroNetBb: -4, heroEvNetBb: 3, heroRakeBb: .4 });
  delete old.heroBountyBb;
  await tracker.recordHand(first); await tracker.recordHand(old);
  const stats = await tracker.getStats('all');
  assert.equal(stats.bbPer100, 300); assert.equal(stats.evAdjBbPer100, 200);
  assert.equal(stats.bountyPer100, 2500); assert.equal(stats.bbPer100WithBounty, 2800);
  near(stats.evAdjCi95[0], 4); near(stats.evAdjCi95[1], 396);
  assert.equal(stats.coachedHands, 1); assert.equal(stats.evLossPer100, 200); near(stats.rakePer100, 30);
  assert.deepEqual(stats.topLeaks, [{ flagId: 'SZ_TOO_SMALL', count: 1, evLossBb: .8 }]);
  const without = make();
  await without.recordHand({ ...first, heroBountyBb: 0 }); await without.recordHand(old);
  assert.deepEqual((await without.getStats('all')).profitability, stats.profitability);
});

test('leaks group and rank hand-level flags only, with the top five retained', async () => {
  const tracker = make();
  for (let i = 0; i < 2; i++) {
    const record = recordFixture(i);
    const flags = ['PF_OPEN_SIZE', 'EQ_BAD_CALL', 'EQ_BAD_FOLD', 'SZ_TOO_SMALL', 'SZ_TOO_LARGE', 'LN_MISSED_CBET', 'PAT_TOO_LOOSE']
      .map((id, index) => ({ ...resultFixture(record.id).flags[0], id, evLossBb: index + 1 }));
    record.coach = resultFixture(record.id, { flags, totalEvLossBb: 10 });
    await tracker.recordHand(record);
  }
  const stats = await tracker.getStats('all');
  assert.equal(stats.topLeaks.length, 5);
  assert.deepEqual(stats.topLeaks[0], { flagId: 'LN_MISSED_CBET', count: 2, evLossBb: 12 });
  assert.ok(stats.topLeaks.every(leak => !leak.flagId.startsWith('PAT_')));
});

test('all five windows, previous equal-sized trends, session and stakes filtering', async () => {
  const store = createMemoryStore();
  const tracker = createTracker(store, { sessionId: 'current' });
  await store.putMany(Array.from({ length: 2200 }, (_, i) => recordFixture(i, {
    sessionId: i >= 2100 ? 'current' : 'old', stakes: i % 2 ? 'low' : 'micro',
    heroNetBb: i >= 2100 ? 2 : 1, heroEvNetBb: 1,
    statFlags: { ...recordFixture().statFlags, vpip: i >= 2100 },
  })));
  for (const [window, hands] of [[100, 100], [500, 500], [1000, 1000], ['session', 100], ['all', 2200]]) {
    const stats = await tracker.getStats(window);
    assert.equal(stats.hands, hands); assert.equal(stats.stakes, 'mixed');
    if (typeof window !== 'number') assert.equal(stats.trend, null);
  }
  assert.deepEqual((await tracker.getStats(100)).trend, { bbPer100Delta: 100, evLossPer100Delta: 0, vpipDelta: 1 });
  assert.equal((await tracker.getStats('session', { stakes: 'micro' })).hands, 50);
  assert.equal((await tracker.getStats(1000, { stakes: 'low' })).trend, null);
  assert.equal((await tracker.getRecentHands(1))[0].id, 'hand-2199');
  await assert.rejects(tracker.getStats(10), /window/);
});

test('JSON merge dedupes existing and incoming IDs; replace, validation, and serialized imports', async () => {
  const tracker = make();
  await tracker.recordHand(recordFixture(0));
  const exported = JSON.parse(await tracker.exportJSON());
  assert.equal(exported.schemaVersion, 1); assert.equal(exported.exportedAt, 123);
  exported.hands.push(recordFixture(0), recordFixture(1), recordFixture(1));
  const results = await Promise.all([tracker.importJSON(JSON.stringify(exported), { mode: 'merge' }),
    tracker.importJSON(JSON.stringify(exported), { mode: 'merge' })]);
  assert.deepEqual(results, [{ added: 1, skipped: 3 }, { added: 0, skipped: 4 }]);
  assert.deepEqual(await tracker.importJSON(JSON.stringify({ ...exported, hands: [recordFixture(2)] }), { mode: 'replace' }), { added: 1, skipped: 0 });
  for (const text of ['{', JSON.stringify({ ...exported, schemaVersion: 99 }),
    JSON.stringify({ ...exported, hands: [recordFixture(3), { id: 'bad' }] })]) {
    await assert.rejects(tracker.importJSON(text, { mode: 'replace' }));
    assert.equal((await tracker.getRecentHands(10))[0].id, 'hand-2');
  }
  assert.equal((await tracker.getStats('all')).hands, 1);
});

test('malformed coaching data and stats reject before replace changes storage', async () => {
  const tracker = make();
  await tracker.recordHand(recordFixture(0));
  const badCoach = recordFixture(1);
  badCoach.coach = resultFixture(badCoach.id, { flags: [null] });
  const badFlags = recordFixture(2, { statFlags: { ...recordFixture().statFlags, postflopCalls: -1 } });
  for (const record of [badCoach, badFlags]) {
    await assert.rejects(tracker.recordHand(record), TypeError);
    await assert.rejects(tracker.importJSON(JSON.stringify({ schemaVersion: 1, hands: [record] }), { mode: 'replace' }), TypeError);
    assert.equal((await tracker.getStats('all')).hands, 1);
  }
});

test('failed replace writes leave every existing hand intact', async () => {
  const store = createMemoryStore();
  const original = [recordFixture(0), recordFixture(1)];
  await store.putMany(original);
  const before = await store.getAll();
  const failedWrite = async () => { throw new Error('disk full'); };
  const tracker = createTracker({ ...store, putMany: failedWrite, replaceAll: failedWrite });
  await assert.rejects(tracker.importJSON(JSON.stringify({ schemaVersion: 1, hands: [recordFixture(2)] }),
    { mode: 'replace' }), /disk full/);
  assert.deepEqual(await store.getAll(), before);
});
