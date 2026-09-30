import { SCHEMA_VERSION, STATS_WINDOWS, STAKES } from '../shared/schemas.js';
import { summarize } from './stats.js';

function validateRecord(record) {
  if (!record || record.schemaVersion !== SCHEMA_VERSION || typeof record.id !== 'string' || !record.id ||
      !Number.isFinite(record.timestamp) || typeof record.sessionId !== 'string' || !STAKES[record.stakes] ||
      !Number.isFinite(record.heroNetBb) || !Number.isFinite(record.heroEvNetBb) ||
      !Number.isFinite(record.heroRakeBb) || !record.statFlags || !record.result ||
      !Array.isArray(record.players) || !Array.isArray(record.events) || !Array.isArray(record.decisions) ||
      (record.heroBountyBb != null && !Number.isFinite(record.heroBountyBb)) ||
      (record.coach != null && (record.coach.handId !== record.id || !Number.isFinite(record.coach.totalEvLossBb) ||
        !Array.isArray(record.coach.flags) || !Array.isArray(record.coach.decisions)))) {
    throw new TypeError('Invalid or unsupported HandRecord in backup.');
  }
}

/** All persistence is delegated to HandStore. Mutations are serialized, including imports. */
export function createTracker(store, { sessionId, now = Date.now } = {}) {
  let pending = Promise.resolve();
  const mutate = run => {
    const result = pending.then(run);
    pending = result.catch(() => {});
    return result;
  };
  const all = async () => {
    await pending;
    return (await store.getAll()).sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
  };
  return {
    recordHand(record) { validateRecord(record); return mutate(() => store.put(record)); },
    async getStats(window, { stakes } = {}) {
      if (!STATS_WINDOWS.includes(window)) throw new RangeError('Unknown stats window');
      if (stakes != null && !STAKES[stakes]) throw new RangeError('Unknown stakes');
      let records = await all();
      if (stakes) records = records.filter(record => record.stakes === stakes);
      if (window === 'session') records = records.filter(record => record.sessionId === sessionId);
      const selected = typeof window === 'number' ? records.slice(0, window) : records;
      const stats = summarize(selected, window, stakes);
      if (typeof window === 'number' && records.length >= window * 2) {
        const previous = summarize(records.slice(window, 2 * window), window, stakes);
        stats.trend = { bbPer100Delta: stats.bbPer100 - previous.bbPer100,
          evLossPer100Delta: stats.evLossPer100 - previous.evLossPer100,
          vpipDelta: stats.vpip == null || previous.vpip == null ? null : stats.vpip - previous.vpip };
      }
      return stats;
    },
    async getRecentHands(n) { return (await all()).slice(0, Math.max(0, n)); },
    async exportJSON() { return JSON.stringify({ schemaVersion: SCHEMA_VERSION, exportedAt: now(), hands: await all() }, null, 2); },
    importJSON(text, { mode = 'merge' } = {}) {
      return mutate(async () => {
        if (!['merge', 'replace'].includes(mode)) throw new RangeError('Unknown import mode');
        const backup = JSON.parse(text);
        if (backup?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(backup.hands)) throw new TypeError('Invalid or unsupported backup.');
        backup.hands.forEach(validateRecord); // Validate every hand before changing storage.
        const ids = new Set(mode === 'merge' ? (await store.getAll()).map(record => record.id) : []);
        const added = [];
        let skipped = 0;
        for (const record of backup.hands) {
          if (ids.has(record.id)) { skipped++; continue; }
          ids.add(record.id);
          added.push(record);
        }
        if (mode === 'replace') await store.clear();
        await store.putMany(added);
        return { added: added.length, skipped };
      });
    },
  };
}
