import test from 'node:test';
import assert from 'node:assert/strict';
import { createTracker } from '../../src/tracker/index.js';
import { createMemoryStore } from '../../src/data/index.js';
import { createDashboard, loadDashboardData, renderDashboard, renderTrendChart } from '../../src/ui/dashboard.js';
import { createTrackerTools } from '../../src/ui/tracker-tools.js';
import { mountApp } from '../../src/ui/index.js';
import { createMockSession } from '../../src/ui/mock.js';
import * as exporter from '../../src/export/index.js';
import * as explain from '../../src/explain/index.js';
import { PROFITABILITY_DISCLAIMER } from '../../src/shared/schemas.js';
import { recordFixture, resultFixture } from '../tracker/fixtures.js';
import { createFakeCoach } from './fake-coach.js';
import { Node, setup, text } from './bounty-dom.js';

async function fixture(t, { coach = createFakeCoach() } = {}) {
  setup(t);
  const store = createMemoryStore();
  const records = Array.from({ length: 120 }, (_, i) => {
    const record = recordFixture(i, { heroNetBb: i % 2 ? 2 : -1, heroEvNetBb: .5,
      heroBountyBb: i % 4 === 0 ? 4 : 0, stakes: i % 2 ? 'micro' : 'low', sessionId: i >= 100 ? 'session' : 'old' });
    record.coach = resultFixture(record.id);
    return record;
  });
  await store.putMany(records);
  const tracker = createTracker(store, { sessionId: 'session' });
  const session = { getState: () => ({ stakes: 'micro' }), getSessionId: () => 'session', getRecentHands: () => records.slice(-10).reverse(), async refreshHeroStats() {} };
  const app = { tracker, coach, exporter, explain, features: { tracker: true, dashboard: true, export: true, coach: Boolean(coach) } };
  return { app, session, records };
}

test('dashboard cards, chart, leaks, coach patterns and confidence disclaimer use real tracker data', async t => {
  const { app, session } = await fixture(t);
  const data = await loadDashboardData(app, session, { window: 'session', stakes: 'micro' });
  assert.equal(data.stats.hands, 10); assert.equal(data.records.length, 10);
  assert.equal(app.coach.calls.patterns.length, 1); assert.equal(app.coach.calls.patterns[0].stakes, 'micro');
  assert.ok(app.coach.calls.patterns[0].records.every(record => record.stakes === 'micro'));
  const dashboard = renderDashboard(data, explain.explainFlag);
  const content = text(dashboard);
  assert.match(content, /excluding bounties.*with bounties/);
  assert.match(content, /Fold to bet/); assert.match(content, /SZ_TOO_SMALL/);
  assert.match(content, /Confidence: low/); assert.ok(content.includes(PROFITABILITY_DISCLAIMER));
  const chart = dashboard.querySelector('svg');
  assert.equal(chart.attributes.role, 'img'); assert.equal(chart.querySelectorAll('polyline').length, 3);
  assert.ok(chart.querySelectorAll('polyline').every(line => !/NaN|Infinity/.test(line.attributes.points)));
});

test('filters cover all windows and stakes; mixed patterns never pass mixed to the coach', async t => {
  const { app, session } = await fixture(t);
  const dashboard = createDashboard(app, session);
  await dashboard.refresh();
  const [window, stakes] = dashboard.node.querySelectorAll('select');
  assert.deepEqual(window.children.map(option => option.value), ['100', '500', '1000', 'session', 'all']);
  window.value = 'session'; window.events.change(); await dashboard.refresh(true);
  assert.match(text(dashboard.node), /Session · 10 hands/);
  stakes.value = ''; stakes.events.change(); await dashboard.refresh(true);
  assert.match(text(dashboard.node), /Session · 20 hands/);
  assert.ok(app.coach.calls.patterns.every(call => ['micro', 'low'].includes(call.stakes)));
  window.value = 'all'; window.events.change(); await dashboard.refresh(true);
  assert.match(text(dashboard.node), /All hands · 120 hands/);
});

