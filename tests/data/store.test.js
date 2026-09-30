import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, openHandStore } from '../../src/data/index.js';
import { recordFixture } from '../tracker/fixtures.js';

test('memory HandStore isolates records, overwrites by ID and returns newest first', async () => {
  const store = createMemoryStore();
  const first = recordFixture(0);
  await store.put(first);
  first.players[0].name = 'Changed';
  assert.equal((await store.get(first.id)).players[0].name, 'Hero');
  await store.putMany([recordFixture(2), recordFixture(1)]);
  assert.deepEqual((await store.getLatest(2)).map(record => record.id), ['hand-2', 'hand-1']);
  const records = await store.getAll(); records[0].players[0].name = 'Changed';
  assert.equal((await store.get('hand-2')).players[0].name, 'Hero');
  await store.put(recordFixture(0, { heroNetBb: -1 }));
  assert.equal(await store.count(), 3); assert.equal((await store.get('hand-0')).heroNetBb, -1);
  assert.equal(await store.get('missing'), undefined);
  await store.clear(); assert.equal(await store.count(), 0);
});

test('openHandStore works without IndexedDB, while open failures are surfaced for fallback', async () => {
  const store = await openHandStore({ indexedDB: null });
  await store.put(recordFixture()); assert.equal(await store.count(), 1);
  const unavailable = { open() { throw new Error('blocked'); } };
  await assert.rejects(openHandStore({ indexedDB: unavailable }), /blocked/);
});
