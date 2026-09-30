import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../../src/data/index.js';
import { createTracker } from '../../src/tracker/index.js';
import { renderDashboard } from '../../src/ui/dashboard.js';
import { formatSummary } from '../../src/export/index.js';
import { recordFixture, resultFixture } from '../tracker/fixtures.js';
import { setup, text } from './bounty-dom.js';

for (const [current, previous, expected] of [[null, null, null], [1, null, null], [null, 2, null], [1, 2, -100], [0, 0, 0]]) {
  test(`EV-loss trend with current ${current} and previous ${previous} coaching loss`, async t => {
    setup(t);
    const store = createMemoryStore();
    const records = Array.from({ length: 200 }, (_, i) => {
      const record = recordFixture(i);
      const loss = i === 99 ? previous : i === 199 ? current : null;
      if (loss !== null) record.coach = resultFixture(record.id, { totalEvLossBb: loss });
      return record;
    });
    await store.putMany(records);
    const stats = await createTracker(store).getStats(100);
    assert.equal(stats.trend.evLossPer100Delta, expected);
    assert.equal(stats.trend.bbPer100Delta, 0);
    assert.equal(stats.trend.vpipDelta, 0);
    const displayed = expected === null ? '—' : expected === 0 ? '+0.0' : '-100.0';
    const dashboard = renderDashboard({ stats, records: records.slice(-100), patterns: [] });
    assert.ok(text(dashboard.querySelector('.window-trend')).includes(`EV loss/100 ${displayed} ·`));
    assert.ok(formatSummary({ stats: [stats], stakes: 'micro' }).includes(`EV loss/100 ${displayed},`));
    assert.doesNotMatch(text(dashboard), /\+—|NaN/);
  });
}

test('dashboard and summary suppress numeric loss trends for an uncoached current window', async t => {
  setup(t);
  const stats = await createTracker(createMemoryStore()).getStats(100);
  stats.trend = { bbPer100Delta: 0, evLossPer100Delta: -25, vpipDelta: null };
  const dashboard = renderDashboard({ stats, records: [], patterns: [] });
  assert.match(text(dashboard.querySelector('.window-trend')), /EV loss\/100 —/);
  assert.match(formatSummary({ stats: [stats], stakes: 'micro' }), /EV loss\/100 —,/);
});
