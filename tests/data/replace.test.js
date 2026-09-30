import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, openHandStore } from '../../src/data/index.js';
import { recordFixture } from '../tracker/fixtures.js';

// Transactional IndexedDB double: writes commit together or all roll back on abort.
function indexedDBFixture() {
  let hands = new Map();
  let failId = null;
  const writes = [];
  const db = {
    transaction(name, mode) {
      assert.equal(name, 'hands');
      const next = new Map(hands);
      const operations = [];
      let aborted = false;
      const tx = {
        abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); },
        objectStore() {
          return {
            clear() { operations.push('clear'); next.clear(); },
            put(record) {
              operations.push('put');
              if (record.id === failId) {
                queueMicrotask(() => { tx.error = new Error('disk full'); tx.abort(); });
              }
              next.set(record.id, structuredClone(record));
            },
            getAll() {
              const request = {};
              queueMicrotask(() => request.onsuccess({ target: { result: [...hands.values()] } }));
              return request;
            },
          };
        },
      };
      // Requests dispatch before the transaction's completion event.
      queueMicrotask(() => queueMicrotask(() => {
        if (aborted) return;
        if (mode === 'readwrite') { hands = next; writes.push(operations); }
        tx.oncomplete();
      }));
      return tx;
    },
  };
  return {
    indexedDB: { open() {
      const request = { result: db };
      queueMicrotask(() => request.onsuccess());
      return request;
    } },
    failOn(id) { failId = id; },
    writes,
  };
}

test('memory replacement prepares all records before changing stored hands', async () => {
  const store = createMemoryStore();
  await store.put(recordFixture(0));
  const before = await store.getAll();
  await assert.rejects(store.replaceAll([recordFixture(1), recordFixture(2, { uncloneable() {} })]));
  assert.deepEqual(await store.getAll(), before);
  const replacement = recordFixture(3);
  await store.replaceAll([replacement]);
  replacement.players[0].name = 'Changed';
  assert.deepEqual((await store.getAll()).map(record => record.id), ['hand-3']);
  assert.equal((await store.get('hand-3')).players[0].name, 'Hero');
  await store.replaceAll([]);
  assert.equal(await store.count(), 0);
});

test('IndexedDB replacement clears and writes in one transaction, rolling back failed writes', async () => {
  const fixture = indexedDBFixture();
  const store = await openHandStore(fixture);
  await store.put(recordFixture(0));
  const before = await store.getAll();
  fixture.failOn('hand-2');
  await assert.rejects(store.replaceAll([recordFixture(1), recordFixture(2)]), /disk full/);
  assert.deepEqual(await store.getAll(), before);
  fixture.failOn(null);
  await store.replaceAll([recordFixture(3), recordFixture(4)]);
  assert.deepEqual(fixture.writes.at(-1), ['clear', 'put', 'put']);
  assert.deepEqual((await store.getAll()).map(record => record.id), ['hand-4', 'hand-3']);
});
