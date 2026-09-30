const clone = value => structuredClone(value);
const newest = (a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id);

/** An isolated, asynchronous HandStore for tests and browsers without IndexedDB. */
export function createMemoryStore() {
  let hands = new Map();
  return {
    async put(record) { hands.set(record.id, clone(record)); },
    async putMany(records) { for (const record of records) hands.set(record.id, clone(record)); },
    async replaceAll(records) {
      const replacement = new Map(records.map(record => [record.id, clone(record)]));
      hands = replacement;
    },
    async get(id) { return clone(hands.get(id)); },
    async getAll() { return [...hands.values()].sort(newest).map(clone); },
    async getLatest(n) { return (await this.getAll()).slice(0, Math.max(0, n)); },
    async count() { return hands.size; },
    async clear() { hands.clear(); },
  };
}

/** IndexedDB belongs exclusively in the data adapter, never in tracker logic. */
export async function openHandStore({ indexedDB = globalThis.indexedDB } = {}) {
  if (!indexedDB) return createMemoryStore();
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('poker-trainer', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('hands', { keyPath: 'id' });
      store.createIndex('timestamp', 'timestamp');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Hand storage upgrade is blocked by another tab.'));
  });
  db.onversionchange = () => db.close();
  function transaction(mode, run) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('hands', mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Hand storage transaction failed.'));
      try { run(tx.objectStore('hands'), value => { result = value; }); }
      catch (error) { tx.abort(); reject(error); }
    });
  }
  return {
    put(record) { return this.putMany([record]); },
    putMany(records) { return transaction('readwrite', store => { for (const record of records) store.put(record); }); },
    replaceAll(records) {
      return transaction('readwrite', store => {
        store.clear();
        for (const record of records) store.put(record);
      });
    },
    get(id) { return transaction('readonly', (store, done) => { store.get(id).onsuccess = event => done(event.target.result); }); },
    getAll() { return transaction('readonly', (store, done) => { store.getAll().onsuccess = event => done(event.target.result.sort(newest)); }); },
    getLatest(n) {
      return transaction('readonly', (store, done) => {
        const records = [];
        done(records);
        if (n <= 0) return;
        store.index('timestamp').openCursor(null, 'prev').onsuccess = event => {
          const cursor = event.target.result;
          if (!cursor || records.length >= n) return;
          records.push(cursor.value);
          if (records.length < n) cursor.continue();
        };
      });
    },
    count() { return transaction('readonly', (store, done) => { store.count().onsuccess = event => done(event.target.result); }); },
    clear() { return transaction('readwrite', store => { store.clear(); }); },
  };
}
