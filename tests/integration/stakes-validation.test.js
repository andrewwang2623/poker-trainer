import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../../src/data/index.js';
import { createTracker } from '../../src/tracker/index.js';
import { summarize } from '../../src/tracker/stats.js';
import { estimateProfitability } from '../../src/tracker/profitability.js';
import { formatHand, formatSummary } from '../../src/export/index.js';
import { createMockGameState } from '../../src/ui/mock.js';
import { renderTable } from '../../src/ui/table.js';
import { recordFixture } from '../tracker/fixtures.js';
import { setup, text } from './bounty-dom.js';

const inherited = ['toString', 'constructor', '__proto__', 'hasOwnProperty'];

test('tracker rejects inherited stakes names when recording, importing and filtering', async () => {
  const tracker = createTracker(createMemoryStore());
  await tracker.recordHand(recordFixture(0));
  for (const stakes of inherited) {
    const record = recordFixture(1, { stakes });
    await assert.rejects(tracker.recordHand(record), TypeError);
    await assert.rejects(tracker.importJSON(JSON.stringify({ schemaVersion: 1, hands: [record] }),
      { mode: 'replace' }), TypeError);
    await assert.rejects(tracker.getStats('all', { stakes }), RangeError);
    assert.equal((await tracker.getStats('all')).hands, 1);
  }
});

test('stats and profitability never resolve inherited stakes as configurations', () => {
  const stats = summarize([], 'all', 'micro');
  for (const stakes of inherited) {
    assert.throws(() => summarize([], 'all', stakes), RangeError);
    assert.throws(() => summarize([recordFixture(1, { stakes })], 'all'), RangeError);
    assert.deepEqual(estimateProfitability({ ...stats, stakes }), estimateProfitability(stats));
  }
});

test('exports reject invalid hand stakes and use mixed summary fallback for unknown stakes', () => {
  for (const stakes of inherited) {
    assert.throws(() => formatHand(recordFixture(1, { stakes })), RangeError);
    assert.match(formatSummary({ stats: [], stakes }), /Stakes: Mixed/);
  }
});

test('mock and table rendering do not accept inherited stakes configurations', t => {
  setup(t);
  for (const stakes of inherited) {
    assert.throws(() => createMockGameState({ stakes }), RangeError);
    const node = renderTable({ ...createMockGameState(), stakes });
    assert.doesNotMatch(text(node), /NaN|undefined/);
    assert.equal(node.querySelector('.rake-readout'), null);
  }
});