test('empty and no-coach dashboards stay useful, and flat/negative SVG series are finite', async t => {
  const { app, session } = await fixture(t, { coach: null });
  const data = await loadDashboardData(app, session, { window: 'all', stakes: 'high' });
  const node = renderDashboard(data, explain.explainFlag);
  assert.match(text(node), /0 hands/); assert.match(text(node), /Complete a hand/);
  assert.ok(text(node).includes(PROFITABILITY_DISCLAIMER));
  for (const value of [0, -1]) {
    const chart = renderTrendChart([recordFixture(1, { heroNetBb: value, heroEvNetBb: value })]);
    assert.ok(chart.querySelectorAll('polyline').every(line => !/NaN|Infinity/.test(line.attributes.points)));
  }
  app.coach = { detectPatterns() { throw new Error('unavailable'); } };
  assert.equal((await loadDashboardData(app, session)).patternError, 'Pattern analysis unavailable.');
});

test('table/dashboard navigation preserves the session and hides only the inactive page', async t => {
  const { app } = await fixture(t);
  const session = createMockSession({ stakes: 'micro' });
  const handId = session.getState().handId;
  app.session = session;
  const root = new Node('div'); const mounted = mountApp(root, app); t.after(() => mounted.destroy());
  assert.equal(root.querySelector('.dashboard').hidden, true);
  root.querySelector('.dashboard-link').events.click({ preventDefault() {} });
  assert.equal(root.querySelector('.dashboard').hidden, false); assert.equal(root.querySelector('.game-layout').hidden, true);
  root.querySelector('.table-link').events.click({ preventDefault() {} });
  assert.equal(root.querySelector('.game-layout').hidden, false); assert.equal(root.querySelector('.dashboard').hidden, true);
  assert.equal(session.getState().handId, handId);
  mounted.destroy(); // Cancel the pending dashboard render before restoring the test DOM.
});

test('summary uses all five windows, patterns, bounty accounting and selectable clipboard fallback', async t => {
  const { app, session } = await fixture(t);
  const tools = createTrackerTools(app, session, { getStakes: () => 'micro' });
  await tools.node.querySelector('.copy-summary').events.click();
  const fallback = tools.node.querySelector('.tracker-text');
  assert.equal(fallback.hidden, false); assert.ok(fallback.selected);
  for (const label of ['Last100', 'Last500', 'Last1000', 'Session', 'All']) assert.ok(fallback.value.includes(label));
  assert.match(fallback.value, /Bounty accounting/); assert.match(fallback.value, /PAT_TOO_LOOSE/);
  assert.match(fallback.value, /confidence: low/); assert.ok(fallback.value.includes(PROFITABILITY_DISCLAIMER));
});

test('JSON download contains full records; restore merge/replace refreshes stats and reports failures', async t => {
  const { app, session } = await fixture(t);
  let blob, revoked, refreshed = 0;
  t.mock.method(URL, 'createObjectURL', value => { blob = value; return 'blob:backup'; });
  t.mock.method(URL, 'revokeObjectURL', value => { revoked = value; });
  t.mock.method(globalThis, 'setTimeout', callback => { callback(); return 1; });
  const tools = createTrackerTools(app, session, { onRestore: async () => { refreshed++; } });
  await tools.node.querySelector('.backup-json').events.click();
  assert.equal(JSON.parse(await blob.text()).hands.length, 120); assert.equal(revoked, 'blob:backup');
  assert.match(text(tools.node), /downloaded/);
  const file = tools.node.querySelector('.restore-file');
  const backup = JSON.stringify({ schemaVersion: 1, exportedAt: 123, hands: [recordFixture(119), recordFixture(200)] });
  file.files = [{ text: async () => backup }];
  await file.events.change();
  assert.equal((await app.tracker.getStats('all')).hands, 121); assert.equal(refreshed, 1);
  assert.match(text(tools.node), /Restored 1 hands; skipped 1 duplicates/);
  tools.node.querySelector('.restore-mode').value = 'replace'; await file.events.change();
  assert.equal((await app.tracker.getStats('all')).hands, 2); assert.equal(refreshed, 2);
  file.files = [{ text: async () => '{bad' }]; await file.events.change();
  assert.equal((await app.tracker.getStats('all')).hands, 2); assert.match(text(tools.node), /Could not complete/);
});
